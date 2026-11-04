const asar = require('@electron/asar');
const fs = require('fs');
const path = require('path');
const asarPath = 'tmp/asar-patch3/out-app.asar';
const list = asar.listPackage(asarPath).map((p) => p.split('\\').join('/'));
const assets = list.filter((p) => p.startsWith('dist/client/assets/') && p.endsWith('.js'));
let found = false;
for (const a of assets) {
  const buf = asar.extractFile(asarPath, a.split('/').join('\\'));
  if (buf.toString('utf8').includes('Tất cả khách đã được nhắn tin')) { console.log('OK client marker in', a); found = true; break; }
}
if (!found) console.log('FAIL client marker');
function countFiles(root) { let n = 0; for (const e of fs.readdirSync(root, { withFileTypes: true })) { const p = path.join(root, e.name); if (e.isDirectory()) n += countFiles(p); else n += 1; } return n; }
const unDir = 'tmp/asar-patch3/out-app.asar.unpacked';
console.log('unpacked count:', countFiles(unDir));
const nodeBin = [];
(function walk(root) { for (const e of fs.readdirSync(root, { withFileTypes: true })) { const p = path.join(root, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.node')) nodeBin.push(p); } })(unDir);
console.log('.node files:', nodeBin.length, nodeBin.map((p) => p.split(path.sep).slice(-2).join('/')));
