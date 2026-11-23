/**
 * 一次性脚本：四个场景铺满全部原生面板（没有一处嵌网页）。
 *
 * 4 列网格，每场景 4~5 个面板：
 *   工作台总览：快照 + 待审批 + 任务 / 助手
 *   能力矩阵  ：矩阵 + 智能体 + 技能 / 助手
 *   交付追踪  ：运行 + 趋势图 + 死信
 *   治理与策略：调度策略 + 审计 / 工作流 + 告警 + 助手
 */
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', '外壳', 'scenarios');

const scenarios = [
  {
    id: 'overview',
    name: '工作台总览',
    description:
      '一屏看完"现在要做什么"：左上实时快照（待审批/成功/失败/积压/覆盖率），左下待审批节点（可直接通过或驳回），右侧任务列表（按状态筛、点行看业务参数），下方场景助手。全部原生面板。',
    order: 1,
    first: true,
    panels: [
      { id: 'ov-kpi', title: '场景快照', sub: '实时 · 15 秒刷新', type: 'am-kpi', col: 1, row: 1, w: 1, h: 2 },
      { id: 'ov-approvals', title: '待审批', sub: '通过 / 驳回后运行会继续', type: 'am-approvals', col: 1, row: 3, w: 1, h: 2 },
      { id: 'ov-tasks', title: '任务', sub: '按状态筛 · 点行看详情', type: 'am-tasks', col: 2, row: 1, w: 3, h: 2 },
      { id: 'ov-ai', title: '场景助手', sub: '真实模型 + 实时快照', type: 'am-assistant', col: 2, row: 3, w: 3, h: 2 },
    ],
  },
  {
    id: 'matrix',
    name: '能力矩阵',
    description:
      '能力侧全貌：左边 8 阶段 × 4 能力的原生网格（有智能体显示数量、空的标"缺"），右上智能体列表（可在线测试），右下技能库（可试运行），最右场景助手。',
    order: 2,
    panels: [
      { id: 'mx-grid', title: '能力矩阵', sub: '缺口标红 · 悬停看是谁', type: 'am-matrix', col: 1, row: 1, w: 2, h: 4 },
      { id: 'mx-agents', title: '智能体', sub: '点在线测试看真实调用', type: 'am-agents', col: 3, row: 1, w: 1, h: 2 },
      { id: 'mx-skills', title: '技能库', sub: '点试运行看真实返回', type: 'am-skills', col: 4, row: 1, w: 1, h: 2 },
      { id: 'mx-ai', title: '场景助手', sub: '问缺口怎么补', type: 'am-assistant', col: 3, row: 3, w: 2, h: 2 },
    ],
  },
  {
    id: 'delivery',
    name: '交付追踪',
    description:
      '跑批侧全貌：左边运行列表（点行展开明细与步骤轨迹），右上近 24 小时趋势（原生 SVG，失败的小时标红），右下死信（可重试或忽略）。',
    order: 3,
    panels: [
      { id: 'dl-runs', title: '运行监控', sub: '20 秒刷新 · 点行看步骤', type: 'am-runs', col: 1, row: 1, w: 2, h: 4 },
      { id: 'dl-chart', title: '运行趋势', sub: '近 24 小时 · 按小时聚合', type: 'am-chart', col: 3, row: 1, w: 2, h: 2 },
      { id: 'dl-dlq', title: '死信队列', sub: '重试 / 忽略', type: 'am-deadletters', col: 3, row: 3, w: 2, h: 2 },
    ],
  },
  {
    id: 'governance',
    name: '治理与策略',
    description:
      '治理侧全貌：调度策略（改权重 → 试算 → 保存）、审计日志（按动作筛、看变更前后）、工作流（校验）、告警（确认/恢复）、场景助手。',
    order: 4,
    panels: [
      { id: 'gv-dispatch', title: '调度策略', sub: '改权重 → 试算 → 保存', type: 'am-dispatch', col: 1, row: 1, w: 2, h: 2 },
      { id: 'gv-audit', title: '审计日志', sub: '只追加 · 可筛动作', type: 'am-audit', col: 1, row: 3, w: 2, h: 2 },
      { id: 'gv-workflows', title: '工作流', sub: '点校验看结构问题', type: 'am-workflows', col: 3, row: 1, w: 2, h: 2 },
      { id: 'gv-alerts', title: '告警', sub: '确认 / 恢复', type: 'am-alerts', col: 3, row: 3, w: 2, h: 2 },
      { id: 'gv-ai', title: '场景助手', sub: '问治理相关的事', type: 'am-assistant', col: 1, row: 5, w: 4, h: 2 },
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
  console.log(`${s.id}: ${doc.panels.length} 面板 → ${doc.panels.map((p) => p.type).join(', ')}`);
}
