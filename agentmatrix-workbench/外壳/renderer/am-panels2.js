/**
 * AgentMatrix 原生面板 · 第二批（可操作的面板）
 *
 * 与第一批同样的约定：面板自己完成功能，不嵌网页；数据走 window.am（主进程代理）；
 * 样式只用模板变量。这里的面板都带**真实写操作**：审批、死信重试、技能试运行、
 * 智能体在线测试、调度策略试算与保存、告警确认、工作流校验、运行趋势图。
 */
(function () {
  'use strict';

  var R = window.__amPanels || (window.__amPanels = {});
  var A = window.__am;
  if (!R || !A) return;

  var el = A.el;
  var table = A.table;
  var state = A.state;
  var badge = A.badge;
  var fmtTime = A.fmtTime;
  var fmtMoney = A.fmtMoney;
  var drawer = A.drawer;
  var kvList = A.kvList;
  var strategyText = A.strategyText;

  /** 统一的操作反馈条：成功绿、失败红，3 秒后自动淡出 */
  function flash(parent, text, kind) {
    var node = el('div', 'am-flash ' + (kind || 'ok'), text);
    parent.insertBefore(node, parent.firstChild);
    setTimeout(function () { node.remove(); }, 3200);
    return node;
  }

  function actionButton(label, cls, onClick) {
    var b = el('button', 'am-act ' + (cls || ''), label);
    b.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (b.disabled) return;
      b.disabled = true;
      Promise.resolve(onClick()).finally(function () { b.disabled = false; });
    });
    return b;
  }

  // ---------------------------------------------------------------- 待审批

  R['am-approvals'] = function (body) {
    body.classList.add('am-body');
    var wrap = el('div', 'am-list');
    body.appendChild(wrap);
    var listBox = el('div', 'am-scroll');
    wrap.appendChild(listBox);
    var timer = null;

    function load() {
      window.am.get('/approvals').then(function (rows) {
        var pending = (rows || []).filter(function (r) { return r.status === 'pending'; });
        listBox.innerHTML = '';
        if (!pending.length) return state(listBox, 'dim', '没有待审批的节点');
        pending.forEach(function (row) {
          var card = el('div', 'am-approval');
          var head = el('div', 'am-approval-head');
          head.appendChild(el('span', 'am-approval-title', '运行 ' + (row.run_id || '').slice(0, 10)));
          head.appendChild(el('span', 'am-badge warn', '待审批'));
          head.appendChild(el('span', 'am-foot', fmtTime(row.created_at)));
          card.appendChild(head);

          var comment = el('input', 'am-input');
          comment.placeholder = '审批意见（可留空）';
          card.appendChild(comment);

          var acts = el('div', 'am-approval-acts');
          acts.appendChild(actionButton('通过', 'ok', function () {
            return window.am.post('/approvals/' + row.id + '/decision', { decision: 'approved', comment: comment.value.trim() })
              .then(function () { flash(wrap, '已通过：' + (row.run_id || '').slice(0, 10), 'ok'); load(); })
              .catch(function (err) { flash(wrap, '通过失败：' + err.message, 'err'); });
          }));
          acts.appendChild(actionButton('驳回', 'err', function () {
            return window.am.post('/approvals/' + row.id + '/decision', { decision: 'rejected', comment: comment.value.trim() })
              .then(function () { flash(wrap, '已驳回：' + (row.run_id || '').slice(0, 10), 'warn'); load(); })
              .catch(function (err) { flash(wrap, '驳回失败：' + err.message, 'err'); });
          }));
          card.appendChild(acts);
          listBox.appendChild(card);
        });
      }).catch(function (err) { state(listBox, 'err', '取审批失败：' + err.message); });
    }

    load();
    timer = setInterval(load, 20000);
    return function () { if (timer) clearInterval(timer); };
  };

  // ---------------------------------------------------------------- 死信

  R['am-deadletters'] = function (body) {
    body.classList.add('am-body');
    var wrap = el('div', 'am-list');
    body.appendChild(wrap);
    var listBox = el('div', 'am-scroll');
    wrap.appendChild(listBox);
    var timer = null;

    function load() {
      window.am.get('/dead-letters').then(function (rows) {
        var pending = (rows || []).filter(function (r) { return r.status === 'pending'; });
        listBox.innerHTML = '';
        if (!pending.length) return state(listBox, 'dim', '没有待处理的死信');
        listBox.appendChild(table([
          { label: '任务', render: function (r) { return r.task_title || (r.task_id || '').slice(0, 8); } },
          { label: '错误码', width: '96px', nowrap: true, render: function (r) { return el('span', 'am-badge err', r.error_code || '—'); } },
          { label: '尝试', width: '56px', render: function (r) { return String(r.attempts || 0); } },
          { label: '发生', width: '96px', nowrap: true, render: function (r) { return fmtTime(r.created_at); } },
          { label: '操作', width: '116px', nowrap: true, render: function (r) {
            var box = el('span', 'am-inline-acts');
            box.appendChild(actionButton('重试', 'ok', function () {
              return window.am.post('/dead-letters/' + r.id + '/retry', {})
                .then(function () { flash(wrap, '已重新投递：' + (r.task_title || ''), 'ok'); load(); })
                .catch(function (err) { flash(wrap, '重试失败：' + err.message, 'err'); });
            }));
            box.appendChild(actionButton('忽略', 'dim', function () {
              return window.am.post('/dead-letters/' + r.id + '/ignore', {})
                .then(function () { flash(wrap, '已忽略：' + (r.task_title || ''), 'warn'); load(); })
                .catch(function (err) { flash(wrap, '忽略失败：' + err.message, 'err'); });
            }));
            return box;
          } },
        ], pending, null, { filename: 'dead-letters' }));
      }).catch(function (err) { state(listBox, 'err', '取死信失败：' + err.message); });
    }

    load();
    timer = setInterval(load, 20000);
    return function () { if (timer) clearInterval(timer); };
  };

  // ---------------------------------------------------------------- 技能库

  R['am-skills'] = function (body) {
    body.classList.add('am-body');
    var wrap = el('div', 'am-list');
    body.appendChild(wrap);
    var listBox = el('div', 'am-scroll');
    wrap.appendChild(listBox);
    var d = drawer();
    body.appendChild(d.node);

    function load() {
      window.am.get('/skills').then(function (rows) {
        listBox.innerHTML = '';
        if (!rows || !rows.length) return state(listBox, 'dim', '还没有技能');
        listBox.appendChild(table([
          { label: '技能', render: function (r) { return r.name + '（' + r.code + '）'; } },
          { label: '类型', width: '78px', render: function (r) { return r.type_label || r.type; } },
          { label: '引用', width: '56px', render: function (r) { return String(r.reference_count || 0); } },
          { label: '成功率', width: '72px', render: function (r) { return r.success_rate == null ? '—' : Math.round(r.success_rate * 100) + '%'; } },
          { label: '操作', width: '92px', nowrap: true, render: function (r) {
            return actionButton('试运行', '', function () {
              return window.am.post('/skills/' + r.code + '/test', { inputs: {}, force_mock: true })
                .then(function (res) {
                  d.show([
                    el('div', 'am-drawer-title', '试运行：' + r.name),
                    kvList([
                      ['是否成功', res && res.ok ? '成功' : '失败'],
                      ['耗时', (res && res.duration_ms ? res.duration_ms + ' ms' : '—')],
                      ['错误', (res && res.error) || '—'],
                    ]),
                    el('pre', 'am-json', JSON.stringify((res && (res.output || res.result || res)) || {}, null, 2)),
                  ]);
                })
                .catch(function (err) { flash(wrap, '试运行失败：' + err.message, 'err'); });
            });
          } },
        ], rows, null, { filename: 'skills' }));
      }).catch(function (err) { state(listBox, 'err', '取技能失败：' + err.message); });
    }

    load();
  };

  // ---------------------------------------------------------------- 智能体

  R['am-agents'] = function (body) {
    body.classList.add('am-body');
    var wrap = el('div', 'am-list');
    body.appendChild(wrap);
    var listBox = el('div', 'am-scroll');
    wrap.appendChild(listBox);
    var d = drawer();
    body.appendChild(d.node);

    function load() {
      window.am.get('/agents').then(function (rows) {
        listBox.innerHTML = '';
        if (!rows || !rows.length) return state(listBox, 'dim', '还没有智能体');
        listBox.appendChild(table([
          { label: '智能体', render: function (r) { return r.name; } },
          { label: '阶段', width: '78px', render: function (r) { return r.stage; } },
          { label: '模型', width: '68px', render: function (r) { return r.tier_label || r.model_tier; } },
          { label: '成功率', width: '72px', render: function (r) { return Math.round((r.success_rate || 0) * 100) + '%'; } },
          { label: '操作', width: '96px', nowrap: true, render: function (r) {
            return actionButton('在线测试', '', function () {
              return window.am.post('/agents/' + r.code + '/test', { input: { text: '连通性测试' }, use_mock: true })
                .then(function (res) {
                  d.show([
                    el('div', 'am-drawer-title', r.name + ' · 在线测试'),
                    kvList([
                      ['模型', (res && (res.provider || '') + '/' + (res && res.model) || '—')],
                      ['Token', res && res.tokens != null ? String(res.tokens) : '—'],
                      ['成本', fmtMoney(res && res.cost_usd)],
                      ['耗时', res && res.duration_ms != null ? res.duration_ms + ' ms' : '—'],
                      ['结论', (res && res.answer) || (res && res.error) || '—'],
                    ]),
                  ]);
                })
                .catch(function (err) { flash(wrap, '在线测试失败：' + err.message, 'err'); });
            });
          } },
        ], rows, null, { filename: 'agents' }));
      }).catch(function (err) { state(listBox, 'err', '取智能体失败：' + err.message); });
    }

    load();
  };

  // ---------------------------------------------------------------- 调度策略

  R['am-dispatch'] = function (body) {
    body.classList.add('am-body');
    var wrap = el('div', 'am-dispatch');
    body.appendChild(wrap);

    function paint(cfg) {
      wrap.innerHTML = '';
      var head = el('div', 'am-dispatch-head');
      head.appendChild(el('div', 'am-cover-head', '当前策略来源：' + (cfg.source === 'db' ? '界面配置' : '环境变量')));
      wrap.appendChild(head);

      var row = el('div', 'am-field');
      row.appendChild(el('span', 'am-k', '策略'));
      var select = el('select', 'am-select');
      (cfg.strategies || []).forEach(function (s) {
        var o = el('option', null, s.label || s.name);
        o.value = s.name;
        select.appendChild(o);
      });
      select.value = cfg.config.strategy;
      row.appendChild(select);
      wrap.appendChild(row);

      var inputs = {};
      var factors = el('div', 'am-weights');
      (cfg.factors || []).forEach(function (f) {
        var line = el('div', 'am-weight');
        line.title = f.description || '';
        line.appendChild(el('span', 'am-weight-label', f.label));
        var input = el('input', 'am-input am-weight-input');
        input.type = 'number';
        input.step = '0.05';
        input.min = '0';
        input.max = '1';
        input.value = String((cfg.config.weights || {})[f.code] != null ? cfg.config.weights[f.code] : 0);
        inputs[f.code] = input;
        line.appendChild(input);
        factors.appendChild(line);
      });
      wrap.appendChild(factors);

      var acts = el('div', 'am-dispatch-acts');
      var previewBox = el('div', 'am-preview');
      acts.appendChild(actionButton('试算', '', function () {
        var weights = {};
        Object.keys(inputs).forEach(function (k) { weights[k] = Number(inputs[k].value); });
        return window.am.post('/settings/dispatch/preview', {
          required_capabilities: ['order_query', 'reasoning'],
          priority: 1,
          complexity_hint: 3,
          weights: weights,
          strategy: select.value,
        }).then(function (res) {
          previewBox.innerHTML = '';
          var factors = (res && res.factors) || [];
                    var chosen = (res && (res.chosen || res.agent_name || res.agent_code)) || '无候选';
          var score = res && res.score != null ? Number(res.score).toFixed(3) : '—';
          var rejected = ((res && res.rejected) || []).length;
          previewBox.appendChild(el('div', 'am-cover-head',
            '试算结果：' + chosen + ' · 总分 ' + score + '（' + ((res && res.reason) || '') + '）'
            + (rejected ? ' · 淘汰 ' + rejected + ' 个候选' : '')));
          factors.forEach(function (f) {
            var line = el('div', 'am-factor');
            line.appendChild(el('span', 'am-factor-name', f.name));
            var bar = el('div', 'am-bar');
            var fill = el('div', 'am-bar-fill');
            fill.style.width = Math.round(Math.max(0, Math.min(1, f.contribution)) * 100) + '%';
            bar.appendChild(fill);
            line.appendChild(bar);
            line.appendChild(el('span', 'am-factor-val', String(f.contribution).slice(0, 5)));
            previewBox.appendChild(line);
          });
        }).catch(function (err) { flash(wrap, '试算失败：' + err.message, 'err'); });
      }));
      acts.appendChild(actionButton('保存', 'ok', function () {
        var weights = {};
        Object.keys(inputs).forEach(function (k) { weights[k] = Number(inputs[k].value); });
        return window.am.put('/settings/dispatch', {
          strategy: select.value,
          weights: weights,
          sla_headroom: cfg.config.sla_headroom,
          min_success_rate: cfg.config.min_success_rate,
        }).then(function () {
          flash(wrap, '已保存（下次派活立即生效）', 'ok');
          load();
        }).catch(function (err) { flash(wrap, '保存失败：' + err.message, 'err'); });
      }));
      acts.appendChild(actionButton('恢复默认', 'dim', function () {
        return window.am.put('/settings/dispatch', {
          strategy: cfg.defaults.strategy,
          weights: cfg.defaults.weights,
          sla_headroom: cfg.defaults.sla_headroom,
          min_success_rate: cfg.defaults.min_success_rate,
        }).then(function () { flash(wrap, '已恢复默认策略', 'warn'); load(); })
          .catch(function (err) { flash(wrap, '恢复失败：' + err.message, 'err'); });
      }));
      wrap.appendChild(acts);
      wrap.appendChild(previewBox);

      var current = el('div', 'am-foot', '当前：' + strategyText(cfg.config.strategy)
        + ' · SLA 余量 ' + cfg.config.sla_headroom
        + ' · 最低成功率 ' + cfg.config.min_success_rate);
      wrap.appendChild(current);
    }

    function load() {
      window.am.get('/settings/dispatch').then(paint)
        .catch(function (err) { state(wrap, 'err', '取调度配置失败：' + err.message); });
    }

    load();
  };

  // ---------------------------------------------------------------- 告警

  R['am-alerts'] = function (body) {
    body.classList.add('am-body');
    var wrap = el('div', 'am-list');
    body.appendChild(wrap);
    var listBox = el('div', 'am-scroll');
    wrap.appendChild(listBox);
    var timer = null;

    var SEVERITY = { critical: 'err', warning: 'warn', info: 'dim' };

    function load() {
      window.am.get('/alert-events').then(function (rows) {
        var open = (rows || []).filter(function (r) { return r.status !== 'resolved'; });
        listBox.innerHTML = '';
        if (!open.length) return state(listBox, 'dim', '当前没有未恢复的告警');
        listBox.appendChild(table([
          { label: '告警', render: function (r) { return r.rule_name; } },
          { label: '级别', width: '64px', render: function (r) { return el('span', 'am-badge ' + (SEVERITY[r.severity] || 'dim'), r.severity); } },
          { label: '内容', render: function (r) { return r.message; } },
          { label: '触发', width: '96px', nowrap: true, render: function (r) { return fmtTime(r.triggered_at); } },
          { label: '操作', width: '104px', nowrap: true, render: function (r) {
            var box = el('span', 'am-inline-acts');
            if (r.status === 'open') {
              box.appendChild(actionButton('确认', '', function () {
                return window.am.post('/alert-events/' + r.id + '/ack', {})
                  .then(function () { flash(wrap, '已确认：' + r.rule_name, 'warn'); load(); })
                  .catch(function (err) { flash(wrap, '确认失败：' + err.message, 'err'); });
              }));
            }
            box.appendChild(actionButton('恢复', 'ok', function () {
              return window.am.post('/alert-events/' + r.id + '/resolve', {})
                .then(function () { flash(wrap, '已恢复：' + r.rule_name, 'ok'); load(); })
                .catch(function (err) { flash(wrap, '恢复失败：' + err.message, 'err'); });
            }));
            return box;
          } },
        ], open, null, { filename: 'alert-events' }));
      }).catch(function (err) { state(listBox, 'err', '取告警失败：' + err.message); });
    }

    load();
    timer = setInterval(load, 25000);
    return function () { if (timer) clearInterval(timer); };
  };

  // ---------------------------------------------------------------- 工作流

  R['am-workflows'] = function (body) {
    body.classList.add('am-body');
    var wrap = el('div', 'am-list');
    body.appendChild(wrap);
    var listBox = el('div', 'am-scroll');
    wrap.appendChild(listBox);
    var d = drawer();
    body.appendChild(d.node);

    function load() {
      window.am.get('/workflows').then(function (rows) {
        listBox.innerHTML = '';
        if (!rows || !rows.length) return state(listBox, 'dim', '还没有工作流');
        listBox.appendChild(table([
          { label: '工作流', render: function (r) { return r.name; } },
          { label: '阶段', width: '78px', render: function (r) { return r.stage; } },
          { label: '节点', width: '56px', render: function (r) { return String(r.node_count || 0); } },
          { label: '版本', width: '56px', render: function (r) { return r.published_version ? 'v' + r.published_version : '未发布'; } },
          { label: '操作', width: '88px', nowrap: true, render: function (r) {
            return actionButton('校验', '', function () {
              return window.am.get('/workflows/' + r.code)
                .then(function (detail) {
                  // 详情里是 graph（entry/nodes），校验接口要的就是它
                  return window.am.post('/workflows/' + r.code + '/validate', { graph: (detail && detail.graph) || {} });
                })
                .then(function (res) {
                  d.show([
                    el('div', 'am-drawer-title', r.name + ' · 校验'),
                    kvList([
                      ['是否通过', res && res.ok ? '通过' : '有问题'],
                      ['问题数', String(((res && res.errors) || []).length)],
                    ]),
                    el('pre', 'am-json', JSON.stringify(res, null, 2)),
                  ]);
                })
                .catch(function (err) {
                  // 校验接口需要完整图；空图会被拒，这本身也是有效信息，直接展示原因
                  d.show([el('div', 'am-drawer-title', r.name + ' · 校验'),
                    el('div', 'am-state err', '校验未通过：' + err.message)]);
                });
            });
          } },
        ], rows, null, { filename: 'workflows' }));
      }).catch(function (err) { state(listBox, 'err', '取工作流失败：' + err.message); });
    }

    load();
  };

  // ---------------------------------------------------------------- 运行趋势（原生 SVG）

  R['am-chart'] = function (body) {
    body.classList.add('am-body');
    var wrap = el('div', 'am-chart');
    body.appendChild(wrap);
    var timer = null;

    function load() {
      window.am.get('/runs?limit=200').then(function (rows) {
        wrap.innerHTML = '';
        var buckets = new Array(24).fill(0);
        var failed = new Array(24).fill(0);
        var now = Date.now();
        (rows || []).forEach(function (r) {
          var t = new Date(r.started_at || r.created_at || 0).getTime();
          if (!t) return;
          var hoursAgo = Math.floor((now - t) / 3600000);
          if (hoursAgo < 0 || hoursAgo > 23) return;
          var idx = 23 - hoursAgo;
          buckets[idx] += 1;
          if (r.status === 'failed') failed[idx] += 1;
        });

        var total = buckets.reduce(function (a, b) { return a + b; }, 0);
        var failTotal = failed.reduce(function (a, b) { return a + b; }, 0);
        var max = Math.max.apply(null, buckets.concat([1]));

        var head = el('div', 'am-chart-head');
        head.appendChild(el('div', 'am-cover-head', '近 24 小时运行 ' + total + ' 次 · 失败 ' + failTotal + ' 次'));
        head.appendChild(el('div', 'am-chart-legend', '蓝=成功/进行中，红=失败，纵轴为次数'));
        wrap.appendChild(head);

        // 画面：左边留 26px 放纵轴刻度，底部留 16px 放小时
        var W = 240, H = 90, padL = 26, padB = 14, padT = 6;
        var plotW = W - padL - 4;
        var plotH = H - padT - padB;
        var NS = 'http://www.w3.org/2000/svg';
        var svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
        svg.setAttribute('class', 'am-chart-svg');
        svg.setAttribute('preserveAspectRatio', 'none');

        // 横向网格 + 纵轴刻度（0 / 一半 / 最大）
        [0, 0.5, 1].forEach(function (ratio) {
          var y = padT + plotH * (1 - ratio);
          var line = document.createElementNS(NS, 'line');
          line.setAttribute('x1', String(padL));
          line.setAttribute('x2', String(W - 2));
          line.setAttribute('y1', String(y));
          line.setAttribute('y2', String(y));
          line.setAttribute('class', 'am-chart-grid');
          svg.appendChild(line);
          var label = document.createElementNS(NS, 'text');
          label.setAttribute('x', String(padL - 3));
          label.setAttribute('y', String(y + 3));
          label.setAttribute('text-anchor', 'end');
          label.setAttribute('class', 'am-chart-tick');
          label.textContent = String(Math.round(max * ratio));
          svg.appendChild(label);
        });

        var barW = plotW / 24;
        buckets.forEach(function (count, i) {
          var h = count === 0 ? 0 : Math.max(1.5, (count / max) * plotH);
          var rect = document.createElementNS(NS, 'rect');
          rect.setAttribute('x', String(padL + i * barW + 0.6));
          rect.setAttribute('y', String(padT + plotH - h));
          rect.setAttribute('width', String(Math.max(1, barW - 1.2)));
          rect.setAttribute('height', String(h));
          rect.setAttribute('class', 'am-chart-bar' + (failed[i] > 0 ? ' has-fail' : ''));
          var title = document.createElementNS(NS, 'title');
          title.textContent = (23 - i) + ' 小时前：' + count + ' 次' + (failed[i] ? '（失败 ' + failed[i] + '）' : '');
          rect.appendChild(title);
          svg.appendChild(rect);
        });

        // 横轴：每 6 小时一个刻度
        [0, 6, 12, 18, 23].forEach(function (i) {
          var text = document.createElementNS(NS, 'text');
          text.setAttribute('x', String(padL + i * barW + barW / 2));
          text.setAttribute('y', String(H - 3));
          text.setAttribute('text-anchor', 'middle');
          text.setAttribute('class', 'am-chart-tick');
          text.textContent = i === 23 ? '现在' : '-' + (23 - i) + 'h';
          svg.appendChild(text);
        });

        wrap.appendChild(svg);

        var exportBar = el('div', 'am-export-bar');
        var chartRows = buckets.map(function (count, i) {
          return { hour: 23 - i, count: count, failed: failed[i] };
        });
        exportBar.appendChild(A.csvButton([
          { label: '距现在(小时)', csv: function (r) { return r.hour; } },
          { label: '运行数', csv: function (r) { return r.count; } },
          { label: '失败数', csv: function (r) { return r.failed; } },
        ], chartRows, { filename: 'runs-24h' }));
        var pngBtn = el('button', 'am-act', '导出 PNG');
        pngBtn.addEventListener('click', function () { A.exportSvgAsPng(svg, 'runs-24h'); });
        exportBar.appendChild(pngBtn);
        wrap.appendChild(exportBar);
      }).catch(function (err) { state(wrap, 'err', '取运行数据失败：' + err.message); });
    }

    load();
    timer = setInterval(load, 30000);
    return function () { if (timer) clearInterval(timer); };
  };

  // 本文件注册的面板要立刻同步进当前注册表（否则刷新后会变成「未知面板类型」）
  if (window.__amSync) window.__amSync();
})();
