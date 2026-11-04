// Ky ts_source + sequence_order cac row loi de tim nguyen nhan
const { DatabaseSync } = require('node:sqlite');
const DB = 'C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/database.db';
const db = new DatabaseSync(DB, { readOnly: true });
const rows = db.prepare(`
  SELECT rowid, fb_message_id, content, is_outgoing, sequence_order, timestamp_source,
         datetime(timestamp_ms/1000, 'unixepoch', '+7 hours') AS ts_local, timestamp_ms
  FROM messages WHERE thread_id = '1411372724455599'
  ORDER BY timestamp_ms ASC, rowid ASC`).all();
for (const r of rows) {
  const c = String(r.content || '').replace(/\s+/g, ' ').slice(0, 30);
  console.log(`${r.ts_local} | out=${r.is_outgoing} seq=${r.sequence_order} src=${r.timestamp_source} | "${c}" | ${String(r.fb_message_id).slice(0, 66)}`);
}
