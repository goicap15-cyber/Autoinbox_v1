const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const ConversationRepository = require('../../src/server/repositories/ConversationRepository');

function createDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE messages (id INTEGER PRIMARY KEY, thread_id TEXT, fb_message_id TEXT UNIQUE, client_message_id TEXT, sender_id TEXT, sender_name TEXT, content TEXT, media_type TEXT, media_url TEXT, timestamp_ms INTEGER, timestamp_source TEXT, is_outgoing INTEGER, sender_role TEXT, sequence_order REAL, direction_status TEXT, created_at TEXT, reply_to_text TEXT)`);
  return db;
}

function insertPreview(db, id, content, threadId = 't1') {
  db.prepare(`INSERT INTO messages (thread_id, fb_message_id, content, media_type, timestamp_ms, timestamp_source, is_outgoing, sender_role, direction_status, created_at) VALUES (?, ?, ?, 'text', ?, 'realtime_fallback', 0, 'customer', 'confirmed', '2026-01-01T00:00:00Z')`)
    .run(threadId, id, content, 100000);
}

test('byte-identical preview collapses into the real row via promote', () => {
  const db = createDb();
  insertPreview(db, 'sidebar_preview_j', 'Jjjjjj');
  const result = ConversationRepository.saveMessagesTransaction('t1', [{
    fb_message_id: '100034206860298@msgr.7523310591226351779', content: 'Jjjjjj', media_type: 'text',
    timestamp_ms: 1793697021299, timestamp_source: 'facebook_label', is_outgoing: false,
    direction_status: 'confirmed', created_at: '2026-11-03T09:10:00.000Z'
  }], db);
  assert.deepEqual(result.updatedIds, ['100034206860298@msgr.7523310591226351779']);
  assert.deepEqual(db.prepare('SELECT fb_message_id FROM messages').all(),
    [{ fb_message_id: '100034206860298@msgr.7523310591226351779' }]);
  db.close();
});

test('direction misread at insert time keeps the preview until a real incoming row lands', () => {
  const db = createDb();
  insertPreview(db, 'sidebar_preview_j', 'Jjjjjj');
  // Chiều bị đọc sai thành outgoing -> promote (soi out=0) hụt, row mid vào
  // DB với is_outgoing=1 cạnh preview mồ côi.
  ConversationRepository.saveMessagesTransaction('t1', [{
    fb_message_id: 'mid.flip', content: 'Jjjjjj', media_type: 'text',
    timestamp_ms: 1793697021299, timestamp_source: 'facebook_label', is_outgoing: true,
    direction_status: 'confirmed', created_at: '2026-11-03T09:10:00.000Z'
  }], db);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM messages WHERE fb_message_id LIKE 'sidebar_preview_%'").get().count, 1);
  // Quan sát history KHÔNG được lật ngược row outgoing đã confirmed (guard
  // crawl-flip) - absorb cũng không nuốt preview khi chiều chưa được xác
  // nhận lại bằng row thật chiều vào (chỉ geometry/heal đường WS mới sửa).
  const result = ConversationRepository.saveMessagesTransaction('t1', [{
    fb_message_id: 'mid.flip', content: 'Jjjjjj', media_type: 'text',
    timestamp_ms: 1793697021299, timestamp_source: 'facebook_label', is_outgoing: false,
    direction_status: 'confirmed', created_at: '2026-11-03T09:10:00.000Z'
  }], db);
  assert.equal(result.skippedCount, 1);
  assert.equal(result.absorbedPreviewCount, 0);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM messages').get().count, 2);
  db.close();
});

test('absorb matches across case and whitespace drift', () => {
  const db = createDb();
  insertPreview(db, 'sidebar_preview_c', 'jjjjjj');
  ConversationRepository.saveMessagesTransaction('t1', [{
    fb_message_id: 'mid.case', content: 'Jjjjjj  ', media_type: 'text',
    timestamp_ms: 100500, timestamp_source: 'facebook_label', is_outgoing: false,
    direction_status: 'confirmed', created_at: '2026-01-01T00:00:00.500Z'
  }], db);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM messages WHERE fb_message_id LIKE 'sidebar_preview_%'").get().count, 0);
  db.close();
});

test('outgoing real message with the same text never absorbs an incoming preview', () => {
  const db = createDb();
  insertPreview(db, 'sidebar_preview_in', 'ok');
  ConversationRepository.saveMessagesTransaction('t1', [{
    fb_message_id: 'mid.out', content: 'ok', media_type: 'text',
    timestamp_ms: 100500, timestamp_source: 'sync', is_outgoing: true,
    direction_status: 'confirmed', created_at: '2026-01-01T00:00:00.500Z'
  }], db);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM messages WHERE fb_message_id LIKE 'sidebar_preview_%'").get().count, 1);
  db.close();
});

test('previews with unrelated content survive an incoming insert', () => {
  const db = createDb();
  insertPreview(db, 'sidebar_preview_other', 'giá bao nhiêu vậy shop');
  ConversationRepository.saveMessagesTransaction('t1', [{
    fb_message_id: 'mid.in', content: 'Jjjjjj', media_type: 'text',
    timestamp_ms: 100500, timestamp_source: 'facebook_label', is_outgoing: false,
    direction_status: 'confirmed', created_at: '2026-01-01T00:00:00.500Z'
  }], db);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM messages WHERE fb_message_id LIKE 'sidebar_preview_%'").get().count, 1);
  db.close();
});

test('a preview batch never absorbs itself', () => {
  const db = createDb();
  const result = ConversationRepository.saveMessagesTransaction('t1', [{
    fb_message_id: 'sidebar_preview_self', content: 'tin mới của khách', media_type: 'text',
    timestamp_ms: Date.now(), timestamp_source: 'realtime_fallback', is_outgoing: false,
    sender_role: 'customer', direction_status: 'confirmed', source: 'sidebar_preview',
    created_at: new Date().toISOString()
  }], db);
  assert.deepEqual(result.insertedIds, ['sidebar_preview_self']);
  assert.equal(result.absorbedPreviewCount, 0);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM messages').get().count, 1);
  db.close();
});

test('preview and real message in one batch collapse into the real row', () => {
  const db = createDb();
  const result = ConversationRepository.saveMessagesTransaction('t1', [
    { fb_message_id: 'sidebar_preview_late', content: 'alo shop ơi', media_type: 'text',
      timestamp_ms: 100000, timestamp_source: 'realtime_fallback', is_outgoing: false,
      sender_role: 'customer', direction_status: 'confirmed', source: 'sidebar_preview',
      created_at: '2026-01-01T00:00:00Z' },
    { fb_message_id: 'mid.late', content: 'alo shop ơi', media_type: 'text',
      timestamp_ms: 100100, timestamp_source: 'facebook_label', is_outgoing: false,
      direction_status: 'confirmed', created_at: '2026-01-01T00:00:00.100Z' }
  ], db);
  assert.deepEqual(result.updatedIds, ['mid.late']);
  assert.deepEqual(db.prepare('SELECT fb_message_id FROM messages').all(), [{ fb_message_id: 'mid.late' }]);
  db.close();
});

test('previews of other threads are untouched', () => {
  const db = createDb();
  insertPreview(db, 'sidebar_preview_t2', 'Jjjjjj', 't2');
  ConversationRepository.saveMessagesTransaction('t1', [{
    fb_message_id: 'mid.in', content: 'Jjjjjj', media_type: 'text',
    timestamp_ms: 100500, timestamp_source: 'facebook_label', is_outgoing: false,
    direction_status: 'confirmed', created_at: '2026-01-01T00:00:00.500Z'
  }], db);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM messages WHERE fb_message_id LIKE 'sidebar_preview_%'").get().count, 1);
  db.close();
});
