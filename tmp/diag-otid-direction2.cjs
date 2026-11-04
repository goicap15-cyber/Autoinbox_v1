// Refined: PURE numeric otid rows only (no @msgr., no mid.) — direction + snowflake decode
const { DatabaseSync } = require('node:sqlite');
const DB = 'C:\\Users\\Admin\\AppData\\Roaming\\autochatbot-fb-crm\\data\\database.db';
const db = new DatabaseSync(DB, { readOnly: true });

const rows = db.prepare(`
  SELECT id, thread_id, fb_message_id, is_outgoing, content, timestamp_ms, timestamp_source, created_at
  FROM messages
  WHERE length(fb_message_id) >= 15
    AND fb_message_id GLOB '[0-9]*'
    AND instr(fb_message_id, '@') = 0
    AND instr(fb_message_id, 'mid.') = 0
    AND instr(fb_message_id, 'id.') = 0
    AND instr(fb_message_id, 'm_') = 0
    AND instr(fb_message_id, 'dom_') = 0
    AND instr(fb_message_id, 'pending_') = 0
    AND instr(fb_message_id, 'sidebar_') = 0
  ORDER BY id DESC LIMIT 300
`).all();
let out1 = [], out0 = [];
for (const r of rows) (r.is_outgoing === 1 ? out1 : out0).push(r);
console.log(`=== PURE numeric rows: ${rows.length} | out=1: ${out1.length} | out=0: ${out0.length} ===`);
console.log('\n--- out=1 (would be legit self-sends observed with otid) ---');
for (const r of out1.slice(0, 20)) {
  console.log(`id=${r.id} mid=${r.fb_message_id} thread=${r.thread_id} content=${JSON.stringify(String(r.content||'').slice(0,25))} created=${r.created_at}`);
}
console.log('\n--- out=0 (phantom flips) ---');
for (const r of out0.slice(0, 30)) {
  console.log(`id=${r.id} mid=${r.fb_message_id} thread=${r.thread_id} content=${JSON.stringify(String(r.content||'').slice(0,25))} created=${r.created_at}`);
}

console.log('\n=== snowflake decode: (id>>22) vs row timestamp ===');
for (const r of [...out1.slice(0, 8), ...out0.slice(0, 8)]) {
  const numeric = String(r.fb_message_id).split('__')[0];
  try {
    const snowMs = Number(BigInt(numeric) >> 22n);
    const ts = Number(r.timestamp_ms);
    console.log(`mid=${numeric} decoded=${new Date(snowMs).toISOString()} rowTs=${new Date(ts).toISOString()} delta=${Math.round((ts - snowMs) / 1000)}s out=${r.is_outgoing}`);
  } catch (e) { console.log('decode fail', numeric, e.message); }
}
db.close();
