const asar = require('@electron/asar');
const base = 'C:\\Users\\Admin\\Downloads\\Duan\\CRM_FB1\\release\\win-unpacked\\resources\\app.asar';
const dbjs = asar.extractFile(base, 'dist\\server\\database\\db.js').toString('utf8');
const svc = asar.extractFile(base, 'dist\\server\\services\\CommentLeadsService.js').toString('utf8');
console.log('flag present:', dbjs.includes('allowsRowCountReduction: true'));
console.log('migration present:', dbjs.includes('version: 20261014001'));
console.log('svc WAITING:', svc.includes("inbox_folder: 'MESSAGE_REQUEST_POSSIBLE'"));
