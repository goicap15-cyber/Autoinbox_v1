const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/database.db', { readOnly: true });

const rows = db.prepare(`
  SELECT id, thread_id, fb_message_id, content, is_outgoing, media_type, timestamp_ms, created_at, timestamp_source, direction_status
  FROM messages
  WHERE thread_id IN ('100066325187762', '61586667541379')
    AND timestamp_ms >= ?
  ORDER BY created_at ASC, id ASC
`).all(Date.now() - 8 * 3600 * 1000);

console.log('Sap theo created_at (insert time):');
for (const r of rows) {
  const ts = new Date(r.timestamp_ms).toISOString();
  const ca = new Date(r.created_at).toISOString();
  const dir = r.is_outgoing ? 'OUT' : 'IN ';
  console.log(`#${r.id} ins=${ca} ts=${ts} ${dir} th=${r.thread_id} src=${r.timestamp_source || '-'} fb=${String(r.fb_message_id || '').slice(0, 46)} :: ${String(r.content || '').slice(0, 28).replace(/\n/g, ' ')}`);
}
db.close();
