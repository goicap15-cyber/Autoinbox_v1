const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

// Phantom family __bubble_N: id tổng hợp mid.X__bubble_N gắn nhầm article —
// (a) lật chiều (operator thành khách) hoặc (b) tái dùng anchor cũ cách xa.
// Reproduce 2026-10-08: "nhắn gì đó"/"allo"/"alo" của operator hiện thêm bản
// sao bên trái khách trong thread 1411372724455599.
test('WS insert path skips bubble-family phantoms (flipped or far anchor)', () => {
  const server = fs.readFileSync('src/server/server.js', 'utf8');
  assert.equal(server.includes("syncDebug('WS_SKIP_BUBBLE_FAMILY_PHANTOM'"), true);
  assert.equal(/__bubble_\\d\+\$\/\.test\(String\(stableMessageId\)\)/.test(server), true);
  assert.equal(/bubbleFamilyId\.length >= 12/.test(server), true);
  assert.equal(/fb_message_id LIKE '%\.' \|\| \?/.test(server), true);
  assert.equal(/Number\(bubbleBaseRow\.is_outgoing\) !== \(isOutgoing \? 1 : 0\)/.test(server), true);
  assert.equal(/Math\.abs\(Number\(tsMs \|\| 0\) - Number\(bubbleBaseRow\.timestamp_ms \|\| 0\)\) > 60000/.test(server), true);
});

test('startup heal deletes flipped-direction bubble phantoms and keeps bases', () => {
  const server = fs.readFileSync('src/server/server.js', 'utf8');
  assert.equal(server.includes('(2c-bis) Phantom LẬT CHIỀU'), true);
  assert.equal(server.includes('const familyBaseStmt = db.prepare('), true);
  assert.equal(/Number\(familyBase\.is_outgoing\) !== Number\(m\.is_outgoing\)/.test(server), true);
  // base row không bao giờ bị đụng: chỉ xoá row có hậu tố __bubble_N
  assert.equal(/deletePhantomBubble\.run\(m\.id\)/.test(server), true);
});
