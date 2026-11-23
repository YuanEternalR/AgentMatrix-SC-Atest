/**
 * 工作台外壳冒烟测试（浏览器模式）
 *
 * 为什么不测 Electron：Electron 的自动化要单独配 STDOUT/入口，而两种模式跑的是
 * **同一份 renderer 代码**，只是 IPC 换成了 HTTP。测浏览器模式 = 测渲染层，
 * 剩下"Electron 能不能起窗"由 start.cmd 手工确认（文档里也写了）。
 *
 * 覆盖：
 *   ① 场景标签数量与切换（含 4 个场景各自的面板标题）
 *   ② 面板 iframe 已注入登录态（不出现登录框）
 *   ③ 场景记忆读到文件内容、且保存按钮可用
 *   ④ 场景助手能拿到真实快照并返回结论（含 Token/成本）
 *   ⑤ 没有前端运行时错误
 *
 * 用法：node tests/e2e/shell.mjs
 * 会自动拉起 `agentmatrix-shell/server.js`（若 4180 未监听），跑完关掉。
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const SHELL_DIR = path.join(REPO, 'agentmatrix-shell');
const SHELL_URL = process.env.SHELL_URL ?? 'http://127.0.0.1:4180';
const API = process.env.API_URL ?? 'http://127.0.0.1:8000';
const ARTIFACT_DIR = path.join(HERE, 'artifacts');

const CANDIDATES = [
  process.env.EDGE_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/microsoft-edge',
  '/usr/bin/google-chrome',
].filter(Boolean);

function resolveBrowser() {
  return CANDIDATES.find((candidate) => fs.existsSync(candidate)) ?? null;
}

async function waitFor(url, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
      last = `HTTP ${res.status}`;
    } catch (err) {
      last = err.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  throw new Error(`${label} 未就绪：${last}`);
}

let stepIndex = 0;
let failures = 0;

async function step(name, fn) {
  stepIndex += 1;
  try {
    await fn();
    console.log(`  ✅ ${String(stepIndex).padStart(2, '0')} ${name}`);
  } catch (err) {
    failures += 1;
    console.log(`  ❌ ${String(stepIndex).padStart(2, '0')} ${name}\n     ${err.message}`);
    throw err;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const executablePath = resolveBrowser();
  if (!executablePath) {
    console.error('找不到 Chromium 内核浏览器，请设置 EDGE_PATH');
    process.exit(2);
  }

  await waitFor(`${API}/health`, 45000, 'AgentMatrix 后端');

  let shellProc = null;
  try {
    await waitFor(`${SHELL_URL}/api/shell/health`, 1500, '工作台外壳');
  } catch {
    console.log('   · 4180 未监听，自动启动 server.js');
    shellProc = spawn(process.execPath, ['server.js'], {
      cwd: SHELL_DIR,
      stdio: 'ignore',
      windowsHide: true,
    });
    await waitFor(`${SHELL_URL}/api/shell/health`, 20000, '工作台外壳');
  }

  const browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1500, height: 960 } });
  // 清掉上次运行的记忆（外壳会把"最后打开的场景"和标签顺序存 localStorage），
  // 否则断言会依赖上一次手工操作留下的状态。
  await context.addInitScript(() => window.localStorage.clear());
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  try {
    await step('打开外壳并渲染场景标签', async () => {
      await page.goto(SHELL_URL, { waitUntil: 'networkidle' });
      await page.waitForSelector('.tab', { timeout: 15000 });
      const tabs = await page.locator('.tab').count();
      assert(tabs >= 4, `场景标签只有 ${tabs} 个，至少要 4 个`);
    });

    await step('默认场景面板齐全', async () => {
      await page.waitForSelector('.panel', { timeout: 15000 });
      const panels = await page.locator('.panel').count();
      assert(panels >= 4, `面板只有 ${panels} 个`);
      const titles = await page.locator('.panel-title').allInnerTexts();
      for (const expected of ['场景快照', '工作台', '场景记忆', '场景助手']) {
        assert(titles.includes(expected), `缺少面板「${expected}」，实际：${titles.join('/')}`);
      }
      console.log(`     面板：${titles.join(' · ')}`);
    });

    await step('面板 iframe 已注入登录态', async () => {
      const frame = page.locator('iframe').first();
      const handle = await frame.elementHandle();
      const contentFrame = await handle.contentFrame();
      assert(contentFrame, 'iframe 没有内容帧');
      await contentFrame.waitForSelector('button:has-text("发起任务")', { timeout: 20000 });
      const body = await contentFrame.locator('body').innerText();
      assert(!body.includes('邮箱或密码错误'), 'iframe 里出现了登录错误');
    });

    await step('场景记忆读到文件内容', async () => {
      await page.waitForSelector('.memory-area', { timeout: 10000 });
      const text = await page.locator('.memory-area').inputValue();
      assert(text.includes('§〇 当前交接'), `记忆内容不对：${text.slice(0, 80)}`);
      const foot = await page.locator('.memory-foot').first().innerText();
      assert(/\d+ \/ 4096 字节/.test(foot), `记忆没有字节计数：${foot}`);
    });

    await step('切换场景（顶部标签）', async () => {
      await page.locator('.tab', { hasText: '交付追踪' }).click();
      await page.waitForTimeout(1200);
      const titles = await page.locator('.panel-title').allInnerTexts();
      for (const expected of ['运行监控', '审计日志']) {
        assert(titles.includes(expected), `切场景后缺少「${expected}」，实际：${titles.join('/')}`);
      }
      const status = await page.locator('#status-left').innerText();
      assert(status.includes('交付追踪'), `状态栏没跟着切：${status}`);
    });

    await step('场景助手：真实快照 + 模型结论', async () => {
      const active = await page.locator('.tab.active').innerText();
      if (!active.includes('交付追踪')) {
        await page.locator('.tab', { hasText: '交付追踪' }).click();
        await page.waitForTimeout(1000);
      }
      const input = page.locator('.chat-input textarea').first();
      await input.fill('用一句话说，这个场景现在最该处理什么？');
      await page.locator('.chat-input button', { hasText: '发送' }).first().click();

      await page.waitForSelector('.msg.assistant', { timeout: 90000 });
      const answer = await page.locator('.msg.assistant').first().innerText();
      assert(answer.trim().length > 10, `结论过短：${answer}`);

      const meta = await page.locator('.msg.meta').first().innerText();
      assert(/tokens/.test(meta), `没有 Token 计量：${meta}`);
      console.log(`     结论 ${answer.trim().slice(0, 40)}… ｜ ${meta}`);
    });

    await step('无前端运行时错误', async () => {
      assert(pageErrors.length === 0, `页面报错：${pageErrors.slice(0, 2).join(' | ')}`);
    });

    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'shell-browser.png'), fullPage: false });
    console.log(`\n截图：${path.join(ARTIFACT_DIR, 'shell-browser.png')}`);
  } finally {
    await browser.close();
    if (shellProc) shellProc.kill();
  }

  console.log(failures === 0 ? '\n工作台外壳冒烟全部通过' : `\n失败 ${failures} 项`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`\n冒烟失败：${err.message}`);
  process.exit(1);
});
