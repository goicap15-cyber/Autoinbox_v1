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

// Tin nhắn tay trong Messenger (không qua composer CRM) từng bị nuốt ở 3 cửa:
// observer content.js, gate background.js, anti-ghost server khớp theo NỘI
// DUNG (300s) — 5 tin "alo" nhắn tay 2026-10-09 chỉ còn 1 vào CRM. Cả 3 cửa
// phải đi qua cho echo có mid thật; server khớp theo mid thay vì nội dung.
test('Messenger-typed outgoing text passes all three gates when it has a real mid', () => {
  const content = fs.readFileSync('src/extension/content.js', 'utf8');
  const background = fs.readFileSync('src/extension/background.js', 'utf8');
  const server = fs.readFileSync('src/server/server.js', 'utf8');
  // gate 1 - observer chỉ nhường khi CHƯA có native id
  assert.equal(/if \(isPlainOutgoingDomText && !parsed\.native_id\) return;/.test(content), true);
  // gate 2 - bg bỏ qua echo KHÔNG mid thật, echo có mid thật đi tiếp
  assert.equal(/const echoHasRealMid = Boolean\(echoMid\)/.test(background), true);
  assert.equal(/&& !\/\^\(\?:dom_\|pending_\|history_\)\/\.test\(echoMid\)/.test(background), true);
  assert.equal(/&& !echoHasRealMid\s*\)/.test(background), true);
  // gate 3 - anti-ghost: dom_observer + mid thật -> khớp theo mid, không khớp nội dung
  assert.equal(/const obsEchoHasRealMid = m\.source === 'dom_observer' && obsEchoMid/.test(server), true);
  assert.equal(/AND is_outgoing = 1 AND fb_message_id = \?/.test(server), true);
  // nhánh khớp nội dung 300s vẫn còn cho echo không có mid thật + page
  assert.equal(/AND datetime\(created_at\) >= datetime\('now', '-300 seconds'\)/.test(server), true);
});
