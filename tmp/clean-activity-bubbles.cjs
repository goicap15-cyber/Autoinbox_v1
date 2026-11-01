const path = require('path');
const Database = require('better-sqlite3');
const tf = require(path.resolve(process.cwd(), 'src', 'server', 'utils', 'textFilter.js'));
const dataDir = path.join(process.env.APPDATA, 'autochatbot-fb-crm', 'data');
const dbPath = path.join(dataDir, 'database.db');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const backupPath = path.join(dataDir, 'database.db.before-activity-clean-' + stamp + '.db');

async function main() {
  const db = new Database(dbPath);
  db.pragma('busy_timeout = 10000');
  await db.backup(backupPath);
  console.log('Backup OK: ' + backupPath);

  const rows = db.prepare("SELECT id, thread_id, content FROM messages WHERE fb_message_id LIKE 'sidebar_preview_%' AND is_outgoing = 0").all();
  const junk = rows.filter((r) => tf.isSidebarActivityNotification(r.content));
  const ids = junk.map((r) => r.id);
  console.log('Deleting ' + ids.length + ' rows: ' + ids.join(','));

  let msgDel = 0;
  const tx = db.transaction(() => {
    if (!ids.length) return;
    const ph = ids.map(() => '?').join(',');
    db.prepare(`DELETE FROM message_queue WHERE outbound_attempt_id IN (SELECT id FROM outbound_attempts WHERE message_id IN (${ph}))`).run(...ids);
    db.prepare(`DELETE FROM outbound_attempts WHERE message_id IN (${ph})`).run(...ids);
    msgDel = db.prepare(`DELETE FROM messages WHERE id IN (${ph})`).run(...ids).changes;
  });
  tx();
  console.log('Deleted messages: ' + msgDel);
  db.close();
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
