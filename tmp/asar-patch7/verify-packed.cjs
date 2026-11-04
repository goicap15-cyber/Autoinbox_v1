// Verify packed asar: markers phải nằm trong archive (đường dẫn BACKSLASH bắt buộc).
const asar = require('@electron/asar');
const path = 'C:\\Users\\Admin\\Downloads\\Duan\\CRM_FB1\\tmp\\asar-patch7\\out-app.asar';

const read = (p) => asar.extractFile(path, p).toString('utf8');

const checks = [
  ['dist\\server\\server.js', 'list-accounts'],
  ['dist\\server\\services\\VietSeedingImportService.js', 'listAccountsForSelection'],
  ['dist\\server\\services\\VietSeedingImportService.js', 'CACHE_HIT'],
  ['dist\\server\\services\\VietSeedingImportService.js', 'DEAD_STATUS_RE'],
  ['dist\\server\\database\\db.js', '20261014002'],
  ['dist\\server\\services\\CommentLeadsService.js', 'removeLeadThreadIfEmpty'],
  ['dist\\client\\index.html', 'assets/index-BuNUIZ9k.js']
];

let fail = 0;
for (const [file, needle] of checks) {
  let content;
  try { content = read(file); } catch (err) { console.log(`MISSING FILE: ${file} (${err.message})`); fail++; continue; }
  if (content.includes(needle)) console.log(`PASS ${file} :: ${needle}`);
  else { console.log(`FAIL ${file} :: ${needle}`); fail++; }
}
console.log(fail ? 'VERIFY_FAILED' : 'VERIFY_ALL_OK');
process.exit(fail ? 1 : 0);
