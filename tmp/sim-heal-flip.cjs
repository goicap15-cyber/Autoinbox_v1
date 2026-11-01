// Sim heal 2c-bis (lat chieu) + 2c (cung chieu) tren ban copy DB song
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const SRC = 'C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/database.db';
const DST = 'C:/Users/Admin/Downloads/Duan/CRM_FB1/tmp/sim-heal-flip.db';
try { fs.unlinkSync(DST); } catch (_) {}
const src = new DatabaseSync(SRC, { readOnly: true });
src.exec(`VACUUM INTO '${DST.replace(/\\/g, '/')}'`);
src.close();
const db = new DatabaseSync(DST);

const bubbleRows = db.prepare(`
  SELECT id, thread_id, fb_message_id, content, is_outgoing, media_type, media_url, timestamp_ms
  FROM messages WHERE fb_message_id LIKE '%__bubble_%'`).all();
console.log('tong so row __bubble_N:', bubbleRows.length);

const familyBaseStmt = db.prepare(`
  SELECT id, content, is_outgoing, fb_message_id FROM messages
  WHERE thread_id = ? AND (fb_message_id = ? OR fb_message_id LIKE '%.' || ?)
  ORDER BY id DESC LIMIT 1`);
const familyMembers = db.prepare(`
  SELECT id, fb_message_id, content, is_outgoing, media_type, media_url, timestamp_ms
  FROM messages WHERE thread_id = ? AND fb_message_id IN (?, ?, ${[...new Array(48)].map(() => '?').join(',')})`);

const flipDelete = [], staleDelete = [], kept = [];
for (const m of bubbleRows) {
  if ((m.media_type && m.media_type !== 'text') || m.media_url) { kept.push([m, 'media']); continue; }
  if (!/__bubble_\d+$/.test(String(m.fb_message_id || ''))) { kept.push([m, 'no-suffix']); continue; }
  const familyId = String(m.fb_message_id).replace(/__bubble_\d+$/, '');
  const familyBase = familyId.length >= 12 ? familyBaseStmt.get(m.thread_id, familyId, familyId) : null;
  // 2c-bis: lat chieu
  if (familyBase
    && String(familyBase.content || '') === String(m.content || '')
    && Number(familyBase.is_outgoing) !== Number(m.is_outgoing)) {
    flipDelete.push({ m, base: familyBase });
    continue;
  }
  // 2c cu (cung chieu, ts<=2000, bao ve like-group rowid<=4)
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
  if (isProtected) { kept.push([m, 'like-group']); continue; }
  if (!members.some(sameBubble)) { kept.push([m, 'khong-twin']); continue; }
  staleDelete.push({ m });
}

console.log('\n=== 2c-bis XOÁ (lật chiều) ===');
for (const { m, base } of flipDelete) {
  const c = String(m.content || '').replace(/\s+/g, ' ').slice(0, 30);
  console.log(`thread=${m.thread_id} | "${c}" | out=${m.is_outgoing} -> base out=${base.is_outgoing} (${String(base.fb_message_id).slice(0, 50)}) | id=${String(m.fb_message_id).slice(0, 60)}`);
}
console.log('\n=== 2c XOÁ (cùng chiều, tồn từ build trước) ===');
for (const { m } of staleDelete) {
  console.log(`thread=${m.thread_id} | "${String(m.content || '').slice(0, 30)}" | out=${m.is_outgoing} | id=${String(m.fb_message_id).slice(0, 60)}`);
}
console.log('\n=== GIỮ ===');
for (const [m, why] of kept) {
  console.log(`[${why}] thread=${m.thread_id} | "${String(m.content || '').slice(0, 30)}" | out=${m.is_outgoing} | id=${String(m.fb_message_id).slice(0, 60)}`);
}
