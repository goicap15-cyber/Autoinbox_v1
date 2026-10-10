const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

// Sau b60 (bị roll back): sweeper 30s GIỮ row pending - không delete mù quáng
// (thủ phạm mất tin burst 12:54), không đánh failed (nút "Thử lại" hiện oan
// khi tin thực tế đã lên Messenger). Chỉ delete khi tin chắc chắn đã lưu ở
// chỗ khác (echo/history bắt được mid thật riêng).
test('30s ACK sweeper keeps pending rows and never marks them failed', () => {
  const server = fs.readFileSync('src/server/server.js', 'utf8');
  const start = server.indexOf('Never leave the CRM bubble pending forever');
  assert.ok(start >= 0, 'sweeper entry marker missing');
  const end = server.indexOf('}, 30000);', start);
  assert.ok(end > start, 'sweeper timeout end missing');
  const sweeper = server.slice(start, end);

  assert.doesNotMatch(sweeper, /MESSAGE_SEND_FAILED/);
  assert.match(sweeper, /SELECT id, fb_message_id, content, created_at FROM messages/);
  assert.match(sweeper, /startsWith\('pending_'\)/);
  assert.match(sweeper, /fb_message_id LIKE 'mid\.%' OR fb_message_id LIKE '%@msgr\.%'/);
  assert.match(sweeper, /pending\.content \?\? text/);
  assert.match(sweeper, /deleteOutboundMessageRows\(\{ messageId: pending\.id \}\)/);
  assert.match(sweeper, /io\.emit\('MESSAGE_SENT'/);
  assert.match(sweeper, /Sweeper giữ pending/);
});

test('sweeper treats a real mid on the pending row as proof of delivery', () => {
  const server = fs.readFileSync('src/server/server.js', 'utf8');
  const start = server.indexOf('Never leave the CRM bubble pending forever');
  const end = server.indexOf('}, 30000);', start);
  const sweeper = server.slice(start, end);
  assert.match(sweeper, /Sweeper thấy mid thật/);
});

test('tail reconcile no longer swallows outgoing text carrying a durable mid', () => {
  const content = fs.readFileSync('src/extension/content.js', 'utf8');
  const start = content.indexOf('function reconcileLatestIncomingMessages');
  assert.ok(start >= 0, 'tail reconcile missing');
  const end = content.indexOf('\n  }\n', start);
  const reconcile = content.slice(start, end);
  assert.match(reconcile, /hasDurableMidId/);
  assert.match(reconcile, /\/\^mid\\\.\//);
  assert.match(reconcile, /is_outgoing && !isCallRow && !isMediaRow && !hasDurableMidId/);
});

test('background relays silent send gates into composer-debug via CONTENT_DEBUG', () => {
  const background = fs.readFileSync('src/extension/background.js', 'utf8');
  assert.match(background, /stage: 'SEND_TRACE'/);
  assert.match(background, /stage: 'BG_SKIP_ROLE'/);
});
