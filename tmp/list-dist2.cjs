const asar = require('@electron/asar');
const path = require('path');
const asarPath = path.join(__dirname, '..', 'release', 'win-unpacked', 'resources', 'app.asar');
const files = asar.listPackage(asarPath).map(String);
const topDist = files.filter((f) => f.startsWith(path.sep + 'dist'));
console.log('top-level \\dist entries:', topDist.length);
const clientIdx = topDist.filter((f) => f.includes(path.sep + 'client' + path.sep + 'assets' + path.sep + 'index-'));
console.log('client index bundles:', clientIdx.length);
console.log(clientIdx.join('\n'));
for (const f of clientIdx) {
  const src = asar.extractFile(asarPath, f.replace(/^./, '')).toString('utf8');
  console.log(f, 'fetchPhase=' + src.includes('Đang lấy danh sách cookie'), 'pollLost=' + src.includes('Mất liên lạc với đợt nhập'));
}
