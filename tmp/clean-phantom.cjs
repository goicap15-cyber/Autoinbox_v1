const path = require('path');
const Database = require('better-sqlite3');
const dataDir = path.join(process.env.APPDATA, 'autochatbot-fb-crm', 'data');
const dbPath = path.join(dataDir, 'database.db');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const backupPath = path.join(dataDir, 'database.db.before-phantom-clean-' + stamp + '.db');

const TraLoi = /^trả\s*lời\s*\??$/i;
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

async function main() {
  const db = new Database(dbPath);
  db.pragma('busy_timeout = 10000');

  await db.backup(backupPath);
  console.log('Backup OK: ' + backupPath);

  const all = db.prepare(`
    SELECT m.id, m.thread_id, t.contact_name, m.content
    FROM messages m LEFT JOIN threads t ON t.id = m.thread_id
    WHERE m.fb_message_id LIKE 'sidebar_preview_%'
  `).all();
  const cand = all.filter((r) => {
    const c = String(r.content || '').trim();
    const n = norm(r.contact_name);
    if (!c) return true;
    return TraLoi.test(c) || (n && norm(c) === n);
  });
  const ids = cand.map((r) => r.id);
  const contentByThread = new Map();
  for (const r of cand) {
    if (!contentByThread.has(r.thread_id)) contentByThread.set(r.thread_id, []);
    contentByThread.get(r.thread_id).push(norm(r.content));
  }
  console.log('Deleting ' + ids.length + ' rows across ' + contentByThread.size + ' threads');

  const hasQueue = !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='message_queue'").get();
  const hasAttempts = !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='outbound_attempts'").get();
  const ph = ids.map(() => '?').join(',');

  let queueDel = 0, attemptDel = 0, msgDel = 0, threadFixed = 0;

  const tx = db.transaction(() => {
    if (hasQueue && hasAttempts) {
      queueDel = db.prepare(`DELETE FROM message_queue WHERE outbound_attempt_id IN (SELECT id FROM outbound_attempts WHERE message_id IN (${ph}))`).run(...ids).changes;
    }
    if (hasAttempts) {
      attemptDel = db.prepare(`DELETE FROM outbound_attempts WHERE message_id IN (${ph})`).run(...ids).changes;
    }
    msgDel = db.prepare(`DELETE FROM messages WHERE id IN (${ph})`).run(...ids).changes;

    for (const [tid, junkContents] of contentByThread) {
      const t = db.prepare('SELECT id, last_message, last_seen_message_id FROM threads WHERE id = ?').get(tid);
      if (!t) continue;
      let changed = false;
      const cur = norm(t.last_message);
      if (cur && (TraLoi.test(String(t.last_message || '').trim()) || junkContents.includes(cur))) {
        const latest = db.prepare(`
          SELECT content, media_type FROM messages
          WHERE thread_id = ? AND fb_message_id NOT LIKE 'sidebar_preview_%'
          ORDER BY timestamp_ms DESC, id DESC LIMIT 1
        `).get(tid);
        const nextContent = latest ? String(latest.content || '').trim() : '';
        db.prepare('UPDATE threads SET last_message = ? WHERE id = ?').run(nextContent, tid);
        changed = true;
      }
      if (t.last_seen_message_id && /^sidebar_preview_/.test(String(t.last_seen_message_id))) {
        db.prepare('UPDATE threads SET last_seen_message_id = NULL WHERE id = ?').run(tid);
        changed = true;
      }
      if (changed) threadFixed += 1;
    }
  });
  tx();

  console.log(`Deleted: messages=${msgDel}, message_queue=${queueDel}, outbound_attempts=${attemptDel}, threads_fixed=${threadFixed}`);
  const left = db.prepare(`SELECT COUNT(*) AS n FROM messages WHERE fb_message_id LIKE 'sidebar_preview_%'`).get().n;
  console.log('Remaining sidebar_preview_ rows (real pending previews): ' + left);
  db.close();
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
