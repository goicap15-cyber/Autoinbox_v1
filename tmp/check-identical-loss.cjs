const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/database.db', { readOnly: true });

const rows = db.prepare(`
  SELECT m.id, m.thread_id, t.contact_name, m.fb_message_id, m.client_message_id,
         m.content, m.is_outgoing, m.sender_role, m.media_type, m.timestamp_ms, m.created_at, m.delivery_status
  FROM messages m JOIN threads t ON t.id = m.thread_id
  WHERE m.timestamp_ms >= ?
  ORDER BY m.timestamp_ms ASC, m.id ASC
`).all(Date.now() - 4 * 3600 * 1000);

console.log('Tong so row 4h qua:', rows.length);
for (const r of rows) {
  const ts = new Date(r.timestamp_ms).toISOString();
  const dir = r.is_outgoing ? 'OUT' : 'IN ';
  console.log(`#${r.id} ${ts} ${dir} th=${r.thread_id} (${r.contact_name}) fb=${String(r.fb_message_id || '').slice(0, 44)} cmid=${String(r.client_message_id || '').slice(0, 20)} mt=${r.media_type || '-'} ds=${r.delivery_status || '-'} :: ${String(r.content || '').slice(0, 40).replace(/\n/g, ' ')}`);
}
db.close();
