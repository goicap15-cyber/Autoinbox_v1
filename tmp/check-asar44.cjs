const fs = require('fs');
const asar = require('C:/Users/Admin/Downloads/Duan/CRM_FB1/node_modules/@electron/asar');
const B = String.fromCharCode(92);
const asarPath = 'C:/Users/Admin/Downloads/Duan/CRM_FB1/release/win-unpacked/resources/app.asar';
const ext = fs.readFileSync('C:/Users/Admin/Downloads/Duan/CRM_FB1/release/win-unpacked/resources/extension/background.js', 'utf8');
const srv = asar.extractFile(asarPath, ['dist', 'server', 'server.js'].join(B)).toString('utf8');

const bundles = asar.listPackage(asarPath).map(String)
  .filter((f) => f.includes('assets') && /index-.+\.js$/.test(f));
let client = '';
const loaded = [];
for (const raw of bundles) {
  const rel = raw.replace(/^\\+/, '');
  try {
    const content = asar.extractFile(asarPath, rel).toString('utf8');
    loaded.push(rel);
    client += '\n/*' + rel + '*/\n' + content;
  } catch (_) {}
}
console.log('bundles:', loaded.join(', ') || 'NONE');

let fail = 0;
const must = [
  ['ext build42: user_job_occupies_history_lane', ext.includes('user_job_occupies_history_lane')],
  ['ext build42: personalHistoryUserJobActive', ext.includes('personalHistoryUserJobActive')],
  ['srv: sendViaExtension 3 tham số (không reply)', srv.includes('async function sendViaExtension(thread_id, text, client_message_id = null)')],
  ['client: composer text', client.includes('Nhập tin nhắn')]
];
const mustNot = [
  ['ext: activateMessengerReplyState', ext.includes('activateMessengerReplyState')],
  ['ext: dispatchTrustedMouseMove', ext.includes('dispatchTrustedMouseMove')],
  ['ext: reply_to', ext.includes('reply_to')],
  ['srv: reply_to', srv.includes('reply_to')],
  ['client: replyTo', client.includes('replyTo')],
  ['client: Đang trả lời', client.includes('Đang trả lời')]
];
for (const [n, ok] of must) { console.log((ok ? 'OK  ' : 'FAIL') + ' ' + n); if (!ok) fail++; }
for (const [n, bad] of mustNot) { console.log((bad ? 'FAIL' : 'OK  ') + ' (không được có) ' + n); if (bad) fail++; }
process.exit(fail ? 1 : 0);
