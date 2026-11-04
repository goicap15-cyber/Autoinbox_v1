const Database = require('better-sqlite3');
const path = require('path');

const HEADER_RE = /^[^?！?\n]{1,48}\s(?:đã trả lời|replied to)\s(?!(?:.*\s)?(?:chưa|rồi|xong|sao|đâu|gì|à|hả|nhỉ|nha|nhé|thôi|luôn|vậy|đấy|đó|ạ|nhá|rùi|nè|được|yet|already|right|now|ok|okay)\s*[?！?.!…]*$)[^?！?\n]{1,60}$/iu;

const db = new Database(path.join(process.env.APPDATA, 'autochatbot-fb-crm', 'data', 'database.db'), { readonly: true });
const rows = db.prepare(`
  SELECT id, thread_id, fb_message_id, content, reply_to_text, is_outgoing FROM messages
  WHERE content LIKE '% đã trả lời %' OR content LIKE '% replied to %'
  ORDER BY id DESC
`).all();

let del = 0, keep = 0;
const delList = [], keepList = [];
for (const r of rows) {
  const mid = String(r.fb_message_id || '');
  if (!/^mid\.\$/.test(mid) && !/@msgr\./.test(mid)) { keep++; keepList.push([r.id, 'id-shape', r.content]); continue; }
  const text = String(r.content || '').trim();
  if (/quảng cáo|replied to (?:an |your )?ad/i.test(text)) { keep++; keepList.push([r.id, 'ad', r.content]); continue; }
  if (/bài viết|story/i.test(text)) { keep++; keepList.push([r.id, 'post', r.content]); continue; }
  if (!HEADER_RE.test(text)) { keep++; keepList.push([r.id, 'not-header', r.content]); continue; }
  del++;
  delList.push([r.id, r.thread_id, r.content, r.reply_to_text]);
}

console.log('--- WOULD DELETE:', del);
for (const d of delList) console.log('DEL', d[0], d[1], JSON.stringify(d[2]).substring(0, 70), 'q=' + JSON.stringify(d[3]));
console.log('--- KEEP:', keep);
for (const k of keepList.filter((x) => /trả lời|replied/.test(x[2]) && !/quảng cáo|bài viết/.test(x[2])).slice(0, 15)) console.log('KEEP', k[0], k[1], JSON.stringify(k[2]).substring(0, 80));

const safe = ['Em đã trả lời khách rồi ạ', 'Tôi đã trả lời rồi', 'anh đã trả lời chưa?', 'Bạn đã trả lời em rồi', 'Mình đã trả lời là ok rồi', 'Hai đã trả lời một quảng cáo.'];
for (const s of safe) console.log('SAFE?', JSON.stringify(s), '->', HEADER_RE.test(s) ? 'WOULD DELETE' : 'kept');
db.close();
