/**
 * PageApiService — chức năng Page chạy bằng Messenger Platform chính thức của Meta
 * (thay cho đường DOM Business Suite qua extension đã ngừng sử dụng).
 *
 * Thành phần:
 * 1. KV config (bảng page_api_config): verify token webhook, URL cầu nối hosting,
 *    bản ghi app đã tạo theo từng account Facebook.
 * 2. Graph API client: gửi tin nhắn Page (Send API) + đọc hội thoại (backfill).
 * 3. Webhook ingestion: nhận event từ Meta (qua cầu nối hosting webhook.php hoặc
 *    POST trực tiếp), chống trùng theo message.mid, lưu threads/messages rồi
 *    bắn realtime qua socket.io.
 * 4. Poller cầu nối hosting: định kỳ đọc sự kiện từ webhook.php trên hosting.
 */
const crypto = require('crypto');
const InboxSourceService = require('./InboxSourceService');
const ConversationRepository = require('../repositories/ConversationRepository');

const GRAPH_VERSION = 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

let defaultDb;
function getDb() {
  if (!defaultDb) defaultDb = require('../database/db');
  return defaultDb;
}

// ── Schema (idempotent — dùng được cho cả DB cũ không có bảng này) ──
function ensureSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS page_api_config (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

// ── KV config ──
function readConfig(key, database = getDb()) {
  ensureSchema(database);
  const row = database.prepare('SELECT value FROM page_api_config WHERE key = ?').get(key);
  if (!row || !row.value) return {};
  try { return JSON.parse(row.value) || {}; } catch (_) { return {}; }
}

function writeConfig(key, patch, database = getDb()) {
  ensureSchema(database);
  const next = { ...readConfig(key, database), ...patch };
  database.prepare(`
    INSERT INTO page_api_config (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).run(key, JSON.stringify(next));
  return next;
}

const GLOBAL_KEY = '__global__';
const accountKey = (accountId) => `account:${String(accountId)}`;

// Verify token webhook: .env (WEBHOOK_VERIFY_TOKEN) luôn là nguồn chuẩn —
// phải khớp với $VERIFY_TOKEN trong webhook.php trên hosting. Nếu CSDL đang
// giữ token khác (vd lần chạy đầu tự sinh) thì ghi đè bằng token .env.
// Không có .env thì tạo 1 lần rồi lưu KV dùng lại.
function getOrCreateVerifyToken(database = getDb()) {
  const g = readConfig(GLOBAL_KEY, database);
  const envToken = (process.env.WEBHOOK_VERIFY_TOKEN || '').trim();
  if (envToken) {
    if (g.verify_token !== envToken) {
      writeConfig(GLOBAL_KEY, { verify_token: envToken }, database);
      if (g.verify_token) {
        console.log('[PageApi] 🔁 Đã đồng bộ verify token theo .env (ghi đè token cũ trong CSDL).');
      }
    }
    return envToken;
  }
  if (g.verify_token) return g.verify_token;
  const token = 'crmwb_' + crypto.randomBytes(16).toString('hex');
  writeConfig(GLOBAL_KEY, { verify_token: token }, database);
  console.log(`[PageApi] 🔑 Verify token webhook đang dùng: ${token}`);
  return token;
}

function getGlobalConfig(database = getDb()) {
  return readConfig(GLOBAL_KEY, database);
}

function setBridgeUrl(url, database = getDb()) {
  const clean = String(url || '').trim().split('?')[0];
  return writeConfig(GLOBAL_KEY, { bridge_url: clean || null }, database);
}

// ── Bản ghi app theo account (dùng bởi AppSetupAutomation qua DEPS) ──
function appAdd(accountId, rec, database = getDb()) {
  const cur = readConfig(accountKey(accountId), database);
  const apps = Array.isArray(cur.apps) ? cur.apps : [];
  apps.unshift({ ...rec, pages: rec.pages || [] });
  return writeConfig(accountKey(accountId), { apps: apps.slice(0, 50) }, database).apps[0];
}

function appGetLatest(accountId, database = getDb()) {
  const cur = readConfig(accountKey(accountId), database);
  return (Array.isArray(cur.apps) && cur.apps[0]) || null;
}

function appUpdate(accountId, appId, patch, database = getDb()) {
  const cur = readConfig(accountKey(accountId), database);
  const apps = Array.isArray(cur.apps) ? cur.apps : [];
  const i = apps.findIndex((x) => x.appId === String(appId));
  if (i >= 0) {
    apps[i] = { ...apps[i], ...patch };
    writeConfig(accountKey(accountId), { apps }, database);
  }
  return apps;
}

function appRemove(accountId, appId, database = getDb()) {
  const cur = readConfig(accountKey(accountId), database);
  const apps = (Array.isArray(cur.apps) ? cur.apps : []).filter((x) => x.appId !== String(appId));
  writeConfig(accountKey(accountId), { apps }, database);
  return apps;
}

function appList(accountId, database = getDb()) {
  const cur = readConfig(accountKey(accountId), database);
  return Array.isArray(cur.apps) ? cur.apps : [];
}

// ── Page sources: upsert khi automation cào được danh sách trang ──
// Automation chạy trong phiên login của `accountId` → mọi page nó cào được
// PHẢI thuộc account đó (ghi đè cả owner cũ — ví dụ page từng bị bind nhầm
// vào account test đã xóa thì không current account không thấy).
// Token cũ vẫn giữ nguyên nếu bản mới không mang token.
function upsertPages(accountId, pages, database = getDb()) {
  for (const p of pages || []) {
    if (!p || !p.pageId) continue;
    const existing = database.prepare(
      "SELECT id, owner_account_id FROM inbox_sources WHERE source_type = 'page_messenger' AND external_id = ?"
    ).get(String(p.pageId));
    if (existing) {
      const ownerChanged = accountId && existing.owner_account_id !== String(accountId);
      database.prepare(
        "UPDATE inbox_sources SET owner_account_id = ?, display_name = COALESCE(NULLIF(?, ''), display_name), status = 'ACTIVE', avatar_url = COALESCE(avatar_url, 'https://graph.facebook.com/' || external_id || '/picture?type=normal') WHERE id = ?"
      ).run(accountId || existing.owner_account_id, p.name || '', existing.id);
      // Đổi chủ source → kéo theo toàn bộ thread của source sang chủ mới
      if (ownerChanged) {
        database.prepare(
          'UPDATE threads SET account_id = ? WHERE source_id = ? AND (account_id IS NULL OR account_id != ?)'
        ).run(String(accountId), existing.id, String(accountId));
      }
    } else {
      InboxSourceService.ensurePageSource({ pageId: String(p.pageId), accountId, pageName: p.name }, database);
    }
  }
}

function listPages(accountId, database = getDb()) {
  return database.prepare(`
    SELECT external_id AS pageId, display_name AS name, avatar_url, access_token_encrypted
    FROM inbox_sources WHERE source_type = 'page_messenger' AND owner_account_id = ? AND status = 'ACTIVE'
  `).all(String(accountId));
}

// Lưu danh sách page + TOKEN do automation bắt được (giống pages-store ở CRM_FB cũ:
// save = ghi đè dữ liệu mới, token rỗng thì giữ token cũ, có token thì mã hóa lưu).
function savePages(accountId, pages, database = getDb()) {
  const { encryptToken } = require('../utils/tokenEncryption');
  for (const p of pages || []) {
    if (!p || !p.pageId) continue;
    let existing = database.prepare(
      "SELECT id, owner_account_id, access_token_encrypted FROM inbox_sources WHERE source_type = 'page_messenger' AND external_id = ?"
    ).get(String(p.pageId));
    if (!existing) {
      InboxSourceService.ensurePageSource({ pageId: String(p.pageId), accountId, pageName: p.name }, database);
      existing = database.prepare(
        "SELECT id, owner_account_id, access_token_encrypted FROM inbox_sources WHERE source_type = 'page_messenger' AND external_id = ?"
      ).get(String(p.pageId));
    }
    if (!existing) continue;
    // Automation chạy trong phiên login của account này → page này thuộc account đó
    if (accountId && existing.owner_account_id !== String(accountId)) {
      database.prepare('UPDATE inbox_sources SET owner_account_id = ? WHERE id = ?').run(String(accountId), existing.id);
    }
    if (p.token && /^EA[A-Za-z0-9_-]{20,}/.test(p.token)) {
      // Gắn luôn owner theo account chạy Lấy token — không để page có token mà mồ côi
      // (owner NULL làm watcher/webhook không biế tin về account nào — lỗi 2026-10-06)
      database.prepare("UPDATE inbox_sources SET access_token_encrypted = ?, status = 'ACTIVE', owner_account_id = COALESCE(owner_account_id, ?) WHERE id = ?")
        .run(encryptToken(p.token), accountId || null, existing.id);
      console.log(`[PageApi] 🔐 Đã lưu Page Access Token cho page ${p.pageId} (owner: ${accountId || existing.owner_account_id})`);
    }
    if (p.name && !/^Trang \d+$/.test(p.name)) {
      database.prepare('UPDATE inbox_sources SET display_name = ? WHERE id = ? AND display_name LIKE ?', database)
        .run(p.name, existing.id, 'Page %');
    }
  }
}

// ── Graph API client ──
async function graphGet(path, params, database = getDb()) {
  const url = new URL(`${GRAPH_BASE}/${path}`);
  for (const [k, v] of Object.entries(params || {})) {
    if (k !== 'access_token') url.searchParams.set(k, v);
  }
  url.searchParams.set('access_token', params.access_token);
  const res = await fetch(url, { method: 'GET' });
  const data = await res.json().catch(() => ({}));
  return data;
}

// Gửi tin nhắn Page qua Send API. Trả { success, messageId } hoặc { error, errorCode }.
async function sendPageMessage(sourceId, recipientPsid, text, database = getDb()) {
  const token = InboxSourceService.getDecryptedToken(sourceId, database);
  if (!token) {
    return { success: false, error: 'Page chưa có Page Access Token. Hãy chạy "Lấy token & Đăng ký" trong modal Fanpage.', errorCode: 'NO_PAGE_TOKEN' };
  }
  const source = InboxSourceService.getSourceById(sourceId, database);
  if (!source) return { success: false, error: 'Không tìm thấy Page source.', errorCode: 'SOURCE_NOT_FOUND' };

  const body = {
    recipient: { id: String(recipientPsid) },
    message: { text: String(text || '') },
    messaging_type: 'RESPONSE',
    access_token: token,
  };
  const res = await fetch(`${GRAPH_BASE}/${source.external_id}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (data.error) {
    console.warn(`[PageApi] Gửi tin lỗi cho page ${source.external_id}:`, data.error.message);
    return {
      success: false,
      error: data.error.error_data?.message || data.error.message || 'Graph API lỗi không rõ',
      errorCode: data.error.code ? `GRAPH_${data.error.code}` : 'GRAPH_ERROR',
      errorSubcode: data.error.error_subcode || null,
    };
  }
  return { success: true, messageId: data.message_id || null, recipientId: data.recipient_id || null };
}

// PSID của khách từ thread id — hệ thống dùng bare-first: id thường là PSID,
// trùng hội thoại thì repo đổi thành page:<pageId>:<psid>.
function bareThreadId(threadId) {
  return String(threadId || '').includes(':') ? String(threadId).split(':').pop() : String(threadId || '');
}

// ── Đăng ký page vào webhook của app (bằng Page token qua Graph) ──
// Đây là bước QUYẾT ĐỊNH để Meta đẩy tin khách về webhook — thiếu bước này thì
// gửi tin được nhưng khách nhắn không bao giờ về CRM (báo lỗi 2026-10-05).
const PAGE_SUBSCRIBE_FIELDS = ['messages', 'messaging_postbacks', 'message_reads', 'message_deliveries', 'message_reactions'];

async function subscribePage(sourceId, database = getDb()) {
  const source = InboxSourceService.getSourceById(sourceId, database);
  const token = InboxSourceService.getDecryptedToken(sourceId, database);
  if (!source || !token) return { ok: false, reason: 'NO_TOKEN' };
  try {
    const res = await fetch(`${GRAPH_BASE}/${source.external_id}/subscribed_apps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscribed_fields: PAGE_SUBSCRIBE_FIELDS.join(','), access_token: token }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.error) {
      console.warn(`[PageApi] Subscribe page ${source.external_id} lỗi:`, data.error.message);
      return { ok: false, reason: data.error.message };
    }
    console.log(`[PageApi] ✅ Page ${source.external_id} đã đăng ký webhook fields: ${PAGE_SUBSCRIBE_FIELDS.join(', ')}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

// Xóa token của mọi page thuộc account (dùng khi xóa app — token theo app, app mất thì token chết)
function clearPageTokens(accountId, database = getDb()) {
  database.prepare(
    "UPDATE inbox_sources SET access_token_encrypted = NULL WHERE source_type = 'page_messenger' AND owner_account_id = ?"
  ).run(String(accountId));
}

// Xóa SẠCH page + hội thoại của account (dùng khi xóa app: app mất thì page
// không còn gửi/nhận được qua CRM — user muốn danh sách page về trống).
// messages tự cascade theo threads (FK ON DELETE CASCADE).
function removeAccountPages(accountId, database = getDb()) {
  const srcs = database.prepare(
    "SELECT id FROM inbox_sources WHERE source_type = 'page_messenger' AND owner_account_id = ?"
  ).all(String(accountId));
  let threads = 0;
  database.transaction(() => {
    for (const s of srcs) {
      threads += database.prepare('DELETE FROM threads WHERE source_id = ?').run(s.id).changes;
    }
    database.prepare(
      "DELETE FROM inbox_sources WHERE source_type = 'page_messenger' AND owner_account_id = ?"
    ).run(String(accountId));
  })();
  console.log(`[PageApi] 🗑️ Đã xóa ${srcs.length} page source + ${threads} hội thoại của account ${accountId} (app đã gỡ).`);
  return { sources: srcs.length, threads };
}

// Quy tắc: page CHỈ tồn tại khi được app tạo ra (có Page Access Token).
// Page chưa có token (quét/Dồng bộ để lộ lại, app đã gỡ...) → xóa luôn kèm
// hội thoại. Chạy lúc server khởi động + sau khi gỡ app.
// NGOẠI LỆ: page ĐANG CÓ HỘI THOẠI (khách đã nhắn thật — webhook tự hồi phục
// tạo ra) thì GIỮ, xóa là mất lịch sử khách (báo lỗi 2026-10-06).
function removeUntokenedPages(database = getDb()) {
  const srcs = database.prepare(`
    SELECT s.id FROM inbox_sources s
    WHERE s.source_type = 'page_messenger' AND s.access_token_encrypted IS NULL
      AND NOT EXISTS (SELECT 1 FROM threads t WHERE t.source_id = s.id)
  `).all();
  let threads = 0;
  database.transaction(() => {
    for (const s of srcs) {
      threads += database.prepare('DELETE FROM threads WHERE source_id = ?').run(s.id).changes;
    }
    database.prepare(`
      DELETE FROM inbox_sources WHERE source_type = 'page_messenger' AND access_token_encrypted IS NULL
        AND NOT EXISTS (SELECT 1 FROM threads t WHERE t.source_id = inbox_sources.id)
    `).run();
  })();
  if (srcs.length) {
    console.log(`[PageApi] 🧹 Dọn ${srcs.length} page trống chưa có token (+ ${threads} hội thoại) — page đang có khách chat thì giữ lại.`);
  }
  return { sources: srcs.length, threads };
}

// Danh sách page id ĐÃ CÓ trong hệ thống (mọi owner, mọi trạng thái) —
// dùng bởi "Đồng bộ page mới": chỉ thêm page chưa thấy, bỏ qua page đã cào.
function knownPageIds(database = getDb()) {
  return database.prepare(
    "SELECT external_id FROM inbox_sources WHERE source_type = 'page_messenger'"
  ).all().map((r) => String(r.external_id));
}

// ── Backfill hội thoại của 1 page từ Graph API ──
// Đồng bộ N hội thoại gần nhất + tin nhắn của từng hội thoại vào CRM.
async function backfillConversations(sourceId, io, options = {}, database = getDb()) {
  const source = InboxSourceService.getSourceById(sourceId, database);
  const token = InboxSourceService.getDecryptedToken(sourceId, database);
  if (!source || !token) return { ok: false, reason: 'NO_TOKEN' };
  const pageId = String(source.external_id);
  const accountId = source.owner_account_id || pageId;
  const convLimit = Number(options.convLimit || 25);

  // Thread của source này thuộc về chủ HIỆN HÀNH — re-point những thread trước
  // đây bị bind vào account khác (vd account test cũ đã ngắt), nếu không CRM
  // sẽ không hiện hội thoại ở inbox của account đang dùng (báo lỗi 2026-10-06:
  // backfill về đủ 55 tin nhưng account_id là account cũ nên không thấy gì).
  database.prepare(
    'UPDATE threads SET account_id = ? WHERE source_id = ? AND (account_id IS NULL OR account_id != ?)'
  ).run(String(accountId), source.id, String(accountId));

  // Đảm bảo page đã đăng ký webhook (tin khách mới về được) — idempotent, gọi lại không hại
  const sub = await subscribePage(sourceId, database);
  if (!sub.ok) console.warn(`[PageApi] Backfill tiếp tục dù subscribe lỗi: ${sub.reason}`);

  // Cập nhật tên page thật từ Graph (tên bóc từ DOM có khi là chữ UI như "Xem Thêm")
  try {
    const me = await graphGet('me', { fields: 'name,picture.type(normal)', access_token: token }, database);
    if (me?.name && InboxSourceService.isValidPageDisplayName(me.name) && me.name !== source.display_name) {
      database.prepare('UPDATE inbox_sources SET display_name = ? WHERE id = ?').run(me.name, source.id);
      source.display_name = me.name;
      console.log(`[PageApi] 🏷️ Cập nhật tên page ${pageId}: "${me.name}"`);
    }
    const picUrl = me?.picture?.data?.url;
    if (picUrl && picUrl !== source.avatar_url) {
      database.prepare('UPDATE inbox_sources SET avatar_url = ? WHERE id = ?').run(picUrl, source.id);
      source.avatar_url = picUrl;
      console.log(`[PageApi] 🖼️ Cập nhật avatar page ${pageId}`);
    }
  } catch (_) { /* không có tên mới thì giữ tên cũ */ }

  try {
    const convData = await graphGet(`${pageId}/conversations`, {
      fields: 'id,participants,updated_time,message_count,link',
      limit: String(convLimit),
      access_token: token,
    }, database);
    if (convData.error) {
      console.warn(`[PageApi] Backfill hội thoại lỗi page=${pageId}:`, convData.error.message);
      return { ok: false, reason: convData.error.message };
    }

    let convCount = 0;
    let insertedNew = 0;
    for (const conv of (convData.data || [])) {
      try {
        const participant = (conv.participants?.data || []).find((p) => String(p.id) !== pageId);
        const contactPsid = participant?.id;
        if (!contactPsid) continue;

        // Bare-first policy: repo quyết định id cuối (bare psid hoặc page:<pid>:<psid>)
        const thread = ConversationRepository.upsertThread({
          id: String(contactPsid),
          account_id: accountId,
          source_id: source.id,
          external_thread_id: String(contactPsid),
          contact_name: participant?.name || null,
          is_unread: 0,
          thread_url: conv.link || null,
        }, database);
        if (!thread) continue;
        if (!thread.source_id) {
          database.prepare('UPDATE threads SET source_id = ? WHERE id = ?').run(source.id, thread.id);
        }

        const msgData = await graphGet(`${conv.id}/messages`, {
          fields: 'id,message,from,created_time,attachments{mime_type,image_url,video_url,audio_url,file_url}',
          limit: '50',
          access_token: token,
        }, database);
        if (msgData.error) continue;

        for (const msg of (msgData.data || []).reverse()) {
          const inserted = insertGraphMessage(thread.id, source, msg, database);
          if (inserted != null) insertedNew++;
        }
        const lastMsg = (msgData.data || [])[0];
        if (lastMsg) {
          ConversationRepository.touchThread(thread.id, (lastMsg.message || '[Đính kèm]').substring(0, 200), database);
        }
        convCount++;
      } catch (convErr) {
        console.warn(`[PageApi] Backfill 1 hội thoại lỗi:`, convErr.message);
      }
    }
    console.log(`[PageApi] ✅ Backfill page=${pageId}: ${convCount} hội thoại`);
    // Chỉ bắn event khi CÓ tin mới — tránh đẩy list refresh vô nghĩa mỗi chu kỳ
    if (io && insertedNew > 0) io.emit('THREAD_LIST_UPDATED', { account_id: accountId, new_messages: insertedNew });
    return { ok: true, count: convCount, newMessages: insertedNew };
  } catch (err) {
    console.warn(`[PageApi] Backfill thất bại page=${pageId}:`, err.message);
    return { ok: false, reason: err.message };
  }
}

// Chèn 1 tin nhắn dạng Graph API (webhook hoặc backfill) — chống trùng theo message id
function insertGraphMessage(threadId, source, msg, database = getDb(), opts = {}) {
  const messageId = msg.id || msg.mid;
  if (!messageId) return null;
  const existing = database.prepare('SELECT id FROM messages WHERE fb_message_id = ?').get(messageId);
  if (existing) return null;

  const pageId = String(source.external_id);
  const fromId = String(msg.from?.id || opts.senderId || 'unknown');
  const isOutgoing = fromId === pageId;
  const text = msg.message || null;
  let mediaType = 'text';
  let mediaUrl = null;
  const att = (msg.attachments?.data || [])[0];
  if (att) {
    const mime = String(att.mime_type || '');
    if (mime.startsWith('image/')) { mediaType = 'image'; mediaUrl = att.image_url; }
    else if (mime.startsWith('video/')) { mediaType = 'video'; mediaUrl = att.video_url; }
    else if (mime.startsWith('audio/')) { mediaType = 'voice'; mediaUrl = att.audio_url; }
    else { mediaType = 'file'; mediaUrl = att.file_url; }
  }
  const ts = msg.created_time ? new Date(msg.created_time).getTime() : Date.now();

  // sequence_order: xếp sau tin cuối cùng trong thread
  const maxSeqRow = database.prepare(
    'SELECT MAX(COALESCE(sequence_order, id)) AS max_seq FROM messages WHERE thread_id = ?'
  ).get(threadId);
  const nextSeq = (Number.isFinite(Number(maxSeqRow?.max_seq)) && Number(maxSeqRow.max_seq) > 0)
    ? Number(maxSeqRow.max_seq) + 1 : 1;

  const result = database.prepare(`
    INSERT INTO messages (thread_id, fb_message_id, sender_id, content, media_type, media_url, is_outgoing, sender_role, sequence_order, delivery_status, timestamp_ms, timestamp_source, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'sent', ?, ?, ?)
  `).run(
    threadId, messageId, fromId, text, mediaType, mediaUrl,
    isOutgoing ? 1 : 0, isOutgoing ? 'operator' : 'customer',
    nextSeq, ts, opts.timestampSource || 'webhook', new Date(ts).toISOString()
  );

  database.prepare('UPDATE threads SET last_activity = CURRENT_TIMESTAMP WHERE id = ?').run(threadId);

  // Webhook event có thể về TRỄ (poll 5s + latency Meta) — tin gửi trước đang
  // chờ xử lý làm tin khách bị append SAI VỊ TRÍ (dưới tin operator gửi sau).
  // Chuẩn hóa sequence_order theo (timestamp_ms, id) để thứ tự bubble đúng
  // tuyệt đối — client chèn tin mới theo sequence nên live view cũng tự đúng.
  resequenceThreadByTimestamp(threadId, database);
  return result.lastInsertRowid;
}

function resequenceThreadByTimestamp(threadId, database) {
  const rows = database.prepare(
    'SELECT id FROM messages WHERE thread_id = ? ORDER BY COALESCE(timestamp_ms, 0) ASC, id ASC'
  ).all(threadId);
  const upd = database.prepare('UPDATE messages SET sequence_order = ? WHERE id = ?');
  database.transaction(() => {
    rows.forEach((r, i) => upd.run(i + 1, r.id));
  })();
}

// ── Webhook ingestion (body từ Meta) ──
// Trả về { processed, errors, messageData? } — messageData để caller bắn socket.
// Đa page / đa account: tra pageId thuộc app của account nào (page_api_config)
function findAccountForPage(pageId, database = getDb()) {
  const rows = database.prepare("SELECT key, value FROM page_api_config WHERE key LIKE 'account:%'").all();
  for (const r of rows) {
    try {
      const j = JSON.parse(r.value);
      for (const app of (j.apps || [])) {
        if ((app.pages || []).some((p) => String(p.pageId) === String(pageId))) {
          return r.key.slice('account:'.length);
        }
      }
    } catch (_) {}
  }
  return null;
}

function handleWebhookBody(body, io, database = getDb()) {
  const result = { processed: 0, errors: 0 };
  if (!body || body.object !== 'page') return result;

  for (const entry of (body.entry || [])) {
    const pageId = String(entry.id || '');
    let source = InboxSourceService.getSourceByExternalId('page_messenger', pageId, database);
    if (!source) {
      // TỰ HỒI PHỤC: khách nhắn page chưa có trong CRM (mới, hoặc bị dọn khi
      // gỡ app) — tự tạo source + gắn owner về account ACTIVE duy nhất (nếu
      // rõ ràng) để tin KHÔNG BAO GIỜ bị bỏ qua (báo lỗi 2026-10-06: user mới
      // nhắn lên page không thấy đồng bộ).
      console.warn(`[PageApi] 🩹 Webhook cho page chưa có source (${pageId}) — tự tạo và tiếp nhận tin.`);
      InboxSourceService.ensurePageSource({ pageId, pageName: 'Page ' + pageId }, database);
      source = InboxSourceService.getSourceByExternalId('page_messenger', pageId, database);
    }
    if (source && !source.owner_account_id) {
      const resolved = findAccountForPage(pageId, database) || (() => { const a = database.prepare("SELECT id FROM accounts WHERE status = 'ACTIVE' OR status IS NULL").all(); return a.length === 1 ? String(a[0].id) : null; })();
      if (resolved) {
        database.prepare('UPDATE inbox_sources SET owner_account_id = ? WHERE id = ? AND owner_account_id IS NULL')
          .run(String(resolved), source.id);
        console.log('[PageApi] 🔗 Tự gắn owner ' + resolved + ' cho page ' + pageId);
      }
    }
    if (!source) {
      console.warn(`[PageApi] Nhận webhook cho page chưa kết nối: ${pageId} — bỏ qua.`);
      result.errors++;
      continue;
    }
    for (const event of (entry.messaging || [])) {
      try {
        const out = processMessagingEvent(event, source, io, database);
        if (out) result.processed++;
      } catch (err) {
        console.error('[PageApi] Lỗi xử lý webhook event:', err.message);
        result.errors++;
      }
    }
  }
  return result;
}

function processMessagingEvent(event, source, io, database) {
  const message = event.message;
  if (!message) return null;
  const pageId = String(source.external_id);
  const senderPsid = String(event.sender?.id || 'unknown');
  const isEcho = Boolean(message.is_echo);
  const isOutgoing = isEcho || senderPsid === pageId;
  const contactPsid = isOutgoing ? String(event.recipient?.id || '') : senderPsid;
  if (!contactPsid) return null;
  const text = message.text || '';
  const ts = Number(event.timestamp || Date.now());

  // Đa page / đa account: cùng một khách có thể nhắn NHIỀU page (thậm chí
  // qua account khác) — thread bare psid đã tồn tại ở nguồn KHÁC thì buộc
  // namespacing page:<pageId>:<psid> ngay từ đầu, tránh INSERT trùng khóa.
  let threadId = contactPsid;
  const clash = database.prepare(
    "SELECT id, source_id, account_id FROM threads WHERE id = ? OR COALESCE(external_thread_id, '') = ?"
  ).get(contactPsid, contactPsid);
  if (clash && String(clash.source_id || '') !== String(source.id)) {
    threadId = 'page:' + pageId + ':' + contactPsid;
  }

  const thread = ConversationRepository.upsertThread({
    id: threadId,
    account_id: source.owner_account_id || pageId,
    source_id: source.id,
    external_thread_id: contactPsid,
    contact_name: null,
    last_message: (text || '[Đính kèm]').substring(0, 200),
    is_unread: isOutgoing ? 0 : 1,
  }, database);
  if (!thread) return null;
  if (!thread.source_id) {
    database.prepare('UPDATE threads SET source_id = ? WHERE id = ?').run(source.id, thread.id);
  }
  // Thread của source thuộc về chủ hiện hành — re-point nếu trước đây bị bind
  // vào account khác (account test cũ), ngược lại tin đổ vào account chết và
  // inbox của account đang dùng không thấy gì.
  database.prepare(
    'UPDATE threads SET account_id = ? WHERE id = ? AND (account_id IS NULL OR account_id != ?)'
  ).run(String(source.owner_account_id || pageId), thread.id, String(source.owner_account_id || pageId));

  // ECHO = page gửi tin TRỰC TIẾP từ Messenger (không qua CRM) — phải ghi lại,
  // không bỏ qua. Tin gửi TỪ CRM đã có row pending: đối soát theo nội dung
  // ±5 phút rồi gắn mid thật; không khớp row nào thì ghi tin mới.
  if (isEcho) {
    const existing = database.prepare(`
      SELECT id, fb_message_id, delivery_status FROM messages WHERE thread_id = ? AND is_outgoing = 1 AND content = ?
        AND ABS(COALESCE(timestamp_ms, 0) - ?) <= 300000
      ORDER BY (delivery_status = 'pending') DESC, id DESC LIMIT 1
    `).get(thread.id, text, ts);
    if (existing) {
      if (String(existing.fb_message_id || '').startsWith('pending_') || existing.delivery_status !== 'sent') {
        database.prepare(`
          UPDATE messages SET fb_message_id = ?, delivery_status = 'sent', delivery_error = NULL WHERE id = ?
        `).run(message.mid, existing.id);
        const row = database.prepare('SELECT * FROM messages WHERE id = ?').get(existing.id);
        if (io) io.emit('NEW_MESSAGE', { ...row, thread_id: thread.id, account_id: thread.account_id, source_id: source.id, source_type: 'page_messenger' });
      }
      return null;
    }
  }

  const insertId = insertGraphMessage(thread.id, source, {
    id: message.mid,
    message: text,
    from: { id: senderPsid },
    created_time: new Date(ts).toISOString(),
    attachments: message.attachments ? { data: message.attachments.map((a) => ({
      mime_type: a.type === 'image' ? 'image/*' : a.type === 'video' ? 'video/*' : a.type === 'audio' ? 'audio/*' : 'application/octet-stream',
      image_url: a.payload?.url || null,
      video_url: a.payload?.url || null,
      audio_url: a.payload?.url || null,
      file_url: a.payload?.url || null,
    })) } : undefined,
  }, database, { senderId: senderPsid });

  if (insertId == null) return null; // trùng mid — đã có

  const savedRow = database.prepare('SELECT * FROM messages WHERE id = ?').get(insertId);
  const messageData = {
    ...savedRow,
    thread_id: thread.id,
    account_id: thread.account_id,
    source_id: source.id,
    source_type: 'page_messenger',
    source_name: source.display_name,
    page_id: pageId,
  };
  console.log('[PageApi] 💬 Tin Page mới: mid=' + message.mid + ' thread=' + thread.id + ' page=' + pageId + (isEcho ? ' (echo)' : ''));
  if (io) {
    io.emit('NEW_MESSAGE', messageData);
    io.emit('THREAD_LIST_UPDATED', { thread_id: thread.id, account_id: thread.account_id });
  }
  return messageData;
}

// ── Poller cầu nối hosting (webhook.php) ──
let pollTimer = null;
let polling = false;
function startBridgePolling(io, database = getDb(), intervalMs = 5000) {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    if (polling) return;
    polling = true;
    try {
      const g = readConfig(GLOBAL_KEY, database);
      if (!g.bridge_url) return;
      // Token luôn chuẩn hóa theo .env (getOrCreateVerifyToken tự ghi đè KV cũ)
      const token = getOrCreateVerifyToken(database);
      const url = `${g.bridge_url}?key=${encodeURIComponent(token)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return;
      const data = await res.json().catch(() => null);
      const events = Array.isArray(data?.events) ? data.events : [];
      for (const ev of events) {
        const body = ev?.body;
        if (!body || body.object !== 'page') continue;
        try { handleWebhookBody(body, io, database); } catch (_) {}
      }
    } catch (_) {
      // hosting tạm không tới được — im lặng, chu kỳ sau thử lại
    } finally {
      polling = false;
    }
  }, intervalMs);
  console.log(`[PageApi] 🌉 Đã bật poller cầu nối hosting (mỗi ${intervalMs / 1000}s).`);
}

function stopBridgePolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

// ── Theo dõi hội thoại page GẦN-THỜI-GIAN-THỰC (không cần bấm gì) ──
// Mỗi 10s: 1 call nhẹ lấy danh sách hội thoại (id + updated_time) của từng page
// có token → page nào CÓ BẢN CẬP NHẬT MỚI (khách vừa nhắn) mới kéo tin của
// đúng page đó về. Tin vào DB chống trùng mid, chat đang mở tự cập nhật.
let pageWatcherTimer = null;
let pageWatcherBusy = false;
const pageWatcherState = new Map(); // sourceId -> Map(convId -> updated_time ms)

function ensurePageThread(source, contactPsid, contactName, database) {
  let threadId = contactPsid;
  const clash = database.prepare(
    "SELECT id, source_id FROM threads WHERE id = ? OR COALESCE(external_thread_id, '') = ?"
  ).get(contactPsid, contactPsid);
  if (clash && String(clash.source_id || '') !== String(source.id)) {
    threadId = 'page:' + source.external_id + ':' + contactPsid;
  }
  const thread = ConversationRepository.upsertThread({
    id: threadId,
    account_id: source.owner_account_id || source.external_id,
    source_id: source.id,
    external_thread_id: contactPsid,
    contact_name: contactName || null,
    is_unread: 0,
  }, database);
  if (!thread) return null;
  if (!thread.source_id) {
    database.prepare('UPDATE threads SET source_id = ? WHERE id = ?').run(source.id, thread.id);
  }
  database.prepare(
    'UPDATE threads SET account_id = ? WHERE id = ? AND (account_id IS NULL OR account_id != ?)'
  ).run(String(source.owner_account_id || source.external_id), thread.id, String(source.owner_account_id || source.external_id));
  return thread;
}

async function watchPageConversations(source, io, database) {
  const token = InboxSourceService.getDecryptedToken(source.id, database);
  if (!token) return;
  const data = await graphGet(source.external_id + '/conversations', {
    fields: 'id,updated_time,participants',
    limit: '25',
    access_token: token,
  }, database);
  if (data.error) return;
  let state = pageWatcherState.get(source.id);
  if (!state) { state = new Map(); pageWatcherState.set(source.id, state); }
  let insertedNew = 0;
  for (const conv of (data.data || [])) {
    const participant = (conv.participants?.data || []).find((p) => String(p.id) !== String(source.external_id));
    const psid = participant?.id;
    if (!psid) continue;
    const updated = new Date(conv.updated_time).getTime();
    if (state.get(conv.id) === updated) continue; // không đổi — bỏ qua
    // LƯU Ý: chỉ đánh dấu updated SAU khi kéo tin thành công — kéo lỗi thì
    // chu kỳ sau thử lại, tin không bao giờ bị bỏ sót (lỗi mất Đikkjđi 2026-10-06)
    const msgData = await graphGet(conv.id + '/messages', {
      fields: 'id,message,from,created_time,attachments{mime_type,image_url,video_url,audio_url,file_url}',
      limit: '25',
      access_token: token,
    }, database);
    if (msgData.error) continue;
    state.set(conv.id, updated);
    const thread = ensurePageThread(source, psid, participant?.name || null, database);
    if (!thread) continue;
    for (const msg of (msgData.data || []).reverse()) {
      const id = insertGraphMessage(thread.id, source, msg, database);
      if (id != null) insertedNew++;
    }
    const lastMsg = (msgData.data || [])[0];
    if (lastMsg) {
      ConversationRepository.touchThread(thread.id, (lastMsg.message || '[Đính kèm]').substring(0, 200), database);
    }
  }
  if (insertedNew > 0 && io) {
    io.emit('THREAD_LIST_UPDATED', { account_id: source.owner_account_id, new_messages: insertedNew, page_id: source.external_id });
    console.log('[PageApi] 🔄 Page ' + source.external_id + ': +' + insertedNew + ' tin mới về CRM');
  }
}

function startPageConversationWatcher(io, database = getDb(), intervalMs = 10000) {
  if (pageWatcherTimer) return;
  pageWatcherTimer = setInterval(async () => {
    if (pageWatcherBusy) return;
    pageWatcherBusy = true;
    try {
      const sources = database.prepare(`
        SELECT id, external_id, display_name FROM inbox_sources
        WHERE source_type = 'page_messenger' AND status = 'ACTIVE' AND access_token_encrypted IS NOT NULL
      `).all();
      for (const s of sources) {
        try {
          await watchPageConversations(s, io, database);
        } catch (_) { /* page lỗi — chu kỳ sau chạy tiếp */ }
        await new Promise((r2) => setTimeout(r2, 800));
      }
    } catch (_) {}
    finally {
      pageWatcherBusy = false;
    }
  }, intervalMs);
  console.log('[PageApi] 👀 Theo dõi hội thoại page mỗi ' + (intervalMs / 1000) + 's — khách nhắn là tin tự về CRM.');
}

function stopPageConversationWatcher() {
  if (pageWatcherTimer) clearInterval(pageWatcherTimer);
  pageWatcherTimer = null;
}


module.exports = {
  ensureSchema,
  getOrCreateVerifyToken,
  getGlobalConfig,
  setBridgeUrl,
  readConfig,
  writeConfig,
  appAdd,
  appGetLatest,
  appUpdate,
  appRemove,
  appList,
  upsertPages,
  listPages,
  savePages,
  sendPageMessage,
  subscribePage,
  clearPageTokens,
  removeAccountPages,
  removeUntokenedPages,
  knownPageIds,
  backfillConversations,
  handleWebhookBody,
  startBridgePolling,
  startPageConversationWatcher,
  stopPageConversationWatcher,
  stopBridgePolling,
  GRAPH_VERSION,
};
