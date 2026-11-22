/**
 * AgentMatrix-SC 端到端测试（真实浏览器，走完整 UI）。
 *
 * 覆盖：登录 → 发起任务 → 查看调度决策 → 运行详情 → 审批 → 运行成功 → 矩阵/告警页
 *
 * 为什么用 playwright-core + 系统已装浏览器：
 * 本项目所在网络下载 Chromium 很慢/不可达，而 Edge 是 Windows 自带。
 * 如需换浏览器，设置环境变量 EDGE_PATH 指向任意 Chromium 内核可执行文件即可。
 *
 * 用法：
 *   npm run e2e
 *   或 node tests/e2e/e2e.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5173';
const API = process.env.API_URL ?? 'http://127.0.0.1:8000';
const EMAIL = process.env.E2E_EMAIL ?? 'ops@agentmatrix.local';
const PASSWORD = process.env.E2E_PASSWORD ?? 'AgentMatrix@2026';
const STEP_TIMEOUT = Number(process.env.E2E_TIMEOUT ?? 30000);
const HEALTH_TIMEOUT = Number(process.env.E2E_HEALTH_TIMEOUT ?? 45);
const MAX_ATTEMPTS = Number(process.env.E2E_ATTEMPTS ?? 2);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACT_DIR = path.join(HERE, 'artifacts');

const CANDIDATES = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/microsoft-edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

function resolveBrowser() {
  for (const candidate of CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

let failures = 0;
let index = 0;

function log(message) {
  console.log(message);
}

async function step(name, fn) {
  index += 1;
  const label = `${String(index).padStart(2, '0')} ${name}`;
  try {
    await fn();
    console.log(`  ✅ ${label}`);
  } catch (err) {
    failures += 1;
    console.log(`  ❌ ${label}`);
    console.log(`     ${err.message}`);
    throw err;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/** 轮询某个元素的文本是否包含期望值 */
async function waitForText(page, selector, expected, timeout = STEP_TIMEOUT) {
  const deadline = Date.now() + timeout;
  let last = '';
  while (Date.now() < deadline) {
    last = (await page.locator(selector).first().innerText().catch(() => '')) || '';
    if (last.includes(expected)) return true;
    await page.waitForTimeout(400);
  }
  throw new Error(`等待「${selector}」出现「${expected}」超时，当前为「${last.trim()}」`);
}

/**
 * 前置健康检查。
 *
 * 容器冷启动或 WSL 回收期间，UI 会正常渲染但接口 502/超时，表现为"随机超时"。
 * 先在这里把环境问题拦下来，避免和真正的用例失败混在一起。
 */
async function waitForBackend() {
  const deadline = Date.now() + HEALTH_TIMEOUT * 1000;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${API}/health`);
      if (res.ok) {
        const body = await res.json();
        if (body.status === 'ok') return;
        last = JSON.stringify(body.checks ?? body);
      } else {
        last = `HTTP ${res.status}`;
      }
    } catch (err) {
      last = err.message;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(
    `后端在 ${HEALTH_TIMEOUT}s 内未就绪（${API}/health：${last}）。请先执行 dev up 并确认 dev ps 全是 healthy。`,
  );
}

async function runScenario(page, orderId, pageErrors) {
  await step('打开登录页', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: STEP_TIMEOUT });
    await page.waitForSelector('[data-testid=login-email]', { timeout: STEP_TIMEOUT });
  });

  await step('登录并进入工作台', async () => {
    await page.fill('[data-testid=login-email]', EMAIL);
    await page.fill('[data-testid=login-password]', PASSWORD);
    await page.click('[data-testid=login-submit]');
    await page.waitForSelector('[data-testid=create-task]', { timeout: STEP_TIMEOUT });
  });

  await step('发起任务', async () => {
    await page.fill('[data-testid=order-id]', orderId);
    await page.fill('[data-testid=order-quantity]', '420');
    await page.click('[data-testid=create-task]');
    await page.waitForURL(/\/tasks\//, { timeout: STEP_TIMEOUT });
  });

  await step('任务详情显示调度决策', async () => {
    await page.waitForSelector('[data-testid=decision-agent]', { timeout: STEP_TIMEOUT });
    const agent = (await page.locator('[data-testid=decision-agent]').innerText()).trim();
    const strategy = (await page.locator('[data-testid=decision-strategy]').innerText()).trim();
    assert(agent.length > 0 && agent !== '未分配', `未分配智能体（agent=「${agent}」）`);
    assert(strategy.startsWith('s'), `策略异常：${strategy}`);
    log(`     派给 ${agent}（${strategy}）· 订单 ${orderId}`);
  });

  await step('进入运行详情并等待审批', async () => {
    await page.click('button:has-text("查看运行")');
    await page.waitForSelector('[data-testid=run-status]', { timeout: STEP_TIMEOUT });
    await waitForText(page, '[data-testid=run-status]', '待审批');
  });

  await step('审批通过后运行成功', async () => {
    const stepsBefore = await page.locator('.step').count();
    assert(stepsBefore >= 5, `步骤数过少：${stepsBefore}`);
    await page.click('[data-testid=approve-button]');
    await waitForText(page, '[data-testid=run-status]', '成功');
    const stepsAfter = await page.locator('.step').count();
    assert(stepsAfter > stepsBefore, `审批后步骤未增加（${stepsBefore} → ${stepsAfter}）`);
    log(`     步骤 ${stepsBefore} → ${stepsAfter}`);
  });

  await step('工作流图渲染', async () => {
    const nodes = await page.locator('.dag-svg g[transform]').count();
    assert(nodes >= 5, `工作流图节点过少：${nodes}`);
    log(`     图中节点 ${nodes} 个`);
  });

  await step('智能体矩阵页', async () => {
    await page.click('a[href="/matrix"]');
    await page.waitForSelector('text=智能体矩阵', { timeout: STEP_TIMEOUT });
    const cells = await page.locator('.matrix-cell.covered').count();
    assert(cells > 0, '矩阵没有已覆盖的格子');
    log(`     已覆盖格子 ${cells} 个`);
  });

  await step('告警页', async () => {
    await page.click('a[href="/alerts"]');
    await page.waitForSelector('text=告警规则', { timeout: STEP_TIMEOUT });
    // 标题先渲染，规则是异步加载的：等真实行出现再断言
    await page.waitForSelector('table tbody tr', { timeout: STEP_TIMEOUT });
    const rules = await page.locator('table tbody tr').count();
    assert(rules > 0, '告警规则为空');
    log(`     规则/事件行 ${rules} 行`);
  });

  await step('无前端运行时错误', async () => {
    assert(pageErrors.length === 0, `页面报错：${pageErrors.slice(0, 3).join(' | ')}`);
  });
}

async function main() {
  const executablePath = resolveBrowser();
  if (!executablePath) {
    console.error('找不到 Chromium 内核浏览器。请设置 EDGE_PATH 环境变量指向可执行文件。');
    process.exit(2);
  }
  log(`浏览器：${executablePath}`);
  log(`目标：${BASE}\n`);

  try {
    await waitForBackend();
  } catch (err) {
    console.error(`环境未就绪：${err.message}`);
    process.exit(3);
  }

  const browser = await chromium.launch({ executablePath, headless: true });
  let lastError = null;

  // 开发服务器（Vite）在文件变更后会有一次性重编译抖动，允许整轮重试一次。
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    if (attempt > 1) {
      log(`\n首次失败，重试一次（原因：${lastError?.message ?? '未知'}）\n`);
      failures = 0;
      index = 0;
    }

    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    const orderId = `E2E-${Date.now().toString().slice(-8)}`;

    try {
      await runScenario(page, orderId, pageErrors);
      lastError = null;
      await page.close();
      break;
    } catch (err) {
      lastError = err;
      fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
      const shot = path.join(ARTIFACT_DIR, `failure-${Date.now()}-attempt${attempt}.png`);
      await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
      log(`\n失败截图：${shot}`);
      await page.close();
    }
  }

  await browser.close();

  console.log('');
  if (lastError) {
    console.log(`端到端测试失败：${lastError.message}`);
    process.exit(1);
  }
  console.log('端到端测试全部通过');
  process.exit(0);
}
main().catch((err) => {
  console.error('测试异常：', err.message);
  process.exit(1);
});
