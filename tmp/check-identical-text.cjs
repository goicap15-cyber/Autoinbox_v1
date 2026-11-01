const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/database.db', { readOnly: true });

// Tin khách gần đây (6h), tìm các cặp LIÊN TIẾP cùng nội dung để xem id pattern
const rows = db.prepare(`
  SELECT id, thread_id, fb_message_id, content, is_outgoing, media_type, timestamp_ms, timestamp_source, created_at
  FROM messages
  WHERE created_at >= ? ORDER BY thread_id, timestamp_ms, id
`).all(new Date(Date.now() - 6 * 3600 * 1000).toISOString());

console.log('rows 6h:', rows.length);
const famOf = (v) => String(v || '').replace(/__bubble_\d+$/, '');

// gộp theo thread, tìm consecutive same-content incoming pairs
let pairs = 0;
for (let i = 1; i < rows.length; i++) {
  const a = rows[i - 1], b = rows[i];
  if (a.thread_id !== b.thread_id) continue;
  if (Number(b.is_outgoing) === 1) continue;
  if (String(a.content || '') !== String(b.content || '') || !String(b.content || '').trim()) continue;
  if ((b.media_type && b.media_type !== 'text')) continue;
  pairs++;
  const tsDiff = Number(b.timestamp_ms || 0) - Number(a.timestamp_ms || 0);
  console.log(`\n[PAIR] th=${b.thread_id} tsDiff=${tsDiff}ms`);
  console.log(`  A id=${a.id} ${a.fb_message_id} out=${a.is_outgoing} src=${a.timestamp_source} ts=${a.timestamp_ms} c="${String(a.content || '').substring(0, 30)}"`);
  console.log(`  B id=${b.id} ${b.fb_message_id} out=${b.is_outgoing} src=${b.timestamp_source} ts=${b.timestamp_ms} c="${String(b.content || '').substring(0, 30)}"`);
  console.log(`  family A=${famOf(a.fb_message_id).substring(0, 50)} family B=${famOf(b.fb_message_id).substring(0, 50)} sameFamily=${famOf(a.fb_message_id) === famOf(b.fb_message_id)}`);
}
if (!pairs) console.log('khong co cap tin lien tiep cung noi dung trong 6h');
