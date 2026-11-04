const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/database.db', { readOnly: true });

const rows = db.prepare(`
  SELECT id, thread_id, fb_message_id, content, is_outgoing, media_type, timestamp_ms, created_at
  FROM messages WHERE fb_message_id LIKE '%__bubble_%'
  ORDER BY id ASC
`).all();

const bySuffix = new Map();
let withBase = 0, withoutBase = 0;
const noBaseSamples = [];
for (const r of rows) {
  const m = String(r.fb_message_id).match(/__bubble_(\d+)$/);
  const sfx = m ? Number(m[1]) : -1;
  bySuffix.set(sfx, (bySuffix.get(sfx) || 0) + 1);
  const base = String(r.fb_message_id).replace(/__bubble_\d+$/, '');
  const baseRow = db.prepare('SELECT id FROM messages WHERE fb_message_id = ?').get(base);
  if (baseRow) withBase++; else {
    withoutBase++;
    if (noBaseSamples.length < 25) noBaseSamples.push(r);
  }
}
console.log('Tong rows __bubble_N:', rows.length);
console.log('Phan bo theo suffix:', JSON.stringify([...bySuffix.entries()].sort((a, b) => a[0] - b[0])));
console.log('Co base:', withBase, '| Khong base:', withoutBase);
console.log('--- Sample 25 row KHONG base (moi nhat cuoi) ---');
for (const r of noBaseSamples) {
  const ts = new Date(r.timestamp_ms).toISOString();
  console.log(`#${r.id} ${ts} ${r.is_outgoing ? 'OUT' : 'IN'} th=${r.thread_id} mt=${r.media_type || '-'} fb=${String(r.fb_message_id).slice(0, 48)} :: ${String(r.content || '').slice(0, 30).replace(/\n/g, ' ')}`);
}
db.close();
