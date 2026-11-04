// Test: migration threads nullable + FK SET NULL + removeAccount detach + re-point
// Chạy trên DB copy (tmp/test-detach.db) bằng node:sqlite.
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

function open(p) {
  const db = new DatabaseSync(p);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 10000');
  return db;
}

const db = open('C:/Users/Admin/Downloads/Duan/CRM_FB1/tmp/test-detach.db');

// ── 1. Migration (giống hệt code trong db.js — app tắt FK khi chạy migration) ──
const before = {
  threads: db.prepare('SELECT COUNT(*) n FROM threads').get().n,
  messages: db.prepare('SELECT COUNT(*) n FROM messages').get().n,
};
db.exec('PRAGMA foreign_keys = OFF');
db.exec('PRAGMA legacy_alter_table = ON');
db.exec(`
  ALTER TABLE threads RENAME TO threads_old_account_id;
  CREATE TABLE threads (
    id TEXT PRIMARY KEY,
    external_thread_id TEXT,
    account_id TEXT,
    source_id TEXT,
    thread_url TEXT,
    contact_name TEXT,
    last_message TEXT,
    last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_unread BOOLEAN DEFAULT 1,
    status TEXT CHECK(status IN ('UNPROCESSED', 'ASSIGNED', 'COMPLETED')) DEFAULT 'UNPROCESSED',
    assigned_user_id INTEGER,
    ai_paused_until DATETIME,
    sync_status TEXT DEFAULT 'LOCAL',
    sync_cursor TEXT,
    sync_error TEXT,
    archived_at DATETIME,
    inbox_folder TEXT CHECK(inbox_folder IN ('INBOX', 'MESSAGE_REQUEST_SPAM', 'MESSAGE_REQUEST_POSSIBLE')) DEFAULT 'INBOX',
    unread_manual INTEGER NOT NULL DEFAULT 0,
    pinned INTEGER NOT NULL DEFAULT 0,
    last_seen_message_id TEXT,
    history_completed INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE SET NULL,
    FOREIGN KEY(assigned_user_id) REFERENCES users(id) ON DELETE SET NULL
  );
  INSERT INTO threads (id, external_thread_id, account_id, source_id, thread_url, contact_name,
    last_message, last_activity, is_unread, status, assigned_user_id, ai_paused_until,
    sync_status, sync_cursor, sync_error, archived_at, inbox_folder, unread_manual, pinned,
    last_seen_message_id, history_completed)
  SELECT id, external_thread_id, account_id, source_id, thread_url, contact_name,
    last_message, last_activity, is_unread, status, assigned_user_id, ai_paused_until,
    sync_status, sync_cursor, sync_error, archived_at, inbox_folder, unread_manual, pinned,
    last_seen_message_id, history_completed
  FROM threads_old_account_id;
  DROP TABLE threads_old_account_id;
  CREATE INDEX idx_threads_account ON threads(account_id);
  CREATE INDEX idx_threads_assigned ON threads(assigned_user_id);
  CREATE INDEX idx_threads_source_id ON threads(source_id);
  CREATE UNIQUE INDEX idx_threads_source_external ON threads(source_id, external_thread_id)
    WHERE source_id IS NOT NULL AND external_thread_id IS NOT NULL;
  CREATE INDEX idx_threads_account_external_lookup ON threads(account_id, external_thread_id);
`);
db.exec('PRAGMA legacy_alter_table = OFF');
db.exec('PRAGMA foreign_keys = ON');
const after = {
  threads: db.prepare('SELECT COUNT(*) n FROM threads').get().n,
  messages: db.prepare('SELECT COUNT(*) n FROM messages').get().n,
};
console.log('1. migration rows:', JSON.stringify(before), '->', JSON.stringify(after), before.threads === after.threads && before.messages === after.messages ? 'OK' : 'FAIL');

// FK của bảng con còn trỏ đúng bảng threads mới không (xóa thread → messages cascade)?
const testThread = db.prepare('SELECT t.id FROM threads t WHERE EXISTS (SELECT 1 FROM messages m WHERE m.thread_id = t.id) LIMIT 1').get();
if (testThread) {
  const msgBefore = db.prepare('SELECT COUNT(*) n FROM messages').get().n;
  const childMsgs = db.prepare('SELECT COUNT(*) n FROM messages WHERE thread_id = ?').get(testThread.id).n;
  db.prepare('DELETE FROM threads WHERE id = ?').run(testThread.id);
  const msgAfter = db.prepare('SELECT COUNT(*) n FROM messages').get().n;
  console.log('2. child FK cascade (xóa thread xóa messages):', msgAfter === msgBefore - childMsgs && childMsgs > 0 ? 'OK' : 'FAIL (childMsgs=' + childMsgs + ')');
} else {
  console.log('2. SKIP (không có thread để test cascade)');
}

// FK mới: xóa account → thread SET NULL (không xóa)
const accId = 'acc_test_detach_999';
db.prepare("INSERT OR REPLACE INTO accounts (id, name, profile_dir, status) VALUES (?, 'TestDetach', 'x', 'ACTIVE')").run(accId);
const srcId = 'src_page_test999';
db.prepare("INSERT OR REPLACE INTO inbox_sources (id, source_type, owner_account_id, external_id, display_name, status) VALUES (?, 'page_messenger', ?, '999999', 'Page Test', 'ACTIVE')").run(srcId, accId);
db.prepare("INSERT OR REPLACE INTO threads (id, account_id, source_id, external_thread_id, contact_name) VALUES ('t_page_1', ?, ?, 'ext1', 'Khach 1')").run(accId, srcId);
db.prepare("INSERT OR REPLACE INTO threads (id, account_id, source_id, external_thread_id, contact_name) VALUES ('t_personal_1', ?, NULL, 'ext2', 'Khach ca nhan')").run(accId);
db.prepare("INSERT INTO messages (thread_id, fb_message_id, sender_id, content, created_at) VALUES ('t_page_1', 'm_page_1', 'sender1', 'tin page', CURRENT_TIMESTAMP)").run();
db.prepare("INSERT INTO messages (thread_id, fb_message_id, sender_id, content, created_at) VALUES ('t_personal_1', 'm_pers_1', 'sender1', 'tin personal', CURRENT_TIMESTAMP)").run();

// ── 3. Mô phỏng removeAccount khi là account CUỐI CÙNG (else branch) ──
// Xóa mọi account khác trên bản COPY để ép đúng nhánh else.
db.prepare("DELETE FROM accounts WHERE id != ?").run(accId);
const otherAccount = db.prepare('SELECT id FROM accounts WHERE id != ? LIMIT 1').get(accId);
console.log('3. otherAccount khi xóa acc test:', otherAccount ? otherAccount.id : 'KHÔNG có (else branch)');
if (!otherAccount) {
  db.prepare("UPDATE inbox_sources SET owner_account_id = NULL WHERE owner_account_id = ? AND source_type = 'page_messenger'").run(accId);
  db.prepare("UPDATE threads SET account_id = NULL WHERE account_id = ? AND source_id LIKE 'src_page_%'").run(accId);
  db.prepare("DELETE FROM threads WHERE account_id = ? AND (source_id IS NULL OR source_id LIKE 'src_personal_%')").run(accId);
  db.prepare("DELETE FROM inbox_sources WHERE source_type = 'personal_messenger' AND external_id = ?").run(accId);
  db.prepare('DELETE FROM accounts WHERE id = ?').run(accId);
  const pageT = db.prepare("SELECT account_id FROM threads WHERE id = 't_page_1'").get();
  const persT = db.prepare("SELECT id FROM threads WHERE id = 't_personal_1'").get();
  const pageMsg = db.prepare("SELECT COUNT(*) n FROM messages WHERE thread_id = 't_page_1'").get().n;
  console.log('   page thread còn + account_id NULL:', pageT && pageT.account_id === null ? 'OK' : 'FAIL ' + JSON.stringify(pageT));
  console.log('   personal thread đã xóa (hành vi cũ):', !persT ? 'OK' : 'FAIL');
  console.log('   message của page thread còn nguyên:', pageMsg === 1 ? 'OK' : 'FAIL n=' + pageMsg);

  // ── 4. Mô phỏng REGISTER_ACCOUNT đăng nhập lại + auto-bind discovery ──
  db.prepare("INSERT OR REPLACE INTO accounts (id, name, profile_dir, status) VALUES (?, 'TestDetach2', 'x', 'ACTIVE')").run(accId);
  db.prepare("UPDATE inbox_sources SET owner_account_id = ? WHERE id = ?").run(accId, srcId);
  const reattached = db.prepare(`
    UPDATE threads SET account_id = ?
    WHERE account_id IS NULL AND source_id IN (SELECT id FROM inbox_sources WHERE owner_account_id = ?)
  `).run(accId, accId).changes;
  const pageT2 = db.prepare("SELECT account_id FROM threads WHERE id = 't_page_1'").get();
  console.log('4. re-point khi account đăng nhập lại:', reattached === 1 && pageT2.account_id === accId ? 'OK' : 'FAIL ' + JSON.stringify(pageT2));
}

// ── 5. FK SET NULL tự động khi xóa account có page thread (đường an toàn thứ 2) ──
db.prepare("INSERT OR REPLACE INTO accounts (id, name, profile_dir, status) VALUES ('acc_fknull', 'FkNull', 'x', 'ACTIVE')").run();
db.prepare("INSERT OR REPLACE INTO threads (id, account_id, source_id) VALUES ('t_fknull', 'acc_fknull', 'src_page_test999')").run();
db.prepare("DELETE FROM accounts WHERE id = 'acc_fknull'").run();
const fkT = db.prepare("SELECT account_id FROM threads WHERE id = 't_fknull'").get();
console.log('5. FK ON DELETE SET NULL tự động:', fkT && fkT.account_id === null ? 'OK' : 'FAIL ' + JSON.stringify(fkT));

// ── 6. Insert thread với account_id NULL không còn bị NOT NULL chặn ──
db.prepare("INSERT OR REPLACE INTO threads (id, account_id, source_id) VALUES ('t_null_ok', NULL, 'src_page_test999')").run();
console.log('6. insert account_id NULL: OK');

const fkCheck = db.prepare('PRAGMA foreign_key_check').all();
console.log('7. foreign_key_check sau migration:', fkCheck.length === 0 ? 'OK' : JSON.stringify(fkCheck.slice(0, 5)));
const integrity = db.prepare('PRAGMA integrity_check').get();
console.log('8. integrity_check:', JSON.stringify(integrity));
db.close();
