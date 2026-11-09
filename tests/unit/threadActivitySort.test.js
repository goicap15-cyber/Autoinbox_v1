const test = require('node:test');
const assert = require('node:assert/strict');

const now = Date.now();
const minutesAgo = (m) => now - m * 60 * 1000;
const bumpIso = new Date(minutesAgo(1)).toISOString();

test('hội thoại chưa có tin nào bị sập xuống dưới hội thoại có tin cũ nhất', async () => {
  const { sortThreadsByActivity } = await import('../../src/client/utils/threadActivity.js');
  const hasOldMsg = { id: 'has-msg', last_msg_ts: minutesAgo(7 * 24 * 60) };
  const emptyBumped = { id: 'empty-bumped', last_msg_ts: null, last_activity: bumpIso };
  assert.deepEqual(sortThreadsByActivity([emptyBumped, hasOldMsg]).map((t) => t.id), ['has-msg', 'empty-bumped']);
});

test('cờ chưa đọc chỉ có tác dụng trong nhóm có tin, không nhổ hội thoại rỗng lên', async () => {
  const { sortThreadsByActivity } = await import('../../src/client/utils/threadActivity.js');
  const unreadWithMsg = { id: 'unread-msg', last_msg_ts: minutesAgo(1), is_unread: 1 };
  const readWithMsg = { id: 'read-msg', last_msg_ts: minutesAgo(60) };
  const emptyUnreadBumped = { id: 'empty-unread', last_msg_ts: null, last_activity: bumpIso, is_unread: 1 };
  assert.deepEqual(
    sortThreadsByActivity([emptyUnreadBumped, readWithMsg, unreadWithMsg]).map((t) => t.id),
    ['unread-msg', 'read-msg', 'empty-unread']
  );
});

test('hội thoại ghim 0 tin vẫn đứng trên cùng', async () => {
  const { sortThreadsByActivity } = await import('../../src/client/utils/threadActivity.js');
  const pinnedEmpty = { id: 'pinned-empty', last_msg_ts: null, last_activity: '2026-09-01 08:00:00', pinned: 1, pinned_at: '2026-09-01T08:00:00.000Z' };
  const hasMsg = { id: 'has-msg', last_msg_ts: minutesAgo(1) };
  assert.deepEqual(sortThreadsByActivity([hasMsg, pinnedEmpty]).map((t) => t.id), ['pinned-empty', 'has-msg']);
});

test('nhóm đáy 0 tin xếp theo mốc giảm dần (bump chỉ xáo trộn trong nhóm đáy)', async () => {
  const { sortThreadsByActivity } = await import('../../src/client/utils/threadActivity.js');
  const emptyOld = { id: 'empty-old', last_msg_ts: null, last_activity: '2026-09-01 08:00:00' };
  const emptyBumped = { id: 'empty-bumped', last_msg_ts: null, last_activity: bumpIso };
  assert.deepEqual(sortThreadsByActivity([emptyOld, emptyBumped]).map((t) => t.id), ['empty-bumped', 'empty-old']);
});
