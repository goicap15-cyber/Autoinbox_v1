// Kiem tra live test b58: thread 61586667541379 - 5 alo OUT (1@11:23 + 4@12:00) va ben trai
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/database.db', { readOnly: true });

const T = '61586667541379';
const t = (s) => {
  const n = Number(s);
  if (!n) return String(s || '');
  const d = new Date(n < 1e12 ? n * 1000 : n);
  // hien gio Viet Nam
  return new Date(d.getTime() + 7 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
};

const rows = db.prepare(`
  SELECT id, fb_message_id, is_outgoing, sender_role, direction_status, content,
         media_type, timestamp_ms, created_at, sequence_order, sent_by_agent
  FROM messages WHERE thread_id = ?
  ORDER BY COALESCE(sequence_order, id) ASC
`).all(T);

console.log(`Tong so row thread ${T}: ${rows.length}`);
console.log('--- toan bo row (thu tu sequence) ---');
for (const r of rows) {
  const txt = String(r.content || '').replace(/\n/g, ' ').slice(0, 40);
  const fam = /\d{15,19}__bubble_\d+$/.test(String(r.fb_message_id || '')) ? ' [OTID-BUBBLE]'
    : /__bubble_\d+$/.test(String(r.fb_message_id || '')) ? ' [BUBBLE]'
    : /__bubble_\d+::/.test(String(r.fb_message_id || '')) ? ' [MIRROR-BUBBLE]'
    : String(r.fb_message_id || '').includes('::') ? ' [MIRROR]'
    : '';
  console.log(`  seq=${String(r.sequence_order).padEnd(4)} id=${String(r.id).padEnd(5)} ${r.is_outgoing ? 'OUT' : 'IN '} ${r.direction_status.padEnd(9)} ts=${t(r.timestamp_ms)} cr=${t(r.created_at)} ${r.media_type !== 'text' ? '[' + r.media_type + '] ' : ''}"${txt}"${fam} mid=${String(r.fb_message_id || '').slice(0, 46)}`);
}

const cutoff = Date.now() - 3 * 3600 * 1000;
const recent = rows.filter(r => Number(r.timestamp_ms || 0) > cutoff || Number(r.created_at || 0) > cutoff);
const outAlo = recent.filter(r => Number(r.is_outgoing) === 1 && /^alo$/i.test(String(r.content || '').trim()));
const inAlo = recent.filter(r => Number(r.is_outgoing) === 0 && /^alo$/i.test(String(r.content || '').trim()));
const outAloBubble = outAlo.filter(r => /__bubble_\d+/.test(String(r.fb_message_id || '')));
const inAloBubble = inAlo.filter(r => /__bubble_\d+/.test(String(r.fb_message_id || '')));
console.log('--- 3h gan nhat ---');
console.log(`OUT "alo": ${outAlo.length} (trong do __bubble: ${outAloBubble.length})`);
console.log(`IN  "alo": ${inAlo.length} (trong do __bubble: ${inAloBubble.length})`);
db.close();
