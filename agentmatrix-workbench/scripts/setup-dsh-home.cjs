/**
 * 生成「工作台专用」的 DSH 家目录：引擎/.dsh
 *
 * 为什么需要这个脚本：`.dsh` 里有凭据与运行时数据，**不进版本库**；
 * 但"只在本项目工作、去掉无关入口"的裁剪必须可复现，所以把它写成脚本。
 *
 * 做的事：
 *   1. 建目录结构；
 *   2. 写 workbench profile（官方 web 模板的结构 + 我们的模型配置 + 裁剪项）；
 *   3. 预置**唯一**工作区 = 本项目根目录；
 *   4. 从 ~/.dsh 复制凭据（模型可用）；
 *   5. 若本机有 pnpm，把 dsh-agentmatrix-tools 装进这个 profile。
 *
 * 用法：node agentmatrix-workbench/scripts/setup-dsh-home.cjs
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const WORKBENCH = path.resolve(__dirname, '..');
const PROJECT = path.resolve(WORKBENCH, '..');
const HOME = path.join(WORKBENCH, '引擎', '.dsh');
const PROFILE = path.join(HOME, 'profiles', 'workbench');

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
  console.log('wrote', path.relative(WORKBENCH, file));
}

// 1) profile 骨架
// 注意：dsh-agentmatrix-tools 要等插件真的装成功后才写进 bundles（见第 5 步）。
// 先写进去会在没装 pnpm 的机器上留下"引用了未安装 bundle"的坏 profile，引擎直接起不来。
write(
  path.join(PROFILE, 'package.json'),
  JSON.stringify(
    {
      name: 'dsh-profile-workbench',
      private: true,
      dependencies: {},
      dsh: {
        profile: {
          bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'],
        },
      },
    },
    null,
    2,
  ) + '\n',
);
write(path.join(PROFILE, 'cordis.yml'), '[]\n');
write(path.join(PROFILE, 'pnpm-workspace.yaml'), "packages:\n  - '.'\n");

// 2) patch：模型固定 + 裁剪无关入口
write(
  path.join(PROFILE, 'cordis.patch.yml'),
  [
    '# 工作台专用 profile（由 scripts/setup-dsh-home.cjs 生成）',
    '- id: agent-default-model',
    '  name: "@deepseek-ai/dsh-agent-default-model"',
    '  config:',
    '    provider: deepseek-account',
    '    model: deepseek-flash',
    '    reasoningEffort: high',
    '# —— 裁剪：去掉与本项目无关的入口（row id 来自 --dump-config）——',
    '- id: tool-plugin-market',
    '  disabled: true',
    '- id: ui-sidebar-browser',
    '  disabled: true',
    '# —— 新对话自动接上项目进度：重新打开 agent-instructions（dsh-web-app 默认关掉）——',
    '# 打开后每个新会话会自动加载仓库根目录的 AGENTS.md（内含 HANDOFF 阅读顺序与当前基线）。',
    '- id: agent-instructions',
    '  disabled: false',
    '',
  ].join('\n'),
);

// 3) 唯一工作区 = 本项目
const workspaceId = '6f1b2c3d-4e5f-4a60-9b71-8c2d3e4f5a60';
const now = new Date().toISOString();
write(
  path.join(HOME, 'storages', 'workspace.json'),
  JSON.stringify(
    {
      unit: { name: 'workspace', version: 2 },
      global: {
        initialized: true,
        defaultWorkspaceId: workspaceId,
        workspaceIds: [workspaceId],
        archivedSessionIds: [],
        pinnedSessionIds: [],
      },
      tables: {
        workspaces: {
          [workspaceId]: {
            path: PROJECT,
            title: 'AgentMatrix-SC',
            sessionIds: [],
            createdAt: now,
            updatedAt: now,
          },
        },
      },
    },
    null,
    2,
  ) + '\n',
);

// 4) 凭据
const credSrc = path.join(os.homedir(), '.dsh', '.credentials.yaml');
const credDst = path.join(HOME, '.credentials.yaml');
if (!fs.existsSync(credDst) && fs.existsSync(credSrc)) {
  fs.copyFileSync(credSrc, credDst);
  console.log('copied credentials');
}

// 5) 装插件（需要 pnpm）
const env = Object.assign({}, process.env, { DSH_HOME: HOME });
const cli = path.join(WORKBENCH, '引擎', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
if (!fs.existsSync(cli)) {
  console.log('没找到 DSH CLI：先在 agentmatrix-workbench/引擎 里执行 npm install，再重跑本脚本');
  console.log('（否则 profile 里没有 dsh-agentmatrix-tools，DSH 会话中看不到 agentmatrix_* 工具）');
} else {
  const r = spawnSync(
    process.execPath,
    [cli, 'plugin', '--profile', 'workbench', 'add', 'link:' + path.join(PROJECT, 'dsh-plugins', 'agentmatrix-tools')],
    { cwd: path.join(WORKBENCH, '引擎'), env, stdio: 'inherit', windowsHide: true },
  );
  if (r.status !== 0) {
    console.log('插件安装失败（可能没有 pnpm）：npm install -g --allow-scripts=pnpm pnpm 后重跑本脚本');
    console.log('工作台仍可启动，但 DSH 会话里暂时没有 agentmatrix_* 工具。');
  } else {
    // 装成功了再把 bundle 写进 profile（失败时上面写出的 profile 仍是可启动的干净版本）
    const pkgFile = path.join(PROFILE, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
    pkg.dsh = pkg.dsh ?? {};
    pkg.dsh.profile = pkg.dsh.profile ?? {};
    const bundles = pkg.dsh.profile.bundles ?? [];
    if (!bundles.includes('dsh-agentmatrix-tools')) {
      pkg.dsh.profile.bundles = [...bundles, 'dsh-agentmatrix-tools'];
      fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
      console.log('已把 dsh-agentmatrix-tools 写进 profile bundles');
    }
  }
}

console.log('\n完成。家目录：' + HOME);
