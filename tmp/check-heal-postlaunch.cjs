// Post-launch check: heal 2c-ter should have deleted the 5 numeric out=0 phantoms
const { DatabaseSync } = require('node:sqlite');
const DB = 'C:\\Users\\Admin\\AppData\\Roaming\\autochatbot-fb-crm\\data\\database.db';
const db = new DatabaseSync(DB, { readOnly: true });
const rows = db.prepare(`
  SELECT id, fb_message_id, is_outgoing, content FROM messages
  WHERE (media_type IS NULL OR media_type = 'text') AND media_url IS NULL
    AND fb_message_id LIKE '%__bubble_%'
    AND (fb_message_id GLOB '[0-9]*' AND instr(fb_message_id, '@') = 0
      AND instr(fb_message_id, 'mid.') = 0)
  ORDER BY id
`).all();
const out0 = rows.filter((r) => r.is_outgoing !== 1);
const out1 = rows.filter((r) => r.is_outgoing === 1);
console.log(`numeric-family bubble rows remaining: out=1: ${out1.length} (legit, kept), out=0 (phantoms): ${out0.length}`);
for (const r of out0) console.log('  STILL THERE:', r.id, r.fb_message_id);
for (const r of out1) console.log('  kept out=1:', r.id, r.fb_message_id);
db.close();
