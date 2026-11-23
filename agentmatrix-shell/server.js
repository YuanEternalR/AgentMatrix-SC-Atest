/**
 * 浏览器模式：不装 Electron 也能跑同一套工作台外壳。
 *
 * 为什么保留它：
 *   ① 演示机没装 Electron / 下载被网络卡住时，仍能展示同一界面与同一套机制；
 *   ② 自动化测试能直接用 Playwright 驱动（Electron 里的自动化要另配）；
 *   ③ 它把"外壳能力"逼成一组 HTTP 接口，反而让壳更干净。
 *
 * 路由与 main.js 的 IPC 一一对应：
 *   GET  /api/shell/scenarios | /scenario/<id> | /memory/<id> | /token | /context | /health
 *   POST /api/shell/memory/<id> | /ask
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, 'shell.config.json'), 'utf8'));
const { apiBase, webBase, email, password } = CONFIG.agentmatrix;
const PORT = Number(process.env.SHELL_PORT || CONFIG.shell.webPort || 4180);

const SCENARIOS_DIR = path.join(__dirname, 'scenarios');
const MEMORY_DIR = path.join(__dirname, 'memory');
const RENDERER_DIR = path.join(__dirname, 'renderer');

let cachedToken = null;

function listScenarios() {
  const out = [];
  for (const file of fs.readdirSync(SCENARIOS_DIR).sort()) {
    if (!file.endsWith('.json')) continue;
    const id = path.basename(file, '.json');
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(SCENARIOS_DIR, file), 'utf8'));
      if (raw.id !== id) continue;
      out.push({ id: raw.id, name: raw.name || raw.id, description: raw.description || '', order: Number(raw.order ?? 999) });
    } catch {
      /* 解析失败静默跳过，与 Electron 侧一致 */
    }
  }
  out.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return out;
}

function getScenario(id) {
  const file = path.join(SCENARIOS_DIR, `${id}.json`);
  if (!fs.existsSync(file)) throw new Error(`场景不存在：${id}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function memoryPath(id) {
  return path.join(MEMORY_DIR, `${id}.md`);
}

function readMemory(id) {
  return fs.existsSync(memoryPath(id)) ? fs.readFileSync(memoryPath(id), 'utf8') : '';
}

function writeMemory(id, text) {
  fs.mkdirSync(MEMORY_DIR, { recursive: true });
  fs.writeFileSync(memoryPath(id), String(text ?? ''), 'utf8');
  return true;
}

async function login() {
  const res = await fetch(`${apiBase}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username: email, password }),
  });
  if (!res.ok) throw new Error(`登录失败 HTTP ${res.status}`);
  cachedToken = (await res.json()).access_token;
  return cachedToken;
}

async function token() {
  return cachedToken || login();
}

async function apiGet(pathname) {
  const auth = await token();
  const res = await fetch(`${apiBase}${pathname}`, { headers: { Authorization: `Bearer ${auth}` } });
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
  if (!res.ok) throw new Error(`${pathname} → HTTP ${res.status}`);
  return res.json();
}

async function health() {
  const result = { api: false, web: false, detail: '' };
  try {
    const res = await fetch(`${apiBase.replace(/\/api\/v1$/, '')}/health`);
    result.api = res.ok;
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

function json(res, code, body) {
  const text = JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

const STATIC = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
  '/styles.css': { file: 'styles.css', type: 'text/css; charset=utf-8' },
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const pathname = decodeURIComponent(url.pathname);

  try {
    if (req.method === 'GET' && STATIC[pathname]) {
      const { file, type } = STATIC[pathname];
      const body = fs.readFileSync(path.join(RENDERER_DIR, file));
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      res.end(body);
      return;
    }

    if (pathname === '/api/shell/scenarios') return json(res, 200, listScenarios());
    if (pathname === '/api/shell/token') {
      await token();
      return json(res, 200, { token: cachedToken });
    }
    if (pathname === '/api/shell/context') return json(res, 200, await apiGet('/workbench/context'));
    if (pathname === '/api/shell/health') return json(res, 200, await health());
    if (pathname === '/api/shell/config') return json(res, 200, { apiBase, webBase });

    const scenarioMatch = pathname.match(/^\/api\/shell\/scenario\/([\w-]+)$/);
    if (scenarioMatch) return json(res, 200, getScenario(scenarioMatch[1]));

    const memoryMatch = pathname.match(/^\/api\/shell\/memory\/([\w-]+)$/);
    if (memoryMatch) {
      const id = memoryMatch[1];
      if (req.method === 'GET') return json(res, 200, { text: readMemory(id) });
      if (req.method === 'POST') {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        const body = raw ? JSON.parse(raw) : {};
        writeMemory(id, body.text ?? '');
        return json(res, 200, { ok: true });
      }
    }

    if (pathname === '/api/shell/ask' && req.method === 'POST') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw || '{}');
      return json(res, 200, await apiPost('/workbench/ask', body));
    }

    json(res, 404, { error: `未知路径 ${pathname}` });
  } catch (err) {
    json(res, 500, { error: err.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[shell] 浏览器模式已启动：http://127.0.0.1:${PORT}`);
  console.log(`[shell] 后端 ${apiBase}｜前端 ${webBase}`);
});
