const asar = require('@electron/asar');
const fs = require('fs');
const B = String.fromCharCode(92);

const extPath = 'C:/Users/Admin/Downloads/Duan/CRM_FB1/release/win-unpacked/resources/extension/background.js';
const ext = fs.readFileSync(extPath, 'utf8');
const asarBuf = asar.extractFile('C:/Users/Admin/Downloads/Duan/CRM_FB1/release/win-unpacked/resources/app.asar', ['dist', 'server', 'server.js'].join(B));
const srv = asarBuf.toString('utf8');

const checks = [
  ['ext SYNC_JOB', ext.includes("stage: 'SYNC_JOB'")],
  ['ext SYNC_THREAD_START', ext.includes("stage: 'SYNC_THREAD_START'")],
  ['ext SYNC_SKIP', ext.includes("stage: 'SYNC_SKIP'")],
  ['ext SPA_NAV', ext.includes("stage: 'SPA_NAV'")],
  ['ext NAV_FALLBACK', ext.includes("stage: 'NAV_FALLBACK'")],
  ['ext SYNC_ABORT', ext.includes("stage: 'SYNC_ABORT'")],
  ['ext href_spoof_click', ext.includes('href_spoof_click')],
  ['ext incomingBoost', ext.includes('incomingBoost')],
  ['srv SYNC_DISPATCH', srv.includes("syncDebug('SYNC_DISPATCH'")],
  ['srv SYNC_DISPATCH_FAIL', srv.includes("syncDebug('SYNC_DISPATCH_FAIL'")]
];

let fail = 0;
for (const [name, ok] of checks) {
  console.log((ok ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!ok) fail++;
}
process.exit(fail ? 1 : 0);
