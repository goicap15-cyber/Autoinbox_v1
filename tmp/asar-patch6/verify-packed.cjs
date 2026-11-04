const asar = require('@electron/asar');
const base = 'C:\\Users\\Admin\\Downloads\\Duan\\CRM_FB1\\tmp\\asar-patch6\\out-app.asar';
const svc = asar.extractFile(base, 'dist\\server\\services\\CommentLeadsService.js').toString('utf8');
const dbjs = asar.extractFile(base, 'dist\\server\\database\\db.js').toString('utf8');
const serverjs = asar.extractFile(base, 'dist\\server\\server.js').toString('utf8');
const checks = {
  'svc WAITING folder': svc.includes("inbox_folder: 'MESSAGE_REQUEST_POSSIBLE'"),
  'svc thread_id NULL': svc.includes('thread_id = NULL, queue_id'),
  'svc removeLeadThreadIfEmpty': svc.includes('function removeLeadThreadIfEmpty'),
  'db migration 20261014001': dbjs.includes('version: 20261014001'),
  'patch5 pinned endpoint intact': serverjs.includes("SELECT strftime('%Y-%m-%d %H:%M:%f', 'now') AS ts"),
  'patch3 failed hook intact': serverjs.includes('CommentLeadsService.markQueueFailed(queueId, errorReason)')
};
let ok = true;
for (const [name, pass] of Object.entries(checks)) {
  console.log((pass ? 'PASS' : 'FAIL') + ' - ' + name);
  if (!pass) ok = false;
}
process.exit(ok ? 0 : 1);
