const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/database.db', { readOnly: true });
for (const tid of ['100042109689531', '100027059479429', '100014687614734']) {
  const rows = db.prepare(`
    SELECT id, fb_message_id, content, is_outgoing,
           datetime(timestamp_ms/1000, 'unixepoch') AS ts_utc, rowid
    FROM messages WHERE thread_id = ? ORDER BY timestamp_ms DESC, rowid DESC LIMIT 8
  `).all(tid);
  console.log('=== thread', tid, 'latest rows (desc) ===');
  for (const r of rows) {
    console.log([r.id, (r.is_outgoing ? 'OUT' : 'IN'), String(r.fb_message_id || '').substring(0, 50), r.ts_utc, JSON.stringify(String(r.content || '').substring(0, 30))].join(' | '));
  }
}
