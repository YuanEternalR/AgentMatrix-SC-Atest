/**
 * preload：只暴露工作台需要的那几个能力，不给渲染层 Node 权限。
 *
 * 渲染层拿到的是 `window.shell`；浏览器模式下由 renderer/app.js 用同名方法
 * 包一层 fetch（见 app.js 顶部的 httpAdapter），两边接口一致。
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('shell', {
  mode: 'electron',
  listScenarios: () => ipcRenderer.invoke('shell:scenarios'),
  getScenario: (id) => ipcRenderer.invoke('shell:scenario', id),
  readMemory: (id) => ipcRenderer.invoke('shell:memory:read', id),
  writeMemory: (id, text) => ipcRenderer.invoke('shell:memory:write', id, text),
  token: () => ipcRenderer.invoke('shell:token'),
  context: () => ipcRenderer.invoke('shell:context'),
  ask: (body) => ipcRenderer.invoke('shell:ask', body),
  health: () => ipcRenderer.invoke('shell:health'),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  config: () => ipcRenderer.invoke('shell:config'),
  // 渲染层自报「已经画出来了」：主进程据此写日志。
  // Electron 模式下窗口截图不可靠（会被别的窗口挡住），这是最硬的界面就绪证据。
  reportReady: (info) => ipcRenderer.send('shell:ready', info),
});
