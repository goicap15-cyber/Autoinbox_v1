const asar = require('@electron/asar');
const path = require('path');
const base = path.resolve(__dirname);
const asarPath = path.join(base, 'out-app.asar');
const checks = [
  ['dist\\server\\services\\AppSetupAutomation.js', 'gắn lại '],
  ['dist\\server\\services\\AppSetupAutomation.js', 'reclaimPages'],
  ['dist\\server\\services\\PageApiService.js', 'function reclaimPages'],
  ['dist\\server\\server.js', 'reclaimPages: (accountId, pageIds)'],
  ['dist\\client\\assets\\index-BmTrHPSn.js', ''],
];
let fail = 0;
for (const [file, needle] of checks) {
  try {
    const buf = asar.extractFile(asarPath, file);
    if (!needle) { console.log('OK   (exists)', file, buf.length, 'bytes'); continue; }
    const ok = buf.includes(Buffer.from(needle, 'utf8'));
    console.log(ok ? 'OK  ' : 'FAIL', file, 'needle=', JSON.stringify(needle));
    if (!ok) fail++;
  } catch (e) {
    console.log('FAIL (extract)', file, e.message);
    fail++;
  }
}
process.exit(fail ? 1 : 0);
