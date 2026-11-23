/**
 * 第十轮补丁：把面板做得"能看懂、能操作"。
 *
 *  1. 运行抽屉：显示节点 id/类型/尝试次数/耗时/错误原因（之前全叫"步骤"）
 *  2. 任务抽屉：显示最近一次运行 + 失败原因
 *  3. 技能/智能体：操作列放第一列，去掉过宽列 → 不用横向滚动
 *  4. 能力矩阵：自绘 tooltip（同工作台风格）+ 点缺口给补齐建议
 *  5. 设计器：发布用内联对话框（Electron 里 window.prompt 不生效）；next 改成下拉选节点
 */
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', '外壳', 'renderer');

function patch(file, pairs) {
  const full = path.join(dir, file);
  let text = fs.readFileSync(full, 'utf8');
  let changed = 0;
  for (const [from, to, label] of pairs) {
    if (!text.includes(from)) {
      console.warn(`[${file}] 未匹配：${label}`);
      continue;
    }
    text = text.replace(from, to);
    changed += 1;
  }
  fs.writeFileSync(full, text, 'utf8');
  console.log(`[${file}] 改了 ${changed}/${pairs.length} 处`);
}

// ---------------------------------------------------------------- am-panels.js

// 1) 运行抽屉：步骤改成表格 + 失败原因
{
  const from = [
    '            window.am.get(\'/runs/\' + row.id).then(function (detail) {',
    '              var steps = (detail && detail.steps) || [];',
    '              if (!steps.length) return;',
    "              var box = el('div', 'am-steps');",
    '              steps.forEach(function (s) {',
    "                var line = el('div', 'am-step');",
    '                line.appendChild(badge(s.status));',
    "                line.appendChild(el('span', 'am-step-name', s.name || s.node_name || '步骤'));",
    "                line.appendChild(el('span', 'am-step-meta', fmtTime(s.started_at || s.created_at)));",
    '                box.appendChild(line);',
    '              });',
    '              d.append([box]);',
    '            }).catch(function () { /* 步骤拉不到就只显示概要 */ });',
  ].join('\n');

  const to = [
    '            window.am.get(\'/runs/\' + row.id).then(function (detail) {',
    '              var steps = (detail && detail.steps) || [];',
    '              if (!steps.length) return;',
    '',
    '              // 失败原因：取第一条失败步骤的 error.message（这才是"为什么失败"的答案）',
    "              var failedStep = steps.filter(function (s) { return s.status === 'failed'; })[0];",
    '              if (failedStep) {',
    "                var reason = el('div', 'am-reason');",
    "                reason.appendChild(el('div', 'am-reason-title', '失败原因'));",
    "                reason.appendChild(el('div', 'am-reason-body',",
    "                  (failedStep.error && failedStep.error.message) || '（这一步没有返回错误说明）'));",
    "                reason.appendChild(el('div', 'am-foot',",
    "                  '节点 ' + (failedStep.node_id || '') + ' · 类型 ' + (failedStep.node_type || '')",
    '                  + \' · 错误码 \' + ((failedStep.error && failedStep.error.code) || row.error_code || \'—\')));',
    '                d.append([reason]);',
    '              }',
    '',
    "              var box = el('div', 'am-steps');",
    "              box.appendChild(el('div', 'am-step-head', '步骤轨迹（按执行顺序）'));",
    '              steps.forEach(function (s) {',
    "                var line = el('div', 'am-step');",
    '                line.appendChild(badge(s.status));',
    "                line.appendChild(el('span', 'am-step-name',",
    "                  (s.node_id || '（无节点 id）') + ' · ' + (s.node_type || '')",
    "                  + (s.attempt > 1 ? ' · 第 ' + s.attempt + ' 次尝试' : '')));",
    "                var ms = '';",
    '                if (s.started_at && s.finished_at) {',
    '                  ms = Math.round(new Date(s.finished_at) - new Date(s.started_at)) + ' + "'' ms';\";",
    '                }',
    "                line.appendChild(el('span', 'am-step-meta', ms));",
    '                if (s.error && s.error.message) {',
    "                  line.appendChild(el('span', 'am-step-err', s.error.message));",
    '                }',
    '                box.appendChild(line);',
    '              });',
    '              d.append([box]);',
    '            }).catch(function () { /* 步骤拉不到就只显示概要 */ });',
  ].join('\n');

  patch('am-panels.js', [[from, to, '运行抽屉步骤']]);
}

fs.writeFileSync(path.join(dir, '.patch-a.done'), 'ok');
console.log('pass A done');
