/**
 * 工作台外壳渲染层（纯 DOM，无框架）
 *
 * 结构学自 luanyujia-workbench：
 *   场景 JSON → 清空网格 → 按 type 查面板渲染器表 → 渲染器自己画。
 * 加一个面板类型 = 往 PANEL_RENDERERS 里加一个函数，不需要改主进程。
 *
 * 两种运行模式共用这一份代码：
 *   - Electron：主进程通过 preload 暴露 window.shell（IPC）
 *   - 浏览器：server.js 暴露同名 HTTP 接口，下面 httpAdapter 包一层
 */

const httpAdapter = {
  mode: 'browser',
  async listScenarios() {
    const res = await fetch('/api/shell/scenarios');
    if (!res.ok) throw new Error(`场景列表 HTTP ${res.status}`);
    return res.json();
  },
  async getScenario(id) {
    const res = await fetch(`/api/shell/scenario/${id}`);
    if (!res.ok) throw new Error(`场景 ${id} HTTP ${res.status}`);
    return res.json();
  },
  async readMemory(id) {
    const res = await fetch(`/api/shell/memory/${id}`);
    if (!res.ok) return '';
    const data = await res.json();
    return data.text ?? '';
  },
  async writeMemory(id, text) {
    const res = await fetch(`/api/shell/memory/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    return res.ok;
  },
  async token() {
    const res = await fetch('/api/shell/token');
    if (!res.ok) throw new Error(`取 token HTTP ${res.status}`);
    return (await res.json()).token;
  },
  async context() {
    const res = await fetch('/api/shell/context');
    if (!res.ok) throw new Error(`快照 HTTP ${res.status}`);
    return res.json();
  },
  async ask(body) {
    const res = await fetch('/api/shell/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`提问 HTTP ${res.status}`);
    return res.json();
  },
  async health() {
    const res = await fetch('/api/shell/health');
    return res.ok ? res.json() : { api: false, web: false, detail: `HTTP ${res.status}` };
  },
  async config() {
    const res = await fetch('/api/shell/config');
    return res.json();
  },
  async openExternal(url) {
    window.open(url, '_blank', 'noopener');
  },
};

// 变量名不能叫 shell：preload 已把 window.shell 定义为全局属性，
// 顶层再 `const shell` 会抛 "Identifier 'shell' has already been declared"——只有 Electron 模式才暴露这个坑。
const host = window.shell ?? httpAdapter;

// 策略编码 → 中文，与主站 labels.ts 同一口径（外壳拿不到前端模块，故复制一份小表）
const STRATEGY_LABEL = {
  s0_all_large: '全用大模型',
  s1_fixed_rule: '固定规则',
  s2_weighted: '加权打分',
  s3_cost_aware: '成本优先',
  s4_llm_planner: '大模型规划',
};

const state = {
  scenarios: [],
  currentId: null,
  scenario: null,
  token: null,
  config: { webBase: 'http://127.0.0.1:5173' },
  /** 每个场景渲染时注册的清理函数（定时器 / 监听器），切场景前统一撤掉 */
  cleanups: [],
};

const el = {
  tabs: document.getElementById('tabs'),
  grid: document.getElementById('grid'),
  health: document.getElementById('health'),
  reload: document.getElementById('reload'),
  statusLeft: document.getElementById('status-left'),
  statusRight: document.getElementById('status-right'),
};

// ---------------------------------------------------------------- 工具

function h(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value !== undefined && value !== null) node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child) node.appendChild(child);
  }
  return node;
}

function cleanup() {
  for (const fn of state.cleanups.splice(0)) {
    try {
      fn();
    } catch {
      /* 清理失败不影响切换 */
    }
  }
}

function registerCleanup(fn) {
  state.cleanups.push(fn);
}

function setStatus(text, right) {
  el.statusLeft.textContent = text;
  if (right !== undefined) el.statusRight.textContent = right;
}

// ---------------------------------------------------------------- 展开 / 收起
//
// 学自源工作台的做法，也是这次修 bug 的核心：
//   ① 在原格插入一个占位格（.panel-slot）把版面钉住 —— 其它面板位置**完全不动**；
//   ② 面板改成 position: fixed + 视口坐标，高度撑到整个网格；
//   ③ 只过渡 top/left/width/height（面板里是 iframe，transform 跟随不稳）。
// 之前把 grid-row 改成 span 6 是错的：网格会重排，面板被挤到最下方、原格留个洞。

const PANEL_ANIM_MS = 320;
const expandStates = [];
let expandZ = 60;

function expandedState(wrap) {
  return expandStates.find((item) => item.wrap === wrap) || null;
}

function applyBox(wrap, box) {
  wrap.style.left = Math.round(box.left) + 'px';
  wrap.style.top = Math.round(box.top) + 'px';
  wrap.style.width = Math.round(box.width) + 'px';
  wrap.style.height = Math.round(box.height) + 'px';
}

function expandPanel(wrap, btn) {
  const grid = wrap.parentElement;
  if (!grid || expandedState(wrap)) return;

  const from = wrap.getBoundingClientRect();

  const slot = document.createElement('div');
  slot.className = 'panel-slot';
  slot.style.gridColumn = wrap.style.gridColumn || '';
  slot.style.gridRow = wrap.style.gridRow || '';
  grid.insertBefore(slot, wrap);

  // 目标几何：横向保持原列宽（以占位格为准），纵向撑满整个网格
  const gridRect = grid.getBoundingClientRect();
  const slotRect = slot.getBoundingClientRect();
  const to = {
    left: slotRect.left,
    top: gridRect.top,
    width: slotRect.width,
    height: gridRect.height,
  };

  wrap.style.position = 'fixed';
  wrap.style.zIndex = String((expandZ += 1));
  applyBox(wrap, from);
  wrap.classList.add('panel-expanded');
  btn.textContent = '▼';
  btn.title = '收起（Esc 也可以）';

  requestAnimationFrame(() => {
    wrap.classList.add('panel-anim');
    applyBox(wrap, to);
  });

  const clearAnim = () => wrap.classList.remove('panel-anim');
  const onEnd = (event) => {
    if (event.target !== wrap || event.propertyName !== 'height') return;
    wrap.removeEventListener('transitionend', onEnd);
    clearAnim();
  };
  wrap.addEventListener('transitionend', onEnd);
  setTimeout(clearAnim, PANEL_ANIM_MS + 120);

  // 窗口尺寸变化：重新贴合（不带动画）
  const onResize = () => {
    if (!wrap.isConnected) {
      collapsePanel(wrap);
      return;
    }
    wrap.classList.remove('panel-anim');
    const g = grid.getBoundingClientRect();
    const s = slot.getBoundingClientRect();
    applyBox(wrap, { left: s.left, top: g.top, width: s.width, height: g.height });
  };

  // Esc 只收最上层那个（连按 = 逐个退栈）
  const onKey = (event) => {
    if (event.key !== 'Escape') return;
    if (expandStates[expandStates.length - 1] === st) collapsePanel(wrap);
  };

  window.addEventListener('resize', onResize);
  document.addEventListener('keydown', onKey, true);

  const st = { wrap, slot, btn, onResize, onKey };
  expandStates.push(st);
}

function collapsePanel(wrap) {
  const targets = wrap ? expandStates.filter((item) => item.wrap === wrap) : expandStates.slice();
  for (let i = targets.length - 1; i >= 0; i -= 1) collapseOne(targets[i]);
}

function collapseOne(st) {
  const at = expandStates.indexOf(st);
  if (at >= 0) expandStates.splice(at, 1);

  window.removeEventListener('resize', st.onResize);
  document.removeEventListener('keydown', st.onKey, true);
  st.btn.textContent = '▲';
  st.btn.title = '展开到最高（再点一次收起，Esc 退出）';

  let target = null;
  try {
    if (st.slot && st.slot.parentNode) target = st.slot.getBoundingClientRect();
  } catch {
    target = null;
  }

  const reset = () => {
    st.wrap.classList.remove('panel-expanded', 'panel-anim');
    st.wrap.style.position = '';
    st.wrap.style.zIndex = '';
    st.wrap.style.left = '';
    st.wrap.style.top = '';
    st.wrap.style.width = '';
    st.wrap.style.height = '';
    if (st.slot && st.slot.parentNode) st.slot.parentNode.removeChild(st.slot);
  };

  if (target && st.wrap.isConnected) {
    st.wrap.classList.add('panel-anim');
    applyBox(st.wrap, target);
    setTimeout(reset, PANEL_ANIM_MS + 40);
  } else {
    reset();
  }
}

function toggleExpand(wrap, btn) {
  if (expandedState(wrap)) collapsePanel(wrap);
  else expandPanel(wrap, btn);
}

// ---------------------------------------------------------------- 面板渲染器

/** 面板渲染器表：加类型只加一个函数，与主进程无关 */
const PANEL_RENDERERS = {
  /** 嵌我们已有页面（iframe，自带 token 免登录） */
  async view(body, panel, ctx) {
    const path = panel.path || '/';
    const sep = path.includes('?') ? '&' : '?';
    const embedBase = `${state.config.webBase}${path}${sep}embed=1&theme=dark`;
    const src = state.token ? `${embedBase}&token=${encodeURIComponent(state.token)}` : embedBase;
    body.appendChild(h('iframe', { src, title: panel.title, loading: 'eager' }));
    ctx.setSub(`${path}${state.token ? ' · 已注入登录态' : ' · 未登录'}`);
  },

  /** 场景快照：数字全部来自后端 /workbench/context */
  async status(body, panel, ctx) {
    const wrap = h('div', { class: 'kpi-grid' });
    const chips = h('div', { class: 'chip-row' });
    body.append(wrap, chips);

    async function refresh() {
      try {
        const snap = await host.context();
        const waiting = snap.tasks?.waiting_approval ?? 0;
        const failed = snap.tasks?.failed ?? 0;
        const ok = snap.runs_24h?.succeeded ?? 0;
        const covered = snap.matrix?.covered_cells ?? 0;
        const total = snap.matrix?.total_cells ?? 0;

        wrap.replaceChildren(
          card('待审批', waiting, waiting > 0 ? 'warn' : '', '需要人处理的审批节点'),
          card('24h 成功运行', ok, ok > 0 ? 'good' : '', `失败 ${failed}`),
          card('矩阵覆盖', `${covered}/${total}`, '', `缺口 ${snap.matrix?.gap_count ?? 0} 格`),
          card('积压', (snap.pending_dead_letters ?? 0) + (snap.tasks?.pending ?? 0), '', `死信 ${snap.pending_dead_letters ?? 0}`),
        );
        chips.replaceChildren(
          h('span', { class: 'chip', text: `调度策略 ${STRATEGY_LABEL[snap.dispatch?.strategy] ?? snap.dispatch?.strategy ?? '—'}` }),
          h('span', { class: 'chip', text: `来源 ${snap.dispatch?.source === 'db' ? '界面配置' : '环境变量'}` }),
          ...(snap.recent_failures ?? []).slice(0, 2).map((f) =>
            h('span', { class: 'chip', text: `${f.run_id} ${f.error_code ?? ''}` }),
          ),
        );
        ctx.setSub(`更新于 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`);
      } catch (err) {
        wrap.replaceChildren(h('div', { class: 'empty-state error-state', text: `快照拉取失败：${err.message}` }));
      }
    }

    await refresh();
    const timer = setInterval(refresh, 15000);
    registerCleanup(() => clearInterval(timer));
  },

  /** 场景记忆：文件化交接（学它的「§〇 交接」≤4KB） */
  async memory(body, panel, ctx) {
    const scenarioId = panel.memoryOf || state.currentId;
    const area = h('textarea', { class: 'memory-area', spellcheck: 'false' });
    const count = h('span', { text: '' });
    const saveBtn = h('button', { class: 'mini-btn primary', text: '保存' });
    const reloadBtn = h('button', { class: 'mini-btn', text: '重新读取' });

    const wrap = h('div', { class: 'memory-wrap' }, [
      area,
      h('div', { class: 'memory-foot' }, [
        count,
        h('span', { class: 'spacer' }),
        reloadBtn,
        saveBtn,
      ]),
    ]);
    body.appendChild(wrap);

    function updateCount() {
      const bytes = new TextEncoder().encode(area.value).length;
      const over = bytes > 4096;
      count.textContent = `${bytes} / 4096 字节${over ? ' · 超了，交接要更短' : ''}`;
      count.style.color = over ? 'var(--danger)' : 'var(--muted)';
    }

    async function load() {
      try {
        area.value = await host.readMemory(scenarioId);
        updateCount();
        ctx.setSub(`${scenarioId}.md`);
      } catch (err) {
        ctx.setSub(`读取失败：${err.message}`);
      }
    }

    area.addEventListener('input', updateCount);
    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      const ok = await host.writeMemory(scenarioId, area.value);
      saveBtn.disabled = false;
      saveBtn.textContent = ok ? '已保存' : '保存失败';
      setTimeout(() => {
        saveBtn.textContent = '保存';
      }, 1200);
    });
    reloadBtn.addEventListener('click', load);

    await load();
  },

  /** 场景助手：把「场景记忆 + 平台快照 + 问题」交给后端，模型给结论 */
  async chat(body, panel) {
    const log = h('div', { class: 'chat-log' });
    const input = h('textarea', { placeholder: '问这个场景：现在最该做什么？（Enter 发送，Shift+Enter 换行）' });
    const send = h('button', { class: 'mini-btn primary', text: '发送' });
    body.appendChild(h('div', { class: 'chat-wrap' }, [log, h('div', { class: 'chat-input' }, [input, send])]));

    function push(kind, text) {
      const node = h('div', { class: `msg ${kind}`, text });
      log.appendChild(node);
      log.scrollTop = log.scrollHeight;
      return node;
    }

    push('system', `场景「${state.scenario?.name ?? state.currentId}」助手已就绪，会读取本场景记忆与平台实时快照。`);

    async function ask() {
      const question = input.value.trim();
      if (!question) return;
      input.value = '';
      push('user', question);
      const pending = push('system', '正在分析…');
      send.disabled = true;
      try {
        const memory = await host.readMemory(state.currentId);
        const result = await host.ask({
          scenario: state.currentId,
          scenario_name: state.scenario?.name ?? state.currentId,
          memory,
          question,
        });
        pending.remove();
        if (!result.ok) {
          push('system', `调用失败：${result.error ?? '未知错误'}${result.error_code ? `（${result.error_code}）` : ''}`);
          return;
        }
        push('assistant', result.answer);
        push('meta', `${result.provider}/${result.model} · ${result.tokens} tokens · $${Number(result.cost_usd).toFixed(6)} · ${result.duration_ms}ms`);
        const append = h('button', {
          class: 'mini-btn',
          text: '把这段结论写进场景记忆',
          onclick: async () => {
            const current = await host.readMemory(state.currentId);
            const block = `\n\n## 助手结论（${new Date().toLocaleString('zh-CN', { hour12: false })}）\n\n${result.answer}\n`;
            await host.writeMemory(state.currentId, `${current.trimEnd()}${block}`);
            append.textContent = '已写入记忆';
            append.disabled = true;
          },
        });
        log.appendChild(append);
        log.scrollTop = log.scrollHeight;
      } catch (err) {
        pending.remove();
        push('system', `请求失败：${err.message}`);
      } finally {
        send.disabled = false;
        input.focus();
      }
    }

    send.addEventListener('click', ask);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        ask();
      }
    });
    input.focus();
  },

  /** 快捷入口：把工作台里最常用的页面列出来，点开在浏览器里看 */
  async links(body, panel) {
    const list = h('div', { class: 'links' });
    for (const item of panel.items || []) {
      list.appendChild(
        h('button', {
          class: 'link-item',
          onclick: () => host.openExternal(`${state.config.webBase}${item.path}`),
        }, [h('strong', { text: item.title }), h('span', { text: item.sub || item.path })]),
      );
    }
    body.appendChild(list);
  },
};

function card(label, value, tone, hint) {
  return h('div', { class: `kpi ${tone || ''}` }, [
    h('div', { class: 'label', text: label }),
    h('div', { class: 'value', text: String(value) }),
    hint ? h('div', { class: 'hint', text: hint }) : null,
  ]);
}

// ---------------------------------------------------------------- 场景与网格

function renderTabs() {
  el.tabs.replaceChildren(
    ...state.scenarios.map((scenario, index) =>
      h('button', {
        class: `tab ${scenario.id === state.currentId ? 'active' : ''}`,
        draggable: 'true',
        title: scenario.description || scenario.name,
        'data-id': scenario.id,
        onclick: () => switchScenario(scenario.id),
        ondragstart: (event) => {
          event.dataTransfer.setData('text/plain', scenario.id);
          event.currentTarget.classList.add('dragging');
        },
        ondragend: (event) => event.currentTarget.classList.remove('dragging'),
        ondragover: (event) => event.preventDefault(),
        ondrop: (event) => {
          event.preventDefault();
          const fromId = event.dataTransfer.getData('text/plain');
          if (fromId && fromId !== scenario.id) moveScenario(fromId, scenario.id);
        },
      }, [
        h('span', { class: 'tab-idx', text: String(index + 1).padStart(2, '0') }),
        h('span', { text: scenario.name }),
      ]),
    ),
  );
}

function moveScenario(fromId, toId) {
  const from = state.scenarios.findIndex((s) => s.id === fromId);
  const to = state.scenarios.findIndex((s) => s.id === toId);
  if (from < 0 || to < 0) return;
  const [moved] = state.scenarios.splice(from, 1);
  state.scenarios.splice(to, 0, moved);
  localStorage.setItem('am.shell.order', JSON.stringify(state.scenarios.map((s) => s.id)));
  renderTabs();
}

async function switchScenario(id) {
  if (!id) return;
  // 先收掉所有展开的面板：否则旧面板的占位格、resize/ESC 监听会残留到新场景
  collapsePanel();
  cleanup(); // 切场景 = 整块重建：撤掉上一场景的定时器与监听器
  state.currentId = id;
  localStorage.setItem('am.shell.last', id);
  renderTabs();

  try {
    const scenario = await host.getScenario(id);
    state.scenario = scenario;
    el.grid.style.setProperty('--cols', scenario.cols || 6);
    el.grid.replaceChildren();

    (scenario.panels || []).forEach((panel, index) => {
      el.grid.appendChild(buildPanel(panel, scenario, index));
    });

    setStatus(`场景「${scenario.name}」 · ${(scenario.panels || []).length} 个面板`, `${host.mode} 模式`);

    // 报告"渲染完成"：Electron 模式写 shell.log，浏览器模式在控制台留一行
    if (host.reportReady) {
      host.reportReady({
        tabs: state.scenarios.length,
        current: scenario.id,
        panels: (scenario.panels || []).length,
      });
    } else {
      console.info(`[shell] renderer ready tabs=${state.scenarios.length} current=${scenario.id} panels=${(scenario.panels || []).length}`);
    }
  } catch (err) {
    el.grid.replaceChildren(h('div', { class: 'empty-state error-state', text: `场景加载失败：${err.message}` }));
  }
}

function buildPanel(panel, scenario, index) {
  const sub = h('span', { class: 'panel-sub', text: panel.sub || '' });
  const body = h('div', { class: 'panel-body' });
  const expandBtn = h('button', {
    class: 'icon-btn',
    text: '▲',
    title: '展开到最高（再点一次收起，Esc 退出）',
    'data-testid': 'panel-expand',
  });

  const head = h('div', { class: 'panel-head' }, [
    h('span', { class: 'panel-idx', text: String(index + 1).padStart(2, '0') }),
    h('span', { class: 'panel-title', text: panel.title || panel.id }),
    sub,
    h('div', { class: 'panel-actions' }, [expandBtn]),
  ]);

  const node = h('div', {
    class: 'panel',
    style: gridStyle(panel),
    'data-panel': panel.id,
  }, [head, body]);

  expandBtn.addEventListener('click', () => toggleExpand(node, expandBtn));

  // iframe 面板：外层不滚，让里面的应用自己滚
  if (panel.type === 'view') body.classList.add('is-frame');

  const ctx = { setSub: (text) => (sub.textContent = text) };
  const renderer = PANEL_RENDERERS[panel.type];
  if (!renderer) {
    body.appendChild(h('div', { class: 'empty-state', text: `未知面板类型：${panel.type}` }));
    return node;
  }

  Promise.resolve(renderer(body, panel, ctx)).catch((err) => {
    body.replaceChildren(h('div', { class: 'empty-state error-state', text: `面板渲染失败：${err.message}` }));
  });
  return node;
}

function gridStyle(panel) {
  if (!panel.col && !panel.row) return ''; // 不写坐标交给自动排版
  const parts = [];
  if (panel.col) parts.push(`grid-column: ${panel.col} / span ${panel.w || 2}`);
  if (panel.row) parts.push(`grid-row: ${panel.row} / span ${panel.h || 2}`);
  return parts.join(';');
}

// ---------------------------------------------------------------- 顶栏与启动

async function pollHealth() {
  try {
    const status = await host.health();
    const ok = status.api && status.web;
    el.health.className = `health ${ok ? 'ok' : 'bad'}`;
    el.health.textContent = ok
      ? '后端 · 前端 正常'
      : `异常：API ${status.api ? 'ok' : 'down'} / 前端 ${status.web ? 'ok' : 'down'}`;
  } catch (err) {
    el.health.className = 'health bad';
    el.health.textContent = `健康检查失败`;
  }
}

function bindShortcuts() {
  window.addEventListener('keydown', (event) => {
    if (event.ctrlKey && !event.shiftKey && /^[1-9]$/.test(event.key)) {
      const index = Number(event.key) - 1;
      const target = state.scenarios[index];
      if (target) {
        event.preventDefault();
        switchScenario(target.id);
      }
    }
    if (event.ctrlKey && event.key.toLowerCase() === 'r') {
      event.preventDefault();
      switchScenario(state.currentId);
    }
  });
}

async function boot() {
  try {
    state.config = await host.config();
  } catch {
    /* 用默认值 */
  }

  try {
    state.token = await host.token();
  } catch (err) {
    console.warn('[shell] 取 token 失败，iframe 面板需要手动登录：', err.message);
  }

  try {
    const scenarios = await host.listScenarios();
    const saved = localStorage.getItem('am.shell.order');
    if (saved) {
      const order = JSON.parse(saved);
      scenarios.sort((a, b) => {
        const ia = order.indexOf(a.id);
        const ib = order.indexOf(b.id);
        return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
      });
    }
    state.scenarios = scenarios;
  } catch (err) {
    el.grid.replaceChildren(h('div', { class: 'empty-state error-state', text: `场景列表加载失败：${err.message}` }));
    return;
  }

  if (state.scenarios.length === 0) {
    el.grid.replaceChildren(h('div', { class: 'empty-state', text: 'scenarios/ 目录里还没有场景 JSON' }));
    return;
  }

  const last = localStorage.getItem('am.shell.last');
  const initial = state.scenarios.some((s) => s.id === last) ? last : state.scenarios[0].id;

  renderTabs();
  await switchScenario(initial);

  el.reload.addEventListener('click', () => switchScenario(state.currentId));
  bindShortcuts();
  await pollHealth();
  const timer = setInterval(pollHealth, 20000);
  window.addEventListener('beforeunload', () => clearInterval(timer));
}

boot();
