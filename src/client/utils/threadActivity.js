const SQLITE_UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/;

// SQLite CURRENT_TIMESTAMP is UTC even though it is stored without a timezone.
// Browsers otherwise interpret this shape as local time, which moves a freshly
// active thread backwards and breaks sidebar ordering.
export function normalizeThreadTimestamp(value) {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return SQLITE_UTC_TIMESTAMP.test(trimmed)
    ? `${trimmed.replace(' ', 'T')}Z`
    : trimmed;
}

export function threadActivityTime(thread) {
  // Server gắn last_msg_ts = timestamp của tin nhắn THẬT mới nhất. last_activity
  // bị sync/seen/mở hội thoại bump mà không có tin mới nên không đáng tin để xếp.
  const messageTs = Number(thread?.last_msg_ts);
  if (Number.isFinite(messageTs) && messageTs > 0) return messageTs;
  const value = thread?.last_activity || thread?.updated_at || thread?.created_at || 0;
  const numeric = Number(value);
  if (typeof value !== 'string' && Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(normalizeThreadTimestamp(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

// Hội thoại được ghim luôn đứng trên cùng.
function isThreadPinned(thread) {
  return Number(thread?.pinned) === 1;
}

// Thời điểm ghim — nhóm ghim xếp theo nó (mới ghim lên đầu) thay vì theo tin
// nhắn, nên hội thoại ghim KHÔNG trôi xuống khi activity thay đổi; chỉ tụt
// xuống nhóm thường khi bỏ ghim. Thiếu pinned_at (thread cũ) => 0, xuống cuối
// nhóm ghim khớp với server ('9999' DESC).
function threadPinnedTime(thread) {
  const parsed = Date.parse(normalizeThreadTimestamp(thread?.pinned_at));
  return Number.isFinite(parsed) ? parsed : 0;
}

// Hội thoại CHƯA ĐỌC (khách nhắn chưa xem) đẩy lên nhóm đầu - trên mọi hội
// thoại đã đọc; riêng nhóm chưa đọc xếp theo hoạt động gần nhất
// (reproduce 2026-10-07: khách nhắn vào hội thoại cũ bị chìm dưới đống
// hội thoại đang hoạt động vì chỉ sort theo last_activity).
function isThreadUnread(thread) {
  return Number(thread?.is_unread) === 1;
}

// Thứ tự: ghim -> chưa đọc -> hoạt động gần nhất. Mở hội thoại (seen) gỡ
// cờ chưa đọc thì nó tự tụt về nhóm đã đọc, vị trí theo tin nhắn gần nhất.
export function sortThreadsByActivity(threads = []) {
  return threads
    .map((thread, index) => ({ thread, index }))
    .sort((left, right) => {
      const leftPinned = isThreadPinned(left.thread);
      const rightPinned = isThreadPinned(right.thread);
      if (leftPinned !== rightPinned) return leftPinned ? -1 : 1;
      if (leftPinned && rightPinned) {
        const pinnedDelta = threadPinnedTime(right.thread) - threadPinnedTime(left.thread);
        if (pinnedDelta !== 0) return pinnedDelta;
        return left.index - right.index;
      }
      const unreadDelta = (isThreadUnread(right.thread) ? 1 : 0) - (isThreadUnread(left.thread) ? 1 : 0);
      if (unreadDelta !== 0) return unreadDelta;
      const delta = threadActivityTime(right.thread) - threadActivityTime(left.thread);
      return delta || left.index - right.index;
    })
    .map(({ thread }) => thread);
}
