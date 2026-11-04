const Database = require('C:/Users/Admin/Downloads/Duan/CRM_FB1/node_modules/better-sqlite3');
const db = new Database(process.env.APPDATA + '/autochatbot-fb-crm/data/database.db', { readonly: true });

function resolveReplyTargetRow(threadId, replyToText, beforeTsMs = null) {
  const text = String(replyToText || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!text || !threadId) return null;
  const base = `
    SELECT m.id, m.is_outgoing, m.sender_name, t.contact_name
    FROM messages m JOIN threads t ON t.id = m.thread_id
    WHERE m.thread_id = ? AND TRIM(REPLACE(REPLACE(m.content, char(10), ' '), char(13), ' ')) = ?`;
  const ts = Number.isFinite(Number(beforeTsMs)) && Number(beforeTsMs) > 0 ? Number(beforeTsMs) : null;
  let row = db.prepare(`${base} AND m.timestamp_ms <= ? ORDER BY m.timestamp_ms DESC, m.id DESC LIMIT 1`)
    .get(threadId, text, ts ?? Number.MAX_SAFE_INTEGER);
  if (!row && ts != null) {
    row = db.prepare(`${base} ORDER BY ABS(m.timestamp_ms - ?) ASC LIMIT 1`).get(threadId, text, ts);
  }
  if (!row) row = db.prepare(`${base} ORDER BY m.timestamp_ms DESC, m.id DESC LIMIT 1`).get(threadId, text);
  if (!row) return null;
  return {
    id: Number(row.id),
    name: Number(row.is_outgoing) === 1
      ? 'Bạn'
      : (String(row.sender_name || '').trim() || String(row.contact_name || '').trim() || null)
  };
}

const rows = db.prepare(`
  SELECT id, thread_id, reply_to_text, timestamp_ms, sender_name FROM messages
  WHERE reply_to_text IS NOT NULL AND TRIM(reply_to_text) != ''
  ORDER BY id DESC LIMIT 12
`).all();
for (const r of rows) {
  const t = resolveReplyTargetRow(r.thread_id, r.reply_to_text, r.timestamp_ms);
  console.log(`reply#${r.id} (${r.sender_name}) quote=${JSON.stringify(String(r.reply_to_text).slice(0, 30))}`
    + ' => ' + (t ? `gốc#${t.id} tên="${t.name}"` : 'KHÔNG TÌM THẤY'));
}
console.log('--- lookahead: quote dùng cho tin 1-1 (contact_name) ---');
const one = db.prepare(`
  SELECT id, thread_id, reply_to_text, timestamp_ms FROM messages
  WHERE reply_to_text IS NOT NULL AND TRIM(reply_to_text) != '' AND thread_id IN (SELECT id FROM threads WHERE source_type = 'page_messenger' OR contact_name IS NOT NULL)
  ORDER BY id DESC LIMIT 3
`).all();
for (const r of one) {
  const t = resolveReplyTargetRow(r.thread_id, r.reply_to_text, r.timestamp_ms);
  console.log(`reply#${r.id} quote=${JSON.stringify(String(r.reply_to_text).slice(0, 30))} => ${t ? `gốc#${t.id} tên="${t.name}"` : 'KHÔNG TÌM THẤY'}`);
}
