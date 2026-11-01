// Verify hypothesis: pure-numeric fb_message_id (otid) rows are ALWAYS
// self-outgoing. Any out=0 numeric row = flipped phantom.
const { DatabaseSync } = require('node:sqlite');
const DB = 'C:\\Users\\Admin\\AppData\\Roaming\\autochatbot-fb-crm\\data\\database.db';
const db = new DatabaseSync(DB, { readOnly: true });

// numeric family = starts with 10-19 digits, optionally followed by __bubble_N,
// and NOT starting with mid./id./m_
const rows = db.prepare(`
  SELECT id, thread_id, fb_message_id, is_outgoing, content, timestamp_ms, timestamp_source, created_at
  FROM messages
  WHERE fb_message_id GLOB '[0-9]*'
    AND fb_message_id NOT LIKE 'mid.%'
    AND fb_message_id NOT LIKE 'id.%'
    AND fb_message_id NOT LIKE 'm\\_%' ESCAPE '\\'
  ORDER BY id DESC LIMIT 200
`).all();
console.log('=== numeric-family rows:', rows.length, '===');
let out1 = 0, out0 = 0;
for (const r of rows) {
  if (r.is_outgoing === 1) out1++; else out0++;
  if (r.is_outgoing !== 1) {
    const t = new Date(Number(r.timestamp_ms));
    console.log(`OUT=0! id=${r.id} mid=${r.fb_message_id} ts=${t.toISOString()} thread=${r.thread_id} content=${JSON.stringify(String(r.content||'').slice(0,30))} src=${r.timestamp_source} created=${r.created_at}`);
  }
}
console.log(`out=1: ${out1}, out=0: ${out0}`);

// also check otid snowflake decode: top 41 bits (>>22) vs message ts
console.log('\n=== otid snowflake check (id >> 22 vs timestamp_ms) ===');
for (const r of rows.slice(0, 12)) {
  const numeric = String(r.fb_message_id).split('__')[0];
  if (!/^\d{15,19}$/.test(numeric)) continue;
  try {
    const snow = BigInt(numeric) >> 22n;
    const snowMs = Number(snow);
    const ts = Number(r.timestamp_ms);
    console.log(`mid=${numeric} decoded=${new Date(snowMs).toISOString()} rowTs=${new Date(ts).toISOString()} delta=${Math.round((ts - snowMs) / 1000)}s out=${r.is_outgoing}`);
  } catch (e) { console.log('decode fail', numeric); }
}
db.close();
