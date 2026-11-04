const asar = require('@electron/asar');
const path = require('path');
const asarPath = path.join(__dirname, '..', 'release', 'win-unpacked', 'resources', 'app.asar');
const files = asar.listPackage(asarPath).map(String);
const dist = files.filter((f) => f.toLowerCase().includes('dist'));
console.log('dist-ish entries:', dist.length);
console.log(dist.slice(0, 25).join('\n'));
