const Database = require('C:/Users/Admin/Downloads/Duan/CRM_FB1/node_modules/better-sqlite3');
const db = new Database(process.env.APPDATA + '/autochatbot-fb-crm/data/database.db', { readonly: true });
const RE = /^[^?！?\n]{1,48}\s(?:đã trả lời|replied to)\s(?!(?:.*\s)?(?:chưa|rồi|xong|sao|đâu|gì|à|hả|nhỉ|nha|nhé|thôi|luôn|vậy|đấy|đó|ạ|nhá|rùi|nè|được|yet|already|right|now|ok|okay)\s*[?！?.!…]*$)[^?！?\n]{1,60}$/iu;
const rows = db.prepare(`
  SELECT id, thread_id, content, fb_message_id, media_type FROM messages
  WHERE (content LIKE '% đã trả lời %' OR content LIKE '% replied to %')
`).all();
console.log('LIKE candidates:', rows.length);
for (const row of rows) {
  const text = String(row.content || '').trim();
  const ad = /quảng cáo|replied to (?:an |your )?ad/i.test(text);
  const story = /bài viết|story/i.test(text);
  const midOk = /^mid\.\$/.test(row.fb_message_id) || /@msgr\./.test(row.fb_message_id);
  const reOk = RE.test(text);
  const mediaOk = row.media_type == null || row.media_type === 'text';
  const wouldDelete = !ad && !story && reOk && midOk && mediaOk;
  console.log(row.id, row.thread_id, JSON.stringify(String(row.content).slice(0, 45)),
    '| mid=' + String(row.fb_message_id).slice(0, 30),
    '| ad=' + ad, 'story=' + story, 're=' + reOk, 'midOk=' + midOk, 'media=' + row.media_type, mediaOk,
    '=> DELETE=' + wouldDelete);
}
