// Driver: forge session -> start account chrome -> page-setup -> poll -> cleanup
// Chạy sau khi app release mới đã mở (server 5050).
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB = path.join(process.env.APPDATA, 'autochatbot-fb-crm', 'data', 'database.db');
const BASE = 'http://127.0.0.1:5050';
const USER_ID = 15;
const ACCOUNT_ID = '100066325187762';
const APP_ID = '1241465768178399';
const PAGE_IDS = ['683923444796165', '664031873456106']; // Shopmmofk + Kjgvkj (2 page của account)
const MAX_WAIT_EXT_MS = 240000;
const MAX_WAIT_JOB_MS = 600000;

const token = crypto.randomBytes(32).toString('base64url');
const hash = crypto.createHash('sha256').update(token).digest('hex');

function writeSession() {
  const db = new DatabaseSync(DB);
  db.exec('PRAGMA busy_timeout = 10000');
  db.prepare("INSERT INTO auth_sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)")
    .run(USER_ID, hash, new Date(Date.now() + 7 * 86400000).toISOString());
  db.close();
  console.log('[driver] forged session user_id=' + USER_ID);
}

function deleteSession() {
  try {
    const db = new DatabaseSync(DB);
    db.exec('PRAGMA busy_timeout = 10000');
    db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(hash);
    db.close();
    console.log('[driver] deleted forged session');
  } catch (e) {
    console.log('[driver] delete session err:', e.message);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, pathname, body) {
  const res = await fetch(BASE + pathname, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: 'crm_session=' + token },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: res.status, json };
}

async function main() {
  writeSession();
  try {
    // 1. Chờ server sống
    for (let i = 0; i < 60; i++) {
      try {
        const r = await api('GET', '/api/accounts');
        if (r.status === 200) { console.log('[driver] server up, auth OK'); break; }
        console.log('[driver] accounts status', r.status);
      } catch (_) {}
      await sleep(3000);
    }

    // 2. Start chrome của account (nền) — extension sẽ tự kết nối WS
    const st = await api('POST', `/api/accounts/${ACCOUNT_ID}/start`, { background: true });
    console.log('[driver] start account ->', st.status, JSON.stringify(st.json));

    // 3. Chờ extension connected
    const deadline = Date.now() + MAX_WAIT_EXT_MS;
    let extOk = false;
    while (Date.now() < deadline) {
      const r = await api('GET', '/api/accounts');
      const acc = (r.json || []).find((a) => String(a.id) === ACCOUNT_ID);
      if (acc && acc.is_extension_connected) { extOk = true; console.log('[driver] extension connected'); break; }
      await sleep(4000);
    }
    if (!extOk) { console.log('[driver] TIMEOUT chờ extension — dừng'); return; }

    // 4. Trigger page-setup
    const ps = await api('POST', `/api/page-api/accounts/${ACCOUNT_ID}/page-setup`, {
      appId: APP_ID, pageIds: PAGE_IDS,
    });
    console.log('[driver] page-setup ->', ps.status, JSON.stringify(ps.json));
    const syncId = ps.json && ps.json.sync_id;
    if (!syncId) { console.log('[driver] không có sync_id — dừng'); return; }

    // 5. Poll job
    const jobDeadline = Date.now() + MAX_WAIT_JOB_MS;
    while (Date.now() < jobDeadline) {
      const r = await api('GET', '/api/page-api/sync-status?sync_id=' + syncId);
      const job = r.json && r.json.job;
      if (!job) { console.log('[driver] job chưa xuất hiện...'); await sleep(3000); continue; }
      console.log('[driver]', job.status, '|', (job.message || '').slice(0, 160));
      if (job.status === 'success' || job.status === 'error' || job.status === 'need_password' || job.status === 'need_register_input') {
        console.log('[driver] FINAL:', JSON.stringify(job, null, 1));
        return;
      }
      await sleep(3000);
    }
    console.log('[driver] TIMEOUT chờ job');
  } finally {
    deleteSession();
  }
}

main().catch((e) => { console.error('[driver] crash:', e); deleteSession(); });
