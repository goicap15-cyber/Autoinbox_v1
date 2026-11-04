const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/database.db', { readOnly: true });

// Sau 09:10Z (khi build fix chạy): cặp trùng content+direction+ts<=2000, KHÁC family
const rows = db.prepare(`
  SELECT id, thread_id, fb_message_id, content, is_outgoing, media_type, timestamp_ms, created_at
  FROM messages WHERE created_at >= '2026-10-08T09:10:00.000Z'
  ORDER BY thread_id, timestamp_ms, id
`).all();
console.log('rows sau 09:10Z:', rows.length);
const famOf = (v) => String(v || '').replace(/__bubble_\d+$/, '');
let dups = 0;
for (let i = 0; i < rows.length; i++) {
  for (let j = i + 1; j < rows.length; j++) {
    const a = rows[i], b = rows[j];
    if (a.thread_id !== b.thread_id) break;
    if (String(a.content || '') !== String(b.content || '') || !String(a.content || '').trim()) continue;
    if (Number(a.is_outgoing) !== Number(b.is_outgoing)) continue;
    if (Math.abs(Number(a.timestamp_ms || 0) - Number(b.timestamp_ms || 0)) > 2000) continue;
    if (famOf(a.fb_message_id) === famOf(b.fb_message_id)) continue;
    // loại cặp pending_client ↔ mid thật (đường gửi CRM, preview...) - chỉ quan tâm 2 Incoming DOM
    if (String(a.fb_message_id).startsWith('pending_client') || String(b.fb_message_id).startsWith('pending_client')) continue;
    if (String(a.fb_message_id).startsWith('sidebar_preview_') || String(b.fb_message_id).startsWith('sidebar_preview_')) continue;
    dups++;
    console.log(`[DUP?] th=${a.thread_id} A id=${a.id} ${String(a.fb_message_id).substring(0, 48)} | B id=${b.id} ${String(b.fb_message_id).substring(0, 48)} c="${String(a.content || '').substring(0, 24)}" created ${a.created_at} / ${b.created_at}`);
  }
}
if (!dups) console.log('KHONG co cap dup khac-family sau 09:10Z');
