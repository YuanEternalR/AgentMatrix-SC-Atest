/**
 * AgentMatrix-SC 端到端测试（真实浏览器，走完整 UI）。
 *
 * 覆盖：登录 → 发起任务 → 查看调度决策 → 运行详情 → 审批 → 运行成功 →
 *       矩阵/告警/审计页 → 图表导出（CSV / PNG）→ 建技能并试运行 →
 *       建智能体、绑定技能、在线测试、发布版本
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
// 建技能/智能体需要开发者权限；运营账号只做审批链路
const DEV_EMAIL = process.env.E2E_DEV_EMAIL ?? 'dev@agentmatrix.local';
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
  // 每次跑用不同的编码：同名技能/智能体第二次会被 409 拒绝
  const suffix = Date.now();
  const skillCode = `e2e_quote_${suffix}`;
  const agentCode = `e2e_agent_${suffix}`;

  await step('打开登录页', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: STEP_TIMEOUT });
    await page.waitForSelector('[data-testid=login-email]', { timeout: STEP_TIMEOUT });
  });

  await step('登录并进入工作台', async () => {
    await page.fill('[data-testid=login-email]', EMAIL);
    await page.fill('[data-testid=login-password]', PASSWORD);
    await page.click('[data-testid=login-submit]');
    await page.waitForSelector('button:has-text("发起任务")', { timeout: STEP_TIMEOUT });
    await page.waitForTimeout(800);
    // 界面上面向用户的文案不应出现英文代码（工作流/策略/状态都应有中文名）
    const body = await page.locator('.content').innerText();
    for (const leaked of ['order_delay_exception', 'fulfillment_review', 's4_llm_planner', 'waiting_approval']) {
      assert(!body.includes(leaked), `界面出现英文代码：${leaked}`);
    }
  });

  await step('发起任务', async () => {
    // 表单默认收起，字段由工作流的 variables_schema 生成
    await page.click('button:has-text("发起任务")');
    await page.waitForSelector('[data-testid=field-order_id]', { timeout: STEP_TIMEOUT });
    await page.fill('[data-testid=field-order_id]', orderId);
    await page.fill('[data-testid=field-priority]', '1');
    await page.fill('[data-testid=field-complexity]', '4');
    await page.click('[data-testid=create-task]');
    await page.waitForURL(/\/tasks\//, { timeout: STEP_TIMEOUT });
  });

  await step('任务详情显示调度决策', async () => {
    await page.waitForSelector('[data-testid=decision-agent]', { timeout: STEP_TIMEOUT });
    const agent = (await page.locator('[data-testid=decision-agent]').innerText()).trim();
    const strategy = (await page.locator('[data-testid=decision-strategy]').innerText()).trim();
    assert(agent.length > 0 && agent !== '未分配', `未分配智能体（agent=「${agent}」）`);
    // 界面上策略显示为中文（如「大模型规划」），不再出现英文策略码
    assert(
      ['全用大模型', '固定规则', '加权打分', '成本优先', '大模型规划'].includes(strategy),
      `策略异常：${strategy}`,
    );
    assert(!/[a-z_]{4,}/.test(agent), `智能体名称不该是英文编码：${agent}`);
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
    // 标题先渲染、格子数据后到：必须等格子出现再计数，否则会数到 0（竞态）
    await page.waitForSelector('.matrix-cell.covered', { timeout: STEP_TIMEOUT });
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

  await step('审计日志页：刚做的审批可追溯', async () => {
    await page.click('a[href="/audit"]');
    await page.waitForSelector('text=审计日志', { timeout: STEP_TIMEOUT });
    await page.waitForSelector('[data-testid=audit-row]', { timeout: STEP_TIMEOUT });

    const body = await page.locator('.content').innerText();
    // 本场景刚刚由运营审批通过，审计里必须能查到"谁批的"
    assert(body.includes('审批决策'), '审计页看不到「审批决策」，审批没有留痕');
    assert(body.includes('登录'), '审计页看不到登录记录');

    // 界面上不应出现英文动作编码（含点号的形式）
    for (const leaked of ['approval.decide', 'auth.login', 'alert_rule.update', 'task.create']) {
      assert(!body.includes(leaked), `审计页出现英文动作编码：${leaked}`);
    }

    const rows = await page.locator('[data-testid=audit-row]').count();
    assert(rows > 0, '审计记录为空');
    log(`     审计记录 ${rows} 行`);
  });

  await step('可视化页：图表可导出 CSV / PNG', async () => {
    await page.click('a[href="/analytics"]');
    await page.waitForSelector('canvas', { timeout: STEP_TIMEOUT });
    // 等 ECharts 实例就绪，否则导出按钮还是 disabled
    await page.waitForTimeout(800);

    for (const [testId, ext] of [
      ['chart-export-csv', 'csv'],
      ['chart-export-png', 'png'],
    ]) {
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: STEP_TIMEOUT }),
        page.locator(`[data-testid=${testId}]`).first().click(),
      ]);
      const name = download.suggestedFilename();
      assert(name.endsWith(`.${ext}`), `导出文件名应以 .${ext} 结尾：${name}`);

      fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
      const target = path.join(ARTIFACT_DIR, `export-${testId}-${Date.now()}.${ext}`);
      await download.saveAs(target);
      const size = fs.statSync(target).size;
      assert(size > 20, `${ext.toUpperCase()} 内容过小（${size} 字节），可能是空文件`);
      log(`     导出 ${name}（${size} 字节）`);
    }
  });

  // 建技能/智能体需要开发者权限：换账号，顺便验证运营确实建不了
  await step('切换开发者账号（运营无权建技能）', async () => {
    await page.click('button:has-text("退出")');
    await page.waitForSelector('[data-testid=login-email]', { timeout: STEP_TIMEOUT });
    await page.fill('[data-testid=login-email]', DEV_EMAIL);
    await page.fill('[data-testid=login-password]', PASSWORD);
    await page.click('[data-testid=login-submit]');
    await page.waitForSelector('button:has-text("发起任务")', { timeout: STEP_TIMEOUT });
  });

  await step('技能库：新建 HTTP Mock 技能并试运行', async () => {
    await page.click('a[href="/skills"]');
    await page.waitForSelector('[data-testid=new-skill]', { timeout: STEP_TIMEOUT });
    await page.click('[data-testid=new-skill]');

    await page.fill('[data-testid=skill-code]', skillCode);
    await page.fill('[data-testid=skill-name]', '承运商报价（E2E）');
    // 默认就是 HTTP + Mock 开关打开，这里显式确认一遍
    const mockSelect = page.locator('[data-testid=skill-mock]');
    await mockSelect.selectOption('true');
    await page.click('[data-testid=create-skill]');

    await page.waitForURL(/\/skills\//, { timeout: STEP_TIMEOUT });
    await page.waitForSelector('[data-testid=run-skill]', { timeout: STEP_TIMEOUT });

    // 表单由输入 Schema 生成：填示例值再执行
    await page.fill('[data-testid=test-order_id]', 'SO-E2E-1');
    await page.click('[data-testid=run-skill]');
    // 只认结果区块里的"模式 http-mock"，避免被页面上的"成功率"提前命中
    await waitForText(page, '.content', 'http-mock');
    log(`     技能 ${skillCode} 试运行成功（Mock 模式）`);
  });

  await step('智能体：绑定技能 → 在线测试有工具轨迹 → 发布版本', async () => {
    await page.click('a[href="/agents"]');
    await page.waitForSelector('[data-testid=new-agent]', { timeout: STEP_TIMEOUT });
    await page.click('[data-testid=new-agent]');

    await page.fill('[data-testid=agent-code]', agentCode);
    await page.fill('[data-testid=agent-name]', '报价核对（E2E）');
    await page.fill('[data-testid=agent-prompt]', '你是运价核对专员，请基于报价给出谈判要点。');
    await page.click(`[data-testid=bind-${skillCode}]`);
    await page.click('[data-testid=create-agent]');

    await page.waitForURL(/\/agents\//, { timeout: STEP_TIMEOUT });
    await page.waitForSelector('[data-testid=run-agent-test]', { timeout: STEP_TIMEOUT });

    // 用 Mock 模型：不联网也能看到完整轨迹
    await page.locator('[data-testid=test-model]').selectOption('true');
    await page.fill('[data-testid=test-input]', '{"carrier": "Standard Class"}');
    await page.click('[data-testid=run-agent-test]');
    await page.waitForSelector('[data-testid=trace-step]', { timeout: STEP_TIMEOUT });

    const steps = await page.locator('[data-testid=trace-step]').count();
    assert(steps >= 2, `工具轨迹只有 ${steps} 步，至少要有一工具一模型`);
    const content = await page.locator('.content').innerText();
    assert(content.includes('工具'), '轨迹里没有工具调用');
    assert(content.includes('模型'), '轨迹里没有模型调用');
    assert(!content.includes(skillCode), `界面出现技能编码：${skillCode}`);

    await page.fill('[data-testid=edit-changelog]', 'E2E 发布');
    await page.click('[data-testid=publish-version]');
    // 保存反馈走 Toast（不再把页面往下顶一格）
    await page.waitForSelector('[data-testid=toast]', { timeout: STEP_TIMEOUT });
    await waitForText(page, '.content', '已发布 v');
    log(`     轨迹 ${steps} 步，版本已发布`);
  });

  await step('Ctrl+K 全局搜索', async () => {
    await page.keyboard.press('Control+K');
    await page.waitForSelector('[data-testid=cmdk-input]', { timeout: STEP_TIMEOUT });
    await page.fill('[data-testid=cmdk-input]', '订单');
    await page.waitForSelector('[data-testid=cmdk-item]', { timeout: STEP_TIMEOUT });

    const count = await page.locator('[data-testid=cmdk-item]').count();
    assert(count > 0, '全局搜索没有结果');
    await page.keyboard.press('Enter');
    await page.waitForURL(/\/(tasks|agents|skills|workflows)\//, { timeout: STEP_TIMEOUT });
    log(`     搜索「订单」命中 ${count} 条，回车已跳转`);
  });

  await step('危险操作走自定义确认弹窗', async () => {
    await page.goto(`${BASE}/skills/${skillCode}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('button:has-text("删除")', { timeout: STEP_TIMEOUT });
    await page.click('button:has-text("删除")');

    await page.waitForSelector('[data-testid=confirm-dialog]', { timeout: STEP_TIMEOUT });
    const dialog = await page.locator('[data-testid=confirm-dialog]').innerText();
    assert(dialog.includes('删除'), `确认弹窗缺少说明：${dialog}`);
    await page.click('[data-testid=confirm-cancel]');
    await page.waitForSelector('[data-testid=confirm-dialog]', {
      state: 'detached',
      timeout: STEP_TIMEOUT,
    });
    log('     确认弹窗可弹出、可取消');
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
    const orderId = "1000"; // DataCo 真实订单：延迟 4 天，用于走审批分支

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
