const asar = require('@electron/asar');
const asarPath = 'tmp/asar-patch3/out-app.asar';
const list = asar.listPackage(asarPath).map((p) => p.split('\\').join('/'));
const assets = list.filter((p) => p.startsWith('dist/client/assets/'));
console.log('asset count:', assets.length);
console.log(assets.slice(0, 10).join('\n'));
const target = assets.find((a) => a.includes('DPa2TdUL'));
console.log('target:', target);
if (target) {
  const buf = asar.extractFile(asarPath, target.split('/').join('\\'));
  const s = buf.toString('utf8');
  console.log('bytes:', buf.length, 'has marker (raw):', s.includes('Tất cả khách đã được nhắn tin'));
  console.log('has index-DPa2TdUL ref:', s.includes('DPa2TdUL'));
}
