const asar = require('@electron/asar');
const path = require('path');
const asarPath = path.join(__dirname, '..', 'release/win-unpacked/resources/app.asar');
const files = asar.listPackage(asarPath).map((e) => String(e).replace(/^[\/]/, '')).filter((e) => e.startsWith('dist\client\assets\index-'));
for (const f of files) {
  const src = asar.extractFile(asarPath, f).toString('utf8');
  console.log(f, 'size=' + src.length, 'fetchPhase=' + src.includes('Đang lấy danh sách cookie'), 'vietseeding=' + src.includes('Nhập từ Viet Seeding'));
}
