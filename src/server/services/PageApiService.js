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
const PhoneCaptureService = require('./PhoneCaptureService');
const { extractLeadInfo } = require('../utils/leadExtractor');
const { saveAvatarFromBase64OrUrl } = require('../utils/avatarManager');
const GlobalPhoneAutomationService = require('./GlobalPhoneAutomationService');
const CampaignPhoneCaptureService = require('./CampaignPhoneCaptureService');
const CampaignResponseStatsService = require('./CampaignResponseStatsService');
const CampaignEventService = require('./CampaignEventService');
const CampaignRepository = require('../repositories/CampaignRepository');

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

// Gộp app quét được từ trang developers.facebook.com/apps/ vào danh sách app
// của account: đã có → cập nhật tên/chế độ; chưa có → thêm vào CUỐI (app đầu
// mảng phải giữ là app đang dùng — appGetLatest/appAdd dựa vào thứ tự này).
function appMergeScanned(accountId, scanned, database = getDb()) {
  const cur = readConfig(accountKey(accountId), database);
  const apps = Array.isArray(cur.apps) ? cur.apps.slice() : [];
  let added = 0;
  let updated = 0;
  for (const s of Array.isArray(scanned) ? scanned : []) {
    if (!s || !/^\d+$/.test(String(s.appId || ''))) continue;
    const i = apps.findIndex((x) => x.appId === String(s.appId));
    if (i >= 0) {
      apps[i] = {
        ...apps[i],
        name: s.name || apps[i].name,
        mode: s.mode || apps[i].mode || null,
        type: s.type || apps[i].type || null,
        lastSeenAt: new Date().toISOString(),
      };
      updated++;
    } else {
      apps.push({
        appId: String(s.appId),
        name: s.name || ('App ' + s.appId),
        status: 'scanned',
        source: 'scan',
        mode: s.mode || null,
        type: s.type || null,
        note: 'Quét từ developers.facebook.com',
        createdAt: new Date().toISOString(),
        pages: [],
      });
      added++;
    }
  }
  if (added || updated) writeConfig(accountKey(accountId), { apps: apps.slice(0, 50) }, database);
  return { added, updated, total: apps.length };
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
  // TIMEOUT BẮT BUỘC: fetch treo (mạng chợp) không có timeout làm watcher
  // kẹt busy vĩnh viễn — mọi chu kỳ sau bị bỏ (lỗi 2026-10-06)
  const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(10000) });
  const data = await res.json().catch(() => ({}));
  return data;
}

// ── Messenger Profile API: tên + avatar thật của khách theo PSID ──
// GET /<PSID>?fields=first_name,last_name,profile_pic là endpoint DUY NHẤT
// Facebook cấp cho Page: KHÔNG có username/profile URL/UID toàn cục — link
// profile chỉ lấy được qua scrape DOM (page_content.js).
async function fetchMessengerCustomerProfile(sourceId, psid, database = getDb()) {
  try {
    const token = InboxSourceService.getDecryptedToken(sourceId, database);
    if (!token) return null;
    const res = await graphGet(String(psid), {
      fields: 'first_name,last_name,profile_pic',
      access_token: token,
    }, database);
    if (!res || res.error) {
      if (res?.error) console.warn(`[PageApi] Lấy profile khách psid=${psid} lỗi:`, res.error.message);
      return null;
    }
    const name = [res.first_name, res.last_name].filter(Boolean).join(' ').trim() || null;
    const profilePic = typeof res.profile_pic === 'string' && res.profile_pic.startsWith('http') ? res.profile_pic : null;
    if (!name && !profilePic) return null;
    return { name, profile_pic: profilePic };
  } catch (err) {
    console.warn(`[PageApi] Lấy profile khách psid=${psid} lỗi:`, err.message);
    return null;
  }
}

// Làm giàu contacts (tên + avatar) cho thread Page. Chỉ chạy khi contacts
// chưa có tên thật — 1 call Graph/PSID trong đời. Fire-and-forget từ webhook
// và REQUEST_SYNC_THREAD_MESSAGES; emit CONTACT_UPDATED cho UI tự refresh.
const inFlightCustomerProfiles = new Set();
async function enrichPageContactProfile(threadId, sourceId, psid, io, database = getDb()) {
  const key = `${sourceId}:${psid}`;
  if (inFlightCustomerProfiles.has(key)) return;
  const existing = database.prepare('SELECT name FROM contacts WHERE thread_id = ?').get(threadId);
  if (existing?.name && existing.name !== 'Khách hàng') return;
  inFlightCustomerProfiles.add(key);
  try {
    const profile = await fetchMessengerCustomerProfile(sourceId, psid, database);
    if (!profile) return;
    let localAvatarPath = null;
    if (profile.profile_pic) {
      localAvatarPath = await saveAvatarFromBase64OrUrl(profile.profile_pic, threadId);
    }
    if (profile.name) {
      database.prepare('UPDATE threads SET contact_name = ? WHERE id = ?').run(profile.name, threadId);
    }
    database.prepare(`
      INSERT INTO contacts (thread_id, name, avatar_url)
      VALUES (?, ?, ?)
      ON CONFLICT(thread_id) DO UPDATE SET
        name = COALESCE(excluded.name, contacts.name),
        avatar_url = COALESCE(excluded.avatar_url, contacts.avatar_url)
    `).run(threadId, profile.name, localAvatarPath);
    if (io) {
      io.emit('CONTACT_UPDATED', {
        thread_id: threadId,
        ...(profile.name ? { name: profile.name } : {}),
        ...(localAvatarPath ? { avatar_url: localAvatarPath } : {})
      });
    }
    console.log(`[PageApi] 👤 Profile khách psid=${psid} thread=${threadId}: name="${profile.name || '-'}" avatar=${localAvatarPath ? 'OK' : 'không tải được'}`);
  } finally {
    inFlightCustomerProfiles.delete(key);
  }
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
    signal: AbortSignal.timeout(20000),
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (data.error) {
    // Meta xác nhận ngoài cửa sổ 24h (tính từ tin cuối CỦA KHÁCH): code 10 /
    // subcode 2018001. Cờ fallbackToDom để luồng gửi chuyển sang DOM Business Suite.
    const outside24h = data.error.code === 10 && data.error.error_subcode === 2018001;
    console.warn(`[PageApi] Gửi tin lỗi cho page ${source.external_id}:`, data.error.message);
    return {
      success: false,
      error: data.error.error_data?.message || data.error.message || 'Graph API lỗi không rõ',
      errorCode: data.error.code ? `GRAPH_${data.error.code}` : 'GRAPH_ERROR',
      errorSubcode: data.error.error_subcode || null,
      fallbackToDom: outside24h,
      reason: outside24h ? 'OUTSIDE_24H' : null,
    };
  }
  return { success: true, messageId: data.message_id || null, recipientId: data.recipient_id || null };
}

// PSID của khách từ thread id — hệ thống dùng bare-first: id thường là PSID,
// trùng hội thoại thì repo đổi thành page:<pageId>:<psid>.
function bareThreadId(threadId) {
  return String(threadId || '').includes(':') ? String(threadId).split(':').pop() : String(threadId || '');
}

// Cửa sổ trả lời 24h của Messenger Platform — tính từ tin cuối CỦA KHÁCH
// (is_outgoing = 0), không tính tin page gửi. Dùng tại thời điểm xử lý từng
// tin để quyết định gửi API hay chuyển DOM (không quyết trước lúc enqueue).
const PAGE_REPLY_WINDOW_MS = 24 * 3600 * 1000;

function getLastCustomerMessageAt(threadId, database = getDb()) {
  const row = database.prepare(
    'SELECT MAX(timestamp_ms) AS last_ts FROM messages WHERE thread_id = ? AND is_outgoing = 0'
  ).get(threadId);
  const lastTs = row && row.last_ts ? Number(row.last_ts) : 0;
  return lastTs > 0 ? lastTs : null;
}

function classifyReplyWindow(threadId, database = getDb()) {
  const lastCustomerMessageAt = getLastCustomerMessageAt(threadId, database);
  if (lastCustomerMessageAt == null) return { status: 'unknown', lastCustomerMessageAt: null };
  const status = Date.now() - lastCustomerMessageAt > PAGE_REPLY_WINDOW_MS ? 'outside' : 'within';
  return { status, lastCustomerMessageAt };
}

// ── Đăng ký page vào webhook của app (bằng Page token qua Graph) ──
// Đây là bước QUYẾT ĐỊNH để Meta đẩy tin khách về webhook — thiếu bước này thì
// gửi tin được nhưng khách nhắn không bao giờ về CRM (báo lỗi 2026-10-05).
// messaging_referrals: Meta đẩy event referral khi khách bấm quảng cáo mở hội
// thoại — payload có post_id/ad_id để dựng link bài viết quảng cáo hiển thị
// thay cho text "X đã trả lời một quảng cáo." (yêu cầu 2026-10-08).
const PAGE_SUBSCRIBE_FIELDS = ['messages', 'messaging_postbacks', 'message_reads', 'message_deliveries', 'message_reactions', 'messaging_referrals'];

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

// Danh sách page id ĐÃ CÓ trong hệ thống (mọi owner, mọi trạng thái) —
// dùng bởi "Đồng bộ page mới": chỉ thêm page chưa thấy, bỏ qua page đã cào.
function knownPageIds(database = getDb()) {
  return database.prepare(
    "SELECT external_id FROM inbox_sources WHERE source_type = 'page_messenger'"
  ).all().map((r) => String(r.external_id));
}

// Gắn lại page ĐÃ CÓ về account đang chạy Đồng bộ. Xóa account cũ làm page bị
// chuyển cho account khác hoặc mồ côi (removeAccount) — nếu Đồng bộ bỏ qua page
// đã known thì page cũ mãi không hiện lại trong popup của account login lại.
// Trả về số page thực sự đổi chủ.
function reclaimPages(accountId, pageIds, database = getDb()) {
  if (!accountId) return 0;
  let changed = 0;
  for (const pageId of pageIds || []) {
    if (!pageId) continue;
    const existing = database.prepare(
      "SELECT id, owner_account_id FROM inbox_sources WHERE source_type = 'page_messenger' AND external_id = ?"
    ).get(String(pageId));
    if (!existing || existing.owner_account_id === String(accountId)) continue;
    upsertPages(accountId, [{ pageId: String(pageId) }], database);
    changed++;
  }
  return changed;
}

// ── Backfill hội thoại của 1 page từ Graph API ──
// Đồng bộ N hội thoại gần nhất + tin nhắn của từng hội thoại vào CRM.
async function backfillConversations(sourceId, io, options = {}, database = getDb()) {
  const source = InboxSourceService.getSourceById(sourceId, database);
  const token = InboxSourceService.getDecryptedToken(sourceId, database);
  if (!source || !token) return { ok: false, reason: 'NO_TOKEN' };
  const pageId = String(source.external_id);
  // account_id nullable từ 2026-10-07: page mồ côi (chưa có chủ) thì KHÔNG đổ
  // pageId vào account_id — trước đây fallback này gây FOREIGN KEY constraint
  // failed (pageId không phải account thật) và mất toàn bộ tin.
  const accountId = source.owner_account_id ? String(source.owner_account_id) : null;
  const convLimit = Number(options.convLimit || 25);

  // Thread của source này thuộc về chủ HIỆN HÀNH — re-point những thread trước
  // đây bị bind vào account khác (vd account test cũ đã ngắt), nếu không CRM
  // sẽ không hiện hội thoại ở inbox của account đang dùng (báo lỗi 2026-10-06:
  // backfill về đủ 55 tin nhưng account_id là account cũ nên không thấy gì).
  if (accountId) {
    database.prepare(
      'UPDATE threads SET account_id = ? WHERE source_id = ? AND (account_id IS NULL OR account_id != ?)'
    ).run(accountId, source.id, accountId);
  }

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
          await enrichAttachmentUrls(msg, token, database);
          const inserted = insertGraphMessage(thread.id, source, msg, database, { markUnread: true, io });
          if (inserted != null) insertedNew++;
          else if (backfillMediaUrlOnExistingRow(msg, database)) insertedNew++;
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

// Quét SĐT/email từ nội dung tin khách Page rồi điền cột thông tin khách
// hàng (contacts) — chỉ điền chỗ TRỐNG (COALESCE), không ghi đè giá trị đã có
// kể cả nhập tay. Dùng chung cho webhook/watcher/backfill và quét bù lịch sử.
function captureContactLeads({ threadId, accountId, messageId, content, timestampMs, contactName }, io, database = getDb()) {
  const results = { emails: [], createdCaptures: [], capturedThreadId: null };
  if (!messageId || !content) return results;

  const { emails } = extractLeadInfo(content);
  if (emails.length > 0) {
    database.prepare(`
      INSERT INTO contacts (thread_id, name, email)
      VALUES (?, ?, ?)
      ON CONFLICT(thread_id) DO UPDATE SET
        email = COALESCE(NULLIF(excluded.email,''), contacts.email)
    `).run(threadId, contactName || 'Khách hàng', emails[0] || null);
    results.emails = emails;
  }

  const { threadId: capturedThreadId, createdCaptures } = PhoneCaptureService.processIncomingMessage({
    threadId,
    accountId,
    messageId,
    content,
    messageTimestampMs: timestampMs
  }, { database });
  results.capturedThreadId = capturedThreadId;
  results.createdCaptures = createdCaptures || [];

  if (io && (emails.length > 0 || results.createdCaptures.length > 0)) {
    io.emit('LEAD_EXTRACTED', {
      thread_id: threadId,
      phones: results.createdCaptures.map((c) => c.normalized_phone),
      emails
    });
    if (results.createdCaptures.length > 0) {
      const phoneView = PhoneCaptureService.getContactPhoneView(capturedThreadId, database);
      io.emit('PHONE_CAPTURED', {
        thread_id: capturedThreadId,
        captures: results.createdCaptures.map((c) => ({
          id: c.id,
          normalized_phone: c.normalized_phone,
          raw_phone: c.raw_phone,
          message_id: c.message_id,
          message_timestamp_ms: c.message_timestamp_ms,
          selection_state: c.selection_state
        })),
        phone: phoneView.phone,
        phone_source: phoneView.phone_source,
        phone_captured_at: phoneView.phone_captured_at,
        phone_capture: phoneView.phone_capture,
        phone_candidates: phoneView.phone_candidates
      });
    }
    io.emit('CONTACT_UPDATED', { thread_id: threadId });
  }
  return results;
}
// Bắt sdt/email từ tin khách đến Page — cùng hành vi pipeline Messenger cá
// nhân (server.js chạy PhoneCaptureService + extractLeadInfo cho từng tin
// incoming): lấp phone/email TRỐNG của contact, không ghi đè giá trị đã có,
// rồi chạy tiếp global automation + campaign policy và bắn event cho UI.
function captureLeadInfoFromGraph(threadId, source, messageId, text, tsMs, database, io) {
  let emails = [];
  let createdCaptures = [];
  try {
    ({ emails } = extractLeadInfo(text));
    ({ createdCaptures } = PhoneCaptureService.processIncomingMessage({
      threadId,
      accountId: source.owner_account_id || null,
      messageId,
      content: text,
      messageTimestampMs: tsMs
    }, { database }));
    if (emails.length > 0) {
      database.prepare(`
        INSERT INTO contacts (thread_id, name, email)
        VALUES (?, ?, ?)
        ON CONFLICT(thread_id) DO UPDATE SET
          email = COALESCE(NULLIF(excluded.email,''), contacts.email)
      `).run(threadId, 'Khách hàng', emails[0] || null);
    }
  } catch (err) {
    console.warn('[PageApi] Bắt sdt/email lỗi:', err.message);
    return;
  }
  if (!emails.length && !createdCaptures.length) return;

  if (io) {
    io.emit('LEAD_EXTRACTED', {
      thread_id: threadId,
      phones: createdCaptures.map((c) => c.normalized_phone),
      emails
    });
  }

  // Global CRM rule (opt-in) + policy campaign — copy khối xử lý sau-bắt-được
  // của pipeline Messenger cá nhân (server.js) để Page hành xử y hệt.
  try {
    const globalPhoneAutomation = GlobalPhoneAutomationService.applyCaptures(threadId, createdCaptures, database);
    if (globalPhoneAutomation.applied) {
      console.log(`[PageApi] Global automation áp status ${globalPhoneAutomation.settings.status_id} cho ${threadId}`);
    }
  } catch (err) {
    console.warn('[PageApi] Global phone automation lỗi:', err.message);
  }

  if (createdCaptures.length && io) {
    const phoneView = PhoneCaptureService.getContactPhoneView(threadId, database);
    io.emit('PHONE_CAPTURED', {
      thread_id: threadId,
      captures: createdCaptures.map((c) => ({
        id: c.id,
        normalized_phone: c.normalized_phone,
        raw_phone: c.raw_phone,
        message_id: c.message_id,
        message_timestamp_ms: c.message_timestamp_ms,
        selection_state: c.selection_state
      })),
      phone: phoneView.phone,
      phone_source: phoneView.phone_source,
      phone_captured_at: phoneView.phone_captured_at,
      phone_capture: phoneView.phone_capture,
      phone_candidates: phoneView.phone_candidates
    });
    io.emit('CONTACT_UPDATED', { thread_id: threadId });

    // Thống kê campaign trả lời (tin có bắt được sdt tính là phản hồi).
    try {
      const capturedMessage = database.prepare('SELECT id FROM messages WHERE fb_message_id = ?').get(messageId);
      if (capturedMessage?.id) {
        const immediateCampaignResponse = CampaignResponseStatsService.recordIncomingResponse({
          messageId: capturedMessage.id,
          threadId,
          accountId: source.owner_account_id || null,
          observedAtMs: tsMs || Date.now()
        }, database);
        if (immediateCampaignResponse) {
          io.emit('CAMPAIGN_RESPONSE_UPDATED', { ...immediateCampaignResponse, thread_id: threadId, phone_captured: true });
        }
      }
    } catch (err) {
      console.warn('[PageApi] Campaign response stats lỗi:', err.message);
    }
  }

  // Campaign phone-capture policy (stop_remaining / thank_then_stop) — bất
  // đồng bộ, không chặn webhook; queue gửi tự route Page qua Graph API.
  if (createdCaptures.length) {
    CampaignPhoneCaptureService.handleCaptures(threadId, createdCaptures, {
      database,
      capabilityOptions: { database, getConnection: () => null }
    }).then((affectedCampaignIds) => {
      if (!io) return;
      for (const campaignId of affectedCampaignIds) {
        CampaignEventService.emit(io, CampaignRepository.getCampaign(campaignId, database));
      }
    }).catch((err) => {
      console.error('[PageApi] Campaign policy sau khi bắt sdt lỗi:', err.message);
    });
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

  // Đánh dấu chưa đọc CHỈ khi tin MỚI HƠN mọi tin hiện có của thread: wave
  // quét trễ chèn lại tin ĐÃ xem (ts backdate <= mốc cũ) không được đè cờ
  // "đã đọc" (unread_manual=-1) của operator — chấm chưa đọc hồi sinh sau
  // khi đọc xong (reproduce 2026-10-07 17:37).
  const shouldMarkUnread = opts.markUnread && !isOutgoing
    && ts > Number(database.prepare(
      'SELECT MAX(COALESCE(timestamp_ms, 0)) AS m FROM messages WHERE thread_id = ?'
    ).get(threadId)?.m || 0);

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

  // Tin khách đến có text: bắt sdt/email (parity Messenger cá nhân).
  if (!isOutgoing && text) {
    captureLeadInfoFromGraph(threadId, source, messageId, text, ts, database, opts.io || null);
  }

  // Tin khách đến REALTIME (watcher/webhook): đánh dấu chưa đọc để hội thoại
  // đẩy lên đầu danh sách (sort unread-first phía client). Backfill lịch sử
  // KHÔNG đánh dấu - import page không làm unread hàng loạt.
  if (shouldMarkUnread) {
    database.prepare("UPDATE threads SET is_unread = 1, unread_manual = 1 WHERE id = ?").run(threadId);
  }

  // Webhook event có thể về TRỄ (poll 5s + latency Meta) — tin gửi trước đang
  // chờ xử lý làm tin khách bị append SAI VỊ TRÍ (dưới tin operator gửi sau).
  // Chuẩn hóa sequence_order theo (timestamp_ms, id) để thứ tự bubble đúng
  // tuyệt đối — client chèn tin mới theo sequence nên live view cũng tự đúng.
  resequenceThreadByTimestamp(threadId, database);

  // Tin KHÁCH đến có text: quét SĐT/email điền vào cột thông tin khách hàng.
  // Đây là điểm hội tụ duy nhất của webhook/watcher/backfill nên gắn một chỗ
  // là phủ hết mọi đường. Echo/tin operator (isOutgoing) bị bỏ qua.
  if (!isOutgoing && text) {
    captureContactLeads({
      threadId,
      accountId: source.owner_account_id ? String(source.owner_account_id) : null,
      messageId,
      content: text,
      timestampMs: ts
    }, opts.io || null, database);
  }

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

function mediaUrlOf(msg) {
  const att = (msg.attachments?.data || [])[0];
  if (!att) return null;
  return att.image_url || att.video_url || att.audio_url || att.file_url || null;
}

// Graph /messages KHÔNG trả URL cho attachment (chỉ mime_type + id) — phải gọi
// /{mid}/attachments để lấy image_data.url / video_data.url / file_url thật,
// không thì ảnh/video về CRM trắng (lỗi 2026-10-06). Ném lỗi khi Graph trả error
// để caller thử lại chu kỳ sau; trả về im lặng khi attachment rỗng (đã xóa).
async function enrichAttachmentUrls(msg, token, database) {
  const att = (msg.attachments?.data || [])[0];
  if (!att || !att.id) return;
  if (att.image_url || att.video_url || att.audio_url || att.file_url) return;
  const res = await graphGet(msg.id + '/attachments', {
    fields: 'mime_type,name,image_data,video_data,audio_data,file_url',
    access_token: token,
  }, database);
  if (res.error) throw new Error('attachments LỖI: ' + (res.error.message || ''));
  const full = (res.data || [])[0];
  if (!full) return;
  if (full.image_data?.url) att.image_url = full.image_data.url;
  if (full.video_data?.url) att.video_url = full.video_data.url;
  else if (full.video_data?.preview_url) att.video_url = full.video_data.preview_url;
  if (full.audio_data?.url) att.audio_url = full.audio_data.url;
  if (full.file_url) att.file_url = full.file_url;
}

// Chèn media URL vào row đã tồn tại (trước fix từng lưu media_url NULL) — trả
// true nếu có sửa để caller tính là tin mới (client cần refetch hiển thị ảnh).
function backfillMediaUrlOnExistingRow(msg, database) {
  const url = mediaUrlOf(msg);
  if (!url || !msg.id) return false;
  const upd = database.prepare(`
    UPDATE messages SET media_url = ?
    WHERE fb_message_id = ? AND (media_url IS NULL OR media_url = '')
  `).run(url, String(msg.id));
  return upd.changes > 0;
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
        applyAdReferral(event, source, io, database);
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

// ── Referral quảng cáo (messaging_referrals) ──
// Khách bấm quảng cáo mở hội thoại: Meta đẩy event referral (dạng referral-only,
// postback, hoặc message kèm referral). Lưu link bài viết quảng cáo lên THREAD —
// tin "X đã trả lời một quảng cáo." kéo về từ Graph watcher chỉ là text trơ
// không có thông tin quảng cáo, nên link phải bắt từ webhook lúc mở hội thoại.
// Chạy TRƯỚC processMessagingEvent vì event referral-only không có message.
function buildAdPostLink(referral, pageId) {
  if (!referral) return null;
  const ctx = referral.ads_context_data || {};
  const postId = String(ctx.post_id || referral.post_id || '').trim();
  const adId = String(referral.ad_id || ctx.ad_id || '').trim();
  if (postId) {
    if (postId.includes('_')) {
      const [owner, story] = postId.split('_');
      return `https://www.facebook.com/permalink.php?story_fbid=${encodeURIComponent(story)}&id=${encodeURIComponent(owner)}`;
    }
    if (pageId) {
      return `https://www.facebook.com/permalink.php?story_fbid=${encodeURIComponent(postId)}&id=${encodeURIComponent(String(pageId))}`;
    }
  }
  if (adId) return `https://www.facebook.com/ads/library/?id=${encodeURIComponent(adId)}`;
  return null;
}

function applyAdReferral(event, source, io, database) {
  try {
    const referral = event.referral || event.postback?.referral || event.message?.referral || null;
    if (!referral || String(referral.source || '').toUpperCase() !== 'ADS') return false;
    const contactPsid = String(event.sender?.id || '');
    if (!contactPsid) return false;
    const ctx = referral.ads_context_data || {};
    const link = buildAdPostLink(referral, source.external_id);
    const title = String(ctx.ad_title || '').trim();
    const photo = String(ctx.photo_url || ctx.picture || '').trim();
    if (!link && !title && !photo) return false;
    const thread = ensurePageThread(source, contactPsid, null, database);
    if (!thread) return false;
    database.prepare(`
      UPDATE threads SET
        ad_post_link = COALESCE(NULLIF(?, ''), ad_post_link),
        ad_title = COALESCE(NULLIF(?, ''), ad_title),
        ad_photo_url = COALESCE(NULLIF(?, ''), ad_photo_url)
      WHERE id = ?
    `).run(link || '', title, photo, thread.id);
    console.log('[PageApi] 📣 Referral quảng cáo: thread=' + thread.id + ' link=' + (link || '(không rõ)'));
    if (io) io.emit('THREAD_LIST_UPDATED', { thread_id: thread.id, account_id: thread.account_id });
    return true;
  } catch (err) {
    console.warn('[PageApi] Lỗi xử lý referral quảng cáo: ' + (err && err.message));
    return false;
  }
}

// Đăng ký LẠI webhook fields cho mọi page có token khi server khởi động —
// thêm field mới (messaging_referrals) thì page cũ phải re-subscribe mới nhận
// event; page mới gắn sau này đã được subscribePage trong backfill lo.
async function resubscribeAllPages(database = getDb()) {
  const sources = database.prepare(`
    SELECT id FROM inbox_sources
    WHERE source_type = 'page_messenger' AND status = 'ACTIVE' AND access_token_encrypted IS NOT NULL
  `).all();
  let ok = 0;
  for (const s of sources) {
    const r = await subscribePage(s.id, database).catch(() => ({ ok: false }));
    if (r && r.ok) ok++;
  }
  console.log(`[PageApi] 📡 Re-subscribe webhook fields: ${ok}/${sources.length} page OK.`);
  return { total: sources.length, ok };
}

// ── B1+B2: nối hội thoại page về thread cũ t_<conv> của extension ──
// B0 verify 2026-10-19: Graph trả conv.id trùng phần số với thread cũ
// (405/684 conv khớp `t_...` cùng source). Biết conv id thì ghi tin vào
// thread cũ — không tạo thêm thread psid song song (twin) nữa.
const pageThreadCache = new Map(); // `${sourceId}:${psid}` -> threadId (ấm cho webhook, không cần biết conv)
const pageThreadCacheWarming = new Set(); // chống chồng Graph call warm cho cùng 1 psid
const loggedConvLinks = new Set(); // log 🔗 mỗi cặp conv→thread 1 lần
const MAX_PAGE_THREAD_CACHE = 10000;

function rememberPageThread(sourceId, psid, threadId) {
  if (!sourceId || !psid || !threadId) return;
  if (pageThreadCache.size > MAX_PAGE_THREAD_CACHE) pageThreadCache.clear();
  pageThreadCache.set(String(sourceId) + ':' + String(psid), String(threadId));
}

function resolveConvLinkedThread(source, convId, database) {
  const raw = String(convId || '').trim();
  const convKey = raw.replace(/^t_/, '');
  if (!raw || !convKey) return null;
  const candidates = [raw, 't_' + convKey, convKey];
  return database.prepare(`
    SELECT id, COALESCE(external_thread_id, id) AS external_thread_id FROM threads
    WHERE source_id = ? AND (id IN (?, ?, ?) OR COALESCE(external_thread_id, '') IN (?, ?, ?))
    LIMIT 1
  `).get(source.id, ...candidates, ...candidates) || null;
}

// Webhook chỉ biết psid. Fire-and-forget: hỏi Graph conv của psid 1 lần rồi
// ghim kết quả vào cache — event sau nhảy thẳng vào thread cũ, hết tạo twin.
async function warmPageThreadCache(source, contactPsid, fallbackThreadId, database) {
  const cacheKey = source.id + ':' + contactPsid;
  try {
    const token = InboxSourceService.getDecryptedToken(source.id, database);
    if (!token) return;
    const data = await graphGet(source.external_id + '/conversations', {
      user_id: contactPsid,
      fields: 'id',
      limit: '1',
      access_token: token,
    }, database);
    if (data.error) return;
    const convId = data.data?.[0]?.id;
    if (convId) {
      const linked = resolveConvLinkedThread(source, convId, database);
      if (linked) {
        rememberPageThread(source.id, contactPsid, linked.id);
        console.log('[PageApi] 🔗 webhook psid=' + contactPsid + ' → thread cũ ' + linked.id + ' (conv=' + convId + ', page=' + source.external_id + ')');
        return;
      }
    }
    if (fallbackThreadId) rememberPageThread(source.id, contactPsid, fallbackThreadId);
  } catch (_) {
    // mạng/token lỗi — event sau sẽ warm lại
  } finally {
    pageThreadCacheWarming.delete(cacheKey);
  }
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

  // B2: tra cache ấm trước — watcher/warm đã ghim thread cũ t_<conv> cho psid
  // này thì tin đổ thẳng vào thread cũ, không tạo twin psid nữa. Cache trượt
  // thì rơi về logic psid cũ và kích hoạt warm (fire-and-forget) cho event sau.
  const cacheKey = source.id + ':' + contactPsid;
  let cachedThread = pageThreadCache.has(cacheKey)
    ? ConversationRepository.getThread(pageThreadCache.get(cacheKey), database)
    : null;
  if (cachedThread && String(cachedThread.source_id || '') !== String(source.id)) cachedThread = null;

  // Đa page / đa account: cùng một khách có thể nhắn NHIỀU page (thậm chí
  // qua account khác) — thread bare psid đã tồn tại ở nguồn KHÁC thì buộc
  // namespacing page:<pageId>:<psid> ngay từ đầu, tránh INSERT trùng khóa.
  let threadId = contactPsid;
  let externalThreadId = contactPsid;
  if (cachedThread) {
    threadId = cachedThread.id;
    // external_thread_id thật của thread cũ (t_...): khiến upsertThread khớp
    // đúng row thread cũ, không đụng thread psid nào khác trong cùng source.
    externalThreadId = String(cachedThread.external_thread_id || cachedThread.id);
  } else {
    const clash = database.prepare(
      "SELECT id, source_id, account_id FROM threads WHERE id = ? OR COALESCE(external_thread_id, '') = ?"
    ).get(contactPsid, contactPsid);
    if (clash && String(clash.source_id || '') !== String(source.id)) {
      threadId = 'page:' + pageId + ':' + contactPsid;
    }
  }

  const thread = ConversationRepository.upsertThread({
    id: threadId,
    account_id: source.owner_account_id || null,
    source_id: source.id,
    external_thread_id: externalThreadId,
    contact_name: null,
    last_message: (text || '[Đính kèm]').substring(0, 200),
    is_unread: isOutgoing ? 0 : 1,
  }, database);
  if (!thread) return null;
  rememberPageThread(source.id, contactPsid, thread.id);
  if (!cachedThread && !pageThreadCacheWarming.has(cacheKey)) {
    pageThreadCacheWarming.add(cacheKey);
    warmPageThreadCache(source, contactPsid, thread.id, database);
  }
  if (!thread.source_id) {
    database.prepare('UPDATE threads SET source_id = ? WHERE id = ?').run(source.id, thread.id);
  }
  // Fire-and-forget: tự skip nếu contacts đã có tên thật hoặc đang fetch
  enrichPageContactProfile(thread.id, source.id, contactPsid, io, database).catch(() => {});
  // Thread của source thuộc về chủ hiện hành — re-point nếu trước đây bị bind
  // vào account khác (account test cũ), ngược lại tin đổ vào account chết và
  // inbox của account đang dùng không thấy gì. Page chưa có chủ thì giữ nguyên.
  const webhookOwnerId = source.owner_account_id ? String(source.owner_account_id) : null;
  if (webhookOwnerId) {
    database.prepare(
      'UPDATE threads SET account_id = ? WHERE id = ? AND (account_id IS NULL OR account_id != ?)'
    ).run(webhookOwnerId, thread.id, webhookOwnerId);
  }

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
  }, database, { senderId: senderPsid, io });

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

function ensurePageThread(source, contactPsid, contactName, database, { convId } = {}) {
  // B1: biết conv id (watcher) → tra thread cũ t_<conv> trước. Thấy thì ghi
  // thẳng vào thread cũ — hết tạo twin psid song song với hội thoại trên web.
  const linked = convId ? resolveConvLinkedThread(source, convId, database) : null;
  if (linked) {
    const incomingName = String(contactName || '').trim();
    database.prepare(
      'UPDATE threads SET contact_name = COALESCE(?, contact_name), is_unread = 0 WHERE id = ?'
    ).run(incomingName && incomingName !== 'Khách hàng' ? incomingName : null, linked.id);
    const linkedThread = ConversationRepository.getThread(linked.id, database);
    if (!linkedThread) return null;
    rememberPageThread(source.id, contactPsid, linkedThread.id);
    const linkLogKey = convId + '→' + linkedThread.id;
    if (!loggedConvLinks.has(linkLogKey)) {
      if (loggedConvLinks.size > 5000) loggedConvLinks.clear();
      loggedConvLinks.add(linkLogKey);
      watcherLog('🔗 conv=' + convId + ' → thread cũ ' + linkedThread.id + ' (psid=' + contactPsid + ')');
    }
    enrichPageContactProfile(linkedThread.id, source.id, contactPsid, null, database).catch(() => {});
    const linkedOwnerId = source.owner_account_id ? String(source.owner_account_id) : null;
    if (linkedOwnerId) {
      database.prepare(
        'UPDATE threads SET account_id = ? WHERE id = ? AND (account_id IS NULL OR account_id != ?)'
      ).run(linkedOwnerId, linkedThread.id, linkedOwnerId);
    }
    return linkedThread;
  }
  let threadId = contactPsid;
  const clash = database.prepare(
    "SELECT id, source_id FROM threads WHERE id = ? OR COALESCE(external_thread_id, '') = ?"
  ).get(contactPsid, contactPsid);
  if (clash && String(clash.source_id || '') !== String(source.id)) {
    threadId = 'page:' + source.external_id + ':' + contactPsid;
  }
  const thread = ConversationRepository.upsertThread({
    id: threadId,
    account_id: source.owner_account_id || null,
    source_id: source.id,
    external_thread_id: contactPsid,
    contact_name: contactName || null,
    is_unread: 0,
  }, database);
  if (!thread) return null;
  rememberPageThread(source.id, contactPsid, thread.id);
  if (!thread.source_id) {
    database.prepare('UPDATE threads SET source_id = ? WHERE id = ?').run(source.id, thread.id);
  }
  // Watcher/referral không emit trực tiếp — persist; UI tự nạp ở lần refresh
  enrichPageContactProfile(thread.id, source.id, contactPsid, null, database).catch(() => {});
  // owner_account_id bắt buộc phải là account THẬT — FK threads.account_id → accounts.id.
  // Watcher từng SELECT thiếu cột owner_account_id khiến fallback ID page đổ vào
  // account_id → FOREIGN KEY constraint failed, mất toàn bộ tin (lỗi 2026-10-06).
  const ownerId = source.owner_account_id ? String(source.owner_account_id) : null;
  if (ownerId) {
    database.prepare(
      'UPDATE threads SET account_id = ? WHERE id = ? AND (account_id IS NULL OR account_id != ?)'
    ).run(ownerId, thread.id, ownerId);
  }
  return thread;
}

// Log watcher ra file — packaged app không thấy console, đây là mắt giám sát duy nhất
function watcherLog(msg) {
  console.log('[PageApi] 👀 ' + msg);
  try {
    const path = require('path');
    const { APP_DATA_ROOT } = require('../utils/appDataRoot');
    const { appendRotating } = require('../utils/rotatingDebugLog');
    appendRotating(path.join(APP_DATA_ROOT, 'page-api-runs.log'), JSON.stringify({ at: new Date().toISOString(), status: 'watcher', note: String(msg).slice(0, 300) }) + '\n', 10 * 1024 * 1024);
  } catch (_) {}
}

let pageWatcherCycleStartedAt = 0;

async function watchPageConversations(source, io, database) {
  const token = InboxSourceService.getDecryptedToken(source.id, database);
  if (!token) { watcherLog(source.external_id + ': bỏ qua — không có token'); return; }
  const data = await graphGet(source.external_id + '/conversations', {
    fields: 'id,updated_time,participants',
    limit: '25',
    access_token: token,
  }, database);
  if (data.error) { watcherLog(source.external_id + ' conversations LỖI: ' + (data.error.message || '') ); return; }
  let state = pageWatcherState.get(source.id);
  if (!state) { state = new Map(); pageWatcherState.set(source.id, state); }
  let insertedNew = 0;
  let failed = 0;
  for (const conv of (data.data || [])) {
    const participant = (conv.participants?.data || []).find((p) => String(p.id) !== String(source.external_id));
    const psid = participant?.id;
    if (!psid) {
      failed++;
      watcherLog('conv ' + conv.id + ' KHÔNG có participants khách — participants=' + JSON.stringify(conv.participants).slice(0, 150));
      continue;
    }
    const updated = new Date(conv.updated_time).getTime();
    if (state.get(conv.id) === updated) continue; // không đổi — bỏ qua
    // CHỈ đánh dấu updated SAU khi kéo + ghi tin THÀNH CÔNG — ném lỗi giữa
    // chừng (SQLITE_BUSY, trùng mid...) trước đây "đầu độc" state khiến hội
    // thoại bị bỏ qua vĩnh viễn (lỗi mất tin Síosss/xcxcxc 2026-10-06)
    try {
      const msgData = await graphGet(conv.id + '/messages', {
        fields: 'id,message,from,created_time,attachments{mime_type,image_url,video_url,audio_url,file_url}',
        limit: '25',
        access_token: token,
      }, database);
      if (msgData.error) { failed++; watcherLog('kéo tin conv ' + conv.id + ' LỖI: ' + (msgData.error.message || '')); continue; }
      const thread = ensurePageThread(source, psid, participant?.name || null, database, { convId: conv.id });
      if (!thread) { failed++; watcherLog('conv ' + conv.id + ': ensurePageThread trả null (psid=' + psid + ')'); continue; }
      for (const msg of (msgData.data || []).reverse()) {
        await enrichAttachmentUrls(msg, token, database);
        const id = insertGraphMessage(thread.id, source, msg, database, { markUnread: true, io });
        if (id != null) insertedNew++;
        else if (backfillMediaUrlOnExistingRow(msg, database)) insertedNew++;
      }
      const lastMsg = (msgData.data || [])[0];
      if (lastMsg) {
        ConversationRepository.touchThread(thread.id, (lastMsg.message || '[Đính kèm]').substring(0, 200), database);
      }
      state.set(conv.id, updated);
    } catch (err) {
      failed++;
      watcherLog('conv ' + conv.id + ' LỖI ngoại lệ: ' + String(err && (err.stack || err.message || err)).slice(0, 400));
    }
  }
  watcherLog(source.external_id + ': ' + (data.data || []).length + ' hội thoại, ' + insertedNew + ' tin mới' + (failed ? ', ' + failed + ' hội thoại lỗi' : ''));
  if (insertedNew > 0 && io) {
    io.emit('THREAD_LIST_UPDATED', { account_id: source.owner_account_id, new_messages: insertedNew, page_id: source.external_id });
    console.log('[PageApi] 🔄 Page ' + source.external_id + ': +' + insertedNew + ' tin mới về CRM');
  }
}

function startPageConversationWatcher(io, database = getDb(), intervalMs = 10000) {
  if (pageWatcherTimer) return;
  pageWatcherTimer = setInterval(async () => {
    if (pageWatcherBusy) {
      const stuckMs = Date.now() - pageWatcherCycleStartedAt;
      if (stuckMs < 60000) return; // chu kỳ trước còn chạy — bỏ tick, KHÔNG chạy song song
      console.warn('[PageApi] Chu kỳ watcher kẹt ' + stuckMs + 'ms — mở khóa cưỡng bức.');
      pageWatcherBusy = false;
    }
    pageWatcherBusy = true;
    pageWatcherCycleStartedAt = Date.now();
    try {
      const sources = database.prepare(`
        SELECT id, external_id, display_name, owner_account_id FROM inbox_sources
        WHERE source_type = 'page_messenger' AND status = 'ACTIVE' AND access_token_encrypted IS NOT NULL
      `).all();
      // Quét SONG SONG 5 page/lượt thay vì lần lượt: 18 page tuần tự mất
      // ~12-25s/vòng -> tin khách về chậm tới nửa phút; song song còn ~4-6s
      // (reproduce 2026-10-07 17:07: tin khách về sau ~12s chờ). Mỗi page vẫn
      // try/catch riêng - một page lỗi không ảnh hưởng page khác.
      const WATCHER_CONCURRENCY = 5;
      let pageCursor = 0;
      const watcherWorker = async () => {
        while (pageCursor < sources.length) {
          const s = sources[pageCursor++];
          try {
            await watchPageConversations(s, io, database);
          } catch (err) {
            watcherLog('CHU KỲ LỖI page ' + s.external_id + ': ' + String(err && (err.stack || err.message || err)).slice(0, 400));
          }
          await new Promise((r2) => setTimeout(r2, 120));
        }
      };
      const workers = [];
      for (let i = 0; i < Math.min(WATCHER_CONCURRENCY, sources.length); i++) workers.push(watcherWorker());
      await Promise.all(workers);
    } catch (err) {
      watcherLog('CHU KỲ LỖI chung: ' + String(err && (err.stack || err.message || err)).slice(0, 400));
    }
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

// Quét bù 1 lần SĐT/email cho tin Page CŨ đã nằm trong data (khách nhắn trước
// khi bật capture). Chạy nền sau khi khởi động, idempotent: bộ capture chỉ
// điền chỗ trống + chống trùng (message_id, số) nên chạy lại không sinh dữ
// liệu thừa; thread đã đủ phone+email tự rớt khỏi danh sách các lần sau.
async function backfillHistoricalContactLeads(io, database = getDb()) {
  const rows = database.prepare(`
    SELECT DISTINCT m.thread_id AS thread_id, t.account_id AS account_id
    FROM messages m
    JOIN threads t ON t.id = m.thread_id
    JOIN inbox_sources s ON s.id = t.source_id
    LEFT JOIN contacts c ON c.thread_id = m.thread_id
    WHERE s.source_type = 'page_messenger'
      AND m.is_outgoing = 0
      AND m.fb_message_id IS NOT NULL
      AND m.content IS NOT NULL AND TRIM(m.content) != ''
      AND (c.phone IS NULL OR c.phone = '' OR c.email IS NULL OR c.email = '')
  `).all();
  if (rows.length === 0) {
    console.log('[PageLeads] Quét bù: không có thread page nào cần điền SĐT/email.');
    return { scanned: 0, filled: 0 };
  }
  console.log(`[PageLeads] Quét bù lịch sử: ${rows.length} thread cần rà...`);

  let filled = 0;
  for (let i = 0; i < rows.length; i++) {
    const { thread_id, account_id } = rows[i];
    const msgs = database.prepare(`
      SELECT fb_message_id, content, timestamp_ms FROM messages
      WHERE thread_id = ? AND is_outgoing = 0
        AND fb_message_id IS NOT NULL
        AND content IS NOT NULL AND TRIM(content) != ''
      ORDER BY COALESCE(timestamp_ms, 0) ASC, id ASC
    `).all(thread_id);
    let threadFilled = false;
    for (const m of msgs) {
      // Không bắn socket trong lúc quét (tránh bão event) — bắn 1 CONTACT_UPDATED
      // cho cả thread ở cuối; UI đang mở sẽ tự refetch thông tin khách hàng.
      const r = captureContactLeads({
        threadId: thread_id,
        accountId: account_id ? String(account_id) : null,
        messageId: m.fb_message_id,
        content: m.content,
        timestampMs: m.timestamp_ms
      }, null, database);
      if (r.emails.length > 0 || r.createdCaptures.length > 0) threadFilled = true;
    }
    if (threadFilled) {
      filled++;
      if (io) io.emit('CONTACT_UPDATED', { thread_id });
    }
    // Nhả event loop giữa các thread — không chặn watcher/backfill/UI
    if (i % 10 === 9) await new Promise((r2) => setTimeout(r2, 50));
  }
  console.log(`[PageLeads] ✅ Quét bù xong: ${filled}/${rows.length} thread đã điền SĐT/email vào thông tin khách hàng.`);
  return { scanned: rows.length, filled };
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
  appMergeScanned,
  upsertPages,
  listPages,
  savePages,
  sendPageMessage,
  fetchMessengerCustomerProfile,
  enrichPageContactProfile,
  getLastCustomerMessageAt,
  classifyReplyWindow,
  PAGE_REPLY_WINDOW_MS,
  subscribePage,
  resubscribeAllPages,
  clearPageTokens,
  removeAccountPages,
  knownPageIds,
  reclaimPages,
  backfillConversations,
  handleWebhookBody,
  buildAdPostLink,
  applyAdReferral,
  startBridgePolling,
  startPageConversationWatcher,
  watchPageConversations,
  stopPageConversationWatcher,
  stopBridgePolling,
  backfillHistoricalContactLeads,
  GRAPH_VERSION,
};
