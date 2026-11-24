#!/usr/bin/env node
// 场景专属 DSH 会话：保证 5 个场景各有一条"内置"会话，并把 sessionId 回写场景 json。
//
// 为什么需要它：每个场景的「DSH 会话」面板已经改成**单会话模式**（不显示全局侧栏），
// 面板靠 scene json 里的 sessionTitle / sessionId 固定到本场景那条会话。
// 换机器、清空 .dsh、或会话被归档后，这些 id 就失效了 —— 本脚本负责重建并回写。
//
// 前置：工作台/DSH 引擎已在跑（默认 127.0.0.1:3083）。token 从 外壳/server.log 的最后一条
// "dsh web: ...?token=..." 读取，也可用环境变量 DSH_TOKEN 指定。
//
// 用法：
//   node 工具\场景会话.mjs list                 列出每个场景绑哪条会话、现状
//   node 工具\场景会话.mjs ensure               缺哪条建哪条（不写开场消息；空会话不进侧栏）
//   node 工具\场景会话.mjs ensure --seed        建完写一条"本场景常驻会话"开场消息（推荐）
//   node 工具\场景会话.mjs check                校验 json 里的 id/标题与引擎一致（出包前跑）
//   node 工具\场景会话.mjs ensure --dry         只看计划，不建、不写
//
// 注意：--seed 会真实调用一次模型（每个新会话约 1 万 token）；已有非空会话不会重复 seed。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCEN_DIR = path.join(ROOT, '外壳', 'scenarios');
const DSH_HOME = process.env.DSH_HOME || path.join(ROOT, '引擎', '.dsh');
const PORT = process.env.DSH_PORT || '3083';
const BASE = 'http://127.0.0.1:' + PORT;
const CWD = path.resolve(ROOT, '..');   // 仓库根 = 引擎 session 的 cwd

const argv = process.argv.slice(2);
const mode = argv[0] || 'list';
const dry = argv.includes('--dry');
const seed = argv.includes('--seed');

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
}

function readToken() {
  if (process.env.DSH_TOKEN) return process.env.DSH_TOKEN.trim();
  const log = path.join(ROOT, '外壳', 'server.log');
  if (!fs.existsSync(log)) return '';
  const text = fs.readFileSync(log, 'utf8');
  const hits = [...text.matchAll(/dsh web:\s*http:\/\/127\.0\.0\.1:\d+\/\?token=([A-Za-z0-9_-]+)/g)];
  return hits.length ? hits[hits.length - 1][1] : '';
}

async function login() {
  const token = readToken();
  if (!token) throw new Error('拿不到 DSH token：先启动工作台，或设 DSH_TOKEN');
  const r = await fetch(BASE + '/?token=' + token, { redirect: 'manual' });
  const sc = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [];
  const cookie = sc.map((c) => c.split(';')[0]).join('; ');
  if (!cookie) throw new Error('token 换不到 cookie（引擎没在跑或 token 已失效，重启工作台再试）');
  return cookie;
}

function makeRpc(cookie) {
  let seq = 0;
  return async function rpc(method, args) {
    const rpcId = 'sc' + (++seq);
    const res = await fetch(BASE + '/api/' + method, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8', cookie },
      body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { args } }),
    });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch (e) { /* ignore */ }
    const result = body && body.result;
    if (res.status !== 200 || !result || result.ok !== true) {
      throw new Error(method + ' 失败：HTTP ' + res.status + ' ' + text.slice(0, 300));
    }
    return result.value;
  };
}

function writeIndexBinding(sceneId, title, id) {
  const f = path.join(SCEN_DIR, '_场景身份索引.md');
  if (!fs.existsSync(f)) return false;
  const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
  let changed = false;
  const out = lines.map((line) => {
    if (!line.trim().startsWith('|')) return line;
    const c = line.split('|');
    const cell = String(c[1] || '').trim().replace(/\`/g, '');
    if (cell !== String(sceneId || '')) return line;
    const before = line;
    c[4] = ' `' + title + '` ';
    c[5] = ' `' + id + '` ';
    const after = c.join('|');
    if (after !== before) changed = true;
    return after;
  });
  if (changed) fs.writeFileSync(f, out.join('\n'), 'utf8');
  return changed;
}

function readScenarios() {
  return fs.readdirSync(SCEN_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ file: path.join(SCEN_DIR, f), json: readJson(path.join(SCEN_DIR, f)) }))
    .filter((x) => x.json && x.json.id);
}

function panelsOf() {
  const out = [];
  for (const sc of readScenarios()) {
    for (const p of sc.json.panels || []) {
      if (p.type === 'harness') out.push({ sc, p });
    }
  }
  return out;
}

function titleOf(p) {
  const t = String(p.sessionTitle || '').trim();
  return t || ('场景 · ' + String(p.id || '').trim());
}

async function main() {
  const cookie = await login();
  const rpc = makeRpc(cookie);
  const list = await rpc('session/list', { _request: {} });
  let items = (list && list.items) || [];
  const archived = (() => {
    try {
      const ws = readJson(path.join(DSH_HOME, 'storages', 'workspace.json')) || {};
      return new Set(((ws.global || {}).archivedSessionIds) || []);
    } catch (e) { return new Set(); }
  })();
  const live = (id) => !archived.has(id);
  const title = (it) => String((it.projections && it.projections.values && it.projections.values.title) || '').trim();
  const find = (t) => items.find((it) => title(it) === t && live(it.sessionId));

  if (mode === 'list') {
    console.log('场景专属会话（引擎 ' + BASE + '）：\n');
    for (const { sc, p } of panelsOf()) {
      const t = titleOf(p);
      const hit = find(t);
      console.log('  ' + sc.json.id + ' · ' + p.id + '  「' + t + '」');
      console.log('      json: ' + (p.sessionId || '（未写）') + '   引擎: ' + (hit ? hit.sessionId + (hit.blank ? ' 空白' : ' 已有内容') : '找不到'));
    }
    return;
  }

  const workspaceId = (() => {
    try {
      const ws = readJson(path.join(DSH_HOME, 'storages', 'workspace.json')) || {};
      const def = (ws.global || {}).defaultWorkspaceId;
      if (def && ws.tables && ws.tables.workspaces && ws.tables.workspaces[def]) return def;
    } catch (e) { /* ignore */ }
    return '';
  })();

  let bad = 0;
  let changed = 0;
  for (const { sc, p } of panelsOf()) {
    const t = titleOf(p);
    let hit = find(t);
    if (mode === 'check') {
      const id = String(p.sessionId || '').trim();
      const ok = !!hit && (!id || hit.sessionId === id);
      console.log((ok ? '✓ ' : '✗ ') + sc.json.id + ' · ' + p.id + ' 「' + t + '」 ' + (hit ? hit.sessionId : '引擎里没有这条会话'));
      if (!ok) bad++;
      continue;
    }
    if (mode !== 'ensure') throw new Error('未知命令：' + mode + '（可用 list / ensure / check）');

    if (!hit) {
      if (dry) {
        console.log('  · 将新建「' + t + '」');
        continue;
      }
      try {
        const created = await rpc('session/create', { request: workspaceId ? { workspaceId } : { cwd: CWD } });
        const id = created && created.sessionId;
        if (!id) throw new Error('create 没返回 sessionId');
        await rpc('session/rename', { request: { sessionId: id, title: t } });
        hit = { sessionId: id, blank: true, projections: { values: { title: t } } };
        items.push(hit);
        console.log('  ✓ 已新建「' + t + '」 ' + id);
      } catch (e) {
        console.log('  ✗ 新建「' + t + '」失败：' + e.message);
        bad++;
        continue;
      }
    } else {
      console.log('  · 已有「' + t + '」 ' + hit.sessionId);
    }

    if (p.sessionTitle !== t || p.sessionId !== hit.sessionId) {
      p.sessionTitle = t;
      p.sessionId = hit.sessionId;
      p.pinTarget = [t];
      if (!dry) {
        const tmp = sc.file + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(sc.json, null, 2) + '\n', 'utf8');
        fs.renameSync(tmp, sc.file);
        changed++;
      }
    }
    // 即使 json 已经正确，也把名册第一行同步一次（换机器/旧名册残留时靠它自愈）。
    if (!dry) writeIndexBinding(sc.json.id, t, hit.sessionId);

    if (seed && !dry && hit.blank) {
      // 空会话不会出现在侧栏，也打不开聊天界面；写一条开场消息并等它落库。
      // 已经有内容（!blank）就跳过，避免重复调用模型。
      const seedText = '你是 AgentMatrix-SC 工作台「' + t + '」的常驻 DSH 会话，只负责本场景范围内的问答。'
        + '涉及跨场景的共同修改时，提示用户到工作台顶部的「DSH 引擎」主会话统一协调，不要自行改其他场景的专属会话。'
        + '现在只回一句「已就绪」，不要读任何文件、不要调用任何工具、不要做别的事。';
      try {
        await rpc('session/prompt', { request: {
          requestId: (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
          sessionId: hit.sessionId, mode: 'queue', content: [{ type: 'text', text: seedText }],
        } });
        for (let i = 0; i < 40; i++) {
          await new Promise((r) => setTimeout(r, 1500));
          const now = (await rpc('session/list', { _request: {} })).items || [];
          const cur = now.find((x) => x.sessionId === hit.sessionId);
          if (cur && !cur.running && !cur.blank) { console.log('    ✓ 开场消息已写入（会话可在侧栏显示）'); break; }
        }
      } catch (e) {
        console.log('    ⚠ 开场消息写入失败（面板会停在欢迎页）：' + e.message);
        bad++;
      }
    }
  }

  if (mode === 'check') {
    console.log('\n' + (bad ? '✗ 有 ' + bad + ' 个场景会话不一致' : '✓ 5 个场景的专属会话都与 json 一致'));
    process.exitCode = bad ? 1 : 0;
  } else if (mode === 'ensure') {
    console.log('\n' + (bad ? '✗ 有 ' + bad + ' 处失败' : '✓ 场景专属会话已就绪') + (changed ? '（回写 ' + changed + ' 个场景 json）' : ''));
    process.exitCode = bad ? 1 : 0;
  }
}

main().catch((e) => {
  console.error('✗ ' + (e && e.message ? e.message : e));
  process.exitCode = 1;
});
