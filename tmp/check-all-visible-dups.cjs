const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/database.db', { readOnly: true });

// Mọi cặp INCOMING text trùng content + ts<=2000 trong 48h, khác id (kể cả preview)
const rows = db.prepare(`
  SELECT id, thread_id, fb_message_id, content, is_outgoing, media_type, timestamp_ms, created_at
  FROM messages
  WHERE created_at >= ? AND is_outgoing = 0
    AND (media_type IS NULL OR media_type = 'text')
    AND TRIM(COALESCE(content, '')) != ''
  ORDER BY thread_id, timestamp_ms, id
`).all(new Date(Date.now() - 48 * 3600 * 1000).toISOString());
console.log('incoming text rows 48h:', rows.length);

const famOf = (v) => String(v || '').replace(/__bubble_\d+$/, '');
const seen = new Set();
let pairs = 0;
for (let i = 0; i < rows.length; i++) {
  for (let j = i + 1; j < rows.length; j++) {
    const a = rows[i], b = rows[j];
    if (a.thread_id !== b.thread_id) break;
    if (String(a.content) !== String(b.content)) continue;
    if (Math.abs(Number(a.timestamp_ms || 0) - Number(b.timestamp_ms || 0)) > 2000) continue;
    if (a.id === b.id) continue;
    const key = [a.id, b.id].sort().join('-');
    if (seen.has(key)) continue;
    seen.add(key);
    pairs++;
    const kind = (id) => {
      const v = String(id);
      if (v.startsWith('sidebar_preview_')) return 'PREVIEW';
      if (v.startsWith('pending_client')) return 'PENDING';
      if (/__bubble_\d+$/.test(v)) return 'BUBBLE_N';
      if (v.startsWith('dom_')) return 'DOM';
      if (v.startsWith('mid.')) return 'MID';
      return 'NUMERIC';
    };
    console.log(`th=${String(a.thread_id).substring(0, 16)} [${kind(a.fb_message_id)} id=${a.id}] + [${kind(b.fb_message_id)} id=${b.id}] ts=${a.timestamp_ms} created=${a.created_at}/${b.created_at} c="${String(a.content).substring(0, 26)}"`);
  }
}
console.log('tổng cặp:', pairs);
