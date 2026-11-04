const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/database.db', { readOnly: true });
const threads = ['100042109689531', '100027059479429', '100014687614734'];
const rows = db.prepare(`
  SELECT id, thread_id, fb_message_id, content, is_outgoing,
         datetime(timestamp_ms/1000, 'unixepoch') AS ts_utc, rowid
  FROM messages
  WHERE thread_id IN ('100042109689531','100027059479429','100014687614734')
    AND timestamp_ms > 1780942800000
  ORDER BY thread_id, timestamp_ms, rowid
`).all();
for (const r of rows) {
  console.log([r.thread_id, r.id, (r.is_outgoing ? 'OUT' : 'IN'), String(r.fb_message_id || '').substring(0, 50), r.ts_utc, JSON.stringify(String(r.content || '').substring(0, 30))].join(' | '));
}
console.log('total', rows.length);
