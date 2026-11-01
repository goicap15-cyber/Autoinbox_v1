const fs = require('fs');
const p = 'C:/Users/Admin/Downloads/Duan/CRM_FB1/src/extension/background.js';
let src = fs.readFileSync(p, 'utf8');
const NL = '\r\n';
const n = (s) => s.replace(/\n/g, NL);

function rep(name, from, to) {
  const f = n(from);
  const t = n(to);
  const count = src.split(f).length - 1;
  if (count !== 1) {
    console.log(`MISS/DUP ${name}: ${count} occurrences`);
    process.exit(1);
  }
  src = src.replace(f, t);
  console.log('OK', name);
}

// B1: trusted hover next to the trusted click helper
rep('add dispatchTrustedMouseMove',
`async function dispatchTrustedHistoryWheel(tabId, point, deltaY) {`,
`// Hover qua DOM event khong bat duoc CSS :hover cua Messenger, nen thanh
// hanh dong ("Tra loi") chi xuat hien voi con tro tin cay tu CDP.
async function dispatchTrustedMouseMove(tabId, point) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return { success: false, error: 'Invalid hover coordinates', error_code: 'CDP_HOVER_POINT_INVALID' };
  }
  const target = { tabId };
  try {
    await chrome.debugger.attach(target, '1.3');
    await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: point.x, y: point.y, button: 'none', pointerType: 'mouse'
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message, error_code: 'CDP_HOVER_FAILED' };
  } finally {
    try { await chrome.debugger.detach(target); } catch (_) {}
  }
}

async function dispatchTrustedHistoryWheel(tabId, point, deltaY) {`);

// B2: reply-state activator before handleSendMessage
rep('add activateMessengerReplyState',
`async function handleSendMessage({ thread_id, recipient_thread_id = null, thread_url = null, expected_contact_name = null, strict_recipient_identity = false, content, text, attachment = null, attachmentManifest = null, client_message_id, account_id = user_id, tab_role = 'interaction' }) {`,
`// Bat che do "Tra loi" trong Messenger cho tin dich: tim bubble (data-message-id
// = fb_message_id, fallback theo text), hover tin cay de thanh hanh dong hien ra,
// click nut Tra loi, roi xac nhan composer dang o trang thai reply
// ("Dang tra loi ..." / "Replying to ...").
async function activateMessengerReplyState(tabId, replyTo) {
  const target = {
    fb_message_id: String(replyTo?.fb_message_id || ''),
    snippet: String(replyTo?.snippet || ''),
    media_type: String(replyTo?.media_type || 'text')
  };
  let lastReason = 'REPLY_ACTIVATE_FAILED';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const locate = await chrome.scripting.executeScript({
      target: { tabId },
      func: (wanted) => {
        const normalize = (value) => String(value || '').replace(/[\\u200B-\\u200D\\uFEFF]/g, '').replace(/\\u00A0/g, ' ').replace(/\\s+/g, ' ').trim();
        let row = null;
        if (wanted.fb_message_id && !/^(pending_|retry_|call_)/.test(wanted.fb_message_id)) {
          row = document.querySelector('[data-message-id="' + CSS.escape(wanted.fb_message_id) + '"]');
        }
        if (!row && wanted.snippet) {
          const needle = normalize(wanted.snippet);
          const rows = [...document.querySelectorAll('[data-message-id]')].reverse();
          row = rows.find((el) => normalize(el.textContent) === needle) || null;
        }
        if (!row) return { ok: false, reason: 'REPLY_TARGET_NOT_FOUND' };
        const rect = row.getBoundingClientRect();
        if (!rect || rect.width <= 0 || rect.height <= 0) return { ok: false, reason: 'REPLY_TARGET_NOT_VISIBLE' };
        row.scrollIntoView({ block: 'center' });
        const after = row.getBoundingClientRect();
        return { ok: true, x: Math.round(after.left + after.width / 2), y: Math.round(after.top + after.height / 2) };
      },
      args: [target]
    }).then((rows) => rows?.[0]?.result || null).catch(() => null);
    if (!locate?.ok) { lastReason = locate?.reason || lastReason; break; }

    await dispatchTrustedMouseMove(tabId, { x: locate.x, y: locate.y });
    await delay(250);
    const button = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const matches = (el) => /^(Trả lời|Tra loi|Reply)$/i.test((el.getAttribute('aria-label') || '').trim());
        const visible = (el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };
        const btn = [...document.querySelectorAll('button, [role="button"]')].filter(matches).find(visible);
        if (!btn) return { ok: false, reason: 'REPLY_BUTTON_NOT_FOUND' };
        btn.scrollIntoView({ block: 'nearest' });
        const r = btn.getBoundingClientRect();
        return { ok: true, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      }
    }).then((rows) => rows?.[0]?.result || null).catch(() => null);
    if (!button?.ok) { lastReason = button?.reason || lastReason; await delay(300); continue; }

    await dispatchTrustedPointerClick(tabId, { x: button.x, y: button.y });
    let activated = false;
    for (let poll = 0; poll < 12 && !activated; poll += 1) {
      activated = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const main = document.querySelector('div[role="main"]') || document;
          for (const el of main.querySelectorAll('[aria-label], span, div')) {
            const text = (el.getAttribute('aria-label') || el.textContent || '').replace(/\\s+/g, ' ').trim();
            if (text.length > 0 && text.length < 120 && /^(Đang trả lời|Dang tra loi|Replying to)/i.test(text)) return true;
          }
          return false;
        }
      }).then((rows) => rows?.[0]?.result === true).catch(() => false);
      if (!activated) await delay(250);
    }
    if (activated) return { ok: true };
    lastReason = 'REPLY_MODE_NOT_CONFIRMED';
  }
  return { ok: false, reason: lastReason, error_code: lastReason };
}

async function handleSendMessage({ thread_id, recipient_thread_id = null, thread_url = null, expected_contact_name = null, strict_recipient_identity = false, content, text, attachment = null, attachmentManifest = null, client_message_id, account_id = user_id, tab_role = 'interaction', reply_to = null }) {`);

// B3: reply-aware DOM confirmation matcher
rep('confirmFromRenderedBubble reply-aware',
`  const trace = (stage, extra = {}) => console.log('[OUTBOUND_TRACE]', JSON.stringify({ stage, thread_id: String(thread_id), client_message_id, at: new Date().toISOString(), ...extra }));
  const confirmFromRenderedBubble = async (tabId, stage) => {`,
`  const trace = (stage, extra = {}) => console.log('[OUTBOUND_TRACE]', JSON.stringify({ stage, thread_id: String(thread_id), client_message_id, at: new Date().toISOString(), ...extra }));
  const replyActive = Boolean(reply_to && String(reply_to.snippet || ''));
  const confirmFromRenderedBubble = async (tabId, stage) => {`);

rep('confirmFromRenderedBubble matcher contains',
`          const row = rows.find((element) => {
            const label = element.getAttribute('aria-label') || '';
            return normalize(element.textContent) === wanted && /(?:Bạn|You)(?::|\\s|$)/i.test(label);
          });`,
`          const row = rows.find((element) => {
            const label = element.getAttribute('aria-label') || '';
            // Bubble dang reply boc text trong quote: so sanh contains thay vi equals.
            const text = normalize(element.textContent);
            return (text === wanted || (replyActive && text.includes(wanted))) && /(?:Bạn|You)(?::|\\s|$)/i.test(label);
          });`);

// B4: activate reply state right before the composer flow
rep('insert reply activation step',
`    trace('TAB_CONTEXT_SELECTED', { tab_id: tab.id, verified_thread_id: verifiedThreadId });`,
`    trace('TAB_CONTEXT_SELECTED', { tab_id: tab.id, verified_thread_id: verifiedThreadId });

    if (reply_to) {
      const replyState = await activateMessengerReplyState(tab.id, reply_to);
      trace('REPLY_STATE', { ok: replyState.ok, reason: replyState.reason || null, tab_id: tab.id });
      if (!replyState.ok) {
        sendToBackend('SEND_MESSAGE_RESULT', {
          thread_id,
          client_message_id,
          success: false,
          error: 'Khong bat duoc che do tra loi trong Messenger (' + (replyState.reason || 'REPLY_ACTIVATE_FAILED') + '); tin chua duoc gui',
          error_code: replyState.reason || 'REPLY_ACTIVATE_FAILED'
        });
        return;
      }
    }`);

new Function(src);
fs.writeFileSync(p, src);
console.log('SAVED, syntax OK, length', src.length);
