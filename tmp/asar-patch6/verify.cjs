const fs = require('fs');
const base = 'C:\\Users\\Admin\\Downloads\\Duan\\CRM_FB1\\tmp\\asar-patch6\\app.asar';

const svc = fs.readFileSync(base + '\\dist\\server\\services\\CommentLeadsService.js', 'utf8');
const dbjs = fs.readFileSync(base + '\\dist\\server\\database\\db.js', 'utf8');
const mqr = fs.readFileSync(base + '\\dist\\server\\repositories\\MessageQueueRepository.js', 'utf8');
const serverjs = fs.readFileSync(base + '\\dist\\server\\server.js', 'utf8');

const checks = {
  'enqueue WAITING folder': svc.includes("inbox_folder: 'MESSAGE_REQUEST_POSSIBLE'"),
  'enqueue thread_id NULL': svc.includes("SET status = 'queued', account_id = ?, thread_id = NULL, queue_id = ?"),
  'markQueueSent INBOX promote': svc.includes("inbox_folder: 'INBOX'"),
  'removeLeadThreadIfEmpty': svc.includes('function removeLeadThreadIfEmpty'),
  'markQueueFailed unlink': svc.includes("UPDATE comment_leads SET status = 'failed', error = ?, thread_id = NULL"),
  'ioRef declared': svc.includes('let ioRef = null'),
  'migration 20261014001': dbjs.includes('version: 20261014001') && dbjs.includes('comment_lead_thread_after_send_only'),
  'patch3 markQueueFailed hook': serverjs.includes('CommentLeadsService.markQueueFailed(queueId, errorReason)'),
  'patch4 failed-row revival': mqr.includes("SET status = 'pending', error_reason = NULL, processed_at = NULL, content = ?"),
  'patch5 pinned_at endpoint': serverjs.includes("SELECT strftime('%Y-%m-%d %H:%M:%f', 'now') AS ts")
};
let ok = true;
for (const [name, pass] of Object.entries(checks)) {
  console.log((pass ? 'PASS' : 'FAIL') + ' - ' + name);
  if (!pass) ok = false;
}
process.exit(ok ? 0 : 1);
