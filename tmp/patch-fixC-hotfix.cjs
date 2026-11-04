// Hotfix 45b: chặn bump unread lặp (badge hiện đi hiện lại sau khi đọc).
const fs = require('fs');
const p = 'C:/Users/Admin/Downloads/Duan/CRM_FB1/src/server/server.js';
let src = fs.readFileSync(p, 'utf8');
let fails = [];

function rep(name, oldLines, newLines, expect) {
  const OLD = oldLines.join('\r\n');
  const NEW = newLines.join('\r\n');
  const count = src.split(OLD).length - 1;
  if (count !== (expect || 1)) { fails.push(`${name}: expected ${expect || 1}, found ${count}`); return; }
  src = src.replace(OLD, NEW);
  console.log(`OK ${name}`);
}

// 1) Khai báo map theo dõi row_time_text lần quét trước.
rep('declare rowTimePrevSeen',
["const mediaHintLastSeen = new Map();"],
[
"const mediaHintLastSeen = new Map();",
"// threadKey -> row_time_text của lần quét TRƯỚC: phân biệt \"Bây giờ\" MỚI",
"// (tin vừa đến, row vừa chuyển sang fresh) với nhịp quét tiếp diễn của",
"// cùng message - không có cái này thì bump unread nổ lại mỗi 8s trong",
"// ~60s row còn \"Bây giờ\", badge hiện đi hiện lại sau khi operator đọc",
"// (báo lỗi 2026-10-02).",
"const rowTimePrevSeen = new Map();"
]);

// 2) Trong txn: cập nhật map + tính rowFreshNew, gắn vào text push.
rep('txn rowFreshNew + tag push',
[
"                const rowFresh = isFreshRowTimeText(t.row_time_text);",
"                const unreadFlippedToIncoming = previousThread",
"                  ? Number(previousThread.is_unread) !== 1",
"                  : true;"
],
[
"                const rowFresh = isFreshRowTimeText(t.row_time_text);",
"                const rowTimeNow = String(t.row_time_text || '');",
"                const rowBumpKey = account_id + ':' + existingInternalThreadId;",
"                const rowTimePrev = rowTimePrevSeen.get(rowBumpKey) || '';",
"                rowTimePrevSeen.set(rowBumpKey, rowTimeNow);",
"                if (rowTimePrevSeen.size > 800) rowTimePrevSeen.clear();",
"                const rowFreshNew = rowFresh && !isFreshRowTimeText(rowTimePrev);",
"                const unreadFlippedToIncoming = previousThread",
"                  ? Number(previousThread.is_unread) !== 1",
"                  : true;"
]);

rep('text push row_fresh_new',
[
"                    preview_content: cleanLastMsg,",
"                    preview_is_like: t.is_like === true,",
"                    row_fresh: rowFresh,",
"                    unread_flipped: unreadFlippedToIncoming"
],
[
"                    preview_content: cleanLastMsg,",
"                    preview_is_like: t.is_like === true,",
"                    row_fresh: rowFresh,",
"                    row_fresh_new: rowFreshNew,",
"                    unread_flipped: unreadFlippedToIncoming"
]);

// 3) Bump chỉ nổ 1 lần: cần "Bây giờ" MỚI hoặc flip, VÀ thread đang unread
//    hoặc nội dung thật sự mới so với DB (không bump lại thread vừa đọc).
rep('bump gate',
[
"                } else if (changed.row_fresh || changed.unread_flipped) {",
"                  // Tin lặp nội dung cũ (\"ok\", \"dạ\") không được tạo bong bóng",
"                  // provisional, nhưng khi row còn \"Bây giờ\" hoặc vừa flip",
"                  // unread thì thread vẫn phải nhảy + badge ngay - không thì",
"                  // tin khách bị nuốt cho tới khi history sync về (reproduce",
"                  // 2026-10-02: khách nhắn \"ok\" lần 2, CRM im lặng 1p47s).",
"                  const bumpedAtIso = new Date().toISOString();",
"                  db.prepare('UPDATE threads SET last_activity = CURRENT_TIMESTAMP, is_unread = 1, unread_manual = 1 WHERE id = ?').run(String(canonicalThreadId));",
"                  io.emit('THREAD_UNREAD_CHANGED', { thread_id: String(canonicalThreadId), is_unread: 1, last_activity: bumpedAtIso });",
"                  syncDebug('PREVIEW_BUMP_REPEAT', { thread: String(canonicalThreadId).substring(0, 24), content: sanitizeLog(previewContent, 40), status: sync_status || null });",
"                }"
],
[
"                } else if (changed.row_fresh_new || changed.unread_flipped) {",
"                  // Tin lặp nội dung cũ (\"ok\", \"dạ\") không được tạo bong bóng",
"                  // provisional, nhưng khi tin THẬT vừa đến thì thread vẫn",
"                  // phải nhảy + badge ngay (reproduce 2026-10-02: khách nhắn",
"                  // \"ok\" lần 2, CRM im lặng 1p47s).",
"                  // Chỉ bump khi thread còn unread trong DB hoặc preview khác",
"                  // last_message đã lưu - row \"Bây giờ\" + chấm unread của tab",
"                  // ẩn LAG sau khi operator đọc, bump theo nó thì badge hiện",
"                  // đi hiện lại vô hạn (báo lỗi 2026-10-02).",
"                  const readState = db.prepare('SELECT is_unread, last_message FROM threads WHERE id = ?').get(String(canonicalThreadId));",
"                  const isUnreadNow = Number(readState?.is_unread) === 1;",
"                  const lastMsgMatches = cleanMessageText(readState?.last_message) === previewContent;",
"                  if (isUnreadNow || !lastMsgMatches) {",
"                    const bumpedAtIso = new Date().toISOString();",
"                    db.prepare('UPDATE threads SET last_activity = CURRENT_TIMESTAMP, is_unread = 1, unread_manual = 1 WHERE id = ?').run(String(canonicalThreadId));",
"                    io.emit('THREAD_UNREAD_CHANGED', { thread_id: String(canonicalThreadId), is_unread: 1, last_activity: bumpedAtIso });",
"                    syncDebug('PREVIEW_BUMP_REPEAT', { thread: String(canonicalThreadId).substring(0, 24), content: sanitizeLog(previewContent, 40), status: sync_status || null });",
"                  }",
"                }"
]
);

if (fails.length) { console.error('FAILED:\n' + fails.join('\n')); process.exit(1); }
fs.writeFileSync(p, src, 'utf8');
const after = fs.readFileSync(p, 'utf8');
for (const probe of ['rowTimePrevSeen', 'row_fresh_new: rowFreshNew', 'isUnreadNow || !lastMsgMatches', 'changed.row_fresh_new || changed.unread_flipped']) {
  if (!after.includes(probe)) { console.error('VERIFY FAIL missing: ' + probe); process.exit(1); }
}
console.log('OK server.js hotfixed, CRLF: ' + after.includes('\r\n'));
