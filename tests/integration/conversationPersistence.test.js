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
