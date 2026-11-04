const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

// Phantom family __bubble_N: id tổng hợp mid.X__bubble_N gắn nhầm article —
// (a) lật chiều (operator thành khách), (b) tái dùng anchor cũ cách xa, hoặc
// (c) K1 2026-11-04: cùng hướng + ts sát nhau (re-render của CÙNG lá) — cả 3
// đều phải bị bỏ qua khi base cùng nội dung đã tồn tại. Trước đây (c) lọt
// xuống INSERT và sinh row nhân đôi khi sweep lại hội thoại cũ (reproduce
// 2026-11-04 01:59: 9 row mid.$X__bubble_1 nhân bản block tin thread
// 100004449999465). Reproduce 2026-10-08: "nhắn gì đó"/"allo"/"alo" của
// operator hiện thêm bản sao bên trái khách trong thread 1411372724455599.
test('WS insert path skips bubble-family phantoms (flipped, far anchor, or same-leaf re-render)', () => {
  const server = fs.readFileSync('src/server/server.js', 'utf8');
  assert.equal(server.includes("syncDebug('WS_SKIP_BUBBLE_FAMILY_PHANTOM'"), true);
  assert.equal(/__bubble_\\d\+\$\/\.test\(String\(stableMessageId\)\)/.test(server), true);
  assert.equal(/bubbleFamilyId\.length >= 12/.test(server), true);
  assert.equal(/fb_message_id LIKE '%\.' \|\| \?/.test(server), true);
  // K1: base tồn tại + cùng nội dung = cùng tin -> break, không còn điều kiện
  // kèm theo về chiều/ts (trước đây cùng chiều + ts sát bị lọt xuống insert).
  assert.equal(/if \(bubbleBaseRow\s*\n\s*&& String\(bubbleBaseRow\.content \|\| ''\)\.trim\(\) === String\(m\.content \|\| ''\)\.trim\(\)\)/.test(server), true);
  assert.equal(/ts_delta_ms: Math\.abs\(Number\(tsMs \|\| 0\) - Number\(bubbleBaseRow\.timestamp_ms \|\| 0\)\)/.test(server), true);
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
  // gate 2 - bg bỏ qua echo KHÔNG mid thật, echo có mid thật đi tiếp;
  // mid.$X__bubble_N (lá thật đã hydrate) phải được strip hậu tố trước khi
  // test, không thì reading thật của tin ĐI bị nuốt câm ở cổng này.
  assert.equal(/const echoFamilyMid = echoMid\.replace\(\/__bubble_\\d\+\$\/, ''\);/.test(background), true);
  assert.equal(/const echoHasRealMid = Boolean\(echoFamilyMid\)/.test(background), true);
  assert.equal(/&& !\/\^\(\?:dom_\|pending_\|history_\)\/\.test\(echoFamilyMid\)/.test(background), true);
  assert.equal(/&& !echoHasRealMid\s*\)/.test(background), true);
  // gate 3 - anti-ghost: dom_observer + mid thật -> khớp theo mid, không khớp nội dung
  assert.equal(/const obsEchoHasRealMid = m\.source === 'dom_observer' && obsEchoMid/.test(server), true);
  assert.equal(/AND is_outgoing = 1 AND fb_message_id = \?/.test(server), true);
  // nhánh khớp nội dung 300s vẫn còn cho echo không có mid thật + page
  assert.equal(/AND datetime\(created_at\) >= datetime\('now', '-300 seconds'\)/.test(server), true);
});

// Row ma lật chiều sinh TRƯỚC base chiếm đứt id tổng hợp mid.$X__bubble_N:
// guard b54 cần base, sweep b58 chỉ chạy khi base đổ vào - base chưa từng
// vào DB thì reading thật quay lại với CÙNG id bị INSERT OR IGNORE nuốt câm
// (reproduce 2026-10-09 12:00: 4 "alo" chỉ 1 vào DB, row ma out=0 đứng yên).
test('flipped squatter of a synthetic bubble id is corrected when the real OUT reading arrives', () => {
  const server = fs.readFileSync('src/server/server.js', 'utf8');
  // chỉ chạy khi insert bị IGNORE và id là id tổng hợp __bubble_N
  assert.equal(/if \(insertMsgResult\.changes === 0 && \/__bubble_\\d\+\$\/\.test\(String\(stableMessageId\)\)\)/.test(server), true);
  // cửa sổ 15 phút: replay lịch sử cũ không được lật tin đã chốt
  assert.equal(/AND datetime\(created_at\) >= datetime\('now', '-900 seconds'\)/.test(server), true);
  // chỉ flip IN->OUT (chiều ngược bị reconcile chặn cứng như cũ)
  assert.equal(/Number\(squatterRow\.is_outgoing\) === 0\s*\n\s*&& isOutgoing && directionStatus === 'confirmed'/.test(server), true);
  assert.equal(server.includes("syncDebug('WS_FIX_FLIPPED_SQUATTER'"), true);
  assert.equal(/UPDATE messages SET is_outgoing = 1, sender_role = 'operator',/.test(server), true);
});

// Otid thuần số (id 15-19 chữ số, không @msgr./mid.): client MỌI tin ĐI tự
// sinh, tin khách luôn mang <uid>@msgr.N / mid.$. Đo DB sống 2026-10-09:
// 7 row số trần - 2 out=1 là tin thật, 5 out=0 TOÀN ma lật chiều ("alo"/
// "sdsdsd" user tự gõ). (id>>22) decode khớp giây gửi thật.
test('bare-numeric otid rows claiming incoming are rejected on every save path', () => {
  const server = fs.readFileSync('src/server/server.js', 'utf8');
  const repo = fs.readFileSync('src/server/repositories/ConversationRepository.js', 'utf8');
  // guard WS: chặn trước promoteSidebarPreview
  assert.equal(server.includes("syncDebug('WS_SKIP_OTID_FLIPPED'"), true);
  assert.equal(server.includes('const otidFamilyId = String(stableMessageId).replace(/__bubble_'), true);
  assert.equal(server.includes('if (!isOutgoing && /^\\d{15,19}$/.test(otidFamilyId)'), true);
  // heal 2c-ter: xoá row __bubble_N family số trần out=0 không cần base
  assert.equal(server.includes('(2c-ter) Otid thuần số'), true);
  assert.equal(server.includes('if (Number(m.is_outgoing) === 0 && /^\\d{15,19}$/.test(familyId))'), true);
  // guard repo: đối xứng cho đường history
  assert.equal(repo.includes('if (!isOutgoing && /^[0-9]{15,19}(?:__bubble_\\d+)?$/.test(String(stableId))'), true);
});

// Race cùng đợt quét (reproduce 2026-10-09 04:23:25): row ma lật chiều
// __bubble_1 out=0 chèn TRƯỚC base out=1 (seq 113 < 114) - guard WS cần base
// đã tồn tại nên lọt. Base đổ vào 1ms sau phải tự dọn ma.
test('flipped bubble sibling inserted before its base is collapsed when the base lands', () => {
  const Database = require('better-sqlite3');
  const ConversationRepository = require('../../src/server/repositories/ConversationRepository');
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE messages (id INTEGER PRIMARY KEY, thread_id TEXT, fb_message_id TEXT UNIQUE, client_message_id TEXT, sender_id TEXT, content TEXT, media_type TEXT, media_url TEXT, timestamp_ms INTEGER, timestamp_source TEXT, is_outgoing INTEGER, sender_role TEXT, sequence_order REAL, direction_status TEXT, created_at TEXT)`);
  const tid = '61586667541379';
  const family = 'mid.$cAABi91rGyeqnUCwvTWhHubm8AE_k';
  const ins = db.prepare(`INSERT INTO messages (thread_id, fb_message_id, content, media_type, is_outgoing, timestamp_ms, created_at) VALUES (?, ?, ?, 'text', ?, ?, ?)`);
  ins.run(tid, `${family}__bubble_1`, 'alo', 0, 1760000000000, '2026-10-09T04:23:25.424Z');
  // base chưa vào DB: chưa được xoá gì (ma đứng trước base trong cùng đợt)
  assert.equal(ConversationRepository.collapseFlippedBubbleSiblings(tid, `${family}__bubble_1`, 'alo', db), 0);
  ins.run(tid, family, 'alo', 1, 1760000000000, '2026-10-09T04:23:25.423Z');
  // base đổ vào -> ma cùng family khác hướng cùng nội dung phải bị xoá
  assert.equal(ConversationRepository.collapseFlippedBubbleSiblings(tid, family, 'alo', db), 1);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM messages WHERE fb_message_id LIKE ?').get('%__bubble_%').c, 0);
  db.close();
});

test('same-direction like-group sibling, emoji and media flips are never collapsed', () => {
  const Database = require('better-sqlite3');
  const ConversationRepository = require('../../src/server/repositories/ConversationRepository');
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE messages (id INTEGER PRIMARY KEY, thread_id TEXT, fb_message_id TEXT UNIQUE, client_message_id TEXT, sender_id TEXT, content TEXT, media_type TEXT, media_url TEXT, timestamp_ms INTEGER, timestamp_source TEXT, is_outgoing INTEGER, sender_role TEXT, sequence_order REAL, direction_status TEXT, created_at TEXT)`);
  const tid = 't1';
  const ins = db.prepare(`INSERT INTO messages (thread_id, fb_message_id, content, media_type, media_url, is_outgoing, timestamp_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  // like-group thật: 2 lá CÙNG hướng như nhau -> giữ nguyên
  ins.run(tid, 'mid.abc', 'hello', 'text', null, 0, 1000, '2026-01-01T00:00:00Z');
  ins.run(tid, 'mid.abc__bubble_1', 'hello', 'text', null, 0, 1001, '2026-01-01T00:00:00Z');
  assert.equal(ConversationRepository.collapseFlippedBubbleSiblings(tid, 'mid.abc', 'hello', db), 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM messages WHERE fb_message_id = ?').get('mid.abc__bubble_1').c, 1);
  // emoji thuần: operator/khách lặp 👍 là bình thường -> miễn trừ
  db.prepare('DELETE FROM messages').run();
  ins.run(tid, 'mid.emo', '👍', 'text', null, 1, 1000, '2026-01-01T00:00:00Z');
  ins.run(tid, 'mid.emo__bubble_1', '👍', 'text', null, 0, 1001, '2026-01-01T00:00:00Z');
  assert.equal(ConversationRepository.collapseFlippedBubbleSiblings(tid, 'mid.emo', '👍', db), 0);
  // media: chỉ quét text, ảnh/video của family không bị đụng
  db.prepare('DELETE FROM messages').run();
  ins.run(tid, 'mid.img', 'ảnh', 'text', null, 1, 1000, '2026-01-01T00:00:00Z');
  ins.run(tid, 'mid.img__bubble_1', 'ảnh', 'image', 'http://cdn/a.jpg', 0, 1001, '2026-01-01T00:00:00Z');
  assert.equal(ConversationRepository.collapseFlippedBubbleSiblings(tid, 'mid.img', 'ảnh', db), 0);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM messages').get().c, 2);
  db.close();
});

// Sweep phải được gọi sau MỖI insert thành công ở cả 2 đường (WS realtime +
// repo history) - nếu không race flip-trước-base sẽ sống cả session.
test('flipped-sibling sweep is wired after insert on WS and repo paths', () => {
  const server = fs.readFileSync('src/server/server.js', 'utf8');
  const repo = fs.readFileSync('src/server/repositories/ConversationRepository.js', 'utf8');
  assert.equal(server.includes('ConversationRepository.collapseFlippedBubbleSiblings(m.thread_id, stableMessageId, m.content, db)'), true);
  assert.equal(server.includes("syncDebug('WS_HEAL_FLIPPED_BUBBLE_SIBLING'"), true);
  assert.equal(repo.includes('ConversationRepository.collapseFlippedBubbleSiblings(threadId, stableId, content, database)'), true);
});
