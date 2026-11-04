const asar = require('@electron/asar');
const svc = asar.extractFile('release/win-unpacked/resources/app.asar', 'dist\server\services\VietSeedingImportService.js').toString('utf8');
console.log('service prefilter marker:', svc.includes('Kho API không còn account mới'));
console.log('skip logic:', svc.includes('job.skipped'));
const main = asar.extractFile('release/win-unpacked/resources/app.asar', 'dist\server\server.js').toString('utf8');
console.log('import-status route:', main.includes('vietseeding/import-status'));
console.log('import route:', main.includes("'vietseeding/import'"));
const clientFiles = asar.listPackage('release/win-unpacked/resources/app.asar').filter(f => f.startsWith('\dist\client\assets\index-'));
let ui = '';
for (const f of clientFiles) {
  ui += asar.extractFile('release/win-unpacked/resources/app.asar', f.slice(1)).toString('utf8');
}
console.log('UI label:', ui.includes('Nhập từ Viet Seeding'));
console.log('UI note fallback:', ui.includes('đã có sẵn (bỏ qua)'));
