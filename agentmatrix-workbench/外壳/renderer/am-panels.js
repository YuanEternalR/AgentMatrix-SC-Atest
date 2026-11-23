/**
 * AgentMatrix 原生面板（注册进模板的 renderers）
 *
 * 原则：面板自己完成功能，**不嵌网页**。
 * 数据走主进程代理（window.am），用模板自己的 CSS 变量与字体，风格与外壳一致。
 *
 * 每个渲染器签名与模板一致：`(body, meta, head) => maybeCleanup`
 * 面板标题栏的「刷新」由模板负责重跑渲染器，这里不用管。
 */
(function () {
  'use strict';

  var R = window.__amPanels || (window.__amPanels = {});
  if (!R) {
    console.warn('[am] APP_RENDERERS 还没就绪，原生面板未注册');
    return;
  }

  // ---------------------------------------------------------------- 小工具

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function fmtTime(value) {
    if (!value) return '—';
    var d = new Date(value);
    if (isNaN(d.getTime())) return '—';
    var p = function (n) { return String(n).padStart(2, '0'); };
    return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  function fmtMoney(value) {
    var n = Number(value || 0);
    return '$' + n.toFixed(5);
  }

  // 策略编码 → 中文（界面不许出现 s2_weighted 这类编码）
  var STRATEGY_LABEL = {
    s0_all_large: '全用大模型',
    s1_fixed_rule: '固定规则',
    s2_weighted: '加权打分',
    s3_cost_aware: '成本优先',
    s4_llm_planner: '大模型规划',
  };
  function strategyText(code) {
    return STRATEGY_LABEL[code] || code || '—';
  }

  var STATUS = {
    succeeded: { label: '成功', cls: 'ok' },
    failed: { label: '失败', cls: 'err' },
    running: { label: '运行中', cls: 'run' },
    waiting_approval: { label: '待审批', cls: 'warn' },
    queued: { label: '排队中', cls: 'dim' },
    cancelled: { label: '已取消', cls: 'dim' },
    pending: { label: '待处理', cls: 'warn' },
    completed: { label: '已完成', cls: 'ok' },
  };

  function statusOf(code) {
    return STATUS[code] || { label: code || '—', cls: 'dim' };
  }

  function badge(code) {
    var s = statusOf(code);
    return el('span', 'am-badge ' + s.cls, s.label);
  }

  /** 自绘 tooltip：原生 title 又慢又丑，且和深色界面不搭。全局单例。 */
  var tipNode = null;
  function tip() {
    if (!tipNode) {
      tipNode = document.createElement('div');
      tipNode.className = 'am-tip';
      document.body.appendChild(tipNode);
    }
    return {
      show: function (target, html) {
        tipNode.innerHTML = html;
        tipNode.classList.add('on');
        var rect = target.getBoundingClientRect();
        var width = 300;
        var left = Math.min(window.innerWidth - width - 12, Math.max(8, rect.left));
        var top = rect.bottom + 8;
        if (top + 140 > window.innerHeight) top = Math.max(8, rect.top - 8 - tipNode.offsetHeight);
        tipNode.style.left = left + 'px';
        tipNode.style.top = top + 'px';
      },
      hide: function () {
        if (tipNode) tipNode.classList.remove('on');
      },
    };
  }

  /** 统一的加载/错误/空态 */
  /** 把二维数据转成 CSV 文本（带 BOM，Excel 打开不乱码） */
  function toCsv(cols, rows) {
    var pick = function (row, c) {
      var v = c.csv ? c.csv(row) : (typeof c.render === 'function' ? c.render(row) : row[c.key]);
      if (v instanceof Node) return v.textContent || '';
      return v == null ? '' : String(v);
    };
    var esc = function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; };
    var lines = [cols.map(function (c) { return esc(c.label); }).join(',')];
    (rows || []).forEach(function (row) {
      lines.push(cols.map(function (c) { return esc(pick(row, c)); }).join(','));
    });
    return '\uFEFF' + lines.join('\r\n');
  }

  function download(filename, content, mime) {
    var blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  function csvButton(cols, rows, opts) {
    var b = el('button', 'am-act', '导出 CSV');
    b.addEventListener('click', function (ev) {
      ev.stopPropagation();
      var name = (opts && opts.filename) || 'export';
      download(name + '-' + new Date().toISOString().slice(0, 10) + '.csv', toCsv(cols, rows));
    });
    return b;
  }

  /** SVG → PNG（用于趋势图导出），不引第三方库 */
  function exportSvgAsPng(svg, filename) {
    var clone = svg.cloneNode(true);
    var box = svg.getBoundingClientRect();
    var w = Math.max(320, Math.round(box.width || 600));
    var h = Math.max(160, Math.round(box.height || 240));
    clone.setAttribute('width', String(w));
    clone.setAttribute('height', String(h));
    clone.setAttribute('style', 'background:#131722');
    var xml = new XMLSerializer().serializeToString(clone);
    var img = new Image();
    var svgUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
    img.onload = function () {
      var canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#131722';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(function (blob) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename + '.png';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      });
    };
    img.src = svgUrl;
  }
  function state(wrap, kind, text) {
    wrap.innerHTML = '';
    var box = el('div', 'am-state ' + kind, text);
    wrap.appendChild(box);
  }

  /** 表格：cols = [{key,label,width,render}] */
  /**
   * 表格。exportOpts = { filename } 时在顶部给一个「导出 CSV」按钮（CSV 字符串 + Blob 下载，不依赖库）。
   */
  function table(cols, rows, onRow, exportOpts) {
    var box = el('div', 'am-table-wrap');
    var t = el('table', 'am-table');
    var thead = el('thead');
    var tr = el('tr');
    cols.forEach(function (c) {
      var th = el('th', null, c.label);
      if (c.width) th.style.width = c.width;
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    t.appendChild(thead);

    var tbody = el('tbody');
    rows.forEach(function (row) {
      var r = el('tr');
      if (onRow) {
        r.classList.add('clickable');
        r.addEventListener('click', function () { onRow(row, r); });
      }
      cols.forEach(function (c) {
        var td = el('td');
        if (c.nowrap) td.classList.add('am-nowrap');
        var value = c.render ? c.render(row) : row[c.key];
        if (value instanceof Node) td.appendChild(value);
        else td.textContent = value == null ? '—' : String(value);
        r.appendChild(td);
      });
      tbody.appendChild(r);
    });
    t.appendChild(tbody);
    if (exportOpts) {
      var bar = el('div', 'am-export-bar');
      bar.appendChild(csvButton(cols, exportOpts.getRows ? exportOpts.getRows() : rows, exportOpts));
      box.appendChild(bar);
    }
    box.appendChild(t);
    return box;
  }

  /** 详情抽屉（面板内展开，不跳浏览器） */
  function drawer() {
    var box = el('div', 'am-drawer');
    box.style.display = 'none';
    var close = el('button', 'am-drawer-close', '收起');
    // 关闭只隐藏：之前把 innerHTML 清空，连 .am-drawer-body 一起删了，
    // 之后再点其他行时 show() 往一个已经脱离文档的节点里写 → 面板看起来"没反应/报错"。
    close.addEventListener('click', function () {
      box.style.display = 'none';
      content.innerHTML = '';
    });
    box.appendChild(close);
    var content = el('div', 'am-drawer-body');
    box.appendChild(content);
    function reveal() {
      box.style.display = 'block';
      box.scrollIntoView({ block: 'nearest' });
    }
    return {
      node: box,
      show: function (nodes) {
        content.innerHTML = '';
        nodes.forEach(function (n) { content.appendChild(n); });
        reveal();
      },
      /** 追加内容（比如先显示概要，再补上异步取到的步骤） */
      append: function (nodes) {
        nodes.forEach(function (n) { content.appendChild(n); });
        reveal();
      },
    };
  }

  function kvList(pairs) {
    var list = el('div', 'am-kv-list');
    pairs.forEach(function (p) {
      if (p[1] == null || p[1] === '') return;
      var row = el('div', 'am-kv');
      row.appendChild(el('span', 'am-k', p[0]));
      row.appendChild(el('span', 'am-v', String(p[1])));
      list.appendChild(row);
    });
    return list;
  }

  // ---------------------------------------------------------------- 快照 KPI

  R['am-kpi'] = function (body) {
    body.classList.add('am-body');
    var wrap = el('div', 'am-kpi');
    body.appendChild(wrap);
    var timer = null;
    var disposed = false;

    function paint(ctx) {
      if (disposed) return;
      var m = ctx.matrix || {};
      var tasks = ctx.tasks || {};
      var runs = ctx.runs_24h || {};
      wrap.innerHTML = '';

      var grid = el('div', 'am-kpi-grid');
      [
        { label: '待审批', value: ctx.pending_approvals || 0, tone: (ctx.pending_approvals || 0) > 0 ? 'warn' : '' },
        { label: '24 小时成功', value: runs.succeeded || 0, tone: 'ok' },
        { label: '失败', value: tasks.failed || 0, tone: (tasks.failed || 0) > 0 ? 'err' : '' },
        { label: '死信积压', value: ctx.pending_dead_letters || 0, tone: (ctx.pending_dead_letters || 0) > 0 ? 'warn' : '' },
      ].forEach(function (item) {
        var card = el('div', 'am-kpi-card');
        card.appendChild(el('div', 'am-kpi-label', item.label));
        card.appendChild(el('div', 'am-kpi-value ' + item.tone, String(item.value)));
        grid.appendChild(card);
      });
      wrap.appendChild(grid);

      var cover = el('div', 'am-cover');
      var pct = Math.round((m.coverage || 0) * 100);
      cover.appendChild(el('div', 'am-cover-head', '矩阵覆盖 ' + (m.covered_cells || 0) + '/' + (m.total_cells || 0) + '（' + pct + '%）'));
      var bar = el('div', 'am-bar');
      var fill = el('div', 'am-bar-fill');
      fill.style.width = pct + '%';
      bar.appendChild(fill);
      cover.appendChild(bar);
      wrap.appendChild(cover);

      var chips = el('div', 'am-chips');
      chips.appendChild(el('span', 'am-chip', '策略 ' + strategyText(ctx.dispatch && ctx.dispatch.strategy)));
      chips.appendChild(el('span', 'am-chip', '缺口 ' + (m.gap_count || 0) + ' 格'));
      (ctx.recent_failures || []).slice(0, 2).forEach(function (f) {
        chips.appendChild(el('span', 'am-chip err', (f.run_id || '') + ' ' + (f.error_code || '')));
      });
      wrap.appendChild(chips);

      var foot = el('div', 'am-foot', '更新于 ' + fmtTime(new Date().toISOString()));
      wrap.appendChild(foot);
    }

    function load() {
      window.am.get('/workbench/context')
        .then(paint)
        .catch(function (err) { state(wrap, 'err', '取快照失败：' + (err && err.message ? err.message : err)); });
    }

    load();
    timer = setInterval(load, 30000);
    return function () { disposed = true; if (timer) clearInterval(timer); };
  };

  // ---------------------------------------------------------------- 任务列表

  R['am-tasks'] = function (body) {
    body.classList.add('am-body');
    var wrap = el('div', 'am-list');
    body.appendChild(wrap);
    var filter = '';
    var d = drawer();

    var tabs = el('div', 'am-tabs');
    [
      { key: '', label: '全部' },
      { key: 'waiting_approval', label: '待审批' },
      { key: 'failed', label: '失败' },
      { key: 'succeeded', label: '已完成' },
    ].forEach(function (t) {
      var b = el('button', 'am-tab' + (t.key === filter ? ' active' : ''), t.label);
      b.dataset.key = t.key;
      b.addEventListener('click', function () {
        filter = t.key;
        Array.prototype.forEach.call(tabs.children, function (x) { x.classList.toggle('active', x.dataset.key === filter); });
        load();
      });
      tabs.appendChild(b);
    });
    wrap.appendChild(tabs);

    var listBox = el('div', 'am-scroll');
    wrap.appendChild(listBox);
    body.appendChild(d.node);

    function load() {
      state(listBox, 'loading', '加载中…');
      var q = '/tasks?limit=60' + (filter ? '&status=' + encodeURIComponent(filter) : '');
      window.am.get(q)
        .then(function (rows) {
          if (!rows || !rows.length) return state(listBox, 'dim', '这个筛选条件下没有任务');
          listBox.innerHTML = '';
          listBox.appendChild(table([
            { label: '任务', render: function (r) { return r.title; } },
            { label: '状态', width: '88px', render: function (r) { return badge(r.status); } },
            { label: '优先级', width: '64px', render: function (r) { return 'P' + r.priority; } },
            { label: '工作流', width: '150px', render: function (r) { return r.workflow_name || '—'; } },
            { label: '来源', width: '56px', render: function (r) {
              var from = r.payload && r.payload._source;
              return from === 'dsh' ? el('span', 'am-badge run', 'DSH') : el('span', 'am-badge dim', '界面');
            } },
            { label: '创建', width: '96px', nowrap: true, render: function (r) { return fmtTime(r.created_at); } },
          ], rows, function (row) {
            d.show([
              el('div', 'am-drawer-title', row.title),
              kvList([
                ['任务编号', row.id],
                ['状态', statusOf(row.status).label],
                ['优先级', 'P' + row.priority],
                ['复杂度', row.complexity_hint],
                ['工作流', row.workflow_name || '—'],
                ['所需能力', (row.required_capabilities || []).join('、') || '—'],
                ['业务参数', JSON.stringify(row.payload || {}, null, 0)],
              ]),
            ]);
          }, { filename: 'tasks' }));
        })
        .catch(function (err) { state(listBox, 'err', '加载失败：' + (err && err.message ? err.message : err)); });
    }

    load();
  };

  // ---------------------------------------------------------------- 运行监控

  R['am-runs'] = function (body) {
    body.classList.add('am-body');
    var wrap = el('div', 'am-list');
    body.appendChild(wrap);
    var d = drawer();
    var listBox = el('div', 'am-scroll');
    wrap.appendChild(listBox);
    body.appendChild(d.node);
    var timer = null;

    function load() {
      window.am.get('/runs?limit=60')
        .then(function (rows) {
          if (!rows || !rows.length) return state(listBox, 'dim', '还没有运行记录');
          listBox.innerHTML = '';
          listBox.appendChild(table([
            { label: '运行', width: '110px', render: function (r) { return (r.id || '').slice(0, 10); } },
            { label: '状态', width: '86px', render: function (r) { return badge(r.status); } },
            { label: '触发', width: '64px', render: function (r) { return r.trigger; } },
            { label: '成本', width: '90px', render: function (r) { return fmtMoney(r.cost_usd); } },
            { label: '开始', width: '96px', nowrap: true, render: function (r) { return fmtTime(r.started_at || r.created_at); } },
          ], rows, function (row) {
            d.show([el('div', 'am-drawer-title', '运行 ' + (row.id || '').slice(0, 10)),
              kvList([
                ['运行编号', row.id],
                ['状态', statusOf(row.status).label],
                ['错误码', row.error_code || '—'],
                ['触发方式', row.trigger],
                ['trace_id', row.trace_id],
                ['Token', (row.token_input || 0) + ' 入 / ' + (row.token_output || 0) + ' 出'],
                ['成本', fmtMoney(row.cost_usd)],
                ['开始', fmtTime(row.started_at)],
                ['结束', fmtTime(row.finished_at)],
              ])]);
            window.am.get('/runs/' + row.id).then(function (detail) {
              var steps = (detail && detail.steps) || [];
              if (!steps.length) return;

              // 失败原因：第一条失败步骤的 error.message —— 这才是"为什么失败"的答案
              var failedStep = steps.filter(function (s) { return s.status === 'failed'; })[0];
              var extra = [];
              if (failedStep) {
                var reason = el('div', 'am-reason');
                reason.appendChild(el('div', 'am-reason-title', '失败原因'));
                reason.appendChild(el('div', 'am-reason-body',
                  (failedStep.error && failedStep.error.message) || '（这一步没有返回错误说明）'));
                reason.appendChild(el('div', 'am-foot',
                  '节点 ' + (failedStep.node_id || '—')
                  + ' · 类型 ' + (failedStep.node_type || '—')
                  + ' · 错误码 ' + ((failedStep.error && failedStep.error.code) || row.error_code || '—')));
                extra.push(reason);
              }

              var box = el('div', 'am-steps');
              box.appendChild(el('div', 'am-step-head', '步骤轨迹（按执行顺序）'));
              steps.forEach(function (s) {
                var line = el('div', 'am-step');
                line.appendChild(badge(s.status));
                line.appendChild(el('span', 'am-step-name',
                  (s.node_id || '（无节点 id）') + ' · ' + (s.node_type || '')
                  + (s.attempt > 1 ? ' · 第 ' + s.attempt + ' 次' : '')));

                var ms = '';
                if (s.started_at && s.finished_at) {
                  var diff = new Date(s.finished_at) - new Date(s.started_at);
                  ms = (diff >= 1000 ? (diff / 1000).toFixed(1) + ' s' : diff + ' ms');
                }
                line.appendChild(el('span', 'am-step-meta', ms));
                if (s.error && s.error.message) {
                  line.appendChild(el('span', 'am-step-err', s.error.message));
                }
                box.appendChild(line);
              });
              extra.push(box);
              d.append(extra);
            }).catch(function () { /* 步骤拉不到就只显示概要 */ });
          }, { filename: 'runs' }));
        })
        .catch(function (err) { state(listBox, 'err', '加载失败：' + (err && err.message ? err.message : err)); });
    }

    load();
    timer = setInterval(load, 30000);
    return function () { if (timer) clearInterval(timer); };
  };

  // ---------------------------------------------------------------- 审计日志

  R['am-audit'] = function (body) {
    body.classList.add('am-body');
    var wrap = el('div', 'am-list');
    body.appendChild(wrap);
    var d = drawer();

    var bar = el('div', 'am-filter-bar');
    var select = el('select', 'am-select');
    var optAll = el('option', null, '全部动作');
    optAll.value = '';
    select.appendChild(optAll);
    bar.appendChild(select);
    var count = el('span', 'am-foot', '');
    bar.appendChild(count);
    wrap.appendChild(bar);

    var listBox = el('div', 'am-scroll');
    wrap.appendChild(listBox);
    body.appendChild(d.node);

    window.am.get('/audit-logs/summary').then(function (sum) {
      (sum.actions || []).forEach(function (a) {
        var o = el('option', null, a.label);
        o.value = a.action;
        select.appendChild(o);
      });
    }).catch(function () { /* 摘要拉不到就不给筛选 */ });

    function load() {
      var action = select.value;
      var q = '/audit-logs?limit=80' + (action ? '&action=' + encodeURIComponent(action) : '');
      window.am.get(q)
        .then(function (rows) {
          count.textContent = '共 ' + (rows ? rows.length : 0) + ' 条';
          if (!rows || !rows.length) return state(listBox, 'dim', '没有匹配的审计记录');
          listBox.innerHTML = '';
          listBox.appendChild(table([
            { label: '时间', width: '96px', nowrap: true, render: function (r) { return fmtTime(r.created_at); } },
            { label: '操作者', width: '96px', render: function (r) { return r.actor_name || '—'; } },
            { label: '动作', width: '110px', render: function (r) { return r.action_label || r.action; } },
            { label: '对象', width: '104px', render: function (r) { return r.resource_type_label || r.resource_type || '—'; } },
            { label: '摘要', render: function (r) { return r.summary || ''; } },
          ], rows, function (row) {
            d.show([el('div', 'am-drawer-title', row.action_label || row.action),
              kvList([
                ['时间', fmtTime(row.created_at)],
                ['操作者', (row.actor_name || '') + '（' + (row.actor_role_label || row.actor_role || '') + '）'],
                ['动作', row.action],
                ['对象', (row.resource_type_label || row.resource_type || '') + ' ' + (row.resource_id || '')],
                ['来源 IP', row.ip],
                ['摘要', row.summary],
                ['变更前', row.before ? JSON.stringify(row.before) : '—'],
                ['变更后', row.after ? JSON.stringify(row.after) : '—'],
              ])]);
          }, { filename: 'audit-logs' }));
        })
        .catch(function (err) { state(listBox, 'err', '加载失败：' + (err && err.message ? err.message : err)); });
    }

    select.addEventListener('change', load);
    load();
  };

  // ---------------------------------------------------------------- 能力矩阵

  R['am-matrix'] = function (body) {
    body.classList.add('am-body');
    var wrap = el('div', 'am-matrix');
    body.appendChild(wrap);
    var d = drawer();
    body.appendChild(d.node);

    /** 点缺口：说清"缺什么、怎么补"，并给一个直达新建面板的按钮 */
    function openGap(stageName, catName, stageCode, catCode) {
      var goCreate = el('button', 'am-act ok', '去「新建」面板建智能体');
      goCreate.addEventListener('click', function () {
        if (window.__dshGoScene) window.__dshGoScene('overview');
      });
      d.show([
        el('div', 'am-drawer-title', stageName + ' × ' + catName + '：没有智能体'),
        kvList([
          ['缺什么', '这一格要求的能力标签，目前没有任何智能体覆盖'],
          ['影响', '派到这类任务时，这一格没人接，调度只能拒绝或降级'],
          ['怎么补', '新建一个智能体，把能力标签填成该格对应的能力；或在已有智能体上补这个标签'],
          ['阶段 / 能力码', stageCode + ' / ' + catCode],
        ]),
        (function () { var box = el('div', 'am-gap-actions'); box.appendChild(goCreate); return box; })(),
      ]);
    }

    window.am.get('/matrix').then(function (m) {
      var head = el('div', 'am-matrix-head');
      var pct = Math.round((m.coverage || 0) * 100);
      head.appendChild(el('div', 'am-cover-head', '覆盖率 ' + pct + '%（' + m.covered_cells + '/' + m.total_cells + '）· 缺口 ' + m.gap_count + ' 格'));
      var bar = el('div', 'am-bar');
      var fill = el('div', 'am-bar-fill');
      fill.style.width = pct + '%';
      bar.appendChild(fill);
      head.appendChild(bar);
      wrap.appendChild(head);

      var cells = {};
      (m.cells || []).forEach(function (c) { cells[c.stage + '|' + c.category] = c; });

      var grid = el('div', 'am-matrix-grid');
      grid.style.gridTemplateColumns = '96px repeat(' + m.categories.length + ', minmax(0, 1fr))';
      grid.appendChild(el('div', 'am-mx-corner', '阶段 \\ 能力'));
      m.categories.forEach(function (cat) {
        grid.appendChild(el('div', 'am-mx-colhead', cat.label || cat.code || cat));
      });
      m.stages.forEach(function (st) {
        grid.appendChild(el('div', 'am-mx-rowhead', st.label || st.code || st));
        m.categories.forEach(function (cat) {
          var key = (st.code || st.stage || st) + '|' + (cat.code || cat.category || cat);
          var cell = cells[key] || {};
          var agents = cell.agents || [];
          var node = el('div', 'am-mx-cell' + (agents.length ? ' filled' : ' gap'));
          var stageName = st.label || st.code;
          var catName = cat.label || cat.code;
          var box = tip();
          if (agents.length) {
            node.textContent = String(agents.length);
            node.addEventListener('mouseenter', function () {
              box.show(node, '<b>' + stageName + ' × ' + catName + '</b><br><span class="am-tip-dim">可派活的智能体</span><br>'
                + agents.map(function (a) { return '· ' + (a.name || a.code) + '（' + (a.tier_label || a.model_tier || '') + '）'; }).join('<br>'));
            });
            node.addEventListener('mouseleave', function () { box.hide(); });
          } else {
            node.textContent = '缺';
            node.classList.add('clickable');
            node.addEventListener('mouseenter', function () {
              box.show(node, '<b>' + stageName + ' × ' + catName + '</b><br>'
                + '<span class="am-tip-dim">没有任何智能体带这个能力，派活时这一格会空着</span><br>'
                + '点一下看补齐建议');
            });
            node.addEventListener('mouseleave', function () { box.hide(); });
            node.addEventListener('click', function () {
              box.hide();
              openGap(stageName, catName, st.code || st, cat.code || cat);
            });
          }
          grid.appendChild(node);
        });
      });
      wrap.appendChild(grid);

      if ((m.gaps || []).length) {
        var gaps = el('div', 'am-chips');
        gaps.appendChild(el('span', 'am-chip', '优先补这几格：'));
        m.gaps.slice(0, 6).forEach(function (g) {
          gaps.appendChild(el('span', 'am-chip err', (g.stage_label || g.stage) + ' × ' + (g.category_label || g.category)));
        });
        wrap.appendChild(gaps);
      }
    }).catch(function (err) { state(wrap, 'err', '加载失败：' + (err && err.message ? err.message : err)); });
  };

  // ---------------------------------------------------------------- 场景助手

  R['am-assistant'] = function (body, meta) {
    body.classList.add('am-body');
    var scene = (meta && (meta.scenario || meta.scenarioId || meta.id)) || 'overview';
    var wrap = el('div', 'am-chat');
    body.appendChild(wrap);

    var facts = el('div', 'am-chat-facts', '正在读取快照…');
    wrap.appendChild(facts);
    var log = el('div', 'am-chat-log');
    wrap.appendChild(log);

    var hints = el('div', 'am-chips');
    ['现在最该处理什么？', '最近失败的运行是什么原因？', '哪些能力格子还是空的？'].forEach(function (h) {
      var b = el('button', 'am-hint', h);
      b.addEventListener('click', function () { ask(h); });
      hints.appendChild(b);
    });
    wrap.appendChild(hints);

    var inputRow = el('div', 'am-chat-input');
    var input = el('textarea');
    input.placeholder = '问这个场景（Enter 发送）';
    var send = el('button', 'am-send', '发送');
    inputRow.appendChild(input);
    inputRow.appendChild(send);
    wrap.appendChild(inputRow);

    window.am.get('/workbench/context').then(function (ctx) {
      var m = ctx.matrix || {};
      var runs = ctx.runs_24h || {};
      facts.textContent = '快照：待审批 ' + (ctx.pending_approvals || 0)
        + ' · 24h 成功 ' + (runs.succeeded || 0)
        + ' · 失败 ' + ((ctx.tasks && ctx.tasks.failed) || 0)
        + ' · 覆盖 ' + (m.covered_cells || 0) + '/' + (m.total_cells || 0)
        + ' · 策略 ' + strategyText(ctx.dispatch && ctx.dispatch.strategy);
    }).catch(function () { facts.textContent = '快照读取失败（后端没起来？）'; });

    function push(cls, text) {
      var node = el('div', 'am-msg ' + cls, text);
      log.appendChild(node);
      log.scrollTop = log.scrollHeight;
      return node;
    }

    function ask(question) {
      if (!question) return;
      input.value = '';
      push('user', question);
      var pending = push('dim', '正在分析…');
      send.disabled = true;
      window.am.post('/workbench/ask', { scenario: scene, question: question })
        .then(function (res) {
          pending.remove();
          if (!res || !res.ok) {
            push('err', '调用失败：' + ((res && res.error) || '未知原因'));
            return;
          }
          push('assistant', res.answer);
          push('meta', res.provider + '/' + res.model + ' · ' + res.tokens + ' tokens · ' + fmtMoney(res.cost_usd) + ' · ' + res.duration_ms + 'ms');
        })
        .catch(function (err) { pending.remove(); push('err', '请求失败：' + (err && err.message ? err.message : err)); })
        .then(function () { send.disabled = false; input.focus(); });
    }

    send.addEventListener('click', function () { ask(input.value.trim()); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        ask(input.value.trim());
      }
    });
    input.focus();
  };

  // 供第二批面板（am-panels2.js）复用，避免复制一份工具函数
  window.__am = {
    el: el,
    table: table,
    state: state,
    badge: badge,
    statusOf: statusOf,
    fmtTime: fmtTime,
    fmtMoney: fmtMoney,
    drawer: drawer,
    kvList: kvList,
    strategyText: strategyText,
    STRATEGY_LABEL: STRATEGY_LABEL,
    toCsv: toCsv,
    csvButton: csvButton,
    tip: tip,
    download: download,
    exportSvgAsPng: exportSvgAsPng,
  };


  // —— 注册表守护 ——
  // 模板的「刷新当前场景」会重新注入 renderers.js，生成新的 APP_RENDERERS 对象。
  // 这里把 window.APP_RENDERERS 改成访问器：每次被赋值就把我们所有原生面板拷进去。
  var registry = window.APP_RENDERERS || {};

  function applyAll(target) {
    if (!target) return target;
    Object.keys(window.__amPanels).forEach(function (key) {
      target[key] = window.__amPanels[key];
    });
    return target;
  }

  function syncInto() {
    applyAll(registry);
  }
  syncInto();
  // panels2 / panels3 注册完之后调用它，把新面板补进当前注册表
  window.__amSync = syncInto;
  try {
    Object.defineProperty(window, 'APP_RENDERERS', {
      configurable: true,
      get: function () { return registry; },
      set: function (next) { if (next) registry = next; syncInto(); },
    });
  } catch (err) {
    console.warn('[am] 注册表访问器安装失败，刷新后可能需要重启：' + err.message);
  }

  console.log('[am] 原生面板已注册：' + Object.keys(R).filter(function (k) { return k.indexOf('am-') === 0; }).join(', '));
})();
