const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const ConversationRepository = require('../../src/server/repositories/ConversationRepository');

const CALL_TS = 1794125340000; // 2026-11-08, giờ thật của call row reproduce

function createDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE messages (id INTEGER PRIMARY KEY, thread_id TEXT, fb_message_id TEXT UNIQUE, client_message_id TEXT, sender_id TEXT, sender_name TEXT, content TEXT, media_type TEXT, media_url TEXT, timestamp_ms INTEGER, timestamp_source TEXT, is_outgoing INTEGER, sender_role TEXT, sequence_order REAL, direction_status TEXT, created_at TEXT, reply_to_text TEXT)`);
  return db;
}

function insertCallRow(db, mid, content, isOutgoing, ts = CALL_TS, threadId = 't1') {
  db.prepare(`INSERT INTO messages (thread_id, fb_message_id, content, media_type, timestamp_ms, timestamp_source, is_outgoing, sender_role, direction_status, created_at) VALUES (?, ?, ?, 'call', ?, 'facebook_payload', ?, ?, 'confirmed', '2026-11-08T08:09:00.000Z')`)
    .run(threadId, mid, content, ts, isOutgoing, isOutgoing ? 'operator' : 'customer');
}

test('F2: lá Call back cùng family call row bị skip và nâng content base', () => {
  const db = createDb();
  insertCallRow(db, '100034206860298@msgr.7523295122127726', '9 secs', 1);
  const result = ConversationRepository.saveMessagesTransaction('t1', [{
    fb_message_id: '100034206860298@msgr.7523295122127726__bubble_2', content: 'Call back', media_type: 'text',
    timestamp_ms: CALL_TS, timestamp_source: 'facebook_label', is_outgoing: false,
    direction_status: 'confirmed', created_at: '2026-11-08T08:09:00.000Z'
  }], db);
  assert.equal(result.skippedCount, 1);
  assert.equal(result.insertedIds.length, 0);
  const callRow = db.prepare("SELECT content FROM messages WHERE media_type = 'call'").get();
  assert.equal(callRow.content, 'Cuộc gọi');
  assert.equal(db.prepare('SELECT COUNT(*) count FROM messages').get().count, 1);
  db.close();
});

test('F2: lá Call back đến TRƯỚC call row cùng batch vẫn bị skip, call row vào chuẩn hóa', () => {
  const db = createDb();
  const result = ConversationRepository.saveMessagesTransaction('t1', [
    {
      fb_message_id: '100034206860298@msgr.7523295185889328__bubble_2', content: 'Call back', media_type: 'text',
      timestamp_ms: CALL_TS, timestamp_source: 'facebook_label', is_outgoing: false,
      direction_status: 'confirmed', created_at: '2026-11-08T08:09:00.000Z'
    },
    {
      fb_message_id: '100034206860298@msgr.7523295185889328', content: 'Call back', media_type: 'call',
      timestamp_ms: CALL_TS, timestamp_source: 'facebook_payload', is_outgoing: false,
      direction_status: 'confirmed', created_at: '2026-11-08T08:09:00.000Z'
    }
  ], db);
  const rows = db.prepare('SELECT fb_message_id, content, media_type FROM messages').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].media_type, 'call');
  assert.equal(rows[0].content, 'Cuộc gọi nhỡ');
  assert.equal(result.skippedCount, 1);
  db.close();
});

test('F2: Call back trần KHÔNG có call row lân cận thì sống (tin khách thật)', () => {
  const db = createDb();
  const result = ConversationRepository.saveMessagesTransaction('t1', [{
    fb_message_id: '100034206860298@msgr.7513136572313319', content: 'Call back', media_type: 'text',
    timestamp_ms: 1791271320000, timestamp_source: 'facebook_label', is_outgoing: false,
    direction_status: 'confirmed', created_at: '2026-10-06T07:22:00.000Z'
  }], db);
  assert.equal(result.insertedIds.length, 1);
  assert.equal(db.prepare("SELECT content FROM messages WHERE media_type = 'text'").get().content, 'Call back');
  db.close();
});

test('F2: Call back trần cạnh call row ±10 phút thì bị skip', () => {
  const db = createDb();
  insertCallRow(db, '100034206860298@msgr.111', 'Cuộc gọi nhỡ', 0);
  const result = ConversationRepository.saveMessagesTransaction('t1', [{
    fb_message_id: '100034206860298@msgr.7513136572313319', content: 'Call back', media_type: 'text',
    timestamp_ms: CALL_TS + 300000, timestamp_source: 'facebook_label', is_outgoing: false,
    direction_status: 'confirmed', created_at: '2026-11-08T08:14:00.000Z'
  }], db);
  assert.equal(result.skippedCount, 1);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM messages WHERE media_type = 'text'").get().count, 0);
  db.close();
});

test('F2: "Gọi lại" trần cạnh call row (không cùng family) vẫn sống', () => {
  const db = createDb();
  insertCallRow(db, '100034206860298@msgr.111', 'Cuộc gọi nhỡ', 0);
  const result = ConversationRepository.saveMessagesTransaction('t1', [{
    fb_message_id: '100034206860298@msgr.7513136709369199', content: 'Gọi lại', media_type: 'text',
    timestamp_ms: CALL_TS + 300000, timestamp_source: 'facebook_label', is_outgoing: false,
    direction_status: 'confirmed', created_at: '2026-11-08T08:14:00.000Z'
  }], db);
  assert.equal(result.insertedIds.length, 1);
  db.close();
});

test('F2: "Call back nhé" của khách không bao giờ bị nuốt', () => {
  const db = createDb();
  insertCallRow(db, '100034206860298@msgr.111', 'Cuộc gọi nhỡ', 0);
  const result = ConversationRepository.saveMessagesTransaction('t1', [{
    fb_message_id: '100034206860298@msgr.222', content: 'call back nhé', media_type: 'text',
    timestamp_ms: CALL_TS + 60000, timestamp_source: 'facebook_label', is_outgoing: false,
    direction_status: 'confirmed', created_at: '2026-11-08T08:10:00.000Z'
  }], db);
  assert.equal(result.insertedIds.length, 1);
  db.close();
});

test('F2: call row content rác được chuẩn hóa ngay lúc insert', () => {
  const db = createDb();
  ConversationRepository.saveMessagesTransaction('t1', [{
    fb_message_id: '100034206860298@msgr.7523295185889328', content: 'Call back', media_type: 'call',
    timestamp_ms: CALL_TS, timestamp_source: 'facebook_payload', is_outgoing: false,
    direction_status: 'confirmed', created_at: '2026-11-08T08:09:00.000Z'
  }], db);
  const row = db.prepare("SELECT content, is_outgoing FROM messages WHERE media_type = 'call'").get();
  assert.equal(row.content, 'Cuộc gọi nhỡ');
  db.close();
});

test('F1: lá "Sent 1m ago" bị chặn tại cổng batch (không tạo row)', () => {
  const db = createDb();
  const result = ConversationRepository.saveMessagesTransaction('t1', [{
    fb_message_id: '7525466687521454508__bubble_1', content: 'Sent 1m ago', media_type: 'text',
    timestamp_ms: 1794519420000, timestamp_source: 'facebook_label', is_outgoing: true,
    direction_status: 'confirmed', created_at: '2026-11-09T14:57:00.000Z'
  }], db);
  assert.equal(result.skippedCount, 1);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM messages').get().count, 0);
  db.close();
});

test('F1: lá "Tue 3:08 PM" bị chặn tại cổng batch (không tạo row)', () => {
  const db = createDb();
  const result = ConversationRepository.saveMessagesTransaction('t1', [{
    fb_message_id: 'dom_test_hash_abc_1', content: 'Tue 3:08 PM', media_type: 'text',
    timestamp_ms: 1794125340000, timestamp_source: 'facebook_label', is_outgoing: false,
    direction_status: 'confirmed', created_at: '2026-11-08T08:09:00.000Z'
  }], db);
  assert.equal(result.skippedCount, 1);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM messages').get().count, 0);
  db.close();
});
