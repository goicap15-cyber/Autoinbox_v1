const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

// Chiến dịch Page (queue page_messenger) fail 100% attempt đầu với
// "UNIQUE constraint failed: messages.fb_message_id" (campaign_6e4255d5,
// 2026-10-10): insertCampaignDispatch đã tạo row pending_queue_<id> lúc
// enqueue, pageGraphSend INSERT lại cùng id -> nổ UNIQUE.

test('pageGraphSend reuses the campaign pending row instead of inserting a duplicate', () => {
  const server = fs.readFileSync('src/server/server.js', 'utf8');
  const start = server.indexOf('pageGraphSend: async (message) => {');
  assert.ok(start >= 0, 'pageGraphSend missing');
  const end = server.indexOf('onQueueFail:', start);
  assert.ok(end > start, 'pageGraphSend block end missing');
  const block = server.slice(start, end);

  assert.match(block, /SELECT id FROM messages WHERE client_message_id = \? OR fb_message_id = \?/);
  assert.match(block, /if \(existingRow\) \{/);
  assert.match(block, /UPDATE messages\s*\n\s*SET content = \?, delivery_status = 'pending', delivery_error = NULL/);
  // INSERT chỉ chạy khi không có row sẵn có
  const insertAt = block.indexOf('INSERT INTO messages (thread_id, fb_message_id');
  assert.ok(insertAt > block.indexOf('if (existingRow) {'), 'INSERT must come after the reuse check');
});

test('getDecryptedToken returns null on undecryptable token instead of throwing', () => {
  const service = fs.readFileSync('src/server/services/InboxSourceService.js', 'utf8');
  const start = service.indexOf('static getDecryptedToken');
  assert.ok(start >= 0, 'getDecryptedToken missing');
  const end = service.indexOf('\n  }', start);
  const fn = service.slice(start, end);
  assert.match(fn, /try \{/);
  assert.match(fn, /return null;/);
});
