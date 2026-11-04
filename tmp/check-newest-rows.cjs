const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/database.db', { readOnly: true });
const rows = db.prepare('SELECT id, thread_id, fb_message_id, content, is_outgoing, media_type, timestamp_ms, created_at FROM messages WHERE id > 542516 ORDER BY id').all();
console.log('rows moi nhat:', rows.length);
for (const r of rows) {
  console.log(`th=${String(r.thread_id).substring(0, 14)} id=${r.id} ${String(r.fb_message_id).substring(0, 44)} out=${r.is_outgoing} mt=${r.media_type} c=${JSON.stringify(String(r.content || '').substring(0, 22))} created=${r.created_at}`);
}
