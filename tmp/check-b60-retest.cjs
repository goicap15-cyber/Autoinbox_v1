const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/database.db', { readOnly: true });
const rows = db.prepare(`
  SELECT id, thread_id, content, is_outgoing, delivery_status, fb_message_id, client_message_id,
         timestamp_source, datetime(created_at) AS ca, timestamp_ms
  FROM messages
  WHERE datetime(created_at) >= datetime('now', '-40 minutes')
  ORDER BY id DESC LIMIT 40
`).all();
console.log('--- messages last 40min (newest first) ---');
for (const r of rows) {
  console.log(JSON.stringify({
    id: r.id, thread: String(r.thread_id), out: r.is_outgoing, st: r.delivery_status,
    content: String(r.content || '').substring(0, 20),
    fbid: String(r.fb_message_id || '').substring(0, 40),
    cmid: String(r.client_message_id || '').substring(0, 30),
    tsrc: r.timestamp_source, ca: r.ca, ts: r.timestamp_ms
  }));
}
const threads = db.prepare(`
  SELECT id, thread_key, contact_name, datetime(last_activity) AS la, is_unread
  FROM threads WHERE datetime(last_activity) >= datetime('now', '-40 minutes') LIMIT 10
`).all();
console.log('--- threads active last 40min ---');
for (const t of threads) console.log(JSON.stringify({ id: String(t.id), key: String(t.thread_key || '').substring(0, 40), name: t.contact_name, la: t.la }));
db.close();
