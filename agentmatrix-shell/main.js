/**
 * AgentMatrix-SC 工作台外壳（Electron 主进程）
 *
 * 学自 luanyujia-workbench 的架构，只保留四件事：
 *   ① 场景在文件里：`scenarios/*.json`，加场景 = 丢一份 JSON，不改这里；
 *   ② 记忆在文件里：`memory/<场景id>.md`，换界面不丢交接；
 *   ③ 壳与平台解耦：只通过 HTTP 认识 AgentMatrix 后端，不 require 它的代码；
 *   ④ 一个场景 = 一块网格，面板按 type 查渲染器表（渲染在 renderer/app.js）。
 *
 * 另外提供 `server.js` 的浏览器模式：同一套渲染层，不装 Electron 也能跑。
 * 两种模式的差异只在 IPC 与 HTTP 之间，能力一一对应。
 */

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, 'shell.config.json'), 'utf8'));
const { apiBase, webBase, email, password } = CONFIG.agentmatrix;

const SCENARIOS_DIR = path.join(__dirname, 'scenarios');
const MEMORY_DIR = path.join(__dirname, 'memory');
const SHELL_LOG = path.join(__dirname, 'shell.log');

function log(line) {
  try {
    // 带进程号：排查"日志里出现两次 ready"时，能一眼分清是同一个实例切场景，还是残留实例在写
    fs.appendFileSync(SHELL_LOG, `${new Date().toISOString()} [pid ${process.pid}] ${line}\n`);
  } catch {
    /* 日志写不进去不影响运行 */
  }
}

let mainWindow = null;
let cachedToken = null;

/** 去掉 UTF-8 BOM：Windows 上手工另存的 JSON 常带它，JSON.parse 会直接报错 */
function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

// ---------------------------------------------------------------- 场景与记忆

function listScenarios() {
  const out = [];
  for (const file of fs.readdirSync(SCENARIOS_DIR).sort()) {
    if (!file.endsWith('.json')) continue;
    const id = path.basename(file, '.json');
    try {
      const raw = JSON.parse(stripBom(fs.readFileSync(path.join(SCENARIOS_DIR, file), 'utf8')));
      // 文件名必须等于 id：读取逻辑就是按 id 找同名文件
      if (raw.id !== id) {
        console.warn(`[scenario] ${file} 的 id=${raw.id} 与文件名不一致，已跳过`);
        continue;
      }
      out.push({ id: raw.id, name: raw.name || raw.id, description: raw.description || '', order: Number(raw.order ?? 999) });
    } catch (err) {
      console.warn(`[scenario] ${file} 解析失败：${err.message}`);
    }
  }
  out.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return out;
}

function getScenario(id) {
  const file = path.join(SCENARIOS_DIR, `${id}.json`);
  if (!fs.existsSync(file)) throw new Error(`场景不存在：${id}`);
  return JSON.parse(stripBom(fs.readFileSync(file, 'utf8')));
}

function memoryPath(id) {
  return path.join(MEMORY_DIR, `${id}.md`);
}

function readMemory(id) {
  const file = memoryPath(id);
  if (!fs.existsSync(file)) return '';
  return fs.readFileSync(file, 'utf8');
}

function writeMemory(id, text) {
  fs.mkdirSync(MEMORY_DIR, { recursive: true });
  fs.writeFileSync(memoryPath(id), String(text ?? ''), 'utf8');
  return true;
}

// ---------------------------------------------------------------- 平台对接

async function login() {
  const res = await fetch(`${apiBase}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: email, password }),
  });
  if (!res.ok) throw new Error(`登录失败 HTTP ${res.status}`);
  const data = await res.json();
  cachedToken = data.access_token;
  return data;
}

async function token() {
  if (!cachedToken) await login();
  return cachedToken;
}

async function apiGet(pathname) {
  const auth = await token();
  const res = await fetch(`${apiBase}${pathname}`, {
    headers: { Authorization: `Bearer ${auth}` },
  });
  if (res.status === 401) {
    cachedToken = null;
    return apiGet(pathname);
  }
  if (!res.ok) throw new Error(`${pathname} → HTTP ${res.status}`);
  return res.json();
}

async function apiPost(pathname, body) {
  const auth = await token();
  const res = await fetch(`${apiBase}${pathname}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${pathname} → HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function health() {
  const result = { api: false, web: false, detail: '' };
  try {
    const res = await fetch(`${apiBase.replace(/\/api\/v1$/, '')}/health`);
    result.api = res.ok;
    if (!res.ok) result.detail = `api HTTP ${res.status}`;
  } catch (err) {
    result.detail = `api ${err.message}`;
  }
  try {
    const res = await fetch(webBase, { method: 'HEAD' });
    result.web = res.ok;
  } catch (err) {
    result.detail += ` | web ${err.message}`;
  }
  return result;
}

// ---------------------------------------------------------------- 窗口

function createWindow() {
  mainWindow = new BrowserWindow({
    width: CONFIG.shell.windowWidth,
    height: CONFIG.shell.windowHeight,
    minWidth: 1100,
    minHeight: 700,
    title: 'AgentMatrix-SC 工作台',
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.setMenu(null);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  log('window created ' + CONFIG.shell.windowWidth + 'x' + CONFIG.shell.windowHeight);
}

app.whenReady().then(() => {
  // IPC：与 server.js 的 HTTP 路由一一对应，渲染层只认一套接口
  ipcMain.handle('shell:scenarios', () => listScenarios());
  ipcMain.handle('shell:scenario', (_e, id) => getScenario(id));
  ipcMain.handle('shell:memory:read', (_e, id) => readMemory(id));
  ipcMain.handle('shell:memory:write', (_e, id, text) => writeMemory(id, text));
  ipcMain.handle('shell:token', () => token());
  ipcMain.handle('shell:context', () => apiGet('/workbench/context'));
  ipcMain.handle('shell:ask', (_e, body) => apiPost('/workbench/ask', body));
  ipcMain.handle('shell:health', () => health());
  ipcMain.handle('shell:openExternal', (_e, url) => shell.openExternal(url));
  ipcMain.handle('shell:config', () => ({ apiBase, webBase }));

  // 渲染层自报"渲染完成"：写入 shell.log，作为 Electron 模式下界面就绪的证据
  ipcMain.on('shell:ready', (_event, info) => {
    log(`renderer ready tabs=${info?.tabs} current=${info?.current} panels=${info?.panels}`);
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
