const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/database.db', { readOnly: true });
const rows = db.prepare(`SELECT id, fb_message_id, client_message_id, is_outgoing, timestamp_ms, timestamp_source, created_at FROM messages
  WHERE thread_id = '9238637582883360' AND content LIKE '%Netflix ko h%' ORDER BY id`).all();
for (const r of rows) console.log(JSON.stringify({
  id: r.id, fbid: String(r.fb_message_id||'').slice(0,44), cmid: r.client_message_id, out: r.is_outgoing,
  ts: r.timestamp_ms ? new Date(Number(r.timestamp_ms)).toISOString() : null,
  tsrc: r.timestamp_source, at: r.created_at
}));
db.close();
