/**
 * 一次性脚本：把场景里的 harness 面板换成我们自己的场景助手页。
 *
 * 为什么不用 harness：模板的 harness 面板要求 DSH 引擎目录 + 引擎启动 token，
 * 本机是打包版安装（没有 引擎\apps\cli），复用运行中的实例又拿不到 token，
 * 面板只能显示"引擎还没就绪"。改用 /assistant 页后，回答来自 /workbench/ask
 * （真实模型 + 后端实时快照），嵌进面板即用。
 */
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', '外壳', 'scenarios');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));

for (const file of files) {
  const full = path.join(dir, file);
  const raw = fs.readFileSync(full, 'utf8').replace(/^\uFEFF/, '');
  const scenario = JSON.parse(raw);
  let changed = false;

  for (const panel of scenario.panels || []) {
    if (panel.type !== 'harness') continue;
    panel.type = 'embed';
    panel.url = `http://127.0.0.1:5173/assistant?embed=1&theme=dark&as=ops&scene=${scenario.id}`;
    panel.sub = '真实模型 + 平台实时快照';
    panel.failHint = '平台未启动：在 agentmatrix-sc 根目录跑 dev up。';
    panel.offHint = '已摘下。点「内置」切回来。';
    delete panel.sessionTitle;
    delete panel.pinTarget;
    delete panel.sessionId;
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(full, JSON.stringify(scenario, null, 2) + '\n', 'utf8');
    console.log('updated', file);
  }
}
