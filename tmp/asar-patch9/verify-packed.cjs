const asar = require('@electron/asar');
const path = 'C:\\Users\\Admin\\Downloads\\Duan\\CRM_FB1\\tmp\\asar-patch9\\out-app.asar';
const read = (p) => asar.extractFile(path, p).toString('utf8');

const checks = [
  ['dist\\client\\index.html', 'index-BmTrHPSn.js'],
  ['dist\\client\\assets\\index-BmTrHPSn.js', 'Lấy danh sách tài khoản'],
  ['dist\\client\\assets\\index-BmTrHPSn.js', 'đã có sẵn'],
  ['dist\\client\\assets\\index-BmTrHPSn.js', ' tài khoản đã chọn'],
  ['dist\\server\\services\\VietSeedingImportService.js', 'NAME_FIELDS'],
  ['dist\\server\\services\\VietSeedingImportService.js', 'FETCH_SHAPE'],
  ['dist\\server\\services\\VietSeedingImportService.js', 'ho_ten'],
  ['dist\\server\\services\\VietSeedingImportService.js', 'listAccountsForSelection'],
  ['dist\\server\\server.js', 'list-accounts'],
  ['dist\\server\\database\\db.js', '20261014002']
];

let fail = 0;
for (const [file, needle] of checks) {
  let content;
  try { content = read(file); } catch (err) { console.log(`MISSING FILE: ${file}`); fail++; continue; }
  if (content.includes(needle)) console.log(`PASS ${needle}`);
  else { console.log(`FAIL ${needle}`); fail++; }
}
console.log(fail ? 'VERIFY_FAILED' : 'VERIFY_ALL_OK');
process.exit(fail ? 1 : 0);
