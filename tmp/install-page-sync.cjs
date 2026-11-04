const fs = require('fs');
const P = 'src/server/services/AppSetupAutomation.js';
let src = fs.readFileSync(P, 'utf8');
const NL = src.includes('\r\n') ? '\r\n' : '\n';

// 1) require pageDiscovery (UMD) nếu chưa có
if (!src.includes("require('../../extension/pageDiscovery')")) {
  const anchor = "const { resolveBinRoot } = require('../utils/appResourceRoot');";
  if (!src.includes(anchor)) { console.error('require anchor not found'); process.exit(1); }
  src = src.replace(anchor, anchor + NL + "// Bộ quét Fanpage (UMD — chạy được cả trong Node): bóc JSON Comet từ HTML facebook.com/pages" + NL + "const FbPageDiscovery = require('../../extension/pageDiscovery');");
}

// 2) DEPS default knownPageIds
if (!src.includes('knownPageIds: () => [],')) {
  src = src.replace('  clearPageTokens: () => {},', '  clearPageTokens: () => {},' + NL + '  knownPageIds: () => [],');
}

// 3) startPageSync + runPageSync — chèn trước "module.exports"
const FN = [
  '/* ---------- Đồng bộ PAGE MỚI: quét danh sách page của account, chỉ thêm page chưa có ----------',
  ' * Nguồn: facebook.com/pages/?category=your_pages + /bookmarks/pages/ — cuộn xuống',
  ' * tải thêm tới khi hết (danh sách dài), bóc JSON Comet bằng FbPageDiscovery.',
  ' * Page nào đã có trong inbox_sources (mọi trạng thái) thì bỏ qua.',
  ' */',
  'function startPageSync(uid) {',
  "  if (getActive()) return { error: 'Đã có tác vụ đang chạy. Hãy hủy hoặc chờ xong.' };",
  '  const id = crypto.randomUUID();',
  '  const job = {',
  '    id,',
  '    uid,',
  "    kind: 'sync-pages',",
  "    status: 'opening_browser',",
  "    message: 'Đang mở cửa sổ Chrome…',",
  '    error: null,',
  '    browser: null,',
  '    page: null,',
  '    appId: null,',
  '    createdAt: Date.now(),',
  '  };',
  '  jobs.set(id, job);',
  '  activeId = id;',
  "  runPageSync(job, uid).catch((e) => failSoft(job, (e && e.message) || 'Lỗi không xác định'));",
  '  return { job };',
  '}',
  '',
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
  '  const seen = new Map();',
  '  const legacyIds = new Set();',
  '  const profileAliases = new Set();',
  "  const SOURCES = ['https://www.facebook.com/pages/?category=your_pages', 'https://www.facebook.com/bookmarks/pages/'];",
  '  for (const url of SOURCES) {',
  "    setStatus(job, 'scanning', 'Đang mở ' + (url.includes('bookmarks') ? 'danh sách trang (bookmarks)…' : 'danh sách trang của bạn…'));",
  "    await page.goto(url, { waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {});",
  "    if (/log_in|login\\.php/.test(page.url() || '')) {",
  "      throw new Error('Phiên Facebook đã hết hạn — hãy đăng nhập lại trong Chrome của account rồi chạy lại.');",
  '    }',
  '    await sleep(3000);',
  '    // Cuộn xuống tải thêm (lazy-load) tới khi chiều cao ổn định 3 vòng liên tiếp',
  '    let stable = 0;',
  '    for (let round = 0; round < 80; round++) {',
  '      const h = await page.evaluate(() => document.body.scrollHeight).catch(() => 0);',
  '      await page.evaluate(() => window.scrollBy(0, 2500)).catch(() => {});',
  '      await sleep(1200);',
  '      const h2 = await page.evaluate(() => document.body.scrollHeight).catch(() => 0);',
  '      // Bóc page từ HTML DOM hiện có sau mỗi vòng (kể cả script Comet mới tải)',
  "      const html = await page.content().catch(() => '');",
  '      const found = FbPageDiscovery.parsePagesFromHtml(html, uid, legacyIds, url, profileAliases) || [];',
  '      let added = 0;',
  '      for (const p of found) {',
  '        if (!p || !p.page_id || p.dropped) continue;',
  '        if (!seen.has(String(p.page_id))) { seen.set(String(p.page_id), p); added++; }',
  '      }',
  "      setStatus(job, 'scanning', 'Đang quét: đã thấy ' + seen.size + ' page' + (added ? ' (+' + added + ' mới)' : '') + ' — cuộn xuống tải thêm…');",
  '      if (h2 === h) { stable++; if (stable >= 3) break; } else stable = 0;',
  '    }',
  '  }',
  '',
  '  const known = new Set(DEPS.knownPageIds());',
  '  const all = [...seen.values()];',
  '  const newOnes = all.filter((p) => !known.has(String(p.page_id)));',
  '  if (newOnes.length) {',
  "    DEPS.upsertPages(uid, newOnes.map((p) => ({ pageId: String(p.page_id), name: p.name || ('Page ' + p.page_id) })));",
  '  }',
  "  const msg = 'Đã quét ' + all.length + ' page: ' + (newOnes.length ? ('có ' + newOnes.length + ' page MỚI — đã thêm vào danh sách (' + newOnes.map((p) => p.name).slice(0, 5).join(', ') + (newOnes.length > 5 ? '…' : '') + ')') : 'không có page mới nào.') + ' Bấm \"Lấy token\" nếu page mới cần token.';",
  "  setStatus(job, 'success', msg);",
  "  DEPS.recordRun('success', msg);",
  '  closeBrowser(job);',
  '}',
  '',
].join(NL);

if (!src.includes('function startPageSync(uid) {')) {
  const meIdx = src.indexOf('module.exports');
  if (meIdx < 0) { console.error('module.exports not found'); process.exit(1); }
  src = src.slice(0, meIdx) + FN + NL + src.slice(meIdx);
}

// 4) export
if (!src.includes('startPageSync,')) {
  src = src.replace('module.exports = { configurePageSetupAutomation,', 'module.exports = { configurePageSetupAutomation, startPageSync,');
}

fs.writeFileSync(P, src);
console.log('page-sync installed');
