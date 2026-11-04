// Xóa 12 lead kẹt (new/queued) khỏi comment_leads + bỏ ghim thread liên quan.
// Người dùng yêu cầu rõ ràng ("xóa 12 khách này đi") — đây là xác nhận ghi DB.
const Database = require('better-sqlite3');
const db = new Database(process.env.APPDATA + '/autochatbot-fb-crm/data/database.db', { fileMustExist: true });

const run = db.transaction(() => {
  const victims = db.prepare("SELECT id, author_name, thread_id FROM comment_leads WHERE status IN ('new','queued')").all();
  console.log('Se xoa', victims.length, 'lead:');
  for (const v of victims) console.log(' -', v.id, v.author_name, 'thread:', v.thread_id || '(none)');

  const threadIds = [...new Set(victims.map((v) => v.thread_id).filter(Boolean))];
  const del = db.prepare("DELETE FROM comment_leads WHERE status IN ('new','queued')").run();
  console.log('Deleted rows:', del.changes);

  // Bỏ ghim thread của lead bị xóa (thread của lead 19-23 đã biến mất trước đó)
  let unpinned = 0;
  for (const tid of threadIds) {
    unpinned += db.prepare('UPDATE threads SET pinned = 0 WHERE id = ? AND pinned = 1').run(tid).changes;
  }
  console.log('Unpinned threads:', unpinned);
  return victims.length;
});
const n = run();
console.log('DONE, total deleted =', n);
db.close();
