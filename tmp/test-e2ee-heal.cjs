// Test heal khởi động: notice E2EE + bubble dom_ nhân đôi + separator "9w"
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const db = new Database(':memory:');
db.exec(fs.readFileSync(path.join(__dirname, '../src/server/database/schema.sql'), 'utf8'));
db.prepare("INSERT INTO accounts (id, name, profile_dir, status) VALUES ('acc1', 'Tester', 'profile_acc1', 'ACTIVE')").run();
// t1: notice E2EE (chỉ có notice) | t2: dup dom_ + mid thật | t3: separator "9w"
db.prepare("INSERT INTO threads (id, account_id, is_unread, unread_manual, last_message) VALUES ('t1', 'acc1', 1, 1, 'Messages and calls are secured with end-to-end encryption.')").run();
db.prepare("INSERT INTO threads (id, account_id, is_unread, unread_manual, last_message) VALUES ('t2', 'acc1', 1, 1, 'Khi nào bạn muốn ăn')").run();
db.prepare("INSERT INTO threads (id, account_id, is_unread, unread_manual, last_message) VALUES ('t3', 'acc1', 1, 1, '9w')").run();
db.prepare("INSERT INTO messages (thread_id, fb_message_id, sender_id, content, is_outgoing, timestamp_ms) VALUES ('t1', 'dom_notice_1', 'C', 'Messages and calls are secured with end-to-end encryption.', 0, 1759801000000)").run();
db.prepare("INSERT INTO messages (thread_id, fb_message_id, sender_id, content, is_outgoing, timestamp_ms) VALUES ('t2', 'mid_real_1', 'C', 'Khi nào bạn muốn ăn', 0, 1759700000000)").run();
db.prepare("INSERT INTO messages (thread_id, fb_message_id, sender_id, content, is_outgoing, timestamp_ms) VALUES ('t2', 'dom_dup_1', 'C', 'Khi nào bạn muốn ăn', 0, 1759802000000)").run();
db.prepare("INSERT INTO messages (thread_id, fb_message_id, sender_id, content, is_outgoing, timestamp_ms) VALUES ('t3', 'dom_sep_1', 'C', '9w', 0, 1759803000000)").run();

// ===== Mirror logic trong server.js (startup hygiene) =====
const E2EE_NOTICE_PATTERNS = [
  /^messages and calls are secured with end-to-end encryption\.?$/i,
  /^messages and calls are end-to-end encrypted\.?$/i,
  /^personal chats are secured with end-to-end encryption\.?$/i,
  /^tin nhắn và cuộc gọi (?:đang )?được bảo mật.*$/i,
  /^bảo mật (?:bằng tính năng mã hóa|đầu cuối).*$/i,
];
const COMPACT_RELATIVE_RE = /^\d{1,2}\s?(?:s|sec|m|min|h|hr|d|w|mo|y)$/i;
const healTouchedThreads = (threadIdSet) => {
  for (const tid of threadIdSet) {
    const hasRealIncoming = db.prepare(`
      SELECT 1 FROM messages WHERE thread_id = ? AND is_outgoing = 0
        AND fb_message_id NOT LIKE 'dom_%' AND fb_message_id NOT LIKE 'sidebar_preview_%' LIMIT 1
    `).get(tid);
    if (!hasRealIncoming) {
      db.prepare('UPDATE threads SET is_unread = 0, unread_manual = 0 WHERE id = ?').run(tid);
    }
    const remaining = db.prepare(`
      SELECT content, COALESCE(timestamp_ms, 0) AS ts FROM messages
      WHERE thread_id = ? AND fb_message_id NOT LIKE 'dom_%' AND fb_message_id NOT LIKE 'sidebar_preview_%'
      ORDER BY COALESCE(timestamp_ms, 0) DESC, id DESC LIMIT 1
    `).get(tid);
    if (remaining) {
      db.prepare('UPDATE threads SET last_message = ?, last_activity = ? WHERE id = ?')
        .run(remaining.content, new Date(remaining.ts).toISOString(), tid);
    } else {
      db.prepare('UPDATE threads SET last_message = NULL WHERE id = ?').run(tid);
    }
  }
};

const noticeCandidates = db.prepare(`
  SELECT id, thread_id, content FROM messages
  WHERE is_outgoing = 0 AND (
    content LIKE 'Messages and calls are secured with end-to-end encryption%'
    OR content LIKE 'Messages and calls are end-to-end encrypted%'
    OR content LIKE 'Personal chats are secured with end-to-end encryption%'
    OR content LIKE 'Tin nhắn và cuộc gọi %bảo mật%'
    OR content LIKE 'bảo mật %')
`).all();
const deleteNotice = db.prepare('DELETE FROM messages WHERE id = ?');
const noticeThreadIds = new Set();
let deletedNoticeCount = 0;
for (const row of noticeCandidates) {
  if (!E2EE_NOTICE_PATTERNS.some((p) => p.test(String(row.content || '').trim()))) continue;
  deleteNotice.run(row.id);
  noticeThreadIds.add(row.thread_id);
  deletedNoticeCount++;
}
healTouchedThreads(noticeThreadIds);

const dupDomRows = db.prepare(`
  SELECT m.id, m.thread_id FROM messages m
  WHERE m.is_outgoing = 0 AND m.fb_message_id LIKE 'dom_%'
    AND (m.media_type IS NULL OR m.media_type = 'text')
    AND EXISTS (
      SELECT 1 FROM messages twin
      WHERE twin.thread_id = m.thread_id AND twin.is_outgoing = 0 AND twin.id != m.id
        AND COALESCE(twin.content, '') = COALESCE(m.content, '')
        AND twin.fb_message_id NOT LIKE 'dom_%' AND twin.fb_message_id NOT LIKE 'sidebar_preview_%')
`).all();
const deleteDupRow = db.prepare('DELETE FROM messages WHERE id = ?');
const dupThreadIds = new Set();
for (const row of dupDomRows) { deleteDupRow.run(row.id); dupThreadIds.add(row.thread_id); }
healTouchedThreads(dupThreadIds);

const sepCandidates = db.prepare(`
  SELECT id, thread_id, content FROM messages
  WHERE is_outgoing = 0 AND fb_message_id LIKE 'dom_%'
    AND (media_type IS NULL OR media_type = 'text') AND LENGTH(COALESCE(content, '')) <= 6
`).all();
const deleteSepRow = db.prepare('DELETE FROM messages WHERE id = ?');
const sepThreadIds = new Set();
for (const row of sepCandidates) {
  if (!COMPACT_RELATIVE_RE.test(String(row.content || '').trim())) continue;
  deleteSepRow.run(row.id);
  sepThreadIds.add(row.thread_id);
}
healTouchedThreads(sepThreadIds);
// ===== End mirror =====

let failed = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} (got: ${JSON.stringify(actual)}, want: ${JSON.stringify(expected)})`);
}
check('notice bị xóa', deletedNoticeCount, 1);
const t1 = db.prepare('SELECT * FROM threads WHERE id = ?').get('t1');
check('t1 unread gỡ', t1.is_unread, 0);
check('t1 preview NULL', t1.last_message, null);
check('dom_dup_1 bị xóa', db.prepare("SELECT COUNT(*) c FROM messages WHERE fb_message_id = 'dom_dup_1'").get().c, 0);
check('mid_real_1 giữ lại', db.prepare("SELECT COUNT(*) c FROM messages WHERE fb_message_id = 'mid_real_1'").get().c, 1);
const t2 = db.prepare('SELECT * FROM threads WHERE id = ?').get('t2');
check('t2 giữ unread (còn tin khách thật)', t2.is_unread, 1);
check('t2 preview từ mid thật', t2.last_message, 'Khi nào bạn muốn ăn');
check('dom_sep_1 bị xóa', db.prepare("SELECT COUNT(*) c FROM messages WHERE fb_message_id = 'dom_sep_1'").get().c, 0);
const t3 = db.prepare('SELECT * FROM threads WHERE id = ?').get('t3');
check('t3 unread gỡ', t3.is_unread, 0);
check('t3 preview NULL', t3.last_message, null);
check('tổng messages còn lại', db.prepare('SELECT COUNT(*) c FROM messages').get().c, 1);
console.log(failed === 0 ? '=> ALL PASS' : `=> ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
