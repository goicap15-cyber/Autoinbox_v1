const asar = require('@electron/asar');
const path = require('path');
const B = path.sep;
const asarPath = path.join(__dirname, '..', 'release/win-unpacked/resources/app.asar');
const svc = asar.extractFile(asarPath, ['dist', 'server', 'services', 'VietSeedingImportService.js'].join(B)).toString('utf8');
const checks = {
  'hard cap 3 phut': svc.includes('Account treo quá 3 phút'),
  'CDP timeout co ban': svc.includes('Chrome không trả danh sách tab (CDP treo)'),
  'login check': svc.includes('assertFbLoginAccepted'),
  'instant URL check': svc.includes('redirect login/checkpoint là phản hồi server-side'),
  'cleanup Chrome loi': svc.includes('stopAccountProcess(pendingKey)'),
  'pre-filter': svc.includes('Kho API không còn account mới'),
  'nhap du so luong': svc.includes('Chỉ nhập được'),
  'stale theo tien do': svc.includes('lastProgressAt')
};
let fail = 0;
for (const [k, v] of Object.entries(checks)) { console.log((v ? 'OK  ' : 'FAIL') + ' ' + k); if (!v) fail++; }
process.exit(fail ? 1 : 0);
