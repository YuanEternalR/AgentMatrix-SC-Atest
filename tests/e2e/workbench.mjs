/**
 * 工作台原生面板回归（Electron + CDP）
 *
 * 守的是什么：**面板必须自己完成功能，不许把浏览器页面嵌进来充数。**
 * 上一版用 `embed` 面板套我们的网页，被用户否掉；这条测试明确断言每个**原生**面板里
 * 没有 <webview> / <iframe>，同时又真的有数据（正文长度、关键列都在）。
 * 唯一例外是「DSH 会话」面板（type=harness）：那是**有意内嵌**的 DSH 引擎界面。
 * 2026-11-24 起每个场景各有一个（共 5 个），断言要求每个这样的面板恰好有 1 个 webview。
 *
 * 另外覆盖：五个场景都能切、面板有真实内容、各场景已无「场景助手」且恰好 1 个「DSH 会话」、没有渲染层报错。
 *
 * 用法：node tests/e2e/workbench.mjs（平台需在跑：工作台会自动拉起，或先 `dev up`；
 * 工作台本体请先退出，单实例锁会挡住测试拉起的第二个实例）
 * 会自己拉起 Electron，跑完关掉。
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
// WB_SHELL_DIR：可选，指向一份隔离的 外壳 副本（例如 外壳-test）。
// 用途：工作台本体正在运行时（单实例锁会挡住第二个实例），用副本照样能跑回归。
const SHELL_DIR = process.env.WB_SHELL_DIR
  ? path.resolve(process.env.WB_SHELL_DIR)
  : path.join(REPO, 'agentmatrix-workbench', '外壳');
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
  const env = { ...process.env, AM_DEBUG_PORT: String(DEBUG_PORT), DSH_PORT: process.env.DSH_PORT || '3083' };
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
    // 第一个 .tab 是模板自带的「DSH 引擎」，已被 retarget.js 隐藏，所以等「可见的」标签
    await page.waitForSelector('#scenario-tabs .tab:visible', { timeout: 30000 });

    /** 切场景后等某个面板标题出现（避免刚切过去就断言导致 no-panel） */
    const waitPanel = (title) =>
      page.waitForFunction(
        (t) => Array.from(document.querySelectorAll('.panel-title')).some((n) => n.textContent === t),
        title,
        { timeout: 20000 },
      );
    /** 切场景：用模板自带的 __dshGoScene，并确认真的切过去了 */
    const goScene = async (sceneId) => {
      for (let i = 0; i < 6; i += 1) {
        await page.evaluate((id) => window.__dshGoScene(id), sceneId);
        await page.waitForTimeout(1200);
        const active = await page.evaluate(() => document.querySelector('#scenario-tabs .tab.active')?.dataset.scId);
        if (active === sceneId) return;
      }
      throw new Error('切场景失败：' + sceneId);
    };

    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await step('五个场景标签都在', async () => {
      const labels = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.tab-label')).map((n) => n.textContent.trim()),
      );
      for (const name of ['工作台总览', '工作流设计', '能力矩阵', '交付追踪', '治理与策略']) {
        assert(labels.includes(name), `缺少场景「${name}」，实际：${labels.join('/')}`);
      }

      // 启动落地：落在「工作台总览」；DSH 引擎标签保留（引擎现在由工作台自己拉起，是真实会话入口），
      // 只有引擎没起来时才由 retarget.js 临时隐藏。
      await page.waitForFunction(
        () => document.querySelector('#scenario-tabs .tab.active')?.dataset.scId === 'overview',
        { timeout: 15000 },
      );
      // 2026-11-23：场景切换走 #scene-veil 遮罩（约 200ms 淡入 → 换 DOM → 等面板请求 → 淡出），
      // 所以回调落在遮罩之后 ⇒ 等首个面板真正出现再断言
      await page.waitForFunction(
        () => Array.from(document.querySelectorAll('.panel-title')).some((n) => n.textContent === '场景快照'),
        { timeout: 15000 },
      );
      const landing = await page.evaluate(() => ({
        active: document.querySelector('#scenario-tabs .tab.active')?.dataset.scId,
        harnessTab: (() => {
          const t = document.querySelector('.tab[data-sc-id="harness"]');
          return t ? getComputedStyle(t).display !== 'none' : false;
        })(),
        titles: Array.from(document.querySelectorAll('.panel-title')).map((n) => n.textContent),
      }));
      assert(landing.titles.includes('场景快照'), `启动没落在工作台总览：${landing.titles.join('/')}`);
      console.log(`     启动落地 ${landing.active}（DSH 引擎标签${landing.harnessTab ? '保留' : '隐藏'}）`);
    });

    const SCENES = [
      { id: 'overview', name: '工作台总览', expect: ['场景快照', '待审批', '任务', '新建', 'DSH 会话'], minLen: 400, needActions: true },
      { id: 'designer', name: '工作流设计', expect: ['设计器', 'DSH 会话'], minLen: 200, needActions: true },
      { id: 'matrix', name: '能力矩阵', expect: ['能力矩阵', '智能体', '技能库', 'DSH 会话'], minLen: 400, needActions: true },
      { id: 'delivery', name: '交付追踪', expect: ['运行监控', '运行趋势', '死信队列', 'DSH 会话'], minLen: 300, needActions: true },
      { id: 'governance', name: '治理与策略', expect: ['调度策略', '审计日志', '工作流', '告警', 'DSH 会话'], minLen: 400, needActions: true },
    ];

    for (const scene of SCENES) {
      await step(`场景「${scene.name}」面板是原生实现且有数据`, async () => {
        await goScene(scene.id);
        await page.waitForTimeout(1200);

        const info = await page.evaluate(() =>
          Array.from(document.querySelectorAll('.panel')).map((panel) => ({
            title: panel.querySelector('.panel-title')?.textContent ?? '',
            // body 的 data-kind 才是面板类型；.panel 上只有 data-panel-id
            kind: panel.querySelector('.panel-body')?.dataset.kind ?? '',
            text: panel.querySelector('.panel-body')?.innerText ?? '',
            media: panel.querySelectorAll('webview, iframe').length,
          })),
        );

        assert(info.length >= 2, `面板只有 ${info.length} 个`);
        for (const panel of info) {
          if (panel.kind === 'harness') {
            // 「DSH 会话」是有意内嵌的 DSH 引擎界面：每个面板恰好一个 webview
            assert(
              panel.media === 1,
              `面板「${panel.title}」应该恰有 1 个 webview（DSH 会话），实际 ${panel.media} 个`,
            );
            continue;
          }
          assert(
            panel.media === 0,
            `面板「${panel.title}」里嵌了 ${panel.media} 个 webview/iframe——原生面板必须自己完成功能`,
          );
        }
        for (const title of scene.expect) {
          assert(info.some((p) => p.title === title), `缺少面板「${title}」`);
        }
        // 2026-11-23：总览的「DSH 大脑」面板已按反馈删除，别再被加回来
        if (scene.id === 'overview') {
          assert(!info.some((p) => p.title === 'DSH 大脑'), '总览不应再出现「DSH 大脑」面板');
        }
        // 2026-11-24：各场景的「场景助手」（am-assistant）已按反馈删除，AI 问答统一走「DSH 会话」
        assert(
          !info.some((p) => p.kind === 'am-assistant' || p.title === '场景助手'),
          `场景「${scene.name}」还有「场景助手」面板——该面板已删除，AI 问答统一走「DSH 会话」`,
        );
        assert(
          info.filter((p) => p.kind === 'harness').length === 1,
          `场景「${scene.name}」的「DSH 会话」应恰好 1 个，实际 ${info.filter((p) => p.kind === 'harness').length} 个`,
        );
        const total = info.reduce((sum, p) => sum + p.text.length, 0);
        assert(total >= scene.minLen, `面板内容过少（${total} 字），可能没取到数据`);

        if (scene.needActions) {
          const actions = await page.evaluate(() => document.querySelectorAll('.am-act').length);
          assert(actions > 0, '这个场景应该有可操作按钮（审批/试运行/重试/试算…），实际一个都没有');
        }
      });
    }

    await step('点「刷新当前场景」后仍认识所有原生面板', async () => {
      const before = await page.evaluate(() => document.querySelectorAll('.panel').length);
      await page.evaluate(() => {
        const btn = document.getElementById('btn-refresh');
        if (btn) btn.click();
      });
      await page.waitForTimeout(4500);
      const after = await page.evaluate(() => ({
        unknown: Array.from(document.querySelectorAll('.panel-body')).filter((b) => b.innerText.includes('未知面板类型')).length,
        panels: document.querySelectorAll('.panel').length,
        registry: Object.keys(window.APP_RENDERERS || {}).filter((k) => k.startsWith('am-')).length,
      }));
      assert(after.unknown === 0, `刷新后出现 ${after.unknown} 个「未知面板类型」`);
      assert(after.panels === before, `刷新后面板数变了：${before} → ${after.panels}`);
      assert(after.registry >= 16, `注册表只剩 ${after.registry} 个原生面板`);
      console.log(`     刷新后 ${after.panels} 个面板、注册表 ${after.registry} 个原生类型`);
    });

    await step('矩阵按真实数据渲染（不是全红）', async () => {
      await goScene('matrix');
      await waitPanel('能力矩阵');
      const m = await page.evaluate(() => {
        const p = Array.from(document.querySelectorAll('.panel')).find((x) => x.querySelector('.panel-title')?.textContent === '能力矩阵');
        if (!p) return null;
        return {
          cells: p.querySelectorAll('.am-mx-cell').length,
          filled: p.querySelectorAll('.am-mx-cell.filled').length,
          gap: p.querySelectorAll('.am-mx-cell.gap').length,
        };
      });
      assert(m, '能力矩阵面板没渲染');
      assert(m.filled > 0, `有智能体的格子为 0（全是"缺"）：${JSON.stringify(m)}`);
      assert(m.cells === m.filled + m.gap, `格子数对不上：${JSON.stringify(m)}`);
      console.log(`     ${m.cells} 格：有智能体 ${m.filled} / 缺口 ${m.gap}`);
    });

    await step('运行详情：收起后换一条仍能显示', async () => {
      await goScene('delivery');
      await waitPanel('运行监控');
      const r = await page.evaluate(async () => {
        const p = Array.from(document.querySelectorAll('.panel')).find((x) => x.querySelector('.panel-title')?.textContent === '运行监控');
        if (!p) return { err: 'no-runs' };
        const rows = p.querySelectorAll('.am-table tbody tr');
        const box = p.querySelector('.am-drawer');
        rows[0].click();
        await new Promise((res) => setTimeout(res, 1800));
        const first = box.innerText;
        box.querySelector('.am-drawer-close').click();
        await new Promise((res) => setTimeout(res, 400));
        rows[3].click();
        await new Promise((res) => setTimeout(res, 1800));
        return { first, second: box.innerText, display: getComputedStyle(box).display };
      });
      assert(!r.err, r.err);
      assert(/运行编号/.test(r.first), `第一次点击没显示明细：${r.first.slice(0, 60)}`);
      assert(/运行编号/.test(r.second), `收起后再点别的行显示异常：${r.second.slice(0, 60)}`);
      assert(r.first !== r.second, '两条运行显示的是同一份内容');
      console.log('     两条不同运行都能打开明细');
    });

    await step('趋势图有刻度与柱（不是空图）', async () => {
      const c = await page.evaluate(() => {
        const p = Array.from(document.querySelectorAll('.panel')).find((x) => x.querySelector('.panel-title')?.textContent === '运行趋势');
        if (!p) return null;
        return {
          ticks: p.querySelectorAll('.am-chart-tick').length,
          bars: p.querySelectorAll('.am-chart-bar').length,
          grid: p.querySelectorAll('.am-chart-grid').length,
        };
      });
      assert(c, '趋势图面板没渲染');
      assert(c.bars >= 20, `柱子太少：${c.bars}`);
      assert(c.ticks >= 5, `刻度太少：${c.ticks}`);
      assert(c.grid >= 2, `网格线太少：${c.grid}`);
      console.log(`     ${c.bars} 根柱 / ${c.ticks} 个刻度 / ${c.grid} 条网格`);
    });

    await step('新建表单：必填项用中文拦住', async () => {
      await goScene('overview');
      await waitPanel('场景快照');
      const msg = await page.evaluate(async () => {
        const p = Array.from(document.querySelectorAll('.panel')).find((x) => x.querySelector('.panel-title')?.textContent === '新建');
        if (!p) return 'no-create';
        const title = p.querySelector('[data-key="title"]');
        title.value = '';
        title.dispatchEvent(new Event('input', { bubbles: true }));
        Array.from(p.querySelectorAll('.am-act')).find((b) => b.textContent === '创建任务').click();
        await new Promise((r) => setTimeout(r, 700));
        return p.querySelector('.am-create-result')?.innerText ?? '';
      });
      assert(/还差这些必填项/.test(msg), `没有中文必填提示：${msg.slice(0, 80)}`);
      console.log(`     ${msg.replace(/\n/g, ' ')}`);
    });

    await step('设计器：切换工作流真的换图', async () => {
      await goScene('designer');
      await waitPanel('设计器');
      const r = await page.evaluate(async () => {
        const p = Array.from(document.querySelectorAll('.panel')).find((x) => x.querySelector('.panel-title')?.textContent === '设计器');
        if (!p) return { err: 'no-designer' };
        const picker = p.querySelector('.am-workflow-picker');
        if (!picker) return { err: 'no-picker' };
        const before = p.querySelector('.am-designer-title')?.textContent;
        picker.value = 'order_delay_exception';
        picker.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((res) => setTimeout(res, 3500));
        return { before, after: p.querySelector('.am-designer-title')?.textContent, nodes: p.querySelectorAll('.am-node').length };
      });
      assert(!r.err, r.err);
      assert(r.before !== r.after, `切换后没变：${r.before}`);
      assert(r.nodes >= 5, `节点太少：${r.nodes}`);
      console.log(`     ${r.before} → ${r.after}（${r.nodes} 个节点）`);
    });

await step('工作流设计器：画出图、能校验', async () => {
      await goScene('designer');
      await waitPanel('设计器');
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

      // 连线必须"落在方块上"：起点 = 某卡片底边中点，终点 = 某卡片顶边中点
      const anchors = await page.evaluate(() => {
        const panel = Array.from(document.querySelectorAll('.panel')).find(
          (p) => p.querySelector('.panel-title')?.textContent === '设计器',
        );
        if (!panel) return null;
        const canvas = panel.querySelector('.am-canvas');
        const cards = Array.from(canvas.querySelectorAll('.am-node')).map((c) => ({
          cx: c.offsetLeft + c.offsetWidth / 2,
          top: c.offsetTop,
          bottom: c.offsetTop + c.offsetHeight,
        }));
        const bad = [];
        canvas.querySelectorAll('.am-edge').forEach((p) => {
          const n = p.getAttribute('d').match(/-?\d+(?:\.\d+)?/g).map(Number);
          const x1 = n[0];
          const y1 = n[1];
          const x2 = n[3];
          const y2 = n[4];
          const fromOk = cards.some((c) => Math.abs(c.cx - x1) < 1.5 && Math.abs(c.bottom - y1) < 1.5);
          const toOk = cards.some((c) => Math.abs(c.cx - x2) < 1.5 && Math.abs(c.top - y2) < 1.5);
          if (!fromOk || !toOk) bad.push(p.getAttribute('d'));
        });
        return { edges: canvas.querySelectorAll('.am-edge').length, bad: bad.length, sample: bad[0] || '' };
      });
      assert(anchors, '设计器面板没渲染');
      assert(anchors.bad === 0, `${anchors.bad}/${anchors.edges} 条连线没落在方块上，例如 ${anchors.sample}`);
      console.log(`     ${anchors.edges} 条连线全部锚定在方块上`);
      console.log(`     ${res.nodes} 个节点 / ${res.edges} 条连线 · ${res.result.replace(/\n/g, ' ').slice(0, 40)}`);
    });

    await step('设计器：点节点能改「下一步连到」', async () => {
      await goScene('designer');
      await waitPanel('设计器');
      await page.waitForSelector('.am-canvas .am-node', { timeout: 20000 });
      // 必须用真实鼠标点：旧实现 mouseup 里整块 draw()，卡片被换掉后 click 不触发，
      // 只有真实指针事件才复现「点节点没反应」。
      const spot = await page.evaluate(() => {
        const panel = Array.from(document.querySelectorAll('.panel')).find(
          (p) => p.querySelector('.panel-title')?.textContent === '设计器',
        );
        const card = panel?.querySelector('.am-canvas .am-node');
        if (!card) return null;
        const box = card.getBoundingClientRect();
        return { x: box.left + box.width / 2, y: box.top + box.height / 2, id: card.dataset.id };
      });
      assert(spot, '画布上没有节点');
      await page.mouse.click(spot.x, spot.y);
      await page.waitForSelector('.am-node-editor-side', { timeout: 5000 });
      const changed = await page.evaluate(async () => {
        const panel = Array.from(document.querySelectorAll('.panel')).find(
          (p) => p.querySelector('.panel-title')?.textContent === '设计器',
        );
        const editor = panel.querySelector('.am-node-editor-side');
        if (!editor) return { err: '编辑器没打开' };
        const nodeId = (editor.querySelector('.am-drawer-title')?.textContent || '').replace('节点 ', '').trim();
        const row = Array.from(editor.querySelectorAll('.am-field')).find(
          (r) => r.querySelector('.am-k')?.textContent === '下一步连到',
        );
        const select = row?.querySelector('select');
        if (!select) return { err: '没有「下一步连到」下拉框' };
        const before = select.value;
        const target = Array.from(select.options).map((o) => o.value).filter((v) => v && v !== before)[0];
        if (!target) return { err: '没有可连的目标节点' };
        select.value = target;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 250));
        const card = Array.from(panel.querySelectorAll('.am-node')).find((c) => c.dataset.id === nodeId);
        return {
          nodeId,
          before,
          target,
          value: select.value,
          editorOpen: !!panel.querySelector('.am-node-editor-side'),
          linkText: card?.querySelector('.am-node-link')?.textContent || '',
          dirty: panel.querySelector('.am-dirty')?.textContent || '',
          edges: panel.querySelectorAll('.am-edge').length,
        };
      });
      assert(!changed.err, changed.err);
      assert(changed.value === changed.target, `连接没改成功：${changed.value} ≠ ${changed.target}`);
      assert(changed.editorOpen, '改完连接后编辑器被重画掉了');
      assert(changed.linkText.includes(changed.target), `节点卡片没显示新连接：${changed.linkText}`);
      assert(changed.dirty === '未发布', `没标记未发布：${changed.dirty}`);
      console.log(`     ${changed.nodeId}：${changed.before || '(空)'} → ${changed.target}，卡片显示「${changed.linkText}」`);
    });

    await step('新建面板：真的创建一个任务', async () => {
      await goScene('overview');
      await waitPanel('场景快照');
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
        // 结果异步出现（真实 POST /tasks，带平台等待）；轮询而不是死等 3.5 秒，避免偶发空结果
        for (let i = 0; i < 20; i += 1) {
          await new Promise((r) => setTimeout(r, 500));
          const text = panel.querySelector('.am-create-result')?.innerText ?? '';
          if (text) return { result: text };
        }
        return { result: '' };
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
      await goScene('governance');
      await page.waitForTimeout(1500);

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

    await step('5 个场景都没有「场景助手」、各恰好 1 个「DSH 会话」', async () => {
      // 2026-11-24：原「场景助手真的回答（真实模型）」一步随面板一起删除；
      // 真实模型问答改由每个场景常驻的「DSH 会话」（harness）承担，这里守住"删干净、别被加回来 + 每场景仍有一个 AI 入口"。
      for (const scene of SCENES) {
        await goScene(scene.id);
        await page.waitForTimeout(900);
        const panels = await page.evaluate(() =>
          Array.from(document.querySelectorAll('.panel')).map((panel) => ({
            title: panel.querySelector('.panel-title')?.textContent ?? '',
            kind: panel.querySelector('.panel-body')?.dataset.kind ?? '',
          })),
        );
        assert(panels.length >= 2, `${scene.name} 面板只有 ${panels.length} 个`);
        assert(
          !panels.some((p) => p.kind === 'am-assistant' || p.title === '场景助手'),
          `${scene.name} 仍有「场景助手」面板`,
        );
        assert(
          panels.filter((p) => p.kind === 'harness').length === 1,
          `${scene.name} 的「DSH 会话」不是恰好 1 个`,
        );
      }
      console.log('     5 个场景：场景助手 0 个，DSH 会话各 1 个');
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
