// Part 2: full insert list + log analysis for post-build-55 window
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DATA = 'C:\\Users\\Admin\\AppData\\Roaming\\autochatbot-fb-crm\\data';
const LOG = path.join(DATA, 'composer-debug.log');
const DB = path.join(DATA, 'database.db');

// --- 1. rows inserted after relaunch 02:52:52Z ---
const db = new DatabaseSync(DB, { readOnly: true });
const rows = db.prepare(`
  SELECT id, thread_id, fb_message_id, is_outgoing, content, timestamp_ms,
         timestamp_source, created_at
  FROM messages
  WHERE id >= 545600
  ORDER BY id ASC
`).all();
console.log('=== DB rows id>=545600, personal threads only ===');
for (const r of rows) {
  if (!['100066325187762', '100004449999465'].includes(String(r.thread_id))) continue;
  const t = new Date(Number(r.timestamp_ms));
  console.log(
    `id=${r.id} inserted=${r.created_at} ts=${t.toISOString()} out=${r.is_outgoing} src=${r.timestamp_source} mid=${r.fb_message_id} content=${JSON.stringify(String(r.content || '').slice(0, 30))}`
  );
}
db.close();

// --- 2. log analysis: obs/forward stages after 02:52Z ---
const raw = fs.readFileSync(LOG, 'utf8');
const lines = raw.split('\n').filter(Boolean);
const interesting = [];
for (const l of lines) {
  if (!l.startsWith('{"at":"2026-10-09T02:5') && !l.startsWith('{"at":"2026-10-09T03:')) continue;
  if (l.includes('TRACKER_DUPLICATE') || l.includes('ECHO_SUPPRESSED') || l.includes('REREAD_')
    || l.includes('WS_SKIP') || l.includes('WS_MIRROR') || l.includes('OBS_MSG')
    || l.includes('FORWARD') || l.includes('OUTGOING') || l.includes('outgoing')
    || l.includes('MSGR_T') || l.includes('"kind":"obs","stage":"MSG"')
    || l.includes('alo')) {
    interesting.push(l);
  }
}
console.log('\n=== log after 02:52Z: interesting stages (' + interesting.length + ') ===');
for (const l of interesting.slice(-150)) console.log(l);
