// Additive realtime fallback for Messenger's conversation list.
(function installSidebarActivityObserver() {
  const previous = globalThis.__FB_CRM_SIDEBAR_ACTIVITY_OBSERVER__;
  if (previous?.disconnect) {
    try { previous.disconnect(); } catch (_) {}
  }

  let lastFingerprint = '';
  let lastEmitAt = 0;
  let trailingTimer = null;
  let debounceTimer = null;
  const userReadThreads = new Map();

  function markUserReadThread(threadId) {
    if (!threadId) return;
    userReadThreads.set(String(threadId), Date.now());
  }

  function isUserReadRecently(threadId) {
    if (!threadId) return false;
    const at = userReadThreads.get(String(threadId));
    if (!at) return false;
    if (Date.now() - at > 15000) {
      userReadThreads.delete(String(threadId));
      return false;
    }
    return true;
  }

  function obsDebug(info) {
    try {
      if (!chrome?.runtime?.id) return;
      chrome.runtime.sendMessage({ type: 'CONTENT_DEBUG', data: { kind: 'obs', ...info } }).catch(() => {});
    } catch (_) {}
  }

  function normalize(value) {
    return String(value || '')
      .replace(/^[\s\u00b7\u2022.\-|•·]+|[\s\u00b7\u2022.\-|•·]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function hash(value) {
    let result = 2166136261;
    const input = String(value || '');
    for (let index = 0; index < input.length; index += 1) {
      result ^= input.charCodeAt(index);
      result = Math.imul(result, 16777619);
    }
    return (result >>> 0).toString(36);
  }

  const isMessengerHost = /(^|\.)messenger\.com$/i.test(location.hostname);

  const TIME_LINE_RE = /^(?:bây giờ|just now|vừa xong|vài giây|a few seconds ago|hôm qua|yesterday|thứ\s+[a-zà-ỹ]+|chủ\s+nhật|mon|tue|wed|thu|fri|sat|sun|\d{1,2}:\d{2}|\d+\s*(?:giây|phút|giờ|ngày|tuần|tháng|năm|s|m|h|d|w|y|min|mins|hr|hrs|wk|yr)(?:\s*(?:trước|ago))?)$/iu;
  const SIDEBAR_CHROME_RE = /^(?:trả\s*lời\s*\??|đang gõ(?: tin nhắn)?|đã xem(?: tin nhắn)?|đã nhìn(?: tin nhắn)?|xem tin nhắn|tin nhắn mới|gửi tin nhắn|hủy bỏ|đang gọi\W*|tin nhắn chưa đọc\s*:?|unread messages?\s*:?)$/iu;
  const PRESENCE_LINE_RE = /^(?:đang|đang hoạt động.*|hoạt động(?:\s+\d+.*)?|đã hoạt động.*|active now|active recently|active \d+.*|online|offline)$/iu;

  function extractThreadId(href) {
    const raw = String(href || '');
    const m = raw.match(/\/messages\/(?:(?:requests(?:\/spam)?|spam)\/)?(?:e2ee\/)?t\/([^\/?#]+)/i)
      || (isMessengerHost ? raw.match(/\/t\/([^\/?#]+)/i) : null);
    return m ? decodeURIComponent(m[1]) : '';
  }

  function detectRowUnread(row, threadId) {
    if (isUserReadRecently(threadId)) {
      return false;
    }

    if (row.querySelector('[data-testid="unread-count"], .unread')) return true;
    if (/(?:Tin nhắn chưa đọc|Unread messages?)\s*:/iu.test(String(row.innerText || row.textContent || ''))) {
      return true;
    }

    for (const el of row.querySelectorAll('[aria-label]')) {
      const label = (el.getAttribute('aria-label') || '').trim();
      if (!label) continue;
      if (/^(?:đánh dấu(?: là)? chưa đọc|mark as unread)$/i.test(label)) return false;
      if (/^(?:đánh dấu(?: là)? đã đọc|mark as read)$/i.test(label)) return true;
      if (!/đánh dấu|mark as/i.test(label) && /chưa đọc|unread|tin nhắn mới|new message/i.test(label)) {
        return true;
      }
    }

    const rowRect = row.getBoundingClientRect ? row.getBoundingClientRect() : null;
    for (const el of row.querySelectorAll('div, span, i')) {
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (w < 6 || w > 16 || h < 6 || h > 16 || Math.abs(w - h) > 3) continue;
      if (el.children.length > 0 || (el.textContent || '').trim()) continue;
      if (el.closest('svg, img')) continue;
      if (rowRect && rowRect.width > 0) {
        const elRect = el.getBoundingClientRect();
        if (elRect.left < rowRect.left + rowRect.width * 0.45) continue;
      }
      const st = getComputedStyle(el);
      const radius = parseFloat(st.borderTopLeftRadius);
      if (!(Number.isFinite(radius) && radius >= Math.min(w, h) / 2)) continue;
      const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(st.backgroundColor);
      if (!m) continue;
      const alpha = m[4] === undefined ? 1 : Number(m[4]);
      if (alpha < 0.2) continue;
      if (+m[3] >= 175 && +m[1] <= 100 && +m[2] >= 40 && +m[2] <= 185) return true;
    }
    return false;
  }

  function readSidebarActivity() {
    if ((!isMessengerHost && !/\/messages(?:\/|$|\?)/i.test(location.pathname + location.search)) || /\/messages\/(?:(?:e2ee\/)?(?:requests|spam|filtered)|(?:requests|spam|filtered)\/e2ee)(?:\/|$|\?)/i.test(location.pathname) || /[?&]crm_tab_role=requests\b/i.test(location.search)) {
      return { fingerprint: '', threads: [] };
    }
    const selectors = [
      'a[href*="/messages/t/"]',
      'a[href*="/messages/e2ee/t/"]',
      'a[href*="/messages/requests/t/"]',
      'a[href*="/messages/requests/spam/t/"]',
      'a[href*="/messages/spam/t/"]',
      ...(isMessengerHost ? ['a[href*="/t/"]'] : [])
    ].join(',');
    const seen = new Set();
    const rows = [];
    const threads = [];
    for (const link of document.querySelectorAll(selectors)) {
      const href = link.getAttribute('href') || link.href || '';
      const threadId = extractThreadId(href);
      if (!threadId || seen.has(threadId)) continue;
      const row = link.closest('[role="row"], [role="listitem"], li') || link.parentElement || link;

      // Tách rời từng span lá + innerText để không bao giờ dính liền tên và nội dung khi tab nền ẩn
      const rawChunks = [];
      const rawInnerText = String(row.innerText || row.textContent || '');
      if (rawInnerText) rawChunks.push(rawInnerText);
      for (const sp of row.querySelectorAll('h2, h3, [dir="auto"], span')) {
        if (sp.querySelector('span, [dir="auto"]')) continue;
        const t = String(sp.innerText || sp.textContent || '').trim();
        if (t) rawChunks.push(t);
      }

      const expandedText = rawChunks.join('\n')
        .replace(/((?:Tin nhắn chưa đọc|Unread messages?)\s*:)/giu, '\n$1\n')
        .replace(/\s*[·•]\s*(trả\s*lời\s*\??)/giu, '\n$1\n')
        .replace(/\s*[·•]\s*((?:\d+\s*(?:giây|phút|giờ|ngày|tuần|tháng|năm|s|m|h|d|w|y|min|mins|hr|hrs|wk|yr)(?:\s*(?:trước|ago))?|bây giờ|just now|vừa xong|vài giây|a few seconds ago|hôm qua|yesterday|thứ\s+[a-zà-ỹ]+|chủ\s+nhật|\d{1,2}:\d{2}))(?=\s|$|\n|[·•])/giu, '\n$1\n');

      const lines = [];
      for (const rawLine of expandedText.split(/\n+/)) {
        const cleaned = normalize(rawLine);
        if (!cleaned) continue;
        if (/^(?:Tin nhắn chưa đọc|Unread messages?)\s*:?$/iu.test(cleaned)) continue;
        if (lines[lines.length - 1] !== cleaned) lines.push(cleaned);
      }
      if (!lines.length) continue;
      seen.add(threadId);
      const unread = detectRowUnread(row, threadId);
      const userReadOnFb = isUserReadRecently(threadId);

      const nameCandidate = lines.find((l) => !TIME_LINE_RE.test(l) && !SIDEBAR_CHROME_RE.test(l) && !PRESENCE_LINE_RE.test(l)) || lines[0];
      const name = (nameCandidate || `Khách hàng (${threadId.slice(0, 8)})`).replace(/(?:Tin nhắn chưa đọc|Unread messages?)\s*:.*$/iu, '').trim();

      const timeLine = [...lines].reverse().find((line) => TIME_LINE_RE.test(line)) || '';
      let lastMessage = [...lines].reverse().find((line) => (
        line !== name
        && line.length >= 1
        && line.length < 200
        && !TIME_LINE_RE.test(line)
        && !SIDEBAR_CHROME_RE.test(line)
        && !PRESENCE_LINE_RE.test(line)
      )) || '';
      if (lastMessage && name && lastMessage.startsWith(name) && lastMessage.length > name.length) {
        const stripped = normalize(lastMessage.slice(name.length));
        if (stripped && !TIME_LINE_RE.test(stripped) && !SIDEBAR_CHROME_RE.test(stripped)) {
          lastMessage = stripped;
        }
      }

      const fpPreview = String(lastMessage || '').replace(/(?:đang soạn|đang nhập|typing)\S*/gi, '').slice(0, 120);
      rows.push(`${threadId}|${unread ? 1 : 0}|${userReadOnFb ? 1 : 0}|${name.slice(0, 48)}|${fpPreview}|${timeLine.slice(0, 16)}`);
      threads.push({
        thread_id: threadId,
        name: name.slice(0, 80),
        last_message: lastMessage,
        is_unread: unread,
        user_read_on_fb: userReadOnFb,
        preview_is_outgoing: /^(?:Bạn|Tôi|You)\s*:/iu.test(lastMessage) || /^(?:(?:Bạn|Tôi) đã gửi|You (?:sent|shared))/iu.test(lastMessage),
        row_time_text: timeLine.slice(0, 24),
        thread_url: (() => { try { return new URL(href, location.origin).toString(); } catch (_) { return href; } })(),
        is_e2ee: /\/messages\/(?:e2ee\/)?t\//i.test(href)
      });
      if (rows.length >= 100) break;
    }
    return { fingerprint: rows.length ? hash(rows.join('\n')) : '', threads };
  }

  function emitIfChanged() {
    debounceTimer = null;
    const activity = readSidebarActivity();
    const fingerprint = activity.fingerprint;
    if (!fingerprint) {
      if (!emitIfChanged.warnedPath) {
        emitIfChanged.warnedPath = true;
        obsDebug({ stage: 'OBS_NO_ROWS', path: String(location.pathname).substring(0, 60) });
      }
      return;
    }
    if (fingerprint === lastFingerprint) return;
    const now = Date.now();
    const waitMs = 180 - (now - lastEmitAt);
    if (waitMs > 0) {
      if (!trailingTimer) {
        trailingTimer = setTimeout(() => { trailingTimer = null; emitIfChanged(); }, waitMs);
      }
      return;
    }
    lastFingerprint = fingerprint;
    lastEmitAt = now;
    obsDebug({ stage: 'HINT_SENT', threads: activity.threads.length, unread: activity.threads.filter((t) => t.is_unread).length, fp: fingerprint.substring(0, 10) });
    try {
      if (!chrome?.runtime?.id) return;
      chrome.runtime.sendMessage({
        type: 'SIDEBAR_ACTIVITY_HINT',
        data: { fingerprint, threads: activity.threads, observed_at: Date.now(), url: location.href }
      }).catch((err) => {
        const failText = String((err && err.message) || err);
        if (/Extension context invalidated|Receiving end does not exist/i.test(failText)) {
          try { globalThis.__FB_CRM_SIDEBAR_ACTIVITY_OBSERVER__?.disconnect(); } catch (_) {}
          return;
        }
        obsDebug({ stage: 'HINT_SEND_FAIL', error: failText.substring(0, 90) });
      });
    } catch (_) {}
  }

  function schedule() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(emitIfChanged, 30);
  }

  function onPointerDown(e) {
    if (!e || !e.isTrusted) return;
    const link = e.target?.closest?.('a[href*="/t/"]');
    const clickedThreadId = link ? extractThreadId(link.getAttribute('href') || link.href || '') : '';
    const activeUrlThreadId = extractThreadId(location.pathname);
    if (clickedThreadId) markUserReadThread(clickedThreadId);
    else if (activeUrlThreadId) markUserReadThread(activeUrlThreadId);
    schedule();
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['aria-label', 'aria-current', 'class', 'href']
  });
  window.addEventListener('focus', schedule);
  document.addEventListener('visibilitychange', schedule);
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('click', schedule, true);
  const fallbackTimer = setInterval(emitIfChanged, 250);
  globalThis.__FB_CRM_SIDEBAR_ACTIVITY_OBSERVER__ = {
    disconnect() {
      observer.disconnect();
      window.removeEventListener('focus', schedule);
      document.removeEventListener('visibilitychange', schedule);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('click', schedule, true);
      clearInterval(fallbackTimer);
      if (debounceTimer) clearTimeout(debounceTimer);
      if (trailingTimer) clearTimeout(trailingTimer);
    }
  };
  obsDebug({ stage: 'OBS_INSTALLED', href: String(location.href).substring(0, 90) });
  schedule();
})();
