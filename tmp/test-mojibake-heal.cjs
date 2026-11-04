// Kiểm tra heal mojibake emoji (like 👍 bị lưu thành literal hỏng encoding,
// gồm literal mã hóa KÉP 2 lớp đúng như nằm trong file content.js cũ)
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const CP1252_HIGH = {
  0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85,
  0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A,
  0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92,
  0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C,
  0x017E: 0x9E, 0x0178: 0x9F
};
const cp1252Bytes = (str) => {
  const bytes = [];
  for (const ch of String(str)) {
    const cp = ch.codePointAt(0);
    if (cp < 0x100) bytes.push(cp);
    else if (CP1252_HIGH[cp] !== undefined) bytes.push(CP1252_HIGH[cp]);
    else return null;
  }
  return Buffer.from(bytes);
};
const isPureEmoji = (s) => /^[\p{Extended_Pictographic}\uFE0F\u200D\s]+$/u.test(s) && /\p{Extended_Pictographic}/u.test(s);
const fixMojibakeEmoji = (content) => {
  let current = String(content || '').trim();
  if (!current || current.codePointAt(0) <= 127) return null;
  for (let round = 0; round < 3; round++) {
    const bytes = cp1252Bytes(current);
    if (!bytes) return null;
    const decoded = bytes.toString('utf8');
    if (isPureEmoji(decoded)) return decoded;
    if (decoded === current) return null;
    current = decoded;
  }
  return null;
};

let failed = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} (got: ${JSON.stringify(actual)}, want: ${JSON.stringify(expected)})`);
}

const mojibakeLike = Buffer.from([0xF0, 0x9F, 0x91, 0x8D]).toString('latin1');
// Literal ĐÚNG NHƯ nằm trong file content.js cũ (mã hóa kép 2 lớp, 9 ký tự)
const realFileLiteral = String.fromCharCode(0xC3, 0xB0, 0xC5, 0xB8, 0xE2, 0x20AC, 0x02DC, 0xC2, 0x8D);
const mojibakeHeart = Buffer.from([0xE2, 0x9D, 0xA4, 0xEF, 0xB8, 0x8F]).toString('latin1');
check('mojibake đơn 👍 -> 👍', fixMojibakeEmoji(mojibakeLike), '\u{1F44D}');
check('literal 9 ký tự trong file -> 👍', fixMojibakeEmoji(realFileLiteral), '\u{1F44D}');
check('literal 9 ký tự qua SQL length<=16 (độ dài ' + realFileLiteral.length + ')', realFileLiteral.length <= 16, true);
check('mojibake ❤️ -> ❤️', fixMojibakeEmoji(mojibakeHeart), '\u{2764}\u{FE0F}');
check('👍 thật không bị đụng', fixMojibakeEmoji('\u{1F44D}'), null);
check('VN "Ừ" không bị đụng', fixMojibakeEmoji('Ừ'), null);
check('"alo" không bị đụng', fixMojibakeEmoji('alo'), null);
check('VN "Ừ đúng đó" không bị đụng', fixMojibakeEmoji('Ừ đúng đó'), null);
check('rỗng -> null', fixMojibakeEmoji(''), null);

// SQL candidates + heal trên DB thật schema
const db = new Database(':memory:');
db.exec(fs.readFileSync(path.join(__dirname, '../src/server/database/schema.sql'), 'utf8'));
db.prepare("INSERT INTO accounts (id, name, profile_dir, status) VALUES ('acc1', 'T', 'p', 'ACTIVE')").run();
db.prepare("INSERT INTO threads (id, account_id, is_unread, unread_manual, last_message) VALUES ('t1', 'acc1', 0, 0, ?)").run(realFileLiteral);
db.prepare("INSERT INTO messages (thread_id, fb_message_id, sender_id, content, is_outgoing, media_type, timestamp_ms, timestamp_source, created_at) VALUES ('t1', 'mid_like_1', 'C', ?, 0, 'text', 1759800000000, 'facebook_label', '2025-10-07T00:00:00.000Z')").run(realFileLiteral);
db.prepare("INSERT INTO messages (thread_id, fb_message_id, sender_id, content, is_outgoing, media_type, timestamp_ms, timestamp_source, created_at) VALUES ('t1', 'mid_vn_1', 'C', 'Ừ đúng đó', 0, 'text', 1759800100000, 'facebook_label', '2025-10-07T00:01:00.000Z')").run();

const candidates = db.prepare(`
  SELECT id, thread_id, content FROM messages
  WHERE (media_type IS NULL OR media_type = 'text')
    AND LENGTH(content) <= 16
    AND unicode(substr(trim(content), 1, 1)) > 127
`).all();
let fixedCount = 0;
for (const row of candidates) {
  const fixed = fixMojibakeEmoji(row.content);
  if (!fixed || fixed === row.content) continue;
  db.prepare('UPDATE messages SET content = ? WHERE id = ?').run(fixed, row.id);
  db.prepare("UPDATE threads SET last_message = ? WHERE id = ? AND last_message = ?").run(fixed, row.thread_id, row.content);
  fixedCount++;
}
check('số row được sửa', fixedCount, 1);
check('message mojibake thành 👍', db.prepare("SELECT content FROM messages WHERE fb_message_id = 'mid_like_1'").get().content, '\u{1F44D}');
check('tin VN giữ nguyên', db.prepare("SELECT content FROM messages WHERE fb_message_id = 'mid_vn_1'").get().content, 'Ừ đúng đó');
check('preview thread thành 👍', db.prepare("SELECT last_message FROM threads WHERE id = 't1'").get().last_message, '\u{1F44D}');

console.log(failed === 0 ? '=> ALL PASS' : `=> ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
