const fs = require('fs');
const path = require('path');
const asar = require('@electron/asar');

const newAsar = 'C:/Users/Admin/Downloads/Duan/CRM_FB1/tmp/asar-patch/out2/app.asar';
const B = '\\';
const buf = asar.extractFile(newAsar, 'dist/server/server.js'.split('/').join(B).replace(/^\\/, ''));
fs.writeFileSync('C:/Users/Admin/Downloads/Duan/CRM_FB1/tmp/asar-patch/from-asar-server.js', buf);

const serviceBuf = asar.extractFile(newAsar, 'dist/server/services/CommentLeadsService.js'.split('/').join(B).replace(/^\\/, ''));
fs.writeFileSync('C:/Users/Admin/Downloads/Duan/CRM_FB1/tmp/asar-patch/from-asar-service.js', serviceBuf);
console.log('extracted', buf.length, serviceBuf.length);
