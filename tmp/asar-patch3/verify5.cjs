const asar = require('@electron/asar');
const asarPath = 'tmp/asar-patch3/out-app.asar';
const buf = asar.extractFile(asarPath, 'dist\\client\\assets\\index-DPa2TdUL.js');
const s = buf.toString('utf8');
console.log('bytes:', buf.length);
console.log('client marker (ẩn sent/replied):', s.includes('Tất cả khách đã được nhắn tin'));
console.log('disk size:', require('fs').statSync('dist/client/assets/index-DPa2TdUL.js').size);
