const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:\\Users\\Admin\\AppData\\Roaming\\autochatbot-fb-crm\\data\\database.db', { readOnly: true });

console.log('--- sources hôm nay (rows theo timestamp_source, created >= 2026-09-30 09:00 VN):');
const srcs = db.prepare(`
  SELECT timestamp_source src, COUNT(*) n,
         SUM(CASE WHEN media_type IN ('image','video') THEN 1 ELSE 0 END) media_n
  FROM messages
  WHERE created_at >= '2026-09-30 02:00:00'
  GROUP BY timestamp_source ORDER BY n DESC LIMIT 15
`).all();
for (const s of srcs) console.log(JSON.stringify(s));

console.log('--- network_interceptor rows gần nhất:');
const ni = db.prepare(`
  SELECT id, thread_id, content, media_type, datetime(timestamp_ms/1000,'unixepoch','+7 hours') ts_vn, created_at
  FROM messages WHERE timestamp_source = 'facebook_payload' OR fb_message_id LIKE '%mid_%'
  ORDER BY id DESC LIMIT 5
`).all();
for (const r of ni) console.log(JSON.stringify({...r, content: String(r.content||'').slice(0,20)}));

console.log('--- index bảng messages:');
const idx = db.prepare(`PRAGMA index_list(messages)`).all();
for (const i of idx) {
  const cols = db.prepare(`PRAGMA index_info(${i.name})`).all().map(c => c.name).join(',');
  console.log(i.name, 'unique=' + i.unique, 'cols=' + cols);
}

console.log('--- thread trùng theo preview "gửi 1 ảnh/một video":');
const th = db.prepare(`
  SELECT id, contact_name, last_message, datetime(last_activity,'+7 hours') la
  FROM threads
  WHERE last_message LIKE '%gửi 1 ảnh%' OR last_message LIKE '%gửi một video%' OR last_message LIKE '%đã gửi 1 ảnh%'
  ORDER BY last_activity DESC LIMIT 8
`).all();
for (const t of th) console.log(JSON.stringify({...t, last_message: String(t.last_message||'').slice(0,30)}));
