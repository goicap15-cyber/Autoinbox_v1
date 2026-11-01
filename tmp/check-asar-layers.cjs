const asar = require('@electron/asar');
const fs = require('fs');
const a = asar.extractFile('release/win-unpacked/resources/app.asar', ['src', 'electron.js'].join('\\')).toString('utf8');
const b = fs.readFileSync('src/electron.js', 'utf8');
console.log('electron.js repo vs asar:', a === b ? 'GIỐNG NHAU' : 'KHÁC NHAU');
if (a !== b) {
  console.log('asar len', a.length, 'repo len', b.length);
  // find first diff
  let i = 0; while (i < Math.min(a.length, b.length) && a[i] === b[i]) i++;
  console.log('first diff at', i, '\nASAR:', JSON.stringify(a.slice(i - 60, i + 60)), '\nREPO:', JSON.stringify(b.slice(i - 60, i + 60)));
}
const c = asar.extractFile('release/win-unpacked/resources/app.asar', ['src', 'server', 'server.js'].join('\\')).toString('utf8');
console.log('asar src/server has reclaimPages:', c.includes('reclaimPages'));
const d = asar.extractFile('release/win-unpacked/resources/app.asar', ['dist', 'server', 'server.js'].join('\\')).toString('utf8');
console.log('asar dist/server has reclaimPages:', d.includes('reclaimPages'));
