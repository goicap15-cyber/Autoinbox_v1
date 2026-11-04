const Database = require('better-sqlite3');
const db = new Database(process.env.APPDATA + '/autochatbot-fb-crm/data/database.db', { readonly: true, fileMustExist: true });

console.log('--- TẤT CẢ message_queue hôm nay ---');
for (const r of db.prepare("SELECT id, status, account_id, source_type, idempotency_key, error_reason, created_at, processed_at FROM message_queue WHERE created_at >= '2026-10-13' ORDER BY created_at").all()) {
  console.log(JSON.stringify(r));
}

console.log('--- messages rows cho queue comment leads (client_message_id) ---');
for (const r of db.prepare("SELECT id, thread_id, status, client_message_id, substr(error_reason,1,50) err, created_at FROM messages WHERE client_message_id LIKE 'comment_lead_%' ORDER BY created_at DESC LIMIT 16").all()) {
  console.log(JSON.stringify(r));
}
db.close();
