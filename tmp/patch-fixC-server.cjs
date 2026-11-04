// Fix C: bat tin lặp nội dung cũ + bump không phụ thuộc bong bóng provisional.
const fs = require('fs');
const p = 'C:/Users/Admin/Downloads/Duan/CRM_FB1/src/server/server.js';
let src = fs.readFileSync(p, 'utf8');
let fails = [];

function rep(name, oldLines, newLines, expect) {
  const OLD = oldLines.join('\r\n');
  const NEW = newLines.join('\r\n');
  const count = src.split(OLD).length - 1;
  if (count !== (expect || 1)) { fails.push(`${name}: expected ${expect || 1} match(es), found ${count}`); return; }
  src = src.replace(OLD, NEW);
  console.log(`OK ${name}`);
}

// 1) Hoist rowFresh + unreadFlippedToIncoming trên text push, gắn 2 flag vào push.
rep('hoist+tag text push',
[
"                const boundPageSource = ConversationRepository.getThreadSource(canonicalThreadId);",
"                if (incomingPreviewChanged) {",
"                  changedUnreadThreads.push({",
"                    account_id,",
"                    thread_id: canonicalThreadId,",
"                    external_thread_id: t.external_thread_id || threadId,",
"                    thread_url: t.thread_url || previousThread?.thread_url || null,",
"                          contact_name: name || previousThread?.contact_name || null,",
"                    page_id: threadPageId || (boundPageSource?.pageId ?? null),",
"                    preview_content: cleanLastMsg,",
"                    preview_is_like: t.is_like === true",
"                  });",
"                }"
],
[
"                const boundPageSource = ConversationRepository.getThreadSource(canonicalThreadId);",
"                // Bằng chứng tin VỪA đến dùng chung cho nhánh text và media:",
"                // flip unread (0->1/thread mới) hoặc dòng giờ trên row còn",
"                // \"Bây giờ\". Gắn vào push để nhánh bubble biết phải bump",
"                // thread cả khi bong bóng provisional bị chặn.",
"                const rowFresh = isFreshRowTimeText(t.row_time_text);",
"                const unreadFlippedToIncoming = previousThread",
"                  ? Number(previousThread.is_unread) !== 1",
"                  : true;",
"                if (incomingPreviewChanged) {",
"                  changedUnreadThreads.push({",
"                    account_id,",
"                    thread_id: canonicalThreadId,",
"                    external_thread_id: t.external_thread_id || threadId,",
"                    thread_url: t.thread_url || previousThread?.thread_url || null,",
"                          contact_name: name || previousThread?.contact_name || null,",
"                    page_id: threadPageId || (boundPageSource?.pageId ?? null),",
"                    preview_content: cleanLastMsg,",
"                    preview_is_like: t.is_like === true,",
"                    row_fresh: rowFresh,",
"                    unread_flipped: unreadFlippedToIncoming",
"                  });",
"                }"
]);

// 2) Bỏ khai báo cũ của unreadFlippedToIncoming (đã hoist lên trên).
rep('remove old unreadFlipped decl',
[
"                const unreadFlippedToIncoming = previousThread",
"                  ? Number(previousThread.is_unread) !== 1",
"                  : true;",
"                // Thread đã unread sẵn thì không còn flip để bắt - dòng thời"
],
[
"                // Thread đã unread sẵn thì không còn flip để bắt - dòng thời"
]);

// 3) Media branch: dùng biến đã hoist + gắn 2 flag vào push.
rep('media branch condition',
[
"                  && (unreadFlippedToIncoming || isFreshRowTimeText(t.row_time_text))"
],
[
"                  && (unreadFlippedToIncoming || rowFresh)"
]);

rep('media push tags',
[
"                      preview_content: '',",
"                      preview_is_like: t.is_like === true,",
"                      media_only_hint: true,",
"                      row_time_text: t.row_time_text || null"
],
[
"                      preview_content: '',",
"                      preview_is_like: t.is_like === true,",
"                      media_only_hint: true,",
"                      row_time_text: t.row_time_text || null,",
"                      row_fresh: rowFresh,",
"                      unread_flipped: unreadFlippedToIncoming"
]);

// 4) Nhánh bubble bị chặn (tin lặp nội dung cũ) vẫn phải bump thread.
rep('suppressed-bubble bump',
[
"                }\r\n",
"\r\n",
"                if (!previewContent && changed.media_only_hint) {"
].join('').split('\r\n'),
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
"                }",
"",
"                if (!previewContent && changed.media_only_hint) {"
]
);

if (fails.length) { console.error('FAILED:\n' + fails.join('\n')); process.exit(1); }
fs.writeFileSync(p, src, 'utf8');
const after = fs.readFileSync(p, 'utf8');
for (const probe of ['row_fresh: rowFresh', 'PREVIEW_BUMP_REPEAT', 'unreadFlippedToIncoming || rowFresh', 'else if (changed.row_fresh || changed.unread_flipped)']) {
  if (!after.includes(probe)) { console.error('VERIFY FAIL missing: ' + probe); process.exit(1); }
}
if (after.split('const unreadFlippedToIncoming').length - 1 !== 1) {
  console.error('VERIFY FAIL: unreadFlippedToIncoming declared ' + (after.split('const unreadFlippedToIncoming').length - 1) + ' times');
  process.exit(1);
}
console.log('OK server.js patched, all probes present, CRLF preserved: ' + after.includes('\r\n'));
