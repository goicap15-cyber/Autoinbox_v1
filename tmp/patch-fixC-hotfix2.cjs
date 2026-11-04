// Hotfix 45c: bypass same-preview chỉ tính ở nhịp CHUYỂN ĐỔI sang fresh,
// không tính mỗi nhịp quét (chống ngập 177 sidebar_incoming/9 phút).
const fs = require('fs');
let fails = [];

function patch(path, reps) {
  let src = fs.readFileSync(path, 'utf8');
  for (const [name, oldLines, newLines] of reps) {
    const OLD = oldLines.join('\r\n');
    const NEW = newLines.join('\r\n');
    const count = src.split(OLD).length - 1;
    if (count !== 1) { fails.push(`${name} (${path}): expected 1, found ${count}`); continue; }
    src = src.replace(OLD, NEW);
    console.log(`OK ${name}`);
  }
  fs.writeFileSync(path, src, 'utf8');
}

const SERVER = 'C:/Users/Admin/Downloads/Duan/CRM_FB1/src/server/server.js';
const DETECT = 'C:/Users/Admin/Downloads/Duan/CRM_FB1/src/server/utils/sidebarIncomingDetection.js';

const rowBlock = [
"                const rowFresh = isFreshRowTimeText(t.row_time_text);",
"                const rowTimeNow = String(t.row_time_text || '');",
"                const rowBumpKey = account_id + ':' + existingInternalThreadId;",
"                const rowTimePrev = rowTimePrevSeen.get(rowBumpKey) || '';",
"                rowTimePrevSeen.set(rowBumpKey, rowTimeNow);",
"                if (rowTimePrevSeen.size > 800) rowTimePrevSeen.clear();",
"                const rowFreshNew = rowFresh && !isFreshRowTimeText(rowTimePrev);"
].join('\r\n');

patch(SERVER, [
  // 1) Chuyển khối rowFresh/rowFreshNew lên TRƯỚC bộ dò (cần cho bypass).
  ['move row block before detection',
  [
"                const normalizedPreviousThread = previousThread"
  ],
  [
"                // Phải tính TRƯỚC isChangedIncomingSidebarPreview: bypass",
"                // same-preview chỉ được nổ ở nhịp CHUYỂN ĐỔI sang \"Bây giờ\"",
"                // (rowFreshNew), nếu dùng raw fresh thì MỖI nhịp quét 2s",
"                // trong ~60s row còn \"Bây giờ\" đều tính là tin mới -> ngập",
"                // hàng đợi sync 177 sidebar_incoming/9 phút -> app lag, bắt",
"                // chậm (reproduce 2026-10-02 14:27-14:36).",
"                const rowFresh = isFreshRowTimeText(t.row_time_text);",
"                const rowTimeNow = String(t.row_time_text || '');",
"                const rowBumpKey = account_id + ':' + existingInternalThreadId;",
"                const rowTimePrev = rowTimePrevSeen.get(rowBumpKey) || '';",
"                rowTimePrevSeen.set(rowBumpKey, rowTimeNow);",
"                if (rowTimePrevSeen.size > 800) rowTimePrevSeen.clear();",
"                const rowFreshNew = rowFresh && !isFreshRowTimeText(rowTimePrev);",
"                const normalizedPreviousThread = previousThread"
  ]],
  // 2) Bỏ khối cũ ở dưới (giữ unreadFlippedToIncoming).
  ['remove old row block',
  [
"                const boundPageSource = ConversationRepository.getThreadSource(canonicalThreadId);",
"                // Bằng chứng tin VỪA đến dùng chung cho nhánh text và media:",
"                // flip unread (0->1/thread mới) hoặc dòng giờ trên row còn",
"                // \"Bây giờ\". Gắn vào push để nhánh bubble biết phải bump",
"                // thread cả khi bong bóng provisional bị chặn.",
"                const rowFresh = isFreshRowTimeText(t.row_time_text);",
"                const rowTimeNow = String(t.row_time_text || '');",
"                const rowBumpKey = account_id + ':' + existingInternalThreadId;",
"                const rowTimePrev = rowTimePrevSeen.get(rowBumpKey) || '';",
"                rowTimePrevSeen.set(rowBumpKey, rowTimeNow);",
"                if (rowTimePrevSeen.size > 800) rowTimePrevSeen.clear();",
"                const rowFreshNew = rowFresh && !isFreshRowTimeText(rowTimePrev);",
"                const unreadFlippedToIncoming = previousThread"
  ],
  [
"                const boundPageSource = ConversationRepository.getThreadSource(canonicalThreadId);",
"                // rowFresh/rowFreshNew đã tính ở trên (trước bộ dò). Flip",
"                // unread 0->1/thread mới cũng là bằng chứng tin vừa đến;",
"                // cả hai gắn vào push để nhánh bubble biết phải bump thread",
"                // cả khi bong bóng provisional bị chặn.",
"                const unreadFlippedToIncoming = previousThread"
  ]],
  // 3) Truyền rowFreshNew vào bộ dò.
  ['pass rowFreshNew to detector',
  [
"                const incomingPreviewChanged = isChangedIncomingSidebarPreview({",
"                  previousThread: normalizedPreviousThread,",
"                  incomingThread: t,",
"                  cleanLastMessage: cleanLastMsg,",
"                  isActivitySummary,",
"                  hasRecentMatchingOutbound",
"                });"
  ],
  [
"                const incomingPreviewChanged = isChangedIncomingSidebarPreview({",
"                  previousThread: normalizedPreviousThread,",
"                  incomingThread: t,",
"                  cleanLastMessage: cleanLastMsg,",
"                  isActivitySummary,",
"                  hasRecentMatchingOutbound,",
"                  rowFreshNew",
"                });"
  ]]
]);

patch(DETECT, [
  ['detector signature',
  [
"function isChangedIncomingSidebarPreview({",
"  previousThread,",
"  incomingThread,",
"  cleanLastMessage,",
"  isActivitySummary,",
"  hasRecentMatchingOutbound = false",
"}) {"
  ],
  [
"function isChangedIncomingSidebarPreview({",
"  previousThread,",
"  incomingThread,",
"  cleanLastMessage,",
"  isActivitySummary,",
"  hasRecentMatchingOutbound = false,",
"  rowFreshNew = false",
"}) {"
  ]],
  ['bypass uses rowFreshNew',
  [
"  // Preview lặp lại đúng chuỗi cũ vẫn phải được bắt khi dòng giờ trên row",
"  // còn \"Bây giờ\" VÀ row đang dính chấm chưa đọc/Like - khách nhắn lại",
"  // đúng câu cũ (\"ok\", \"dạ\") không được bị coi là \"không đổi\"",
"  // (reproduce 2026-10-02: khách nhắn \"ok\" lần 2, CRM im lặng).",
"  // Tự echo của CRM (không có unread) vẫn bị chặn như cũ tại đây.",
"  const samePreview = String(previousThread.last_message || '').trim() === String(cleanLastMessage).trim();",
"  if (samePreview",
"    && !(isFreshRowTimeText(incomingThread?.row_time_text)",
"      && (Number(incomingThread?.is_unread) === 1 || incomingThread?.is_like === true))) return false;"
  ],
  [
"  // Preview lặp lại đúng chuỗi cũ vẫn phải được bắt khi row VỪA chuyển sang",
"  // \"Bây giờ\" VÀ đang dính chấm chưa đọc/Like - khách nhắn lại đúng câu cũ",
"  // (\"ok\", \"dạ\") không được bị coi là \"không đổi\". Phải dùng rowFreshNew",
"  // (nhịp chuyển đổi) chứ KHÔNG dùng raw fresh: raw fresh đúng ở MỌI nhịp",
"  // quét trong ~60s -> ngập job sync (reproduce 2026-10-02: 177",
"  // sidebar_incoming/9 phút, app lag). Tự echo của CRM (không unread)",
"  // vẫn bị chặn như cũ tại đây.",
"  const samePreview = String(previousThread.last_message || '').trim() === String(cleanLastMessage).trim();",
"  if (samePreview",
"    && !(rowFreshNew === true",
"      && (Number(incomingThread?.is_unread) === 1 || incomingThread?.is_like === true))) return false;"
  ]]
]);

if (fails.length) { console.error('FAILED:\n' + fails.join('\n')); process.exit(1); }
const s = fs.readFileSync(SERVER, 'utf8');
const d = fs.readFileSync(DETECT, 'utf8');
if (s.indexOf('const rowFreshNew') > s.indexOf('isChangedIncomingSidebarPreview({')) { console.error('VERIFY FAIL: rowFreshNew after detector call'); process.exit(1); }
if ((s.match(/const rowFreshNew/g) || []).length !== 1) { console.error('VERIFY FAIL: rowFreshNew declared != 1'); process.exit(1); }
if (!d.includes('rowFreshNew === true')) { console.error('VERIFY FAIL: bypass not updated'); process.exit(1); }
console.log('OK both files patched, CRLF: ' + s.includes('\r\n') + ' ' + d.includes('\r\n'));
