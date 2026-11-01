const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/database.db', { readOnly: true });
const rows = db.prepare(`
  SELECT id, thread_id, fb_message_id, client_message_id, content, is_outgoing, sender_role,
         datetime(timestamp_ms/1000, 'unixepoch') AS ts_utc, rowid
  FROM messages
  WHERE timestamp_ms > 1780953000000
  ORDER BY timestamp_ms, rowid
`).all();
for (const r of rows) {
  console.log([r.ts_utc, r.thread_id, r.id, (r.is_outgoing ? 'OUT' : 'IN'), String(r.fb_message_id || '').substring(0, 44), JSON.stringify(String(r.content || '').substring(0, 24))].join(' | '));
}
console.log('total', rows.length);
