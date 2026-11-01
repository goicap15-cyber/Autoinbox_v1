const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/database.db', { readOnly: true });

const fam = db.prepare(`
  SELECT id, thread_id, fb_message_id, content, is_outgoing, media_type, media_url,
         timestamp_ms, timestamp_source, created_at, sequence_order
  FROM messages
  WHERE fb_message_id LIKE '%__bubble_%'
  ORDER BY thread_id, id
`).all();

const familyOf = (v) => String(v).replace(/__bubble_\d+$/, '');
const occOf = (v) => { const m = String(v).match(/__bubble_(\d+)$/); return m ? Number(m[1]) : null; };

// group by thread+family
const families = new Map();
for (const r of fam) {
  const key = `${r.thread_id}|${familyOf(r.fb_message_id)}`;
  if (!families.has(key)) families.set(key, []);
  families.get(key).push(r);
}

console.log('total __bubble_ rows:', fam.length, '| families:', families.size);

let phantomCandidatePairs = 0, genuineEmoji = 0, diffContent = 0;
for (const [key, rows] of families) {
  for (const m of rows) {
    if (occOf(m.fb_message_id) === null) continue;
    // twin: same family, same content, same direction, ts<=2000
    const twins = rows.filter((t) => t.id !== m.id
      && String(t.content || '') === String(m.content || '')
      && Number(t.is_outgoing) === Number(m.is_outgoing)
      && Math.abs(Number(t.timestamp_ms || 0) - Number(m.timestamp_ms || 0)) <= 2000);
    if (!twins.length) { diffContent++; continue; }
    for (const t of twins) {
      const gapCreated = Math.abs(new Date(m.created_at) - new Date(t.created_at));
      const isEmojiish = String(m.content || '').length <= 8;
      if (isEmojiish) genuineEmoji++; else phantomCandidatePairs++;
      if (phantomCandidatePairs <= 25 || (isEmojiish && genuineEmoji <= 8)) {
        console.log(`[${isEmojiish ? 'EMOJI?' : 'TEXT'}] t${key.split('|')[0]} ids ${t.id}(${t.fb_message_id.substring(0,44)}) vs ${m.id}(${m.fb_message_id.substring(0,44)}) rowidGap=${m.id - t.id} tsDiff=${Math.abs(Number(t.timestamp_ms||0)-Number(m.timestamp_ms||0))} createdGapMs=${gapCreated} seq ${t.sequence_order}/${m.sequence_order} src=${m.timestamp_source} content=${String(m.content||'').substring(0,40)}`);
      }
    }
  }
}
console.log('summary: identicalTextTwins(TEXT)=', phantomCandidatePairs, 'identicalEmojiTwins(<=8char)=', genuineEmoji, 'diffContentOcc=', diffContent);

// mẫu like-group thật: family có nhiều occ, content giống, created_at gap nhỏ
console.log('\n--- sample families with 3+ occurrences ---');
let shown = 0;
for (const [key, rows] of families) {
  if (rows.length < 3 || shown >= 6) continue;
  shown++;
  console.log(`family ${key} n=${rows.length}:`);
  for (const r of rows) console.log(`   id=${r.id} occ=${occOf(r.fb_message_id)} ts=${r.timestamp_ms} created=${r.created_at} out=${r.is_outgoing} content=${String(r.content||'').substring(0,30)}`);
}
