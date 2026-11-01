const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/database.db', { readOnly: true });
const mids = ['THntomhGzSmWPvEy', 'THn5MmhGzSyGRQTG', 'THn_tWhGzS4hh-kQ'];
for (const frag of mids) {
  const rows = db.prepare(`SELECT id, thread_id, fb_message_id, is_outgoing, sender_role, datetime(timestamp_ms/1000,'unixepoch') ts, content FROM messages WHERE fb_message_id LIKE ?`).all('%' + frag + '%');
  console.log('===', frag, '->', rows.length, 'rows');
  for (const r of rows) console.log('  ', r.id, r.thread_id, r.is_outgoing ? 'OUT' : 'IN', r.fb_message_id, r.ts, JSON.stringify(String(r.content || '').substring(0, 20)));
}
const recent = db.prepare(`SELECT id, thread_id, fb_message_id, is_outgoing, datetime(timestamp_ms/1000,'unixepoch') ts, content, rowid FROM messages WHERE timestamp_ms > 1780954200000 ORDER BY rowid DESC LIMIT 15`).all();
console.log('=== recent since 11:10Z (desc) ===');
for (const r of recent) console.log([r.ts, r.thread_id, r.id, (r.is_outgoing ? 'OUT' : 'IN'), String(r.fb_message_id || '').substring(0, 46), JSON.stringify(String(r.content || '').substring(0, 20))].join(' | '));
