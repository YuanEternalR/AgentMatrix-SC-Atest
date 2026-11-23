/**
 * 路由冒烟：逐个打开所有页面，断言「没有前端运行时错误」且「主内容不是空白」。
 *
 * 为什么单独一个脚本：`e2e.mjs` 走的是业务主线（登录→任务→审批→审计→建技能→测试→导出），
 * 页面一多就必然有漏网的。2026-11-23 就出现过这种情况——调度策略页因为一个
 * useMemo 写在提前 return 之后，数据一到就抛 "Rendered more hooks than during
 * the previous render"，整页白屏，而 E2E 全程没打开过那个页面。
 *
 * 用法：node tests/e2e/routes.mjs
 * 退出码：0 全部通过；1 有路由报错或空白；2 找不到浏览器；3 后端未就绪
 */

import fs from 'node:fs';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5173';
const API = process.env.API_URL ?? 'http://127.0.0.1:8000';
const EMAIL = process.env.E2E_EMAIL ?? 'dev@agentmatrix.local';
const PASSWORD = process.env.E2E_PASSWORD ?? 'AgentMatrix@2026';

const CANDIDATES = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/microsoft-edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

function resolveBrowser() {
  return CANDIDATES.find((candidate) => fs.existsSync(candidate)) ?? null;
}

/** 从接口拿真实编号，详情页才有得测；拿不到就跳过对应路由而不是误报 */
async function sampleIds() {
  const login = await fetch(`${API}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: EMAIL, password: PASSWORD }),
  });
  if (!login.ok) throw new Error(`登录失败：HTTP ${login.status}`);
  const { access_token: token } = await login.json();
  const headers = { Authorization: `Bearer ${token}` };

  const get = async (path) => {
    const res = await fetch(`${API}/api/v1${path}`, { headers });
    if (!res.ok) return [];
    const body = await res.json();
    return Array.isArray(body) ? body : [];
  };

  const [agents, skills, runs, tasks, workflows] = await Promise.all([
    get('/agents'),
    get('/skills'),
    get('/runs'),
    get('/tasks?limit=1'),
    get('/workflows'),
  ]);

  return {
    agent: agents[0]?.code,
    skill: skills[0]?.code,
    run: runs[0]?.id,
    task: tasks[0]?.id,
    workflow: workflows[0]?.code,
  };
}

async function main() {
  const executablePath = resolveBrowser();
  if (!executablePath) {
    console.error('找不到 Chromium 内核浏览器，请设置 EDGE_PATH');
    process.exit(2);
  }

  try {
    const health = await fetch(`${API}/health`);
    if (!health.ok) throw new Error(`HTTP ${health.status}`);
  } catch (err) {
    console.error(`后端未就绪：${err.message}`);
    process.exit(3);
  }

  const ids = await sampleIds();

  const routes = [
    { path: '/', label: '工作台', expect: '任务' },
    { path: '/matrix', label: '智能体矩阵', expect: '矩阵' },
    { path: '/guide', label: '设计指南', expect: '技能' },
    { path: '/agents', label: '智能体列表', expect: '智能体' },
    { path: '/skills', label: '技能库', expect: '技能' },
    { path: '/workflows', label: '工作流列表', expect: '工作流' },
    { path: '/runs', label: '运行监控', expect: '运行' },
    { path: '/monitor', label: '仪表盘', expect: '运行总数' },
    { path: '/analytics', label: '可视化', expect: '拓扑' },
    { path: '/dead-letters', label: '死信队列', expect: '死信' },
    { path: '/alerts', label: '告警', expect: '告警' },
    { path: '/audit', label: '审计日志', expect: '审计' },
    { path: '/settings/dispatch', label: '调度策略', expect: '策略' },
  ];

  if (ids.agent) routes.push({ path: `/agents/${ids.agent}`, label: '智能体详情', expect: '提示词' });
  if (ids.skill) routes.push({ path: `/skills/${ids.skill}`, label: '技能详情', expect: '试运行' });
  if (ids.run) routes.push({ path: `/runs/${ids.run}`, label: '运行详情', expect: '运行' });
  if (ids.task) routes.push({ path: `/tasks/${ids.task}`, label: '任务详情', expect: '任务' });
  if (ids.workflow) {
    // 设计器的主要文案是「设计器 / 流程画布」，不是「工作流」
    routes.push({ path: `/workflows/${ids.workflow}/design`, label: '工作流设计器', expect: '设计器' });
  }

  const browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  let errors = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.fill('[data-testid=login-email]', EMAIL);
  await page.fill('[data-testid=login-password]', PASSWORD);
  await page.click('[data-testid=login-submit]');
  await page.waitForSelector('button:has-text("发起任务")');

  let failed = 0;
  for (const route of routes) {
    errors = [];
    let problem = '';

    try {
      await page.goto(`${BASE}${route.path}`, { waitUntil: 'networkidle', timeout: 20000 });
      // 给异步数据一次落地机会：白屏 bug 往往在数据到达后才触发
      await page.waitForTimeout(700);
      const text = (await page.locator('.content').innerText().catch(() => '')) || '';

      if (errors.length > 0) {
        problem = `运行时错误：${errors[0].slice(0, 160)}`;
      } else if (text.trim().length < 10) {
        problem = '主内容为空（可能是白屏）';
      } else if (route.expect && !text.includes(route.expect)) {
        problem = `没找到预期内容「${route.expect}」`;
      }
    } catch (err) {
      problem = `打开失败：${err.message.slice(0, 160)}`;
    }

    if (problem) {
      failed += 1;
      console.log(`  ❌ ${route.path}（${route.label}）${problem}`);
    } else {
      console.log(`  ✅ ${route.path}（${route.label}）`);
    }
  }

  await browser.close();
  console.log('');
  if (failed > 0) {
    console.log(`路由冒烟失败：${failed}/${routes.length} 个页面有问题`);
    process.exit(1);
  }
  console.log(`路由冒烟全部通过（${routes.length} 个页面）`);
  process.exit(0);
}

main().catch((err) => {
  console.error(`脚本异常：${err.message}`);
  process.exit(1);
});
