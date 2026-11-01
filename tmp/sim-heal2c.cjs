const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');

const live = 'C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/database.db';
const copy = 'C:/Users/Admin/Downloads/Duan/CRM_FB1/tmp/heal2c-sim.db';
try { fs.unlinkSync(copy); } catch (_) {}
try { fs.unlinkSync(copy + '-wal'); } catch (_) {}
try { fs.unlinkSync(copy + '-shm'); } catch (_) {}

const liveDb = new DatabaseSync(live, { readOnly: true });
liveDb.exec(`VACUUM INTO '${copy.replace(/\\/g, '/')}'`);
liveDb.close();

const db = new DatabaseSync(copy);
const before = db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE fb_message_id LIKE '%__bubble_%'`).get();

const bubbleRows = db.prepare(`
  SELECT id, thread_id, fb_message_id, content, is_outgoing, media_type, media_url,
    timestamp_ms FROM messages WHERE fb_message_id LIKE '%__bubble_%'
`).all();
const familyMembers = db.prepare(`
  SELECT id, fb_message_id, content, is_outgoing, media_type, media_url, timestamp_ms
  FROM messages WHERE thread_id = ? AND fb_message_id IN (${[...new Array(50)].map(() => '?').join(',')})
`);
const deletePhantomBubble = db.prepare('DELETE FROM messages WHERE id = ?');
const deleted = [];
for (const m of bubbleRows) {
  if ((m.media_type && m.media_type !== 'text') || m.media_url) continue;
  if (!/__bubble_\d+$/.test(String(m.fb_message_id || ''))) continue;
  const familyId = String(m.fb_message_id).replace(/__bubble_\d+$/, '');
  const members = familyMembers.all(m.thread_id, familyId, m.fb_message_id,
    ...[...new Array(48)].map(() => '?'));
  const sameBubble = (twin) => twin.id !== m.id
    && (!twin.media_type || twin.media_type === 'text') && !twin.media_url
    && String(twin.content || '') === String(m.content || '')
    && Number(twin.is_outgoing) === Number(m.is_outgoing)
    && Math.abs(Number(twin.timestamp_ms || 0) - Number(m.timestamp_ms || 0)) <= 2000;
  const isProtected = members.some((twin) => sameBubble(twin)
    && !/__bubble_\d+$/.test(String(twin.fb_message_id || ''))
    && twin.id < m.id && m.id - twin.id <= 4);
  if (isProtected) continue;
  if (!members.some(sameBubble)) continue;
  deletePhantomBubble.run(m.id);
  deleted.push({ id: m.id, fbid: m.fb_message_id, c: String(m.content || '').substring(0, 30) });
}
const after = db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE fb_message_id LIKE '%__bubble_%'`).get();
console.log('before bubble rows:', before.n, '| deleted:', deleted.length, '| after:', after.n);
for (const d of deleted) console.log('  DEL', d.id, d.fbid.substring(0, 52), `"${d.c}"`);

// Kiểm tra các base vẫn còn + sorry sếp còn nguyên
const keep = db.prepare(`
  SELECT id, fb_message_id, content FROM messages
  WHERE thread_id = '100040996505718' AND fb_message_id LIKE '%__bubble_%'
  ORDER BY id
`).all();
console.log('\nYen remaining bubble rows:');
for (const k of keep) console.log('  KEEP', k.id, k.fb_message_id.substring(0, 52), `"${String(k.content || '').substring(0, 30)}"`);
const sorry = db.prepare(`SELECT id, fb_message_id FROM messages WHERE fb_message_id LIKE 'mid.$cAAAACIW4kh-nDmeHcGg3SI98VW5J%'`).all();
console.log('\nsorry-sep family rows:', sorry.map((r) => `${r.id}:${r.fb_message_id.substring(0, 50)}`));
db.close();
fs.unlinkSync(copy); try { fs.unlinkSync(copy + '-wal'); } catch (_) {} try { fs.unlinkSync(copy + '-shm'); } catch (_) {}
