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

function setupThread(db, threadId = 'thread-reply-quote') {
  db.prepare('INSERT INTO accounts (id, name, profile_dir) VALUES (?, ?, ?)').run('acct-1', 'Test', '/tmp/test');
  ConversationRepository.upsertThread({ id: threadId, account_id: 'acct-1', contact_name: '222. ORDER MEDIA' }, db);
}

function historyMsg(overrides = {}) {
  return {
    fb_message_id: 'mid.$gAAfAqyq34x-n7-testMid0001',
    content: 'chuển luôn nhe s',
    is_outgoing: 0,
    member_name: 'Giang',
    timestamp_ms: 1794199620000,
    source: 'dom_history_sync',
    ...overrides
  };
}

function rowByMid(db, mid, threadId = 'thread-reply-quote') {
  return db.prepare('SELECT * FROM messages WHERE thread_id = ? AND fb_message_id = ?').get(threadId, mid);
}

const FAMILY = 'mid.$gAAfAqyq34x-n7-testMid0001';
const BASE_MID = FAMILY;
const LEAF_MID = `${FAMILY}__bubble_2`;

// H5 (2026-11-09): history sync extract quote reply (background.js) — batch
// trước đây bỏ qua msg.reply_quote_text nên tin rep lần đầu bắt bằng quét lại
// mất "Trả lời tin nhắn của X" (reproduce: "chuển luôn nhe s" thread
// 222. ORDER MEDIA — lá realtime có quote bị guard skip, base history trần).

test('insert with reply_quote_text persists reply_to_text', () => withDatabase((db) => {
  setupThread(db);
  const result = ConversationRepository.saveMessagesTransaction('thread-reply-quote', [
    historyMsg({ reply_quote_text: 'dạ vâng ak' })
  ], db);
  assert.equal(result.insertedIds.length, 1);
  const row = rowByMid(db, BASE_MID);
  assert.equal(row.reply_to_text, 'dạ vâng ak');
}));

test('insert without reply_quote_text leaves reply_to_text null', () => withDatabase((db) => {
  setupThread(db);
  ConversationRepository.saveMessagesTransaction('thread-reply-quote', [historyMsg()], db);
  const row = rowByMid(db, BASE_MID);
  assert.equal(row.reply_to_text, null);
}));

test('re-scan same mid with quote fills empty reply_to_text (upsert fill-if-empty)', () => withDatabase((db) => {
  setupThread(db);
  ConversationRepository.saveMessagesTransaction('thread-reply-quote', [
    historyMsg({ member_name: null })
  ], db);
  // Quét sau giải được member_name + quote -> row đổi ít nhất 1 trường để
  // đi qua nhánh update của upsert.
  ConversationRepository.saveMessagesTransaction('thread-reply-quote', [
    historyMsg({ member_name: 'Giang', reply_quote_text: 'dạ vâng ak' })
  ], db);
  const row = rowByMid(db, BASE_MID);
  assert.equal(row.reply_to_text, 'dạ vâng ak');
  assert.equal(row.sender_name, 'Giang');
}));

test('re-scan does not overwrite an existing quote', () => withDatabase((db) => {
  setupThread(db);
  ConversationRepository.saveMessagesTransaction('thread-reply-quote', [
    historyMsg({ reply_quote_text: 'dạ vâng ak' })
  ], db);
  ConversationRepository.saveMessagesTransaction('thread-reply-quote', [
    historyMsg({ reply_quote_text: 'quote khác sau quét lại' })
  ], db);
  const row = rowByMid(db, BASE_MID);
  assert.equal(row.reply_to_text, 'dạ vâng ak');
}));

test('leaf __bubble_N with quote merges quote into existing bare base and is skipped', () => withDatabase((db) => {
  setupThread(db);
  ConversationRepository.saveMessagesTransaction('thread-reply-quote', [historyMsg({ fb_message_id: BASE_MID })], db);
  const result = ConversationRepository.saveMessagesTransaction('thread-reply-quote', [
    historyMsg({ fb_message_id: LEAF_MID, reply_quote_text: 'dạ vâng ak' })
  ], db);
  assert.equal(result.skippedCount, 1);
  const rows = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE thread_id = ?').get('thread-reply-quote');
  assert.equal(rows.n, 1);
  const base = rowByMid(db, BASE_MID);
  assert.equal(base.reply_to_text, 'dạ vâng ak');
}));

test('leaf quote never overwrites a base quote that already exists', () => withDatabase((db) => {
  setupThread(db);
  ConversationRepository.saveMessagesTransaction('thread-reply-quote', [
    historyMsg({ fb_message_id: BASE_MID, reply_quote_text: 'quote gốc đã lưu' })
  ], db);
  ConversationRepository.saveMessagesTransaction('thread-reply-quote', [
    historyMsg({ fb_message_id: LEAF_MID, reply_quote_text: 'dạ vâng ak' })
  ], db);
  const base = rowByMid(db, BASE_MID);
  assert.equal(base.reply_to_text, 'quote gốc đã lưu');
}));

test('same batch: leaf quote (deferred bubble) flows into base inserted later in the batch', () => withDatabase((db) => {
  setupThread(db);
  const result = ConversationRepository.saveMessagesTransaction('thread-reply-quote', [
    historyMsg({ fb_message_id: LEAF_MID, reply_quote_text: 'dạ vâng ak' }),
    historyMsg({ fb_message_id: BASE_MID })
  ], db);
  assert.equal(result.insertedIds.length, 1);
  const rows = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE thread_id = ?').get('thread-reply-quote');
  assert.equal(rows.n, 1);
  const base = rowByMid(db, BASE_MID);
  assert.equal(base.reply_to_text, 'dạ vâng ak');
}));
