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

    await step('五个场景标签都在', async () => {
      const labels = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.tab-label')).map((n) => n.textContent.trim()),
      );
      for (const name of ['工作台总览', '工作流设计', '能力矩阵', '交付追踪', '治理与策略']) {
        assert(labels.includes(name), `缺少场景「${name}」，实际：${labels.join('/')}`);
      }
    });

    const SCENES = [
      { name: '工作台总览', expect: ['场景快照', '待审批', '任务', '新建', '场景助手'], minLen: 400, needActions: true },
      { name: '工作流设计', expect: ['设计器', '场景助手'], minLen: 200, needActions: true },
      { name: '能力矩阵', expect: ['能力矩阵', '智能体', '技能库', '场景助手'], minLen: 400, needActions: true },
      { name: '交付追踪', expect: ['运行监控', '运行趋势', '死信队列'], minLen: 300, needActions: true },
      { name: '治理与策略', expect: ['调度策略', '审计日志', '工作流', '告警', '场景助手'], minLen: 400, needActions: true },
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

        if (scene.needActions) {
          const actions = await page.evaluate(() => document.querySelectorAll('.am-act').length);
          assert(actions > 0, '这个场景应该有可操作按钮（审批/试运行/重试/试算…），实际一个都没有');
        }
      });
    }

    await step('工作流设计器：画出图、能校验', async () => {
      await page.evaluate(() => {
        const label = Array.from(document.querySelectorAll('.tab-label')).find((n) => n.textContent.includes('工作流设计'));
        (label?.closest('.tab') || label?.parentElement)?.click();
      });
      await page.waitForTimeout(4500);
      const res = await page.evaluate(async () => {
        const panel = Array.from(document.querySelectorAll('.panel')).find((p) => p.querySelector('.panel-title')?.textContent === '设计器');
        if (!panel) return { err: 'no-panel' };
        const nodes = panel.querySelectorAll('.am-node').length;
        const edges = panel.querySelectorAll('.am-edge').length;
        const btn = Array.from(panel.querySelectorAll('.am-act')).find((b) => b.textContent === '校验');
        btn.click();
        await new Promise((r) => setTimeout(r, 2800));
        return { nodes, edges, result: panel.querySelector('.am-designer-result')?.innerText ?? '' };
      });
      assert(!res.err, '设计器面板没渲染出来');
      assert(res.nodes >= 5, `节点太少：${res.nodes}`);
      assert(res.edges >= 4, `连线太少：${res.edges}`);
      assert(/校验通过|错误/.test(res.result), `校验没有结果：${res.result.slice(0, 60)}`);
      console.log(`     ${res.nodes} 个节点 / ${res.edges} 条连线 · ${res.result.replace(/\n/g, ' ').slice(0, 40)}`);
    });

    await step('新建面板：真的创建一个任务', async () => {
      await page.evaluate(() => {
        const label = Array.from(document.querySelectorAll('.tab-label')).find((n) => n.textContent.includes('工作台总览'));
        (label?.closest('.tab') || label?.parentElement)?.click();
      });
      await page.waitForTimeout(4500);
      const res = await page.evaluate(async () => {
        const panel = Array.from(document.querySelectorAll('.panel')).find((p) => p.querySelector('.panel-title')?.textContent === '新建');
        if (!panel) return { err: 'no-panel' };
        const set = (k, v) => {
          const input = panel.querySelector(`[data-key="${k}"]`);
          if (input) { input.value = v; input.dispatchEvent(new Event('input', { bubbles: true })); }
        };
        set('title', `工作台自检任务 ${new Date().toISOString().slice(11, 19)}`);
        set('order_id', 'SO-20261122-0001');
        Array.from(panel.querySelectorAll('.am-act')).find((b) => b.textContent === '创建任务').click();
        await new Promise((r) => setTimeout(r, 3500));
        return { result: panel.querySelector('.am-create-result')?.innerText ?? '' };
      });
      assert(/创建成功/.test(res.result), `创建失败：${res.result.slice(0, 120)}`);
      console.log(`     ${res.result.replace(/\n/g, ' ').slice(0, 50)}`);
    });

    await step('表格与图表都有导出入口', async () => {
      const counts = await page.evaluate(() => ({
        csv: document.querySelectorAll('.am-export-bar .am-act').length,
        tables: document.querySelectorAll('.am-table').length,
      }));
      assert(counts.csv >= 1, '当前场景没有导出按钮');
      assert(counts.tables >= 1, '当前场景没有表格');
      console.log(`     导出按钮 ${counts.csv} 个 / 表格 ${counts.tables} 个`);
    });

await step('调度试算与工作流校验真的能用', async () => {
      // 回到治理场景（试算与校验都在这里）
      await page.evaluate(() => {
        const label = Array.from(document.querySelectorAll('.tab-label')).find((n) => n.textContent.includes('治理与策略'));
        (label?.closest('.tab') || label?.parentElement)?.click();
      });
      await page.waitForTimeout(4200);

      const result = await page.evaluate(async () => {
        const panels = Array.from(document.querySelectorAll('.panel'));
        const byTitle = (t) => panels.find((p) => p.querySelector('.panel-title')?.textContent === t);

        const dispatch = byTitle('调度策略');
        Array.from(dispatch.querySelectorAll('.am-act')).find((b) => b.textContent === '试算').click();
        await new Promise((r) => setTimeout(r, 2600));
        const preview = dispatch.querySelector('.am-preview')?.innerText ?? '';

        const wf = byTitle('工作流');
        Array.from(wf.querySelectorAll('.am-act')).find((b) => b.textContent === '校验').click();
        await new Promise((r) => setTimeout(r, 2600));
        const drawer = wf.querySelector('.am-drawer')?.innerText ?? '';
        return { preview, drawer };
      });

      assert(/试算结果/.test(result.preview), `试算没有结果：${result.preview.slice(0, 80)}`);
      assert(/是否通过/.test(result.drawer), `校验没有输出：${result.drawer.slice(0, 80)}`);
      console.log(`     试算 ${result.preview.replace(/\n/g, ' ').slice(0, 60)}…`);
      console.log(`     校验 ${result.drawer.replace(/\n/g, ' ').slice(0, 60)}…`);
    });

    await step('场景助手真的回答（真实模型）', async () => {
      const panel = page.locator('.panel', { has: page.locator('.panel-title', { hasText: '场景助手' }) }).first();
      // 用输入框提问（点提示条在矮面板里可能被裁掉不可见）
      await panel.locator('.am-chat-input textarea').fill('用一句话说，这个场景现在最该处理什么？');
      await panel.locator('.am-send').click();
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
