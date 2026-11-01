// Sim heal 2c-ter on VACUUM INTO copy: expect exactly the 5 numeric out=0
// phantoms deleted, everything else untouched.
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const SRC = 'C:\\Users\\Admin\\AppData\\Roaming\\autochatbot-fb-crm\\data\\database.db';
const OUT = 'C:\\Users\\Admin\\Downloads\\Duan\\CRM_FB1\\tmp\\sim-heal-2c-ter.db';
try { fs.unlinkSync(OUT); } catch (_) {}
const src = new DatabaseSync(SRC, { readOnly: true });
src.exec(`VACUUM INTO '${OUT}'`);
src.close();
const db = new DatabaseSync(OUT);
const before = db.prepare(`
  SELECT id, thread_id, fb_message_id, is_outgoing, content
  FROM messages
  WHERE (media_type IS NULL OR media_type = 'text') AND media_url IS NULL
    AND fb_message_id LIKE '%__bubble_%'
  ORDER BY id
`).all();

let deleted = [];
for (const m of before) {
  if (!/__bubble_\d+$/.test(String(m.fb_message_id || ''))) continue;
  const familyId = String(m.fb_message_id).replace(/__bubble_\d+$/, '');
  if (Number(m.is_outgoing) === 0 && /^\d{15,19}$/.test(familyId)) {
    deleted.push(m);
  }
}
console.log(`2c-ter will delete ${deleted.length} rows:`);
for (const d of deleted) {
  console.log(`  DEL id=${d.id} mid=${d.fb_message_id} out=${d.is_outgoing} content=${JSON.stringify(String(d.content || '').slice(0, 20))} thread=${d.thread_id}`);
}

// sanity: everything else must survive
const keepers = before.filter((m) => !deleted.some((d) => d.id === m.id));
console.log(`\nKeepers (${keepers.length}):`);
for (const k of keepers) {
  console.log(`  KEEP id=${k.id} mid=${String(k.fb_message_id).slice(0, 50)} out=${k.is_outgoing} content=${JSON.stringify(String(k.content || '').slice(0, 20))}`);
}
db.close();
