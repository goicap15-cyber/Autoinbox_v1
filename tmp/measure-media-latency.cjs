const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:\\Users\\Admin\\AppData\\Roaming\\autochatbot-fb-crm\\data\\database.db', { readOnly: true });
const rows = db.prepare(`
  SELECT thread_id, fb_message_id, media_type, is_outgoing, timestamp_ms, created_at, timestamp_source, substr(content,1,40) AS content
  FROM messages
  WHERE is_outgoing = 0 AND media_type IN ('image','video') AND timestamp_ms > ?
  ORDER BY created_at DESC LIMIT 30
`).all(Date.now() - 6 * 60 * 60 * 1000);
for (const r of rows) {
  const lat = r.created_at && r.timestamp_ms ? (Date.parse(r.created_at.endsWith('Z') ? r.created_at : r.created_at + 'Z') - r.timestamp_ms) / 1000 : null;
  console.log(r.created_at, '|', r.media_type, '|', r.timestamp_source, '| lat_s=' + (lat == null ? 'NaN' : lat.toFixed(0)), '|', r.thread_id.substring(0, 18), '|', r.fb_message_id.substring(0, 30));
}
if (!rows.length) console.log('NO_MEDIA_ROWS_6H');
// So sánh: tin chữ khách 6h gần nhất
const txt = db.prepare(`
  SELECT COUNT(*) AS n, AVG((julianday(CASE WHEN created_at LIKE '%Z' THEN created_at ELSE created_at || 'Z' END) * 86400000 - timestamp_ms) / 1000.0) AS avg_lat_s
  FROM messages WHERE is_outgoing = 0 AND (media_type IS NULL OR media_type = 'text') AND timestamp_ms > ?
`).get(Date.now() - 6 * 60 * 60 * 1000);
console.log('TEXT_ROWS', JSON.stringify(txt));
