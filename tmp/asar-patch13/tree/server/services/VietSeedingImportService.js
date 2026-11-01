/**
 * VietSeedingImportService — nhập hàng loạt tài khoản Facebook từ API
 * export cookie của Viet Seeding (api.vietseeding.com), không cần đăng nhập tay.
 *
 * Luồng mỗi account:
 *   1. GET API với Bearer key -> danh sách account kèm cookie (key chỉ sống trong app).
 *   2. Tạo pendingKey + profile dir + marker chủ sở hữu (gi hệ thống "Thêm tài khoản").
 *   3. startNewAccountProcess: Chrome Portable tự cài extension, mở Facebook với
 *      crm_pending_key trên URL (content script lưu lại vào chrome.storage).
 *   4. Tiêm cookie vào tab Facebook qua CDP rồi navigate lại facebook.com.
 *   5. Extension thấy phiên đăng nhập -> gửi REGISTER_ACCOUNT (kèm pending_key)
 *      -> server tạo row accounts + promote Chrome sang account thật.
 *   6. Poll bảng accounts chờ row xuất hiện rồi mới chạy account kế tiếp.
 *      Account cookie chết/treo bị bỏ qua (đóng Chrome của nó) và nhập tiếp
 *      cho đến khi ĐỦ số lượng user chọn hoặc kho API cạn.
 *
 * An toàn: giá trị cookie KHÔNG BAO GIỜ được log, lưu DB hay trả về UI —
 * mọi log chỉ ghi tên trường/số lượng/identifier. API key lưu KV, GET trả bản mask.
 */
const fs = require('fs');
const path = require('path');

// Packaged app: userData/data (xem utils/appDataRoot.js) — đừng tự đoán %APPDATA%.
const { APP_DATA_ROOT } = require('../utils/appDataRoot');

let defaultDb;
function getDb() {
  if (!defaultDb) defaultDb = require('../database/db');
  return defaultDb;
}

// ── KV config (dùng lại bảng page_api_config cho đỡ phải migrate) ──
function ensureKvSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS page_api_config (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

const CONFIG_KEY = 'vietseeding:global';
const DEFAULT_API_URL = 'https://api.vietseeding.com/api/export/seeding-cookies';

function readConfig(database = getDb()) {
  ensureKvSchema(database);
  const row = database.prepare('SELECT value FROM page_api_config WHERE key = ?').get(CONFIG_KEY);
  if (!row || !row.value) return {};
  try { return JSON.parse(row.value) || {}; } catch (_) { return {}; }
}

function writeConfig(patch, database = getDb()) {
  ensureKvSchema(database);
  const next = { ...readConfig(database), ...patch };
  database.prepare(`
    INSERT INTO page_api_config (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).run(CONFIG_KEY, JSON.stringify(next));
  return next;
}

function maskSecret(secret) {
  const s = String(secret || '');
  if (s.length <= 10) return s.slice(0, 2) + '…';
  return s.slice(0, 6) + '…' + s.slice(-4);
}

function getConfigSummary() {
  const cfg = readConfig();
  const key = String(cfg.api_key || '').trim();
  return {
    configured: Boolean(key),
    api_key_masked: key ? maskSecret(key) : null,
    api_url: String(cfg.api_url || DEFAULT_API_URL)
  };
}

function saveConfig({ api_key, api_url } = {}) {
  const patch = {};
  if (typeof api_key === 'string' && api_key.trim()) patch.api_key = api_key.trim();
  if (typeof api_url === 'string' && api_url.trim()) patch.api_url = api_url.trim();
  if (!Object.keys(patch).length) return getConfigSummary();
  writeConfig(patch);
  return getConfigSummary();
}

// ── Parse response phòng thủ (shape thật chưa tài liệu hóa: chấp nhận mảng
// top-level / {data|items|accounts|...} / object map uid->cookie / cookie trần,
// cookie dạng chuỗi "n=v; n2=v2" / mảng {name,value} / object map) ──
const ACCOUNT_LIST_FIELDS = ['data', 'items', 'accounts', 'cookies', 'list', 'rows', 'result', 'results', 'seeding_cookies', 'records'];
const COOKIE_FIELD_NAMES = ['cookies', 'cookie', 'cookie_string', 'raw_cookies', 'session_cookies', 'fb_cookies', 'cookie_json', 'cookie_raw', 'content', 'data', 'value'];
// Trường metadata của item export — không được nhét thành cookie Facebook.
const ITEM_META_FIELDS = new Set([
  'id', 'uid', 'user_id', 'username', 'user', 'password', 'pass', 'email',
  'name', 'note', 'status', 'type', 'created_at', 'updated_at', '2fa', 'otp',
  'mail', 'recovery_email', 'proxy', 'user_agent', 'ua', 'folder', 'label'
]);

function findAccountList(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    for (const field of ACCOUNT_LIST_FIELDS) {
      if (Array.isArray(payload[field])) return payload[field];
    }
    // Lồng 1 tầng: {data: {list: [...]}} v.v.
    for (const field of ACCOUNT_LIST_FIELDS) {
      const nested = payload[field];
      if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        for (const inner of ACCOUNT_LIST_FIELDS) {
          if (Array.isArray(nested[inner])) return nested[inner];
        }
      }
    }
  }
  return null;
}

function parseCookieField(raw) {
  const cookies = [];
  const pushCookie = (name, value, extra = {}) => {
    const n = String(name || '').trim();
    const v = typeof value === 'string' ? value.trim() : (value == null ? '' : String(value));
    if (!n || !v) return;
    cookies.push({ name: n, value: v, domain: extra.domain || undefined, path: extra.path || undefined });
  };

  if (typeof raw === 'string') {
    for (const part of raw.split(';')) {
      const eq = part.indexOf('=');
      if (eq <= 0) continue;
      pushCookie(part.slice(0, eq).trim(), part.slice(eq + 1).trim());
    }
  } else if (Array.isArray(raw)) {
    for (const c of raw) {
      if (!c || typeof c !== 'object') continue;
      pushCookie(c.name || c.key, c.value ?? c.cookie, { domain: c.domain, path: c.path });
    }
  } else if (raw && typeof raw === 'object') {
    for (const [name, value] of Object.entries(raw)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        pushCookie(name, value.value ?? value.cookie, { domain: value.domain, path: value.path });
      } else {
        pushCookie(name, value);
      }
    }
  }
  return cookies;
}

// Trạng thái live/die + tên hiển thị nằm ở metadata của item (status/name đã bị
// loại khỏi cookie parsing) — đọc phòng thủ vì shape API chưa tài liệu hóa:
// quét nhiều biến thể tên field (snake/camel/tiếng Việt), username làm fallback cuối.
const NAME_FIELDS = ['name', 'fullname', 'full_name', 'fullName', 'display_name', 'displayName',
  'account_name', 'accountName', 'nickname', 'nickName', 'nick', 'fb_name', 'facebook_name',
  'ten', 'ho_ten', 'hoten', 'username'];
const STATUS_FIELDS = ['status', 'state', 'account_status', 'accountStatus', 'live_status', 'liveStatus', 'status_text', 'statusText'];
function pickMetaString(item, fields) {
  for (const field of fields) {
    const v = item[field];
    if (v != null && typeof v !== 'object' && String(v).trim() !== '') return String(v).trim();
  }
  return null;
}
function extractAccountMeta(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return {};
  return {
    name: pickMetaString(item, NAME_FIELDS),
    status: pickMetaString(item, STATUS_FIELDS)
  };
}

// API gắn trạng thái live/die cho từng account — chết thì loại khỏi danh sách
// chọn. Không rõ trạng thái (thiếu field) coi như live để không giấu account.
const DEAD_STATUS_RE = /die|dead|chết|khóa|khoá|block|ban|checkpoint|disable|lock|logout|error|fail|spam|invalid/i;
function isLiveStatus(status) {
  if (status == null || String(status).trim() === '') return true;
  const s = String(status).trim();
  if (/^(0|false)$/i.test(s)) return false;
  return !DEAD_STATUS_RE.test(s);
}

function pushAccount(accounts, identifier, cookies, meta = {}) {
  if (!cookies.length) return;
  const cUserCookie = cookies.find((c) => c.name === 'c_user');
  const xsCookie = cookies.find((c) => c.name === 'xs');
  if (!cUserCookie && !xsCookie) return; // không có c_user/xs thì chắc chắn không login được
  // accounts.id là FB user id: identifier phải là số — chữ (username) chỉ là fallback.
  const idRaw = /^\d+$/.test(String(identifier || '')) ? identifier : (cUserCookie?.value || identifier || '');
  accounts.push({
    identifier: String(idRaw).trim(),
    cookies,
    name: meta.name || null,
    status: meta.status || null
  });
}

// Cookie nằm trải ngay trên item: {username:'x', c_user:'1', xs:'y', password:'z'}
function parseItemAsCookieMap(item) {
  const cookies = [];
  for (const [name, value] of Object.entries(item)) {
    if (ITEM_META_FIELDS.has(name)) continue;
    if (value == null || typeof value === 'object') continue;
    const v = typeof value === 'string' ? value.trim() : String(value);
    if (!v || v.includes(';')) continue; // có ';' => là cookie string wrapper, không phải 1 cookie
    cookies.push({ name, value: v });
  }
  return cookies;
}

function visitAccountItem(accounts, item, fallbackIdentifier) {
  if (typeof item === 'string') {
    const cookies = parseCookieField(item);
    const cUser = cookies.find((c) => c.name === 'c_user');
    pushAccount(accounts, cUser?.value || fallbackIdentifier, cookies);
    return;
  }
  if (!item || typeof item !== 'object' || Array.isArray(item)) return;
  const meta = extractAccountMeta(item);
  // 1) cookie nằm trong wrapper field riêng
  for (const field of COOKIE_FIELD_NAMES) {
    if (item[field] === undefined || item[field] === null) continue;
    const cookies = parseCookieField(item[field]);
    if (cookies.length) {
      pushAccount(accounts, item.fb_uid ?? item.c_user ?? item.uid ?? item.user_id ?? item.username ?? item.id ?? item.name ?? fallbackIdentifier, cookies, meta);
      return;
    }
  }
  // 2) cookie trải trực tiếp trên item (có c_user/xs làm field)
  if (item.c_user !== undefined || item.xs !== undefined) {
    const cookies = parseItemAsCookieMap(item);
    pushAccount(accounts, item.fb_uid ?? item.c_user ?? item.uid ?? item.user_id ?? item.username ?? item.id ?? fallbackIdentifier, cookies, meta);
    return;
  }
  // 3) item là MAP: { "<uid>": "c_user=..; xs=.." | {cookie...} }
  const entries = Object.entries(item);
  if (entries.length && entries.some(([, v]) => typeof v === 'string' && v.includes('='))) {
    for (const [key, value] of entries) {
      if (typeof value === 'string') {
        const cookies = parseCookieField(value);
        const cUser = cookies.find((c) => c.name === 'c_user');
        pushAccount(accounts, cUser?.value || key, cookies);
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        const cookies = parseCookieField(value);
        if (cookies.length) {
          const cUser = cookies.find((c) => c.name === 'c_user');
          pushAccount(accounts, cUser?.value || key, cookies);
        }
      }
    }
  }
}

// Trả về [{ identifier, cookies: [{name,value,domain?,path?}] }] — identifier ưu tiên
// c_user vì accounts.id của CRM chính là FB user id.
function parseCookieAccounts(payload) {
  const accounts = [];
  const list = findAccountList(payload);
  if (Array.isArray(list)) {
    for (const item of list) visitAccountItem(accounts, item);
    if (accounts.length) return accounts;
  }
  // Object map: { "<uid|username>": "c_user=..; xs=.." | {cookie fields...} | [cookies] }
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    for (const [key, value] of Object.entries(payload)) {
      if (value == null) continue;
      if (typeof value === 'string') {
        const cookies = parseCookieField(value);
        const cUser = cookies.find((c) => c.name === 'c_user');
        pushAccount(accounts, cUser?.value || key, cookies);
      } else if (Array.isArray(value)) {
        const cookies = parseCookieField(value);
        const cUser = cookies.find((c) => c.name === 'c_user');
        pushAccount(accounts, cUser?.value || key, cookies);
      } else if (typeof value === 'object') {
        visitAccountItem(accounts, value, key);
      }
    }
  }
  return accounts;
}

// Mô tả cấu trúc response để nhét vào thông báo lỗi — CHỈ tên field + type,
// không bao giờ in giá trị (cookie/token phải không bao giờ xuất hiện trong UI/log).
function describePayload(value, depth = 0, maxDepth = 3) {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    if (!value.length) return 'array[0]';
    return `array[${value.length}]{${describePayload(value[0], depth + 1, maxDepth)}}`;
  }
  if (typeof value === 'object') {
    if (depth >= maxDepth) return 'object{…}';
    const keys = Object.keys(value).slice(0, 14)
      .map((k) => `${k}:${describePayload(value[k], depth + 1, maxDepth)}`);
    return `object{${keys.join(', ')}}`;
  }
  return typeof value;
}

// ── Gọi API export ──
// Hard timeout bằng Promise.race: Electron 31 (Node 20/undici) có hiện tượng
// AbortSignal hủy socket (closes -> TIME_WAIT) nhưng promise fetch KHÔNG bao
// giờ settle — chỉ tin signal là job treo vĩnh viễn (đã đo thấy 2026-10-10).
const FETCH_TIMEOUT_MS = 90000;

function rejectAfter(ms, message) {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    if (typeof timer.unref === 'function') timer.unref();
  });
}

async function fetchCookieAccounts(limit) {
  const cfg = readConfig();
  const apiKey = String(cfg.api_key || '').trim();
  if (!apiKey) throw new Error('Chưa cấu hình API key Viet Seeding.');
  const apiUrl = String(cfg.api_url || DEFAULT_API_URL);
  const url = `${apiUrl}${apiUrl.includes('?') ? '&' : '?'}limit=${Math.max(1, Math.min(100, Number(limit) || 10))}`;

  const doFetch = async () => {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      if (res.status === 401 || res.status === 403) throw new Error(`API key bị từ chối (HTTP ${res.status}). Kiểm tra lại key.`);
      if (res.status === 429) throw new Error('API Viet Seeding trả 429 — đang bị giới hạn tần suất, thử lại sau.');
      throw new Error(`API Viet Seeding trả HTTP ${res.status}${body ? ` — ${body.slice(0, 120)}` : ''}`);
    }
    let payload;
    try {
      payload = await res.json();
    } catch (_) {
      throw new Error('API Viet Seeding trả về nội dung không phải JSON.');
    }
    // Chỉ tên field + type (describePayload KHÔNG in giá trị) — để chẩn đoán
    // tại sao tên/trạng thái thiếu khi shape API đổi.
    jobLog(`FETCH_SHAPE ${describePayload(payload)}`);
    return payload;
  };

  let payload;
  try {
    payload = await Promise.race([
      doFetch(),
      rejectAfter(FETCH_TIMEOUT_MS, `API Viet Seeding không phản hồi sau ${Math.round(FETCH_TIMEOUT_MS / 1000)}s — thử lại sau.`)
    ]);
  } catch (err) {
    if (err.name === 'TimeoutError' || /không phản hồi|hết thời gian/.test(err.message)) {
      throw new Error('API Viet Seeding không phản hồi — hết thời gian chờ. Thử lại sau.');
    }
    throw err;
  }
  const accounts = parseCookieAccounts(payload);
  if (!accounts.length) {
    throw new Error(`Không đọc được account/cookie nào. Cấu trúc response: ${describePayload(payload)}`);
  }
  return accounts;
}

// ── Danh sách account để UI tích chọn (KHÔNG BAO GIỜ trả cookie về UI) ──
// Cookie giữ trong bộ nhớ server 15 phút để đợt nhập kế tiếp dùng lại mà không
// phải gọi API lần nữa (kho cookie có thể thay đổi giữa 2 lần gọi).
const SUMMARY_CACHE_TTL_MS = 15 * 60 * 1000;
let summaryCache = { at: 0, byIdentifier: new Map() };

function existsInCrm(identifier) {
  const id = String(identifier || '');
  if (!/^\d+$/.test(id)) return false;
  return Boolean(getDb().prepare('SELECT id FROM accounts WHERE id = ?').get(id));
}

function cacheParsedAccounts(accounts) {
  const byIdentifier = new Map();
  for (const account of accounts) {
    const id = String(account.identifier || '').trim();
    if (!id || byIdentifier.has(id)) continue; // trùng uid giữ bản đầu
    byIdentifier.set(id, account);
  }
  summaryCache = { at: Date.now(), byIdentifier };
  return byIdentifier;
}

function getFreshSummaryCache() {
  return (Date.now() - summaryCache.at <= SUMMARY_CACHE_TTL_MS && summaryCache.byIdentifier.size)
    ? summaryCache.byIdentifier
    : null;
}

// ── Tên FB thật cho checklist: API Viet Seeding KHÔNG trả tên (FETCH_SHAPE:
// chỉ cookie/email/uid/status). Nguồn tên: (1) DB accounts cho tk đã nhập,
// (2) quét profile.php qua Chrome của 1 tk ACTIVE cho tk chưa biết — tên cache
// in-memory theo app session để các lần lấy danh sách sau khỏi quét lại.
const fbNameCache = new Map();

function pickScraperBrowser(processManager) {
  if (!processManager || typeof processManager.getAttachedBrowser !== 'function') return null;
  let rows = [];
  try {
    rows = getDb().prepare("SELECT id FROM accounts WHERE status = 'ACTIVE' ORDER BY rowid DESC").all();
    if (!rows.length) rows = getDb().prepare('SELECT id FROM accounts ORDER BY rowid DESC').all();
  } catch (_) { return null; }
  for (const row of rows) {
    const browser = processManager.getAttachedBrowser(String(row.id));
    if (browser) return browser;
  }
  return null;
}

function cleanFbName(raw) {
  const name = String(raw || '')
    .replace(/\s*\|\s*Facebook.*$/i, '')
    .replace(/^\(\d+\)\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!name || name.length > 80) return null;
  if (/^(facebook|log in( or sign up)?|đăng nhập|content not found|trang này hiện không khả dụng|bạn phải đăng nhập tiếp|vui lòng đăng nhập lại)/i.test(name)) return null;
  return name;
}

async function scrapeFbName(browser, uid) {
  const page = await Promise.race([
    browser.newPage(),
    rejectAfter(15000, 'Không mở được tab mới (CDP treo).')
  ]);
  try {
    await Promise.race([
      page.goto(`https://www.facebook.com/profile.php?id=${encodeURIComponent(uid)}`, {
        waitUntil: 'domcontentloaded',
        timeout: 20000
      }),
      rejectAfter(25000, 'Không mở được trang profile (treo).')
    ]);
    await sleep(1000);
    const raw = await Promise.race([
      page.evaluate(() => {
        const og = document.querySelector('meta[property="og:title"]');
        if (og && og.content) return og.content;
        const h1 = document.querySelector('h1');
        if (h1 && h1.textContent) return h1.textContent;
        return document.title || '';
      }),
      rejectAfter(10000, 'Không đọc được tên trên trang.')
    ]);
    return cleanFbName(raw);
  } finally {
    try { await page.close(); } catch (_) { /* tab đã chết sẵn */ }
  }
}

// Pool 3 tab song song, trần 60s — uid nào kẻo không kịp sẽ có tên ở lần
// "Lấy danh sách" kế tiếp (cache vẫn sống). Lỗi từng uid bỏ qua riêng lẻ.
async function enrichNames(list, processManager) {
  for (const item of list) {
    if (!item.name && fbNameCache.has(item.identifier)) {
      item.name = fbNameCache.get(item.identifier);
    }
  }
  const missing = list.filter((item) => !item.name);
  if (!missing.length) return 0;
  const browser = pickScraperBrowser(processManager);
  if (!browser) return 0;
  const deadline = Date.now() + 60000;
  let done = 0;
  const queue = [...missing];
  const worker = async () => {
    while (queue.length && Date.now() < deadline) {
      const item = queue.shift();
      try {
        const name = await scrapeFbName(browser, item.identifier);
        if (name) {
          fbNameCache.set(item.identifier, name);
          item.name = name;
          done += 1;
        }
      } catch (_) { /* uid lỗi bỏ qua */ }
      await sleep(300);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  jobLog(`NAMES scraped=${done}/${missing.length} cached=${fbNameCache.size}`);
  return done;
}

async function listAccountsForSelection(limit = 20, processManager = null) {
  const accounts = await fetchCookieAccounts(Math.max(1, Math.min(100, Number(limit) || 20)));
  const byIdentifier = cacheParsedAccounts(accounts);
  const list = [];
  let deadSkipped = 0;
  for (const account of byIdentifier.values()) {
    if (!isLiveStatus(account.status)) { deadSkipped += 1; continue; }
    const id = String(account.identifier || '');
    const crmRow = /^\d+$/.test(id)
      ? getDb().prepare('SELECT id, name FROM accounts WHERE id = ?').get(id)
      : null;
    list.push({
      identifier: account.identifier,
      name: account.name || crmRow?.name || null,
      status: account.status || null,
      exists_in_crm: Boolean(crmRow)
    });
  }
  jobLog(`LIST_OK total=${byIdentifier.size} live=${list.length} dead_skipped=${deadSkipped}`);
  await enrichNames(list, processManager);
  return { accounts: list, dead_skipped: deadSkipped, total: byIdentifier.size };
}

// ── Job import (chạy tuần tự, 1 Chrome mỗi lần) ──
let activeJob = null;
let jobSeq = 0;

// Log trạng thái job ra file để đo được từ ngoài app mà không cần auth
// (UI spinner có thể im lặng khi poll lỗi — file này là nguồn sự thật).
const JOB_LOG_PATH = path.join(APP_DATA_ROOT, 'vietseeding-job.log');
function jobLog(message) {
  try { fs.appendFileSync(JOB_LOG_PATH, `${new Date().toISOString()} ${message}\n`); } catch (_) {}
}

function getJobStatus() {
  if (!activeJob) return null;
  const { results, ...rest } = activeJob;
  return { ...rest, results: results.slice(-200) };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function newPendingKey() {
  const now = new Date();
  const dateStr = now.toISOString().replace(/[-T:.Z]/g, '').substring(0, 14);
  const randomStr = Math.random().toString(36).substring(2, 7);
  return `pending_${dateStr}_${randomStr}`;
}

function writeOwnerMarker(pendingKey, ownerUserId) {
  const pendingProfileDir = path.join(APP_DATA_ROOT, 'profiles', pendingKey);
  fs.mkdirSync(pendingProfileDir, { recursive: true });
  fs.writeFileSync(
    path.join(pendingProfileDir, '.crm-pending-owner.json'),
    JSON.stringify({ owner_user_id: ownerUserId, created_at: new Date().toISOString(), source: 'vietseeding' })
  );
  return pendingProfileDir;
}

async function waitForAttachedBrowser(processManager, pendingKey, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const browser = processManager.getAttachedBrowser(pendingKey);
    if (browser) return browser;
    await sleep(500);
  }
  return null;
}

async function waitForAccountRow(pendingKey, timeoutMs = 75000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(2000);
    // Không lọc status: nếu Chrome bị đóng ngay sau đăng ký, row lập tức chuyển
    // DISCONNECTED — row TỒN TẠI vẫn nghĩa là cookie hợp lệ và đã đăng ký thành công.
    const row = getDb().prepare(
      'SELECT id, name FROM accounts WHERE profile_dir LIKE ? ORDER BY rowid DESC LIMIT 1'
    ).get(`%${pendingKey}%`);
    if (row) return row;
  }
  return null;
}

// FB từ chối cookie chết bằng 2 cách: redirect sang trang login/checkpoint, hoặc
// xóa c_user/xs khỏi cookie jar. Check ngay sau khi trang load xong — redirect
// login là phản hồi server-side nên URL đã quyết định, không cần chờ lâu.
async function assertFbLoginAccepted(page) {
  // Redirect login/checkpoint là phản hồi server-side: URL ngay sau goto đã quyết định.
  const quickUrl = String(page.url() || '');
  if (/facebook\.com\/(login|checkpoint)/.test(quickUrl)) {
    throw new Error('Cookie hết hiệu lực — Facebook đẩy về trang đăng nhập/checkpoint.');
  }
  await sleep(1500); // bắt trường hợp FB JS-redirect sau khi load
  const url = String(page.url() || '');
  if (/facebook\.com\/(login|checkpoint)/.test(url)) {
    throw new Error('Cookie hết hiệu lực — Facebook đẩy về trang đăng nhập/checkpoint.');
  }
  let cookies;
  try {
    cookies = await Promise.race([
      page.cookies('https://www.facebook.com'),
      rejectAfter(20000, 'Chrome không trả cookie jar (CDP treo).')
    ]);
  } catch (_) {
    return; // không đọc được jar (trang lạ) — để waitForAccountRow quyết định
  }
  const hasCUser = cookies.some((c) => c.name === 'c_user');
  const hasXs = cookies.some((c) => c.name === 'xs');
  if (!hasCUser && !hasXs) {
    throw new Error('Cookie hết hiệu lực — Facebook không nhận phiên đăng nhập.');
  }
}

const ACCOUNT_HARD_TIMEOUT_MS = 3 * 60 * 1000;

// Các bước CDP đơn lẻ không có timeout riêng — Chrome/renderer treo thì promise
// không bao giờ settle (đã gặp thật: Chrome đứng im ở trang login, job quay vô tận).
async function runImportSteps(account, ctx, pendingKey) {
  const { processManager } = ctx;
  const launched = await Promise.race([
    processManager.startNewAccountProcess(pendingKey),
    rejectAfter(90000, 'Không khởi chạy được Chrome (treo 90s).')
  ]);
  if (!launched) throw new Error('Không khởi chạy được Chrome cho phiên nhập.');

  const browser = await waitForAttachedBrowser(processManager, pendingKey);
  if (!browser) throw new Error('Chrome không nhận điều khiển được (CDP) — kiểm tra log ProcessManager.');

  const pages = await Promise.race([
    browser.pages(),
    rejectAfter(20000, 'Chrome không trả danh sách tab (CDP treo).')
  ]);
  const page = pages.find((p) => String(p.url() || '').includes('facebook.com')) || pages[0];
  if (!page) throw new Error('Không tìm thấy tab Facebook trong Chrome phiên nhập.');

  for (const cookie of account.cookies) {
    await Promise.race([
      page.setCookie({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain || '.facebook.com',
        path: cookie.path || '/',
        secure: true
      }),
      rejectAfter(20000, 'Chrome không nhận cookie (CDP treo).')
    ]);
  }

  // Navigate lại với crm_pending_key để content script chắc chắn lưu key
  // (đã mở 1 lần lúc startNewAccountProcess nhưng lúc đó chưa có cookie).
  await Promise.race([
    page.goto(`https://www.facebook.com/?crm_pending_key=${encodeURIComponent(pendingKey)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 45000
    }),
    rejectAfter(60000, 'Không mở được facebook.com (treo 60s).')
  ]);

  await assertFbLoginAccepted(page);

  const row = await waitForAccountRow(pendingKey);
  if (!row) throw new Error('Hết thời gian chờ — cookie hết hiệu lực hoặc Facebook chặn đăng nhập.');
  return { account_id: String(row.id), name: row.name };
}

async function importSingleAccount(account, ctx) {
  const { processManager, registerOwner, releaseOwner, ownerUserId } = ctx;
  const pendingKey = newPendingKey();
  try {
    registerOwner(pendingKey, ownerUserId);
    writeOwnerMarker(pendingKey, ownerUserId);
    return await Promise.race([
      runImportSteps(account, ctx, pendingKey),
      rejectAfter(ACCOUNT_HARD_TIMEOUT_MS, 'Account treo quá 3 phút — bỏ qua, chuyển sang account khác.')
    ]);
  } catch (err) {
    // Account không login được / treo / lỗi giữa chừng: đóng Chrome của phiên này
    // để không dồn window, job chạy tiếp account kế tiếp.
    try { processManager.stopAccountProcess(pendingKey); } catch (_) { /* đã chết sẵn */ }
    throw err;
  } finally {
    releaseOwner(pendingKey);
  }
}

function startImport({ limit = 10, identifiers = null, ownerUserId, processManager, registerOwner = () => {}, releaseOwner = () => {} }) {
  // Job RUNNING nhưng không có tiến độ gì quá 5 phút (fetch treo / sự cố) coi như
  // chết, cho phép chạy đợt mới thay thế. Job sống vẫn có thể chạy > 5 phút khi
  // phải bỏ nhiều account chết, nên không được tính từ startedAt.
  const STALE_RUNNING_MS = 5 * 60 * 1000;
  if (activeJob && activeJob.status === 'RUNNING' && Date.now() - (activeJob.lastProgressAt || activeJob.startedAt) >= STALE_RUNNING_MS) {
    const err = new Error('Đang có đợt nhập Viet Seeding khác chạy. Chờ hoàn tất rồi thử lại.');
    err.statusCode = 409;
    throw err;
  }
  const job = {
    id: `vs_${Date.now()}_${++jobSeq}`,
    status: 'RUNNING',
    phase: 'FETCH',
    total: 0,
    processed: 0,
    imported: 0,
    skipped: 0,
    failed: 0,
    current: null,
    results: [],
    note: null,
    error: null,
    startedAt: Date.now(),
    lastProgressAt: Date.now(),
    finishedAt: null
  };
  activeJob = job;
  jobLog(`START id=${job.id}`);

  // Watchdog: job RUNNING mà quá 4,5 phút không có tiến độ (bước nào đó treo
  // vĩnh viễn dù đã race timeout) thì ép kết thúc để UI không quay mãi và cho
  // phép chạy đợt mới. Đồng thời đóng Chrome pending còn treo.
  const WATCHDOG_NO_PROGRESS_MS = 4.5 * 60 * 1000;
  const watchdog = setInterval(() => {
    if (job.status !== 'RUNNING') { clearInterval(watchdog); return; }
    if (Date.now() - (job.lastProgressAt || job.startedAt) < WATCHDOG_NO_PROGRESS_MS) return;
    job.status = 'FAILED';
    job.error = 'Đợt nhập bị treo (không có tiến độ quá 4,5 phút) — hệ thống tự huỷ. Thử lại.';
    job.finishedAt = Date.now();
    job.current = null;
    jobLog(`WATCHDOG_KILL id=${job.id} imported=${job.imported} failed=${job.failed}`);
    try { processManager.stopPendingProcesses(); } catch (_) {}
    clearInterval(watchdog);
  }, 10000);
  if (typeof watchdog.unref === 'function') watchdog.unref();

  (async () => {
    const ctx = { processManager, registerOwner, releaseOwner, ownerUserId };
    const wanted = Array.isArray(identifiers)
      ? [...new Set(identifiers.map((v) => String(v || '').trim()).filter(Boolean))].slice(0, 100)
      : null;
    try {
      if (wanted && wanted.length) {
        // Chế độ chọn tay: nhập đúng các account user đã tích, đúng thứ tự chọn.
        // Dùng cache từ lần "Lấy danh sách" nếu còn tươi để không gọi API lần nữa.
        job.total = wanted.length;
        job.phase = 'FETCH';
        let byIdentifier = getFreshSummaryCache();
        if (byIdentifier) {
          jobLog('CACHE_HIT');
        } else {
          jobLog('CACHE_MISS -> refetch 100');
          const refetched = await fetchCookieAccounts(100);
          byIdentifier = cacheParsedAccounts(refetched);
          jobLog(`FETCH_OK accounts=${refetched.length}`);
        }
        job.phase = 'IMPORT';
        let missing = 0;
        for (const id of wanted) {
          job.current = id;
          job.lastProgressAt = Date.now();
          const account = byIdentifier.get(id);
          if (!account) {
            missing += 1;
            job.failed += 1;
            job.processed = job.imported + job.failed + job.skipped;
            job.results.push({ identifier: id, status: 'FAILED', error: 'Không có trong danh sách vừa lấy từ API — bấm Lấy danh sách lại rồi chọn.' });
            continue;
          }
          if (existsInCrm(id)) {
            job.skipped += 1;
            job.processed = job.imported + job.failed + job.skipped;
            job.results.push({ identifier: id, status: 'EXISTS', name: account.name || undefined });
            jobLog(`EXISTS ${id}`);
            continue;
          }
          jobLog(`ATTEMPT ${id} (imported=${job.imported}/${job.total})`);
          try {
            const row = await importSingleAccount(account, ctx);
            job.imported += 1;
            job.processed = job.imported + job.failed + job.skipped;
            job.results.push({ identifier: id, status: 'IMPORTED', account_id: row.account_id, name: row.name });
            jobLog(`IMPORTED ${id} -> ${row.account_id}`);
            console.log(`[VietSeeding] Đã nhập account ${row.account_id}${row.name ? ` (${row.name})` : ''}.`);
          } catch (err) {
            job.failed += 1;
            job.processed = job.imported + job.failed + job.skipped;
            job.results.push({ identifier: id, status: 'FAILED', error: err.message });
            jobLog(`SKIPPED ${id}: ${err.message}`);
            console.warn(`[VietSeeding] Bỏ qua account (${id}): ${err.message}`);
          }
        }
        if (missing) {
          job.note = `${missing}/${wanted.length} account không còn trong danh sách API — bấm Lấy danh sách lại rồi chọn.`;
        }
        job.status = 'DONE';
        jobLog(`DONE id=${job.id} imported=${job.imported} failed=${job.failed} skipped=${job.skipped}`);
        return;
      }

      // Luôn lấy 1 lô tối đa từ API rồi LỌC SẴN account đã có trong CRM —
      // số đã có không chiếm suất "Số lượng" và không mở Chrome cho chúng.
      const accounts = await fetchCookieAccounts(100);
      jobLog(`FETCH_OK accounts=${accounts.length}`);
      const fresh = [];
      for (const account of accounts) {
        const identifier = account.identifier || '';
        const existing = /^\d+$/.test(identifier)
          ? getDb().prepare('SELECT id FROM accounts WHERE id = ?').get(identifier)
          : null;
        if (existing) {
          job.skipped += 1;
          continue;
        }
        fresh.push(account);
      }
      jobLog(`PREFILTER skipped=${job.skipped} fresh=${fresh.length}`);
      const target = Math.max(1, Math.min(100, Number(limit) || 10));
      job.total = target;
      job.phase = 'IMPORT';
      if (!fresh.length) {
        job.note = `Kho API không còn account mới: ${accounts.length} account trả về đều đã có trong CRM.`;
        job.status = 'DONE';
        jobLog(`DONE_EMPTY id=${job.id}`);
        return;
      }

      // "Số lượng" = số account nhập THÀNH CÔNG — account chết/treo bị bỏ qua và
      // thử tiếp account kế cho đến khi đủ target hoặc kho API cạn.
      for (const account of fresh) {
        if (job.imported >= target) break;
        const identifier = account.identifier || '(không rõ uid)';
        job.current = identifier;
        job.lastProgressAt = Date.now();
        jobLog(`ATTEMPT ${identifier} (imported=${job.imported}/${target})`);
        try {
          const row = await importSingleAccount(account, ctx);
          job.imported += 1;
          job.processed = job.imported; // tiến độ UI đếm theo số thành công
          job.results.push({ identifier, status: 'IMPORTED', account_id: row.account_id, name: row.name });
          jobLog(`IMPORTED ${identifier} -> ${row.account_id}`);
          console.log(`[VietSeeding] Đã nhập account ${row.account_id}${row.name ? ` (${row.name})` : ''}.`);
        } catch (err) {
          job.failed += 1;
          job.results.push({ identifier, status: 'FAILED', error: err.message });
          jobLog(`SKIPPED ${identifier}: ${err.message}`);
          console.warn(`[VietSeeding] Bỏ qua account (${identifier}): ${err.message}`);
        }
      }
      if (job.imported < target) {
        job.note = `Chỉ nhập được ${job.imported}/${target}: kho API hết account mới (thử ${job.imported + job.failed}, ${job.failed} không đăng nhập được).`;
      }
      job.status = 'DONE';
      jobLog(`DONE id=${job.id} imported=${job.imported} failed=${job.failed} skipped=${job.skipped}`);
    } catch (err) {
      job.status = 'FAILED';
      job.error = err.message;
      jobLog(`FAILED id=${job.id}: ${err.message}`);
      console.warn(`[VietSeeding] Đợt nhập thất bại: ${err.message}`);
    } finally {
      job.current = null;
      job.finishedAt = Date.now();
    }
  })();

  return { job_id: job.id, total_estimated: null };
}

module.exports = {
  getConfigSummary,
  saveConfig,
  parseCookieAccounts,
  describePayload,
  fetchCookieAccounts,
  listAccountsForSelection,
  startImport,
  getJobStatus
};
