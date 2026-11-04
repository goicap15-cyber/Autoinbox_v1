// Tim 3 tin alo con lai: all threads, 90p gan nhat, + family UE5vv + mirror
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/database.db', { readOnly: true });
const t = (s) => {
  const n = Number(s);
  if (!n) return String(s || '');
  const d = new Date(n < 1e12 ? n * 1000 : n);
  return new Date(d.getTime() + 7 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
};
const iso = (ms) => new Date(ms).toISOString();
const cutoff = Date.now() - 90 * 60 * 1000;

console.log('--- moi row alo-like 90p gan nhat (moi thread) ---');
const rows = db.prepare(`
  SELECT id, thread_id, fb_message_id, is_outgoing, content, timestamp_ms, created_at
  FROM messages
  WHERE (created_at > ? OR timestamp_ms > ?)
    AND lower(replace(replace(replace(content, char(13), ''), char(10), ''), ' ', '')) IN ('alo','aloo','lo')
  ORDER BY created_at ASC
`).all(iso(cutoff), cutoff);
for (const r of rows) {
  console.log(`  ${t(r.created_at)} ${r.is_outgoing ? 'OUT' : 'IN '} th=${r.thread_id} id=${r.id} "${r.content}" mid=${String(r.fb_message_id || '').slice(0, 55)}`);
}

console.log('--- family UE5vv (base cua row lat chieu seq=114) ---');
const fam = db.prepare(`SELECT id, thread_id, fb_message_id, is_outgoing, content, created_at FROM messages WHERE fb_message_id LIKE '%UE5vv%'`).all();
for (const r of fam) console.log(`  ${t(r.created_at)} ${r.is_outgoing ? 'OUT' : 'IN '} th=${r.thread_id} id=${r.id} "${r.content}" mid=${r.fb_message_id}`);

console.log('--- moi row 25 phut gan nhat, moi thread ---');
const recent = db.prepare(`SELECT id, thread_id, fb_message_id, is_outgoing, content, media_type, created_at FROM messages WHERE created_at > ? ORDER BY created_at ASC`).all(iso(Date.now() - 25 * 60 * 1000));
for (const r of recent) {
  console.log(`  ${t(r.created_at)} ${r.is_outgoing ? 'OUT' : 'IN '} th=${r.thread_id} ${r.media_type !== 'text' ? '[' + r.media_type + ']' : ''} "${String(r.content || '').slice(0, 30)}" mid=${String(r.fb_message_id || '').slice(0, 50)}`);
}
db.close();
