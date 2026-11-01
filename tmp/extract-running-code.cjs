const fs = require('fs');
const path = require('path');
const asar = require('@electron/asar');

const asarPath = 'C:/Users/Admin/Downloads/Duan/CRM_FB1/release/win-unpacked/resources/app.asar';
const outDir = 'C:/Users/Admin/Downloads/Duan/CRM_FB1/tmp/extracted-running';
fs.mkdirSync(outDir, { recursive: true });

const files = [
  'dist/server/server.js',
  'dist/server/services/CommentLeadsService.js',
  'src/client/components/CommentLeadsModal.jsx',
];

for (const p of files) {
  try {
    const buf = asar.extractFile(asarPath, p.split('/').join('\\').replace(/^\\/, ''));
    const outName = p.replace(/[/\\]/g, '__');
    fs.writeFileSync(path.join(outDir, outName), buf);
    console.log('OK', p, buf.length, 'bytes');
  } catch (e) {
    console.log('FAIL', p, e.message);
  }
}
