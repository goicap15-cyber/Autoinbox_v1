const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:\\Users\\Admin\\AppData\\Roaming\\autochatbot-fb-crm\\data\\database.db', { readOnly: true });
const rows = db.prepare(`
  SELECT thread_id, media_type, is_outgoing, timestamp_ms, created_at, timestamp_source, substr(content,1,30) AS c
  FROM messages
  WHERE media_type IN ('image','video') AND created_at > '2026-10-01T03:15'
  ORDER BY created_at DESC LIMIT 20
`).all();
console.log('MEDIA_ROWS_AFTER_0315:', rows.length);
for (const r of rows) console.log(r.created_at, r.media_type, r.is_outgoing ? 'OUT' : 'IN ', r.thread_id.substring(0, 18), r.c);
const unread = db.prepare(`
  SELECT id, contact_name, is_unread, unread_manual, last_activity, last_message FROM threads
  WHERE id IN ('100066325187762','100034206860298')
`).all();
for (const t of unread) console.log('THREAD', t.id, 'unread=' + t.is_unread, 'manual=' + t.unread_manual, 'act=' + t.last_activity, '|', String(t.last_message).substring(0, 30));
