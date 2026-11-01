const Database = require('better-sqlite3');
const db = new Database(process.env.APPDATA + '/autochatbot-fb-crm/data/database.db', { readonly: true, fileMustExist: true });

console.log('--- comment_leads 19-23 queue_id ---');
for (const r of db.prepare("SELECT id, author_name, status, account_id, queue_id, thread_id FROM comment_leads WHERE id >= 19").all()) {
  console.log(JSON.stringify(r));
}

const qids = db.prepare("SELECT queue_id FROM comment_leads WHERE id >= 19 AND queue_id IS NOT NULL").all().map((r) => r.queue_id);
if (qids.length) {
  console.log('--- message_queue theo queue_id cua leads 19+ ---');
  const placeholders = qids.map(() => '?').join(',');
  for (const r of db.prepare(`SELECT id, status, account_id, source_type, idempotency_key, error_reason, created_at, processed_at FROM message_queue WHERE id IN (${placeholders})`).all(...qids)) {
    console.log(JSON.stringify(r));
  }
}
db.close();
