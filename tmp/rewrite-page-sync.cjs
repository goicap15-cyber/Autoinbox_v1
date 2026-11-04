const fs = require('fs');
const P = 'src/server/services/AppSetupAutomation.js';
let src = fs.readFileSync(P, 'utf8');
const NL = src.includes('\r\n') ? '\r\n' : '\n';

// 1) startPageSync: tự lấy appId mới nhất của account
const oldHead = [
  'function startPageSync(uid) {',
  "  if (getActive()) return { error: 'Đã có tác vụ đang chạy. Hãy hủy hoặc chờ xong.' };",
  '  const id = crypto.randomUUID();',
].join(NL);
const newHead = [
  'function startPageSync(uid) {',
  "  if (getActive()) return { error: 'Đã có tác vụ đang chạy. Hãy hủy hoặc chờ xong.' };",
  '  const latest = DEPS.appGetLatest(uid);',
  "  const appId = latest && /^\\d+$/.test(String(latest.appId || '')) ? String(latest.appId) : null;",
  "  if (!appId) return { error: 'Chưa có app nào. Hãy bấm \"Tạo app & Webhook\" trước.' };",
  '  const id = crypto.randomUUID();',
].join(NL);
if (!src.includes(oldHead)) { console.error('startPageSync head not found'); process.exit(1); }
src = src.replace(oldHead, newHead);
// job.appId: null -> job.appId = appId
src = src.replace('    kind: \'sync-pages\',\n    status:', '    kind: \'sync-pages\',\n    appId,\n    status:');

// 2) thay toàn bộ runPageSync body (từ 'async function runPageSync' tới trước module.exports)
const s = src.indexOf('async function runPageSync(job, uid) {');
const e = src.indexOf('module.exports');
if (s < 0 || e < 0 || e < s) { console.error('runPageSync markers not found', { s, e }); process.exit(1); }

const BODY = [
  'async function runPageSync(job, uid) {',
  '  const browser = await launchAutomationChrome();',
  '  job.browser = browser;',
  "  browser.on('disconnected', () => {",
  '    job.browser = null;',
  "    if (!['success', 'error'].includes(job.status)) failSoft(job, 'Cửa sổ Chrome đã bị đóng.');",
  '  });',
  '  const page = await browser.newPage();',
  '  job.page = page;',
  '  await page.setUserAgent(UA);',
  "  await page.setExtraHTTPHeaders({ 'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7' });",
  '  await injectSession(page, { cookies: await ensureAccountCookies(job, uid) });',
  '',
  '  // Vào messenger_api_settings của app — bảng "Tạo mã truy cập" liệt kê MỌI page',
  "  setStatus(job, 'scanning', 'Đang mở Cài đặt API Messenger…');",
  "  await page.goto('https://developers.facebook.com/apps/' + job.appId + '/messenger/messenger_api_settings/', { waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {});",
  "  if (/log_in|login\\.php/.test(page.url() || '')) {",
  "    throw new Error('Phiên Facebook đã hết hạn — hãy đăng nhập lại trong Chrome của account rồi chạy lại.');",
  '  }',
  '  await sleep(3500);',
  '',
  '  // Bấm nút "more"/"Xem thêm" mở rộng bảng page',
  "  setStatus(job, 'scanning', 'Đang bấm nút mở rộng danh sách page (See more)…');",
  '  for (let i = 0; i < 6; i++) {',
  "    const st = await expandCard(page, 'tạo mã truy cập|generate access tokens');",
  "    if (st !== 'no-heading') break;",
  '    await sleep(1500);',
  '  }',
  '  await sleep(2000);',
  '',
  '  // Cuộn + thu thập tới khi không còn page mới (3 vòng liền không thêm)',
  '  const seen = new Map();',
  '  let stable = 0;',
  '  for (let round = 0; round < 120; round++) {',
  '    const found = await extractPageRows(page);',
  '    let added = 0;',
  '    for (const r of found) {',
  '      if (!r.pageId) continue;',
  '      if (!seen.has(String(r.pageId))) { seen.set(String(r.pageId), r); added++; }',
  '    }',
  "    setStatus(job, 'scanning', 'Đang quét: đã thấy ' + seen.size + ' page' + (added ? ' (+' + added + ' mới)' : '') + ' — cuộn xuống tải thêm…');",
  '    if (added === 0) {',
  '      stable++;',
  '      if (stable >= 3) break;',
  '    } else stable = 0;',
  '    // Cuộn trong container của bảng (nếu có overflow riêng) và cả cửa sổ',
  '    await page.evaluate(() => {',
  "      const tbody = document.querySelector('tbody[role=\"rowgroup\"]');",
  '      let el = tbody ? tbody.parentElement : null;',
  '      let scrolled = false;',
  '      while (el) {',
  '        const st = getComputedStyle(el);',
  '        if (/(auto|scroll)/.test(st.overflowY) && el.scrollHeight > el.clientHeight) {',
  '          el.scrollTop = el.scrollHeight;',
  '          scrolled = true;',
  '          break;',
  '        }',
  '        el = el.parentElement;',
  '      }',
  '      if (!scrolled) window.scrollBy(0, 2500);',
  '      else window.scrollBy(0, 600);',
  '    }).catch(() => {});',
  '    await sleep(1300);',
  '  }',
  '',
  '  const known = new Set(DEPS.knownPageIds());',
  '  const all = [...seen.values()];',
  '  const newOnes = all.filter((p) => !known.has(String(p.pageId)));',
  '  if (newOnes.length) {',
  "    DEPS.upsertPages(uid, newOnes.map((p) => ({ pageId: String(p.pageId), name: p.name || ('Page ' + p.pageId) })));",
  '  }',
  "  const msg = 'Đã quét ' + all.length + ' page: ' + (newOnes.length ? ('có ' + newOnes.length + ' page MỚI — đã thêm vào danh sách (' + newOnes.map((p) => p.name).slice(0, 5).join(', ') + (newOnes.length > 5 ? '…' : '') + ')') : 'không có page mới nào.') + ' Bấm \"Lấy token\" nếu page mới cần token.';",
  "  setStatus(job, 'success', msg);",
  "  DEPS.recordRun('success', msg);",
  '  closeBrowser(job);',
  '}',
  '',
].join(NL);

src = src.slice(0, s) + BODY + NL + src.slice(e);
fs.writeFileSync(P, src);
console.log('runPageSync rewritten (messenger_api_settings + see more + scroll)');
