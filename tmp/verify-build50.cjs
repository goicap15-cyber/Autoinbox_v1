// Verify build 50: tokenless-pages fix + unread pin fix trong asar
const asar = require('@electron/asar');
const path = require('path');
const B = path.sep;
const base = path.join(__dirname, '..', 'release', 'win-unpacked', 'resources', 'app.asar');

const extract = (parts) => asar.extractFile(base, parts.join(B)).toString('utf8');

const serverJs = extract(['dist', 'server', 'server.js']);
const pageApi = extract(['dist', 'server', 'services', 'PageApiService.js']);

const checks = [
  ['server.js: unread_manual = -1 (operator reply pin)', serverJs.includes('unread_manual = -1')],
  ['server.js: hasNewerIncomingPage (page lane override)', serverJs.includes('hasNewerIncomingPage')],
  ['server.js: click pin không transition (desired !== null && next === 0)', serverJs.includes('desired !== null && next === 0')],
  ['server.js: removeUntokenedPages ABSENT', !serverJs.includes('removeUntokenedPages')],
  ['PageApiService.js: removeUntokenedPages ABSENT', !pageApi.includes('removeUntokenedPages')],
  ['PageApiService.js: resubscribeAllPages present (ad-referral giữ nguyên)', pageApi.includes('resubscribeAllPages')],
  ['PageApiService.js: messaging_referrals present', pageApi.includes('messaging_referrals')],
];

let fail = 0;
for (const [name, ok] of checks) {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name);
  if (!ok) fail++;
}
console.log(fail === 0 ? '\nALL_OK' : '\nFAILED ' + fail);
process.exit(fail === 0 ? 0 : 1);
