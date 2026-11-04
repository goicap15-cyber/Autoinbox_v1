const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/database.db', { readOnly: true });
const rows = db.prepare(`SELECT id, fb_message_id, client_message_id, content, is_outgoing, delivery_status, timestamp_ms, created_at, sequence_order FROM messages WHERE thread_id='61586667541379' AND created_at >= '2026-10-09T04:55:00' AND created_at <= '2026-10-09T05:10:00' ORDER BY created_at`).all();
console.log('=== thread rows 04:55-05:10 UTC ===');
for (const r of rows) console.log(r.created_at, JSON.stringify({id:r.id, mid:r.fb_message_id, cmid:r.client_message_id, c:r.content, out:r.is_outgoing, st:r.delivery_status, seq:r.sequence_order}));
console.log('=== any rows (all threads) with UE6U9 or UE6lgG ===');
for (const mid of ['%UE6U9%','%UE6lgG%']) {
  const rr = db.prepare(`SELECT id, thread_id, fb_message_id, content, is_outgoing, delivery_status, created_at FROM messages WHERE fb_message_id LIKE ?`).all(mid);
  for (const r of rr) console.log(mid, JSON.stringify(r));
}
db.close();
