const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { getTestDatabase } = require('../helpers/testDatabase');
const ConversationRepository = require('../../src/server/repositories/ConversationRepository');

function withDatabase(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autochatbot-test-'));
  const filename = path.join(dir, 'database.db');
  const db = getTestDatabase(filename);
  try { return run(db); } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}

test('local-first reload retains conversations and deduplicates history', () => withDatabase((db) => {
  db.prepare('INSERT INTO accounts (id, name, profile_dir) VALUES (?, ?, ?)').run('acct-1', 'Test', '/tmp/test');
  ConversationRepository.upsertThread({ id: 'thread-1', account_id: 'acct-1', contact_name: 'Alice' }, db);
  const messages = [
    { fb_message_id: 'fb-1', sender_id: 'alice', content: 'Xin chào', timestamp_ms: 1000 },
    { fb_message_id: 'fb-2', sender_id: 'acct-1', content: 'Chào bạn', timestamp_ms: 2000, is_outgoing: true }
  ];
  ConversationRepository.saveMessagesTransaction('thread-1', messages, db);
  ConversationRepository.saveMessagesTransaction('thread-1', messages, db);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM threads').get().count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM messages').get().count, 2);
  assert.deepEqual(ConversationRepository.getMessages('thread-1', 50, 0, db).map(m => m.fb_message_id), ['fb-1', 'fb-2']);
}));

test('offline-read retains persisted rows after database reopen', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autochatbot-test-'));
  const filename = path.join(dir, 'database.db');
  let db = getTestDatabase(filename);
  db.prepare('INSERT INTO accounts (id, name, profile_dir) VALUES (?, ?, ?)').run('acct-1', 'Test', '/tmp/test');
  ConversationRepository.upsertThread({ id: 'thread-1', account_id: 'acct-1', contact_name: 'Alice' }, db);
  ConversationRepository.saveMessagesTransaction('thread-1', [{ content: 'Lưu cục bộ', sender_id: 'alice', timestamp_ms: 1000 }], db);
  db.close();
  db = getTestDatabase(filename);
  assert.equal(db.prepare('SELECT contact_name FROM threads WHERE id = ?').get('thread-1').contact_name, 'Alice');
  assert.equal(db.prepare('SELECT content FROM messages WHERE thread_id = ?').get('thread-1').content, 'Lưu cục bộ');
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

// Multi-account: hai acc cùng đăng nhập quan sát CÙNG một tin vật lý (cùng
// mid) trong 2 hội thoại khác nhau. UNIQUE(fb_message_id) toàn cục từng nuốt
// quan sát của thread sau -> hội thoại bên acc kia mất tin (reproduce
// 2026-10-08 18:09 "alo"×3 giữa 2 acc, 2/3 mid chỉ còn ở thread acc khách).
test('cross-thread mid collision stores a per-thread mirror instead of dropping', () => withDatabase((db) => {
  db.prepare('INSERT INTO accounts (id, name, profile_dir) VALUES (?, ?, ?)').run('acct-1', 'A', '/tmp/a');
  db.prepare('INSERT INTO accounts (id, name, profile_dir) VALUES (?, ?, ?)').run('acct-2', 'B', '/tmp/b');
  ConversationRepository.upsertThread({ id: 'thread-1', account_id: 'acct-1', contact_name: 'Other side' }, db);
  ConversationRepository.upsertThread({ id: 'thread-2', account_id: 'acct-2', contact_name: 'Other side' }, db);
  ConversationRepository.saveMessagesTransaction('thread-1', [
    { fb_message_id: 'mid.SAME', sender_id: 'acct-1', content: 'alo', timestamp_ms: 1000, is_outgoing: true }
  ], db);
  ConversationRepository.saveMessagesTransaction('thread-2', [
    { fb_message_id: 'mid.SAME', sender_id: 'acct-1', content: 'alo', timestamp_ms: 1000, is_outgoing: false }
  ], db);
  const ids = db.prepare('SELECT thread_id, fb_message_id, is_outgoing FROM messages ORDER BY thread_id').all();
  assert.deepEqual(ids, [
    { thread_id: 'thread-1', fb_message_id: 'mid.SAME', is_outgoing: 1 },
    { thread_id: 'thread-2', fb_message_id: 'mid.SAME::thread-2', is_outgoing: 0 }
  ]);
  ConversationRepository.saveMessagesTransaction('thread-2', [
    { fb_message_id: 'mid.SAME', sender_id: 'acct-1', content: 'alo', timestamp_ms: 1000, is_outgoing: false }
  ], db);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM messages').get().count, 2);
}));

// Phantom __bubble_N tái dùng anchor CŨ: tin outgoing pending được tổng hợp
// id mid.X__bubble_1 với mid.X là tin cũ cách xa (quét lại gắn nhầm article
// cũ). Bản thật sẽ tự vào bằng mid riêng vài giây sau -> bỏ bản tổng hợp,
// nếu không thành row ma trùng lặp mà heal 2c không với tới (ts lệch quá
// cửa sổ 2s, reproduce 2026-10-08 18:33: alo tái dùng mid 10/06).
test('outgoing bubble-family id anchored to an old same-text message is skipped', () => withDatabase((db) => {
  db.prepare('INSERT INTO accounts (id, name, profile_dir) VALUES (?, ?, ?)').run('acct-1', 'A', '/tmp/a');
  ConversationRepository.upsertThread({ id: 'thread-1', account_id: 'acct-1', contact_name: 'Alice' }, db);
  const twoDaysAgo = Date.now() - 48 * 3600 * 1000;
  ConversationRepository.saveMessagesTransaction('thread-1', [
    { fb_message_id: 'peer@msgr.111', sender_id: 'acct-1', content: 'alo', timestamp_ms: twoDaysAgo, is_outgoing: true }
  ], db);
  ConversationRepository.saveMessagesTransaction('thread-1', [
    { fb_message_id: 'peer@msgr.111__bubble_1', sender_id: 'acct-1', content: 'alo', timestamp_ms: Date.now(), is_outgoing: true }
  ], db);
  const rows = db.prepare('SELECT fb_message_id FROM messages ORDER BY id').all();
  assert.deepEqual(rows, [{ fb_message_id: 'peer@msgr.111' }]);
}));

// Pending thật nằm CÙNG article anchor (anchor mới hơn 60s) hoặc like-group
// thật vẫn phải đi qua - guard chỉ bỏ anchor cũ.
test('recent same-article bubble-family observation is kept', () => withDatabase((db) => {
  db.prepare('INSERT INTO accounts (id, name, profile_dir) VALUES (?, ?, ?)').run('acct-1', 'A', '/tmp/a');
  ConversationRepository.upsertThread({ id: 'thread-1', account_id: 'acct-1', contact_name: 'Alice' }, db);
  const now = Date.now();
  ConversationRepository.saveMessagesTransaction('thread-1', [
    { fb_message_id: 'peer@msgr.222', sender_id: 'acct-1', content: 'alo', timestamp_ms: now - 5000, is_outgoing: true }
  ], db);
  ConversationRepository.saveMessagesTransaction('thread-1', [
    { fb_message_id: 'peer@msgr.222__bubble_1', sender_id: 'acct-1', content: 'alo', timestamp_ms: now, is_outgoing: true }
  ], db);
  const rows = db.prepare('SELECT fb_message_id FROM messages ORDER BY id').all();
  assert.deepEqual(rows, [{ fb_message_id: 'peer@msgr.222' }, { fb_message_id: 'peer@msgr.222__bubble_1' }]);
}));

// mid.$X__bubble_N là id FB-native: FB gắn suffix khi render LẠI đúng tin
// mid.$X. Row gốc đã tồn tại thì observation không được thành row thứ hai;
// text thật từ bản render sau hợp nhất vào row gốc (reproduce 2026-10-05→07:
// 16 tin nhóm bị tách đôi - row gốc dán nhầm tên người gửi, text thật nằm
// dưới id __bubble_N). Khác hẳn id anchor peer@msgr.N__bubble_N ở test trên.
test('fb-native mid.$ bubble re-render merges into its existing base row', () => withDatabase((db) => {
  db.prepare('INSERT INTO accounts (id, name, profile_dir) VALUES (?, ?, ?)').run('acct-1', 'A', '/tmp/a');
  ConversationRepository.upsertThread({ id: 'thread-1', account_id: 'acct-1', contact_name: 'Alice' }, db);
  const ts = 1791250860000;
  ConversationRepository.saveMessagesTransaction('thread-1', [
    { fb_message_id: 'mid.$gAATFVsrbFr6nO46iHGhCkm20x_0V', sender_id: 'CONTACT', content: 'Mạnh Thiện', timestamp_ms: ts, is_outgoing: false, timestamp_source: 'facebook_label', source: 'facebook_label' }
  ], db);
  ConversationRepository.saveMessagesTransaction('thread-1', [
    { fb_message_id: 'mid.$gAATFVsrbFr6nO46iHGhCkm20x_0V__bubble_1', sender_id: 'CONTACT', content: 'ok e', timestamp_ms: ts, is_outgoing: false, timestamp_source: 'facebook_label', source: 'facebook_label' },
    { fb_message_id: 'mid.$gAATFVsrbFr6nO46iHGhCkm20x_0V__bubble_2', sender_id: 'CONTACT', content: 'ok e', timestamp_ms: ts, is_outgoing: false, timestamp_source: 'facebook_label', source: 'facebook_label' }
  ], db);
  const rows = db.prepare('SELECT fb_message_id, content FROM messages ORDER BY id').all();
  // merge v1.0.22-26 (upstream v1.0.23 multi-bubble preserve): base giữ nội
  // dung thật của nó; lá cùng article nhưng KHÁC text được giữ thành row riêng
  // thay vì ghi đè mất một trong hai bubble.
  assert.deepEqual(rows, [
    { fb_message_id: 'mid.$gAATFVsrbFr6nO46iHGhCkm20x_0V', content: 'Mạnh Thiện' },
    { fb_message_id: 'mid.$gAATFVsrbFr6nO46iHGhCkm20x_0V__bubble_1', content: 'ok e' }
  ]);
}));
