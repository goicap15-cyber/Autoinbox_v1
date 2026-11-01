const fs = require('fs');
const NL = '\r\n';
const ROOT = 'C:/Users/Admin/Downloads/Duan/CRM_FB1/';
const files = {
  bg: ROOT + 'src/extension/background.js',
  srv: ROOT + 'src/server/server.js',
  app: ROOT + 'src/client/App.jsx',
  bubble: ROOT + 'src/client/components/MessageBubble.jsx',
  list: ROOT + 'src/client/components/MessageList.jsx'
};
const orig = {};
for (const [k, p] of Object.entries(files)) orig[k] = fs.readFileSync(p, 'utf8');

// Each op: replace(needle, replacement) with count check, or range(startMarker, endMarker) removing [start, end).
const ops = {
  bg: [
    { kind: 'range', start: '// Hover qua DOM event khong bat duoc CSS :hover', end: 'async function dispatchTrustedHistoryWheel(' },
    { kind: 'range', start: '// Bat che do "Tra loi" trong Messenger cho tin dich', end: 'async function handleSendMessage(' },
    { kind: 'replace', needle: ", account_id = user_id, tab_role = 'interaction', reply_to = null }) {", replacement: ", account_id = user_id, tab_role = 'interaction' }) {" },
    { kind: 'replace', needle: '  const replyActive = Boolean(reply_to && String(reply_to.snippet || \'\'));' + NL, replacement: '' },
    { kind: 'replace', needle: '            // Bubble dang reply boc text trong quote: so sanh contains thay vi equals.' + NL + '            const text = normalize(element.textContent);' + NL + '            return (text === wanted || (replyActive && text.includes(wanted))) && /(?:Bạn|You)(?::|\\s|$)/i.test(label);', replacement: '            const text = normalize(element.textContent);' + NL + '            return text === wanted && /(?:Bạn|You)(?::|\\s|$)/i.test(label);' },
    { kind: 'range', start: '    if (reply_to) {' + NL + '      const replyState = await activateMessengerReplyState(', end: '    const tabSendResult = await chrome.scripting.executeScript({' }
  ],
  srv: [
    { kind: 'replace', needle: 'async function sendViaExtension(thread_id, text, client_message_id = null, reply_to = null) {', replacement: 'async function sendViaExtension(thread_id, text, client_message_id = null) {' },
    { kind: 'replace', needle: '        client_message_id: clientMsgId,' + NL + '        reply_to: reply_to ? {' + NL + '          fb_message_id: String(reply_to.fb_message_id || \'\'),' + NL + '          snippet: String(reply_to.snippet || \'\').substring(0, 500),' + NL + '          media_type: String(reply_to.media_type || \'text\'),' + NL + '          sender_label: String(reply_to.sender_label || \'\')' + NL + '        } : null' + NL, replacement: '        client_message_id: clientMsgId,' + NL },
    { kind: 'replace', needle: '    const replyInfo = (payload.reply_to && typeof payload.reply_to === \'object\') ? payload.reply_to : null;' + NL, replacement: '' },
    { kind: 'replace', needle: '      await sendViaExtension(thread_id, content, client_message_id, replyInfo);', replacement: '      await sendViaExtension(thread_id, content, client_message_id);' }
  ],
  app: [
    { kind: 'replace', needle: "import { MessageSquare, X } from 'lucide-react';", replacement: "import { MessageSquare } from 'lucide-react';" },
    { kind: 'range', start: '  // Tra loi 1 tin cu the kieu Messenger: bubble -> state nay -> composer.', end: '  const requestThreadMessageSync = useCallback(' },
    { kind: 'range', start: "      // Tra loi 1 tin cu the: chi duong text thuan (attachment di queue rieng,", end: "      socket.emit('SEND_MESSAGE', {" },
    { kind: 'replace', needle: '        attachment_id: payload.attachment_id,' + NL + '        reply_to: replyInfo' + NL + '      });' + NL + '      setReplyTo(null);' + NL + '      return;', replacement: '        attachment_id: payload.attachment_id' + NL + '      });' + NL + '      return;' },
    { kind: 'replace', needle: '              onReplyMessage={handleStartReply}' + NL, replacement: '' },
    { kind: 'range', start: '            {replyTo && (', end: "            {['MESSAGE_REQUEST_SPAM', 'MESSAGE_REQUEST_POSSIBLE'].includes(selectedThread.inbox_folder) ? (" }
  ],
  bubble: [
    { kind: 'replace', needle: "PhoneIncoming, Reply } from 'lucide-react';", replacement: "PhoneIncoming } from 'lucide-react';" },
    { kind: 'replace', needle: 'export default function MessageBubble({ msg, activeThread, onRetry, onReply, isLastSeenByCustomer = false }) {', replacement: 'export default function MessageBubble({ msg, activeThread, onRetry, isLastSeenByCustomer = false }) {' },
    { kind: 'range', start: "          {onReply && status !== 'sending'", end: '          {isOutgoing && <span className="font-medium">{senderName}</span>}' }
  ],
  list: [
    { kind: 'replace', needle: 'onRetryMessage, onReplyMessage, onViewportScroll', replacement: 'onRetryMessage, onViewportScroll' },
    { kind: 'replace', needle: 'onRetry={onRetryMessage} onReply={onReplyMessage} />', replacement: 'onRetry={onRetryMessage} />' }
  ]
};

const out = {};
const problems = [];
for (const [key, list] of Object.entries(ops)) {
  let src = orig[key];
  for (const op of list) {
    if (op.kind === 'replace') {
      const count = src.split(op.needle).length - 1;
      if (count !== 1) { problems.push(`${key}: REPLACE x${count} :: ${op.needle.slice(0, 90).replace(/\r/g, '')}`); continue; }
      src = src.replace(op.needle, op.replacement);
    } else {
      const s = src.indexOf(op.start);
      if (s === -1) { problems.push(`${key}: RANGE-START MISS :: ${op.start.slice(0, 80)}`); continue; }
      if (src.indexOf(op.start) !== src.lastIndexOf(op.start)) { problems.push(`${key}: RANGE-START DUP :: ${op.start.slice(0, 80)}`); continue; }
      const e = src.indexOf(op.end, s + op.start.length);
      if (e === -1) { problems.push(`${key}: RANGE-END MISS :: ${op.end.slice(0, 80)}`); continue; }
      src = src.slice(0, s) + src.slice(e);
    }
  }
  out[key] = src;
}
if (problems.length) {
  console.log('ABORT - khong ghi file. Van de:');
  for (const p of problems) console.log('  ' + p);
  process.exit(1);
}
for (const [key, src] of Object.entries(out)) {
  if (key === 'bg' || key === 'srv') {
    try { new Function(src); } catch (err) { console.log(`ABORT - loi cu phap ${key}: ${err.message}`); process.exit(1); }
  }
  fs.writeFileSync(files[key], src);
  console.log(`OK ${files[key]} (${orig[key].length} -> ${src.length} chars)`);
}
const leftovers = [];
for (const [key, src] of Object.entries(out)) {
  for (const pat of ['reply_to', 'replyTo', 'replyInfo', 'replyActive', 'activateMessengerReplyState', 'dispatchTrustedMouseMove', 'onReplyMessage', 'handleStartReply']) {
    if (src.includes(pat)) leftovers.push(`${key}: ${pat}`);
  }
}
console.log(leftovers.length ? 'LEFTOVER: ' + leftovers.join(', ') : 'CLEAN - khong con code reply');
