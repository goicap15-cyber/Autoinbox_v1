const B = require('path').sep;
const p = require('path');
const asar = require('@electron/asar');
const asarPath = p.join(__dirname, 'out-app.asar');

function read(rel) {
  return asar.extractFile(asarPath, rel.split('/').join(B)).toString('utf8');
}

const checks = [
  ['dist/server/services/AppSetupAutomation.js', ['lastPageSyncAt', "String(appId || '')", "appId: target,"]],
  ['dist/server/server.js', [':id/sync-pages', 'last_page_sync_at']],
  ['dist/client/assets/index-Bi8Xq9_7.js', ['Chọn app để đồng bộ page', 'Đồng ý', 'Đang dùng đồng bộ', 'viền xanh']],
  ['server/services/AppSetupAutomation.js', ['lastPageSyncAt']],
  ['client/assets/index-Bi8Xq9_7.js', ['Chọn app để đồng bộ page']],
];

let fail = 0;
for (const [rel, needles] of checks) {
  let src;
  try { src = read(rel); } catch (e) { console.log('FAIL read', rel, e.message); fail++; continue; }
  const missing = needles.filter((n) => !src.includes(n));
  if (missing.length) { console.log('FAIL', rel, 'missing:', missing); fail++; }
  else console.log('PASS', rel, '(' + needles.length + ' needles)');
}

try {
  const header = asar.getRawHeader(asarPath).header;
  let node = header;
  for (const s of 'node_modules/better-sqlite3/build/Release/better_sqlite3.node'.split('/')) {
    node = node && node.files && node.files[s];
  }
  console.log('better_sqlite3.node:', node && node.unpacked === true ? 'UNPACKED' : 'IN_ARCHIVE');
  if (!node || node.unpacked !== true) fail++;
} catch (e) { console.log('FAIL header', e.message); fail++; }

console.log(fail ? 'RESULT: FAIL ' + fail : 'RESULT: ALL PASS');
process.exit(fail ? 1 : 0);
