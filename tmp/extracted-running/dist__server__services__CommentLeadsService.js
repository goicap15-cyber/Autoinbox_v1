/**
 * CommentLeadsService — quét khách bình luận bài viết qua API Viet Seeding
 * (api.vietseeding.com/api/export/comment-leads/by-post) rồi đưa lần tiếp cận
 * đầu tiên vào hàng đợi tin nhắn Messenger cá nhân (QueueWorker chạy 24/7).
 *
 * Luồng:
 *   scanPost:   POST /by-post/scan {url}  -> 202 chấp nhận quét (409 = đang quét)
 *   fetchLeads: GET  /by-post?url=&limit= -> status queued|running (chưa xong),
 *               idle (xong, có accounts[]), error (bài quét lỗi)
 *   enqueue:    mỗi lead 'new'/'failed' của bài: tạo thread id=uid (hoặc nhận
 *               id chuẩn hoá từ upsertThread) + thread_url /messages/t/<uid>,
 *               đẩy message_queue + row tin pending (insertCampaignDispatch).
 *               QueueWorker gửi lần lượt khi Chrome của account đang chạy.
 *   Trả lời:    replyWatcher quét messages is_outgoing=0 sau sent_at -> lead
 *               chuyển 'replied' + emit COMMENT_LEAD_REPLIED.
 *
 * API key tái dùng KV 'vietseeding:global' (chung với nhập cookie). Key không
 * bao giờ được log hay trả về UI.
 */
const fs = require('fs');
const path = require('path');
const { APP_DATA_ROOT } = require('../utils/appDataRoot');
let defaultDb;
function getDb() {
  if (!defaultDb) defaultDb = require('../database/db');
  return defaultDb;
}

// stdout của app đóng gói bị mất — log thô request/response API ra file
// để chẩn đoán được "không lấy được user" mà không cần console.
const DEBUG_LOG_PATH = path.join(APP_DATA_ROOT, 'comment-leads-debug.log');
function debugLog(message) {
  try { fs.appendFileSync(DEBUG_LOG_PATH, `${new Date().toISOString()} ${message}\n`); } catch (_) {}
}

const CONFIG_KEY = 'vietseeding:global';
const DEFAULT_BASE = 'https://api.vietseeding.com';
const FETCH_TIMEOUT_MS = 90 * 1000;
const BY_POST_LIMIT = 500;
// Tin mặc định đẩy vào "Tin nhắn chờ" của khách khi UI không gửi nội dung.
const DEFAULT_MESSAGE_TEMPLATE = 'Chào {ten}! Mình thấy bạn vừa bình luận bên bài viết của shop. Bạn đang quan tâm sản phẩm nào ạ?';

function ensureKvSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS page_api_config (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function readConfig(database = getDb()) {
  ensureKvSchema(database);
  const row = database.prepare('SELECT value FROM page_api_config WHERE key = ?').get(CONFIG_KEY);
  if (!row || !row.value) return {};
  try { return JSON.parse(row.value) || {}; } catch (_) { return {}; }
}

function getApiKey(database = getDb()) {
  return String(readConfig(database).api_key || '').trim();
}

function getApiBase(database = getDb()) {
  const raw = String(readConfig(database).api_base || '').trim().replace(/\/+$/, '');
  return raw || DEFAULT_BASE;
}

function normalizePostUrl(raw) {
  const url = String(raw || '').trim();
  if (!url) return { ok: false, error: 'Thiếu link bài viết.' };
  if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'Link bài viết phải bắt đầu bằng http/https.' };
  if (!/facebook\.com|fb\.watch/i.test(url)) return { ok: false, error: 'Link bài viết phải thuộc facebook.com.' };
  return { ok: true, url };
}

async function apiRequest(path_, { method = 'GET', url = null, body = null } = {}) {
  const apiKey = getApiKey();
  if (!apiKey) {
    const err = new Error('Chưa cấu hình API key Viet Seeding.');
    err.statusCode = 400;
    throw err;
  }
  const fullUrl = url || `${getApiBase()}${path_}`;
  const doFetch = async () => {
    const res = await fetch(fullUrl, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
    const text = await res.text().catch(() => '');
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch (_) { payload = null; }
    debugLog(`--> ${method} ${fullUrl}${body ? ` body=${JSON.stringify(body)}` : ''}`);
    debugLog(`<-- HTTP ${res.status} ${(text || '(empty body)').slice(0, 1500)}`);
    return { status: res.status, ok: res.ok, payload, text };
  };
  return Promise.race([
    doFetch(),
    new Promise((_, reject) => {
      const timer = setTimeout(() => reject(Object.assign(new Error('API Viet Seeding không phản hồi sau 90s.'), { statusCode: 504 })), FETCH_TIMEOUT_MS);
      if (typeof timer.unref === 'function') timer.unref();
    })
  ]);
}

function mapApiError(result, fallback) {
  const bodyMessage = result.payload && (result.payload.message || result.payload.error);
  const err = new Error(bodyMessage || result.text?.slice(0, 160) || fallback);
  err.statusCode = result.status;
  return err;
}

// ── Quét ──

async function scanPost(postUrl) {
  const normalized = normalizePostUrl(postUrl);
  if (!normalized.ok) {
    const err = new Error(normalized.error);
    err.statusCode = 400;
    throw err;
  }
  const result = await apiRequest('/api/export/comment-leads/by-post/scan', {
    method: 'POST',
    body: { url: normalized.url }
  });
  if (result.status === 202) {
    debugLog(`scan accepted: ${normalized.url}`);
    return { state: 'accepted', message: (result.payload && result.payload.message) || 'Đã tiếp nhận yêu cầu quét.' };
  }
  if (result.status === 409) {
    debugLog(`scan conflict (đang quét): ${normalized.url}`);
    return { state: 'conflict', message: (result.payload && result.payload.message) || 'Bài này đang được quét, chờ kết quả nhé.' };
  }
  if (result.status === 503) throw mapApiError(result, 'Máy quét đang bận (503), thử lại sau ít phút.');
  if (result.status === 401 || result.status === 403) throw mapApiError(result, 'API key bị từ chối, kiểm tra lại key.');
  throw mapApiError(result, `Quét thất bại (HTTP ${result.status}).`);
}

function looksLikeAccount(item) {
  return item && typeof item === 'object' && !Array.isArray(item) && Boolean(item.author_uid || item.uid || item.user_id);
}

// Tìm mảng accounts ở BẤT KỲ tầng nào của payload — tài liệu shape có thể
// lệch thực tế, trượt một tầng là mất hết user.
function findAccountsArray(payload, depth = 0) {
  if (depth > 5 || payload == null) return null;
  if (Array.isArray(payload)) {
    if (payload.some(looksLikeAccount)) return payload;
    for (const item of payload) {
      const found = findAccountsArray(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof payload === 'object') {
    for (const value of Object.values(payload)) {
      const found = findAccountsArray(value, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function extractAccounts(payload) {
  const list = findAccountsArray(payload);
  if (!Array.isArray(list)) return [];
  return list
    .filter(looksLikeAccount)
    .map((item) => ({
      author_uid: String((item.author_uid ?? item.uid ?? item.user_id) || '').trim(),
      author_name: String((item.author_name ?? item.name) || '').trim() || null,
      author_profile_url: String((item.author_profile_url ?? item.profile_url) || '').trim() || null
    }))
    .filter((item) => item.author_uid);
}

function upsertLead(database, postUrl, account) {
  database.prepare(`
    INSERT INTO comment_leads (post_url, author_uid, author_name, author_profile_url)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(post_url, author_uid) DO UPDATE SET
      author_name = COALESCE(excluded.author_name, author_name),
      author_profile_url = COALESCE(excluded.author_profile_url, author_profile_url)
  `).run(postUrl, account.author_uid, account.author_name, account.author_profile_url);
}

async function fetchLeads(postUrl) {
  const normalized = normalizePostUrl(postUrl);
  if (!normalized.ok) {
    const err = new Error(normalized.error);
    err.statusCode = 400;
    throw err;
  }
  const url = `${getApiBase()}/api/export/comment-leads/by-post?url=${encodeURIComponent(normalized.url)}&limit=${BY_POST_LIMIT}&offset=0`;
  const result = await apiRequest(null, { url });
  if (result.status === 401 || result.status === 403) throw mapApiError(result, 'API key bị từ chối, kiểm tra lại key.');
  if (!result.ok) throw mapApiError(result, `Lấy kết quả quét thất bại (HTTP ${result.status}).`);
  const payload = result.payload || {};
  const status = String(payload.status || '').toLowerCase();
  debugLog(`fetch parsed: status=${status || '(không có)'} payloadKeys=${Object.keys(payload).join(',')}`);
  if (status === 'queued' || status === 'running') {
    return { state: 'scanning', message: payload.message || 'Máy quét đang chạy, chờ thêm chút.' };
  }
  if (status === 'error') {
    return { state: 'error', message: payload.error || payload.message || 'Bài viết quét lỗi, cần quét lại.' };
  }
  const accounts = extractAccounts(payload);
  if (status && status !== 'idle' && !accounts.length) {
    return { state: 'scanning', message: payload.message || `Trạng thái chưa rõ (${status}), chờ thêm chút.` };
  }
  const database = getDb();
  const insert = database.transaction(() => {
    for (const account of accounts) upsertLead(database, normalized.url, account);
  });
  insert();
  debugLog(`fetch idle: lưu/tổng accounts=${accounts.length} bài=${normalized.url}`);
  return { state: 'idle', total: accounts.length, message: (payload.message || `Đã có ${accounts.length} khách bình luận.`) };
}

// ── Danh sách ──

function listLeads() {
  const database = getDb();
  const posts = database.prepare(`
    SELECT post_url,
           COUNT(*) AS total,
           SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) AS total_new,
           SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS total_queued,
           SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS total_sent,
           SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS total_failed,
           SUM(CASE WHEN status = 'replied' THEN 1 ELSE 0 END) AS total_replied,
           MAX(COALESCE(queued_at, created_at)) AS last_activity
    FROM comment_leads
    GROUP BY post_url
    ORDER BY last_activity DESC
  `).all();
  const rows = database.prepare(`
    SELECT id, post_url, author_uid, author_name, author_profile_url, account_id,
           thread_id, status, message_content, error, created_at, queued_at, sent_at, replied_at
    FROM comment_leads
    ORDER BY id DESC
    LIMIT 1000
  `).all();
  return { posts, leads: rows };
}

// ── Đưa vào hàng chờ ──

function fillTemplate(template, authorName) {
  const name = String(authorName || '').trim() || 'bạn';
  return String(template || '').replace(/\{(?:ten|tên|name|hoten)\}/gi, name);
}

const ConversationRepository = require('../repositories/ConversationRepository');
const MessageQueueRepository = require('../repositories/MessageQueueRepository');

function enqueue({ postUrl, accountId, content } = {}) {
  // postUrl trống = lấy TẤT CẢ lead mới/lỗi của mọi bài — nút trên UI không
  // bắt user dán lại link khi lead vẫn còn trong DB.
  const wantedUrl = String(postUrl || '').trim();
  if (wantedUrl) {
    const normalized = normalizePostUrl(wantedUrl);
    if (!normalized.ok) {
      const err = new Error(normalized.error);
      err.statusCode = 400;
      throw err;
    }
  }
  if (!accountId) {
    const err = new Error('Chưa chọn tài khoản gửi.');
    err.statusCode = 400;
    throw err;
  }
  const template = String(content || '').trim();
  if (!template) {
    const err = new Error('Nội dung tin nhắn trống.');
    err.statusCode = 400;
    throw err;
  }
  const database = getDb();
  const accountRow = database.prepare('SELECT id FROM accounts WHERE id = ?').get(String(accountId));
  if (!accountRow) {
    const err = new Error('Tài khoản gửi không tồn tại.');
    err.statusCode = 400;
    throw err;
  }
  const leads = wantedUrl
    ? database.prepare(`
        SELECT * FROM comment_leads
        WHERE post_url = ? AND status IN ('new', 'failed')
        ORDER BY id ASC
      `).all(wantedUrl)
    : database.prepare(`
        SELECT * FROM comment_leads
        WHERE status IN ('new', 'failed')
        ORDER BY id ASC
      `).all();
  if (!leads.length) return { queued: 0, skipped: 0 };

  let queued = 0;
  const run = database.transaction(() => {
    for (const lead of leads) {
      const thread = ConversationRepository.upsertThread({
        id: lead.author_uid,
        account_id: String(accountId),
        thread_url: `https://www.facebook.com/messages/t/${encodeURIComponent(lead.author_uid)}`,
        contact_name: lead.author_name || null,
        last_message: fillTemplate(template, lead.author_name),
        is_unread: 0,
        inbox_folder: 'INBOX'
      }, database);
      if (!thread) continue;
      const finalContent = fillTemplate(template, lead.author_name);
      const queueId = MessageQueueRepository.insertCampaignDispatch({
        thread_id: thread.id,
        account_id: String(accountId),
        source_type: 'personal_messenger',
        content: finalContent,
        idempotency_key: `comment_lead_${lead.id}`
      }, database);
      database.prepare(`
        UPDATE comment_leads
        SET status = 'queued', account_id = ?, thread_id = ?, queue_id = ?,
            message_content = ?, queued_at = CURRENT_TIMESTAMP, error = NULL
        WHERE id = ?
      `).run(String(accountId), thread.id, queueId, finalContent, lead.id);
      queued += 1;
    }
  });
  run();
  debugLog(`enqueue: bài=${wantedUrl || '(mọi bài)'} account=${accountId} leads=${leads.length} queued=${queued}`);
  return { queued, skipped: leads.length - queued };
}

// ── Hooks trạng thái gửi ──

function markQueueSent(queueId) {
  if (!queueId) return null;
  const database = getDb();
  const lead = database.prepare(
    "SELECT id, thread_id, author_name FROM comment_leads WHERE queue_id = ? AND status = 'queued'"
  ).get(String(queueId));
  if (!lead) return null;
  database.prepare(`
    UPDATE comment_leads SET status = 'sent', sent_at = CURRENT_TIMESTAMP, error = NULL
    WHERE id = ? AND status = 'queued'
  `).run(lead.id);
  return lead;
}

function markQueueFailed(queueId, reason) {
  if (!queueId) return null;
  const database = getDb();
  const lead = database.prepare(
    "SELECT id FROM comment_leads WHERE queue_id = ? AND status = 'queued'"
  ).get(String(queueId));
  if (!lead) return null;
  database.prepare(`
    UPDATE comment_leads SET status = 'failed', error = ?
    WHERE id = ? AND status = 'queued'
  `).run(String(reason || '').slice(0, 300), lead.id);
  return lead;
}

// ── Dò khách trả lời ──

function detectReplies(database = getDb()) {
  // So theo timestamp_ms (giờ thật của tin trên Messenger) — history sync
  // re-insert row cũ với created_at mới sẽ bị loại trừ.
  return database.prepare(`
    SELECT id, thread_id, author_name, account_id FROM comment_leads
    WHERE status = 'sent' AND thread_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM messages m
        WHERE m.thread_id = comment_leads.thread_id
          AND m.is_outgoing = 0
          AND (CASE
                 WHEN m.timestamp_ms IS NOT NULL AND m.timestamp_ms > 0
                   THEN julianday(m.timestamp_ms / 1000.0, 'unixepoch')
                 ELSE julianday(m.created_at)
               END) > julianday(comment_leads.sent_at)
      )
  `).all();
}

function startReplyWatcher(io, { intervalMs = 60 * 1000 } = {}) {
  const sweep = () => {
    try {
      const database = getDb();
      const candidates = detectReplies(database);
      if (!candidates.length) return;
      const mark = database.prepare(`
        UPDATE comment_leads SET status = 'replied', replied_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'sent'
      `);
      const replied = [];
      for (const lead of candidates) {
        if (mark.run(lead.id).changes > 0) replied.push(lead);
      }
      if (replied.length && io) {
        io.emit('COMMENT_LEAD_REPLIED', { leads: replied });
        console.log(`[CommentLeads] ${replied.length} khách đã trả lời: ${replied.map((l) => l.author_name || l.thread_id).join(', ')}`);
      }
    } catch (error) {
      console.warn('[CommentLeads] Reply watcher lỗi:', error.message);
    }
  };
  sweep();
  const timer = setInterval(sweep, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  console.log('[CommentLeads] Reply watcher started (mỗi 60s).');
  return timer;
}

module.exports = {
  scanPost,
  fetchLeads,
  listLeads,
  enqueue,
  markQueueSent,
  markQueueFailed,
  startReplyWatcher,
  DEFAULT_MESSAGE_TEMPLATE,
  isConfigured: () => Boolean(getApiKey())
};
