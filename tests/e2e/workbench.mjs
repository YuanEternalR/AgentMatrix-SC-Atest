/**
 * 工作台原生面板回归（Electron + CDP）
 *
 * 守的是什么：**面板必须自己完成功能，不许把浏览器页面嵌进来充数。**
 * 上一版用 `embed` 面板套我们的网页，被用户否掉；这条测试明确断言每个面板里
 * 没有 <webview> / <iframe>，同时又真的有数据（正文长度、关键列都在）。
 *
 * 另外覆盖：四个场景都能切、面板有真实内容、助手能拿到回答、没有渲染层报错。
 *
 * 用法：node tests/e2e/workbench.mjs
 * 会自己拉起 Electron（需先 `dev up` 起平台），跑完关掉。
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const SHELL_DIR = path.join(REPO, 'agentmatrix-workbench', '外壳');
const ELECTRON = path.join(SHELL_DIR, 'node_modules', 'electron', 'dist', 'electron.exe');
const API = process.env.API_URL ?? 'http://127.0.0.1:8000';
const DEBUG_PORT = Number(process.env.AM_DEBUG_PORT_TEST ?? 9233);
const ARTIFACT_DIR = path.join(HERE, 'artifacts');

let stepIndex = 0;
let failures = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

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

async function waitFor(url, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json().catch(() => ({}));
      last = `HTTP ${res.status}`;
    } catch (err) {
      last = err.message;
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  throw new Error(`${label} 未就绪：${last}`);
}

async function main() {
  if (!fs.existsSync(ELECTRON)) {
    console.error('找不到 Electron 运行时，先在 agentmatrix-workbench/外壳 里 npm install');
    process.exit(2);
  }
  await waitFor(`${API.replace(/\/api\/v1$/, '')}/health`, 45000, 'AgentMatrix 后端');

  console.log('   · 启动工作台（复用本机 DSH，--remote-debugging-port=' + DEBUG_PORT + '）');
  const env = { ...process.env, AM_DEBUG_PORT: String(DEBUG_PORT), DSH_PORT: process.env.DSH_PORT || '58360' };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(ELECTRON, ['.', `--remote-debugging-port=${DEBUG_PORT}`], {
    cwd: SHELL_DIR,
    env,
    stdio: 'ignore',
    windowsHide: true,
  });

  let browser = null;
  try {
    await waitFor(`http://127.0.0.1:${DEBUG_PORT}/json/version`, 40000, 'Electron 调试端口');
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${DEBUG_PORT}`);
    const page = browser.contexts()[0].pages()[0];
    await page.bringToFront().catch(() => {});
    await page.waitForSelector('.tab', { timeout: 30000 });

    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await step('四个场景标签都在', async () => {
      const labels = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.tab-label')).map((n) => n.textContent.trim()),
      );
      for (const name of ['工作台总览', '能力矩阵', '交付追踪', '治理与策略']) {
        assert(labels.includes(name), `缺少场景「${name}」，实际：${labels.join('/')}`);
      }
    });

    const SCENES = [
      { name: '工作台总览', expect: ['场景快照', '任务', '场景助手'], minLen: 200 },
      { name: '能力矩阵', expect: ['能力矩阵', '场景助手'], minLen: 200 },
      { name: '交付追踪', expect: ['运行监控', '场景助手'], minLen: 200 },
      { name: '治理与策略', expect: ['审计日志', '场景助手'], minLen: 200 },
    ];

    for (const scene of SCENES) {
      await step(`场景「${scene.name}」面板是原生实现且有数据`, async () => {
        await page.evaluate((name) => {
          const label = Array.from(document.querySelectorAll('.tab-label')).find((n) =>
            n.textContent.includes(name),
          );
          (label?.closest('.tab') || label?.parentElement)?.click();
        }, scene.name);
        await page.waitForTimeout(4200);

        const info = await page.evaluate(() =>
          Array.from(document.querySelectorAll('.panel')).map((panel) => ({
            title: panel.querySelector('.panel-title')?.textContent ?? '',
            type: panel.dataset.panel ?? '',
            text: panel.querySelector('.panel-body')?.innerText ?? '',
            media: panel.querySelectorAll('webview, iframe').length,
          })),
        );

        assert(info.length >= 2, `面板只有 ${info.length} 个`);
        for (const panel of info) {
          assert(
            panel.media === 0,
            `面板「${panel.title}」里嵌了 ${panel.media} 个 webview/iframe——面板必须自己完成功能`,
          );
        }
        for (const title of scene.expect) {
          assert(info.some((p) => p.title === title), `缺少面板「${title}」`);
        }
        const total = info.reduce((sum, p) => sum + p.text.length, 0);
        assert(total >= scene.minLen, `面板内容过少（${total} 字），可能没取到数据`);
      });
    }

    await step('场景助手真的回答（真实模型）', async () => {
      const panel = page.locator('.panel', { has: page.locator('.panel-title', { hasText: '场景助手' }) }).first();
      const hint = panel.locator('.am-hint').first();
      await hint.click();
      await panel.locator('.am-msg.assistant').first().waitFor({ timeout: 120000 });
      const answer = await panel.locator('.am-msg.assistant').first().innerText();
      assert(answer.trim().length > 20, `回答过短：${answer}`);
      const meta = await panel.locator('.am-msg.meta').first().innerText();
      assert(/tokens/.test(meta), `没有 token 计量：${meta}`);
      console.log(`     结论 ${answer.trim().slice(0, 36).replace(/\n/g, ' ')}… ｜ ${meta}`);
    });

    await step('无渲染层报错', async () => {
      assert(pageErrors.length === 0, `页面报错：${pageErrors.slice(0, 2).join(' | ')}`);
    });

    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'workbench-native.png') });
    console.log(`\n截图：${path.join(ARTIFACT_DIR, 'workbench-native.png')}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    child.kill();
  }

  console.log(failures === 0 ? '\n工作台原生面板回归全部通过' : `\n失败 ${failures} 项`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(`\n回归失败：${err.message}`);
  process.exit(1);
});
