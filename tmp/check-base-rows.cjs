const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/database.db', { readOnly: true });

for (const tid of ['100066325187762', '61586667541379']) {
  console.log('=== THREAD ' + tid + ' ===');
  const rows = db.prepare(`
    SELECT id, fb_message_id, client_message_id, content, is_outgoing, media_type,
           timestamp_ms, created_at
    FROM messages WHERE thread_id = ? AND timestamp_ms >= ?
    ORDER BY timestamp_ms ASC, id ASC
  `).all(tid, Date.now() - 8 * 3600 * 1000);
  for (const r of rows) {
    const ts = new Date(r.timestamp_ms).toISOString();
    const dir = r.is_outgoing ? 'OUT' : 'IN ';
    console.log(`#${r.id} ${ts} ${dir} fb=${String(r.fb_message_id || '').slice(0, 52)} cmid=${String(r.client_message_id || '').slice(0, 24)} mt=${r.media_type || '-'} :: ${String(r.content || '').slice(0, 36).replace(/\n/g, ' ')}`);
  }
}

console.log('=== base id check ===');
for (const fid of ['7513891264800662133', 'mid.$cAABi91rGyeqnTBZ62mhGtEuHWqJ1', '7513885326986092796']) {
  const r = db.prepare('SELECT id, thread_id, content, is_outgoing, timestamp_ms FROM messages WHERE fb_message_id = ?').all(fid);
  console.log(fid.slice(0, 40), '->', r.length ? JSON.stringify(r) : 'KHONG CO (mat)');
}
db.close();
