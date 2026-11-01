const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/database.db', { readOnly: true });
const rows = db.prepare(`
  SELECT id, thread_id, fb_message_id, client_message_id, content, is_outgoing, direction_status, sender_role,
         datetime(timestamp_ms/1000, 'unixepoch') AS ts_utc, rowid
  FROM messages
  WHERE thread_id IN ('100066325187762','100004449999465')
    AND timestamp_ms > 1780942800000
  ORDER BY thread_id, timestamp_ms, rowid
`).all();
for (const r of rows) {
  console.log([r.thread_id, r.id, String(r.fb_message_id || '').substring(0, 40), r.client_message_id || '-', r.is_outgoing ? 'OUT' : 'IN', r.direction_status || '', r.sender_role || '', r.ts_utc, JSON.stringify(String(r.content || '').substring(0, 30))].join(' | '));
}
console.log('total', rows.length);
