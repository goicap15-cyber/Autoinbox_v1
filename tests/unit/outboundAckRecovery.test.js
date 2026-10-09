const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

// B60: sweeper 30s KHÔNG còn xoá row pending mù quáng (thủ phạm mất tin
// burst 12:54 - 4 tin "alo" chỉ còn 1 row). Nó chỉ xoá khi tin chắc chắn
// đã lưu ở chỗ khác; còn lại đánh dấu failed + crawl thread + grace 45s.
test('30s ACK sweeper keeps rows and dispatches a crawl instead of deleting', () => {
  const server = fs.readFileSync('src/server/server.js', 'utf8');
  const start = server.indexOf("syncDebug('OUT_ACK_TIMEOUT'");
  assert.ok(start >= 0, 'sweeper entry marker missing');
  const end = server.indexOf("}, 30000);", start);
  assert.ok(end > start, 'sweeper timeout end missing');
  const sweeper = server.slice(start, end);

  assert.doesNotMatch(sweeper, /deleteOutboundMessageRows\(\{\s*messageId:\s*ackPending\.id\s*\}\);\s*io\.emit\('MESSAGE_SEND_FAILED'[\s\S]*?return;\s*\}\s*\/\/\s*Không có bằng chứng/);
  assert.match(sweeper, /OUT_ACK_TIMEOUT_MID_ATTACHED/);
  assert.match(sweeper, /OUT_ACK_TIMEOUT_DEDUPED/);
  assert.match(sweeper, /OUT_ACK_TIMEOUT_KEPT/);
  assert.match(sweeper, /delivery_status = 'failed'/);
  assert.match(sweeper, /reason: 'history_retry'/);
  assert.match(sweeper, /allow_navigation: true/);
  assert.match(sweeper, /error_code: 'EXTENSION_ACK_TIMEOUT'/);
});

test('45s grace timer still sees rows the 30s pass already marked failed', () => {
  const server = fs.readFileSync('src/server/server.js', 'utf8');
  const start = server.indexOf('const latePending');
  assert.ok(start >= 0, 'grace timer missing');
  const end = server.indexOf("}, 45000);", start);
  const grace = server.slice(start, end);
  assert.match(grace, /delivery_status IN \('pending', 'failed'\)/);
  assert.match(grace, /OUT_ACK_GRACE_MID_ATTACHED/);
  assert.match(grace, /OUT_ACK_GRACE_DEDUPED/);
  assert.match(grace, /OUT_ACK_GRACE_KEPT/);
});

test('late COMPOSER_DISPATCHED upgrades a failed text row instead of ignoring it', () => {
  const server = fs.readFileSync('src/server/server.js', 'utf8');
  const marker = "OUT_LATE_DISPATCH_UPGRADED";
  assert.ok(server.includes(marker), 'late dispatch upgrade missing');
  const region = server.slice(Math.max(0, server.indexOf(marker) - 2000), server.indexOf(marker) + 500);
  assert.match(region, /attachment_id/);
  assert.match(region, /UPDATE messages SET delivery_status = 'sent', delivery_error = NULL/);
});

test('echo-merge confirms the pending row as sent and notifies the client', () => {
  const server = fs.readFileSync('src/server/server.js', 'utf8');
  const start = server.indexOf("syncDebug('OUT_ECHO_MERGED'");
  assert.ok(start >= 0, 'echo merge marker missing');
  const region = server.slice(Math.max(0, start - 2000), start + 300);
  assert.match(region, /delivery_status = 'sent', delivery_error = NULL/);
  assert.match(region, /client_message_id:\s*pendingRow\.client_message_id/);
});

test('pending content-match accepts failed rows still carrying pending_ ids', () => {
  const server = fs.readFileSync('src/server/server.js', 'utf8');
  assert.match(server, /outbound\.delivery_status IN \('pending', 'failed'\)/);
  assert.match(server, /outbound\.fb_message_id LIKE 'pending_%'/);
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
