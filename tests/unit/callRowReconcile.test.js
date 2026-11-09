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

function setupThread(db, threadId = 'thread-call-guard') {
  db.prepare('INSERT INTO accounts (id, name, profile_dir) VALUES (?, ?, ?)').run('acct-1', 'Test', '/tmp/test');
  ConversationRepository.upsertThread({ id: threadId, account_id: 'acct-1', contact_name: 'Khach hang' }, db);
}

function insertMessage(db, { mid, mediaType = 'call', outgoing = 1, ts, source = 'facebook_label', content = 'Cuộc gọi', senderId = 'CONTACT' }) {
  db.prepare(`INSERT INTO messages (thread_id, fb_message_id, sender_id, content, media_type, timestamp_ms, timestamp_source, is_outgoing, sender_role, direction_status, created_at)
    VALUES ('thread-call-guard', ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', '2026-11-03T08:09:00.000Z')`)
    .run(mid, senderId, content, mediaType, ts, source, outgoing, outgoing === 1 ? 'operator' : 'customer');
}

// Reproduce 2026-11-09: quan sát quét lại của dom_observer mang geometry quyết
// đoán đọc từ node thoái hóa (content "👍") đã lật cuộc gọi đi 9 giây thành
// của khách. Row media_type='call' phải bị khóa chiều.
test('call row: decisive geometry observation must not flip the stored direction', () => withDatabase((db) => {
  ConversationRepository._resetDirectionFlipTracking();
  setupThread(db);
  const mid = '100034206860298@msgr.7523295122127726';
  insertMessage(db, { mid, outgoing: 1, ts: 1793693340000 });

  const result = ConversationRepository.reconcileExistingMessage(
    mid,
    {
      source: 'dom_observer', isOutgoing: 0, directionStatus: 'confirmed',
      directionEvidence: 'geometry',
      tsMs: 1793693340000, tsSource: 'facebook_label', createdAt: '2026-11-09T08:09:00.000Z'
    },
    db
  );

  assert.equal(result.updated, false);
  const row = db.prepare('SELECT is_outgoing, sender_role, sender_id, timestamp_ms, created_at FROM messages WHERE fb_message_id = ?').get(mid);
  assert.equal(row.is_outgoing, 1);
  assert.equal(row.sender_role, 'operator');
  assert.equal(Number(row.timestamp_ms), 1793693340000);
  assert.equal(row.created_at, '2026-11-03T08:09:00.000Z');
}));

// Reproduce 2026-11-09: re-observation dập ts giờ-quét ("3:09" giải nhầm thành
// hôm nay) lên cùng rank facebook_label. Mốc mới cách giờ quét >2 phút nên lọt
// qua scanStampLooksBogus chung - guard riêng của call row phải chặn.
test('call row: equal-rank label re-stamp outside the 2-min scanStamp window is blocked', () => withDatabase((db) => {
  setupThread(db);
  const mid = 'mid.call.restamp';
  const oldTs = Date.now() - 24 * 3600 * 1000;
  insertMessage(db, { mid, outgoing: 0, ts: oldTs });

  const scanTs = Date.now() - 10 * 60 * 1000;
  const result = ConversationRepository.reconcileExistingMessage(
    mid,
    {
      source: 'dom_observer', isOutgoing: 0, directionStatus: 'confirmed',
      tsMs: scanTs, tsSource: 'facebook_label', createdAt: new Date().toISOString()
    },
    db
  );

  assert.equal(result.updated, false);
  const row = db.prepare('SELECT timestamp_ms, timestamp_source FROM messages WHERE fb_message_id = ?').get(mid);
  assert.equal(Number(row.timestamp_ms), oldTs);
  assert.equal(row.timestamp_source, 'facebook_label');
}));

// Giờ thật từ server FB (facebook_payload, rank 6) vẫn phải nâng cấp được - guard
// chỉ chặn nguồn DOM/label, không khóa cứng toàn bộ.
test('call row: facebook_payload (rank 6) still upgrades the timestamp', () => withDatabase((db) => {
  setupThread(db);
  const mid = 'mid.call.payload';
  const oldTs = Date.now() - 24 * 3600 * 1000;
  insertMessage(db, { mid, outgoing: 1, ts: oldTs });

  const payloadTs = Date.now() - 3 * 3600 * 1000;
  const result = ConversationRepository.reconcileExistingMessage(
    mid,
    {
      source: 'network_payload', isOutgoing: 1, directionStatus: 'confirmed',
      tsMs: payloadTs, tsSource: 'facebook_payload', createdAt: new Date().toISOString()
    },
    db
  );

  assert.equal(result.timestampUpdated, true);
  assert.equal(result.directionUpdated, false);
  const row = db.prepare('SELECT timestamp_ms, timestamp_source, is_outgoing FROM messages WHERE fb_message_id = ?').get(mid);
  assert.equal(Number(row.timestamp_ms), payloadTs);
  assert.equal(row.timestamp_source, 'facebook_payload');
  assert.equal(row.is_outgoing, 1);
}));

// Guard mới không được phá đường sửa chiều geometry quyết đoán của tin text
// thường (chữa heal lật sai tin operator gõ tay - reproduce 2026-11-03).
test('text row: decisive geometry flip still commits (no regression)', () => withDatabase((db) => {
  ConversationRepository._resetDirectionFlipTracking();
  setupThread(db);
  const mid = 'mid.text.geometry';
  insertMessage(db, { mid, mediaType: 'text', content: 'xin chao', outgoing: 0, ts: 1000, source: 'dom_order', senderId: 'CONTACT' });

  const result = ConversationRepository.reconcileExistingMessage(
    mid,
    {
      source: 'dom_observer', isOutgoing: 1, directionStatus: 'confirmed',
      directionEvidence: 'geometry',
      tsMs: 1000, tsSource: 'dom_order', createdAt: new Date().toISOString()
    },
    db
  );

  assert.equal(result.updated, true);
  assert.equal(result.directionUpdated, true);
  const row = db.prepare('SELECT is_outgoing, sender_role FROM messages WHERE fb_message_id = ?').get(mid);
  assert.equal(row.is_outgoing, 1);
  assert.equal(row.sender_role, 'operator');
}));
