process.env.CRM_DATA_ROOT = 'C:/Users/Admin/Downloads/Duan/CRM_FB1/tmp/repro/data';
const Database = require('C:/Users/Admin/Downloads/Duan/CRM_FB1/node_modules/better-sqlite3');
const db = new Database('C:/Users/Admin/Downloads/Duan/CRM_FB1/tmp/repro/data/database.db');
const lead = db.prepare('SELECT id FROM comment_leads ORDER BY id ASC LIMIT 1').get();
const stmt = db.prepare(`
        UPDATE comment_leads
        SET status = 'queued', account_id = ?, thread_id = ?, queue_id = ?,
            message_content = ?, queued_at = CURRENT_TIMESTAMP, error = NULL
        WHERE id = ?
      `);
try {
  stmt.run('acc', 'thread', { queueId: 'queue-obj', clientMessageId: 'x', messageId: 1 }, 'msg', lead.id);
  console.log('OBJ_BIND_OK');
} catch (e) {
  console.log('OBJ_BIND_ERR:', e.constructor.name, '-', e.message);
}
