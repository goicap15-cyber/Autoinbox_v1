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

const MEMBERS = ['Hà Anh', 'Văn', 'Ninh', 'Giang', 'Tôi'];

function setupGroupThread(db, threadId = 'thread-group-gate') {
  db.prepare('INSERT INTO accounts (id, name, profile_dir) VALUES (?, ?, ?)').run('acct-1', 'Test', '/tmp/test');
  ConversationRepository.upsertThread({ id: threadId, account_id: 'acct-1', contact_name: '222. ORDER MEDIA' }, db);
  for (const name of MEMBERS) {
    db.prepare('INSERT OR REPLACE INTO group_members (thread_id, name) VALUES (?, ?)').run(threadId, name);
  }
}

function memberNames(db, threadId = 'thread-group-gate') {
  return ConversationRepository.getGroupMemberNameSet(threadId, db);
}

// H1 (2026-11-09): nhãn tên thành viên nhóm (member_name rỗng, content trùng
// tên trong group_members) bị parser nhặt thành tin — gate phải nhận diện.
test('name label row: incoming content exactly matching a group member name is flagged', () => withDatabase((db) => {
  setupGroupThread(db);
  assert.equal(ConversationRepository.isGroupSenderNameLabelRow({
    content: 'Hà Anh', memberName: '', isOutgoing: false,
    mediaType: 'text', mediaUrl: null, clientMessageId: null, sentByAgent: null,
    memberNames: memberNames(db)
  }), true);
}));

// Tin thật của thành viên luôn mang member_name -> không được nuốt.
test('real member message (member_name set) is never flagged', () => withDatabase((db) => {
  assert.equal(ConversationRepository.isGroupSenderNameLabelRow({
    content: 'Hà Anh', memberName: 'Hà Anh', isOutgoing: false,
    mediaType: 'text', mediaUrl: null, clientMessageId: null, sentByAgent: null,
    memberNames: memberNames(db)
  }), false);
  assert.equal(ConversationRepository.isGroupSenderNameLabelRow({
    content: 'Báo cáo 12h', memberName: 'Văn', isOutgoing: false,
    mediaType: 'text', mediaUrl: null, clientMessageId: null, sentByAgent: null,
    memberNames: memberNames(db)
  }), false);
}));

// Nhãn chính mình (chiều ĐI): "Tôi" trần + bản dính hậu tố chỉnh sửa 2_space.
test('outgoing self-label with edit marker is flagged', () => withDatabase((db) => {
  setupGroupThread(db);
  assert.equal(ConversationRepository.isGroupSenderNameLabelRow({
    content: 'Tôi', memberName: null, isOutgoing: true,
    mediaType: 'text', mediaUrl: null, clientMessageId: null, sentByAgent: null,
    memberNames: memberNames(db)
  }), true);
  assert.equal(ConversationRepository.isGroupSenderNameLabelRow({
    content: 'Tôi  · Đã chỉnh sửa', memberName: null, isOutgoing: true,
    mediaType: 'text', mediaUrl: null, clientMessageId: null, sentByAgent: null,
    memberNames: memberNames(db)
  }), true);
  assert.equal(ConversationRepository.isGroupSenderNameLabelRow({
    content: 'Bạn', memberName: null, isOutgoing: true,
    mediaType: 'text', mediaUrl: null, clientMessageId: null, sentByAgent: null,
    memberNames: memberNames(db)
  }), true);
}));

// Tin gửi từ CRM luôn có client_message_id — không bao giờ bị gate nuốt.
test('CRM-sent outgoing message is exempt from the gate', () => withDatabase((db) => {
  assert.equal(ConversationRepository.isGroupSenderNameLabelRow({
    content: 'Giang', memberName: null, isOutgoing: true,
    mediaType: 'text', mediaUrl: null, clientMessageId: 'queue_123', sentByAgent: null,
    memberNames: memberNames(db)
  }), false);
}));

// Row media không dính gate; thread 1-1 (không group_members) gate tắt.
test('media rows and 1-1 threads bypass the gate', () => withDatabase((db) => {
  assert.equal(ConversationRepository.isGroupSenderNameLabelRow({
    content: 'Hà Anh', memberName: '', isOutgoing: false,
    mediaType: 'image', mediaUrl: 'https://fbcdn.net/a.jpg', clientMessageId: null, sentByAgent: null,
    memberNames: memberNames(db)
  }), false);
  assert.equal(ConversationRepository.isGroupSenderNameLabelRow({
    content: 'Hà Anh', memberName: '', isOutgoing: false,
    mediaType: 'text', mediaUrl: null, clientMessageId: null, sentByAgent: null,
    memberNames: null
  }), false);
}));

// End-to-end qua saveMessagesTransaction: batch chứa 2 row nhãn + 1 tin thật
// (reproduce 2026-11-09 thread "222. ORDER MEDIA HẰNG NGÀY").
test('saveMessagesTransaction drops name-label rows but keeps real member messages', () => withDatabase((db) => {
  setupGroupThread(db);
  const result = ConversationRepository.saveMessagesTransaction('thread-group-gate', [
    { fb_message_id: 'mid.$gAAfAqyq34x-n8AAgmmhvrrQdmUOP', content: 'Hà Anh', is_outgoing: 0, member_name: '', source: 'dom_observer', timestamp_ms: 1794199620000, timestamp_source: 'dom_clock_order' },
    { fb_message_id: 'mid.$gAAfAqyq34x-n8AAgmmhvrrQdmUOQ', content: 'Báo cáo 12h Media', is_outgoing: 0, member_name: 'Hà Anh', source: 'dom_observer', timestamp_ms: 1794199680000, timestamp_source: 'dom_clock_order' },
    { fb_message_id: 'mid.$gAAfAqyq34x-n8AAgmmhvrrQdmUOR', content: 'Tôi', is_outgoing: 1, source: 'dom_observer', timestamp_ms: 1794199740000, timestamp_source: 'dom_clock_order' }
  ], db);
  assert.equal(result.skippedCount, 2);
  const rows = db.prepare('SELECT fb_message_id, content FROM messages WHERE thread_id = ? ORDER BY id').all('thread-group-gate');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].content, 'Báo cáo 12h Media');
}));

// Thread 1-1: cùng content "Hà Anh" vẫn được lưu (gate chỉ bật cho nhóm).
test('1-1 thread without group_members still stores content equal to a name', () => withDatabase((db) => {
  db.prepare('INSERT INTO accounts (id, name, profile_dir) VALUES (?, ?, ?)').run('acct-1', 'Test', '/tmp/test');
  ConversationRepository.upsertThread({ id: 'thread-1to1', account_id: 'acct-1', contact_name: 'Hà Anh' }, db);
  const result = ConversationRepository.saveMessagesTransaction('thread-1to1', [
    { fb_message_id: 'mid.$personal1', content: 'Hà Anh', is_outgoing: 0, source: 'dom_observer', timestamp_ms: 1794199620000, timestamp_source: 'dom_clock_order' }
  ], db);
  assert.equal(result.insertedIds.length, 1);
}));

// H3: lookup base của họ id bubble — exact mid, bản mirror dotted, vắng mặt.
test('findBubbleFamilyBaseRow: exact mid, dotted twin, absent and short families', () => withDatabase((db) => {
  setupGroupThread(db);
  const family = 'mid.$gAAfAqyq34x-n7-b4xGhvqGzb0QNl';
  db.prepare(`INSERT INTO messages (thread_id, fb_message_id, sender_id, content, media_type, timestamp_ms, timestamp_source, is_outgoing, sender_role, direction_status, created_at)
    VALUES ('thread-group-gate', ?, 'CONTACT', 'chuển luôn nhe s', 'text', 1794199620000, 'dom_clock_order', 0, 'customer', 'confirmed', '2026-11-09T04:47:00.000Z')`).run(family);
  assert.ok(ConversationRepository.findBubbleFamilyBaseRow('thread-group-gate', family, db));
  // Bản mirror multi-account có dạng "<prefix>.<family>" — helper phải khớp
  // qua LIKE '%.' || family giống các guard phantom/drift trong server.js.
  db.prepare(`INSERT INTO messages (thread_id, fb_message_id, sender_id, content, media_type, timestamp_ms, timestamp_source, is_outgoing, sender_role, direction_status, created_at)
    VALUES ('thread-group-gate', ?, 'CONTACT', 'tin khác', 'text', 1794199700000, 'dom_clock_order', 0, 'customer', 'confirmed', '2026-11-09T04:48:00.000Z')`)
    .run('100092603611711.mid.$gAAfAqyq34x-n9-xyZ');
  assert.ok(ConversationRepository.findBubbleFamilyBaseRow('thread-group-gate', 'mid.$gAAfAqyq34x-n9-xyZ', db));
  assert.equal(ConversationRepository.findBubbleFamilyBaseRow('thread-group-gate', 'mid.$gAAfAqyq34x-khongco', db), null);
  assert.equal(ConversationRepository.findBubbleFamilyBaseRow('thread-group-gate', 'mid.$ngan', db), null);
  assert.equal(ConversationRepository.findBubbleFamilyBaseRow(null, family, db), null);
}));
