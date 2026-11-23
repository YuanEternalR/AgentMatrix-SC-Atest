/**
 * AgentMatrix 原生面板 · 第三批
 *
 *   am-designer —— 工作流设计器（拖拽摆位、改节点、连线、校验、发布新版本）
 *   am-create   —— 新建任务 / 技能 / 智能体（三个页签，字段驱动的表单）
 *
 * 仍然是同一条原则：面板自己完成功能，不嵌网页；数据走 window.am。
 */
(function () {
  'use strict';

  var R = window.__amPanels || (window.__amPanels = {});
  var A = window.__am;
  if (!R || !A) return;

  var el = A.el;
  var state = A.state;
  var kvList = A.kvList;

  // ---------------------------------------------------------------- 工作流设计器

  var NODE_TYPES = [
    { value: 'start', label: '开始' },
    { value: 'skill', label: '技能' },
    { value: 'agent', label: '智能体' },
    { value: 'condition', label: '条件' },
    { value: 'approval', label: '审批' },
    { value: 'notify', label: '通知' },
    { value: 'end', label: '结束' },
  ];

  R['am-designer'] = function (body, meta) {
    body.classList.add('am-body');
    var wrap = el('div', 'am-designer');
    body.appendChild(wrap);

    var state_ = { code: '', graph: null, nodes: [], dirty: false, workflows: [] };

    function markDirty() {
      state_.dirty = true;
      var badgeEl = wrap.querySelector('.am-dirty');
      if (badgeEl) badgeEl.textContent = '未发布';
    }

    // 纵向布局：层 = 深度（y），同层按出现顺序横排（x）。
    // 横向排布在窄面板里会一路向右溢出，纵向更像流程图、也更好读。
    function layout() {
      var byId = {};
      state_.nodes.forEach(function (n) { byId[n.id] = n; });
      var level = {};
      var order = [];
      var start = state_.graph.entry || (state_.nodes[0] && state_.nodes[0].id);
      var queue = [start];
      var seen = {};
      while (queue.length) {
        var id = queue.shift();
        if (!id || seen[id] || !byId[id]) continue;
        seen[id] = true;
        if (level[id] == null) level[id] = 0;
        order.push(id);
        var node = byId[id];
        [node.next, node.on_true, node.on_false].forEach(function (target) {
          if (target && byId[target]) {
            if (level[target] == null) level[target] = level[id] + 1;
            queue.push(target);
          }
        });
      }
      state_.nodes.forEach(function (n) {
        if (level[n.id] == null) { level[n.id] = 0; order.push(n.id); }
      });

      var perLevel = {};
      var pos = {};
      order.forEach(function (id) {
        var lv = level[id];
        perLevel[lv] = (perLevel[lv] || 0) + 1;
        var idx = perLevel[lv] - 1;
        pos[id] = { x: 28 + idx * 176, y: 26 + lv * 92 };
      });
      return pos;
    }
    function draw() {
      var pos = layout();
      wrap.innerHTML = '';

      // 工作流下拉：每次重绘都重建。之前只在首次加载时插一次，重绘后被清空，
      // 表现就是"下拉框选了没反应"。
      if (state_.workflows.length) {
        var picker = el('select', 'am-select am-workflow-picker');
        state_.workflows.forEach(function (w) {
          var o = el('option', null, w.name);
          o.value = w.code;
          picker.appendChild(o);
        });
        picker.value = state_.code;
        picker.addEventListener('change', function () {
          state_.code = picker.value;
          state_.dirty = false;
          load();
        });
        wrap.appendChild(picker);
      }

      var head = el('div', 'am-designer-head');
      head.appendChild(el('span', 'am-designer-title', state_.graph.name || state_.code));
      head.appendChild(el('span', 'am-dirty', state_.dirty ? '未发布' : '已同步'));
      var spacer = el('span', 'am-foot');
      head.appendChild(spacer);
      wrap.appendChild(head);

      var toolbar = el('div', 'am-designer-tools');
      var typeSelect = el('select', 'am-select');
      NODE_TYPES.forEach(function (t) {
        var o = el('option', null, t.label);
        o.value = t.value;
        typeSelect.appendChild(o);
      });
      toolbar.appendChild(typeSelect);
      var addBtn = el('button', 'am-act', '加节点');
      addBtn.addEventListener('click', function () {
        var id = 'n' + (state_.nodes.length + 1) + '_' + Math.random().toString(36).slice(2, 5);
        var node = { id: id, type: typeSelect.value };
        if (node.type === 'skill') node.skill = '';
        if (node.type === 'agent') node.agent_code = '$dispatch';
        if (node.type === 'condition') node.expr = 'score.worst_score >= 60';
        if (node.type === 'approval') node.role = 'operator';
        state_.nodes.push(node);
        markDirty();
        draw();
      });
      toolbar.appendChild(addBtn);

      var validateBtn = el('button', 'am-act', '校验');
      validateBtn.addEventListener('click', function () {
        window.am.post('/workflows/' + state_.code + '/validate', { graph: buildGraph() })
          .then(function (res) {
            var errs = (res && res.errors) || [];
            var warns = (res && res.warnings) || [];
            showResult('校验' + (res && res.ok ? '通过' : '未通过'),
              '错误 ' + errs.length + ' 条 · 警告 ' + warns.length + ' 条'
              + (errs.length ? '\n' + errs.join('\n') : '')
              + (warns.length ? '\n' + warns.join('\n') : ''));
          })
          .catch(function (err) { showResult('校验失败', err.message); });
      });
      toolbar.appendChild(validateBtn);

      var publishBtn = el('button', 'am-act ok', '发布新版本');
      publishBtn.addEventListener('click', function () {
        var changelog = window.prompt('这次改了什么？（写进版本日志）', '工作台里调整了流程');
        if (changelog == null) return;
        window.am.post('/workflows/' + state_.code + '/versions', { graph: buildGraph(), changelog: changelog })
          .then(function () {
            state_.dirty = false;
            showResult('已发布', '新版本已生成，列表里点「刷新」可见');
            draw();
          })
          .catch(function (err) { showResult('发布失败', err.message); });
      });
      toolbar.appendChild(publishBtn);

      var resetBtn = el('button', 'am-act dim', '重新加载');
      resetBtn.addEventListener('click', function () { load(); });
      toolbar.appendChild(resetBtn);
      wrap.appendChild(toolbar);

      // 画布
      var canvas = el('div', 'am-canvas');
      var NS = 'http://www.w3.org/2000/svg';
      var svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('class', 'am-canvas-svg');
      var maxX = 40, maxY = 24;
      state_.nodes.forEach(function (n) {
        var p = pos[n.id];
        maxX = Math.max(maxX, p.x + 176);
        maxY = Math.max(maxY, p.y + 84);
      });
      svg.setAttribute('viewBox', '0 0 ' + (maxX + 40) + ' ' + (maxY + 40));

      canvas.appendChild(svg);

      state_.nodes.forEach(function (n) {
        var p = pos[n.id];
        var card = el('div', 'am-node am-node-' + n.type);
        card.style.left = p.x + 'px';
        card.style.top = p.y + 'px';
        card.dataset.id = n.id;
        var title = el('div', 'am-node-id', n.id);
        card.appendChild(title);
        var label = el('div', 'am-node-type');
        var typeInfo = NODE_TYPES.filter(function (t) { return t.value === n.type; })[0];
        label.textContent = typeInfo ? typeInfo.label : n.type;
        card.appendChild(label);
        var detail = n.skill || n.agent_code || n.expr || n.role || '';
        if (detail) card.appendChild(el('div', 'am-node-detail', detail));

        // 拖动摆位（只影响本地展示，不改图结构）
        card.addEventListener('mousedown', function (ev) {
          ev.preventDefault();
          var startX = ev.clientX, startY = ev.clientY;
          var origX = p.x, origY = p.y;
          function onMove(e) {
            p.x = Math.max(0, origX + (e.clientX - startX));
            p.y = Math.max(0, origY + (e.clientY - startY));
            card.style.left = p.x + 'px';
            card.style.top = p.y + 'px';
          }
          function onUp() {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            draw();
          }
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        });

        card.addEventListener('click', function (ev) {
          ev.stopPropagation();
          editNode(n);
        });
        canvas.appendChild(card);
      });
      // 连线：节点插入后按**真实几何**画。卡片高度随内容行数变化，写死 52px 会错位。
      // 必须在下一帧量：面板刚插入时可能还没参与布局，offsetLeft/Top 会是 0 或负数。
      function drawEdges() {
        while (svg.firstChild) svg.removeChild(svg.firstChild);

        var rects = {};
        var maxRight = 0;
        var maxBottom = 0;
        Array.prototype.forEach.call(canvas.querySelectorAll('.am-node'), function (card) {
          var rect = {
            x: card.offsetLeft,
            y: card.offsetTop,
            w: card.offsetWidth,
            h: card.offsetHeight,
          };
          rects[card.dataset.id] = rect;
          maxRight = Math.max(maxRight, rect.x + rect.w);
          maxBottom = Math.max(maxBottom, rect.y + rect.h);
        });
        if (!maxRight && !maxBottom) return; // 还没布局：等下一帧（onResize/再绘制会再来一次）

        // viewBox 必须与画布**真实像素**一致：SVG 被 CSS 拉到 100% 宽，
        // 如果 viewBox 用内容尺寸（比如 396 宽）就会被横向放大，线全跑到卡片右边去。
        var cw = canvas.clientWidth || maxRight + 40;
        var ch = Math.max(canvas.clientHeight || 0, maxBottom + 40);
        svg.setAttribute('viewBox', '0 0 ' + cw + ' ' + ch);

        state_.nodes.forEach(function (n) {
          [['next', n.next], ['on_true', n.on_true], ['on_false', n.on_false]].forEach(function (pair) {
            var a = rects[n.id];
            var b = rects[pair[1]];
            if (!a || !b) return;
            var x1 = a.x + a.w / 2;
            var y1 = a.y + a.h;
            var x2 = b.x + b.w / 2;
            var y2 = b.y;
            var my = y1 + Math.max(12, (y2 - y1) / 2);

            var path = document.createElementNS(NS, 'path');
            path.setAttribute('d', 'M ' + x1 + ' ' + y1 + ' V ' + my + ' H ' + x2 + ' V ' + y2);
            path.setAttribute('class', 'am-edge' + (pair[0] === 'on_false' ? ' false' : ''));
            svg.appendChild(path);

            var arrow = document.createElementNS(NS, 'path');
            arrow.setAttribute('d', 'M ' + (x2 - 3) + ' ' + (y2 - 4) + ' L ' + x2 + ' ' + y2 + ' L ' + (x2 + 3) + ' ' + (y2 - 4));
            arrow.setAttribute('class', 'am-edge-arrow' + (pair[0] === 'on_false' ? ' false' : ''));
            svg.appendChild(arrow);

            if (pair[0] !== 'next') {
              var label = document.createElementNS(NS, 'text');
              label.setAttribute('x', String(x1 + 4));
              label.setAttribute('y', String(my - 3));
              label.setAttribute('class', 'am-edge-label');
              label.textContent = pair[0] === 'on_true' ? '是' : '否';
              svg.appendChild(label);
            }
          });
        });
      }

      // 第一帧布局完再量；字体加载完再补一次，避免行高变化导致错位
      requestAnimationFrame(function () {
        drawEdges();
        requestAnimationFrame(drawEdges);
      });

      wrap.appendChild(canvas);

      var legend = el('div', 'am-designer-legend');
      [['lg-start', '开始'], ['lg-skill', '技能'], ['lg-agent', '智能体'], ['lg-condition', '条件'], ['lg-approval', '审批'], ['lg-end', '结束']].forEach(function (item) {
        legend.appendChild(el('span', item[0], item[1]));
      });
      wrap.appendChild(legend);
      wrap.appendChild(el('div', 'am-foot', '拖动节点摆位 · 点节点改连接与参数 · 校验通过后发布新版本'));
    }

    function buildGraph() {
      var g = { entry: state_.graph.entry, nodes: [] };
      state_.nodes.forEach(function (n) {
        var copy = {};
        Object.keys(n).forEach(function (k) {
          if (n[k] !== '' && n[k] != null) copy[k] = n[k];
        });
        g.nodes.push(copy);
      });
      return g;
    }

    function showResult(title, text) {
      var old = wrap.querySelector('.am-designer-result');
      if (old) old.remove();
      var box = el('div', 'am-designer-result');
      box.appendChild(el('div', 'am-drawer-title', title));
      box.appendChild(el('pre', 'am-json', text));
      box.appendChild(el('button', 'am-act', '关闭'));
      box.lastChild.addEventListener('click', function () { box.remove(); });
      wrap.insertBefore(box, wrap.firstChild.nextSibling);
    }

    function editNode(node) {
      var old = wrap.querySelector('.am-node-editor');
      if (old) old.remove();
      var box = el('div', 'am-node-editor');
      box.appendChild(el('div', 'am-drawer-title', '节点 ' + node.id));

      var fields = el('div', 'am-node-fields');
      function field(label, key, placeholder) {
        var row = el('label', 'am-field');
        row.appendChild(el('span', 'am-k', label));
        var input = el('input', 'am-input');
        input.value = node[key] == null ? '' : String(node[key]);
        input.placeholder = placeholder || '';
        input.addEventListener('input', function () {
          if (input.value === '') delete node[key];
          else node[key] = input.value;
          markDirty();
        });
        row.appendChild(input);
        fields.appendChild(row);
        return input;
      }

      var typeRow = el('label', 'am-field');
      typeRow.appendChild(el('span', 'am-k', '类型'));
      var typeSel = el('select', 'am-select');
      NODE_TYPES.forEach(function (t) {
        var o = el('option', null, t.label);
        o.value = t.value;
        typeSel.appendChild(o);
      });
      typeSel.value = node.type;
      typeSel.addEventListener('change', function () {
        node.type = typeSel.value;
        markDirty();
        draw();
        editNode(node);
      });
      typeRow.appendChild(typeSel);
      fields.appendChild(typeRow);

      if (node.type === 'skill') field('技能编码', 'skill', 'order_query');
      if (node.type === 'agent') field('智能体', 'agent_code', '$dispatch');
      if (node.type === 'condition') field('条件表达式', 'expr', 'score.worst_score >= 60');
      if (node.type === 'approval') field('审批角色', 'role', 'operator');
      field('下一步', 'next', '下一个节点 id');
      if (node.type === 'condition') {
        field('成立时', 'on_true', '节点 id');
        field('不成立时', 'on_false', '节点 id');
      }
      field('入参来自', 'input_from', '空格分隔的节点 id');

      box.appendChild(fields);

      var acts = el('div', 'am-drawer-acts');
      var del = el('button', 'am-act err', '删除节点');
      del.addEventListener('click', function () {
        state_.nodes = state_.nodes.filter(function (n) { return n.id !== node.id; });
        markDirty();
        box.remove();
        draw();
      });
      acts.appendChild(del);
      var close = el('button', 'am-act dim', '关闭');
      close.addEventListener('click', function () { box.remove(); });
      acts.appendChild(close);
      box.appendChild(acts);

      wrap.appendChild(box);
    }

    function load() {
      state(wrap, 'loading', '加载工作流…');
      window.am.get('/workflows').then(function (rows) {
        var code = state_.code || (meta && meta.workflow) || (rows && rows[0] && rows[0].code);
        if (!code) {
          // 没有工作流时给一个「新建」入口
          wrap.innerHTML = '';
          var box = el('div', 'am-state dim', '还没有工作流。先在工作台外创建，或选择已有工作流。');
          wrap.appendChild(box);
          return;
        }
        state_.workflows = rows || [];
        state_.code = code;
        return window.am.get('/workflows/' + code).then(function (detail) {
          state_.graph = detail.graph || { entry: '', nodes: [] };
          state_.nodes = (state_.graph.nodes || []).map(function (n) { return Object.assign({}, n); });
          state_.dirty = false;
          draw();
        });
      }).catch(function (err) { state(wrap, 'err', '加载失败：' + err.message); });
    }

    load();
  };

  // ---------------------------------------------------------------- 新建（任务 / 技能 / 智能体）

  R['am-create'] = function (body) {
    body.classList.add('am-body');
    var wrap = el('div', 'am-create');
    body.appendChild(wrap);

    var TABS = ['任务', '技能', '智能体'];
    var current = 0;
    var tabBar = el('div', 'am-tabs');
    var formBox = el('div', 'am-create-form');
    var resultBox = el('div', 'am-create-result');

    TABS.forEach(function (name, i) {
      var b = el('button', 'am-tab' + (i === 0 ? ' active' : ''), name);
      b.addEventListener('click', function () {
        current = i;
        Array.prototype.forEach.call(tabBar.children, function (x, idx) { x.classList.toggle('active', idx === i); });
        renderForm();
      });
      tabBar.appendChild(b);
    });
    wrap.appendChild(tabBar);
    wrap.appendChild(formBox);
    wrap.appendChild(resultBox);

    function field(label, key, opts) {
      var row = el('label', 'am-field');
      row.appendChild(el('span', 'am-k', label));
      var input;
      if (opts && opts.options) {
        input = el('select', 'am-select');
        opts.options.forEach(function (o) {
          var opt = el('option', null, o.label);
          opt.value = o.value;
          input.appendChild(opt);
        });
      } else {
        input = el('input', 'am-input');
        input.placeholder = (opts && opts.placeholder) || '';
        if (opts && opts.type) input.type = opts.type;
      }
      input.dataset.key = key;
      if (opts && opts.value != null) input.value = String(opts.value);
      row.appendChild(input);
      return row;
    }

    function collect() {
      var out = {};
      Array.prototype.forEach.call(formBox.querySelectorAll('[data-key]'), function (input) {
        var key = input.dataset.key;
        var raw = input.value.trim();
        if (raw === '') return;
        if (input.type === 'number') out[key] = Number(raw);
        else if (key === 'required_capabilities' || key === 'capabilities') {
          out[key] = raw.split(/[,\s]+/).filter(Boolean);
        } else out[key] = raw;
      });
      return out;
    }

    function showResult(ok, text) {
      resultBox.innerHTML = '';
      resultBox.appendChild(el('div', 'am-flash ' + (ok ? 'ok' : 'err'), text));
    }

    function renderForm() {
      formBox.innerHTML = '';
      if (current === 0) {
        formBox.appendChild(field('任务标题 *', 'title', { placeholder: '订单延迟异常处理' }));
        formBox.appendChild(field('工作流 *', 'workflow_code', {
          options: [
            { value: 'order_delay_exception', label: '订单延迟异常闭环' },
            { value: 'replenishment_weekly', label: '周度补货建议' },
            { value: 'supplier_risk_patrol', label: '承运商风险巡检' },
            { value: 'fulfillment_review', label: '区域履约诊断与整改' },
          ],
        }));
        formBox.appendChild(field('优先级', 'priority', { type: 'number', value: 2, placeholder: '1-5' }));
        formBox.appendChild(field('复杂度', 'complexity_hint', { type: 'number', value: 3, placeholder: '1-5' }));
        formBox.appendChild(field('所需能力', 'required_capabilities', { placeholder: 'order_query impact_assess（空格分隔）' }));
        formBox.appendChild(field('订单号', 'order_id', { placeholder: 'SO-20261122-0001（走订单链路时填）' }));
      } else if (current === 1) {
        formBox.appendChild(field('技能编码 *', 'code', { placeholder: 'carrier_quote_check（小写+下划线）' }));
        formBox.appendChild(field('名称 *', 'name', { placeholder: '承运商报价核对' }));
        formBox.appendChild(field('分类', 'category', {
          options: [
            { value: 'analysis', label: '预测分析' },
            { value: 'query', label: '数据查询' },
            { value: 'action', label: '执行动作' },
            { value: 'generation', label: '内容生成' },
          ],
        }));
        formBox.appendChild(field('类型', 'type', {
          options: [
            { value: 'builtin', label: '内置函数' },
            { value: 'http', label: 'HTTP 接口' },
          ],
        }));
        formBox.appendChild(field('说明', 'description', { placeholder: '一句话说明这个技能做什么' }));
        formBox.appendChild(field('内置函数名', 'function', { placeholder: 'order_query（类型=内置时必填）' }));
        formBox.appendChild(field('接口地址', 'url', { placeholder: 'https://example.com/api（类型=HTTP 时必填）' }));
      } else {
        formBox.appendChild(field('智能体编码 *', 'code', { placeholder: 'quote-auditor（小写+连字符）' }));
        formBox.appendChild(field('名称 *', 'name', { placeholder: '报价审核智能体' }));
        formBox.appendChild(field('描述', 'description', { placeholder: '一句话说明职责' }));
        formBox.appendChild(field('阶段', 'stage', {
          options: [
            { value: 'demand', label: '需求计划' },
            { value: 'inventory', label: '库存' },
            { value: 'production', label: '生产' },
            { value: 'logistics', label: '物流' },
            { value: 'fulfillment', label: '履约' },
            { value: 'returns', label: '退货' },
            { value: 'sourcing', label: '采购' },
            { value: 'risk', label: '风险' },
          ],
        }));
        formBox.appendChild(field('模型档位', 'model_tier', {
          options: [
            { value: 'small', label: '小模型' },
            { value: 'large', label: '大模型' },
            { value: 'tool', label: '工具（不走模型）' },
          ],
        }));
        formBox.appendChild(field('能力标签', 'capabilities', { placeholder: 'carrier_quote rule_check（空格分隔）' }));
      }

      var submitLabel = current === 0 ? '创建任务' : current === 1 ? '创建技能' : '创建智能体';
      var submit = el('button', 'am-act ok', submitLabel);
      submit.addEventListener('click', function () {
        var payload = collect();
        // 必填校验：接口会返回 422，但那是给开发看的；这里先用人话拦住
        var missing = [];
        if (current === 0 && !payload.title) missing.push('任务标题');
        if (current === 1) {
          if (!payload.code) missing.push('技能编码');
          if (!payload.name) missing.push('名称');
          if (!payload.function && !payload.url) missing.push('内置函数名 或 接口地址（二选一）');
        }
        if (current === 2) {
          if (!payload.code) missing.push('智能体编码');
          if (!payload.name) missing.push('名称');
        }
        if (missing.length) {
          showResult(false, '还差这些必填项：' + missing.join('、'));
          return;
        }
        submit.disabled = true;
        var path = current === 0 ? '/tasks' : current === 1 ? '/skills' : '/agents';
        var body = payload;
        if (current === 0) {
          // 任务：把业务字段塞进 payload，其余留给顶层
          var biz = {};
          if (payload.order_id) biz.order_id = payload.order_id;
          delete payload.order_id;
          body = Object.assign({}, payload, { payload: biz });
          body.priority = Number(body.priority || 2);
          body.complexity_hint = Number(body.complexity_hint || 3);
        }
        if (current === 1) {
          if (body.type === 'http') body.http = { url: payload.url || '', method: 'GET' };
          else body.builtin = { function: payload.function || '' };
          delete body.url;
          delete body.function;
        }
        window.am.post(path, body)
          .then(function (res) {
            var name = (res && (res.title || res.name || res.code)) || '已创建';
            showResult(true, '创建成功：' + name);
            formBox.querySelectorAll('input').forEach(function (i) { i.value = ''; });
          })
          .catch(function (err) { showResult(false, '创建失败：' + err.message); })
          .then(function () { submit.disabled = false; });
      });
      formBox.appendChild(submit);
    }

    renderForm();
  };

  // 本文件注册的面板要立刻同步进当前注册表（否则刷新后会变成「未知面板类型」）
  if (window.__amSync) window.__amSync();
})();
