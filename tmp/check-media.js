const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/database.db', { readOnly: true });
console.log('=== media mọi thread 40 phút gần nhất ===');
const rows = db.prepare(`
  SELECT id, thread_id, is_outgoing, media_type,
    CASE WHEN media_url IS NULL THEN 'NULL'
         WHEN media_url LIKE 'http%' THEN 'http'
         WHEN media_url LIKE 'data:%' THEN 'data' ELSE substr(media_url,1,25) END AS url_kind,
    timestamp_source, created_at
  FROM messages
  WHERE media_type != 'text' AND created_at >= datetime('now', '-40 minutes')
  ORDER BY id DESC LIMIT 40
`).all();
for (const r of rows.reverse()) {
  console.log(`#${r.id} ${r.created_at} ${r.is_outgoing ? 'OUT' : 'IN '} ${r.media_type} url=${r.url_kind} src=${r.timestamp_source} thr=${String(r.thread_id).substring(0, 28)}`);
}
console.log('=== video INCOMING hôm nay (24h) ===');
const vids = db.prepare(`
  SELECT id, thread_id, media_type,
    CASE WHEN media_url IS NULL THEN 'NULL'
         WHEN media_url LIKE 'http%' THEN 'http:' || length(media_url)
         WHEN media_url LIKE 'data:%' THEN 'data:' || length(media_url) ELSE substr(media_url,1,25) END AS url_kind,
    timestamp_source, created_at, substr(replace(content, char(10), ' '), 1, 30) AS content
  FROM messages
  WHERE media_type = 'video' AND created_at >= datetime('now', '-24 hours')
  ORDER BY id DESC LIMIT 15
`).all();
for (const v of vids) {
  console.log(`#${v.id} ${v.created_at} ${v.is_outgoing ? 'OUT' : 'IN '} url=${v.url_kind} src=${v.timestamp_source} thr=${String(v.thread_id).substring(0, 24)} "${v.content}"`);
}
