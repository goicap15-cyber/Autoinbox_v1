const asar = require('@electron/asar');
const path = require('path');
const B = path.sep;
const asarPath = path.join(__dirname, '..', 'release/win-unpacked/resources/app.asar');
const svc = asar.extractFile(asarPath, ['dist', 'server', 'services', 'VietSeedingImportService.js'].join(B)).toString('utf8');
const pm = asar.extractFile(asarPath, ['dist', 'server', 'services', 'ProcessManager.js'].join(B)).toString('utf8');
const clientFiles = asar.listPackage(asarPath).map((e) => String(e).replace(/^[\/]/, '')).filter((e) => e.startsWith('dist\client\assets\index-') && e.endsWith('.js'));
let ui = '';
for (const entry of clientFiles) ui += asar.extractFile(asarPath, entry).toString('utf8');
const checks = {
  'service: jobLog file': svc.includes('vietseeding-job.log'),
  'service: watchdog kill': svc.includes('WATCHDOG_KILL'),
  'service: attempt log': svc.includes('ATTEMPT'),
  'service: pre-filter còn': svc.includes('Kho API không còn account mới'),
  'service: đủ số lượng còn': svc.includes('Chỉ nhập được'),
  'ProcessManager: stopPendingProcesses': pm.includes('stopPendingProcesses'),
  'UI: fetch phase': ui.includes('Đang lấy danh sách cookie từ Viet Seeding'),
  'UI: poll mất liên lạc': ui.includes('Mất liên lạc với đợt nhập')
};
let fail = 0;
for (const [k, v] of Object.entries(checks)) { console.log((v ? 'OK  ' : 'FAIL') + ' ' + k); if (!v) fail++; }
process.exit(fail ? 1 : 0);
