const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:\\Users\\Admin\\AppData\\Roaming\\autochatbot-fb-crm\\data\\database.db', { readOnly: true });
const threads = db.prepare(`
  SELECT id, contact_name, last_message FROM threads
  WHERE contact_name IN ('Trần Minh', 'Lê Văn Khang')
  ORDER BY last_activity DESC LIMIT 6
`).all();
for (const t of threads) {
  console.log('=== thread', t.id, '|', t.contact_name, '| last_message:', JSON.stringify(String(t.last_message || '').slice(0, 40)));
  const rows = db.prepare(`
    SELECT id, fb_message_id, is_outgoing, content, media_type, media_url, timestamp_ms,
           datetime(timestamp_ms / 1000, 'unixepoch', '+7 hours') AS ts_vn,
           timestamp_source, direction_status, sequence_order, delivery_status, created_at
    FROM messages WHERE thread_id = ?
      AND timestamp_ms > (strftime('%s','now','-90 minutes') * 1000)
    ORDER BY timestamp_ms ASC
  `).all(String(t.id));
  for (const r of rows) {
    console.log(JSON.stringify({
      id: r.id, out: r.is_outgoing, type: r.media_type,
      content: (r.content || '').slice(0, 22),
      url: r.media_url ? String(r.media_url).slice(0, 50) : null,
      ts_vn: r.ts_vn, src: r.timestamp_source, seq: r.sequence_order,
      dlv: r.delivery_status,
      fb_id: String(r.fb_message_id || '').slice(0, 26),
      created_vn: String(r.created_at || '').replace('T', ' ').slice(0, 19)
    }));
  }
}
