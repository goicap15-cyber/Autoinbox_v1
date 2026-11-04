const asar = require('@electron/asar');
const path = require('path');
const B = path.sep;
const asarPath = path.join(__dirname, '..', 'release/win-unpacked/resources/app.asar');
const svc = asar.extractFile(asarPath, ['dist', 'server', 'services', 'VietSeedingImportService.js'].join(B)).toString('utf8');
console.log('login-check:', svc.includes('assertFbLoginAccepted'));
console.log('cleanup on fail:', svc.includes('stopAccountProcess(pendingKey)'));
console.log('prefilter still there:', svc.includes('Kho API không còn account mới'));
