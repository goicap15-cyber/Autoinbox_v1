// Verify asar patch14: lớp SỐNG dist/ phải chứa đủ marker mới
const B = require('path').sep;
const fs = require('fs');
const asar = require('@electron/asar');
const p = require('path');
const asarPath = p.join(__dirname, 'out-app.asar');

function read(rel) {
  return asar.extractFile(asarPath, rel.split('/').join(B)).toString('utf8');
}
function headUnpacked(rel) {
  // file nằm ngoài archive thì extractFile ném lỗi — coi như đã unpack đúng
  try { asar.extractFile(asarPath, rel.split('/').join(B)); return 'IN_ARCHIVE'; }
  catch (e) { return /not found|ENOENT/i.test(e.message) ? 'UNPACKED' : 'ERR:' + e.message; }
}

const checks = [
  ['dist/server/services/AppSetupAutomation.js', ['startAppsScan', 'runAppsScan', 'scrapeAppCards', 'appMergeScanned', "kind: 'sync-apps'"]],
  ['dist/server/services/PageApiService.js', ['appMergeScanned', "source: 'scan'", "status: 'scanned'"]],
  ['dist/server/server.js', [':id/sync-apps', 'startAppsScan', 'appMergeScanned']],
  ['dist/client/assets/index-CyTWZ_lZ.js', ['sync-apps', 'Đồng bộ app', 'FolderSync', 'Quét từ FB']],
  ['server/services/AppSetupAutomation.js', ['startAppsScan']],
  ['server/services/PageApiService.js', ['appMergeScanned']],
  ['client/assets/index-CyTWZ_lZ.js', ['sync-apps']],
];

let fail = 0;
for (const [rel, needles] of checks) {
  let src;
  try { src = read(rel); } catch (e) { console.log('FAIL read', rel, e.message); fail++; continue; }
  const missing = needles.filter((n) => !src.includes(n));
  if (missing.length) { console.log('FAIL', rel, 'missing:', missing); fail++; }
  else console.log('PASS', rel, '(' + needles.length + ' needles)');
}

const unpackedState = (() => {
  try {
    const header = asar.getRawHeader(asarPath).header;
    let node = header;
    for (const s of 'node_modules/better-sqlite3/build/Release/better_sqlite3.node'.split('/')) {
      node = node && node.files && node.files[s];
    }
    return node && node.unpacked === true ? 'UNPACKED' : 'IN_ARCHIVE';
  } catch (e) { return 'ERR:' + e.message; }
})();
console.log('better_sqlite3.node:', unpackedState);
if (unpackedState !== 'UNPACKED') fail++;

// appList trả đủ file? so sánh số entry với bản đang chạy
const list = asar.listPackage(asarPath).length;
console.log('total entries:', list);

console.log(fail ? 'RESULT: FAIL ' + fail : 'RESULT: ALL PASS');
process.exit(fail ? 1 : 0);
