/**
 * 并发压测脚本。
 *
 * 目标：给出"到底能扛多少并发"的真实数据，而不是拍脑袋写"支持 50 并发"。
 *
 * 做法：
 *   1. 并发创建 N 个任务；
 *   2. 跟踪这批**任务**（而不是只跟踪已有运行）——容量不足时任务会停在 pending，
 *      由 Worker 的重试分配机制稍后启动，因此必须等到所有任务终态才算结束；
 *   3. 后台自动批准（只批本批任务的审批），避免审批等待污染执行吞吐；
 *   4. 每 500ms 采样队列积压与状态分布；
 *   5. 输出吞吐、端到端耗时、执行耗时、积压峰值。
 *
 * 用法：
 *   node scripts/load-test.mjs --tasks 50 --label "1-worker"
 *   node scripts/load-test.mjs --tasks 100 --label "2-workers-100"
 */

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const API = arg('api', 'http://127.0.0.1:8000/api/v1');
const TASKS = Number(arg('tasks', 50));
const WORKFLOW = arg('workflow', 'order_delay_exception');
const LABEL = arg('label', 'baseline');
const TIMEOUT_MS = Number(arg('timeout', 240)) * 1000;
const CREATE_CONCURRENCY = Number(arg('create-concurrency', 20));
const OUT_DIR = path.resolve('docs/experiments');

const TASK_TERMINAL = new Set(['succeeded', 'failed', 'canceled']);

let token = '';

async function api(pathname, init = {}, retried = false) {
  const res = await fetch(`${API}${pathname}`, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });

  // 长跑期间容器可能被重启导致令牌失效：重登一次再重试
  if (res.status === 401 && !retried && pathname !== '/auth/login') {
    await login();
    return api(pathname, init, true);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${pathname} → ${res.status} ${text.slice(0, 200)}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

function percentile(values, q) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[idx];
}

async function login() {
  const body = new URLSearchParams({ username: 'ops@agentmatrix.local', password: 'AgentMatrix@2026' });
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`登录失败：${res.status}`);
  token = (await res.json()).access_token;
}

async function createTasks() {
  const created = [];
  const stamp = Date.now();
  let cursor = 0;

  async function worker() {
    while (cursor < TASKS) {
      const index = cursor;
      cursor += 1;
      const payload = {
        title: `压测任务 ${index} ${stamp}`,
        workflow_code: WORKFLOW,
        priority: 3,
        complexity_hint: 3,
        payload: { order_id: `LOAD-${stamp}-${index}`, quantity: 420 },
      };
      const task = await api('/tasks', { method: 'POST', body: JSON.stringify(payload) });
      created.push({ index, taskId: task.id, runId: task.run_id });
    }
  }

  const t0 = Date.now();
  await Promise.all(Array.from({ length: Math.min(CREATE_CONCURRENCY, TASKS) }, () => worker()));
  return { created, createMs: Date.now() - t0 };
}

async function approveFor(ourRunIds) {
  const approvals = await api('/approvals');
  if (!Array.isArray(approvals)) return 0;
  const mine = approvals.filter((a) => ourRunIds.has(a.run_id));
  let approved = 0;
  await Promise.all(
    mine.map(async (a) => {
      try {
        await api(`/approvals/${a.id}/decision`, {
          method: 'POST',
          body: JSON.stringify({ decision: 'approved', comment: '压测自动批准' }),
        });
        approved += 1;
      } catch {
        /* 并发下可能已被处理 */
      }
    }),
  );
  return approved;
}

/** 执行耗时 = 各步骤耗时之和（不含审批等待） */
async function activeDurations(runIds) {
  const ids = [...runIds];
  const results = [];
  for (let i = 0; i < ids.length; i += 10) {
    const batch = ids.slice(i, i + 10);
    const details = await Promise.all(batch.map((id) => api(`/runs/${id}`).catch(() => null)));
    for (const run of details) {
      if (!run || !Array.isArray(run.steps)) continue;
      let total = 0;
      for (const step of run.steps) {
        if (step.started_at && step.finished_at) {
          total += (new Date(step.finished_at) - new Date(step.started_at)) / 1000;
        }
      }
      results.push(total);
    }
  }
  return results;
}

async function main() {
  console.log(`压测：${TASKS} 个任务 · 工作流 ${WORKFLOW} · ${LABEL}`);
  await login();

  const { created, createMs } = await createTasks();
  const taskIds = new Set(created.map((c) => c.taskId));
  const assignedAtCreate = created.filter((c) => c.runId).length;
  console.log(
    `创建完成：${created.length} 个，用时 ${createMs}ms（${(created.length / (createMs / 1000)).toFixed(1)} 个/秒），` +
      `即时分配 ${assignedAtCreate} 个`,
  );

  const startAt = Date.now();
  const samples = [];
  let approvedTotal = 0;
  let allDoneAt = null;
  let lastSeen = { pending: 0, queued: 0, running: 0, waiting: 0, succeeded: 0, failed: 0, canceled: 0 };

  while (Date.now() - startAt < TIMEOUT_MS) {
    const tasks = (await api('/tasks?limit=200')) ?? [];
    const mine = tasks.filter((t) => taskIds.has(t.id));
    if (mine.length === 0) break;

    const runs = (await api('/runs?limit=200')) ?? [];
    const ourRunIds = new Set(
      runs.filter((r) => mine.some((t) => t.id === r.task_id)).map((r) => r.id),
    );

    const counts = { pending: 0, queued: 0, running: 0, waiting: 0, succeeded: 0, failed: 0, canceled: 0 };
    for (const task of mine) {
      if (task.status === 'waiting_approval') counts.waiting += 1;
      else if (task.status in counts) counts[task.status] += 1;
      else counts.pending += 1;
    }
    lastSeen = counts;
    samples.push({ t: Date.now() - startAt, ...counts, backlog: counts.pending + counts.queued });

    if (counts.waiting > 0) {
      approvedTotal += await approveFor(ourRunIds);
    }

    const terminal = mine.filter((t) => TASK_TERMINAL.has(t.status)).length;
    if (terminal >= mine.length) {
      allDoneAt = Date.now();
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  if (allDoneAt === null) allDoneAt = Date.now();
  const totalMs = allDoneAt - startAt;

  const runs = (await api('/runs?limit=200')) ?? [];
  const tasks = (await api('/tasks?limit=200')) ?? [];
  const mineTasks = tasks.filter((t) => taskIds.has(t.id));
  const ourRuns = runs.filter((r) => mineTasks.some((t) => t.id === r.task_id));

  const succeeded = ourRuns.filter((r) => r.status === 'succeeded').length;
  const failed = ourRuns.filter((r) => r.status === 'failed').length;
  const wall = ourRuns
    .filter((r) => r.started_at && r.finished_at)
    .map((r) => (new Date(r.finished_at) - new Date(r.started_at)) / 1000);
  const activeList = await activeDurations(ourRuns.map((r) => r.id));
  const peakBacklog = Math.max(0, ...samples.map((s) => s.backlog));

  const result = {
    label: LABEL,
    workflow: WORKFLOW,
    tasks: created.length,
    assigned_at_create: assignedAtCreate,
    runs_total: ourRuns.length,
    succeeded,
    failed,
    create_ms: createMs,
    create_rate_per_sec: Number((created.length / (createMs / 1000)).toFixed(2)),
    total_ms: totalMs,
    throughput_per_sec: Number((ourRuns.length / (totalMs / 1000)).toFixed(2)),
    wall_p50_s: Number(percentile(wall, 0.5).toFixed(2)),
    wall_p95_s: Number(percentile(wall, 0.95).toFixed(2)),
    active_p50_s: Number(percentile(activeList, 0.5).toFixed(3)),
    active_p95_s: Number(percentile(activeList, 0.95).toFixed(3)),
    peak_backlog: peakBacklog,
    approvals_auto: approvedTotal,
    samples: samples.length,
    final: lastSeen,
    at: new Date().toISOString(),
  };

  console.log('\n结果：');
  console.log(`  运行总数：${result.runs_total}（创建时即时分配 ${assignedAtCreate}）`);
  console.log(`  成功 / 失败：${succeeded} / ${failed}`);
  console.log(`  总耗时：${(totalMs / 1000).toFixed(1)}s，吞吐 ${result.throughput_per_sec} 个/秒`);
  console.log(`  端到端 P50/P95：${result.wall_p50_s}s / ${result.wall_p95_s}s`);
  console.log(`  执行耗时 P50/P95（本轮）：${result.active_p50_s}s / ${result.active_p95_s}s`);
  console.log(`  队列积压峰值：${peakBacklog}`);
  console.log(`  自动批准：${approvedTotal} 次`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `load-test-${LABEL.replace(/[^\w\u4e00-\u9fa5]+/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify(result, null, 2), 'utf8');
  console.log(`\n结果已写入 ${file}`);
}

main().catch((err) => {
  console.error('压测失败：', err.message);
  process.exit(1);
});
