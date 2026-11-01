const asar = require('@electron/asar');
const path = require('path');
const B = path.sep;
const rel = 'release/win-unpacked/resources/app.asar';
const base = path.join(__dirname, '..');
const asarPath = path.join(base, rel);

function readFile(entries) {
  return asar.extractFile(asarPath, entries.join(B).replace(/^[\\/]/, ''));
}

let fail = 0;
function check(name, cond) {
  console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!cond) fail++;
}

const serverJs = readFile(['dist', 'server', 'server.js']).toString('utf8');
check('server.js: require VietSeedingImportService', serverJs.includes("require('./services/VietSeedingImportService')"));
check('server.js: route import-status', serverJs.includes('/api/accounts/vietseeding/import-status'));

let serviceJs = null;
try {
  const list = asar.listPackage(asarPath).map((e) => String(e).replace(/^[\\/]/, ''));
  const hit = list.find((e) => e.includes('VietSeedingImportService'));
  console.log('list hit:', hit || '(none)');
  if (hit) serviceJs = asar.extractFile(asarPath, hit).toString('utf8');
} catch (e) { console.log('list err', e.message); }
check('asar: VietSeedingImportService.js đóng gói', Boolean(serviceJs));
if (serviceJs) {
  check('service: startImport', serviceJs.includes('async function fetchCookieAccounts'));
  check('service: pre-filter marker', serviceJs.includes('Kho API không còn account mới'));
  check('service: skipped counter', serviceJs.includes('job.skipped'));
}

const clientAssets = asar.listPackage(asarPath).map((e) => String(e).replace(/^[\\/]/, '')).filter((e) => e.startsWith('dist\\client\\assets\\index-') && e.endsWith('.js'));
let uiHit = false;
for (const entry of clientAssets) {
  const src = asar.extractFile(asarPath, entry).toString('utf8');
  if (src.includes('Nhập từ Viet Seeding')) { uiHit = true; break; }
}
check('client bundle: "Nhập từ Viet Seeding"', uiHit);
let uiNote = false;
for (const entry of clientAssets) {
  const src = asar.extractFile(asarPath, entry).toString('utf8');
  if (src.includes('đã có sẵn (bỏ qua)')) { uiNote = true; break; }
}
check('client bundle: summary fallback', uiNote);

process.exit(fail ? 1 : 0);
