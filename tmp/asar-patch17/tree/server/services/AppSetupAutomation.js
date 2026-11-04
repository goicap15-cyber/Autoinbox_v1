// Service "Tạo app & Webhook" (port từ CRM_FB) — tự động hóa trên developers.facebook.com:
// 1) Lấy cookie Facebook của account (từ extension gửi về) mở phiên Developers trong Chrome thật.
// 2) Bấm "Tạo ứng dụng" (bắt theo href — không phụ thuộc ngôn ngữ).
// 3) Điền "Tên ứng dụng" + "Email liên hệ" rồi chạy hết wizard:
//    Tiếp → chọn "Khác (5)" → chọn "Khác" (trải nghiệm cũ) → Tiếp →
//    chọn "Kinh doanh" → Tiếp → "Tạo ứng dụng".
// 4) Nếu Facebook bắt nhập lại mật khẩu (re-auth): dừng, báo CRM hiện ô nhập
//    mật khẩu → điền vào form xác nhận và bấm "Gửi". Mật khẩu KHÔNG lưu lại.
// Mọi nút bấm bắt theo text đa ngôn ngữ + role, không dùng class tự sinh của FB.
const crypto = require('crypto');
const path = require('path');
const { resolveChromePath } = require('../../../chrome-bundling/resolveChromePath');
const { resolveBinRoot } = require('../utils/appResourceRoot');
// Bộ quét Fanpage (UMD — chạy được cả trong Node): bóc JSON Comet từ HTML facebook.com/pages
const FbPageDiscovery = require('../../extension/pageDiscovery');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// puppeteer-core v25 là ESM thuần — nạp qua dynamic import (cùng cách
// ProcessManager đã dùng, chạy được cả trong app.asar đóng gói).
// puppeteer-extra/stealth KHÔNG dùng được với puppeteer-core ESM này.
let puppeteerPromise = null;
function getPuppeteer() {
  if (!puppeteerPromise) {
    puppeteerPromise = import('puppeteer-core').then((m) => m.default || m);
  }
  return puppeteerPromise;
}

// ── Deps server.js bơm vào qua configurePageSetupAutomation() ──
// - getCookies(accountId)     : cookie Facebook của account (extension chrome.cookies gửi về)
// - getOrCreateVerifyToken()  : verify token webhook (tạo 1 lần, lưu KV)
// - recordRun(status, note)   : nhật ký lần chạy
// - upsertPages/listPages/savePages : danh sách page theo account (inbox_sources)
// - appAdd/appUpdate/appGetLatest/appRemove/appList: bản ghi app theo account
// - onStatus(job)             : bắn trạng thái job ra socket.io cho CRM UI
// - dataDir                   : thư mục lưu screenshot debug
const DEPS = {
  getCookies: async () => [],
  getOrCreateVerifyToken: () => '',
  recordRun: () => {},
  upsertPages: () => {},
  reclaimPages: () => 0,
  listPages: () => [],
  savePages: () => {},
  appAdd: () => {},
  appUpdate: () => {},
  appGetLatest: () => null,
  appRemove: () => {},
  appList: () => [],
  appMergeScanned: () => ({ added: 0, updated: 0, total: 0 }),
  clearPageTokens: () => {},
  removeAccountPages: () => {},
  knownPageIds: () => [],
  log: () => {},
  onStatus: () => {},
  dataDir: '.',
};

function configurePageSetupAutomation(deps = {}) {
  Object.assign(DEPS, deps);
}

// Chrome thật (headful) cho tự động hóa: ưu tiên Chrome bundled của dự án,
// fallback Chrome cài sẵn trên máy — giống đúng cách ProcessManager chạy Chrome.
async function launchAutomationChrome() {
  const args = ['--no-sandbox', '--lang=vi-VN', '--window-size=1200,860'];
  const base = { headless: false, args, defaultViewport: null };
  let exe = null;
  try {
    exe = resolveChromePath({ repoRoot: resolveBinRoot() });
  } catch (_) { /* bỏ qua, dùng fallback dưới */ }
  const candidates = [
    ...(exe ? [{ ...base, executablePath: exe }] : []),
    base,
    { ...base, channel: 'chrome' },
    { ...base, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' },
  ];
  const puppeteer = await getPuppeteer();
  let lastErr = null;
  for (const opt of candidates) {
    try { return await puppeteer.launch(opt); } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Không khởi động được Chrome để tự động hóa.');
}

const jobs = new Map();
let activeId = null;
// Mật khẩu user nhập lần gần nhất — THEO TỪNG UID, chỉ giữ trong RAM của phiên,
// khởi động lại server là mất. Dùng để tự điền khi Facebook hỏi lại.
const lastPasswords = new Map();
// Các input chờ user từ CRM trong luồng đăng ký developer: syncId -> { type: resolve }
const regWaiters = new Map();

// Nhiều worker tab có thể chờ cùng một loại input user (vd tick tay webhook
// khi lấy token song song) — lưu DANH SÁCH waiter theo type, một lần user
// bấm xác nhận gỡ hết thay vì waiter sau đè waiter trước rồi treo 10 phút.
function waitRegisterInput(job, type, timeoutMs, timeoutMsg) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      const list = (job.regWait && job.regWait[type]) || [];
      const i = list.findIndex((w) => w.resolve === resolve);
      if (i >= 0) list.splice(i, 1);
      reject(new Error(timeoutMsg));
    }, timeoutMs);
    job.regWait = job.regWait || {};
    const list = job.regWait[type] || (job.regWait[type] = []);
    list.push({
      resolve: (v) => {
        clearTimeout(t);
        const i = list.findIndex((w) => w.resolve === resolve);
        if (i >= 0) list.splice(i, 1);
        resolve(v);
      },
      reject: (e) => {
        clearTimeout(t);
        const i = list.findIndex((w) => w.reject === reject);
        if (i >= 0) list.splice(i, 1);
        reject(e);
      },
    });
  });
}

function resolveRegisterInput(syncId, type, value) {
  const job = jobs.get(syncId);
  const list = job && job.regWait && job.regWait[type];
  if (!list || !list.length) return false;
  for (const w of [...list]) w.resolve(value);
  return true;
}

function cancelRegisterWaiters(job, reason) {
  if (!job.regWait) return;
  for (const type of Object.keys(job.regWait)) {
    for (const w of [...job.regWait[type]]) w.reject(new Error(reason));
  }
  job.regWait = {};
}

const APPS_URL = 'https://developers.facebook.com/apps/';

// Regex nguồn (chuỗi) dùng trong page context — đa ngôn ngữ
const CONTINUE_RE = '^(?:tiếp|tiếp tục|next|continue|siguiente|continuar|avançar|continuer|weiter)$';
const OTHER_RADIO_RE = '^(?:khác|other|otro|outro|autre)\\b';
const BUSINESS_RE = '^(?:kinh doanh|business|negocios|negócios?|affaires)\\b';
const CREATE_RE = '^(?:tạo ứng dụng|create app|crear aplicaci[oó]n|criar aplicativo|créer une application)$';
const SAVE_WEBHOOK_RE = '^(?:xác minh và lưu|verify and save|verificar y guardar)$';
// Nút Confirm trong dialog đăng ký trường webhook (đa ngôn ngữ)
const CONFIRM_SUBSCRIBE_RE = '^(?:confirm|xác nhận|done|xong|lưu|save|hoàn tất|ok)$';

const DATA_DIR = DEPS.dataDir; // giữ tên biến cũ cho phần thân còn lại

/* ---------- Khởi động tác vụ ---------- */

// cookie không còn đọc từ store — run() sẽ lấy qua DEPS.getCookies(accountId)
function startAppCreation(appName, email, webhookUrl, uid) {
  if (getActive()) return { error: 'Đã có tác vụ đang chạy. Hãy hủy hoặc chờ xong.' };

  // Đóng cửa sổ Chrome của các tác vụ cũ đã xong để không dồn cửa sổ
  for (const [, j] of jobs) {
    if (['success', 'error'].includes(j.status)) closeBrowser(j);
  }

  const id = crypto.randomUUID();
  const job = {
    id,
    uid,
    status: 'opening_browser',
    message: 'Đang mở cửa sổ Chrome…',
    error: null,
    browser: null,
    page: null,
    waitPwd: null,
    webhookUrl: webhookUrl || null,
    appId: null,
    appName,
    createdAt: Date.now(),
  };
  jobs.set(id, job);
  activeId = id;
  run(job, uid, appName, email).catch((e) => failSoft(job, (e && e.message) || 'Lỗi không xác định'));
  return { job };
}

function getJob(id) {
  gc();
  return jobs.get(id) || null;
}

function getActive() {
  gc();
  const job = activeId ? jobs.get(activeId) : null;
  if (job && !['success', 'error'].includes(job.status)) return job;
  return null;
}

function cancelSync(id) {
  const job = jobs.get(id);
  if (!job || ['success', 'error'].includes(job.status)) return false;
  job.status = 'error';
  job.error = 'Đã hủy đồng bộ.';
  job.message = 'Đã hủy đồng bộ.';
  if (job.waitPwd) { const w = job.waitPwd; job.waitPwd = null; w.reject(new Error('Đã hủy.')); }
  cancelRegisterWaiters(job, 'Đã hủy.');
  closeBrowser(job);
  return true;
}

function submitPassword(id, password) {
  const job = jobs.get(id);
  if (!job || !job.waitPwd) return false;
  job.waitPwd.resolve(String(password));
  return true;
}

function gc() {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (['success', 'error'].includes(job.status) && now - job.createdAt > 60 * 60 * 1000) jobs.delete(id);
  }
}

function setStatus(job, status, message) {
  job.status = status;
  job.message = message || '';
  try { DEPS.onStatus(job); } catch (_) { /* không bao giờ để lỗi socket làm hỏng job */ }
}

// Lỗi: đóng Chrome luôn — kết quả đã chụp lại tại dataDir/sync-error.png
function failSoft(job, error) {
  if (['success', 'error'].includes(job.status)) return; // đã hủy/xong rồi — giữ nguyên thông báo cũ
  job.error = String(error);
  job.status = 'error';
  job.message = job.error;
  setStatus(job, 'error', job.error);
  cancelRegisterWaiters(job, 'Đã hủy vì lỗi.');
  closeBrowser(job);
  DEPS.recordRun('error', job.error);
}

function closeBrowser(job) {
  if (job.browser) {
    const b = job.browser;
    job.browser = null;
    b.close().catch(() => {});
  }
}

function errorShot(page, name) {
  return page.screenshot({ path: path.join(DATA_DIR, name) }).catch(() => {});
}

// Điền email liên hệ vào form tạo ứng dụng (cùng cơ chế setVal như pollAndFill)
async function fillContactEmail(page, email) {
  return page.evaluate((email) => {
    const visible = (el) => el && el.offsetParent !== null && !el.disabled;
    const byLabel = (re) => {
      for (const lb of [...document.querySelectorAll('label')]) {
        const t = ((lb.innerText || lb.textContent) || '').trim().toLowerCase();
        if (re.test(t)) {
          const forId = lb.getAttribute('for');
          let el = forId ? document.getElementById(forId) : null;
          if (!el) el = lb.querySelector('input');
          if (visible(el)) return el;
        }
      }
      return null;
    };
    let el = byLabel(/email liên hệ|contact email|correo electr|e-mail de contato|e-mail de contact|contact e-mail/);
    if (!el) {
      const inputs = [...document.querySelectorAll('input[type="text"], input[type="email"]')].filter(visible);
      el = inputs[1] || inputs[0] || null;
    }
    if (!el) return false;
    el.focus();
    const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    proto.call(el, email);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.blur();
    return true;
  }, email).then((r) => {
    if (!r) throw new Error('Không tìm thấy ô "Email liên hệ" trên form.');
  });
}

// Lấy cookie Facebook của account từ Chrome thật (extension gửi về) — dùng chung cho 3 luồng
async function ensureAccountCookies(job, uid) {
  setStatus(job, 'restoring', 'Đang nhận cookie phiên đăng nhập từ Chrome của tài khoản…');
  const cookies = await DEPS.getCookies(uid);
  if (!cookies || !cookies.length) {
    throw new Error('Không lấy được cookie Facebook từ Chrome của tài khoản. Hãy đảm bảo Chrome của account đang chạy và đã đăng nhập Facebook.');
  }
  return cookies;
}

/* ---------- Luồng chính ---------- */

async function run(job, uid, appName, email) {
  const browser = await launchAutomationChrome();
  job.browser = browser;
  job.popups = []; // các popup OAuth (Kết nối trang) sẽ được thu vào đây
  browser.on('targetcreated', (target) => {
    if (target.type() === 'page') {
      target.page().then((p) => { if (p && job.popups) job.popups.push(p); }).catch(() => {});
    }
  });
  browser.on('disconnected', () => {
    job.browser = null;
    if (job.waitPwd) { const w = job.waitPwd; job.waitPwd = null; w.reject(new Error('Cửa sổ Chrome đã bị đóng.')); }
    if (!['success', 'error'].includes(job.status)) {
      failSoft(job, 'Cửa sổ Chrome đã bị đóng.');
    }
  });

  const page = await browser.newPage();
  job.page = page;
  await page.setUserAgent(UA);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7' });

  await injectSession(page, { cookies: await ensureAccountCookies(job, uid) });

  // MỖI LẦN CHẠY = TẠO MỘT APP MỚI (không tái sử dụng app cũ)
  let appId = null;

  setStatus(job, 'loading_apps', 'Đang mở Developers Facebook…');
  await page.goto(APPS_URL, { waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {});
  if (/log_in|login\.php/.test(page.url() || '')) {
    throw new Error('Phiên Facebook đã hết hạn — hãy đăng nhập lại trong CRM rồi đồng bộ lại.');
  }

  // TRƯỜNG HỢP 1: tài khoản FB mới — chưa đăng ký developer → chạy luồng đăng ký trước
  if (await needsDeveloperRegistration(page)) {
    await runDeveloperRegistration(job, page);
    // Đăng ký xong → vào lại danh sách ứng dụng để tạo app
    setStatus(job, 'loading_apps', 'Đăng ký developer xong — đang mở danh sách ứng dụng…');
    await page.goto(APPS_URL, { waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {});
    if (/log_in|login\.php/.test(page.url() || '')) {
      throw new Error('Phiên Facebook đã hết hạn — hãy đăng nhập lại trong CRM.');
    }
  }
  // TRƯỜNG HỢP 2: tài khoản đã đăng ký — đi thẳng vào wizard tạo app (phần dưới)

  setStatus(job, 'finding_create', 'Đang tìm nút "Tạo ứng dụng"…');
  const link = await page
    .waitForSelector('a[href*="/apps/creation"]', { timeout: 60000 })
    .catch(() => null);
  if (!link) {
    throw new Error('Không thấy nút "Tạo ứng dụng" trên trang Ứng dụng. Bạn có thể tự bấm trong Chrome.');
  }
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {}),
    link.click().catch(() => page.evaluate((el) => el.click(), link)),
  ]);

  setStatus(job, 'filling', 'Đang điền Tên ứng dụng & Email liên hệ…');
  const result = await pollAndFill(page, appName, email);
  if (!result.done) {
    throw new Error(result.reason === 'timeout'
      ? 'Không tìm thấy form "Tên ứng dụng" trong 90 giây — hãy kiểm tra cửa sổ Chrome.'
      : 'Không điền được form: ' + (result.reason || 'lỗi không rõ'));
  }
  // Facebook chưa có email liên hệ sẵn (và mình cũng không được cung cấp) → hỏi user
  if (result.needEmail) {
    setStatus(job, 'need_email', 'Facebook cần Email liên hệ cho ứng dụng — nhập email trong CRM rồi bấm Gửi.');
    const contactEmail = await waitRegisterInput(job, 'email', 600000,
      'Không nhận được email liên hệ trong 10 phút. Hãy chạy lại.');
    await fillContactEmail(page, String(contactEmail).trim());
    setStatus(job, 'filling', 'Đã điền email liên hệ — tiếp tục wizard…');
  }

  // Bước 1: Tiếp (App details)
  setStatus(job, 'wizard', 'Đang bấm "Tiếp / Next" (Chi tiết ứng dụng)…');
  await clickWhenAvailable(job, page, CONTINUE_RE, '[role="button"], button', 60000, 'Tiếp / Next (bước 1)');

  // Bước 2: chọn "Khác / Other" — tuỳ giao diện: radio lọc, card, gridcell
  setStatus(job, 'wizard', 'Đang chọn "Khác / Other" (use case)…');
  const pickedOther = await pickOtherOption(job, page);
  if (!pickedOther) {
    await errorShot(page, 'sync-error.png');
    throw new Error('Không chọn được "Khác / Other" trong bước Use cases. Hãy kiểm tra Chrome.');
  }

  // Bước 3: Tiếp
  setStatus(job, 'wizard', 'Đang bấm "Tiếp / Next"…');
  await clickWhenAvailable(job, page, CONTINUE_RE, '[role="button"], button', 60000, 'Tiếp / Next (bước 2)');

  // Bước 4: "Kinh doanh / Business" — tuỳ giao diện, không có thì bỏ qua
  setStatus(job, 'wizard', 'Đang chọn "Kinh doanh / Business" (nếu có)…');
  const hasBiz = await clickWhenAvailableSoft(job, page, BUSINESS_RE, '[role="button"]', 20000);
  if (hasBiz) {
    setStatus(job, 'wizard', 'Đang bấm "Tiếp / Next"…');
    await clickWhenAvailable(job, page, CONTINUE_RE, '[role="button"], button', 60000, 'Tiếp / Next (bước 3)');
  }

  // Bước 5: Tạo ứng dụng
  setStatus(job, 'wizard', 'Đang bấm "Tạo ứng dụng"…');
  await clickWhenAvailable(job, page, CREATE_RE, '[role="button"], button', 60000, 'Tạo ứng dụng (xác nhận)');

  /* ---- Chờ kết quả / mật khẩu xác nhận ----
   * Facebook có thể chen xác thực mật khẩu và HỦY action vừa bấm — vì vậy nếu
   * nút "Tạo ứng dụng" vẫn còn trên màn hình thì bấm lại (tối đa mỗi 8s). */
  const deadline = Date.now() + 180000;
  let lastReclick = 0;
  while (Date.now() < deadline) {
    const url = page.url() || '';
    const m = url.match(/\/apps\/(\d+)/);
    if (m) {
      appId = m[1];
      break;
    }
    if (await passwordVisible(page)) {
      await askPassword(job, page);
      continue; // sau khi gửi mật khẩu, tiếp tục chờ chuyển trang
    }
    // Facebook từ chối: đạt trần 30 app chưa kèm tài khoản kinh doanh đã xác minh
    // (báo lỗi 2026-10-06: dialog "Không tạo được ứng dụng này") — báo ngay, đừng re-click
    const refused = await page
      .evaluate(() => /không tạo được ứng dụng này|lên tới 30 ứng dụng|up to 30 apps/i.test(document.body.innerText || ''))
      .catch(() => false);
    if (refused) {
      await errorShot(page, 'sync-error.png');
      throw new Error('Facebook từ chối tạo app: tài khoản đã đạt giới hạn 30 ứng dụng (chưa có Tài khoản Kinh doanh xác minh). Hãy xóa bớt app cũ trên developers.facebook.com (Ứng dụng của tôi → menu ⋯ → Gỡ ứng dụng) rồi chạy lại — hoặc bấm "Lấy token" để dùng app đã có.');
    }
    if (Date.now() - lastReclick > 8000) {
      if (await clickMatching(page, CREATE_RE, '[role="button"], button')) lastReclick = Date.now();
    }
    await sleep(1500);
  }
  if (!appId) {
    await errorShot(page, 'sync-error.png');
    throw new Error('Đã bấm "Tạo ứng dụng" nhưng 3 phút không thấy chuyển trang. Hãy kiểm tra cửa sổ Chrome — có thể còn một bước xác nhận.');
  }
  setStatus(job, 'wizard', `Đã tạo ứng dụng (App ID: ${appId}) — chuyển sang cấu hình Messenger…`);

  // Cấu hình Messenger/webhook/trang; lỗi vẫn ghi lịch sử app trước khi báo lỗi
  let pages = [];
  let setupNote = '';
  let setupErr = null;
  try {
    const result = await setupMessenger(job, page, appId);
    pages = result.pages;
    setupNote = result.note;
  } catch (e) {
    setupErr = e;
  }
  DEPS.appAdd(job.uid, {
    appId,
    name: appName,
    email,
    webhookUrl: job.webhookUrl || null,
    createdAt: new Date().toISOString(),
    status: setupErr ? 'error' : 'success',
    note: setupErr ? String(setupErr.message || setupErr).slice(0, 300) : setupNote,
    pages,
  });
  if (setupErr) throw setupErr;

  const successMsg =
    (pages.length
      ? `Đã tạo app mới (App ID: ${appId}) và đồng bộ ${pages.length} trang: ${pages.map((p) => p.name).join(', ')}. `
      : `Đã tạo app mới (App ID: ${appId}) nhưng chưa cào được trang nào. `) +
    `Webhook: ${job.webhookUrl}`;
  setStatus(job, 'success', successMsg);
  DEPS.recordRun('success', successMsg);
  closeBrowser(job); // xong việc là tự đóng Chrome
}

/* ---------- Đăng ký developer cho tài khoản FB mới ---------- */

// Tài khoản mới: /apps/ bị đưa về trang landing có link Get Started (/async/registration)
// CHỜ URL ỔN ĐỊNH tối đa 15s (FB có thể redirect qua lại) rồi mới kết luận
async function needsDeveloperRegistration(page) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const r = await page
      .evaluate(() => {
        const onApps = /\/apps(\/|$|\?)/.test(location.pathname);
        if (onApps) return { onApps: true, landing: false };
        const gs = !!document.querySelector('a[href*="async/registration"]');
        return { onApps: false, landing: gs };
      })
      .catch(() => ({ onApps: false, landing: false }));
    if (r.onApps) return false;     // đã vào danh sách app → đã đăng ký
    if (r.landing) return true;     // trang landing có Get Started → chưa đăng ký
    await sleep(1500);
  }
  return false; // không xác định được → coi như đã đăng ký, để flow tạo app tự xử lý
}

// Driver tổng quát cho dialog đăng ký developer — xử lý MỌI màn hình
// (Continue/Next/Agree/OK/điều khoản/checkbox/radio/OTP/country-phone)
// cho tới khi: gặp form Verify (combobox quốc gia) → trả về 'verify'
//              hoặc dialog đóng + rời trang registration → trả về 'done'
const REG_FORWARD_RES = [
  '^(?:tiếp tục|continue)$',
  '^(?:next|tiếp)$',
  '^(?:bắt đầu|get started)$',
  '^(?:đồng ý|i agree|agree|accept)$',
  '^(?:ok|xác nhận|confirm)$',
  '^(?:confirm email|xác nhận email)$',
  '^(?:gửi|submit)$',
  '^(?:đã hiểu|got it|done|finish)$',
  '^(?:complete registration|hoàn tất đăng ký)$',
  '^(?:tạo ứng dụng|create app)$',
];

async function otpInputVisible(page) {
  return page
    .evaluate(() => {
      const vis = (el) => el.offsetParent !== null || el.getClientRects().length > 0;
      const dlg = [...document.querySelectorAll('[role="dialog"]')].find(vis);
      const scope = dlg || document.body;
      const emptyInputs = [...scope.querySelectorAll('input')]
        .filter((x) => vis(x) && x.type === 'text' && !(x.value || ''));
      if (dlg) return emptyInputs.length > 0; // trong dialog FB → là ô OTP
      // Trang registration (không có role=dialog): màn OTP = có input trống
      // kèm link "Send SMS Again" / nút "Update Mobile Number"
      const onReg = /async\/registration/.test(location.href);
      const hasResend = /send sms again|gửi lại sms|update mobile number/i.test(document.body.innerText || '');
      return onReg && hasResend && emptyInputs.length > 0;
    })
    .catch(() => false);
}

// Bấm nút khớp text nhưng BỎ QUA nút bị khóa (aria-disabled) — cho driver đăng ký
async function clickEnabledMatching(page, source, selector) {
  return page.evaluate((source, selector) => {
    const re = new RegExp(source, 'i');
    const els = [...document.querySelectorAll(selector)];
    const matches = els.filter((el) => {
      const visible = el.offsetParent !== null || el.getClientRects().length > 0;
      if (!visible) return false;
      if (el.getAttribute('aria-disabled') === 'true') return false;
      const t = (el.innerText || '').trim();
      return t && re.test(t);
    });
    if (!matches.length) return false;
    const el = matches[matches.length - 1];
    el.scrollIntoView({ block: 'center' });
    const o = { bubbles: true, cancelable: true, view: window };
    for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      el.dispatchEvent(new MouseEvent(t, o));
    }
    return true;
  }, source, selector).catch(() => false);
}

async function driveRegistrationDialogs(job, page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let infoAsked = false;
  let otpAsked = false;
  let acHandled = false;

  while (Date.now() < deadline) {
    if (!job.browser) throw new Error('Cửa sổ Chrome đã bị đóng.');
    if (await passwordVisible(page)) { await askPassword(job, page); continue; }

    // Đã quay lại trang danh sách app = đăng ký xong (hoặc không cần) → kết thúc luồng đăng ký
    const onAppsList = await page
      .evaluate(() => /developers\.facebook\.com\/apps(\/|$|\?)/.test(location.href)
        && !/async\/registration/.test(location.href))
      .catch(() => false);
    if (onAppsList) return 'done';

    // Tự gỡ popup thông báo của FB nếu hiện
    await dismissPopups(page);

    // Form Verify hiện ra (combobox quốc gia)? → trả về để chạy bước xác minh SĐT
    if (await verifyFormVisible(page)) {
      if (!infoAsked) {
        setStatus(job, 'register_info', 'Cần xác minh tài khoản — chọn quốc gia và nhập số điện thoại trong CRM.');
        const info = await waitRegisterInput(job, 'info', 600000,
          'Không nhận được quốc gia/số điện thoại trong 10 phút. Hãy chạy lại.');
        infoAsked = true;
        setStatus(job, 'verifying', `Đang chọn quốc gia ${info.country}…`);
        await openCountryCombobox(page);
        await pickCountryOption(page, info.country);
        setStatus(job, 'verifying', 'Đang điền số điện thoại…');
        await fillPhoneInput(page, info.phone);
        setStatus(job, 'verifying', 'Đang bấm "Send Verification SMS"…');
        await clickSmsButton(page);
        await sleep(3000);
        continue;
      }
  return 'timeout';
}

    // OTP input hiện ra trong dialog? → hỏi mã từ CRM (một lần)
    if (!otpAsked && (await otpInputVisible(page))) {
      setStatus(job, 'register_code', 'Facebook đã gửi OTP — nhập mã trong CRM. Không nhận được thì bấm "Gửi lại SMS".');
      const code = await waitRegisterInput(job, 'code', 600000,
        'Không nhận được OTP trong 10 phút. Hãy chạy lại.');
      otpAsked = true;
      setStatus(job, 'verifying', 'Đang điền OTP…');
      await fillOtpInput(page, code);
      await sleep(800);
      continue; // vòng sau sẽ bấm nút chuyển bước
    }

    // Lỗi Accounts Center? (sau khi đã điền info) → hỏi user Đồng ý/Hủy
    if (infoAsked && !acHandled) {
      const acErr = await page
        .evaluate(() => /accounts center|trung tâm tài khoản/i.test(document.body.innerText || ''))
        .catch(() => false);
      if (acErr) {
        acHandled = true;
        setStatus(job, 'register_ac',
          'Facebook yêu cầu thêm số điện thoại qua Accounts Center trước. Bấm "Đồng ý" để mở Accounts Center.');
        const choice = await waitRegisterInput(job, 'ac', 600000,
          'Không nhận được lựa chọn trong 10 phút. Hãy chạy lại.');
        if (choice !== 'agree') throw new Error('Đã hủy — hãy thêm số điện thoại vào Facebook rồi chạy lại.');
        const acLink = await page.waitForSelector('a[href*="accountscenter.facebook.com"]', { timeout: 15000 }).catch(() => null);
        if (!acLink) throw new Error('Không thấy link Accounts Center trên trang.');
        await acLink.click().catch(() => page.evaluate((el) => el.click(), acLink));
        setStatus(job, 'register_ac_wait',
          'Chrome đang mở Accounts Center — hãy thêm số điện thoại vào đó (Personal details). Xong bấm "Hoàn tất" trong CRM.');
        await waitRegisterInput(job, 'acDone', 1200000, 'Không nhận được xác nhận hoàn tất trong 20 phút.');
        await backToVerification(page);
        setStatus(job, 'verifying', 'Đang bấm lại "Send Verification SMS"…');
        await clickSmsButton(page);
        await sleep(3000);
        continue;
      }
    }

    // Đăng ký hoàn tất? dialog đóng + rời trang registration
    const done = await page
      .evaluate(() => {
        const dlgVisible = [...document.querySelectorAll('[role="dialog"]')].some((x) => x.offsetParent);
        const onReg = /async\/registration/.test(location.href);
        return !dlgVisible && !onReg;
      })
      .catch(() => false);
    if (done && (infoAsked || otpAsked)) return 'done';

    // Bấm nút chuyển bước (đa ngôn ngữ) — BỎ QUA nút bị khóa, ưu tiên nút cuối trong DOM
    let clicked = false;
    for (const re of REG_FORWARD_RES) {
      if (await clickEnabledMatching(page, re, '[role="button"], button')) { clicked = true; break; }
    }
    if (clicked) { await sleep(2000); continue; }

    // Nút chuyển bước bị khóa → tick checkbox / chọn radio trong dialog
    const picked = await page
      .evaluate(() => {
        const dlg = [...document.querySelectorAll('[role="dialog"]')].find((x) => x.offsetParent) || document.body;
        const vis = (el) => el.offsetParent !== null;
        const cb = [...dlg.querySelectorAll('input[type="checkbox"]')]
          .find((i) => vis(i) && !i.checked && i.getAttribute('aria-checked') !== 'true');
        if (cb) {
          const target = cb.closest('label') || cb;
          target.scrollIntoView({ block: 'center' });
          const o = { bubbles: true, cancelable: true, view: window };
          for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
            target.dispatchEvent(new MouseEvent(t, o));
          }
          return 'checkbox';
        }
        const opt = [...dlg.querySelectorAll('[role="radio"], [role="option"]')]
          .find((i) => vis(i) && i.getAttribute('aria-checked') === 'false');
        if (opt) {
          opt.scrollIntoView({ block: 'center' });
          const o = { bubbles: true, cancelable: true, view: window };
          for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
            opt.dispatchEvent(new MouseEvent(t, o));
          }
          return 'radio';
        }
        // Card "Other / Khác" (màn chọn use case sau đăng ký)
        const otherCard = [...dlg.querySelectorAll('[role="button"], button, [role="radio"]')]
          .find((b) => /^(?:other|khác)\b/i.test((b.innerText || '').trim()) && vis(b));
        if (otherCard) {
          otherCard.scrollIntoView({ block: 'center' });
          const o = { bubbles: true, cancelable: true, view: window };
          for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
            otherCard.dispatchEvent(new MouseEvent(t, o));
          }
          return 'other-card';
        }
        return null;
      })
      .catch(() => null);
    if (picked) { await sleep(1200); continue; }

    await sleep(1500);
  }
  return 'timeout';
}

// Luồng đăng ký developer cho tài khoản FB mới (driver tổng quát bên trong)
async function runDeveloperRegistration(job, page) {
  setStatus(job, 'register_started', 'Tài khoản chưa đăng ký Meta Developer — đang mở đăng ký…');

  // 1) Bấm "Get Started"
  const gs = await page.waitForSelector('a[href*="async/registration"]', { timeout: 30000 }).catch(() => null);
  if (!gs) throw new Error('Không thấy nút "Get Started" để đăng ký developer.');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {}),
    gs.click().catch(() => page.evaluate((el) => el.click(), gs)),
  ]);

  // 2) Driver tổng quát đi qua TẤT CẢ các màn (Continue, điều khoản, OTP, verify…)
  const outcome = await driveRegistrationDialogs(job, page, 600000);

  if (outcome !== 'done') {
    await errorShot(page, 'sync-error.png');
    throw new Error('Luồng đăng ký developer chưa hoàn tất (hết 10 phút hoặc kẹt màn hình). Hãy kiểm tra Chrome và chạy lại.');
  }

  setStatus(job, 'verifying', 'Đăng ký developer hoàn tất…');
  await sleep(4000);
}

// Điền OTP vào input trong dialog (hoặc input text trống bất kỳ)
async function fillOtpInput(page, code) {
  const focused = await page
    .evaluate(() => {
      const dlg = [...document.querySelectorAll('[role="dialog"]')].find((x) => x.offsetParent);
      const scope = dlg || document.body;
      const i = [...scope.querySelectorAll('input')]
        .find((x) => x.offsetParent !== null && x.type === 'text' && !(x.value || ''));
      if (!i) return false;
      i.focus();
      return true;
    })
    .catch(() => false);
  if (focused) {
    await page.keyboard.type(code, { delay: 40 }).catch(() => {});
  } else {
    await page
      .evaluate(() => {
        const i = [...document.querySelectorAll('input')]
          .find((x) => x.offsetParent !== null && x.type === 'text' && !(x.value || ''));
        if (i) i.focus();
        return !!i;
      })
      .catch(() => false);
    await page.keyboard.type(code, { delay: 40 }).catch(() => {});
  }
  await sleep(400);
}

// Bấm link "Send SMS Again" trên trang FB khi user không nhận được OTP
async function resendRegisterSms(syncId) {
  const job = jobs.get(syncId);
  if (!job || !job.page) return false;
  return clickMatching(job.page, '^(?:send sms again|gửi lại sms)$', 'a, [role="button"], button');
}

async function backToVerification(page) {
  // Link Accounts Center có thể mở cùng tab — lùi lại tới khi thấy lại form SĐT
  for (let i = 0; i < 5; i++) {
    const ok = await page
      .evaluate(() => /sms|phone|điện thoại/i.test(document.body.innerText || ''))
      .catch(() => false);
    if (ok) return;
    await page.goBack().catch(() => {});
    await sleep(2500);
  }
}

// Form "Verify Your Account" hiện ra = có combobox quốc gia nhìn thấy trên trang
async function verifyFormVisible(page) {
  return page
    .evaluate(() => {
      const cb = [...document.querySelectorAll('[role="combobox"]')]
        .find((c) => c.offsetParent !== null || c.getClientRects().length > 0);
      return !!cb;
    })
    .catch(() => false);
}

async function openCountryCombobox(page) {
  // Bấm MỘT lần rồi chờ option render (bấm nhiều lần sẽ toggle đóng ngược lại)
  let clicked = false;
  let extraClicks = 0;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const res = await page.evaluate((doClick) => {
      const cb = [...document.querySelectorAll('[role="combobox"]')]
        .find((c) => c.offsetParent !== null || c.getClientRects().length > 0);
      if (!cb) return { found: false, options: 0 };
      if (doClick) {
        try { cb.focus(); } catch { /* bỏ qua */ }
        const o = { bubbles: true, cancelable: true, view: window };
        for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
          cb.dispatchEvent(new MouseEvent(t, o));
        }
      }
      const opts = [...document.querySelectorAll('[role="option"]')]
        .filter((x) => x.offsetParent !== null || x.getClientRects().length > 0);
      return { found: true, options: opts.length, expanded: cb.getAttribute('aria-expanded') === 'true' };
    }, !clicked).catch(() => ({ found: false, options: 0 }));
    if (res.found && res.options > 0) return true;
    if (!clicked) { clicked = true; await sleep(1200); continue; }
    // đã bấm mà 4s không có option → có thể toggle đóng — bấm thêm 1 lần
    extraClicks++;
    if (extraClicks > 2) break;
    await sleep(2500);
    await page.evaluate(() => {
      const cb = [...document.querySelectorAll('[role="combobox"]')]
        .find((c) => c.offsetParent !== null || c.getClientRects().length > 0);
      if (cb) { const o = { bubbles: true, cancelable: true, view: window }; for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) cb.dispatchEvent(new MouseEvent(t, o)); }
    }).catch(() => {});
    await sleep(1500);
  }
  await errorShot(page, 'sync-error.png');
  throw new Error('Không mở được ô chọn quốc gia trên trang.');
}

async function pickCountryOption(page, countryName) {
  const deadline = Date.now() + 40000;
  let typed = '';
  while (Date.now() < deadline) {
    const res = await page.evaluate((name) => {
      const vis = (el) => el.offsetParent !== null || el.getClientRects().length > 0;
      const cb = [...document.querySelectorAll('[role="combobox"]')].find(vis);
      const opts = [...document.querySelectorAll('[role="option"]')].filter(vis);
      if (!opts.length) return { open: false, picked: false };
      const match = opts.find((o) => (o.innerText || '').toLowerCase().includes(name.toLowerCase()));
      if (match) {
        match.scrollIntoView({ block: 'center' });
        const o = { bubbles: true, cancelable: true, view: window };
        for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
          match.dispatchEvent(new MouseEvent(t, o));
        }
        return { open: true, picked: true };
      }
      return { open: true, picked: false, optCount: opts.length };
    }, countryName).catch(() => ({ open: false, picked: false }));

    if (res.picked) return true;

    if (!res.open) {
      // dropdown đóng — mở lại bằng MỘT click rồi chờ
      await page.evaluate(() => {
        const cb = [...document.querySelectorAll('[role="combobox"]')].find((c) => c.offsetParent !== null || c.getClientRects().length > 0);
        if (cb) {
          try { cb.focus(); } catch { /* bỏ qua */ }
          const o = { bubbles: true, cancelable: true, view: window };
          for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) cb.dispatchEvent(new MouseEvent(t, o));
        }
      }).catch(() => {});
      await sleep(1800);
      continue;
    }
    // dropdown mở nhưng chưa thấy option khớp → typeahead lần đầu, sau đó cuộn
    if (!typed) {
      await page.keyboard.type(countryName.slice(0, 4), { delay: 90 }).catch(() => {});
      typed = countryName.slice(0, 4);
      await sleep(1200);
      continue;
    }
    await page.evaluate(() => {
      const vis = (el) => el.offsetParent !== null || el.getClientRects().length > 0;
      const lb = [...document.querySelectorAll('[role="listbox"]')].find(vis);
      if (lb) {
        const scrollers = [lb, ...lb.querySelectorAll('*')].filter((x) => x.scrollHeight > x.clientHeight + 20);
        if (scrollers.length) {
          const sc = scrollers[scrollers.length - 1];
          sc.scrollTop = Math.min(sc.scrollTop + 700, sc.scrollHeight);
        } else lb.scrollTop = lb.scrollHeight;
      }
    }).catch(() => {});
    await sleep(700);
  }
  await errorShot(page, 'sync-error.png');
  throw new Error(`Không chọn được quốc gia "${countryName}" trong danh sách.`);
}

async function fillPhoneInput(page, phone) {
  const filled = await page
    .evaluate(() => {
      const i = [...document.querySelectorAll('input')]
        .find((x) => x.offsetParent !== null && x.type === 'text'
          && (/phone|điện thoại/i.test(x.placeholder || '') || /phone|điện thoại/i.test(x.getAttribute('aria-labelledby') || '')
            || (x.id && /phone/i.test(x.id))));
      if (!i) return false;
      i.focus();
      i.click();
      return true;
    })
    .catch(() => false);
  if (!filled) {
    // dự phòng: input text đầu tiên hiển thị (không phải ô tìm kiếm quốc gia)
    await page
      .evaluate(() => {
        const i = [...document.querySelectorAll('input[type="text"]')].find((x) => x.offsetParent !== null);
        if (i) i.focus();
        return !!i;
      })
      .catch(() => false);
  }
  await page.keyboard.type(phone, { delay: 30 }).catch(() => {});
  await sleep(400);
}

async function clickSmsButton(page) {
  // Nút Send SMS bị khóa tới khi điền đủ SĐT — chờ bật rồi bấm
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    const clicked = await page
      .evaluate(() => {
        const btns = [...document.querySelectorAll('[role="button"], button')]
          .filter((b) => /sms/i.test((b.innerText || '').trim())
            && b.getAttribute('aria-disabled') !== 'true'
            && (b.offsetParent !== null || b.getClientRects().length > 0));
        if (!btns.length) return false;
        const b = btns[btns.length - 1];
        b.scrollIntoView({ block: 'center' });
        const o = { bubbles: true, cancelable: true, view: window };
        for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
          b.dispatchEvent(new MouseEvent(t, o));
        }
        return true;
      })
      .catch(() => false);
    if (clicked) return;
    await sleep(1000);
  }
  await errorShot(page, 'sync-error.png');
  throw new Error('Không bấm được nút "Send Verification SMS" — có thể chưa điền đủ SĐT. Hãy kiểm tra Chrome.');
}

/* Bấm lại "Tạo ứng dụng" trên cửa sổ Chrome của job cũ (khi re-auth làm hủy action) */
async function resumeSync(syncId) {
  const job = jobs.get(syncId);
  if (!job) return { error: 'Không tìm thấy tác vụ.' };
  if (!job.browser || !job.page) return { error: 'Cửa sổ Chrome đã đóng — hãy chạy Đồng bộ lại từ đầu.' };
  job.status = 'wizard';
  job.error = null;
  job.message = 'Đang bấm lại "Tạo ứng dụng"…';
  finishResume(job).catch((e) => failSoft(job, (e && e.message) || 'Lỗi không xác định'));
  return { job };
}

async function finishResume(job) {
  const page = job.page;
  const deadline = Date.now() + 180000;
  let lastReclick = 0;
  let appId = null;
  while (Date.now() < deadline) {
    if (!job.browser) throw new Error('Cửa sổ Chrome đã bị đóng.');
    const url = page.url() || '';
    const m = url.match(/\/apps\/(\d+)/);
    if (m) {
      appId = m[1];
      break;
    }
    if (await passwordVisible(page)) {
      await askPassword(job, page);
      continue;
    }
    if (Date.now() - lastReclick > 8000) {
      if (await clickMatching(page, CREATE_RE, '[role="button"], button')) lastReclick = Date.now();
    }
    await sleep(1500);
  }
  if (!appId) {
    await errorShot(page, 'sync-error.png');
    throw new Error('Vẫn không thấy chuyển trang — hãy bấm tay nút "Tạo ứng dụng" trong Chrome.');
  }
  let pages = [];
  let setupErr = null;
  try {
    const result = await setupMessenger(job, page, appId);
    pages = result.pages;
  } catch (e) {
    setupErr = e;
  }
  DEPS.appAdd(job.uid, {
    appId,
    name: job.appName || 'CRM app',
    email: null,
    webhookUrl: job.webhookUrl || null,
    createdAt: new Date().toISOString(),
    status: setupErr ? 'error' : 'success',
    note: setupErr ? String(setupErr.message || setupErr).slice(0, 300) : (job.message || ''),
    pages,
  });
  if (setupErr) throw setupErr;

  const successMsg = `Đã tạo app mới (App ID: ${appId})` +
    (pages.length ? ` và đồng bộ ${pages.length} trang: ${pages.map((p) => p.name).join(', ')}.` : '.');
  setStatus(job, 'success', successMsg);
  DEPS.recordRun('success', successMsg);
  closeBrowser(job); // xong việc là tự đóng Chrome
}

/* ---------- Các bước tiện ích ---------- */

// Bấm nút có text khớp regex. Ưu tiên nút cuối cùng trong DOM (footer của dialog).
async function clickMatching(page, source, selector) {
  return page.evaluate((source, selector) => {
    const re = new RegExp(source, 'i');
    const els = [...document.querySelectorAll(selector)];
    const matches = els.filter((el) => {
      const visible = el.offsetParent !== null || el.getClientRects().length > 0;
      if (!visible) return false;
      const t = (el.innerText || el.textContent || '').trim();
      return t && re.test(t);
    });
    if (!matches.length) return false;
    const el = matches[matches.length - 1];
    el.scrollIntoView({ block: 'center' });
    const opts = { bubbles: true, cancelable: true, view: window };
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      el.dispatchEvent(new MouseEvent(type, opts));
    }
    return true;
  }, source, selector).catch(() => false);
}

async function passwordVisible(page) {
  return page
    .evaluate(() => {
      const i = document.querySelector('#ajax_password, input[data-testid="reauth_password_field"]');
      return !!(i && i.offsetParent);
    })
    .catch(() => false);
}

// Tự xử lý popup thông báo của FB: "new way to create apps" → bấm Create app;
// popup khác → bấm Got it / OK / X. Trả về tên hành động đã làm (hoặc null)
async function dismissPopups(page) {
  return page
    .evaluate(() => {
      const vis = (el) => el.offsetParent !== null || el.getClientRects().length > 0;
      const dlgs = [...document.querySelectorAll('[role="dialog"], div[aria-modal="true"]')].filter(vis);
      for (const d of dlgs) {
        const t = (d.innerText || '').toLowerCase();
        const btns = [...d.querySelectorAll('[role="button"], button')];
        // Popup "new way to create apps" → bấm Create app để tiếp tục
        const createBtn = btns.find((b) => /^(?:create app|tạo ứng dụng)$/i.test((b.innerText || '').trim()));
        if (createBtn && /new way|cách mới|new system/.test(t)) {
          createBtn.scrollIntoView({ block: 'center' });
          createBtn.click();
          return 'create-app';
        }
        // Popup thông báo chung → bấm Got it / OK / X để đóng
        const dismiss = btns.find((b) => /^(?:got it|đã hiểu|ok|x)$/i.test((b.innerText || '').trim())
          || (b.getAttribute('aria-label') || '').toLowerCase() === 'close');
        if (dismiss && !/gỡ ứng dụng|remove app/i.test(t)) {
          dismiss.click();
          return 'dismissed';
        }
      }
      return null;
    })
    .catch(() => null);
}

// Chờ phần tử xuất hiện rồi bấm; nếu Facebook chặn bằng form mật khẩu thì xử lý
// mật khẩu trước (gia hạn thời gian chờ) rồi bấm lại. Mỗi vòng còn tự gỡ popup FB.
async function clickWhenAvailableSoft(job, page, source, selector, timeoutMs) {
  let deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await passwordVisible(page)) {
      await askPassword(job, page);
      deadline = Date.now() + timeoutMs;
      continue;
    }
    await dismissPopups(page);
    if (await clickMatching(page, source, selector)) return true;
    await sleep(1000);
  }
  return false;
}

// Bản fatal — hết giờ thì chụp ảnh + throw
async function clickWhenAvailable(job, page, source, selector, timeoutMs, label) {
  const ok = await clickWhenAvailableSoft(job, page, source, selector, timeoutMs);
  if (!ok) {
    await errorShot(page, 'sync-error.png');
    throw new Error(`Không tìm thấy bước "${label}" trong ${Math.round(timeoutMs / 1000)}s — Facebook có thể đã đổi luồng. Hãy kiểm tra cửa sổ Chrome.`);
  }
}

// Bản fatal của clickWhenAvailable — hết giờ thì chụp ảnh + throw
async function clickWhenAvailable(job, page, source, selector, timeoutMs, label) {
  const ok = await clickWhenAvailableSoft(job, page, source, selector, timeoutMs);
  if (!ok) {
    await errorShot(page, 'sync-error.png');
    throw new Error(`Không tìm thấy bước "${label}" trong ${Math.round(timeoutMs / 1000)}s — Facebook có thể đã đổi luồng. Hãy kiểm tra cửa sổ Chrome.`);
  }
}

// Chọn "Khác / Other" ở bước Use cases — 2 pha:
// A) bấm filter "Khác (5)" / "Others (5)" (radio/label/gridcell)
// B) bấm card "Other / Khác" (trải nghiệm cũ) rồi xác nhận bằng nút Continue bên ngoài
async function pickOtherOption(job, page) {
  const deadline = Date.now() + 90000;
  let filterDone = false;
  let cardDone = false;
  while (Date.now() < deadline && !cardDone) {
    const res = await page
      .evaluate((filterDone) => {
        const vis = (el) => el.offsetParent !== null || el.getClientRects().length > 0;
        const clickEl = (el) => {
          el.scrollIntoView({ block: 'center' });
          const input = el.querySelector('input[type="radio"], input[type="checkbox"]');
          const target = input || el;
          const o = { bubbles: true, cancelable: true, view: window };
          for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
            target.dispatchEvent(new MouseEvent(t, o));
          }
        };
        // Pha A: filter "Khác (n)" / "Others (n)"
        if (!filterDone) {
          const f = [...document.querySelectorAll('[role="radio"], [role="gridcell"], label, [role="option"], [role="tab"], [role="button"]')]
            .find((el) => vis(el) && /^(?:khác|others?)\s*\(\d+\)/i.test((el.innerText || '').trim()));
          if (f) { clickEl(f); return { act: 'filter' }; }
          return { act: null };
        }
        // Pha B: card "Other / Khác" — ưu tiên card có ghi chú legacy/trải nghiệm cũ
        const cands = [...document.querySelectorAll('[role="button"], [role="radio"], [role="gridcell"], button, label')]
          .filter((el) => vis(el) && /^(?:other|khác)\b/i.test((el.innerText || '').trim()));
        if (!cands.length) return { act: null };
        const legacy = cands.find((el) => /legacy|trải nghiệm cũ|going away/i.test(el.innerText || ''));
        clickEl(legacy || cands[cands.length - 1]);
        return { act: 'card' };
      }, filterDone)
      .catch(() => ({ act: null }));

    if (res.act === 'filter') { filterDone = true; await sleep(2500); continue; }
    if (res.act === 'card') { cardDone = true; break; }
    await sleep(1500);
  }
  return cardDone;
}

function askPassword(job, page) {
  // Worker tab chạy song song có thể gặp form re-auth cùng lúc — xếp hàng để
  // job.waitPwd (1 slot) không bị đè; mật khẩu đã nhập trong phiên được tái dùng
  // nên lần chờ sau thường tự điền, không hỏi lại user thêm lần nữa.
  job.pwdChain = (job.pwdChain || Promise.resolve()).catch(() => {});
  return job.pwdChain.then(() => askPasswordOnce(job, page));
}

async function askPasswordOnce(job, page) {
  return (async () => {
    // Ưu tiên mật khẩu user đã nhập trong phiên này (theo uid, chỉ giữ trong RAM)
    const lp = lastPasswords.get(job.uid);
    if (lp) {
      setStatus(job, 'verifying', 'Đang dùng mật khẩu đã lưu trong phiên để xác nhận…');
      await fillPassword(page, lp);
      await sleep(3000);
      if (!(await passwordVisible(page))) return 'handled';
      lastPasswords.delete(job.uid); // sai — phải hỏi lại user
    }
    setStatus(job, 'need_password',
      'Facebook yêu cầu nhập mật khẩu để xác nhận. Vui lòng nhập trong CRM rồi bấm "Gửi mật khẩu".');
    const pwd = await waitUserPassword(job);
    lastPasswords.set(job.uid, pwd);
    setStatus(job, 'verifying', 'Đang gửi mật khẩu xác nhận tới Facebook…');
    const ok = await fillPassword(page, pwd);
    if (!ok) throw new Error('Không điền được mật khẩu vào form xác nhận của Facebook.');
    await sleep(3500);
    const still = await passwordVisible(page);
    if (still) {
      setStatus(job, 'need_password', 'Facebook chưa chấp nhận mật khẩu (có thể sai). Vui lòng nhập lại.');
      const pwd2 = await waitUserPassword(job);
      lastPasswords.set(job.uid, pwd2);
      setStatus(job, 'verifying', 'Đang gửi lại mật khẩu…');
      await fillPassword(page, pwd2);
      await sleep(3500);
    }
    return 'handled';
  })();
}

async function fillPassword(page, pwd) {
  const input = await page
    .waitForSelector('#ajax_password, input[data-testid="reauth_password_field"], input[type="password"]',
      { timeout: 15000, visible: true })
    .catch(() => null);
  if (!input) return false;
  await input.click({ clickCount: 3 }).catch(() => {}); // chọn sẵn text cũ để thay thế
  await input.type(pwd, { delay: 15 }).catch(() => {});
  await sleep(300);
  // Gửi bằng Enter ngay trên ô mật khẩu — form submit gốc của trình duyệt
  await page.keyboard.press('Enter').catch(() => {});
  await sleep(2000);
  return true;
}

function waitUserPassword(job) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      job.waitPwd = null;
      reject(new Error('Không nhận được mật khẩu trong 10 phút. Hãy chạy lại Đồng bộ.'));
    }, 600000);
    job.waitPwd = {
      resolve: (v) => { clearTimeout(t); job.waitPwd = null; resolve(v); },
      reject: (e) => { clearTimeout(t); job.waitPwd = null; reject(e); },
    };
  });
}

/* ---------- Điền form Tên + Email (giữ nguyên từ phiên bản trước) ---------- */

async function pollAndFill(page, appName, email) {
  const attempt = () => page.evaluate((appName, email) => {
    const visible = (el) => el && el.offsetParent !== null && !el.disabled;
    const byLabel = (re) => {
      for (const lb of [...document.querySelectorAll('label')]) {
        const t = ((lb.innerText || lb.textContent) || '').trim().toLowerCase();
        if (re.test(t)) {
          const forId = lb.getAttribute('for');
          let el = forId ? document.getElementById(forId) : null;
          if (!el) el = lb.querySelector('input');
          if (visible(el)) return el;
        }
      }
      return null;
    };
    const findInputs = () => {
      let name = byLabel(/tên ứng dụng|app name|nombre de la aplicaci|nome do aplicativo|nom de l'application/);
      let emailEl = byLabel(/email liên hệ|contact email|correo electr|e-mail de contato|e-mail de contact|contact e-mail/);
      if (!visible(name) || !visible(emailEl)) {
        const inputs = [...document.querySelectorAll('input[type="text"]')].filter(visible);
        if (!name && inputs.length >= 2) { name = inputs[0]; emailEl = emailEl || inputs[1]; }
        else if (!name && inputs.length === 1) { name = inputs[0]; }
      }
      return { name: visible(name) ? name : null, email: visible(emailEl) ? emailEl : null };
    };
    const setVal = (el, v) => {
      el.focus();
      const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      proto.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.blur();
    };
    return new Promise((resolve) => {
      const deadline = Date.now() + 90000;
      const tick = () => {
        try {
          const { name, email: emailEl } = findInputs();
          if (name) {
            setVal(name, appName);
            if (emailEl) {
              // KHÔNG đụng vào email nếu mình không có email mới — Facebook
              // thường tự điền sẵn email của tài khoản, xóa nó là kẹt bước "Tiếp".
              if (email && email.trim()) setVal(emailEl, email);
              const filled = (emailEl.value || '').trim() !== '';
              return resolve({ done: true, emailFilled: filled, needEmail: !filled });
            }
            setTimeout(() => {
              const again = findInputs();
              if (again.email) {
                if (email && email.trim()) setVal(again.email, email);
                const filled = (again.email.value || '').trim() !== '';
                resolve({ done: true, emailFilled: filled, needEmail: !filled });
              }
              else resolve({ done: true, emailFilled: false, needEmail: true });
            }, 1500);
            return;
          }
        } catch (e) {
          return resolve({ done: false, reason: String(e && e.message || e) });
        }
        if (Date.now() > deadline) return resolve({ done: false, reason: 'timeout' });
        setTimeout(tick, 800);
      };
      tick();
    });
  }, appName, email).catch((e) => ({ done: false, reason: String(e && e.message || e) }));

  let r = await attempt();
  if (!r.done && r.reason && /execution context|destroyed|target closed/i.test(r.reason)) {
    await new Promise((res) => setTimeout(res, 2000));
    r = await attempt();
  }
  return r;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/* ---------- Giai đoạn 2: Messenger product + webhook ---------- */

async function setupMessenger(job, page, appId) {
  const webhookUrl = job.webhookUrl || 'http://localhost:3000/webhook';
  const verifyToken = DEPS.getOrCreateVerifyToken();

  setStatus(job, 'adding_messenger', 'Đang mở dashboard và thêm sản phẩm Messenger…');
  await page.goto(`https://developers.facebook.com/apps/${appId}/dashboard/`, { waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {});

  // Bấm "Thiết lập" của Messenger nếu chưa thêm (href chứa product_route=messenger)
  const link = await page.waitForSelector('a[href*="product_route=messenger"]', { timeout: 45000 }).catch(() => null);
  if (link) {
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {}),
      link.click().catch(() => page.evaluate((el) => el.click(), link)),
    ]);
  }

  // Đảm bảo đang ở trang cấu hình Messenger (URL thật: messenger_api_settings)
  if (!/\/messenger/.test(page.url() || '')) {
    await page.goto(`https://developers.facebook.com/apps/${appId}/messenger/messenger_api_settings/`, { waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {});
  }

  setStatus(job, 'filling_webhook', 'Đang điền URL gọi lại & mã xác minh webhook…');
  const r = await pollAndFillWebhook(page, webhookUrl, verifyToken);
  if (!r.done) {
    await errorShot(page, 'sync-error.png');
    throw new Error('Không điền được webhook: ' + (r.reason || 'không rõ') + '. Hãy kiểm tra cửa sổ Chrome.');
  }

  // Nếu URL trùng giá trị cũ, nút "Xác minh và lưu" sẽ bị khóa — webhook đã lưu từ trước
  const canSave = await page
    .evaluate(() => {
      const btns = [...document.querySelectorAll('[role="button"], button')]
        .filter((b) => /^(xác minh và lưu|verify and save)$/i.test((b.innerText || '').trim()));
      const b = btns[btns.length - 1];
      return !!b && b.getAttribute('aria-disabled') !== 'true'
        && (b.offsetParent !== null || b.getClientRects().length > 0);
    })
    .catch(() => false);

  let saveNote = 'Webhook đã được lưu từ trước (URL trùng khớp) — không cần lưu lại. ';
  let errDialog = null;
  if (canSave) {
    setStatus(job, 'saving_webhook', 'Đang bấm "Xác minh và lưu"…');
    const saved = await clickWhenEnabled(page, SAVE_WEBHOOK_RE, 30000);
    if (!saved) {
      await errorShot(page, 'sync-error.png');
      throw new Error('Nút "Xác minh và lưu" không bật được — Facebook có thể yêu cầu URL https public. Hãy kiểm tra Chrome.');
    }

    // Facebook gọi webhook để xác minh — đợi kết quả / dialog lỗi
    await sleep(20000);
    errDialog = await page
      .evaluate(() => {
        const d = [...document.querySelectorAll('[role="dialog"]')].find((x) => x.offsetParent);
        const t = d ? d.innerText || '' : '';
        return /không thể|could not|unable to|failed|không xác minh/i.test(t) ? t.slice(0, 150) : null;
      })
      .catch(() => null);
    saveNote = errDialog
      ? `Facebook chưa xác minh được webhook (${errDialog.replace(/\n/g, ' ').slice(0, 120)}…) — kiểm tra URL public. `
      : 'Đã bấm "Xác minh và lưu" — Facebook xác minh thành công. ';
  }
  await page.screenshot({ path: path.join(DATA_DIR, 'sync-last.png') }).catch(() => {});

  /* ---- Giai đoạn 3: kết nối trang & đồng bộ danh sách fanpage ---- */
  setStatus(job, 'connecting_pages', 'Đang kết nối trang Facebook (mục "Tạo mã truy cập")…');
  // Mở rộng card "Tạo mã truy cập" nếu đang thu gọn (nút "Xem thêm")
  for (let i = 0; i < 5; i++) {
    const st = await expandCard(page, 'tạo mã truy cập|generate access token');
    if (st !== 'no-heading') break;
    await sleep(1500);
  }
  await connectPagesFlow(job, page);

  setStatus(job, 'syncing_pages', 'Đang đồng bộ danh sách trang về CRM…');
  const pages = await syncPageTable(job, page);
  const pageSummary = pages.map((p) => `${p.name} (${p.pageId})`).join(', ');

  const successMsg =
    saveNote +
    (pages.length
      ? `Đã đồng bộ ${pages.length} trang: ${pageSummary}. `
      : 'Không có trang nào được kết nối. ') +
    `Webhook: ${webhookUrl} • Mã xác minh ${verifyToken}.`;
  DEPS.recordRun('success', successMsg);
  return { pages, note: saveNote };
}

/* ---------- Giai đoạn 3a: bấm "Kết nối" và chạy hết popup OAuth ---------- */

const OAUTH_STEP_RES = [
  '^(?:tiếp tục|continue)$',
  '^(?:cho phép|allow|ok|đồng ý)$',
  '^(?:lưu|save)$',
  '^(?:xong|done|finish)$',
  '^(?:đã hiểu|got it)$',
];

async function connectPagesFlow(job, page) {
  // Bảng trang đã hiện → đã kết nối từ trước, bỏ qua OAuth
  const hasTable = await page
    .evaluate(() => !!document.querySelector('tbody tr[role="row"] span[label]'))
    .catch(() => false);
  if (hasTable) return;

  // Bấm "Kết nối" (mục 2. Tạo mã truy cập) — có thể cần cuộn xuống nên poll
  const deadline = Date.now() + 45000;
  let clicked = false;
  while (Date.now() < deadline && !clicked) {
    clicked = await clickMatching(page, '^(?:kết nối|connect)$', '[role="button"], button');
    if (!clicked) await sleep(1500);
  }
  if (!clicked) {
    await errorShot(page, 'sync-error.png');
    throw new Error('Không thấy nút "Kết nối" trong mục "Tạo mã truy cập". Hãy kiểm tra Chrome.');
  }

  // Chờ popup OAuth (thường mở cửa sổ mới; nếu điều hướng tại chỗ thì dùng chính trang đó)
  const popup = await waitOAuthPopup(job, page, 25000);
  const dlg = popup || page;
  await driveOAuthSteps(job, dlg);

  // Popup có thể hiện "Đã hiểu" trên trang chính sau khi đóng — bấm nếu còn
  await clickMatching(page, '^(?:đã hiểu|got it)$', '[role="button"], button');
  await sleep(2000);
}

async function waitOAuthPopup(job, mainPage, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const p = (job.popups || []).find(
      (x) => !x.isClosed() && /dialog\/oauth|facebook\.com\/v\d+\.\d+\/dialog|dialog\/oauth/.test(x.url() || ''),
    );
    if (p) return p;
    if (/dialog\/oauth/.test(mainPage.url() || '')) return null; // dialog mở ngay trên trang chính
    await sleep(800);
  }
  return null;
}

// Bấm lần lượt các nút xuất hiện trong dialog OAuth: Tiếp tục → Tiếp tục → Lưu → Đã hiểu
async function driveOAuthSteps(job, dlg) {
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    if (dlg.isClosed()) return; // popup tự đóng khi xong
    if (await passwordVisible(dlg)) {
      await askPassword(job, dlg);
      continue;
    }
    let clicked = false;
    for (const re of OAUTH_STEP_RES) {
      if (await clickMatching(dlg, re, '[role="button"], button')) { clicked = true; break; }
    }
    if (clicked) { await sleep(2500); continue; }
    await sleep(1500);
  }
}

/* ---------- Giai đoạn 3b: đọc bảng trang, bấm "Tạo" lấy token, lưu về CRM ---------- */

async function extractPageRows(page) {
  return page
    .evaluate(() => {
      const rows = [...document.querySelectorAll('tbody tr[role="row"]')];
      return rows.map((r) => {
        const idEl = r.querySelector('span[label]');
        const pageId = idEl ? idEl.getAttribute('label') : null;
        const firstCell = r.querySelector('td');
        let name = null;
        if (firstCell) {
          for (const d of firstCell.querySelectorAll('div')) {
            const t = (d.innerText || '').trim().split('\n')[0];
            if (t && !/^\d+$/.test(t)) { name = t; break; }
          }
        }
        const tokenMatch = (r.innerText || '').match(/EA[A-Za-z0-9_-]{30,}/);
        return { pageId, name, token: tokenMatch ? tokenMatch[0] : null };
      }).filter((p) => p.pageId);
    })
    .catch(() => []);
}

async function syncPageTable(job, page) {
  // Chờ bảng trang xuất hiện (card đã mở rộng từ trước)
  const deadline = Date.now() + 90000;
  const rows = [];
  let noPagesSeen = 0;
  let stable = 0; // số vòng liên tiếp không thêm trang mới — đủ 2 vòng mới kết luận
  while (Date.now() < deadline) {
    // Nếu bị văng khỏi trang settings (bấm nhầm link/điều hướng) → quay lại
    const onSettings = await page
      .evaluate(() => /messenger_api_settings|\/messenger\//.test(location.href) && !/developers\.facebook\.com\/apps\/?$/.test(location.href))
      .catch(() => false);
    if (!onSettings) {
      await page.goto(`https://developers.facebook.com/apps/${job.appId}/messenger/messenger_api_settings/`, { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
      await expandCard(page, 'tạo mã truy cập|generate access token');
      await sleep(2000);
    }

    // Gộp dần: bảng có thể render lười từng dòng — thấy 1 dòng mà dừng ngay
    // là mất các page còn lại (báo lỗi 2026-10-05: 2 page chỉ thấy 1).
    const found = await extractPageRows(page);
    let grown = false;
    for (const r of found) {
      const prev = rows.find((x) => x.pageId === r.pageId);
      if (prev) {
        if (!prev.token && r.token) prev.token = r.token;
        if (!prev.name && r.name) prev.name = r.name;
      } else { rows.push(r); grown = true; }
    }
    if (rows.length) {
      stable = grown ? 0 : stable + 1;
      if (stable >= 2) break;
      await expandCard(page, 'tạo mã truy cập|generate access token');
      await sleep(2500);
      continue;
    }

    // App chưa kết nối trang nào → nút "Kết nối / Connect" hiển thị
    // (thấy ổn định 2 lần liên tiếp = chắc chắn chưa có trang → báo ngay, không chờ phí)
    const hasConnect = await page
      .evaluate(() => {
        const vis = (el) => el.offsetParent !== null || el.getClientRects().length > 0;
        return [...document.querySelectorAll('[role="button"], button, a')]
          .some((b) => /^(?:kết nối|connect)$/i.test((b.innerText || '').trim()) && vis(b));
      })
      .catch(() => false);
    noPagesSeen = hasConnect ? noPagesSeen + 1 : 0;
    if (noPagesSeen >= 2) break;

    // có thể card lại thu gọn sau khi tải lại — mở lại nếu cần
    await expandCard(page, 'tạo mã truy cập|generate access token');
    await sleep(2500);
  }
  if (!rows.length) {
    await errorShot(page, 'sync-error.png');
    const msg = noPagesSeen >= 2
      ? 'App chưa kết nối trang Facebook nào. Hãy bấm nút "Connect" trong Chrome (mục 2. Generate access tokens) để kết nối các trang — xong chạy lại "Lấy token & Đăng ký".'
      : 'Không thấy danh sách trang sau khi kết nối. Hãy kiểm tra Chrome.';
    throw new Error(msg);
  }

  // Chỉ cào danh sách: pageId + tên trang (token sẽ làm ở bước sau)
  const clean = rows.map((r) => ({
    pageId: r.pageId,
    name: r.name || ('Trang ' + r.pageId),
    token: null,
    connectedAt: new Date().toISOString(),
  }));
  DEPS.upsertPages(job.uid, clean);
  return clean;
}

// Mở rộng card thu gọn: tìm heading → đi lên tìm [role=button][aria-controls]
// có aria-expanded=false (nút "Xem thêm") rồi bấm
async function expandCard(page, headingSource) {
  return page
    .evaluate((headingSource) => {
      const re = new RegExp(headingSource, 'i');
      const h = [...document.querySelectorAll('[role="heading"], h1, h2, h3')]
        .find((x) => re.test((x.innerText || '').trim()));
      if (!h) return 'no-heading';
      let node = h;
      for (let i = 0; i < 10 && node; i++) {
        node = node.parentElement;
        if (!node) break;
        const btn = [...node.querySelectorAll('[role="button"][aria-controls]')]
          .find((b) => b.getAttribute('aria-expanded') === 'false');
        if (btn) {
          btn.scrollIntoView({ block: 'center' });
          const o = { bubbles: true, cancelable: true, view: window };
          for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
            btn.dispatchEvent(new MouseEvent(t, o));
          }
          return 'expanded';
        }
      }
      return 'already-expanded';
    }, headingSource)
    .catch(() => 'error');
}

// Điền URL gọi lại + mã xác minh trong card "Đặt cấu hình webhook" (poll ngay trong trang)

/* ---------- Đăng ký app với ĐỐI TƯỢNG Page trên trang Webhooks ----------
 * Thiếu tầng này thì Meta KHÔNG BAO GIỜ đẩy event dù page đã "Add subscription"
 * (báo lỗi 2026-10-06: bridge chỉ nhận tin test, tin khách thật không về). */
// Đăng ký trường webhook NGAY TRONG messenger_api_settings: bấm See more/Xem thêm
// mở rộng mục Webhooks rồi click nút Đăng ký của từng trường (messages,
// messaging_postbacks, message_reads...). Đường chính thức thay cho việc
// điều hướng sang trang /webhooks/ (dễ lạc trang).
async function subscribeWebhookFieldsInCard(job, page) {
  const log = (m) => { try { DEPS.log('[fields-in-card] ' + m); } catch (_) {} };
  setStatus(job, 'subscribing_object', 'Đang mở rộng mục Webhooks (nút See more)…');
  for (let i = 0; i < 6; i++) {
    const st = await expandCard(page, 'đặt cấu hình webhook|configure webhooks');
    if (st !== 'no-heading') break;
    await sleep(1500);
  }
  await sleep(1500);
  // Tìm nút Đăng ký cho từng trưủng trong card (row nhỏ nhất chứa text field + nút Đăng ký)
  const targets = await page
    .evaluate((fields) => {
      const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
      const center = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; };
      const out = [];
      for (const f of fields) {
        const rows = [...document.querySelectorAll('tr, [role="row"], li, div')]
          .filter(vis)
          .filter((el) => (el.innerText || '').split('\n').some((l) => l.trim() === f));
        let pick = null;
        for (const row of rows) {
          const btn = [...row.querySelectorAll('[role="button"], button, a')].filter(vis)
            .find((b) => /^(?:đăng ký|subscribe)$/i.test((b.innerText || '').trim()));
          if (btn && (!pick || row.innerText.length < pick.row.innerText.length)) pick = { row, btn };
        }
        if (pick) out.push({ field: f, ...center(pick.btn) });
      }
      return out;
    }, PAGE_FIELDS.slice())
    .catch(() => []);
  log('nút Đăng ký tìm thấy: ' + (targets.map((t) => t.field).join(', ') || 'không có'));
  for (const t of targets) {
    await page.mouse.click(t.x, t.y).catch(() => {});
    await sleep(900);
  }
  // Xác minh: sau khi đăng ký, row chuyển sang nút “Hủy đăng ký”
  await sleep(1500);
  const done = await page
    .evaluate((fields) => {
      const vis = (el) => el && el.offsetParent !== null;
      const res = {};
      for (const f of fields) {
        const rows = [...document.querySelectorAll('tr, [role="row"], li, div')].filter(vis)
          .filter((el) => (el.innerText || '').split('\n').some((l) => l.trim() === f));
        const row = rows[rows.length - 1];
        if (!row) { res[f] = null; continue; }
        const unsub = [...row.querySelectorAll('[role="button"], button, a')].filter(vis)
          .find((b) => /^(?:hủy đăng ký|unsubscribe)$/i.test((b.innerText || '').trim()));
        res[f] = Boolean(unsub);
      }
      return res;
    }, PAGE_FIELDS.slice())
    .catch(() => ({}));
  log('trạng thái sau đăng ký: ' + JSON.stringify(done));
  const missing = PAGE_FIELDS.filter((f) => done[f] !== true);
  if (missing.length) {
    setStatus(job, 'subscribing_object', 'Chưa tự đăng ký được các trường: ' + missing.join(', ') + ' — có thể đăng ký tay trong Chrome mục Webhooks (nút Đăng ký của từng trưủng).');
  }
  return;
}
async function subscribeAppToPageObject(job, page) {
  const log = (m) => { try { DEPS.log('[webhooks] ' + m); } catch (_) {} };
  setStatus(job, 'subscribing_object', 'Đang đăng ký app với đối tượng Page (trang Webhooks)…');
  // Deep link ?view=page — vào THẲNG object Page (không có param là rơi object
  // khác → "vào sai trang", báo lỗi 2026-10-06).
  await page.goto('https://developers.facebook.com/apps/' + job.appId + '/webhooks/?view=page', { waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {});
  if (/log_in|login.php/.test(page.url() || '')) {
    throw new Error('Phiên Facebook đã hết hạn — hãy đăng nhập lại trong Chrome của account rồi chạy lại.');
  }
  await sleep(4000);

  // Trang hay tự mở dialog "Đặt cấu hình webhook" đè lên bảng trường → đóng nó
  // (bấm X trong dialog, nếu không được thì phím Escape)
  const closeConfigDialog = async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const st = await page
        .evaluate(() => {
          const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
          const headings = [...document.querySelectorAll('h1, h2, h3, span, div')].filter(vis)
            .find((h) => /^đặt cấu hình webhook$/i.test((h.innerText || '').trim()));
          if (!headings) return 'no-dialog';
          // nút đóng: [aria-label*=đóng/Close] hoặc nút X đầu tiên trong dialog
          let node = headings;
          for (let i = 0; i < 12 && node; i++) {
            const x = [...node.querySelectorAll('[role="button"], button')].filter(vis)
              .find((b) => /(?:đóng|close)/i.test(b.getAttribute('aria-label') || '') || (b.innerText || '').trim() === '✕');
            if (x) { const r = x.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; }
            node = node.parentElement;
          }
          return 'no-close-btn';
        })
        .catch(() => 'error');
      if (st === 'no-dialog') { log('dialog Đặt cấu hình webhook: không có/đã đóng'); return true; }
      if (st === 'no-close-btn' || st === 'error') {
        await page.keyboard.press('Escape').catch(() => {});
        await sleep(1200);
        continue;
      }
      await page.mouse.click(st.x, st.y).catch(() => {});
      log('đã đóng dialog Đặt cấu hình webhook');
      await sleep(1500);
    }
    // chốt: Escape lần cuối rồi đo lại
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(1000);
    const gone = await page.evaluate(() => ![...document.querySelectorAll('h1, h2, h3, span, div')]
      .some((h) => { const r = h.getBoundingClientRect(); return r.width > 1 && /^đặt cấu hình webhook$/i.test((h.innerText || '').trim()); })).catch(() => true);
    log('dialog Đặt cấu hình webhook sau khi đóng: ' + (gone ? 'đã tắt' : 'VẪN CÒN'));
    return gone;
  };
  await closeConfigDialog();

  const clickAt = async (pos, label) => {
    if (!pos) return false;
    await page.mouse.click(pos.x, pos.y).catch(() => {});
    log('click ' + label + ' tại ' + pos.x + ',' + pos.y);
    return true;
  };
  // Hỏi DOM: tọa độ phần tử object "Page" + trạng thái toggle + tọa độ nút toggle + số dòng trường hiển thị
  const scan = () => page
    .evaluate(() => {
      const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
      const center = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; };
      const out = { pageItem: null, unsubscribed: false, togglePos: null, fieldRows: [] };
      // 1) mục object "Page": nằm gần các object khác quen thuộc (User/Instagram/Permissions) để tránh trùng tên nơi khác
      const items = [...document.querySelectorAll('[role="menuitem"], [role="option"], [role="tab"], li, a, div')]
        .filter(vis)
        .filter((el) => /^(?:page|trang)$/i.test((el.innerText || '').trim()));
      const NAMES = /(?:user|instagram|permission|whatsapp|application|người dùng)/i;
      const item = items.find((el) => {
        let node = el.parentElement;
        for (let i = 0; i < 6 && node; i++) {
          if (NAMES.test(node.innerText || '')) return true;
          node = node.parentElement;
        }
        return false;
      }) || items[items.length - 1];
      if (item) out.pageItem = center(item);
      // 2) trạng thái đăng ký object: text "Đã hủy đăng ký"/"Đã đăng ký" + công tắc gần nó
      const body = document.body.innerText || '';
      const unsub = body.match(/đã hủy đăng ký|unsubscribed/i);
      const sub = body.match(/đã đăng ký|subscribed/i);
      out.unsubscribed = unsub ? true : (!sub && true);
      const sw = [...document.querySelectorAll('[role="switch"], [aria-checked]')]
        .filter(vis)
        .find((el) => {
          let node = el.parentElement;
          for (let i = 0; i < 5 && node; i++) {
            if (/đã (?:hủy )?đăng ký|subscribed/i.test(node.innerText || '')) return true;
            node = node.parentElement;
          }
          return false;
        });
      if (sw) out.togglePos = center(sw);
      // 3) dòng trường + nút "Đăng ký" chưa đăng ký
      for (const f of ['messages', 'messaging_postbacks', 'message_reads', 'message_deliveries', 'message_reactions']) {
        const cands = [...document.querySelectorAll('tr, [role="row"], li, div')]
          .filter(vis)
          .filter((el) => (el.innerText || '').split('\n').some((l) => l.trim() === f));
        const row = cands[cands.length - 1];
        if (!row) continue;
        const btn = [...row.querySelectorAll('[role="button"], button, a')]
          .filter(vis)
          .find((b) => /^(?:đăng ký|subscribe)$/i.test((b.innerText || '').trim()));
        if (btn) out.fieldRows.push({ field: f, ...center(btn) });
      }
      return out;
    })
    .catch(() => ({ pageItem: null, unsubscribed: false, togglePos: null, fieldRows: [] }));

  let s = await scan();
  log('scan: pageItem=' + Boolean(s.pageItem) + ' togglePos=' + Boolean(s.togglePos) + ' fieldRows=' + s.fieldRows.map((r) => r.field).join(','));
  if (!s.pageItem && !s.togglePos && !s.fieldRows.length) {
    setStatus(job, 'webhooks_manual',
      'Không nhận diện được trang Webhooks. Trong Chrome: app → Webhooks → chọn Page → bật đăng ký + đăng ký các trường messages, messaging_postbacks, message_reads — xong bấm "Xong" bên dưới.');
    await waitRegisterInput(job, 'webhooksDone', 600000, 'Không nhận được xác nhận đăng ký webhook trong 10 phút.');
    log('user xác nhận đã đăng ký tay');
    return;
  }
  // Chọn object Page nếu chưa thấy bảng trường
  if (!s.fieldRows.length && s.pageItem) {
    await clickAt(s.pageItem, 'object Page');
    await sleep(3500);
    s = await scan();
    log('scan sau khi chọn Page: togglePos=' + Boolean(s.togglePos) + ' fieldRows=' + s.fieldRows.length);
  }
  // Bật đăng ký object nếu đang hủy đăng ký
  if (!s.fieldRows.length && s.togglePos && s.unsubscribed) {
    await clickAt(s.togglePos, 'toggle đăng ký object');
    await sleep(4000);
    s = await scan();
  }
  // Đăng ký từng trường
  for (const r of s.fieldRows) {
    await clickAt(r, 'field ' + r.field);
    await sleep(900);
  }
  await page.screenshot({ path: path.join(DATA_DIR, 'webhooks-debug.png') }).catch(() => {});

  // Xác minh cuối: mọi trường phải chuyển "Hủy đăng ký" (nghĩa là đã đăng ký)
  const done = await page
    .evaluate(() => {
      const vis = (el) => el && el.offsetParent !== null;
      let ok = 0, missing = [];
      for (const f of ['messages', 'messaging_postbacks', 'message_reads', 'message_deliveries', 'message_reactions']) {
        const cands = [...document.querySelectorAll('tr, [role="row"], li, div')]
          .filter(vis)
          .filter((el) => (el.innerText || '').split('\n').some((l) => l.trim() === f));
        const row = cands[cands.length - 1];
        if (!row) { missing.push(f); continue; }
        const unsub = [...row.querySelectorAll('[role="button"], button, a')]
          .filter(vis)
          .find((b) => /^(?:hủy đăng ký|unsubscribe)$/i.test((b.innerText || '').trim()));
        if (unsub) ok++; else missing.push(f);
      }
      return { ok, missing };
    })
    .catch(() => ({ ok: 0, missing: ['all'] }));
  log('xác minh: ' + done.ok + '/5 trường đã đăng ký' + (done.missing.length ? ' — thiếu: ' + done.missing.join(',') : ''));
  if (done.ok < 3) {
    setStatus(job, 'webhooks_manual',
      'Chưa đăng ký đủ trường webhook (' + (done.missing.join(', ') || 'không rõ') + '). Hãy làm trong Chrome: app → Webhooks → Page → đăng ký các trường, xong bấm "Xong" bên dưới.');
    await waitRegisterInput(job, 'webhooksDone', 600000, 'Không nhận được xác nhận đăng ký webhook trong 10 phút.');
    log('user xác nhận đã đăng ký tay');
  }

  // QUAN TRỌNG: quay lại messenger_api_settings — các bước sau (cào bảng page,
  // lấy token) chạy trên trang này; thiếu bước quay lại là wizard đứng nhầm trang
  // (báo lỗi 2026-10-06: phải bấm điều hướng thủ công).
  setStatus(job, 'subscribing_object', 'Đã xong mục Webhooks — quay lại trang Cài đặt API Messenger…');
  await page.goto('https://developers.facebook.com/apps/' + job.appId + '/messenger/messenger_api_settings/', { waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {});
  await sleep(2500);
  return;
}

async function pollAndFillWebhook(page, cbUrl, vToken) {
  return page
    .evaluate((cbUrl, vToken) => {
      const visible = (el) => el && el.offsetParent !== null && !el.disabled;
      const setVal = (el, v) => {
        el.focus();
        const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        proto.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.blur();
      };
      const byLabel = (re) => {
        for (const lb of [...document.querySelectorAll('label')]) {
          const t = ((lb.innerText || lb.textContent) || '').trim().toLowerCase();
          if (re.test(t)) {
            const forId = lb.getAttribute('for');
            let el = forId ? document.getElementById(forId) : null;
            if (!el) el = lb.querySelector('input');
            if (visible(el)) return el;
          }
        }
        return null;
      };
      return new Promise((resolve) => {
        const deadline = Date.now() + 60000;
        const tick = () => {
          try {
            let urlEl = byLabel(/url gọi lại|callback url/i)
              || [...document.querySelectorAll('input[type="url"]')].find(visible);
            if (!urlEl) {
              // card đang thu gọn — bấm nút "Xem thêm" của card webhook
              const heads = [...document.querySelectorAll('[role="heading"], h1, h2, h3')];
              const h = heads.find((x) => /đặt cấu hình webhook|configure webhooks/i.test((x.innerText || '').trim()));
              if (h) {
                let node = h;
                for (let i = 0; i < 10 && node; i++) {
                  node = node.parentElement;
                  if (!node) break;
                  const btn = [...node.querySelectorAll('[role="button"][aria-controls]')]
                    .find((b) => b.getAttribute('aria-expanded') === 'false');
                  if (btn) { btn.click(); break; }
                }
              }
              if (Date.now() > deadline) return resolve({ done: false, reason: 'timeout — không thấy ô URL gọi lại' });
              return setTimeout(tick, 1500);
            }
            const original = urlEl.value;
            setVal(urlEl, cbUrl);

            let tokenEl = byLabel(/xác minh mã|verify token/i);
            if (!tokenEl) {
              tokenEl = [...document.querySelectorAll('input[type="text"]')].find((i) => visible(i) && i !== urlEl) || null;
            }
            if (tokenEl) setVal(tokenEl, vToken);
            // URL trùng giá trị cũ → nút Lưu sẽ bị khóa vì không có gì thay đổi
            return resolve({ done: true, tokenFilled: !!tokenEl, unchanged: original === cbUrl });
          } catch (e) {
            return resolve({ done: false, reason: String(e && e.message || e) });
          }
        };
        tick();
      });
    }, cbUrl, vToken)
    .catch((e) => ({ done: false, reason: String(e && e.message || e) }));
}

// Chờ nút (theo text) bật Enabled rồi bấm
async function clickWhenEnabled(page, source, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await page
      .evaluate((source) => {
        const re = new RegExp(source, 'i');
        const els = [...document.querySelectorAll('[role="button"], button')].filter((el) => {
          if (el.getAttribute('aria-disabled') === 'true') return false;
          const visible = el.offsetParent !== null || el.getClientRects().length > 0;
          if (!visible) return false;
          const t = (el.innerText || '').trim();
          return t && re.test(t);
        });
        if (!els.length) return false;
        const el = els[els.length - 1];
        el.scrollIntoView({ block: 'center' });
        const opts = { bubbles: true, cancelable: true, view: window };
        for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
          el.dispatchEvent(new MouseEvent(type, opts));
        }
        return true;
      }, source)
      .catch(() => false);
    if (ok) return true;
    await sleep(1200);
  }
  return false;
}

/* ---------- Xóa ứng dụng: vào Developers Facebook, menu ⋯ → Gỡ ứng dụng ---------- */

// Nạp cookie phiên đã lưu vào trang Chrome (dùng chung cho tạo app & xóa app)
async function injectSession(page, acc) {
  for (const c of acc.cookies) {
    await page.setCookie({
      name: c.name,
      value: c.value,
      domain: c.domain && c.domain.includes('facebook') ? c.domain : '.facebook.com',
      path: c.path || '/',
      ...(c.expires && c.expires > 0 ? { expires: c.expires } : {}),
      ...(typeof c.secure === 'boolean' ? { secure: c.secure } : {}),
      ...(typeof c.httpOnly === 'boolean' ? { httpOnly: c.httpOnly } : {}),
    }).catch(() => {});
  }
}

function startDeleteApp(appId, uid) {
  if (getActive()) return { error: 'Đã có tác vụ đang chạy. Hãy hủy hoặc chờ xong.' };

  const id = crypto.randomUUID();
  const job = {
    id,
    uid,
    kind: 'delete',
    status: 'opening_browser',
    message: 'Đang mở cửa sổ Chrome…',
    error: null,
    browser: null,
    page: null,
    waitPwd: null,
    appId: String(appId),
    createdAt: Date.now(),
  };
  jobs.set(id, job);
  activeId = id;
  runDelete(job, uid, String(appId)).catch((e) => failSoft(job, (e && e.message) || 'Lỗi không xác định'));
  return { job };
}

async function runDelete(job, uid, appId) {
  const browser = await launchAutomationChrome();
  job.browser = browser;
  browser.on('disconnected', () => {
    job.browser = null;
    if (job.waitPwd) { const w = job.waitPwd; job.waitPwd = null; w.reject(new Error('Cửa sổ Chrome đã bị đóng.')); }
    if (!['success', 'error'].includes(job.status)) failSoft(job, 'Cửa sổ Chrome đã bị đóng.');
  });

  const page = await browser.newPage();
  job.page = page;
  await page.setUserAgent(UA);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7' });

  await injectSession(page, { cookies: await ensureAccountCookies(job, uid) });

  // Vào trang DANH SÁCH ứng dụng — mỗi app có menu ⋯ riêng ở đó
  setStatus(job, 'loading_apps', 'Đang mở danh sách ứng dụng…');
  await page.goto('https://developers.facebook.com/apps/', { waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {});
  if (/log_in|login.php/.test(page.url() || '')) {
    throw new Error('Phiên Facebook đã hết hạn — hãy đăng nhập lại trong CRM.');
  }

  // Tìm đúng card chứa App ID rồi lấy menu ⋯ của app đó
  setStatus(job, 'finding_menu', `Đang tìm ứng dụng ${appId} và mở menu ⋯…`);
  const menuIdx = await findMenuIndexForApp(page, appId, 60000);
  if (menuIdx < 0) {
    // Không thấy app trong danh sách → coi như đã xóa, dọn dữ liệu trong CRM
    DEPS.appRemove(job.uid, appId);
    const latest = DEPS.appGetLatest(job.uid);
    DEPS.savePages(job.uid, latest ? (latest.pages || []) : []);
    DEPS.clearPageTokens(job.uid);
    DEPS.removeAccountPages(job.uid);
    setStatus(job, 'success', `Ứng dụng ${appId} không có trong danh sách (đã xóa trước đó) — đã dọn dữ liệu trong CRM.`);
    closeBrowser(job);
    return;
  }

  await clickMenuByIndex(page, menuIdx);
  await sleep(1300);
  const opened = await clickMatching(page, '^(?:gỡ ứng dụng|remove app)$', '[role="menuitem"], [role="button"]');
  if (!opened) {
    await page.keyboard.press('Escape').catch(() => {});
    await errorShot(page, 'sync-error.png');
    throw new Error('Không tìm thấy mục "Gỡ ứng dụng" trong menu. Hãy kiểm tra Chrome.');
  }

  // An toàn: CHỜ nút "Gỡ" (confirm) xuất hiện — poll 15s (dialog FB có thể không dùng role=dialog)
  const rec = DEPS.appList(job.uid).find((x) => x.appId === appId);
  const delName = rec ? rec.name : '';
  await sleep(1000);
  const confirmDeadline = Date.now() + 15000;
  let confirmed = false;
  while (Date.now() < confirmDeadline && !confirmed) {
    if (await passwordVisible(page)) { await askPassword(job, page); continue; }
    confirmed = await page
      .evaluate(() => {
        const vis = (el) => el.offsetParent !== null || el.getClientRects().length > 0;
        const btns = [...document.querySelectorAll('[role="button"], button')]
          .filter((b) => /^(?:gỡ|remove)$/i.test((b.innerText || '').trim()) && vis(b));
        if (!btns.length) return false;
        const b = btns[btns.length - 1];
        const o = { bubbles: true, cancelable: true, view: window };
        for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
          b.dispatchEvent(new MouseEvent(t, o));
        }
        return true;
      })
      .catch(() => false);
    if (!confirmed) await sleep(1000);
  }
  if (!confirmed) {
    await page.keyboard.press('Escape').catch(() => {});
    await errorShot(page, 'sync-error.png');
    throw new Error(`Không thấy nút "Gỡ" trong hộp xác nhận cho "${delName || appId}" — đã hủy. Kiểm tra Chrome.`);
  }

  // Có thể hỏi mật khẩu — dùng mật khẩu đã lưu trong phiên hoặc hỏi user
  const deadline = Date.now() + 150000;
  while (Date.now() < deadline) {
    if (!job.browser) throw new Error('Cửa sổ Chrome đã bị đóng.');
    if (await passwordVisible(page)) { await askPassword(job, page); continue; }
    // Bấm Đã hiểu nếu FB hiện thông báo
    await clickMatching(page, '^(?:đã hiểu|got it|ok)$', '[role="button"], button');
    // App biến mất khỏi danh sách = xóa xong
    const gone = await page
      .evaluate((id) => !(document.body.innerText || '').replace(/\s/g, '').includes(id), appId)
      .catch(() => false);
    if (gone) {
      DEPS.appRemove(job.uid, appId);
      const latest = DEPS.appGetLatest(job.uid);
      DEPS.savePages(job.uid, latest ? (latest.pages || []) : []);
    DEPS.clearPageTokens(job.uid);
    DEPS.removeAccountPages(job.uid);
      await page.screenshot({ path: path.join(DATA_DIR, 'delete-last.png') }).catch(() => {});
      setStatus(job, 'success', `Đã gỡ ứng dụng ${appId} khỏi Facebook và xóa dữ liệu trong CRM.`);
      closeBrowser(job);
      return;
    }
    await sleep(1500);
  }
  await errorShot(page, 'sync-error.png');
  throw new Error('Đã gỡ nhưng 2,5 phút không thấy app biến mất khỏi danh sách. Hãy kiểm tra thủ công.');
}

// Tìm index của nút menu ⋯ thuộc đúng card chứa App ID:
// từ phần tử nhỏ nhất chứa text App ID, đi lên tới container đầu tiên có nút menu
// trong subtree — đó chính là card của app (chứa cả ID lẫn menu của nó)
async function findMenuIndexForApp(page, appId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const idx = await page
      .evaluate((appId) => {
        const all = [...document.querySelectorAll('[role="button"][aria-haspopup="menu"]')]
          .filter((b) => b.offsetParent !== null || b.getClientRects().length > 0);
        if (!all.length) return -1;
        // phần tử nhỏ nhất (sâu nhất) chứa đúng text App ID
        const els = [...document.querySelectorAll('div, span, td, a')]
          .filter((el) => (el.textContent || '').replace(/\s/g, '').includes(appId))
          .sort((a, b) => (a.textContent || '').length - (b.textContent || '').length);
        if (!els.length) return -1;
        // đi lên: container đầu tiên có nút menu trong subtree = card của app này
        let node = els[0];
        for (let k = 0; k < 15 && node; k++) {
          node = node.parentElement;
          if (!node) break;
          const menus = [...node.querySelectorAll('[role="button"][aria-haspopup="menu"]')]
            .filter((b) => b.offsetParent !== null || b.getClientRects().length > 0);
          if (menus.length) return all.indexOf(menus[0]);
        }
        return -1;
      }, appId)
      .catch(() => -1);
    if (idx >= 0) return idx;
    await sleep(2000);
  }
  return -1;
}

async function clickMenuByIndex(page, idx) {
  return page
    .evaluate((idx) => {
      const btns = [...document.querySelectorAll('[role="button"][aria-haspopup="menu"]')]
        .filter((b) => b.offsetParent !== null || b.getClientRects().length > 0);
      const b = btns[idx];
      if (!b) return false;
      b.scrollIntoView({ block: 'center' });
      const o = { bubbles: true, cancelable: true, view: window };
      for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
        b.dispatchEvent(new MouseEvent(t, o));
      }
      return true;
    }, idx)
    .catch(() => false);
}


/* ---------- Cấu hình trang: đăng ký field webhook + tạo Page Access Token ---------- */

const PAGE_FIELDS = ['message_reads', 'messages', 'messaging_postbacks'];

function startPageSetup(appId, pageIds, uid, webhookUrl) {
  if (getActive()) return { error: 'Đã có tác vụ đang chạy. Hãy hủy hoặc chờ xong.' };

  const id = crypto.randomUUID();
  const job = {
    id,
    uid,
    kind: 'pages',
    status: 'opening_browser',
    message: 'Đang mở cửa sổ Chrome…',
    error: null,
    browser: null,
    page: null,
    waitPwd: null,
    appId: String(appId),
    pageIds: pageIds.map(String),
    webhookUrl: webhookUrl || null,
    createdAt: Date.now(),
  };
  jobs.set(id, job);
  activeId = id;
  runPageSetup(job, uid).catch((e) => failSoft(job, (e && e.message) || 'Lỗi không xác định'));
  return { job };
}

// Tab worker song song cho Lấy token: mở lại trang cấu hình app với cùng phiên
// (cookie đã lấy sẵn) và mở rộng card "Tạo mã truy cập" chờ xử lý page riêng.
async function openPageSetupWorkerTab(job, browser, cookies) {
  const wp = await browser.newPage();
  await wp.setUserAgent(UA);
  await wp.setExtraHTTPHeaders({ 'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7' });
  await injectSession(wp, { cookies });
  await wp.goto(`https://developers.facebook.com/apps/${job.appId}/messenger/messenger_api_settings/`, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
  if (/log_in|login\.php/.test(wp.url() || '')) {
    throw new Error('Phiên Facebook đã hết hạn — hãy đăng nhập lại trong CRM.');
  }
  await sleep(2500);
  for (let i = 0; i < 5; i++) {
    const st = await expandCard(wp, 'tạo mã truy cập|generate access token');
    if (st !== 'no-heading') break;
    await sleep(1500);
  }
  return wp;
}

// Bảng token có thể render chậm trên tab vừa mở — chờ hàng của page xuất hiện
// (mở rộng card lại mỗi vòng) trước khi bấm Add subscription / Tạo.
async function waitPageSetupRow(tab, pageId, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const has = await tab
      .evaluate((pid) => {
        const rows = [...document.querySelectorAll('tbody tr[role="row"]')];
        return rows.some((r) => {
          const s = r.querySelector('span[label]');
          return s && s.getAttribute('label') === pid;
        });
      }, String(pageId))
      .catch(() => false);
    if (has) return true;
    await expandCard(tab, 'tạo mã truy cập|generate access token').catch(() => {});
    await sleep(1500);
  }
  return false;
}

async function runPageSetup(job, uid) {
  const browser = await launchAutomationChrome();
  job.browser = browser;
  browser.on('disconnected', () => {
    job.browser = null;
    if (job.waitPwd) { const w = job.waitPwd; job.waitPwd = null; w.reject(new Error('Cửa sổ Chrome đã bị đóng.')); }
    if (!['success', 'error'].includes(job.status)) failSoft(job, 'Cửa sổ Chrome đã bị đóng.');
  });

  const page = await browser.newPage();
  job.page = page;
  await page.setUserAgent(UA);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7' });

  const sessionCookies = await ensureAccountCookies(job, uid);
  await injectSession(page, { cookies: sessionCookies });

  setStatus(job, 'loading_apps', 'Đang mở cấu hình Messenger…');
  await page.goto(`https://developers.facebook.com/apps/${job.appId}/messenger/messenger_api_settings/`, { waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {});
  if (/log_in|login\.php/.test(page.url() || '')) {
    throw new Error('Phiên Facebook đã hết hạn — hãy đăng nhập lại trong CRM.');
  }

  // Cập nhật webhook (URL có thể đã đổi — vd tunnel mới)
  const webhookUrl = job.webhookUrl || 'http://localhost:3000/webhook';
  const verifyToken = DEPS.getOrCreateVerifyToken();
  setStatus(job, 'filling_webhook', 'Đang cập nhật URL gọi lại & mã xác minh webhook…');
  await expandCard(page, 'đặt cấu hình webhook|configure webhooks');
  const wr = await pollAndFillWebhook(page, webhookUrl, verifyToken);
  if (wr.done && !wr.unchanged) {
    setStatus(job, 'saving_webhook', 'Đang bấm "Xác minh và lưu"…');
    await clickWhenEnabled(page, '^(?:xác minh và lưu|verify and save)$', 30000);
    await sleep(8000);
  }

  // Đăng ký TRƯỜNG webhook ngay trong mục Webhooks của messenger_api_settings
  // (bấm nút See more/Xem thêm mở rộng card — hướng dẫn của user 2026-10-06:
  //  KHÔNG đi vòng qua trang /webhooks/ nữa, nút Đăng ký nằm ngay tại đây)
  await subscribeWebhookFieldsInCard(job, page);
  // Đăng ký ĐỐI TƯỢNG Page trên trang Webhooks (tầng bắt buộc để Meta đẩy event tức thì)
  await subscribeAppToPageObject(job, page);

  // Mở rộng card "Tạo mã truy cập" nếu đang thu gọn
  for (let i = 0; i < 5; i++) {
    const st = await expandCard(page, 'tạo mã truy cập|generate access token');
    if (st !== 'no-heading') break;
    await sleep(1500);
  }

  // CÀO DANH SÁCH TRANG trong bảng (cập nhật pages.json — kể cả khi CRM đang rỗng)
  // Gộp dần + chờ ổn định 2 vòng để không bỏ sót page render chậm.
  const tableDeadline = Date.now() + 30000;
  const tableRows = [];
  let tableStable = 0;
  while (Date.now() < tableDeadline) {
    const found = await extractPageRows(page);
    let grown = false;
    for (const r of found) {
      const prev = tableRows.find((x) => x.pageId === r.pageId);
      if (prev) {
        if (!prev.token && r.token) prev.token = r.token;
        if (!prev.name && r.name) prev.name = r.name;
      } else { tableRows.push(r); grown = true; }
    }
    if (tableRows.length) {
      tableStable = grown ? 0 : tableStable + 1;
      if (tableStable >= 2) break;
    }
    await expandCard(page, 'tạo mã truy cập|generate access token');
    await sleep(2000);
  }
  if (tableRows.length) {
    const clean = tableRows.map((r) => ({
      pageId: r.pageId,
      name: r.name || 'Trang ' + r.pageId,
      token: null,
      connectedAt: new Date().toISOString(),
    }));
    DEPS.upsertPages(job.uid, clean);
    const latest = DEPS.appGetLatest(job.uid);
    if (latest && latest.appId === job.appId) DEPS.appUpdate(job.uid, job.appId, { pages: clean });
  }

  // Trang cần xử lý: được tích chọn — hoặc TẤT CẢ trang tìm thấy (khi CRM chưa có data)
  const targets = job.pageIds.length ? job.pageIds : tableRows.map((r) => r.pageId);
  if (!targets.length) {
    await errorShot(page, 'sync-error.png');
    throw new Error('App chưa kết nối trang Facebook nào. Hãy bấm "Connect" trong Chrome (mục 2. Generate access tokens) để kết nối trang, rồi chạy lại.');
  }

  const results = [];
  // Xử lý song song bằng nhiều tab Chrome trên cùng 1 cửa sổ: mỗi tab mở lại
  // trang cấu hình app, nhận pageId từ hàng đợi chung rồi tự đăng ký webhook +
  // tạo token cho page của nó. Dialog subscribe/token là DOM riêng từng tab nên
  // các tab không giành nhau; form re-auth dùng chung job.waitPwd qua lock
  // trong askPassword. 3 tab là mức an toàn cho Facebook (nhiều hơn dễ dính
  // checkpoint) và đủ nhẹ cho máy khách.
  const PAGE_SETUP_PARALLEL_TABS = 3;
  const workerCount = Math.max(1, Math.min(PAGE_SETUP_PARALLEL_TABS, targets.length));
  let cursor = 0;
  let doneCount = 0;

  const worker = async (tab) => {
    while (job.browser && !['success', 'error'].includes(job.status)) {
      const idx = cursor;
      cursor += 1;
      if (idx >= targets.length) break;
      const pageId = targets[idx];
      try {
        if (!await waitPageSetupRow(tab, pageId)) {
          try { DEPS.log('[pages] Không thấy hàng của trang ' + pageId + ' trong bảng token — bỏ qua.'); } catch (_) {}
          results.push({ pageId, token: null });
          doneCount += 1;
          continue;
        }
        setStatus(job, 'subscribing', `Đang đăng ký webhook cho trang ${pageId} (${doneCount + 1}/${targets.length}, ${workerCount} luồng)…`);
        await subscribePageFields(job, tab, pageId);

        setStatus(job, 'generating_token', `Đang tạo Page Access Token cho trang ${pageId} (${doneCount + 1}/${targets.length}, ${workerCount} luồng)…`);
        const token = await generatePageToken(job, tab, pageId);
        results.push({ pageId, token: token || null });
        doneCount += 1;
        setStatus(job, 'generating_token', `Xong ${doneCount}/${targets.length} trang…`);
      } catch (e) {
        if (!job.browser) throw e; // Chrome bị đóng — dừng toàn bộ worker
        try { DEPS.log('[pages] Lỗi xử lý trang ' + pageId + ': ' + ((e && e.message) || e)); } catch (_) {}
        results.push({ pageId, token: null });
        doneCount += 1;
      }
    }
  };

  const tabs = [page];
  for (let i = 1; i < workerCount; i++) {
    try { tabs.push(await openPageSetupWorkerTab(job, browser, sessionCookies)); } catch (e) {
      if (!job.browser) throw e;
      try { DEPS.log('[pages] Không mở được tab song song #' + (i + 1) + ': ' + ((e && e.message) || e)); } catch (_) {}
      break;
    }
  }
  await Promise.all(tabs.map((t) => worker(t)));

  // Cập nhật token vào pages.json + bản ghi app mới nhất
  const allPages = DEPS.listPages(job.uid);
  for (const r of results) {
    if (!r.token) continue;
    const p = allPages.find((x) => x.pageId === r.pageId);
    if (p) p.token = r.token;
    else allPages.push({ pageId: r.pageId, name: 'Trang ' + r.pageId, token: r.token, connectedAt: new Date().toISOString() });
  }
  DEPS.savePages(job.uid, allPages);
  const latest = DEPS.appGetLatest(job.uid);
  if (latest && latest.appId === job.appId) {
    DEPS.appUpdate(job.uid, job.appId, { pages: allPages });
  }

  // Đăng ký webhook qua Graph ngay với token vừa lấy — nếu bước DOM
  // (subscribeAppToPageObject) fail âm thầm thì bước này cứu, và kết quả
  // được BÁO RÕ cho user thay vì im lặng (báo lỗi 2026-10-06).
  // Chạy 5 luồng cùng lúc — mỗi page là 1 POST Graph độc lập.
  const subResults = [];
  const tokenResults = results.filter((r) => r.token);
  let subCursor = 0;
  setStatus(job, 'subscribing', `Đang đăng ký webhook qua Graph cho ${tokenResults.length} trang…`);
  await Promise.all(Array.from({ length: Math.min(5, Math.max(1, tokenResults.length)) }, async () => {
    while (subCursor < tokenResults.length && job.browser) {
      const r = tokenResults[subCursor];
      subCursor += 1;
      const sub = await graphSubscribePage(r.pageId, r.token);
      subResults.push({ pageId: r.pageId, ...sub });
      try { DEPS.log(`[subscribe] Graph ${r.pageId}: ${sub.ok ? 'OK' : 'FAIL - ' + sub.reason}`); } catch (_) {}
    }
  }));

  const okCount = results.filter((r) => r.token).length;
  const summary = results.map((r) => {
    const p = allPages.find((x) => x.pageId === r.pageId);
    const nm = p ? p.name : r.pageId;
    return `${nm}${r.token ? ' ✓' : ' (không lấy được token)'}`;
  }).join(', ');
  let successMsg = `Đã cấu hình ${targets.length} trang — lấy được token cho ${okCount}/${targets.length}: ${summary}.`;
  const subFail = subResults.filter((s) => !s.ok);
  if (subFail.length) {
    successMsg += ` ⚠️ KHÔNG đăng ký được webhook qua Graph cho: ${subFail.map((s) => `${s.pageId} (${s.reason})`).join('; ')}. `
      + 'Token thiếu quyền pages_manage_metadata — Meta sẽ không đẩy tin khách realtime. '
      + 'Tin vẫn về qua watcher 10s; nếu cần realtime, chạy lại và đảm bảo tick quyền pages_manage_metadata khi dialog token hiện ra.';
  } else if (subResults.length) {
    successMsg += ' Webhook Graph đã đăng ký cho tất cả page có token ✓';
  }
  setStatus(job, 'success', successMsg);
  DEPS.recordRun('success', successMsg);
  closeBrowser(job);
}

// Trong hàng của trang: bấm "Thêm đăng ký" → tick 3 field → Confirm
async function subscribePageFields(job, page, pageId) {
  const log = (m) => { try { DEPS.log('[subscribe] ' + m); } catch (_) {} };
  const clicked = await page
    .evaluate((pageId) => {
      const visible = (el) => el && el.offsetParent !== null;
      const rows = [...document.querySelectorAll('tbody tr[role="row"]')];
      const row = rows.find((r) => {
        const s = r.querySelector('span[label]');
        return s && s.getAttribute('label') === pageId;
      });
      if (!row) return 'no-row';
      const btn = [...row.querySelectorAll('[role="button"], button')]
        .find((b) => /(?:thêm đăng ký|add subscription|đăng ký|subscribe)/i.test((b.innerText || '').trim())
          && !/(?:đã đăng ký|subscribed$)/i.test((b.innerText || '').trim()));
      if (!btn) return 'no-button'; // đã đăng ký hết hoặc nút không còn
      btn.scrollIntoView({ block: 'center' });
      const o = { bubbles: true, cancelable: true, view: window };
      for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
        btn.dispatchEvent(new MouseEvent(t, o));
      }
      return 'clicked';
    }, pageId)
    .catch(() => 'error');
  log('nút Add subscription: ' + clicked + ' (page ' + pageId + ')');
  if (clicked !== 'clicked') return; // không có nút → có thể đã đăng ký, bỏ qua

  await sleep(2500);

  // Tick theo DOM thật của dialog "Edit Page Subscriptions": checkbox là
  // div[role=checkbox] (aria-checked), KHÔNG phải <input> — và text của hàng
  // là tên field kỹ thuật (messages, message_reads...). Quét mọi checkbox,
  // khớp CHÍNH XÁC text hàng rồi click đúng phần tử checkbox.
  // Tick bằng CLICK CHUỘT THẬT qua CDP (page.mouse.click theo tọa độ) —
  // dispatch MouseEvent bị React của dialog mới bỏ qua komplett (báo lỗi
  // 2026-10-06: không tick, không Confirm). Trusted click thì không chối được.
  const layout = await page
    .evaluate((fields) => {
      const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
      const center = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; };
      // Container dialog: đi lên từ nút Confirm tới tổ tiên chứa >= 10 checkbox
      // (không phụ thuộc role=dialog — dialog mới của FB có khi không có role).
      let scope = null;
      const btns = [...document.querySelectorAll('[role="button"], button')].filter(vis);
      const confirmBtn = btns.find((b) => /^(?:confirm|xác nhận)$/i.test((b.innerText || '').trim()));
      if (confirmBtn) {
        let node = confirmBtn;
        for (let i = 0; i < 14 && node; i++) {
          if (node.querySelectorAll('[role="checkbox"], input[type="checkbox"]').length >= 10) { scope = node; break; }
          node = node.parentElement;
        }
      }
      if (!scope) scope = [...document.querySelectorAll('[role="dialog"]')].find(vis) || document;
      const boxes = [...scope.querySelectorAll('[role="checkbox"], input[type="checkbox"]')].filter(vis);
      const rowTextOf = (b) => {
        const lab = b.closest('label');
        if (lab && (lab.innerText || '').trim()) return (lab.innerText || '').trim();
        for (const up of [b.parentElement, b.parentElement?.parentElement, b.parentElement?.parentElement?.parentElement]) {
          if (!up) continue;
          const t = (up.innerText || '').trim().split('\n')[0].trim();
          if (t) return t;
        }
        return '';
      };
      const isOn = (b) => (b.tagName === 'INPUT') ? b.checked : b.getAttribute('aria-checked') === 'true';
      const targets = [];
      for (const f of fields) {
        const b = boxes.find((x) => rowTextOf(x) === f);
        if (b) targets.push({ field: f, ...center(b), on: isOn(b) });
      }
      return { targets, confirm: confirmBtn ? center(confirmBtn) : null, boxCount: boxes.length };
    }, PAGE_FIELDS.slice())
    .catch(() => ({ targets: [], confirm: null, boxCount: 0 }));
  log('layout dialog: boxCount=' + layout.boxCount + ', targets=' + layout.targets.map((t) => t.field + (t.on ? '(on)' : '')).join(', ') + ', coConfirm=' + Boolean(layout.confirm));

  for (const t of layout.targets.filter((x) => !x.on)) {
    await page.mouse.click(t.x, t.y).catch(() => {});
    await sleep(500);
  }

  // Xác minh trạng thái THẬT sau khi click
  await sleep(1200);
  const verified = await page
    .evaluate((fields) => {
      const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
      const dlg = [...document.querySelectorAll('[role="dialog"]')].find(vis);
      const scope = dlg || document;
      const boxes = [...scope.querySelectorAll('[role="checkbox"], input[type="checkbox"]')].filter(vis);
      const rowTextOf = (b) => {
        const lab = b.closest('label');
        if (lab && (lab.innerText || '').trim()) return (lab.innerText || '').trim();
        for (const up of [b.parentElement, b.parentElement?.parentElement, b.parentElement?.parentElement?.parentElement]) {
          if (!up) continue;
          const t = (up.innerText || '').trim().split('\n')[0].trim();
          if (t) return t;
        }
        return '';
      };
      const isOn = (b) => (b.tagName === 'INPUT') ? b.checked : b.getAttribute('aria-checked') === 'true';
      const result = {};
      for (const f of fields) {
        const box = boxes.find((b) => rowTextOf(b) === f);
        if (box) result[f] = isOn(box);
      }
      return result;
    }, PAGE_FIELDS.slice())
    .catch(() => ({}));
  log('trạng thái sau tick: ' + JSON.stringify(verified));

  // Còn trường chưa bật thật sự → nhờ user tick tay trong Chrome rồi bấm Xong trong CRM
  const missingFields = PAGE_FIELDS.filter((f) => verified[f] === false);
  if (missingFields.length) {
    setStatus(job, 'subscribe_manual',
      'Không tự tick được các trường: ' + missingFields.join(', ') + '. Hãy tick trong Chrome rồi bấm "Xong" bên dưới.');
    await waitRegisterInput(job, 'subscribeDone', 600000, 'Không nhận được xác nhận tick webhook trong 10 phút.');
    log('user xác nhận đã tick tay cho: ' + missingFields.join(', '));
  }

  // Bấm Confirm bằng chuột thật (tọa độ mới nhất — dialog có thể render lại)
  const confirmPos = await page
    .evaluate(() => {
      const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
      const btn = [...document.querySelectorAll('[role="button"], button')].filter(vis)
        .find((b) => /^(?:confirm|xác nhận)$/i.test((b.innerText || '').trim()));
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    })
    .catch(() => null);
  if (confirmPos) {
    await page.mouse.click(confirmPos.x, confirmPos.y).catch(() => {});
    log('đã click Confirm tại ' + confirmPos.x + ',' + confirmPos.y);
  } else {
    await clickWhenEnabled(page, CONFIRM_SUBSCRIBE_RE, 20000);
  }
  await sleep(2500);
  await page.screenshot({ path: path.join(DATA_DIR, `subscribe-debug-${pageId}.png`) }).catch(() => {});
  // Đóng dialog nếu còn
  await clickMatching(page, '^(?:đóng|close|x)$', '[role="button"], button');
  await sleep(1000);
}

// Bấm "Tạo" → tick "Tôi hiểu" → bấm "Sao chép" → chụp token (hook clipboard + DOM)
const TOKEN_LIKE = /^[A-Za-z0-9_-]{40,}$/;

// Dialog "Generate Access Token" mới của FB liệt kê quyền bằng checkbox React
// (div[role=checkbox]). KHÔNG tick pages_manage_metadata thì token sinh ra thiếu
// quyền đó → POST /{pageId}/subscribed_apps chết (#200) → Meta không đẩy tin
// khách về webhook (báo lỗi 2026-10-06: page có token mà khách nhắn không về CRM).
// Tick bằng chuột thật theo tọa độ — React dialog bỏ qua dispatchEvent.
const TOKEN_REQUIRED_PERMISSIONS = ['pages_manage_metadata'];
async function tickTokenPermissions(page) {
  const layout = await page
    .evaluate((permissions) => {
      const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
      const dlg = [...document.querySelectorAll('[role="dialog"]')].find(vis);
      const scope = dlg || document;
      const boxes = [...scope.querySelectorAll('[role="checkbox"], input[type="checkbox"]')].filter(vis);
      const rowTextOf = (b) => {
        const lab = b.closest('label');
        if (lab && (lab.innerText || '').trim()) return (lab.innerText || '').trim();
        for (const up of [b.parentElement, b.parentElement?.parentElement, b.parentElement?.parentElement?.parentElement]) {
          if (!up) continue;
          const t = (up.innerText || '').trim().split('\n')[0].trim();
          if (t) return t;
        }
        return '';
      };
      const isOn = (b) => (b.tagName === 'INPUT') ? b.checked : b.getAttribute('aria-checked') === 'true';
      const targets = [];
      for (const f of permissions) {
        const b = boxes.find((x) => /pages_manage_metadata/i.test(rowTextOf(x)));
        if (b) {
          const r = b.getBoundingClientRect();
          targets.push({ field: f, x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), on: isOn(b) });
        }
      }
      return targets;
    }, TOKEN_REQUIRED_PERMISSIONS.slice())
    .catch(() => []);
  for (const t of layout.filter((x) => !x.on)) {
    await page.mouse.click(t.x, t.y).catch(() => {});
    await sleep(400);
  }
  return layout;
}

// Đăng ký page vào app qua Graph (cùng việc subscribePage của PageApiService
// làm) — bảo hiểm cho bước DOM subscribeAppToPageObject có thể fail âm thầm.
async function graphSubscribePage(pageId, token) {
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${pageId}/subscribed_apps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscribed_fields: 'messages,messaging_postbacks,message_reads,message_deliveries,message_reactions,messaging_referrals',
        access_token: token,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.error) return { ok: false, reason: (data.error.error_data?.message || data.error.message || 'Graph lỗi không rõ') };
    return { ok: true, reason: '' };
  } catch (e) {
    return { ok: false, reason: (e && e.message) || 'fetch lỗi' };
  }
}

async function generatePageToken(job, page, pageId) {
  const clicked = await page
    .evaluate((pageId) => {
      const rows = [...document.querySelectorAll('tbody tr[role="row"]')];
      const row = rows.find((r) => {
        const s = r.querySelector('span[label]');
        return s && s.getAttribute('label') === pageId;
      });
      if (!row) return false;
      const btn = [...row.querySelectorAll('[role="button"], button')]
        .find((b) => /^(tạo|generate|create)$/i.test((b.innerText || '').trim()));
      if (!btn) return false;
      btn.scrollIntoView({ block: 'center' });
      const o = { bubbles: true, cancelable: true, view: window };
      for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
        btn.dispatchEvent(new MouseEvent(t, o));
      }
      return true;
    }, pageId)
    .catch(() => false);
  if (!clicked) return null;
  await sleep(2500);

  // Tick quyền pages_manage_metadata rồi bấm "Generate Token" trong dialog
  // (nếu có) — trước khi chụp token. Thiếu quyền này thì đăng ký webhook
  // qua Graph chết và Meta không đẩy tin khách về CRM.
  await tickTokenPermissions(page);
  const genBtn = await page
    .evaluate(() => {
      const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
      const btn = [...document.querySelectorAll('[role="button"], button')].filter(vis)
        .find((b) => /^(?:generate token|generate access token|tạo mã truy cập|tạo mã)$/i.test((b.innerText || '').trim()));
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    })
    .catch(() => null);
  if (genBtn) {
    await page.mouse.click(genBtn.x, genBtn.y).catch(() => {});
    await sleep(2500);
  }

  // Cài bẫy: clipboard API + sự kiện copy — bắt MỌI text được copy (trim sẵn)
  await page
    .evaluate(() => {
      window.__capturedToken = null;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText = async (t) => {
            window.__capturedToken = (t || '').trim();
          };
          if (navigator.clipboard.write) {
            navigator.clipboard.write = async (data) => {
              try {
                const blob = data && data[0];
                if (blob) window.__capturedToken = (await blob.text()).trim();
              } catch { /* bỏ qua */ }
            };
          }
        }
      } catch { /* bỏ qua */ }
      document.addEventListener('copy', (e) => {
        try {
          const t = e.clipboardData ? e.clipboardData.getData('text') : '';
          if (t && t.trim().length > 20) window.__capturedToken = t.trim();
        } catch { /* bỏ qua */ }
      });
    })
    .catch(() => {});

  // Tick "Tôi hiểu" nếu dialog yêu cầu
  await page
    .evaluate(() => {
      const visible = (el) => el && el.offsetParent !== null;
      const labels = [...document.querySelectorAll('label')]
        .filter((l) => /^(?:tôi hiểu|i understand)$/i.test((l.innerText || '').trim()) && visible(l));
      for (const lb of labels) {
        const input = lb.querySelector('input[type="checkbox"]')
          || document.getElementById(lb.getAttribute('for') || '');
        if (input && visible(input) && input.getAttribute('aria-checked') !== 'true' && !input.checked) {
          input.click();
          return true;
        }
      }
      return false;
    })
    .catch(() => {});
  await sleep(1000);

  // Bấm "Sao chép" (thử 2 lần)
  await clickMatching(page, '^(?:sao chép|copy)$', '[role="button"], button');
  await sleep(1200);
  await clickMatching(page, '^(?:sao chép|copy)$', '[role="button"], button');
  await sleep(1000);

  // Đọc token: bẫy clipboard → quét input/textarea TOÀN TRANG (có thể nhiều dialog chồng nhau)
  let token = await page.evaluate(() => window.__capturedToken || null).catch(() => null);
  const valid = (t) => !!t && TOKEN_LIKE.test((t || '').trim());
  if (!valid(token)) {
    token = await page
      .evaluate(() => {
        // ưu tiên dialog trên cùng, rồi quét cả trang
        const dlgs = [...document.querySelectorAll('[role="dialog"]')].filter((x) => x.offsetParent);
        const scopes = dlgs.length ? [...dlgs.reverse(), document.body] : [document.body];
        for (const scope of scopes) {
          const inputs = [...scope.querySelectorAll('input, textarea')]
            .map((i) => (i.value || '').trim())
            .filter((v) => v.length > 40 && /^[A-Za-z0-9_-]+$/.test(v));
          if (inputs.length) return inputs[0];
          const m = (scope.innerText || '').match(/EA[A-Za-z0-9_-]{80,}/);
          if (m) return m[0];
        }
        return null;
      })
      .catch(() => null);
  }
  if (valid(token)) token = token.trim();

  // Chụp lại màn hình dialog token để đối chiếu nếu cần debug (tên theo page
  // vì các tab song song chụp cùng lúc, ghi đè nhau thì mất dấu vết)
  await page.screenshot({ path: path.join(DATA_DIR, `token-debug-${pageId}.png`) }).catch(() => {});

  // Đóng dialog
  await clickMatching(page, '^(?:đóng|close|đã hiểu|got it|ok|x|done|xong)$', '[role="button"], button');
  await sleep(800);
  return valid(token) ? token.trim() : null;
}

/* ---------- Đồng bộ PAGE: quét danh sách page của account ----------
 * Nguồn: bảng "Tạo mã truy cập" trong messenger_api_settings — bấm See more
 * mở bảng rồi cuộn xuống tới khi hết page. Page chưa có trong DB thì thêm mới;
 * page đã có nhưng chủ là account khác/mồ côi (xóa tk rồi login lại) thì gắn
 * lại về account đang chạy.
 */
function startPageSync(uid, appId = null) {
  if (getActive()) return { error: 'Đã có tác vụ đang chạy. Hãy hủy hoặc chờ xong.' };
  // User có thể chọn app cụ thể trong CRM (popup chọn app) — không chọn thì
  // dùng app mới nhất như trước.
  const requested = /^\d+$/.test(String(appId || '')) ? String(appId) : null;
  const latest = DEPS.appGetLatest(uid);
  const target = requested
    || (latest && /^\d+$/.test(String(latest.appId || '')) ? String(latest.appId) : null);
  if (!target) return { error: 'Chưa có app nào. Hãy bấm "Tạo app & Webhook" hoặc "Đồng bộ app" trước.' };
  const id = crypto.randomUUID();
  const job = {
    id,
    uid,
    kind: 'sync-pages',
    appId: target,
    status: 'opening_browser',
    message: 'Đang mở cửa sổ Chrome…',
    error: null,
    browser: null,
    page: null,
    createdAt: Date.now(),
  };
  jobs.set(id, job);
  activeId = id;
  runPageSync(job, uid).catch((e) => failSoft(job, (e && e.message) || 'Lỗi không xác định'));
  return { job };
}

async function runPageSync(job, uid) {
  const browser = await launchAutomationChrome();
  job.browser = browser;
  browser.on('disconnected', () => {
    job.browser = null;
    if (!['success', 'error'].includes(job.status)) failSoft(job, 'Cửa sổ Chrome đã bị đóng.');
  });
  const page = await browser.newPage();
  job.page = page;
  await page.setUserAgent(UA);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7' });
  await injectSession(page, { cookies: await ensureAccountCookies(job, uid) });

  // Vào messenger_api_settings của app — bảng "Tạo mã truy cập" liệt kê MỌI page
  setStatus(job, 'scanning', 'Đang mở Cài đặt API Messenger…');
  await page.goto('https://developers.facebook.com/apps/' + job.appId + '/messenger/messenger_api_settings/', { waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {});
  if (/log_in|login\.php/.test(page.url() || '')) {
    throw new Error('Phiên Facebook đã hết hạn — hãy đăng nhập lại trong Chrome của account rồi chạy lại.');
  }
  await sleep(3500);

  // Bấm nút "more"/"Xem thêm" mở rộng bảng page
  setStatus(job, 'scanning', 'Đang bấm nút mở rộng danh sách page (See more)…');
  for (let i = 0; i < 6; i++) {
    const st = await expandCard(page, 'tạo mã truy cập|generate access tokens');
    if (st !== 'no-heading') break;
    await sleep(1500);
  }
  await sleep(2000);

  // Cuộn + thu thập tới khi không còn page mới (3 vòng liền không thêm)
  const seen = new Map();
  let stable = 0;
  for (let round = 0; round < 120; round++) {
    const found = await extractPageRows(page);
    let added = 0;
    for (const r of found) {
      if (!r.pageId) continue;
      if (!seen.has(String(r.pageId))) { seen.set(String(r.pageId), r); added++; }
    }
    setStatus(job, 'scanning', 'Đang quét: đã thấy ' + seen.size + ' page' + (added ? ' (+' + added + ' mới)' : '') + ' — cuộn xuống tải thêm…');
    if (added === 0) {
      stable++;
      if (stable >= 3) break;
    } else stable = 0;
    // Cuộn trong container của bảng (nếu có overflow riêng) và cả cửa sổ
    await page.evaluate(() => {
      const tbody = document.querySelector('tbody[role="rowgroup"]');
      let el = tbody ? tbody.parentElement : null;
      let scrolled = false;
      while (el) {
        const st = getComputedStyle(el);
        if (/(auto|scroll)/.test(st.overflowY) && el.scrollHeight > el.clientHeight) {
          el.scrollTop = el.scrollHeight;
          scrolled = true;
          break;
        }
        el = el.parentElement;
      }
      if (!scrolled) window.scrollBy(0, 2500);
      else window.scrollBy(0, 600);
    }).catch(() => {});
    await sleep(1300);
  }

  const known = new Set(DEPS.knownPageIds());
  const all = [...seen.values()];
  const newOnes = all.filter((p) => !known.has(String(p.pageId)));
  if (newOnes.length) {
    DEPS.upsertPages(uid, newOnes.map((p) => ({ pageId: String(p.pageId), name: p.name || ('Page ' + p.pageId) })));
  }
  // Page đã known nhưng chủ là account khác/mồ côi (xóa tk rồi login lại là ca
  // chính) — gắn lại về account đang chạy Đồng bộ, không thì popup mãi trống.
  const reclaimed = DEPS.reclaimPages(
    uid,
    all.filter((p) => known.has(String(p.pageId))).map((p) => String(p.pageId))
  );
  const parts = [];
  if (newOnes.length) {
    parts.push('thêm ' + newOnes.length + ' page mới (' + newOnes.map((p) => p.name).slice(0, 5).join(', ') + (newOnes.length > 5 ? '…' : '') + ')');
  }
  if (reclaimed) parts.push('gắn lại ' + reclaimed + ' page về account này');
  const msg = 'Đã quét ' + all.length + ' page: '
    + (parts.length ? parts.join('; ') + '.' : 'không có gì thay đổi.')
    + ' Bấm "Lấy token" nếu page chưa có token.';
  // Đóng dấu app vừa được dùng để đồng bộ page — CRM UI vẽ viền nhận biết
  try { DEPS.appUpdate(uid, job.appId, { lastPageSyncAt: new Date().toISOString() }); } catch (_) {}
  setStatus(job, 'success', msg);
  DEPS.recordRun('success', msg);
  closeBrowser(job);
}

/* ---------- Đồng bộ app: quét MỌI app trên developers.facebook.com/apps/ ---------- */

function startAppsScan(uid) {
  if (getActive()) return { error: 'Đã có tác vụ đang chạy. Hãy hủy hoặc chờ xong.' };
  const id = crypto.randomUUID();
  const job = {
    id,
    uid,
    kind: 'sync-apps',
    status: 'opening_browser',
    message: 'Đang mở cửa sổ Chrome…',
    error: null,
    browser: null,
    page: null,
    createdAt: Date.now(),
  };
  jobs.set(id, job);
  activeId = id;
  runAppsScan(job, uid).catch((e) => failSoft(job, (e && e.message) || 'Lỗi không xác định'));
  return { job };
}

// Đọc card app trong DOM danh sách: App ID từ href /apps/<id>/dashboard/,
// tên từ [role="heading"], chế độ/loại từ dòng text "Chế độ: …" / "Loại: …".
// Không bám class tự sinh của FB — chỉ dùng href + role + text.
async function scrapeAppCards(page) {
  return page
    .evaluate(() => {
      const vis = (el) => el.offsetParent !== null || el.getClientRects().length > 0;
      const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      const anchors = [...document.querySelectorAll('a[href*="/apps/"]')]
        .filter((a) => vis(a) && /\/apps\/\d+\/dashboard/.test(a.getAttribute('href') || ''));
      const out = [];
      const seen = new Set();
      for (const a of anchors) {
        const m = (a.getAttribute('href') || '').match(/\/apps\/(\d+)\/dashboard/);
        if (!m || seen.has(m[1])) continue;
        const appId = m[1];
        // Card = tổ tiên gần nhất chứa heading tên app + dòng "Chế độ";
        // fallback: tổ tiên gần nhất chứa heading (layout FB có thể khác).
        let card = null;
        let fallback = null;
        let node = a;
        for (let k = 0; k < 15 && node; k++) {
          node = node.parentElement;
          if (!node) break;
          const hasHeading = !!node.querySelector('[role="heading"]');
          if (!fallback && hasHeading) fallback = node;
          if (hasHeading && /(?:chế độ|mode)\s*:/i.test(node.textContent || '')) { card = node; break; }
        }
        seen.add(appId);
        if (!card && !fallback) {
          out.push({ appId, name: null, mode: null, type: null });
          continue;
        }
        const root = card || fallback;
        const text = root.textContent || '';
        const heading = root.querySelector('[role="heading"]');
        const modeM = text.match(/(?:chế độ|mode)\s*:\s*(.{2,60}?)(?=\s*(?:loại|type)\s*:|$)/i);
        const typeM = text.match(/(?:loại|type)\s*:\s*(.{2,60}?)(?=\s*(?:chế độ|mode)\s*:|$)/i);
        out.push({
          appId,
          name: heading ? clean(heading.textContent) : null,
          mode: modeM ? clean(modeM[1]) : null,
          type: typeM ? clean(typeM[1]) : null,
        });
      }
      return out;
    })
    .catch(() => []);
}

async function runAppsScan(job, uid) {
  const browser = await launchAutomationChrome();
  job.browser = browser;
  browser.on('disconnected', () => {
    job.browser = null;
    if (!['success', 'error'].includes(job.status)) failSoft(job, 'Cửa sổ Chrome đã bị đóng.');
  });
  const page = await browser.newPage();
  job.page = page;
  await page.setUserAgent(UA);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7' });
  await injectSession(page, { cookies: await ensureAccountCookies(job, uid) });

  setStatus(job, 'loading_apps', 'Đang mở danh sách ứng dụng…');
  await page.goto(APPS_URL, { waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {});
  if (/log_in|login\.php/.test(page.url() || '')) {
    throw new Error('Phiên Facebook đã hết hạn — hãy đăng nhập lại trong CRM rồi chạy lại.');
  }
  await page
    .waitForSelector('a[href*="/apps/"]', { timeout: 30000 })
    .catch(() => {});
  await sleep(1500);

  // Cuộn + quét tới khi 3 vòng liền không thấy app mới (FB lazy-render danh sách)
  const seen = new Map();
  let stable = 0;
  for (let round = 0; round < 40; round++) {
    const found = await scrapeAppCards(page);
    let added = 0;
    for (const a of found) {
      if (!seen.has(a.appId)) { seen.set(a.appId, a); added++; }
    }
    setStatus(job, 'scanning', 'Đang quét: đã thấy ' + seen.size + ' ứng dụng' + (added ? ' (+' + added + ' mới)' : '') + '…');
    if (added === 0) {
      stable++;
      if (stable >= 3) break;
    } else stable = 0;
    await page.evaluate(() => { window.scrollBy(0, 2000); }).catch(() => {});
    await sleep(1200);
  }

  if (!seen.size) {
    await errorShot(page, 'sync-error.png');
    throw new Error('Không quét được ứng dụng nào trên trang Apps. Hãy kiểm tra cửa sổ Chrome.');
  }

  const all = [...seen.values()];
  const r = DEPS.appMergeScanned(uid, all);
  const names = all.map((a) => a.name).filter(Boolean);
  const msg = 'Đã đồng bộ ' + all.length + ' ứng dụng'
    + (names.length ? ': ' + names.slice(0, 4).join(', ') + (names.length > 4 ? '…' : '') : '')
    + ' — thêm mới ' + r.added + ', cập nhật ' + r.updated + '.';
  setStatus(job, 'success', msg);
  DEPS.recordRun('success', msg);
  closeBrowser(job);
}

module.exports = { configurePageSetupAutomation, startPageSync, startAppCreation, startDeleteApp, startPageSetup, startAppsScan, getJob, getActive, cancelSync, submitPassword, resumeSync, resolveRegisterInput, resendRegisterSms };