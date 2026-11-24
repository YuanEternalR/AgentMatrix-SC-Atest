/**
 * 场景布局基线脚本（4 列网格，每场景 2~6 个面板）。
 *
 * 现状（2026-11-24 第二十一轮）：每个场景 1 个「DSH 会话」（`harness`）+ 若干原生面板；
 * 原先各场景的「场景助手」（`am-assistant`）已按使用反馈移除，AI 问答统一走 DSH 会话。
 * 本脚本直接重写 `外壳/scenarios/*.json`，改布局时先改这里再跑一遍，别手改 JSON 另立一份。
 *
 * 工作台总览：快照 + 待审批 + 任务 / 新建 + DSH 会话
 * 工作流设计：设计器 + DSH 会话
 * 能力矩阵  ：矩阵 + 智能体 / 技能库 + DSH 会话
 * 交付追踪  ：运行 + 趋势图 / 死信 + DSH 会话
 * 治理与策略：调度策略 + 审计 / 工作流 + 告警 / DSH 会话 + 账号
 */
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', '外壳', 'scenarios');

const CHAT = { title: 'DSH 会话', sub: '这个场景的 AI 会话（DSH 引擎）', type: 'harness' };

const scenarios = [
  {
    id: 'overview',
    name: '工作台总览',
    description:
      '一屏看完"现在要做什么"：左上实时快照（待审批/成功/失败/积压/覆盖率），左下待审批节点（可直接通过或驳回），右侧任务列表与新建表单（点行看业务参数），下方本场景的 DSH 会话。除 DSH 会话外均为原生面板。',
    order: 1,
    first: true,
    panels: [
      { id: 'ov-kpi', title: '场景快照', sub: '实时 · 15 秒刷新', type: 'am-kpi', col: 1, row: 1, w: 1, h: 2 },
      { id: 'ov-approvals', title: '待审批', sub: '通过 / 驳回后运行会继续', type: 'am-approvals', col: 1, row: 3, w: 1, h: 2 },
      { id: 'ov-tasks', title: '任务', sub: '按状态筛 · 点行看详情', type: 'am-tasks', col: 2, row: 1, w: 2, h: 2 },
      { id: 'ov-create', title: '新建', sub: '任务 / 技能 / 智能体', type: 'am-create', col: 4, row: 1, w: 1, h: 2 },
      { id: 'ov-chat', ...CHAT, col: 2, row: 3, w: 3, h: 2 },
    ],
  },
  {
    id: 'designer',
    name: '工作流设计',
    description:
      '可视化改流程：拖动节点摆位、点节点改参数与连接、校验结构、发布新版本；下方是这个场景的 DSH 会话，可以问「这条流程哪里容易卡」。除 DSH 会话外全部原生实现，不嵌网页。',
    order: 2,
    panels: [
      { id: 'ds-canvas', title: '设计器', sub: '拖节点 · 点节点改参数 · 校验 → 发布', type: 'am-designer', col: 1, row: 1, w: 4, h: 4 },
      { id: 'ds-chat', ...CHAT, col: 1, row: 5, w: 4, h: 2 },
    ],
  },
  {
    id: 'matrix',
    name: '能力矩阵',
    description:
      '能力侧全貌：左边 8 阶段 × 4 能力的原生网格（有智能体显示数量、空的标"缺"），右上智能体列表（可在线测试），右下技能库（可试运行），下方这个场景的 DSH 会话。',
    order: 3,
    panels: [
      { id: 'mx-grid', title: '能力矩阵', sub: '缺口标红 · 悬停看是谁', type: 'am-matrix', col: 1, row: 1, w: 2, h: 4 },
      { id: 'mx-agents', title: '智能体', sub: '点在线测试看真实调用', type: 'am-agents', col: 3, row: 1, w: 2, h: 2 },
      { id: 'mx-skills', title: '技能库', sub: '点试运行看真实返回', type: 'am-skills', col: 3, row: 3, w: 2, h: 2 },
      { id: 'mx-chat', ...CHAT, col: 1, row: 5, w: 4, h: 2 },
    ],
  },
  {
    id: 'delivery',
    name: '交付追踪',
    description:
      '跑批侧全貌：左边运行列表（点行展开明细与步骤轨迹），右上近 24 小时趋势（原生 SVG，失败的小时标红），右下死信（可重试或忽略），下方这个场景的 DSH 会话。',
    order: 4,
    panels: [
      { id: 'dl-runs', title: '运行监控', sub: '20 秒刷新 · 点行看步骤', type: 'am-runs', col: 1, row: 1, w: 2, h: 4 },
      { id: 'dl-chart', title: '运行趋势', sub: '近 24 小时 · 按小时聚合', type: 'am-chart', col: 3, row: 1, w: 2, h: 2 },
      { id: 'dl-dlq', title: '死信队列', sub: '重试 / 忽略', type: 'am-deadletters', col: 3, row: 3, w: 2, h: 2 },
      { id: 'dl-chat', ...CHAT, col: 1, row: 5, w: 4, h: 2 },
    ],
  },
  {
    id: 'governance',
    name: '治理与策略',
    description:
      '治理侧全貌：调度策略（改权重 → 试算 → 保存）、审计日志（按动作筛、看变更前后）、工作流（校验）、告警（确认/恢复）、账号切换，下方这个场景的 DSH 会话。',
    order: 5,
    panels: [
      { id: 'gv-dispatch', title: '调度策略', sub: '改权重 → 试算 → 保存', type: 'am-dispatch', col: 1, row: 1, w: 2, h: 2 },
      { id: 'gv-audit', title: '审计日志', sub: '只追加 · 可筛动作', type: 'am-audit', col: 1, row: 3, w: 2, h: 2 },
      { id: 'gv-workflows', title: '工作流', sub: '点校验看结构问题', type: 'am-workflows', col: 3, row: 1, w: 2, h: 2 },
      { id: 'gv-alerts', title: '告警', sub: '确认 / 恢复', type: 'am-alerts', col: 3, row: 3, w: 2, h: 2 },
      { id: 'gv-chat', ...CHAT, col: 1, row: 5, w: 3, h: 2 },
      { id: 'gv-account', title: '账号', sub: '切换登录身份', type: 'am-account', col: 4, row: 5, w: 1, h: 2 },
    ],
  },
];

function check(id, panels) {
  const seen = new Map();
  for (const p of panels) {
    if (p.col + p.w - 1 > 4) throw new Error(`${id}/${p.id} 超过 4 列`);
    for (let c = p.col; c < p.col + p.w; c += 1) {
      for (let r = p.row; r < p.row + p.h; r += 1) {
        const key = `${c},${r}`;
        if (seen.has(key)) throw new Error(`${id}: ${p.id} 与 ${seen.get(key)} 在 ${key} 重叠`);
        seen.set(key, p.id);
      }
    }
  }
}

for (const s of scenarios) {
  check(s.id, s.panels);
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
