const asar = require('@electron/asar');
const path = 'C:\\Users\\Admin\\Downloads\\Duan\\CRM_FB1\\tmp\\asar-patch10\\out-app.asar';
const read = (p) => asar.extractFile(path, p).toString('utf8');

const checks = [
  ['dist\\server\\services\\VietSeedingImportService.js', 'scrapeFbName'],
  ['dist\\server\\services\\VietSeedingImportService.js', 'enrichNames'],
  ['dist\\server\\services\\VietSeedingImportService.js', 'pickScraperBrowser'],
  ['dist\\server\\services\\VietSeedingImportService.js', 'fbNameCache'],
  ['dist\\server\\services\\VietSeedingImportService.js', 'cookie_json'],
  ['dist\\server\\services\\VietSeedingImportService.js', 'fb_uid ?? item.c_user'],
  ['dist\\server\\services\\VietSeedingImportService.js', 'NAMES scraped='],
  ['dist\\server\\server.js', 'listAccountsForSelection(limit, processManager)'],
  ['dist\\client\\index.html', 'index-BmTrHPSn.js'],
  ['dist\\client\\assets\\index-BmTrHPSn.js', 'Lấy danh sách tài khoản'],
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
