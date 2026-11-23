/**
 * Workbench launcher logic (Node). Chinese output lives here, not in the .cmd.
 *
 * Why: cmd.exe parses .cmd with the OEM code page, so Chinese there gets split
 * into bogus commands. The .cmd stays ASCII and only bootstraps this script.
 *
 * What it does:
 *   1. find the shell folder (its name is Chinese, resolved here in JS where
 *      UTF-8 source is parsed correctly);
 *   2. read DSH_PORT from 工作台配置.ini (default 58360) so the shell reuses the
 *      DSH instance that is already running instead of spawning a second engine;
 *   3. spawn Electron.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SHELL_DIR_NAME = '外壳';
const SHELL_DIR = path.join(ROOT, SHELL_DIR_NAME);
const CONFIG_FILE = path.join(ROOT, '工作台配置.ini');
const ELECTRON = path.join(SHELL_DIR, 'node_modules', 'electron', 'dist', 'electron.exe');

function say(line = '') {
  process.stdout.write(line + '\n');
}

/** 从 ini 里读 DSH_PORT；读不到就用默认端口 */
function readPort() {
  const fallback = '58360';
  try {
    const text = fs.readFileSync(CONFIG_FILE, 'utf8').replace(/^\uFEFF/, '');
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#') || line.startsWith(';')) continue;
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      if (line.slice(0, eq).trim() === 'DSH_PORT') {
        const value = line.slice(eq + 1).trim();
        if (value) return value;
      }
    }
  } catch {
    /* 没有配置文件就用默认值 */
  }
  return fallback;
}

function main() {
  if (!fs.existsSync(SHELL_DIR)) {
    say(`找不到工作台目录：${SHELL_DIR}`);
    process.exitCode = 1;
    return;
  }
  if (!fs.existsSync(ELECTRON)) {
    say('还没安装 Electron 运行时。在 外壳 目录执行：');
    say('  set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/');
    say('  npm install');
    say('  node node_modules\\electron\\install.js');
    process.exitCode = 1;
    return;
  }

  const port = process.env.DSH_PORT || readPort();
  say(`工作台：DSH 引擎用 127.0.0.1:${port}（没在跑就自己拉起来，已在跑就复用）`);
  say('平台（AgentMatrix 站点 5173 / 接口 8000）由工作台启动时自动拉起，不用再先手动 dev up。');

  // DSH 引擎需要 profiles（web/desktop）；用户已有的 DSH 家目录在 ~/.dsh。
  // 不指过去的话，引擎会去 <引擎>/.dsh 找 profile，那里是空的 → 启动即失败。
  // 工作台用自己的 DSH 家目录（引擎/.dsh）：里面只有一个工作区 = 本项目，
  // 且 profile 是裁剪过的 workbench（不是桌面端那份）。想复用桌面端就显式设 DSH_CUSTOMER_HOME。
  const dshHome = process.env.DSH_CUSTOMER_HOME || path.join(ROOT, '引擎', '.dsh');
  const env = { ...process.env, DSH_PORT: port, DSH_CUSTOMER_HOME: dshHome };
  // 环境里若残留这个变量，Electron 会被当成纯 Node 跑，报 whenReady 未定义后直接退出
  delete env.ELECTRON_RUN_AS_NODE;

  // 需要调试/自动化时带上端口：AM_DEBUG_PORT=9222 即可用 CDP 连进来
  const electronArgs = ['.'];
  if (process.env.AM_DEBUG_PORT) electronArgs.push(`--remote-debugging-port=${process.env.AM_DEBUG_PORT}`);

  const child = spawn(ELECTRON, electronArgs, { cwd: SHELL_DIR, stdio: 'inherit', env });
  child.on('exit', (code) => process.exit(code ?? 0));
}

main();
