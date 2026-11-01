const { extractFile, listPackage } = require('@electron/asar');
const fs = require('fs');
const path = require('path');

const base = 'C:/Users/Admin/AppData/Local/Temp/crm_build_release/win-unpacked';
const asarPath = path.join(base, 'resources', 'app.asar');

const files = listPackage(asarPath).filter(f => /client.*assets.*\.js/.test(f));
let found = 0, checked = 0;
for (const f of files) {
  const rel = f.replace(/^[\\/]+/, '');
  const s = extractFile(asarPath, rel).toString('utf8');
  checked++;
  if (s.includes('Trạng thái xử lý')) { found++; console.log('STILL HAS:', rel); }
  if (s.includes('Trạng thái khách hàng')) console.log('HAS customer-status section:', rel);
}
console.log(`checked ${checked} client js, 'Trạng thái xử lý' occurrences: ${found}`);
const bg = extractFile(asarPath, 'dist\\extension\\background.js').toString('utf8');
console.log('ext 11c still ok:', bg.includes('2026-10-11c'), '| quoteSkip:', (bg.match(/inReplyQuote/g) || []).length >= 1);
const looseExt = fs.readFileSync(path.join(base, 'resources', 'extension', 'background.js'), 'utf8');
console.log('loose ext 11c:', looseExt.includes('2026-10-11c'));
