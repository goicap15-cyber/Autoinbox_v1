const Database = require('C:/Users/Admin/Downloads/Duan/CRM_FB1/node_modules/better-sqlite3');
const db = new Database('C:/Users/Admin/AppData/Local/Temp/crm-mig-test.db');
db.pragma('foreign_keys = ON');

// Mô phỏng chu kỳ với lead FAKE uid 999999999 (không đụng dữ liệu thật)
const uid = '999999999';
const ACC = '100016772407913';
db.prepare(`DELETE FROM comment_leads WHERE author_uid=?`).run(uid);
db.prepare(`DELETE FROM threads WHERE id=?`).run(uid);
db.prepare(`INSERT INTO comment_leads (post_url, author_uid, author_name, status, account_id) VALUES ('https://x-cycle-test', ?, 'Test Lead', 'new', ?)`).run(uid, ACC);

// --- enqueue (logíc mới): upsertThread MESSAGE_REQUEST_POSSIBLE + queue + message pending + lead.thread_id=NULL
const thread = db.prepare(`
  SELECT id FROM threads WHERE id = ?
`).get(uid); // không có sẵn
const insThread = db.prepare(`
  INSERT INTO threads (id, external_thread_id, account_id, thread_url, contact_name, last_message, is_unread, inbox_folder)
  VALUES (?, ?, ?, ?, 'Test Lead', 'Chao {ten}', 0, 'MESSAGE_REQUEST_POSSIBLE')
`);
if (!thread) insThread.run(uid, uid, ACC, 'https://www.facebook.com/messages/t/' + uid);
const q = db.prepare(`
  INSERT INTO message_queue (id, thread_id, account_id, source_type, content, status, idempotency_key)
  VALUES ('q-test-1', ?, ?, 'personal_messenger', 'Chao Test Lead', 'pending', 'comment_lead_999')
`).run(uid, ACC);
db.prepare(`
  INSERT INTO messages (thread_id, fb_message_id, client_message_id, sender_id, content, is_outgoing, delivery_status)
  VALUES (?, 'pending_queue_q-test-1', 'queue_q-test-1', 'SYSTEM', 'Chao Test Lead', 1, 'pending')
`).run(uid);
db.prepare(`UPDATE comment_leads SET status='queued', thread_id=NULL, queue_id='q-test-1' WHERE author_uid=?`).run(uid);
console.log('after enqueue:', JSON.stringify(db.prepare('SELECT id, inbox_folder, pinned FROM threads WHERE id=?').get(uid)));

// --- gửi FAIL: lead failed + gỡ thread (removeLeadThreadIfEmpty)
db.prepare(`UPDATE comment_leads SET status='failed', thread_id=NULL WHERE author_uid=?`).run(uid);
db.prepare(`DELETE FROM messages WHERE thread_id=? AND client_message_id='queue_q-test-1' AND delivery_status='pending'`).run(uid);
db.prepare(`DELETE FROM contacts WHERE thread_id=?`).run(uid);
db.prepare(`DELETE FROM threads WHERE id=?`).run(uid);
console.log('after fail: thread exists =', !!db.prepare('SELECT 1 FROM threads WHERE id=?').get(uid));

// --- re-enqueue rồi gửi THÀNH CÔNG: thread tái tạo ở WAITING → markQueueSent đẩy INBOX + pin
insThread.run(uid, uid, ACC, 'https://www.facebook.com/messages/t/' + uid);
db.prepare(`UPDATE comment_leads SET status='queued' WHERE author_uid=?`).run(uid);
// upsertThread markQueueSent (UPDATE path với inbox_folder='INBOX')
db.prepare(`
  UPDATE threads SET
    contact_name = 'Test Lead',
    last_message = COALESCE('Chao Test Lead', last_message),
    is_unread = COALESCE(0, is_unread),
    inbox_folder = CASE
      WHEN inbox_folder = 'INBOX' AND 'INBOX' IN ('MESSAGE_REQUEST_SPAM','MESSAGE_REQUEST_POSSIBLE') AND 0 = 0 THEN inbox_folder
      ELSE COALESCE('INBOX', inbox_folder)
    END
  WHERE id = ?
`).run(uid);
db.prepare(`UPDATE threads SET pinned = 1, pinned_at = CASE WHEN pinned = 1 THEN pinned_at ELSE strftime('%Y-%m-%d %H:%M:%f','now') END WHERE id=?`).run(uid);
db.prepare(`UPDATE comment_leads SET status='sent', thread_id=? WHERE author_uid=?`).run(uid, uid);
console.log('after sent:', JSON.stringify(db.prepare('SELECT id, inbox_folder, pinned, pinned_at IS NOT NULL AS has_pa FROM threads WHERE id=?').get(uid)));

// --- dọn lead fake
db.prepare(`DELETE FROM comment_leads WHERE author_uid=?`).run(uid);
db.prepare(`DELETE FROM message_queue WHERE id='q-test-1'`).run(uid);
db.prepare(`DELETE FROM messages WHERE thread_id=?`).run(uid);
db.prepare(`DELETE FROM threads WHERE id=?`).run(uid);
console.log('cleaned');
db.close();
