const path = require('path');
const Database = require('better-sqlite3');
const dbPath = path.join(process.env.APPDATA, 'autochatbot-fb-crm', 'data', 'database.db');
const db = new Database(dbPath, { readonly: true });
db.pragma('busy_timeout = 5000');

const threadsCols = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='threads'").get();
console.log('THREADS SCHEMA:\n' + threadsCols.sql);

const TraLoi = /^trả\s*lời\s*\??$/i;
const all = db.prepare(`
  SELECT m.id, m.thread_id, t.contact_name, m.content, m.delivery_status, m.timestamp_ms
  FROM messages m LEFT JOIN threads t ON t.id = m.thread_id
  WHERE m.fb_message_id LIKE 'sidebar_preview_%'
`).all();
console.log('\nTotal sidebar_preview_ rows: ' + all.length);

const cand = all.filter((r) => {
  const c = String(r.content || '').trim();
  const n = String(r.contact_name || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!c) return true;
  const ck = c.toLowerCase().replace(/\s+/g, ' ').trim();
  return TraLoi.test(c) || (n && ck === n);
});
console.log('\nCandidates (' + cand.length + '):');
for (const r of cand) {
  console.log(`  id=${r.id} thread=${r.thread_id} name="${r.contact_name}" content="${String(r.content || '').slice(0, 60)}" status=${r.delivery_status}`);
}
db.close();
