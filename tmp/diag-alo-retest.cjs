// Diagnose: user retested repeated identical texts in Messenger after build 55.
// Where did they die this time?
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DATA = 'C:\\Users\\Admin\\AppData\\Roaming\\autochatbot-fb-crm\\data';
const LOG = path.join(DATA, 'composer-debug.log');
const DB = path.join(DATA, 'database.db');

const nowLocal = new Date();
console.log('NOW local:', nowLocal.toString(), '| UTC:', nowLocal.toISOString());

// --- 1. composer-debug.log tail (UTC timestamps inside) ---
try {
  const raw = fs.readFileSync(LOG, 'utf8');
  const lines = raw.split('\n').filter(Boolean);
  console.log('\n=== composer-debug.log: last 60 lines ===');
  for (const l of lines.slice(-60)) console.log(l);
  console.log('=== total lines:', lines.length, '===');
} catch (e) {
  console.log('LOG ERROR:', e.message);
}

// --- 2. live DB readOnly: recent rows ---
try {
  const db = new DatabaseSync(DB, { readOnly: true });
  const cutoff = Date.now() - 3 * 3600 * 1000; // last 3h
  const rows = db.prepare(`
    SELECT id, thread_id, fb_message_id, is_outgoing, content, timestamp_ms,
           timestamp_source, created_at, delivery_status
    FROM messages
    WHERE timestamp_ms > ?
    ORDER BY timestamp_ms ASC
  `).all(cutoff);
  console.log('\n=== DB: messages last 3h (' + rows.length + ' rows) ===');
  for (const r of rows) {
    const t = new Date(Number(r.timestamp_ms));
    console.log(
      `ts=${t.toISOString()} out=${r.is_outgoing} src=${r.timestamp_source} ` +
      `status=${r.delivery_status} id=${r.id} mid=${r.fb_message_id} ` +
      `thread=${r.thread_id} content=${JSON.stringify(String(r.content || '').slice(0, 40))}`
    );
  }
  const th = db.prepare(`
    SELECT id, thread_id, fb_message_id, is_outgoing, content, timestamp_ms,
           timestamp_source, created_at
    FROM messages
    WHERE created_at >= datetime('now', '-3 hours')
    ORDER BY id ASC
  `).all();
  console.log('\n=== DB: rows INSERTED last 3h (' + th.length + ' rows) ===');
  for (const r of th) {
    const t = new Date(Number(r.timestamp_ms));
    console.log(
      `inserted=${r.created_at} ts=${t.toISOString()} out=${r.is_outgoing} src=${r.timestamp_source} ` +
      `id=${r.id} mid=${r.fb_message_id} thread=${r.thread_id} content=${JSON.stringify(String(r.content || '').slice(0, 40))}`
    );
  }
  db.close();
} catch (e) {
  console.log('DB ERROR:', e.message);
}
