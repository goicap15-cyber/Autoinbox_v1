const asar = require('@electron/asar');
const asarPath = 'tmp/asar-patch3/out-app.asar';
const list = asar.listPackage(asarPath).map((p) => p.split('\\').join('/'));
const client = list.filter((p) => p.includes('client'));
console.log('client paths:', client.length);
console.log(client.slice(0, 15).join('\n'));
console.log('---');
console.log('dirs sample:', list.filter((p) => p.split('/').length <= 2).slice(0, 30).join(' | '));
