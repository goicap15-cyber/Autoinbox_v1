const fs = require('fs');
const path = require('path');
const asar = require('@electron/asar');

const asarPath = 'C:/Users/Admin/Downloads/Duan/CRM_FB1/release/win-unpacked/resources/app.asar';
const outDir = 'C:/Users/Admin/Downloads/Duan/CRM_FB1/tmp/extracted-running2';
fs.mkdirSync(outDir, { recursive: true });
const B = '\\';

const files = [
  'dist/server/repositories/ConversationRepository.js',
  'dist/server/repositories/MessageQueueRepository.js',
];
for (const p of files) {
  const buf = asar.extractFile(asarPath, p.split('/').join(B).replace(/^\\/, ''));
  const outName = p.replace(/[/\\]/g, '__');
  fs.writeFileSync(path.join(outDir, outName), buf);
  console.log('OK', p, buf.length);
}
