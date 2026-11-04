const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/database.db', { readOnly: true });

const famOf = (v) => String(v || '').replace(/__bubble_\d+$/, '');
const occOf = (v) => { const m = String(v || '').match(/__bubble_(\d+)$/); return m ? Number(m[1]) : null; };

const bubbles = db.prepare("SELECT id, thread_id, fb_message_id FROM messages WHERE fb_message_id LIKE '%__bubble_%'").all();
const famIds = new Map(); // thread|family -> Set(fb_message_id variants)
for (const b of bubbles) {
  const key = `${b.thread_id}|${famOf(b.fb_message_id)}`;
  if (!famIds.has(key)) famIds.set(key, new Set());
  famIds.get(key).add(famOf(b.fb_message_id));
  famIds.get(key).add(b.fb_message_id);
}
console.log('bubble rows:', bubbles.length, '| families:', famIds.size);

const selAll = db.prepare(`SELECT id, thread_id, fb_message_id, content, is_outgoing, media_type, media_url,
  timestamp_ms, timestamp_source, created_at, sequence_order FROM messages WHERE thread_id = ? AND fb_message_id IN (${[...new Array(50)].map(() => '?').join(',')})`);

let textTwinPairs = 0, emojiTwinPairs = 0, noTwin = 0;
const lines = [];
for (const [key, ids] of famIds) {
  const threadId = key.split('|')[0];
  const idArr = [...ids].slice(0, 50);
  const rows = selAll.all(threadId, ...idArr.concat([...new Array(50 - idArr.length)].map(() => '?')));
  for (const m of rows) {
    if (occOf(m.fb_message_id) === null) continue;
    for (const t of rows) {
      if (t.id === m.id) continue;
      if (String(t.content || '') !== String(m.content || '')) continue;
      if (Number(t.is_outgoing) !== Number(m.is_outgoing)) continue;
      const tsDiff = Math.abs(Number(t.timestamp_ms || 0) - Number(m.timestamp_ms || 0));
      if (tsDiff > 2000) continue;
      const gapCreated = Math.abs(new Date(m.created_at) - new Date(t.created_at));
      const rowidGap = Math.abs(m.id - t.id);
      const isText = String(m.content || '').length > 8;
      if (isText) textTwinPairs++; else emojiTwinPairs++;
      lines.push(`[${isText ? 'TEXT' : 'SHORT'}] th=${threadId} ${t.id}(${occOf(t.fb_message_id) ?? 'base'}) vs ${m.id}(${occOf(m.fb_message_id)}) rowidGap=${rowidGap} tsDiff=${tsDiff} createdGapMs=${gapCreated} createdT=${t.created_at} createdM=${m.created_at} seq=${t.sequence_order}/${m.sequence_order} src=${m.timestamp_source} c="${String(m.content || '').substring(0, 34)}"`);
    }
  }
  if (!rows.some((r) => occOf(r.fb_message_id) !== null)) noTwin++;
}
for (const l of lines.slice(0, 40)) console.log(l);
console.log(`summary: TEXT twins=${textTwinPairs} SHORT twins=${emojiTwinPairs}`);
