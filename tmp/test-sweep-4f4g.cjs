const Database = require('better-sqlite3');
const path = require('path');

const REPLY_HEADER_GHOST_RE = /^[^?！?\n]{1,48}\s(?:đã trả lời|replied to)\s(?!(?:.*\s)?(?:chưa|rồi|xong|sao|đâu|gì|à|hả|nhỉ|nha|nhé|thôi|luôn|vậy|đấy|đó|ạ|nhá|rùi|nè|được|yet|already|right|now|ok|okay)\s*[?！?.!…]*$)[^?！?\n]{1,60}$/iu;

const db = new Database(path.join(process.env.APPDATA, 'autochatbot-fb-crm', 'data', 'database.db'), { readonly: true });

console.log('=== 4f: header ghost sẽ xóa ===');
const ghosts = db.prepare(`
  SELECT id, thread_id, content, fb_message_id FROM messages
  WHERE (content LIKE '% đã trả lời %' OR content LIKE '% replied to %')
    AND (fb_message_id LIKE 'mid.$%' OR fb_message_id LIKE '%@msgr.%')
    AND (media_type IS NULL OR media_type = 'text')
`).all();
let n = 0;
for (const r of ghosts) {
  const text = String(r.content || '').trim();
  if (/quảng cáo|replied to (?:an |your )?ad/i.test(text)) continue;
  if (/bài viết|story/i.test(text)) continue;
  if (!REPLY_HEADER_GHOST_RE.test(text)) continue;
  n++;
  console.log('DEL', r.id, r.thread_id, JSON.stringify(text).substring(0, 50));
}
console.log('total 4f:', n);

console.log('=== 4g: preview prefix sẽ tách ===');
const prefixRows = db.prepare(`
  SELECT id, thread_id, content, sender_name FROM messages
  WHERE fb_message_id LIKE 'sidebar_preview_%' AND content LIKE '%: %'
`).all();
const distinct = db.prepare(`SELECT COUNT(DISTINCT sender_name) AS n FROM messages WHERE thread_id = ? AND is_outgoing = 0 AND sender_name IS NOT NULL AND TRIM(sender_name) != ''`);
for (const r of prefixRows) {
  const m = String(r.content || '').match(/^([^:\n]{1,40}):\s+(.+)$/s);
  if (!m) { console.log('SKIP no-match', r.id, JSON.stringify(r.content).substring(0, 50)); continue; }
  const prefixName = m[1].trim();
  const suffix = m[2].trim();
  if (prefixName.length < 2 || prefixName.split(/\s+/).length > 5) { console.log('SKIP name', r.id, JSON.stringify(r.content).substring(0, 50)); continue; }
  if (!/^[\p{L}\p{M}][\p{L}\p{M}\s.'\-]*$/u.test(prefixName)) { console.log('SKIP shape', r.id, JSON.stringify(r.content).substring(0, 50)); continue; }
  if (!suffix || /^[^:\n]{1,40}:\s+/.test(suffix)) { console.log('SKIP nested', r.id, JSON.stringify(r.content).substring(0, 50)); continue; }
  const g = Number(distinct.get(r.thread_id).n);
  if (g < 2) { console.log('SKIP not-group(' + g + ')', r.id, JSON.stringify(r.content).substring(0, 50)); continue; }
  console.log('SPLIT', r.id, r.thread_id, JSON.stringify(r.content), '->', JSON.stringify(suffix), '+ sender', JSON.stringify(prefixName), 'group senders=' + g);
}
db.close();
