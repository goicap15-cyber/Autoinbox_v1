// Kiểm tra strip nhãn trợ năng like + heal 4b
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const serverFilter = require('../src/server/utils/textFilter');

// Extension textFilter gắn vào globalThis khi require
require('../src/extension/textFilter');
const extFilter = globalThis.FbCrmTextFilter;

let failed = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} (got: ${JSON.stringify(actual)}, want: ${JSON.stringify(expected)})`);
}

const labelEn = 'Enter, Message sent 13:58 by Khang: \u{1F44D}';
check('[server] nhãn EN -> 👍', serverFilter.cleanMessageText(labelEn), '\u{1F44D}');
check('[ext] nhãn EN -> 👍', extFilter.cleanMessageText(labelEn), '\u{1F44D}');
check('[server] nhãn VN -> 👍', serverFilter.cleanMessageText('Nhập, Tin nhắn do Bạn gửi lúc 13:58: \u{1F44D}'), '\u{1F44D}');
check('[ext] tin thật giữ nguyên', extFilter.cleanMessageText('alo ạ'), 'alo ạ');
check('[ext] "Enter, Message sent..." giữa câu không đụng', extFilter.cleanMessageText('bấm Enter, Message sent hiện ra'), 'bấm Enter, Message sent hiện ra');

// Heal 4b trên DB thật
const db = new Database(':memory:');
db.exec(fs.readFileSync(path.join(__dirname, '../src/server/database/schema.sql'), 'utf8'));
db.prepare("INSERT INTO accounts (id, name, profile_dir, status) VALUES ('acc1', 'T', 'p', 'ACTIVE')").run();
db.prepare("INSERT INTO threads (id, account_id, is_unread, unread_manual, last_message) VALUES ('t1', 'acc1', 0, 0, ?)").run(labelEn);
db.prepare("INSERT INTO messages (thread_id, fb_message_id, sender_id, content, is_outgoing, media_type, timestamp_ms, timestamp_source, created_at) VALUES ('t1', 'mid_label_1', 'C', ?, 0, 'text', 1759800000000, 'facebook_label', '2025-10-07T00:00:00.000Z')").run(labelEn);

const A11Y_LABEL_LIKE_RE = /^(?:Enter,\s*)?(?:Message sent|Tin nhắn)\b[^\n]*?:\s*(\p{Extended_Pictographic}[\uFE0F\u200D]*)\s*$/u;
const fixLabelLike = (content) => {
  const match = String(content || '').trim().match(A11Y_LABEL_LIKE_RE);
  return match ? match[1] : null;
};
const labelRows = db.prepare(`
  SELECT id, thread_id, content FROM messages
  WHERE (media_type IS NULL OR media_type = 'text') AND content LIKE 'Enter,%'
`).all();
let fixed = 0;
for (const row of labelRows) {
  const v = fixLabelLike(row.content);
  if (!v || v === row.content) continue;
  db.prepare('UPDATE messages SET content = ? WHERE id = ?').run(v, row.id);
  db.prepare('UPDATE threads SET last_message = ? WHERE id = ? AND last_message = ?').run(v, row.thread_id, row.content);
  fixed++;
}
check('heal sửa 1 row', fixed, 1);
check('row thành 👍', db.prepare("SELECT content FROM messages WHERE fb_message_id = 'mid_label_1'").get().content, '\u{1F44D}');
check('preview thành 👍', db.prepare("SELECT last_message FROM threads WHERE id = 't1'").get().last_message, '\u{1F44D}');

console.log(failed === 0 ? '=> ALL PASS' : `=> ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
