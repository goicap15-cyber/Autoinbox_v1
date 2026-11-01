const fs = require('fs');
const p = 'C:/Users/Admin/Downloads/Duan/CRM_FB1/src/server/server.js';
let src = fs.readFileSync(p, 'utf8');
const NL = '\r\n';
const n = (s) => s.replace(/\n/g, NL);

function rep(name, from, to) {
  const f = n(from);
  const t = n(to);
  const count = src.split(f).length - 1;
  if (count !== 1) {
    console.log(`MISS/DUP ${name}: ${count} occurrences`);
    process.exit(1);
  }
  src = src.replace(f, t);
  console.log('OK', name);
}

// S1: sendViaExtension accepts reply_to
rep('sendViaExtension signature',
`async function sendViaExtension(thread_id, text, client_message_id = null) {`,
`async function sendViaExtension(thread_id, text, client_message_id = null, reply_to = null) {`);

// S2: forward reply_to to the extension
rep('extWs.send reply_to',
`    extWs.send(JSON.stringify({
      type: 'SEND_MESSAGE',
      data: {
        account_id: thread.account_id,
        thread_id,
        thread_url: thread.thread_url || null,
        expected_contact_name: thread.contact_name || null,
        content: text,
        client_message_id: clientMsgId
      }
    }));`,
`    extWs.send(JSON.stringify({
      type: 'SEND_MESSAGE',
      data: {
        account_id: thread.account_id,
        thread_id,
        thread_url: thread.thread_url || null,
        expected_contact_name: thread.contact_name || null,
        content: text,
        client_message_id: clientMsgId,
        reply_to: reply_to ? {
          fb_message_id: String(reply_to.fb_message_id || ''),
          snippet: String(reply_to.snippet || '').substring(0, 500),
          media_type: String(reply_to.media_type || 'text'),
          sender_label: String(reply_to.sender_label || '')
        } : null
      }
    }));`);

// S3: SEND_MESSAGE handler extracts + passes reply_to
rep('SEND_MESSAGE handler destructuring',
`  socket.on('SEND_MESSAGE', async (payload = {}) => {
    const { thread_id, content, client_message_id, attachment_id, contract_version } = payload;`,
`  socket.on('SEND_MESSAGE', async (payload = {}) => {
    const { thread_id, content, client_message_id, attachment_id, contract_version } = payload;
    const replyInfo = (payload.reply_to && typeof payload.reply_to === 'object') ? payload.reply_to : null;`);

rep('SEND_MESSAGE plain path passes reply',
`      await sendViaExtension(thread_id, content, client_message_id);`,
`      await sendViaExtension(thread_id, content, client_message_id, replyInfo);`);

new Function(src);
fs.writeFileSync(p, src);
console.log('SAVED, syntax OK, length', src.length);
