const Database = require('C:/Users/Admin/Downloads/Duan/CRM_FB1/node_modules/better-sqlite3');
const SNAP = 'C:/Users/Admin/AppData/Local/Temp/crm-mig-test.db';

const live = new Database('C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/database.db', { readonly: true });
live.exec("VACUUM INTO 'C:/Users/Admin/AppData/Local/Temp/crm-mig-test.db'");
live.close();

const db = new Database(SNAP);
db.pragma('foreign_keys = ON');

const leads = db.prepare(`
  SELECT id, thread_id, status, queue_id FROM comment_leads
  WHERE status IN ('failed', 'queued') AND thread_id IS NOT NULL
`).all();
let demoted = 0, removed = 0;
for (const lead of leads) {
  const tid = String(lead.thread_id);
  const incoming = db.prepare('SELECT 1 FROM messages WHERE thread_id = ? AND is_outgoing = 0 LIMIT 1').get(tid);
  if (incoming) {
    db.prepare("UPDATE comment_leads SET thread_id = NULL WHERE id = ? AND status = 'failed'").run(lead.id);
    continue;
  }
  if (lead.status === 'queued') {
    db.prepare("UPDATE threads SET inbox_folder = 'MESSAGE_REQUEST_POSSIBLE', pinned = 0, pinned_at = NULL WHERE id = ?").run(tid);
    db.prepare('UPDATE comment_leads SET thread_id = NULL WHERE id = ?').run(lead.id);
    demoted += 1;
    continue;
  }
  if (lead.queue_id) {
    db.prepare("DELETE FROM messages WHERE thread_id = ? AND client_message_id = ? AND delivery_status = 'pending'").run(tid, `queue_${lead.queue_id}`);
  }
  const remaining = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE thread_id = ?').get(tid);
  if (Number(remaining?.n) > 0) {
    db.prepare('UPDATE comment_leads SET thread_id = NULL WHERE id = ?').run(lead.id);
    continue;
  }
  db.prepare('DELETE FROM contacts WHERE thread_id = ?').run(tid);
  db.prepare('DELETE FROM threads WHERE id = ?').run(tid);
  db.prepare('UPDATE comment_leads SET thread_id = NULL WHERE id = ?').run(lead.id);
  removed += 1;
}
console.log(`demoted=${demoted} removed=${removed}`);

const check = db.prepare(`
  SELECT cl.id, cl.author_name, cl.status, cl.thread_id AS lead_tid,
         t.id AS thread_exists, t.inbox_folder, t.pinned,
         (SELECT COUNT(*) FROM messages m WHERE m.thread_id = COALESCE(cl.thread_id, ?)) AS msgs_on_uid
  FROM comment_leads cl
  LEFT JOIN threads t ON t.id = COALESCE(cl.thread_id, cl.author_uid)
  WHERE cl.status IN ('failed','queued','sent')
  ORDER BY cl.id
`).all('X');
for (const r of check) console.log(JSON.stringify(r));

const orphan = db.prepare(`
  SELECT COUNT(*) AS n FROM messages m LEFT JOIN threads t ON t.id = m.thread_id WHERE t.id IS NULL
`).get();
console.log('orphan_messages=' + orphan.n);
const fts = db.prepare('SELECT COUNT(*) AS n FROM messages_fts').get();
const msgTotal = db.prepare('SELECT COUNT(*) AS n FROM messages').get();
console.log(`fts=${fts.n} messages=${msgTotal.n}`);
db.close();
