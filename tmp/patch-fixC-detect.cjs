// Fix C (2/2): preview lặp lại đúng chuỗi cũ vẫn được bắt khi row còn
// "Bây giờ" + đang unread/like. Chỉ sửa dòng ASCII-safe (line 8 có mojibake).
const fs = require('fs');
const p = 'C:/Users/Admin/Downloads/Duan/CRM_FB1/src/server/utils/sidebarIncomingDetection.js';
let src = fs.readFileSync(p, 'utf8');

const OLD = [
  "  if (String(previousThread.last_message || '').trim() === String(cleanLastMessage).trim()) return false;"
].join('\r\n');

const NEW = [
  "  // Preview lặp lại đúng chuỗi cũ vẫn phải được bắt khi dòng giờ trên row",
  "  // còn \"Bây giờ\" VÀ row đang dính chấm chưa đọc/Like - khách nhắn lại",
  "  // đúng câu cũ (\"ok\", \"dạ\") không được bị coi là \"không đổi\"",
  "  // (reproduce 2026-10-02: khách nhắn \"ok\" lần 2, CRM im lặng).",
  "  // Tự echo của CRM (không có unread) vẫn bị chặn như cũ tại đây.",
  "  const samePreview = String(previousThread.last_message || '').trim() === String(cleanLastMessage).trim();",
  "  if (samePreview",
  "    && !(isFreshRowTimeText(incomingThread?.row_time_text)",
  "      && (Number(incomingThread?.is_unread) === 1 || incomingThread?.is_like === true))) return false;"
].join('\r\n');

const count = src.split(OLD).length - 1;
if (count !== 1) { console.error(`MISS/DUP: expected 1, found ${count}`); process.exit(1); }
src = src.replace(OLD, NEW);
fs.writeFileSync(p, src, 'utf8');
const after = fs.readFileSync(p, 'utf8');
if (!after.includes('isFreshRowTimeText(incomingThread?.row_time_text)')) { console.error('VERIFY FAIL'); process.exit(1); }
console.log('OK sidebarIncomingDetection.js patched, CRLF: ' + after.includes('\r\n'));
