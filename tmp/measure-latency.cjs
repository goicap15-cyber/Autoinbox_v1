const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(process.env.APPDATA + '/autochatbot-fb-crm/data/database.db', { readOnly: true });

const rows = db.prepare(`
  SELECT id, thread_id, substr(content,1,30) AS content, media_type, timestamp_source,
         timestamp_ms, created_at, is_outgoing, fb_message_id, delivery_status
  FROM messages
  WHERE is_outgoing = 0 AND created_at >= '2026-09-30T08:00' AND created_at <= '2026-09-30T12:00'
  ORDER BY created_at
`).all();
console.log('incoming rows 15:00-19:00 local:', rows.length);
const byThread = new Map();
for (const r of rows) {
  const lat = r.timestamp_ms ? (Date.parse(r.created_at + 'Z') - r.timestamp_ms) / 1000 : null;
  const t = byThread.get(r.thread_id) || [];
  t.push({ ...r, lat });
  byThread.set(r.thread_id, t);
}
for (const [th, list] of byThread) {
  console.log('\n== thread ...' + String(th).slice(-8) + ' | msgs=' + list.length);
  for (const r of list.slice(0, 12)) {
    console.log(' ', r.created_at, 'lat=' + (r.lat == null ? '?' : r.lat.toFixed(0) + 's'),
      'ts_src=' + r.timestamp_source, 'media=' + r.media_type, 'fbid=' + (r.fb_message_id || '').slice(-10),
      JSON.stringify(r.content));
  }
}
