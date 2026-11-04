process.env.CRM_DATA_ROOT = 'C:/Users/Admin/Downloads/Duan/CRM_FB1/tmp/repro/data';
const Database = require('C:/Users/Admin/Downloads/Duan/CRM_FB1/node_modules/better-sqlite3');
const db = new Database('C:/Users/Admin/Downloads/Duan/CRM_FB1/tmp/repro/data/database.db');

const lead = db.prepare('SELECT id, author_uid, post_url, status FROM comment_leads ORDER BY id ASC LIMIT 1').get();
console.log('lead:', JSON.stringify(lead));

try {
  const stmt = db.prepare(`
        UPDATE comment_leads
        SET status = 'queued', account_id = ?, thread_id = ?, queue_id = ?,
            message_content = ?, queued_at = CURRENT_TIMESTAMP, error = NULL
        WHERE id = ?
      `);
  console.log('placeholders:', stmt.reader ? 'n/a' : '');
  console.log('expected bind count via probe run with 5 args...');
  stmt.run('acc', 'thread', 'queue', 'msg', lead.id);
  console.log('UPDATE_OK');
} catch (e) {
  console.log('UPDATE_ERR:', e.message);
}

// Roll the test update back so the snapshot stays clean
db.prepare("UPDATE comment_leads SET status = 'new', account_id = NULL, thread_id = NULL, queue_id = NULL, message_content = NULL WHERE id = ?").run(lead.id);
console.log('rolled back');
