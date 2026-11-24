/**
 * 一次性脚本：四个场景改为**纯原生面板**（不再嵌任何网页）。
 *
 * 版式用模板的 4 列网格：
 *   工作台总览：KPI(1×2) + 任务(3×2) / 助手(4×2)
 *   能力矩阵  ：矩阵(3×4) + 助手(1×4)
 *   交付追踪  ：运行(3×4) + 助手(1×4)
 *   治理与策略：审计(3×4) + 助手(1×4)
 *
 * ⚠️ 历史快照（2026-11-23 之前，四个场景 + 场景助手）。现在的基线是 `layout-full.cjs`
 *    （每场景带一个「DSH 会话」，场景助手已移除）；**不要直接运行本脚本**，否则会把旧版式写回去。
 */
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', '外壳', 'scenarios');

const scenarios = [
  {
    id: 'overview',
    name: '工作台总览',
    description:
      '待办与全景：左上实时快照（待审批/成功/失败/积压/覆盖率），右上任务列表（可按状态筛、点开看业务参数与所需能力），下方场景助手（读快照回答）。全部为原生面板，不嵌网页。',
    first: true,
    order: 1,
    panels: [
      { id: 'ov-kpi', title: '场景快照', sub: '实时 · 15 秒刷新', type: 'am-kpi', col: 1, row: 1, w: 1, h: 2 },
      { id: 'ov-tasks', title: '任务', sub: '按状态筛 · 点行看详情', type: 'am-tasks', col: 2, row: 1, w: 3, h: 2 },
      { id: 'ov-ai', title: '场景助手', sub: '真实模型 + 实时快照', type: 'am-assistant', col: 1, row: 3, w: 4, h: 2 },
    ],
  },
  {
    id: 'matrix',
    name: '能力矩阵',
    description:
      '8 阶段 × 4 能力：原生网格直接画出覆盖与缺口（有智能体的格子显示数量，空的标"缺"），下方列出优先要补的格子；右侧场景助手可问"先补哪个"。不嵌网页。',
    order: 2,
    panels: [
      { id: 'mx-grid', title: '能力矩阵', sub: '8 阶段 × 4 能力 · 缺口标红', type: 'am-matrix', col: 1, row: 1, w: 3, h: 4 },
      { id: 'mx-ai', title: '场景助手', sub: '问缺口怎么补', type: 'am-assistant', col: 4, row: 1, w: 1, h: 4 },
    ],
  },
  {
    id: 'delivery',
    name: '交付追踪',
    description:
      '跑批与留痕：原生运行列表（状态/触发/成本/开始时间，点行展开运行明细与步骤轨迹），右侧助手回答"这条运行为什么失败"。不嵌网页。',
    order: 3,
    panels: [
      { id: 'dl-runs', title: '运行监控', sub: '20 秒刷新 · 点行看步骤', type: 'am-runs', col: 1, row: 1, w: 3, h: 4 },
      { id: 'dl-ai', title: '场景助手', sub: '失败归因与下一步', type: 'am-assistant', col: 4, row: 1, w: 1, h: 4 },
    ],
  },
  {
    id: 'governance',
    name: '治理与策略',
    description:
      '谁在什么时候改了什么：原生审计日志（按动作筛选、点行看变更前后），右侧助手回答"最近谁动过调度策略"。不嵌网页。',
    order: 4,
    panels: [
      { id: 'gv-audit', title: '审计日志', sub: '只追加 · 可筛动作 · 点行看变更', type: 'am-audit', col: 1, row: 1, w: 3, h: 4 },
      { id: 'gv-ai', title: '场景助手', sub: '问治理相关的事', type: 'am-assistant', col: 4, row: 1, w: 1, h: 4 },
    ],
  },
];

for (const s of scenarios) {
  const doc = {
    id: s.id,
    name: s.name,
    description: s.description,
    layout: 'grid',
    theme: 'dark',
    order: s.order,
    ...(s.first ? { first: true } : {}),
    panels: s.panels,
  };
  fs.writeFileSync(path.join(dir, `${s.id}.json`), JSON.stringify(doc, null, 2) + '\n', 'utf8');
  console.log('wrote', s.id, '->', doc.panels.map((p) => `${p.type}(${p.w}×${p.h})`).join(' + '));
}
