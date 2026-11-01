const fs = require('fs');
const asar = require('C:/Users/Admin/Downloads/Duan/CRM_FB1/node_modules/@electron/asar');
const B = String.fromCharCode(92);

const asarPath = 'C:/Users/Admin/Downloads/Duan/CRM_FB1/release/win-unpacked/resources/app.asar';
const extPath = 'C:/Users/Admin/Downloads/Duan/CRM_FB1/release/win-unpacked/resources/extension/background.js';
const ext = fs.readFileSync(extPath, 'utf8');
const srv = asar.extractFile(asarPath, ['dist', 'server', 'server.js'].join(B)).toString('utf8');

const asarList = asar.listPackage(asarPath);
const bundleName = asarList.map((f) => String(f)).find((f) => f.includes('assets') && f.includes('index-') && f.endsWith('.js'));
const client = bundleName ? asar.extractFile(asarPath, bundleName.replace(/^\\+/, '')).toString('utf8') : '';
console.log('client bundle:', bundleName || 'NOT FOUND');

const checks = [
  ['ext: dispatchTrustedMouseMove', ext.includes('async function dispatchTrustedMouseMove')],
  ['ext: activateMessengerReplyState', ext.includes('async function activateMessengerReplyState')],
  ['ext: REPLY_TARGET_NOT_FOUND', ext.includes('REPLY_TARGET_NOT_FOUND')],
  ['ext: REPLY_STATE trace', ext.includes("trace('REPLY_STATE'")],
  ['ext: reply-aware confirmation', ext.includes('replyActive && text.includes(wanted)')],
  ['ext: handleSendMessage reply_to param', ext.includes("tab_role = 'interaction', reply_to = null")],
  ['srv: sendViaExtension reply param', srv.includes('client_message_id = null, reply_to = null')],
  ['srv: extWs.send carries reply_to', srv.includes('reply_to: reply_to ? {')],
  ['srv: handler extracts replyInfo', srv.includes("const replyInfo = (payload.reply_to && typeof payload.reply_to === 'object')")],
  ['client: reply bar text', client.includes('Đang trả lời')],
  ['client: bubble button title', client.includes('Trả lời tin nhắn này')],
  ['client: reply_to in emit', client.includes('reply_to')]
];

let fail = 0;
for (const [name, ok] of checks) {
  console.log((ok ? 'OK  ' : 'FAIL') + ' ' + name);
  if (!ok) fail++;
}
process.exit(fail ? 1 : 0);
