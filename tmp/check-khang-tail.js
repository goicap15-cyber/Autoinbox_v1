const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:\\Users\\Admin\\AppData\\Roaming\\autochatbot-fb-crm\\data\\database.db', { readOnly: true });
const rows = db.prepare(`
  SELECT id, fb_message_id, is_outgoing, content, timestamp_ms,
         datetime(timestamp_ms / 1000, 'unixepoch', '+7 hours') AS ts_vn,
         timestamp_source, direction_status, sequence_order, created_at
  FROM messages WHERE thread_id = '100066325187762'
  ORDER BY timestamp_ms DESC LIMIT 15
`).all().reverse();
for (const r of rows) {
  console.log(JSON.stringify({
    id: r.id, out: r.is_outgoing, content: (r.content || '').slice(0, 25),
    ts_vn: r.ts_vn, src: r.timestamp_source, dir: r.direction_status, seq: r.sequence_order,
    created_vn: (r.created_at || '').replace('T', ' ').slice(0, 19),
    fb_id: String(r.fb_message_id || '').slice(0, 34)
  }));
}
