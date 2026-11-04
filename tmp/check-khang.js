const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:\\Users\\Admin\\AppData\\Roaming\\autochatbot-fb-crm\\data\\database.db', { readOnly: true });
const threads = db.prepare(`
  SELECT id, contact_name FROM threads
  WHERE contact_name LIKE '%Khang%' OR contact_name LIKE '%L%V%n Khang%'
  ORDER BY last_activity DESC LIMIT 5
`).all();
console.log('threads:', JSON.stringify(threads));
for (const t of threads) {
  const rows = db.prepare(`
    SELECT id, fb_message_id, is_outgoing, content, timestamp_ms,
           datetime(timestamp_ms / 1000, 'unixepoch', '+7 hours') AS ts_vn,
           timestamp_source, direction_status, sequence_order, created_at
    FROM messages WHERE thread_id = ?
    ORDER BY timestamp_ms ASC LIMIT 30
  `).all(String(t.id));
  console.log('=== thread', t.id, t.contact_name, 'rows:', rows.length);
  for (const r of rows) {
    console.log(JSON.stringify({
      id: r.id, out: r.is_outgoing, content: (r.content || '').slice(0, 25),
      ts_vn: r.ts_vn, src: r.timestamp_source, dir: r.direction_status, seq: r.sequence_order,
      fb_id: String(r.fb_message_id || '').slice(0, 30)
    }));
  }
}
