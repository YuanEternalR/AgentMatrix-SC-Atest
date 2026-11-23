const fs = require('fs');
const path = require('path');
const asarPath = 'D:\\Softwares\\AI\\DS Harness\\Root\\resources\\app.asar';
const fd = fs.openSync(asarPath, 'r');
// asar 头部：8 字节 pickled 头 + JSON 目录
const head = Buffer.alloc(16);
fs.readSync(fd, head, 0, 16, 0);
const headerSize = head.readUInt32LE(12);
const buf = Buffer.alloc(headerSize);
fs.readSync(fd, buf, 0, headerSize, 16);
fs.closeSync(fd);
const size64 = (n) => n; // 简化
const strLen = buf.readUInt32LE(4);
const json = buf.slice(8, 8 + strLen).toString('utf8');
const tree = JSON.parse(json);
const out = [];
function walk(node, prefix) {
  for (const [name, child] of Object.entries(node.files || {})) {
    const p = prefix ? prefix + '/' + name : name;
    if (child.files) walk(child, p);
    else out.push(p);
  }
}
walk(tree, '');
console.log('文件总数 ' + out.length);
const hits = out.filter((p) => /apps\/cli\/lib\/bin\.js$|cli\/lib\/bin\.js$/.test(p));
console.log('cli bin 候选：' + JSON.stringify(hits.slice(0, 5)));
const sample = out.filter((p) => p.startsWith('apps/') || p.includes('/apps/')).slice(0, 10);
console.log('apps 目录样本：' + JSON.stringify(sample));
console.log('顶层：' + JSON.stringify(out.filter((p) => !p.includes('/')).slice(0, 20)));
