const asar = require('@electron/asar');
const path = 'C:\\Users\\Admin\\Downloads\\Duan\\CRM_FB1\\tmp\\asar-patch8\\out-app.asar';
const read = (p) => asar.extractFile(path, p).toString('utf8');

const checks = [
  ['dist\\client\\index.html', 'index-Bs6wDOjd.js'],
  ['dist\\client\\assets\\index-Bs6wDOjd.js', 'Lấy danh sách tài khoản'],
  ['dist\\client\\assets\\index-Bs6wDOjd.js', 'list-accounts'],
  ['dist\\client\\assets\\index-Bs6wDOjd.js', 'Nhập tài khoản đã chọn'],
  ['dist\\client\\assets\\index-Bs6wDOjd.js', 'Đang lấy cookie từ Viet Seeding'],
  ['dist\\server\\server.js', 'list-accounts'],
  ['dist\\server\\services\\VietSeedingImportService.js', 'listAccountsForSelection'],
  ['dist\\server\\database\\db.js', '20261014002'],
  ['dist\\server\\services\\CommentLeadsService.js', 'removeLeadThreadIfEmpty']
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
