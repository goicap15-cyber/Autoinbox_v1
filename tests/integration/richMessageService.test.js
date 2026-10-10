const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { getTestDatabase } = require('../helpers/testDatabase');
const { seedPageThread, seedPersonalThread } = require('./campaignTestUtils');
const OutboundAttachmentRepository = require('../../src/server/repositories/OutboundAttachmentRepository');
const OutboundAttemptRepository = require('../../src/server/repositories/OutboundAttemptRepository');
const OutboundAttachmentService = require('../../src/server/services/OutboundAttachmentService');
const RichMessageCapabilityService = require('../../src/server/services/RichMessageCapabilityService');
const RichMessageService = require('../../src/server/services/RichMessageService');

const CONNECTED = () => ({ readyState: 1 });
const TEST_CONFIG = {
  enabled: true,
  maxBytes: 8 * 1024 * 1024,
  adapters: {
    page_messenger: { image: true, file: false },
    personal_messenger: { image: false, file: false }
  }
};

function withFixture(run) {
  const db = getTestDatabase(':memory:');
  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rich-message-service-'));
  try {
    return run({ db, storageDir });
  } finally {
    db.close();
    fs.rmSync(storageDir, { recursive: true, force: true });
  }
}

function jpegBytes() {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);
}

function capabilityOptions(db) {
  return { database: db, getConnection: CONNECTED, config: TEST_CONFIG };
}

test('capabilities are derived from the persisted source and connection, not client routing', () => withFixture(({ db }) => {
  seedPageThread(db, { id: 'thread-cap-page' });
  seedPersonalThread(db, { id: 'thread-cap-personal', accountId: 'acct-personal' });

  const page = RichMessageCapabilityService.getForThread('thread-cap-page', capabilityOptions(db));
  assert.equal(page.source_type, 'page_messenger');
  assert.equal(page.connected, true);
  assert.equal(page.text.enabled, true);
  assert.deepEqual(page.image.mime_types, ['image/jpeg', 'image/png', 'image/webp']);
  assert.equal(page.file.enabled, false);

  const personal = RichMessageCapabilityService.getForThread('thread-cap-personal', capabilityOptions(db));
  assert.equal(personal.source_type, 'personal_messenger');
  assert.equal(personal.image.enabled, false);

  // Thread Page gửi bằng Page Access Token qua Graph API — KHÔNG phụ thuộc
  // extension kết nối. Chrome tắt vẫn gửi được nếu page còn token.
  const disconnected = RichMessageCapabilityService.getForThread('thread-cap-page', {
    database: db,
    getConnection: () => null,
    config: TEST_CONFIG
  });
  assert.equal(disconnected.connected, false);
  assert.equal(disconnected.text.enabled, true);
  assert.equal(disconnected.disabled_reason, null);

  // Thiếu token THẬT mới là lỗi token — lý do phải nói đúng nguyên nhân.
  seedPageThread(db, { id: 'thread-cap-page-notoken', sourceId: 'src-page-3', pageId: 'page-3', noToken: true });
  const noToken = RichMessageCapabilityService.getForThread('thread-cap-page-notoken', {
    database: db,
    getConnection: () => null,
    config: TEST_CONFIG
  });
  assert.equal(noToken.text.enabled, false);
  assert.equal(noToken.disabled_reason, 'Page chưa có Page Access Token. Hãy mở Quản lý → Fanpage → bấm "Lấy token".');
}));

test('staged upload is bound to exactly one thread and cannot be discarded through another thread', () => withFixture(({ db, storageDir }) => {
  seedPageThread(db, { id: 'thread-owner-a' });
  seedPageThread(db, { id: 'thread-owner-b', sourceId: 'src-page-2', pageId: 'page-2' });

  const attachment = OutboundAttachmentService.stageUpload({
    threadId: 'thread-owner-a',
    createdBy: null,
    originalName: 'ảnh khách gửi.jpg',
    declaredMimeType: 'image/jpeg',
    buffer: jpegBytes()
  }, { database: db, storageDir, capabilityOptions: capabilityOptions(db) });

  assert.equal(attachment.thread_id, 'thread-owner-a');
  assert.equal(attachment.status, 'staged');
  assert.equal(fs.existsSync(attachment.storage_path), true);
  assert.equal(OutboundAttachmentRepository.getForThread(attachment.id, 'thread-owner-b', db), null);
  assert.equal(OutboundAttachmentService.discard('thread-owner-b', attachment.id, null, { database: db, storageDir }), false);
  assert.equal(OutboundAttachmentService.discard('thread-owner-a', attachment.id, null, { database: db, storageDir }), true);
}));

test('attachment-only submit is atomic and leaves campaign queue idempotency NULL', () => withFixture(({ db, storageDir }) => {
  seedPageThread(db, { id: 'thread-attachment-only' });
  const attachment = OutboundAttachmentService.stageUpload({
    threadId: 'thread-attachment-only',
    createdBy: null,
    originalName: 'photo.jpg',
    declaredMimeType: 'image/jpeg',
    buffer: jpegBytes()
  }, { database: db, storageDir, capabilityOptions: capabilityOptions(db) });

  const accepted = RichMessageService.submit({
    threadId: 'thread-attachment-only',
    clientMessageId: 'client-attachment-only',
    content: '',
    attachmentId: attachment.id
  }, { database: db, capabilityOptions: capabilityOptions(db) });

  const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(accepted.message_id);
  const queue = db.prepare('SELECT * FROM message_queue WHERE id = ?').get(accepted.queue_id);
  assert.equal(message.media_type, 'image');
  assert.equal(message.attachment_id, attachment.id);
  assert.equal(message.delivery_status, 'pending');
  assert.equal(queue.contract_version, 2);
  assert.equal(queue.idempotency_key, null);
  assert.equal(queue.outbound_attempt_id, accepted.attempt_id);
  assert.equal(OutboundAttachmentRepository.getById(attachment.id, db).status, 'queued');
}));

test('repeated first submit returns the same logical message, attempt, and queue', () => withFixture(({ db }) => {
  seedPageThread(db, { id: 'thread-idempotent-submit' });
  const payload = {
    threadId: 'thread-idempotent-submit',
    clientMessageId: 'client-idempotent-submit',
    content: 'Xin chào 👋'
  };
  const first = RichMessageService.submit(payload, { database: db, capabilityOptions: capabilityOptions(db) });
  const repeated = RichMessageService.submit(payload, { database: db, capabilityOptions: capabilityOptions(db) });

  assert.deepEqual(repeated, first);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM messages').get().count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM outbound_attempts').get().count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM message_queue').get().count, 1);
}));

test('an attachment staged for another thread is rejected before any message is created', () => withFixture(({ db, storageDir }) => {
  seedPageThread(db, { id: 'thread-submit-a' });
  seedPageThread(db, { id: 'thread-submit-b', sourceId: 'src-page-b', pageId: 'page-b' });
  const attachment = OutboundAttachmentService.stageUpload({
    threadId: 'thread-submit-a',
    createdBy: null,
    originalName: 'photo.jpg',
    declaredMimeType: 'image/jpeg',
    buffer: jpegBytes()
  }, { database: db, storageDir, capabilityOptions: capabilityOptions(db) });

  assert.throws(() => RichMessageService.submit({
    threadId: 'thread-submit-b',
    clientMessageId: 'client-wrong-thread',
    content: '',
    attachmentId: attachment.id
  }, { database: db, capabilityOptions: capabilityOptions(db) }), (error) => error.code === 'ATTACHMENT_WRONG_THREAD');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM messages').get().count, 0);
}));

test('retry appends an immutable attempt and repeated retry requests remain idempotent', () => withFixture(({ db }) => {
  seedPageThread(db, { id: 'thread-retry' });
  const first = RichMessageService.submit({
    threadId: 'thread-retry',
    clientMessageId: 'client-retry',
    content: 'Gửi lại an toàn'
  }, { database: db, capabilityOptions: capabilityOptions(db) });

  assert.equal(OutboundAttemptRepository.transition(
    first.attempt_id,
    ['queued'],
    'failed',
    { error_code: 'TEST_FAILURE', error_message: 'forced' },
    db
  ), true);
  const retried = RichMessageService.retry({
    threadId: 'thread-retry',
    messageId: first.message_id,
    expectedLatestAttemptId: first.attempt_id
  }, { database: db, capabilityOptions: capabilityOptions(db) });
  const repeated = RichMessageService.retry({
    threadId: 'thread-retry',
    messageId: first.message_id,
    expectedLatestAttemptId: first.attempt_id
  }, { database: db, capabilityOptions: capabilityOptions(db) });

  assert.deepEqual(repeated, retried);
  assert.notEqual(retried.attempt_id, first.attempt_id);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM outbound_attempts WHERE message_id = ?').get(first.message_id).count, 2);
  assert.equal(db.prepare('SELECT idempotency_key FROM message_queue WHERE id = ?').get(retried.queue_id).idempotency_key, null);
}));

test('Unicode emoji sequences and quick-like are persisted byte-for-byte', () => withFixture(({ db }) => {
  seedPageThread(db, { id: 'thread-unicode' });
  const samples = ['👍', 'Xin chào 👩🏽‍💻 👨‍👩‍👧‍👦'];
  samples.forEach((content, index) => {
    RichMessageService.submit({
      threadId: 'thread-unicode',
      clientMessageId: 'client-unicode-' + index,
      content
    }, { database: db, capabilityOptions: capabilityOptions(db) });
    const stored = db.prepare(
      'SELECT content FROM messages WHERE client_message_id = ?'
    ).get('client-unicode-' + index);
    assert.equal(stored.content, content);
    const attempt = db.prepare(
      'SELECT id FROM outbound_attempts WHERE message_id = (SELECT id FROM messages WHERE client_message_id = ?)'
    ).get('client-unicode-' + index);
    OutboundAttemptRepository.transition(attempt.id, ['queued'], 'sent', {}, db);
  });
}));

test('a new submit gets a real timestamp_ms and sorts after older history, not before it', () => withFixture(({ db }) => {
  seedPageThread(db, { id: 'thread-sort-order' });
  const oldTsMs = Date.now() - 7 * 24 * 60 * 60 * 1000; // a week ago
  db.prepare(
    "INSERT INTO messages (thread_id, fb_message_id, sender_id, content, is_outgoing, delivery_status, timestamp_ms, timestamp_source) " +
    "VALUES (?, 'mid.old', 'SYSTEM', 'old message', 1, 'sent', ?, 'facebook_label')"
  ).run('thread-sort-order', oldTsMs);

  const beforeSubmit = Date.now();
  RichMessageService.submit({
    threadId: 'thread-sort-order',
    clientMessageId: 'client-sort-order',
    content: 'new message'
  }, { database: db, capabilityOptions: capabilityOptions(db) });

  const stored = db.prepare(
    'SELECT timestamp_ms, timestamp_source FROM messages WHERE client_message_id = ?'
  ).get('client-sort-order');
  assert.ok(stored.timestamp_ms >= beforeSubmit);
  assert.equal(stored.timestamp_source, 'client_submit');

  const ordered = db.prepare(
    'SELECT content FROM messages WHERE thread_id = ? ORDER BY timestamp_ms ASC, created_at ASC, id ASC'
  ).all('thread-sort-order');
  assert.deepEqual(ordered.map((m) => m.content), ['old message', 'new message']);
}));
