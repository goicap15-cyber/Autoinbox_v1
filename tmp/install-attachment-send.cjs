const fs = require('fs');
const P = 'src/server/server.js';
let src = fs.readFileSync(P, 'utf8');
const NL = src.includes('\r\n') ? '\r\n' : '\n';

// 1) Chèn hàm gửi đính kèm trước sendPageThreadViaGraph (nếu chưa có)
const FN_PATH = 'tmp/attachment-fn.txt';
if (!src.includes('async function sendPageThreadViaGraphAttachment')) {
  const FN = fs.readFileSync(FN_PATH, 'utf8');
  const anchor = 'async function sendPageThreadViaGraph(thread_id, text, client_message_id, socket) {';
  if (!src.includes(anchor)) { console.error('fn anchor not found'); process.exit(1); }
  src = src.replace(anchor, FN + NL + NL + anchor);
}

// 2) Sửa nhánh page trong SEND_MESSAGE theo dòng
const lines = src.split(NL);
const throwIdx = lines.findIndex((l) => l.includes("throw new RichMessageService.Error('PAGE_ATTACHMENT_NOT_SUPPORTED'"));
if (throwIdx < 0) { console.error('throw line not found'); process.exit(1); }
// throwIdx-1 là 'if (isRichMessage) {'; chèn nhánh attachment TRƯỚC if đó
const ifLine = lines[throwIdx - 1];
if (!ifLine.includes('if (isRichMessage) {')) { console.error('unexpected structure:', JSON.stringify(ifLine)); process.exit(1); }
const indent = ifLine.match(/^\s*/)[0];
const insert = [
  indent + "if (isRichMessage && attachment_id) {",
  indent + "  await sendPageThreadViaGraphAttachment(thread_id, content, client_message_id, attachment_id, socket);",
  indent + "  return;",
  indent + "}",
];
lines.splice(throwIdx - 1, 0, ...insert);
fs.writeFileSync(P, lines.join(NL));
console.log('OK: fn inserted + branch patched');
