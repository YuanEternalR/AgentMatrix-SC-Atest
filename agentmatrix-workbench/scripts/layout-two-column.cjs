/**
 * 一次性脚本：把四个场景改成「一宽 + 一助手」两栏版式。
 *
 * 为什么：模板用 <webview> 嵌页面，在高 DPI（本机 170%）下 guest 按设备像素布局，
 * 宽度 350px 的面板会把内容裁掉（截图可见）。把面板做成半屏（约 750px）就正常了。
 * 所以每个场景只留两个面板：左边是该场景的主视图，右边是场景助手。
 */
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', '外壳', 'scenarios');

const BASE = 'http://127.0.0.1:5173';
const COMMON = (id, title, sub, route, sceneName) => ({
  id,
  title,
  sub,
  type: 'embed',
  url: `${BASE}${route}?embed=1&theme=dark&as=ops`,
  expand: true,
  col: 1,
  row: 1,
  w: 2,
  h: 4,
  failHint: '平台未启动：在 agentmatrix-sc 根目录跑 dev up，dev ps 全部 healthy 后再刷新面板。',
  offHint: '已摘下这个网页（省一个 guest 进程）。点「内置」切回来。',
  __scene: sceneName,
});

const assistant = (sceneId) => ({
  id: `${sceneId}-ai`,
  title: '场景助手',
  sub: '真实模型 + 平台实时快照',
  type: 'embed',
  url: `${BASE}/assistant?embed=1&theme=dark&as=ops&scene=${sceneId}`,
  col: 3,
  row: 1,
  w: 2,
  h: 4,
  failHint: '平台未启动：dev up 后刷新面板。',
  offHint: '已摘下。点「内置」切回来。',
});

const scenarios = [
  {
    id: 'overview',
    name: '工作台总览',
    description:
      '一条业务请求从发起到审批的全景：左边是 AgentMatrix 工作台本体，右边是这个场景的 AI 助手（它看到的是实时快照，不是编的数字）。',
    order: 1,
    first: true,
    left: COMMON('ov-app', '工作台', '发起任务 · 待办审批 · 任务列表', '/', 'overview'),
  },
  {
    id: 'matrix',
    name: '能力矩阵',
    description: '8 阶段 × 4 能力的覆盖与缺口：左边矩阵本体，右边助手（问「哪种格子还是空的、先补谁」）。',
    order: 2,
    left: COMMON('mx-matrix', '智能体矩阵', '8 阶段 × 4 能力 · 覆盖率与缺口', '/matrix', 'matrix'),
  },
  {
    id: 'delivery',
    name: '交付追踪',
    description: '跑批与留痕：左边运行监控（点行看步骤轨迹），右边助手（问「这条运行为什么失败」）。',
    order: 3,
    left: COMMON('dl-runs', '运行监控', '按创建时间倒序 · 步骤级轨迹', '/runs', 'delivery'),
  },
  {
    id: 'governance',
    name: '治理与策略',
    description: '谁在什么策略下被派活：左边调度策略（改权重可试算），右边助手（问「权重该往哪调」）。',
    order: 4,
    left: COMMON('gv-dispatch', '调度策略', '五策略 · 六因子权重 · 改 → 试算 → 保存', '/settings/dispatch', 'governance'),
  },
];

for (const s of scenarios) {
  const left = { ...s.left };
  delete left.__scene;
  const doc = {
    id: s.id,
    name: s.name,
    description: s.description,
    layout: 'grid',
    theme: 'dark',
    ...(s.first ? { first: true } : {}),
    panels: [left, assistant(s.id)],
  };
  const file = path.join(dir, `${s.id}.json`);
  fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  console.log('wrote', path.basename(file), '->', doc.panels.map((p) => p.title).join(' | '));
}
