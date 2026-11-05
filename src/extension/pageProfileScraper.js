/**
 * pageProfileScraper.js — A1/A6 (Hướng A: link profile khách Page)
 * Inject on-demand vào tab Business Suite khi CRM mở thread page chưa có link
 * (page_content.js đã bị gỡ khỏi manifest nên không có gì đứng trên BS).
 *
 * A6 (2026-10-20) dựng lại theo bằng chứng DOM BS thật (console diag + inspect):
 * - [role=complementary] / [data-surface*=details] RỖNG trên BS; tên khách là
 *   leaf div/span THƯỜNG ở header khung chat giữa và sidebar, không có heading.
 * - Panel "Thông tin chi tiết" BỊ GẬP ở cửa sổ hẹp — khi gập, cả trang không có
 *   link profile nào; mở bằng nút aria-label "Thông tin chi tiết".
 * - Panel mở chứa <a aria-label="Xem trang cá nhân"
 *   href="https://www.facebook.com/<vanity>"> (khách baolonqx, 2026-10-20).
 * Mỗi phiên tối đa 2 lần thử: lần nào có full link thì dừng ở lần đó; trượt cả 2
 * thì báo fail kèm lý do để lần mở sau cào lại từ đầu (chính sách chốt 2026-10-20).
 * Kết quả gửi về background bằng message PAGE_PROFILE_EXTRACTED — không giữ
 * sendResponse lâu vì MV3 service worker có thể ngủ giữa chừng.
 */
(function () {
  'use strict';
  if (window.__crmPageProfileScraper) return;
  window.__crmPageProfileScraper = { runToken: 0 };

  const FIRST_GRACE_MS = 1500;      // Meta re-render sau khi chuyển thread
  const ATTEMPT_BUDGET_MS = 10000;
  const BETWEEN_ATTEMPTS_MS = 3000;
  const PANEL_OPEN_WAIT_MS = 5000;  // chờ panel trượt ra sau khi bấm nút
  const IDENTITY_MIN_LEFT = 300;    // header khung chat giữa; sidebar trái bị loại

  const DETAILS_TOGGLE_LABELS = [
    'thông tin chi tiết', 'chi tiết', 'details', 'detail information',
    'contact info', 'contact information'
  ];
  const PROFILE_ANCHOR_LABELS = [
    'xem trang cá nhân', 'trang cá nhân trên facebook', 'xem hồ sơ',
    'view profile', 'view facebook profile', 'view profile on facebook'
  ];

  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  // NFC: tên từ DB và text DOM có thể khác dạng tổ hợp dấu tiếng Việt
  const nfc = (s) => String(s || '').normalize('NFC');
  function normalizeName(name) {
    return nfc(name).toLowerCase().replace(/\s+/g, ' ').trim();
  }

  // A6.1 — danh tính: leaf có text TRÙNG KHÍT tên khách ở vùng giữa màn hình.
  // Kỹ thuật đã chạy thật ở campaign DOM (background COMPOSER_POLL); loại
  // sidebar trái (left nhỏ) và complementary/aside để không nhầm hàng khác.
  function identityConfirmed(cleanName) {
    if (!cleanName || cleanName.length < 2 || cleanName === 'khách hàng') return false;
    for (const el of document.querySelectorAll('div,span,h1,h2,h3,h4,a,strong,b')) {
      if (el.children.length !== 0) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (rect.left < IDENTITY_MIN_LEFT) continue;
      if (el.closest('[role="complementary"], aside')) continue;
      if (normalizeName(el.textContent) === cleanName) return true;
    }
    return false;
  }

  // Guard kép: anchor profile phải nằm trong khối DOM chứa tên khách (panel
  // chi tiết luôn có tên ở đầu — bằng chứng inspect 2026-10-20).
  function underElementContainingName(anchor, cleanName) {
    let node = anchor;
    for (let depth = 0; depth < 10 && node && node !== document.body; depth++) {
      node = node.parentElement;
      if (!node) break;
      if (normalizeName(node.textContent).includes(cleanName)) return true;
    }
    return false;
  }

  function extractProfileUrl(extractor, cleanName) {
    // Vòng 1: anchor nhãn profile rõ ràng, bất kể vị trí (bằng chứng thật:
    // aria-label "Xem trang cá nhân" — không dựa vào hình học window)
    for (const a of document.querySelectorAll('a[href]')) {
      const label = normalizeName([a.getAttribute('aria-label'), a.getAttribute('title'), a.textContent].filter(Boolean).join(' '));
      if (!label || !PROFILE_ANCHOR_LABELS.some((k) => label.includes(k))) continue;
      if (!underElementContainingName(a, cleanName)) continue;
      const url = extractor.cleanFacebookProfileUrl(a.getAttribute('href') || '');
      if (url) return url;
    }
    // Vòng 2: extractor cũ trên panel lớn nhất vùng phải (bắt profile.php,
    // /user/, vanity không nhãn) — vẫn phải chứa tên khách
    const minLeft = window.innerWidth * 0.55;
    let best = null;
    for (const el of document.querySelectorAll('div[aria-label], section, aside, [role="region"], [role="complementary"]')) {
      const rect = el.getBoundingClientRect();
      if (rect.width < 180 || rect.height < 200 || rect.left < minLeft) continue;
      if (!normalizeName(el.textContent).includes(cleanName)) continue;
      const area = rect.width * rect.height;
      if (!best || area > best.area) best = { el, area };
    }
    return best ? extractor.extractProfileUrlFromElement(best.el) : null;
  }

  function findDetailsToggle() {
    for (const el of document.querySelectorAll('[aria-label], [title]')) {
      const label = normalizeName(el.getAttribute('aria-label') || el.getAttribute('title') || '');
      if (!label || !DETAILS_TOGGLE_LABELS.includes(label)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return el;
    }
    return null;
  }

  async function tryOnce(data, graceMs, isCurrent) {
    await delay(graceMs);
    const deadline = Date.now() + ATTEMPT_BUDGET_MS;
    const extractor = window.FbPageProfileUrlExtractor;
    if (!extractor) return { profile_url: null, reason: 'extractor_missing' };
    const cleanName = normalizeName(data.contact_name);
    let sawIdentity = false;
    let clickedToggle = false;

    while (Date.now() < deadline) {
      if (!isCurrent()) return null;
      if (identityConfirmed(cleanName)) {
        sawIdentity = true;
        const url = extractProfileUrl(extractor, cleanName);
        if (url) return { profile_url: url, reason: 'ok' };
        if (!clickedToggle) {
          const toggle = findDetailsToggle();
          if (toggle) {
            // Panel gập ở cửa sổ hẹp — bấm đúng nút theo nhãn, không click mù
            toggle.click();
            clickedToggle = true;
            const openDeadline = Date.now() + PANEL_OPEN_WAIT_MS;
            while (Date.now() < openDeadline) {
              await delay(400);
              if (!isCurrent()) return null;
              const url2 = extractProfileUrl(extractor, cleanName);
              if (url2) return { profile_url: url2, reason: 'ok' };
            }
          }
        }
      }
      await delay(500);
    }
    if (!sawIdentity) return { profile_url: null, reason: 'identity_mismatch' };
    return { profile_url: null, reason: clickedToggle ? 'panel_no_profile_link' : 'panel_closed' };
  }

  function sendResult(data, profileUrl, attempts, reason, startedAt) {
    try {
      chrome.runtime.sendMessage({
        type: 'PAGE_PROFILE_EXTRACTED',
        data: {
          thread_id: data.thread_id || null,
          page_id: data.page_id || null,
          conv_id: data.conv_id || null,
          contact_name: data.contact_name || null,
          profile_url: profileUrl,
          attempts,
          reason: reason || (profileUrl ? 'ok' : 'unknown'),
          took_ms: Date.now() - startedAt
        }
      }).catch(() => {});
    } catch (_) {}
  }

  async function runScrape(data, isCurrent) {
    const startedAt = Date.now();
    const first = await tryOnce(data, FIRST_GRACE_MS, isCurrent);
    if (!first) return; // phiên bị thay thế bởi request mới trong cùng tab
    if (first.profile_url) {
      sendResult(data, first.profile_url, 1, 'ok', startedAt);
      return;
    }
    await delay(BETWEEN_ATTEMPTS_MS);
    if (!isCurrent()) return;
    const second = await tryOnce(data, 0, isCurrent);
    if (!second) return;
    if (second.profile_url) {
      sendResult(data, second.profile_url, 2, 'ok', startedAt);
      return;
    }
    sendResult(data, null, 2, second.reason, startedAt);
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.type !== 'REQUEST_PAGE_PROFILE_SCRAPE') return undefined;
    const data = msg.data || {};
    if (!/business\.facebook\.com$/.test(location.hostname)) {
      sendResponse({ ok: false, reason: 'not_biz_host' });
      return undefined;
    }
    // Tab Biz được tái sử dụng giữa các thread — request mới huỷ vòng poll của
    // phiên cũ (generation token) để không hai phiên cùng chen nhau gửi kết quả.
    const token = ++window.__crmPageProfileScraper.runToken;
    const isCurrent = () => token === window.__crmPageProfileScraper.runToken;
    sendResponse({ ok: true, started: true });
    runScrape(data, isCurrent);
    return undefined;
  });
})();
