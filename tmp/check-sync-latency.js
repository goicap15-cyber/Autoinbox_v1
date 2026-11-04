const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/database.db', { readOnly: true });

const th = db.prepare(`SELECT id, contact_name, account_id, last_message, last_activity FROM threads WHERE contact_name LIKE '%Giang%'`).all();
console.log('THREADS:', JSON.stringify(th, null, 0));

const tid = th[0]?.id;
if (tid) {
  console.log('--- recent 20 messages in thread', tid, '---');
  const rows = db.prepare(`SELECT id, fb_message_id, client_message_id, is_outgoing, media_type, content, timestamp_ms, timestamp_source, created_at
    FROM messages WHERE thread_id = ? ORDER BY id DESC LIMIT 20`).all(tid);
  for (const r of rows.reverse()) {
    const ts = Number(r.timestamp_ms) || 0;
    const created = Date.parse(r.created_at) || 0;
    console.log(JSON.stringify({
      id: r.id, out: r.is_outgoing, mt: r.media_type,
      c: String(r.content || '').slice(0, 30),
      fbid: String(r.fb_message_id || '').slice(0, 34),
      tsrc: r.timestamp_source,
      ts: ts ? new Date(ts).toISOString().slice(11, 19) : null,
      at: r.created_at ? r.created_at.slice(11, 19) : null,
      lag_s: ts && created ? Math.round((created - ts) / 1000) : null
    }));
  }
}
db.close();
