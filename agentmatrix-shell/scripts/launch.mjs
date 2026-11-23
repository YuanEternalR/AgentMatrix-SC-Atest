/**
 * 工作台外壳启动器（Node 实现，中文由它输出）
 *
 * 为什么逻辑不写在 start.cmd 里：
 *   cmd.exe 按系统码页（中文 Windows 是 GBK）逐行解析 .cmd 文件，
 *   而 .cmd 文件被保存成 UTF-8 → 中文注释和执行语句被拆成乱码"命令"，
 *   报一堆 "'xxx' 不是内部或外部命令"。所以 .cmd 只留 ASCII，中文全部放这里。
 *
 * 用法（start.cmd 会转调过来）：
 *   node scripts/launch.mjs          Electron 模式
 *   node scripts/launch.mjs web      浏览器模式（http://127.0.0.1:4180）
 *   node scripts/launch.mjs check    只自检，不打开界面
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'shell.config.json'), 'utf8'));
const { apiBase, webBase } = CONFIG.agentmatrix;
const ELECTRON_EXE = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const MIRROR = process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/';

const mode = (process.argv[2] || 'app').toLowerCase();

function say(line = '') {
  process.stdout.write(`${line}\n`);
}

function fail(line) {
  process.stdout.write(`\n${line}\n`);
  process.exitCode = 1;
}

/** 跑一个命令并等它结束；失败返回非 0 */
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_MIRROR: MIRROR, ...(options.env || {}) },
  });
  return result.status ?? 1;
}

async function probe(url, timeoutMs = 4000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

async function healthSummary() {
  const apiOk = await probe(`${apiBase.replace(/\/api\/v1$/, '')}/health`);
  const webOk = await probe(webBase);
  say(`   AgentMatrix 后端 ${apiBase} → ${apiOk ? '在线' : '离线'}`);
  say(`   前端页面 ${webBase} → ${webOk ? '在线' : '离线'}`);
  if (!apiOk) {
    say('   提示：在 agentmatrix-sc 根目录执行 `dev up`，等 `dev ps` 全部 healthy 再试。');
  }
  return { apiOk, webOk };
}

function ensureElectron() {
  if (fs.existsSync(ELECTRON_EXE)) return true;

  say('[1/3] 首次运行：准备 Electron 运行时（走国内镜像，约 100MB）……');
  if (!fs.existsSync(path.join(ROOT, 'node_modules', 'electron'))) {
    const installCode = run(process.platform === 'win32' ? 'cmd.exe' : 'npm', [
      ...(process.platform === 'win32' ? ['/c'] : []),
      'npm install --no-audit --no-fund',
    ]);
    if (installCode !== 0) {
      fail('npm install 失败。手动重试：\n  set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/\n  npm install');
      return false;
    }
  }

  const installJs = path.join(ROOT, 'node_modules', 'electron', 'install.js');
  const code = run(process.execPath, [installJs]);
  if (code !== 0 || !fs.existsSync(ELECTRON_EXE)) {
    fail('Electron 运行时下载失败。手动重试：\n  set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/\n  node node_modules\\electron\\install.js');
    return false;
  }
  return true;
}

async function main() {
  say('AgentMatrix-SC 工作台外壳');
  say(`模式：${mode === 'web' ? '浏览器' : mode === 'check' ? '仅自检' : 'Electron'}`);
  say('');

  say('[1/3] 检查平台是否在线……');
  const health = await healthSummary();

  if (mode === 'check') {
    say('');
    say(`Electron 运行时：${fs.existsSync(ELECTRON_EXE) ? '已就绪' : '未安装（首次运行 start.cmd 会自动下载）'}`);
    say('');
    say(health.apiOk && health.webOk ? '自检通过。' : '自检未通过：先启动平台再试。');
    return;
  }

  if (mode === 'web') {
    say('');
    say('[2/3] 浏览器模式：同一份渲染层，不需要 Electron。');
    say(`[3/3] 打开 http://127.0.0.1:${CONFIG.shell.webPort || 4180}`);
    if (!health.apiOk) say('     （后端离线，面板会显示错误态而不是白屏）');
    const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, stdio: 'inherit' });
    child.on('exit', (code) => process.exit(code ?? 0));
    return;
  }

  say('[2/3] 准备 Electron 运行时……');
  if (!ensureElectron()) return;

  say('[3/3] 启动窗口……');
  // 关键：环境里若残留 ELECTRON_RUN_AS_NODE=1，Electron 会被当成纯 Node 跑，
  // 报 "Cannot read properties of undefined (reading 'whenReady')" 后直接退出。
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  const child = spawn(ELECTRON_EXE, ['.'], { cwd: ROOT, stdio: 'inherit', env });
  child.on('exit', (code) => {
    say(`\n窗口已关闭（退出码 ${code ?? 0}）。界面渲染日志：agentmatrix-shell\\shell.log`);
    process.exit(code ?? 0);
  });
}

main().catch((err) => {
  fail(`启动失败：${err.message}`);
});
