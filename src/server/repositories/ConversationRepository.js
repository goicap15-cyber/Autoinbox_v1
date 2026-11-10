const crypto = require('crypto');
const { isInvalidContactName, cleanContactName, cleanMessageText, isSystemOrMetadataText, stripBizSentByAttribution, isBizSentByAttributionOnly, isBizFeedbackOnly } = require('../utils/textFilter');
const { isKnownPageSystemNotice } = require('../utils/pageSystemNotice');
const { isBlacklistedThreadId } = require('../utils/threadGuard');
let defaultDb;
function getDefaultDb() {
  if (!defaultDb) defaultDb = require('../database/db');
  return defaultDb;
}

// Feature 019: page_dom_observer's geometry-based direction detection
// recomputes a fresh horizontal midpoint every scan tick, which can read
// noisy/wrong right after a page reload before layout has settled (e.g.
// right after `npm start`, mid backlog rescan). Committing a flip on a
// single disagreeing reading let one bad tick silently corrupt an
// already-correct is_outgoing. This map requires the SAME disagreeing
// value to be seen twice (not necessarily consecutive ticks, but with no
// agreeing reading in between) before it's actually written - see
// shouldCommitDirectionFlip below. In-memory and reset on server restart
// by design: a restart is exactly when the first noisy reading tends to
// happen, so it should never carry a "one disagreement already logged"
// state across restarts.
let directionFlipCandidates = new Map(); // fb_message_id -> proposed isOutgoing (0/1)
const scanIdCache = new Map(); // scan_id -> timestamp
const threadGenerations = new Map(); // thread_id -> { session_epoch, generation }
const SCAN_ID_TTL_MS = 10 * 60 * 1000; // 10 minutes TTL

function cleanExpiredScanIds() {
  const now = Date.now();
  for (const [id, ts] of scanIdCache.entries()) {
    if (now - ts > SCAN_ID_TTL_MS) {
      scanIdCache.delete(id);
    }
  }
}

function shouldCommitDirectionFlip(stableMessageId, existingIsOutgoing, proposedIsOutgoing) {
  if (Number(!!existingIsOutgoing) === Number(!!proposedIsOutgoing)) {
    directionFlipCandidates.delete(stableMessageId); // agrees with stored value - any pending disagreement was noise
    return false;
  }
  const proposed = proposedIsOutgoing ? 1 : 0;
  if (directionFlipCandidates.get(stableMessageId) === proposed) {
    directionFlipCandidates.delete(stableMessageId); // confirmed by a second matching disagreement - commit
    return true;
  }
  directionFlipCandidates.set(stableMessageId, proposed); // first disagreement (or a different one) - wait for confirmation
  return false;
}

// Geometry-decisive flips commit ngay (không 2-strike) — nhưng bubble đang
// hydrate có thể sinh HAI phép đo quyết đoán NGƯỢC nhau cách nhau vài giây
// (lá nhãn a11y đo một mình -> trái, rồi bubble text mount -> phải). Phép
// flip quyết đoán ĐẦU TIÊN mới là sự thật; phép ngược chiều trong cửa sổ
// cooldown là artifact hydrate, không được thắng (reproduce 2026-11-04 10:47:
// tin khách "ccxxcxc" đo trái đúng -> lật IN, vài giây sau đọc phải sai lật
// ngược OUT ngay trước mắt user). Sau cooldown, sửa chữa thật vẫn lọt được.
const GEOMETRY_FLIP_COOLDOWN_MS = 120 * 1000;
let geometryFlipLedger = new Map(); // fb_message_id -> { direction: 0|1, at: epochMs }
function geometryFlipAllowed(stableMessageId, proposedOutgoing) {
  const record = geometryFlipLedger.get(stableMessageId);
  if (!record) return true;
  if (Number(record.direction) === Number(proposedOutgoing)) return true;
  if (Date.now() - record.at > GEOMETRY_FLIP_COOLDOWN_MS) {
    geometryFlipLedger.delete(stableMessageId);
    return true;
  }
  return false;
}
function rememberGeometryFlip(stableMessageId, committedOutgoing) {
  const existing = geometryFlipLedger.get(stableMessageId);
  if (existing && Number(existing.direction) === Number(committedOutgoing)) return; // giữ anchor ĐẦU của chiều này, re-commit không dời mốc
  geometryFlipLedger.set(stableMessageId, { direction: committedOutgoing ? 1 : 0, at: Date.now() });
  directionFlipCandidates.delete(stableMessageId);
  if (geometryFlipLedger.size > 500) geometryFlipLedger.delete(geometryFlipLedger.keys().next().value);
}

class ConversationRepository {
  static bubbleFamilyId(messageId) {
    return String(messageId || '')
      .replace(/__bubble_\d+$/, '')
      .replace(/^[^@]+@msgr\.(\d{15,22})$/, '$1');
  }

  static extractSnowflakeBigInt(fbMessageId) {
    const raw = String(fbMessageId || '').replace(/__bubble_\d+$/, '').replace(/_media(?:_\d+)?$/, '').trim();
    const midMatch = raw.match(/^mid\.\$([A-Za-z0-9_-]{20,44})$/);
    if (midMatch) {
      try {
        const b64 = midMatch[1].replace(/-/g, '+').replace(/_/g, '/');
        const buf = Buffer.from(b64, 'base64');
        if (buf.length >= 16) {
          const last8 = buf.readBigUInt64BE(buf.length - 8);
          const sf = (last8 & 0x03ffffffffffffffn) << 6n;
          const ts = Number(sf >> 22n);
          if (ts >= 1577836800000 && ts <= Date.now() + 86400000) return sf;
        }
      } catch (_) {}
    }
    const m = raw.match(/(?:@msgr\.|^)(\d{17,21})$/);
    if (!m) return null;
    try {
      const sf = BigInt(m[1]);
      const ts = Number(sf >> 22n);
      if (ts >= 1577836800000 && ts <= Date.now() + 86400000) return sf;
    } catch (_) {}
    return null;
  }

  static extractSnowflakeTimestampMs(fbMessageId) {
    const sf = ConversationRepository.extractSnowflakeBigInt(fbMessageId);
    return sf !== null ? Number(sf >> 22n) : 0;
  }

  // Facebook may group several real, consecutive bubbles under one native
  // message wrapper. The suffix is an occurrence identity, not a duplicate
  // marker: mid.x, mid.x__bubble_1, ... must remain distinct even when their
  // text or media payload is identical.
  static bubbleOccurrenceId(messageId) {
    const value = String(messageId || '');
    const match = value.match(/__bubble_(\d+)$/);
    return match ? Number(match[1]) : 0;
  }

  static findEquivalentBubbleMessage({ threadId, fbMessageId, content, isOutgoing, timestampMs }, database = getDefaultDb()) {
    const messageId = String(fbMessageId || '');
    if (!messageId) return null;
    const familyId = this.bubbleFamilyId(messageId);
    const rows = database.prepare(`
      SELECT id, fb_message_id, client_message_id, timestamp_ms
      FROM messages
      WHERE thread_id = ? AND COALESCE(content, '') = COALESCE(?, '') AND is_outgoing = ?
        AND (? <= 0 OR COALESCE(timestamp_ms, 0) <= 0 OR ABS(timestamp_ms - ?) <= 2000)
      ORDER BY id DESC LIMIT 30
    `).all(threadId, content ?? '', isOutgoing ? 1 : 0, Number(timestampMs) || 0, Number(timestampMs) || 0);
    const occurrenceId = this.bubbleOccurrenceId(messageId);
    return rows.find((row) => this.bubbleFamilyId(row.fb_message_id) === familyId
      && this.bubbleOccurrenceId(row.fb_message_id) === occurrenceId) || null;
  }

  static findEquivalentCrossSourceMessage({ threadId, fbMessageId, content, mediaUrl, isOutgoing, timestampMs }, database = getDefaultDb()) {
    const incomingId = String(fbMessageId || '');
    if (!threadId || !incomingId) return null;
    const isSynthetic = (value) => /^(?:dom_|sidebar_preview_)/.test(String(value || ''));
    const observedTimestamp = Number(timestampMs) || 0;
    const rows = database.prepare(`
      SELECT id, fb_message_id, client_message_id, timestamp_ms
      FROM messages
      WHERE thread_id = ? AND is_outgoing = ?
        AND (
          (? IS NOT NULL AND ? <> '' AND media_url = ?)
          OR ((? IS NULL OR ? = '') AND COALESCE(content, '') = COALESCE(?, ''))
        )
        AND (? <= 0 OR COALESCE(timestamp_ms, 0) <= 0 OR ABS(timestamp_ms - ?) <= 90000)
      ORDER BY id DESC LIMIT 10
    `).all(threadId, isOutgoing ? 1 : 0,
      mediaUrl || null, mediaUrl || null, mediaUrl || null,
      mediaUrl || null, mediaUrl || null, content ?? '',
      observedTimestamp, observedTimestamp);
    return rows.find((row) => isSynthetic(incomingId) !== isSynthetic(row.fb_message_id)) || null;
  }

  static dedupeBubbleFamilyMessages(messages = []) {
    const result = [];
    const indexes = new Map();
    for (const message of messages) {
      const key = [
        this.bubbleFamilyId(message.fb_message_id),
        this.bubbleOccurrenceId(message.fb_message_id),
        message.is_outgoing ? 1 : 0,
        String(message.content || ''),
        String(message.media_type || 'text')
      ].join('\u0000');
      const existingIndex = indexes.get(key);
      if (existingIndex === undefined) {
        indexes.set(key, result.length);
        result.push(message);
        continue;
      }
      const existing = result[existingIndex];
      const existingIsBase = this.bubbleFamilyId(existing.fb_message_id) === String(existing.fb_message_id || '');
      const currentIsBase = this.bubbleFamilyId(message.fb_message_id) === String(message.fb_message_id || '');
      if ((!existing.client_message_id && message.client_message_id) || (!existingIsBase && currentIsBase)) {
        result[existingIndex] = message;
      }
    }
    return result;
  }

  // Claim a provisional sidebar row for the durable message that just arrived.
  // The preview id is deterministic (sha1 account|thread|content) so at most one
  // preview row per content can exist, and previews are only created when the
  // content was NOT already in the thread. Therefore any later same-content
  // incoming row IS that message, no matter how much time passed before the
  // operator opened the thread - a timestamp window here is what let the
  // preview and the history row coexist as a visible duplicate (reproduced in
  // simulation 2026-10-08: ts drift / late click -> 2 rows).
  static promoteSidebarPreview({ threadId, fbMessageId, content, isOutgoing }, database = getDefaultDb()) {
    if (!threadId || !fbMessageId || !content || String(fbMessageId).startsWith('sidebar_preview_')) return null;
    const candidates = database.prepare(`
      SELECT id, fb_message_id FROM messages
      WHERE thread_id = ? AND fb_message_id LIKE 'sidebar_preview_%'
        AND is_outgoing = ? AND COALESCE(content, '') = COALESCE(?, '')
      ORDER BY id DESC LIMIT 2
    `).all(threadId, isOutgoing ? 1 : 0, content);
    let chosen = candidates.length === 1 ? candidates[0] : null;
    if (!chosen) {
      // Messenger can truncate long sidebar previews, so the stored preview text
      // may be a prefix of the real message text. Require a long-enough prefix
      // and exactly one candidate so a short repeat ("ok") can never claim it.
      const incomingText = String(content).trim();
      if (incomingText.length >= 24) {
        const previews = database.prepare(`
          SELECT id, fb_message_id, content FROM messages
          WHERE thread_id = ? AND fb_message_id LIKE 'sidebar_preview_%' AND is_outgoing = ?
          ORDER BY id DESC LIMIT 20
        `).all(threadId, isOutgoing ? 1 : 0);
        const matches = previews.filter((row) => {
          const previewText = String(row.content || '').trim().replace(/(?:\u2026|\.{3})$/, '').trimEnd();
          return previewText.length >= 24 && incomingText.startsWith(previewText);
        });
        if (matches.length === 1) chosen = matches[0];
      }
    }
    if (!chosen) return null;
    try {
      database.prepare('UPDATE messages SET fb_message_id = ? WHERE id = ?').run(String(fbMessageId), chosen.id);
      return { id: chosen.id, previousFbMessageId: chosen.fb_message_id, fbMessageId: String(fbMessageId) };
    } catch (_) {
      return null;
    }
  }

  static hasNewerOutgoingAfterMatchingIncoming(threadId, content, database = getDefaultDb()) {
    if (!threadId || !content) return false;
    return Boolean(database.prepare(`
      SELECT 1
      FROM messages incoming
      WHERE incoming.thread_id = ? AND incoming.is_outgoing = 0
        AND incoming.fb_message_id NOT LIKE 'sidebar_preview_%'
        AND COALESCE(incoming.content, '') = COALESCE(?, '')
        AND EXISTS (
          SELECT 1 FROM messages outgoing
          WHERE outgoing.thread_id = incoming.thread_id AND outgoing.is_outgoing = 1
            AND (
              COALESCE(outgoing.timestamp_ms, 0) > COALESCE(incoming.timestamp_ms, 0)
              OR (COALESCE(outgoing.timestamp_ms, 0) = COALESCE(incoming.timestamp_ms, 0) AND outgoing.id > incoming.id)
            )
        )
      ORDER BY incoming.id DESC LIMIT 1
    `).get(threadId, content));
  }

  // A lazy-rendered sidebar can temporarily omit its self-message prefix.
  // Keep this lookup bounded so only the just-sent exact outbound is treated
  // as a possible sidebar echo.
  static hasRecentMatchingOutgoing(threadId, content, database = getDefaultDb(), options = {}) {
    const normalizedContent = String(content || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('vi-VN');
    if (!threadId || !normalizedContent) return false;
    const nowMs = Number(options.nowMs) || Date.now();
    const windowMs = Math.max(1000, Number(options.windowMs) || 120000);
    const configuredFutureTolerance = Number(options.futureToleranceMs);
    const futureToleranceMs = Math.max(0, Number.isFinite(configuredFutureTolerance) ? configuredFutureTolerance : 30000);
    const lowerBound = nowMs - windowMs;
    const upperBound = nowMs + futureToleranceMs;
    const candidates = database.prepare(`
      SELECT content, timestamp_ms, created_at
      FROM messages
      WHERE thread_id = ? AND is_outgoing = 1
        AND (media_type IS NULL OR media_type = 'text')
        AND (
          COALESCE(timestamp_ms, 0) BETWEEN ? AND ?
          OR COALESCE(CAST(strftime('%s', created_at) AS INTEGER) * 1000, 0) BETWEEN ? AND ?
        )
      ORDER BY id DESC LIMIT 30
    `).all(threadId, lowerBound, upperBound, lowerBound, upperBound);
    return candidates.some((row) => String(row.content || '')
      .replace(/\s+/g, ' ').trim().toLocaleLowerCase('vi-VN') === normalizedContent);
  }
  // DOM/history observers can replay an operator bubble long after the
  // original send was confirmed or with a timestamp that does not match the
  // local clock. For observer-only incoming rows, an existing outgoing text
  // in the same thread is authoritative and the observed row is an echo.
  static hasMatchingOutgoingText(threadId, content, database = getDefaultDb()) {
    const normalizedContent = String(content || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('vi-VN');
    if (!threadId || !normalizedContent) return false;
    const candidates = database.prepare(`
      SELECT content
      FROM messages
      WHERE thread_id = ? AND is_outgoing = 1
        AND (media_type IS NULL OR media_type = 'text')
      ORDER BY id DESC LIMIT 100
    `).all(threadId);
    return candidates.some((row) => String(row.content || '')
      .replace(/\s+/g, ' ').trim().toLocaleLowerCase('vi-VN') === normalizedContent);
  }

  // Row ma lật chiều vào TRƯỚC row base trong cùng đợt quét (reproduce
  // 2026-10-09 04:23: alo composer - ma __bubble_1 out=0 seq 113 chèn 1ms
  // trước base out=1 seq 114): guard WS cần base đã tồn tại nên lọt khi base
  // chưa vào DB. Gọi sau MỖI lần insert thành công - khi base đổ vào sẽ dọn
  // sibling __bubble_N cùng family, cùng nội dung, KHÁC hướng đã chèn trước.
  static collapseFlippedBubbleSiblings(threadId, insertedMessageId, content, database = getDefaultDb()) {
    const familyId = String(insertedMessageId || '').replace(/__bubble_\d+$/, '');
    if (!threadId || familyId.length < 12) return 0;
    const normalized = String(content || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return 0;
    if (/^(?=[\s\S]*\p{Extended_Pictographic})[\p{Extended_Pictographic}\uFE0F\u200D\s]+$/u.test(normalized)) return 0;
    const baseRow = database.prepare(`
      SELECT is_outgoing, content, media_type, media_url FROM messages
      WHERE thread_id = ? AND (fb_message_id = ? OR fb_message_id LIKE '%.' || ?)
      ORDER BY id DESC LIMIT 1
    `).get(threadId, familyId, familyId);
    if (!baseRow) return 0;
    if (String(baseRow.content || '').replace(/\s+/g, ' ').trim() !== normalized) return 0;
    if (baseRow.media_type && baseRow.media_type !== 'text') return 0;
    const flippedRows = database.prepare(`
      SELECT id, fb_message_id, content, media_type, media_url FROM messages
      WHERE thread_id = ? AND is_outgoing != ?
    `).all(threadId, Number(baseRow.is_outgoing) ? 1 : 0);
    let deleted = 0;
    for (const row of flippedRows) {
      const rowId = String(row.fb_message_id || '');
      if (!rowId.startsWith(`${familyId}__bubble_`)) continue;
      if (row.media_type && row.media_type !== 'text') continue;
      if (row.media_url) continue;
      if (String(row.content || '').replace(/\s+/g, ' ').trim() !== normalized) continue;
      database.prepare('DELETE FROM messages WHERE id = ?').run(row.id);
      deleted += 1;
    }
    return deleted;
  }
  static upsertThread(threadData, database = getDefaultDb()) {
    const { id, account_id, thread_url, contact_name, last_message, is_unread, source_id, inbox_folder } = threadData;
    const external_thread_id = String(threadData.external_thread_id || threadData.thread_id || id);
    const bareExternalId = external_thread_id.includes(':') ? external_thread_id.split(':').pop() : external_thread_id;
    let preferredId = String(id || external_thread_id);
    if (isBlacklistedThreadId(preferredId) || isBlacklistedThreadId(external_thread_id)) {
      return null;
    }
    const cleanIncomingName = isInvalidContactName(contact_name) ? null : cleanContactName(contact_name);
    const normalizedInboxFolder = ['INBOX', 'MESSAGE_REQUEST_SPAM', 'MESSAGE_REQUEST_POSSIBLE'].includes(String(inbox_folder || '').trim())
      ? String(inbox_folder).trim()
      : null;
    const inboxFolderVerified = threadData.inbox_folder_verified === true ? 1 : 0;

    const isPageSource = Boolean(source_id && String(source_id).startsWith('src_page_'));
    const pageId = isPageSource ? String(source_id).slice('src_page_'.length) : (threadData.page_id ? String(threadData.page_id) : null);
    if (pageId && !preferredId.startsWith('page:')) {
      // Bare-first policy: page threads keep the bare id (the extension DOM can
      // only speak bare ids). Mint a namespaced id ONLY when the bare
      // conversation is already bound to a DIFFERENT src_* owner - another page
      // or the personal inbox - i.e. a real cross-conversation collision.
      const boundElsewhere = account_id ? database.prepare(`
        SELECT id FROM threads
        WHERE account_id = ? AND (id = ? OR COALESCE(external_thread_id, id) = ?)
          AND source_id IS NOT NULL AND source_id != ?
        LIMIT 1
      `).get(account_id, preferredId, bareExternalId, source_id || '') : null;
      if (boundElsewhere) {
        preferredId = `page:${pageId}:${bareExternalId}`;
      }
      // else: keep the bare id - an existing unbound row is adopted downstream
      // (the UPDATE path binds source_id onto it) instead of minting a
      // namespaced duplicate.
    }

    let existing = null;
    if (source_id && external_thread_id) {
      existing = database.prepare(`
        SELECT id, contact_name, source_id, account_id FROM threads
        WHERE source_id = ? AND (COALESCE(external_thread_id, id) = ? OR id = ? OR COALESCE(external_thread_id, id) = ?)
      `).get(source_id, external_thread_id, preferredId, bareExternalId);
    }
    if (!existing && account_id && external_thread_id && !source_id) {
      existing = database.prepare(`
        SELECT id, contact_name, source_id, account_id FROM threads
        WHERE account_id = ? AND source_id IS NULL AND (COALESCE(external_thread_id, id) = ? OR id = ?)
      `).get(account_id, external_thread_id, preferredId);
    }
    if (!existing) {
      const idCollision = database.prepare('SELECT id, contact_name, account_id, source_id FROM threads WHERE id = ?').get(preferredId);
      if (idCollision && source_id && idCollision.source_id && String(idCollision.source_id) !== String(source_id)) {
        preferredId = `page:${pageId || 'col'}:${Date.now()}_${bareExternalId}`;
        existing = null;
      } else if (idCollision && account_id && String(idCollision.account_id) !== String(account_id)) {
        // Facebook participant/thread ids are global and can appear under
        // several connected accounts. Never reuse another account's CRM row.
        preferredId = preferredId.startsWith(`${account_id}:`)
          ? preferredId
          : `${account_id}:${external_thread_id}`;
        existing = database.prepare(
          'SELECT id, contact_name, account_id FROM threads WHERE id = ? AND account_id = ?'
        ).get(preferredId, account_id);
      } else {
        existing = idCollision;
      }
    }

    const hasExplicitRequestUrl = /\/messages\/(?:(?:e2ee\/)?(?:requests|spam)|(?:requests|spam)\/e2ee)(?:\/|\?)/i.test(String(thread_url || ''));
    let safeInboxFolder = normalizedInboxFolder;
    if (['MESSAGE_REQUEST_SPAM', 'MESSAGE_REQUEST_POSSIBLE'].includes(safeInboxFolder) && !hasExplicitRequestUrl) {
      safeInboxFolder = existing ? null : 'INBOX';
    }

    if (existing) {
      const existingRow = database.prepare('SELECT inbox_folder, thread_url FROM threads WHERE id = ?').get(existing.id);
      const existingFolder = existingRow?.inbox_folder || 'INBOX';
      const existingUrl = String(existingRow?.thread_url || '');
      const existingHasNormalInboxUrl = /\/messages\/(?:e2ee\/)?t\//i.test(existingUrl)
        && !/\/messages\/(?:(?:e2ee\/)?(?:requests|spam)|(?:requests|spam)\/e2ee)(?:\/|\?)/i.test(existingUrl);
      const hasExistingMessages = Boolean(
        database.prepare('SELECT 1 FROM messages WHERE thread_id = ? LIMIT 1').get(existing.id)
      );
      // Hội thoại đã nằm ở INBOX (có URL hộp thư chính hoặc đã có tin nhắn trong DB)
      // KHÔNG BAO GIỜ bị đẩy ngược sang Tin nhắn chờ.
      const allowMoveToRequest = inboxFolderVerified === 1
        && hasExplicitRequestUrl
        && !existingHasNormalInboxUrl
        && !hasExistingMessages;

      const existingIsInvalid = isInvalidContactName(existing.contact_name);
      let targetName = existing.contact_name;
      if (cleanIncomingName && cleanIncomingName !== 'Khách hàng') {
        targetName = cleanIncomingName;
      } else if (existingIsInvalid || !existing.contact_name) {
        targetName = cleanIncomingName || 'Khách hàng';
      }

      database.prepare(`
        UPDATE threads
        SET external_thread_id = COALESCE(external_thread_id, ?),
            source_id = COALESCE(?, source_id),
            contact_name = ?,
            thread_url = COALESCE(?, thread_url),
            last_message = COALESCE(?, last_message),
            is_unread = COALESCE(?, is_unread),
            unread_manual = CASE WHEN ? = 0 AND COALESCE(unread_manual, 0) = 1 THEN 0 ELSE unread_manual END,
            inbox_folder = CASE
              WHEN COALESCE(inbox_folder, 'INBOX') = 'INBOX'
                AND ? IN ('MESSAGE_REQUEST_SPAM', 'MESSAGE_REQUEST_POSSIBLE')
                AND ? = 0
              THEN 'INBOX'
              ELSE COALESCE(?, inbox_folder)
            END
        WHERE id = ?
      `).run(
          external_thread_id, 
          source_id || null, 
          targetName,
           (existingHasNormalInboxUrl && ['MESSAGE_REQUEST_SPAM', 'MESSAGE_REQUEST_POSSIBLE'].includes(normalizedInboxFolder)) ? existingUrl : thread_url, 
          last_message, 
          is_unread === undefined ? null : (is_unread ? 1 : 0),
          is_unread === undefined ? null : (is_unread ? 1 : 0),
          safeInboxFolder,
          allowMoveToRequest ? 1 : 0,
          safeInboxFolder,
          existing.id
      );
      return this.getThread(existing.id, database);
    }

    database.prepare(`
      INSERT INTO threads (id, external_thread_id, account_id, source_id, thread_url, contact_name, last_message, is_unread, inbox_folder)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(preferredId, external_thread_id, account_id, source_id || null, thread_url, cleanIncomingName || 'Khách hàng', last_message, is_unread === undefined ? 1 : (is_unread ? 1 : 0), safeInboxFolder || 'INBOX');
    return this.getThread(preferredId, database);
  }

  static getThread(id, database = getDefaultDb()) {
    return database.prepare('SELECT * FROM threads WHERE id = ?').get(id);
  }

  // Resolves a thread's inbox source for send-routing decisions (feature 015).
  // Mirrors the exact threads -> inbox_sources join MessageQueueRepository.popPending()
  // already uses, so both places agree on what counts as a Page thread. Returns
  // { sourceType: null, pageId: null } for a thread with no source_id (e.g. legacy
  // personal threads) or one whose source_id doesn't resolve to a live source row.
  static getThreadSource(threadId, database = getDefaultDb()) {
    const row = database.prepare(`
      SELECT s.source_type AS sourceType, s.external_id AS pageId
      FROM threads t
      LEFT JOIN inbox_sources s ON s.id = t.source_id
      WHERE t.id = ?
    `).get(threadId);
    if (!row || !row.sourceType) return { sourceType: null, pageId: null };
    return row;
  }

  static touchThread(threadId, lastMessage, database = getDefaultDb()) {
    database.prepare('UPDATE threads SET last_message = COALESCE(?, last_message), last_activity = CURRENT_TIMESTAMP WHERE id = ?').run(lastMessage, threadId);
  }

  // last_activity bị mọi luồng sync/seen/mở hội thoại bump mà không có tin mới
  // (đo DB sống 2026-10-11: Bi-aaaaaaa lệch 496 giờ, 12 thread bị bump trong
  // cùng 11 giây). Sidebar phải xếp và hiển thị theo thời gian TIN NHẮN THẬT
  // mới nhất; last_activity chỉ còn là fallback khi thread chưa có tin nào.
  // Ghi đè lên row trả về (DB column giữ nguyên) nên mọi consumer REST/WS
  // dùng chung một giá trị sạch.
  static attachRealActivity(rows, database = getDefaultDb()) {
    if (!Array.isArray(rows) || !rows.length) return rows;
    const ids = [...new Set(rows.map((row) => String(row?.id || '')).filter(Boolean))];
    if (!ids.length) return rows;
    const maxByThread = new Map(database.prepare(`
      SELECT thread_id, MAX(timestamp_ms) AS max_ts
      FROM messages
      WHERE timestamp_ms > 0 AND timestamp_ms <= ${Date.now() + 60000} AND thread_id IN (${ids.map(() => '?').join(',')})
      GROUP BY thread_id
    `).all(...ids).map((r) => [String(r.thread_id), Number(r.max_ts)]));
    for (const row of rows) {
      const maxTs = maxByThread.get(String(row?.id || ''));
      if (!maxTs) continue;
      row.last_msg_ts = maxTs;
      row.last_activity = new Date(maxTs).toISOString();
    }
    return rows;
  }

  // History crawling must not make an old conversation look newly active.
  // Advance the sidebar only when the observed Facebook timestamp is newer
  // than the timestamp already stored for the thread.
  static touchThreadFromHistory(threadId, lastMessage, observedTimestampMs, database = getDefaultDb()) {
    const timestampMs = Number(observedTimestampMs || 0);
    if (!Number.isFinite(timestampMs) || timestampMs <= 0) return false;
    const thread = database.prepare('SELECT last_activity FROM threads WHERE id = ?').get(threadId);
    if (!thread) return false;
    const currentTimestampMs = Date.parse(thread.last_activity || '') || 0;
    if (currentTimestampMs >= timestampMs) return false;
    database.prepare('UPDATE threads SET last_message = COALESCE(?, last_message), last_activity = ? WHERE id = ?')
      .run(lastMessage, new Date(timestampMs).toISOString(), threadId);
    return true;
  }

  // Chỉnh last_activity về thời gian tin thật mới nhất thay vì fake "now".
  // Tự tiến khi tin thật mới hơn giá trị đang lưu; kéo lùi khi giá trị đang
  // lưu vượt tin thật trên 5 phút (vết bump CURRENT_TIMESTAMP của poller/
  // backfill khiến hội thoại cũ thành "hoạt động hôm nay" - 2026-10-21).
  // Chênh lệch trong 5 phút thì giữ nguyên để không phá nhịp realtime.
  static alignThreadActivity(threadId, lastMessage, observedTimestampMs, database = getDefaultDb()) {
    const rawMs = Number(observedTimestampMs || 0);
    if (!Number.isFinite(rawMs) || rawMs <= 0) return false;
    // last_activity lưu precision GIÂY (định dạng CURRENT_TIMESTAMP) — làm tròn
    // ts quan sát về giây để so sánh khớp, tránh re-write lặp mỗi chu kỳ poll.
    const timestampMs = Math.floor(rawMs / 1000) * 1000;
    const thread = database.prepare('SELECT last_activity FROM threads WHERE id = ?').get(threadId);
    if (!thread) return false;
    const currentText = String(thread.last_activity || '');
    let currentTimestampMs = 0;
    if (currentText) {
      // 'YYYY-MM-DD HH:MM:SS' của SQLite CURRENT_TIMESTAMP là UTC; Date.parse
      // thiếu 'Z' sẽ hiểu nhầm thành giờ máy (UTC+7) lệch 7 tiếng.
      currentTimestampMs = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(currentText)
        ? (Date.parse(currentText + 'Z') || 0)
        : (Date.parse(currentText) || 0);
    }
    if (timestampMs > currentTimestampMs || currentTimestampMs - timestampMs > 5 * 60 * 1000) {
      database.prepare('UPDATE threads SET last_message = COALESCE(?, last_message), last_activity = ? WHERE id = ?')
        .run(lastMessage, new Date(timestampMs).toISOString().slice(0, 19).replace('T', ' '), threadId);
      return true;
    }
    return false;
  }

  // Writes a resolved avatar to the contacts row only when no real avatar is
  // stored yet, so re-scanning an already-captured thread (or one whose
  // messages predate avatar extraction) can still backfill it once, without
  // clobbering a good value on every later scan tick.
  static setContactAvatarIfMissing(threadId, contactName, avatarUrl, database = getDefaultDb()) {
    if (!avatarUrl) return { updated: false };
    const existing = database.prepare('SELECT avatar_url FROM contacts WHERE thread_id = ?').get(threadId);
    if (existing && existing.avatar_url) return { updated: false };
    database.prepare(`
      INSERT INTO contacts (thread_id, name, avatar_url)
      VALUES (?, ?, ?)
      ON CONFLICT(thread_id) DO UPDATE SET
        avatar_url = COALESCE(contacts.avatar_url, excluded.avatar_url)
    `).run(threadId, contactName || 'Khách hàng', avatarUrl);
    return { updated: true };
  }

  // Lightweight projection used to seed a fresh content-script's client-side
  // timestamp-anchor map (see page_content.js) after a restart, without
  // sending full message content/media over that sync-hint channel. Excludes
  // synthetic fingerprint() ids ('history_...') - they never match a real
  // DOM data-message-id, so they'd never be usable as anchors anyway.
  static getMessageTimestamps(threadId, database = getDefaultDb()) {
    return database.prepare(`
      SELECT fb_message_id, timestamp_ms FROM messages
      WHERE thread_id = ? AND fb_message_id IS NOT NULL AND fb_message_id NOT LIKE 'history_%'
      ORDER BY timestamp_ms ASC, created_at ASC, id ASC
    `).all(threadId);
  }

  static getMessages(threadId, limit = 50, offset = 0, database = getDefaultDb()) {
    return database.prepare(`
      SELECT * FROM messages
      WHERE thread_id = ?
      ORDER BY COALESCE(sequence_order, id) DESC, id DESC
      LIMIT ? OFFSET ?
    `).all(threadId, limit, offset).reverse();
  }

  static saveMessagesTransaction(threadId, messages = [], database = getDefaultDb()) {
    if (isBlacklistedThreadId(threadId)) return { insertedIds: [], updatedIds: [], skippedCount: 0 };
    const insertMsg = database.prepare(`
      INSERT INTO messages (thread_id, fb_message_id, sender_id, sender_name, content, media_type, media_url, timestamp_ms, timestamp_source, is_outgoing, sender_role, sequence_order, direction_status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(fb_message_id) DO UPDATE SET
        sender_name = COALESCE(excluded.sender_name, messages.sender_name),
        content = CASE WHEN excluded.content IS NOT NULL AND excluded.content <> '' THEN excluded.content ELSE messages.content END,
        media_type = CASE WHEN excluded.media_type IS NOT NULL AND excluded.media_type <> 'text' THEN excluded.media_type ELSE messages.media_type END,
        media_url = CASE WHEN messages.attachment_id IS NOT NULL AND messages.media_url IS NOT NULL THEN messages.media_url ELSE COALESCE(excluded.media_url, messages.media_url) END,
        -- Một lần quét lại thiếu thông tin thời gian (ts <= 0) không được xóa
        -- timestamp đã lưu - tin cũ bị "mất thời gian" sẽ bị normalize xếp nhầm ngày.
        -- Quét lại cũng không được đẩy timestamp đã lưu tiến lên: DOM/sidebar
        -- quét tin cũ vẫn mount dán giờ quan sát (Date.now()) làm bubble cũ
        -- rơi xuống dưới tin mới hơn. Chỉ điền giờ cho hàng chưa có giờ, hoặc
        -- nhận giờ thật đến SỚM hơn (tự lành row trước đây bị dán giờ quét).
        -- created_at giữ nguyên giá trị lúc insert (đồng hồ đối chiếu echo).
        timestamp_ms = CASE
          WHEN messages.timestamp_ms IS NULL OR messages.timestamp_ms <= 0
            THEN CASE WHEN excluded.timestamp_ms > 0 THEN excluded.timestamp_ms ELSE messages.timestamp_ms END
          WHEN excluded.timestamp_ms > 0 AND excluded.timestamp_ms < messages.timestamp_ms THEN excluded.timestamp_ms
          ELSE messages.timestamp_ms END,
        timestamp_source = CASE
          WHEN messages.timestamp_ms IS NULL OR messages.timestamp_ms <= 0
            THEN CASE WHEN excluded.timestamp_ms > 0 THEN excluded.timestamp_source ELSE messages.timestamp_source END
          WHEN excluded.timestamp_ms > 0 AND excluded.timestamp_ms < messages.timestamp_ms THEN excluded.timestamp_source
          ELSE messages.timestamp_source END,
        is_outgoing = CASE WHEN excluded.direction_status = 'confirmed' THEN excluded.is_outgoing ELSE messages.is_outgoing END,
        sender_role = CASE WHEN excluded.direction_status = 'confirmed' THEN excluded.sender_role ELSE messages.sender_role END,
        -- Once a bubble is stored its visible position is immutable. A later
        -- partial DOM/history scan may have a different local index and must
        -- not move that existing text.
        sequence_order = messages.sequence_order,
        direction_status = CASE WHEN excluded.direction_status = 'confirmed' THEN 'confirmed' ELSE messages.direction_status END
    `);
    const transaction = database.transaction((msgs) => {
      const result = { insertedIds: [], updatedIds: [], skippedCount: 0 };
      // Base mid.$X và các bản render lại mid.$X__bubble_N có thể vào CÙNG một
      // batch: guard bubble phía dưới chỉ soi DB nên không thấy base chưa được
      // lưu -> cả ba row đều insert (reproduce 2026-11-03: Dkkskkss/Kaskkss/
      // Hhhgggh mỗi tin ×3). Soi trước cả batch để bubble hoãn/làm đại diện.
      const batchBaseIds = new Set();
      for (const m of msgs) {
        const id = String(m.fb_message_id || m.messageId || m.client_message_id || '');
        if (/^mid\.\$/.test(id) && !/__bubble_\d+$/.test(id)) batchBaseIds.add(id);
      }
      const pendingBubbleMerges = new Map();
      for (const msg of msgs) {
        const isOutgoing = msg.is_outgoing === true || msg.is_outgoing === 1 ? 1 : 0;
        const directionStatus = msg.direction_status === 'pending' || msg.directionStatus === 'pending'
          ? 'pending'
          : 'confirmed';
        const senderId = msg.sender_id || msg.sender || (isOutgoing ? String(msg.account_id || 'SYSTEM') : 'CONTACT');
        // Tên thành viên thật trong hội thoại NHÓM - extension chỉ điền
        // member_name khi giải được từ aria-label tin (không bao giờ là tên nhóm).
        const memberName = (!isOutgoing && msg.member_name)
          ? String(msg.member_name).trim() || null
          : null;
        const senderRole = isOutgoing ? 'operator' : 'customer';
        const observedSequence = Number.isFinite(Number(msg.sequence_order ?? msg.dom_order))
          ? Number(msg.sequence_order ?? msg.dom_order)
          : null;
        let stableId = msg.fb_message_id || msg.messageId || msg.client_message_id || ConversationRepository.fingerprint(threadId, msg);
        const rawObservedTs = Number(msg.timestamp_ms || msg.timestamp || 0);
        const snowflakeTs = ConversationRepository.extractSnowflakeTimestampMs(stableId);
        let observedTimestampMs = (Number.isFinite(rawObservedTs) && rawObservedTs > 0 && rawObservedTs <= Date.now() + 60000) ? rawObservedTs : 0;
        let observedTimestampSource = msg.timestamp_source || 'sync';
        if (snowflakeTs > 0 && (observedTimestampMs <= 0 || ['realtime_fallback', 'facebook_label', 'dom_clock_order', 'dom_order', 'unknown', 'sync'].includes(observedTimestampSource))) {
          observedTimestampMs = snowflakeTs;
          observedTimestampSource = 'facebook_payload';
        }
        let content = msg.content ?? msg.text ?? msg.cleaned ?? null;
        const mediaType = msg.media_type || (msg.media_url ? 'image' : 'text');
        const mediaUrl = msg.media_url || null;
        if (mediaType === 'video' && content) {
          if (/^\s*\d{1,2}(?::\d{2}){1,2}\s*\/\s*\d{1,2}(?::\d{2}){1,2}\s*$/i.test(content) ||
              /^\s*\d{1,2}:\d{2}\s*$/i.test(content) ||
              content.trim().toLowerCase() === 'video') {
            content = null;
          }
        }
        const cleanedContent = cleanMessageText(content);
        if (!mediaUrl && (mediaType === 'text' || !mediaType) && (!cleanedContent || isSystemOrMetadataText(cleanedContent) || cleanedContent === 'Đang tải...')) {
          result.skippedCount += 1;
          continue;
        }
        content = cleanedContent;
        // History crawlers can label an operator bubble as CONTACT/current_user.
        // The existing outgoing row is authoritative; reject that incoming
        // history observation before it reaches INSERT/UPSERT. CHỈ áp cho row
        // TỔNG HỢP (dom_/history_/__bubble_): row mang mid thật được khớp theo
        // fb_message_id + hysteresis spec 019 ở dưới. Check text cũ vô thời hạn
        // đã nuốt tin thật của khách trùng text (hoa/thường) với tin operator
        // trong 100 tin gần nhất (reproduce 2026-10-07: "Alo" của khách biến
        // mất khỏi history vì operator từng gửi "alo").
        const historySource = String(msg.source || msg.timestamp_source || '').toLowerCase();
        const observedId = String(msg.fb_message_id || msg.messageId || '');
        const isHistoryObservation = historySource.includes('history') || historySource.includes('dom_')
          || historySource === 'facebook_label'
          || /(?:__bubble_\d+|^dom_|^history_)/i.test(observedId);
        const isSyntheticObservation = /^dom_|^history_/.test(observedId) || /__bubble_\d+/.test(observedId);
        // MIỄN TRỪ emoji-thuần: khach/operator nhắn lặp 👍 là bình thường,
        // drop theo text đã nuốt like của khách vì operator từng gửi 👍
        // (reproduce 2026-10-07 14:06).
        const isPureEmojiContent = /^(?=[\s\S]*\p{Extended_Pictographic})[\p{Extended_Pictographic}\uFE0F\u200D\s]+$/u.test(String(content || ''));
        if (!isOutgoing && isHistoryObservation && isSyntheticObservation && mediaType === 'text'
          && !isPureEmojiContent
          && ConversationRepository.hasMatchingOutgoingText(threadId, content, database)) {
          result.skippedCount += 1;
          continue;
        }
        const observedCreatedAt = msg.created_at || (observedTimestampMs > 0 ? new Date(observedTimestampMs).toISOString() : new Date().toISOString());
        // Mid rút gọn hai chiều: DOM thỉnh thoảng chỉ trả PHẦN SỐ của mid
        // (7513...925) thay vì dạng đầy đủ 100066...@msgr.7513...925 -> CÙNG
        // một tin bị lưu 2 row như 2 mid khác nhau (reproduce 2026-10-07
        // 15:14-15:16: like/'ảo vậy' của operator nhân đôi, 1 bản sai chiều).
        if (/^[0-9]{10,25}$/.test(stableId)) {
          const prefixedTwin = database.prepare(
            "SELECT fb_message_id FROM messages WHERE thread_id = ? AND fb_message_id LIKE '%.' || ? LIMIT 1"
          ).get(threadId, stableId);
          if (prefixedTwin?.fb_message_id) stableId = prefixedTwin.fb_message_id;
        } else {
          const digitsSuffix = String(stableId).match(/\.([0-9]{10,25})$/);
          if (digitsSuffix) {
            const bareTwin = database.prepare(
              'SELECT id FROM messages WHERE thread_id = ? AND fb_message_id = ? LIMIT 1'
            ).get(threadId, digitsSuffix[1]);
            if (bareTwin) {
              database.prepare('UPDATE messages SET fb_message_id = ? WHERE id = ?').run(stableId, bareTwin.id);
            }
          }
        }
        // Pending outgoing bị tổng hợp id mid.X__bubble_N với anchor CŨ (quét
        // lại gắn nhầm article cũ cách xa): bản thật tự vào DB bằng mid riêng
        // vài giây sau, nên bỏ bản tổng hợp - nếu không sẽ thành row ma trùng
        // lặp mà heal 2c không với tới (ts lệch quá cửa sổ 2s, reproduce
        // 2026-10-08 18:33: alo tái dùng mid 10/06).
        if (isOutgoing && /__bubble_\d+$/.test(String(stableId))
          && mediaType === 'text' && !mediaUrl
          && !isPureEmojiContent) {
          const outgoingBubbleFamilyId = String(stableId).replace(/__bubble_\d+$/, '');
          const outgoingBubbleBase = outgoingBubbleFamilyId.length >= 12
            ? database.prepare(`
                SELECT content, timestamp_ms FROM messages
                WHERE thread_id = ? AND (fb_message_id = ? OR fb_message_id LIKE '%.' || ?)
                ORDER BY id DESC LIMIT 1
              `).get(threadId, outgoingBubbleFamilyId, outgoingBubbleFamilyId)
            : null;
          if (outgoingBubbleBase
            && String(outgoingBubbleBase.content || '').trim() === String(content || '').trim()
            && Math.abs(observedTimestampMs - Number(outgoingBubbleBase.timestamp_ms || 0)) > 60000) {
            result.skippedCount += 1;
            continue;
          }
        }
        // mid.$X__bubble_N là id FB-native: FB tự gắn suffix khi render LẠI
        // đúng tin mid.$X - nếu row gốc đã có trong thread thì observation này
        // không được thành row thứ hai; text thật từ bản render sau hợp nhất
        // vào row gốc (reproduce 2026-10-05→07: 16 tin nhóm bị tách đôi, row
        // gốc dán nhầm tên người gửi còn text thật nằm dưới id __bubble_N).
        // KHÔNG áp cho id anchor kiểu peer@msgr.N__bubble_N - đó là id tổng
        // hợp cho pending outgoing, có thể là tin thật riêng (like-group).
        if (/^mid\.\$/.test(String(stableId))) {
          const bubbleFamilyId = String(stableId).replace(/__bubble_\d+$/, '');
          const incomingText = String(content || '').trim();
          const isIncomingLinkCardFile = /\.(?:mp4|mov|avi|mkv|png|jpe?g|pdf|docx?|xlsx?|zip|rar)$/i.test(incomingText);
          if (bubbleFamilyId.length >= 12 && incomingText && !isPureEmojiContent && mediaType === 'text' && !mediaUrl) {
            const likeEscFam = bubbleFamilyId.replace(/[_%]/g, (c) => `\\${c}`);
            const familyRows = database.prepare(`
              SELECT id, fb_message_id, content, media_url, sender_name FROM messages
              WHERE thread_id = ? AND (fb_message_id = ? OR fb_message_id LIKE ? ESCAPE '\\')
              ORDER BY id ASC
            `).all(threadId, bubbleFamilyId, `${likeEscFam}__bubble_%`);
            let handledByFamily = false;
            for (const famRow of familyRows) {
              const famText = String(famRow.content || '').trim();
              if (!famText) continue;
              const isFamLinkCardFile = /\.(?:mp4|mov|avi|mkv|png|jpe?g|pdf|docx?|xlsx?|zip|rar)$/i.test(famText);
              if (famText === incomingText) {
                stableId = famRow.fb_message_id;
                handledByFamily = true;
                break;
              }
              if ((famText.length > incomingText.length && famText.includes(incomingText) && incomingText.length >= 6)
                || (isIncomingLinkCardFile && /(?:https?:\/\/|drive\.google\.com|docs\.google\.com)/i.test(famText))) {
                result.skippedCount += 1;
                handledByFamily = 'skip';
                break;
              }
              if ((incomingText.length > famText.length && incomingText.includes(famText) && famText.length >= 6)
                || (isFamLinkCardFile && /(?:https?:\/\/|drive\.google\.com|docs\.google\.com)/i.test(incomingText))) {
                database.prepare('UPDATE messages SET content = ? WHERE id = ?').run(content, famRow.id);
                stableId = famRow.fb_message_id;
                handledByFamily = true;
                break;
              }
            }
            if (handledByFamily === 'skip') continue;
          }
        }
        if (/^(?:mid\.\$|\d+@(?:msgr|g\.us)\.\d+)/.test(String(stableId)) && /__bubble_\d+$/.test(String(stableId))) {
          stableId = String(stableId).replace(/__bubble_\d+$/, '');
        }
        if (false && /^mid\.\$/.test(String(stableId)) && /__bubble_\d+$/.test(String(stableId))) {
          const bubbleFamilyId = String(stableId).replace(/__bubble_\d+$/, '');
          const bubbleFamilyBase = bubbleFamilyId.length >= 12
            ? database.prepare(`
                SELECT id, content, media_url, sender_name FROM messages
                WHERE thread_id = ? AND fb_message_id = ?
                LIMIT 1
              `).get(threadId, bubbleFamilyId)
            : null;
          if (bubbleFamilyBase) {
            const baseText = String(bubbleFamilyBase.content || '').trim();
            const incomingText = String(content || '').trim();
            const baseSender = String(bubbleFamilyBase.sender_name || senderName || '').trim();
            const isBaseEmptyOrSenderHeader = !baseText
              || (baseSender && baseText.toLowerCase() === baseSender.toLowerCase());
            if (baseText === incomingText || isBaseEmptyOrSenderHeader) {
              if (incomingText && baseText !== incomingText) {
                database.prepare('UPDATE messages SET content = ? WHERE id = ?').run(content, bubbleFamilyBase.id);
              }
              if (mediaUrl && !bubbleFamilyBase.media_url) {
                database.prepare('UPDATE messages SET media_url = ? WHERE id = ?').run(mediaUrl, bubbleFamilyBase.id);
              }
              result.skippedCount += 1;
              continue;
            }
            // Nếu bubbleFamilyBase đã chứa nội dung tin nhắn thật KHÁC với
            // incomingText, đây là bong bóng thứ N thật trong cùng article
            // mid.$X -> giữ nguyên stableId (mid.$X__bubble_N) để không mất tin!
          } else if (bubbleFamilyId.length >= 12 && !batchBaseIds.has(bubbleFamilyId)) {
            // Không có base đâu cả (DB lẫn batch): bubble đầu tiên làm đại
            // diện dưới id base, đồng thời đánh dấu vào batchBaseIds để các
            // bubble tiếp theo trong cùng article giữ nguyên __bubble_2, __bubble_3.
            stableId = bubbleFamilyId;
            batchBaseIds.add(bubbleFamilyId);
          }
        }
        // Otid thuần số + out=0: đối xứng guard WS — otid do client MÌNH sinh
        // khi gửi; khách đến luôn mang <uid>@msgr.N / mid.$. Mid rút gọn của
        // khách đã được ghép về dạng đầy đủ ở trên nên không dính guard này
        // (reproduce 2026-10-09: "sdsdsd" nhắn tay hiện bản sao bên trái khách).
        if (!isOutgoing && /^[0-9]{15,19}(?:__bubble_\d+)?$/.test(String(stableId))
          && mediaType === 'text' && !mediaUrl && !isPureEmojiContent) {
          result.skippedCount += 1;
          continue;
        }
        let existing = database.prepare('SELECT content, media_type, media_url, timestamp_ms, timestamp_source, created_at, is_outgoing, sender_role, sequence_order, direction_status, sender_name FROM messages WHERE fb_message_id = ?').get(stableId);
        // Multi-account: mid này đã thuộc thread của acc khác -> dùng bản sao
        // mirror (mid::thread) thay vì UPSERT nhầm row của acc kia (mất tin
        // hội thoại bên acc này, reproduce 2026-10-08 18:09).
        {
          const midOwnerRow = stableId
            ? database.prepare('SELECT thread_id FROM messages WHERE fb_message_id = ?').get(stableId)
            : null;
          if (midOwnerRow && midOwnerRow.thread_id !== threadId) {
            stableId = `${stableId}::${threadId}`;
            existing = database.prepare('SELECT content, media_type, media_url, timestamp_ms, timestamp_source, created_at, is_outgoing, sender_role, sequence_order, direction_status, sender_name FROM messages WHERE fb_message_id = ?').get(stableId);
          } else if (existing && mediaType === 'text' && !mediaUrl && content) {
            // Cùng threadId + cùng stableId nhưng nội dung text KHÁC nhau hoàn toàn
            // (do nhiều bong bóng liên tiếp trong 1 article dùng chung data-message-id):
            // tách sang slot __bubble_N để không ghi đè mất bong bóng trước đó.
            const existingText = String(existing.content || '').trim();
            const newText = String(content || '').trim();
            const existingSender = String(existing.sender_name || senderName || '').trim();
            const isExistingSenderHeader = existingSender && existingText.toLowerCase() === existingSender.toLowerCase();
            if (existingText && newText && existingText !== newText && !isExistingSenderHeader
              && !/^sidebar_preview_|^pending_|^(?:mid\.\$|\d+@(?:msgr|g\.us)\.\d+)/.test(String(stableId))) {
              const baseFamilyId = String(stableId).replace(/__bubble_\d+$/, '');
              const likeEsc = baseFamilyId.replace(/[_%]/g, (c) => `\\${c}`);
              const sameTextInFamily = database.prepare(`
                SELECT fb_message_id FROM messages
                WHERE thread_id = ?
                  AND (fb_message_id = ? OR fb_message_id LIKE ? ESCAPE '\\')
                  AND TRIM(COALESCE(content, '')) = ?
                LIMIT 1
              `).get(threadId, baseFamilyId, `${likeEsc}__bubble_%`, newText);
              if (sameTextInFamily) {
                stableId = sameTextInFamily.fb_message_id;
                existing = database.prepare('SELECT content, media_type, media_url, timestamp_ms, timestamp_source, created_at, is_outgoing, sender_role, sequence_order, direction_status, sender_name FROM messages WHERE fb_message_id = ?').get(stableId);
              } else {
                for (let bIdx = 1; bIdx <= 50; bIdx += 1) {
                  const candidateBubbleId = `${baseFamilyId}__bubble_${bIdx}`;
                  const slotTaken = database.prepare('SELECT 1 FROM messages WHERE fb_message_id = ?').get(candidateBubbleId);
                  if (!slotTaken) {
                    stableId = candidateBubbleId;
                    existing = null;
                    break;
                  }
                }
              }
            }
          }
        }
        let promotedSidebarPreview = false;
        // If the incoming message has an official fb_message_id but the DB only
        // knows a pending_client_* placeholder, upgrade the pending row in-place
        // so all downstream UPSERT logic finds the right existing record and does
        // NOT insert a second row.
        if (!existing && msg.fb_message_id && msg.client_message_id
          && String(msg.client_message_id).startsWith('pending_')) {
          try {
            const upgradeInfo = database.prepare(
              'SELECT fb_message_id FROM messages WHERE thread_id = ? AND fb_message_id = ? AND is_outgoing = 1 LIMIT 1'
            ).get(threadId, String(msg.client_message_id));
            if (upgradeInfo) {
              database.prepare(
                'UPDATE messages SET fb_message_id = ?, delivery_status = COALESCE(NULLIF(delivery_status, \'pending\'), \'sent\') WHERE thread_id = ? AND fb_message_id = ?'
              ).run(String(msg.fb_message_id), threadId, String(msg.client_message_id));
              stableId = String(msg.fb_message_id);
              existing = database.prepare('SELECT content, media_type, media_url, timestamp_ms, timestamp_source, created_at, is_outgoing, sender_role, sequence_order, direction_status, sender_name FROM messages WHERE fb_message_id = ?').get(stableId);
            }
          } catch (_) { /* non-fatal: fall through to normal insert path */ }
        }
        if (!existing && isOutgoing && msg.fb_message_id) {
          try {
            const cleanedFbId = String(msg.fb_message_id)
              .replace(/::[^:]+$/, '')
              .replace(/_media$/, '')
              .replace(/__bubble_\d+$/, '')
              .trim();
            const bareSfMatch = cleanedFbId.match(/^(?:\d+@msgr\.)?(\d{15,21})$/);
            const bareSf = bareSfMatch ? bareSfMatch[1] : null;
            if (bareSf) {
              const sfCandidate = database.prepare(`
                SELECT id, fb_message_id FROM messages
                WHERE thread_id = ? AND is_outgoing = 1
                  AND (fb_message_id = ? OR fb_message_id LIKE '%@msgr.' || ?)
                ORDER BY id DESC LIMIT 1
              `).get(threadId, bareSf, bareSf);
              if (sfCandidate) {
                if (String(msg.fb_message_id).includes('@msgr.') && !String(sfCandidate.fb_message_id).includes('@msgr.')) {
                  database.prepare('UPDATE OR IGNORE messages SET fb_message_id = ? WHERE id = ?')
                    .run(String(msg.fb_message_id), sfCandidate.id);
                  stableId = String(msg.fb_message_id);
                } else {
                  stableId = String(sfCandidate.fb_message_id);
                }
                existing = database.prepare('SELECT content, media_type, media_url, timestamp_ms, timestamp_source, created_at, is_outgoing, sender_role, sequence_order, direction_status, sender_name FROM messages WHERE fb_message_id = ?').get(stableId);
              }
            }
            const isCanonicalIncomingId = String(msg.fb_message_id).startsWith('mid.')
              || String(msg.fb_message_id).includes('@msgr.')
              || /^\d{15,21}$/.test(String(msg.fb_message_id));
            if (!existing && isCanonicalIncomingId && !/__bubble_\d+$/.test(String(msg.fb_message_id))) {
              if (mediaType === 'text' && !mediaUrl && content) {
                const pendingCandidate = database.prepare(`
                  SELECT id, fb_message_id, client_message_id FROM messages
                  WHERE thread_id = ? AND is_outgoing = 1
                    AND (
                      fb_message_id LIKE 'pending_%'
                      OR delivery_status = 'pending'
                      OR (fb_message_id GLOB '[0-9]*' AND fb_message_id NOT LIKE '%@msgr.%')
                    )
                    AND COALESCE(content, '') = COALESCE(?, '')
                    AND (? <= 0 OR COALESCE(timestamp_ms, 0) <= 0 OR ABS(timestamp_ms - ?) <= 120000)
                  ORDER BY id DESC LIMIT 1
                `).get(threadId, content, observedTimestampMs, observedTimestampMs);
                if (pendingCandidate) {
                  database.prepare(
                    'UPDATE OR IGNORE messages SET fb_message_id = ?, delivery_status = COALESCE(NULLIF(delivery_status, \'pending\'), \'sent\') WHERE id = ?'
                  ).run(String(msg.fb_message_id), pendingCandidate.id);
                  stableId = String(msg.fb_message_id);
                  existing = database.prepare('SELECT content, media_type, media_url, timestamp_ms, timestamp_source, created_at, is_outgoing, sender_role, sequence_order, direction_status, sender_name FROM messages WHERE fb_message_id = ?').get(stableId);
                }
              } else if (mediaType !== 'text' || mediaUrl) {
                const mediaCandidate = database.prepare(`
                  SELECT id, fb_message_id, client_message_id, created_at, timestamp_ms FROM messages
                  WHERE thread_id = ? AND is_outgoing = 1
                    AND (attachment_id IS NOT NULL OR client_message_id IS NOT NULL)
                    AND (
                      fb_message_id LIKE 'pending_%'
                      OR delivery_status = 'pending'
                      OR fb_message_id LIKE '%__bubble_%'
                      OR (fb_message_id GLOB '[0-9]*' AND fb_message_id NOT LIKE '%@msgr.%')
                    )
                    AND (attachment_id IS NOT NULL OR (media_type IS NOT NULL AND media_type != 'text'))
                    AND datetime(created_at) >= datetime('now', '-180 seconds')
                  ORDER BY id DESC LIMIT 1
                `).get(threadId);
                if (mediaCandidate) {
                  try {
                    const OutboundConfirmationService = require('../services/OutboundConfirmationService');
                    OutboundConfirmationService.confirmObservation({
                      threadId,
                      fbMessageId: String(msg.fb_message_id),
                      isOutgoing: true,
                      mediaType: mediaType !== 'text' ? mediaType : 'image',
                      content: content || '',
                      observedAt: observedTimestampMs || Date.now(),
                      confirmationSource: 'history_sync'
                    }, { database });
                  } catch (_) {}
                  database.prepare(
                    'UPDATE OR IGNORE messages SET fb_message_id = ?, delivery_status = COALESCE(NULLIF(delivery_status, \'pending\'), \'sent\'), delivery_error = NULL WHERE id = ?'
                  ).run(String(msg.fb_message_id), mediaCandidate.id);
                  stableId = String(msg.fb_message_id);
                  existing = database.prepare('SELECT content, media_type, media_url, timestamp_ms, timestamp_source, created_at, is_outgoing, sender_role, sequence_order, direction_status, sender_name FROM messages WHERE fb_message_id = ?').get(stableId);
                }
              }
            }
          } catch (_) { /* non-fatal */ }
        }
        if (!existing && msg.fb_message_id) {
          const promoted = ConversationRepository.promoteSidebarPreview({
            threadId, fbMessageId: msg.fb_message_id, content, isOutgoing
          }, database);
          if (promoted) {
            stableId = promoted.fbMessageId;
            promotedSidebarPreview = true;
            existing = database.prepare('SELECT content, media_type, media_url, timestamp_ms, timestamp_source, created_at, is_outgoing, sender_role, sequence_order, direction_status, sender_name FROM messages WHERE fb_message_id = ?').get(stableId);
          }
        }
        if (!existing && msg.fb_message_id) {
          const crossSource = ConversationRepository.findEquivalentCrossSourceMessage({
            threadId, fbMessageId: msg.fb_message_id, content, mediaUrl,
            isOutgoing, timestampMs: observedTimestampMs
          }, database);
          if (crossSource) {
            stableId = crossSource.fb_message_id;
            existing = database.prepare('SELECT content, media_type, media_url, timestamp_ms, timestamp_source, created_at, is_outgoing, sender_role, sequence_order, direction_status, sender_name FROM messages WHERE fb_message_id = ?').get(stableId);
          }
        }
        if (!existing && msg.fb_message_id) {
          const equivalentBubble = ConversationRepository.findEquivalentBubbleMessage({
            threadId,
            fbMessageId: msg.fb_message_id,
            content,
            isOutgoing,
            timestampMs: observedTimestampMs
          }, database);
          if (equivalentBubble) {
            stableId = equivalentBubble.fb_message_id;
            existing = database.prepare('SELECT content, media_type, media_url, timestamp_ms, timestamp_source, created_at, is_outgoing, sender_role, sequence_order, direction_status, sender_name FROM messages WHERE fb_message_id = ?').get(stableId);
          }
        }
        if (!existing && msg.fb_message_id && String(msg.fb_message_id).endsWith('_media')) {
          const parentFbId = String(msg.fb_message_id).slice(0, -'_media'.length);
          const parentRow = database.prepare('SELECT content, media_type, media_url, timestamp_ms, timestamp_source, created_at, is_outgoing, sender_role, sequence_order, direction_status, sender_name FROM messages WHERE thread_id = ? AND fb_message_id = ?').get(threadId, parentFbId);
          if (parentRow) {
            stableId = parentFbId;
            existing = parentRow;
          }
        }
        // Facebook sometimes omits data-message-id during a partial/reloaded DOM
        // render. The extension then generates an occurrence-based dom_* id,
        // whose suffix can change when fewer older rows are mounted. Reuse one
        // unambiguous historical row with the same payload and nearby timestamp
        // instead of inserting that old message again under the changed id.
        if (!existing && /^dom_.+_hash_.+_\d+$/.test(String(stableId)) && observedTimestampMs > 0) {
          const candidates = database.prepare(`
            SELECT fb_message_id, content, media_type, media_url, timestamp_ms, timestamp_source, created_at,
                   is_outgoing, sender_role, sequence_order, direction_status, sender_name
            FROM messages
            WHERE thread_id = ? AND content = ? AND is_outgoing = ?
              AND timestamp_ms > 0 AND ABS(timestamp_ms - ?) <= 90000
            ORDER BY ABS(timestamp_ms - ?) ASC
            LIMIT 2
          `).all(threadId, content, isOutgoing, observedTimestampMs, observedTimestampMs);
          if (candidates.length === 1) {
            stableId = candidates[0].fb_message_id;
            existing = candidates[0];
          }
        }
        let timestampMs = observedTimestampMs;
        let timestampSource = observedTimestampSource;
        let createdAt = observedCreatedAt;
        if (existing) {
          // Hard guard (soi gương reconcileExistingMessage): quan sát quét
          // (dom/history/label) không được lật chiều tin ĐÃ confirmed outgoing
          // - chỉ nguồn payload/WS mới được. Bulk upsert cũ ghi đè is_outgoing
          // qua CASE excluded nên một lần scan đọc sai là tin mình gửi thành
          // tin khách (reproduce 2026-11-03: 4 tin 14:05 bị lật out=0 kèm
          // ts giờ-quét 07:11).
          const crawlTriesToFlipOutgoing = isHistoryObservation
            && Number(existing.is_outgoing) === 1
            && isOutgoing === 0
            && existing.direction_status === 'confirmed'
            && directionStatus === 'confirmed';
          // History quét lại với nhãn hydrate lỗi thời ("do Bạn gửi") không
          // được lật ngược row INCOMING đã có tên người gửi thật (hoặc đã
          // được heal gán sender_id='CONTACT') thành OUTGOING qua UPSERT -
          // chiều ngược của guard hasMatchingOutgoingText phía trên
          // (reproduce 2026-11-03: heal xong bị crawler đọc sớm lật lại).
          const guardRow = database.prepare('SELECT sender_id, sender_name FROM messages WHERE fb_message_id = ?').get(stableId);
          const namedIncomingFlipBlocked = isHistoryObservation
            && isOutgoing === 1
            && Number(existing.is_outgoing) === 0
            && (
              (guardRow && guardRow.sender_name && !/^(?:bạn|you)$/i.test(String(guardRow.sender_name).trim()))
              || String((guardRow && guardRow.sender_id) || '') === 'CONTACT'
            );
          let upsertIsOutgoing = isOutgoing;
          let upsertSenderRole = senderRole;
          let upsertDirectionStatus = directionStatus;
          if (crawlTriesToFlipOutgoing) {
            console.log(`[ConversationRepo] 🛡️ Blocked bulk crawl flip of confirmed outgoing row: ${stableId} (source=${historySource || observedTimestampSource})`);
            upsertIsOutgoing = 1;
            upsertSenderRole = 'operator';
          } else if (namedIncomingFlipBlocked) {
            upsertIsOutgoing = 0;
            upsertSenderRole = 'customer';
            upsertDirectionStatus = 'confirmed';
          }
          const oldRank = ConversationRepository.getTimestampRank(existing.timestamp_source);
          const newRank = ConversationRepository.getTimestampRank(observedTimestampSource);
          // History sync adds a deterministic millisecond DOM offset to
          // Facebook's minute-only label. Older rows may already have the
          // same `facebook_label` provenance but not that offset, so requiring
          // a strictly better source would leave their incorrect order frozen
          // forever. Only let the canonical history pass correct an
          // equal-rank timestamp; realtime/fallback replays must not move it.
          const isCanonicalHistoryCorrection = msg.source === 'dom_history_sync'
            && observedTimestampSource === existing.timestamp_source
            && observedTimestampMs !== Number(existing.timestamp_ms || 0);
          // Giờ-quét không được đè giờ thật của tin cũ: rescan không parse
          // được giờ label sẽ dán "bây giờ" (Date.now()) khiến tin cũ rơi
          // xuống cuối thread (reproduce 2026-11-03: 12 row ts cách nhau 1ms
          // 07:11:08.51x). Ngoại lệ rank 6 (facebook_payload) - giờ từ server
          // FB là giờ thật.
          const scanStampLooksBogus = observedTimestampMs > 0
            && newRank < 6
            && Number(existing.timestamp_ms || 0) > 0
            && Date.now() - observedTimestampMs < 120000
            && Date.now() - Number(existing.timestamp_ms) >= 600000;
          const shouldUpgradeTimestamp = observedTimestampMs > 0
            && !scanStampLooksBogus
            && (newRank > oldRank || isCanonicalHistoryCorrection);
          if (!shouldUpgradeTimestamp) {
            timestampMs = existing.timestamp_ms || 0;
            timestampSource = existing.timestamp_source || 'unknown';
            createdAt = existing.created_at;
          }
          const directionChanged = upsertDirectionStatus === 'confirmed'
            && (existing.direction_status !== 'confirmed' || existing.is_outgoing !== upsertIsOutgoing);
          const timestampChanged = shouldUpgradeTimestamp && (
            timestampMs !== (existing.timestamp_ms || 0) || timestampSource !== existing.timestamp_source
          );
          const sequenceChanged = false;
          const roleChanged = existing.sender_role !== upsertSenderRole;
          // Backfill tên thành viên cho row cũ: history quét lại giải được
          // member_name (row cũ chưa từng có) phải tính là thay đổi, nếu không
          // nhánh no-change nuốt luôn.
          const senderNameChanged = Boolean(memberName) && existing.sender_name !== memberName;
          if (/^(?:mid\.\$|\d+@(?:msgr|g\.us)\.\d+)/.test(String(stableId)) && existing.content && content && existing.content !== content) {
            const exTxt = String(existing.content || '').trim();
            const inTxt = String(content || '').trim();
            const exSender = String(existing.sender_name || memberName || senderName || '').trim();
            const exIsHeaderOrFile = (exSender && exTxt.toLowerCase() === exSender.toLowerCase())
              || /^(?:tôi|bạn|you|bệnh viện|bạn đã mở đoạn chat này thông qua quảng cáo\.?)$/i.test(exTxt)
              || /\.(?:mp4|mov|avi|mkv|png|jpe?g|pdf|docx?|xlsx?|zip|rar)$/i.test(exTxt);
            const inHasUrl = /https?:\/\/|drive\.google\.com|docs\.google\.com/i.test(inTxt);
            const exHasUrl = /https?:\/\/|drive\.google\.com|docs\.google\.com/i.test(exTxt);
            if (!exIsHeaderOrFile && !(inHasUrl && !exHasUrl)) {
              content = existing.content;
            }
          }
          if (/^(?:mid\.\$|\d+@(?:msgr|g\.us)\.\d+)/.test(String(stableId)) && existing.media_url && mediaUrl && existing.media_url !== mediaUrl) {
            const exIsVideoUrl = /\.mp4(?:\?|$)|video/i.test(String(existing.media_url));
            const inIsVideoUrl = /\.mp4(?:\?|$)|video/i.test(String(mediaUrl));
            if (!(inIsVideoUrl && !exIsVideoUrl)) {
              mediaUrl = existing.media_url;
            }
          }
          const mediaChanged = (mediaUrl && existing.media_url !== mediaUrl) || (mediaType !== 'text' && existing.media_type !== mediaType);
          const changed = existing.content !== content || mediaChanged || timestampChanged || directionChanged || sequenceChanged || roleChanged || senderNameChanged;
          if (!changed) {
              const incomingQuote = String(msg.reply_to_text || msg.reply_quote_text || '').trim().slice(0, 500);
              if (incomingQuote) {
                try {
                  database.prepare("UPDATE messages SET reply_to_text = COALESCE(NULLIF(TRIM(COALESCE(reply_to_text, '')), ''), ?) WHERE fb_message_id = ? AND (reply_to_text IS NULL OR TRIM(reply_to_text) = '')").run(incomingQuote, stableId);
                } catch (_) {}
              }
              if (promotedSidebarPreview) result.updatedIds.push(stableId);
              else result.skippedCount += 1;
              continue;
            }
            insertMsg.run(threadId, stableId, senderId, memberName, content, mediaType, mediaUrl, timestampMs, timestampSource, upsertIsOutgoing, upsertSenderRole, observedSequence, upsertDirectionStatus, createdAt);
            const incomingQuoteUpd = String(msg.reply_to_text || msg.reply_quote_text || '').trim().slice(0, 500);
            if (incomingQuoteUpd) {
              try {
                database.prepare("UPDATE messages SET reply_to_text = COALESCE(NULLIF(TRIM(COALESCE(reply_to_text, '')), ''), ?) WHERE fb_message_id = ? AND (reply_to_text IS NULL OR TRIM(reply_to_text) = '')").run(incomingQuoteUpd, stableId);
              } catch (_) {}
            }
            result.updatedIds.push(stableId);
            continue;
          }
          insertMsg.run(threadId, stableId, senderId, memberName, content, mediaType, mediaUrl, timestampMs, timestampSource, isOutgoing, senderRole, observedSequence, directionStatus, createdAt);
          const incomingQuoteNew = String(msg.reply_to_text || msg.reply_quote_text || '').trim().slice(0, 500);
          if (incomingQuoteNew) {
            try {
              database.prepare("UPDATE messages SET reply_to_text = COALESCE(NULLIF(TRIM(COALESCE(reply_to_text, '')), ''), ?) WHERE fb_message_id = ? AND (reply_to_text IS NULL OR TRIM(reply_to_text) = '')").run(incomingQuoteNew, stableId);
            } catch (_) {}
          }
          result.insertedIds.push(stableId);
        // Batch có thể mang row ma lật chiều ĐỨNG TRƯỚC base (guard 513 cần
        // base đã tồn tại) - base vừa insert thì dọn sibling __bubble_N.
        try {
          ConversationRepository.collapseFlippedBubbleSiblings(threadId, stableId, content, database);
        } catch (_) { /* sweep là lành hóa, không chặn persist */ }
      }
      // Giải quyết bubble đã hoãn: base giờ đã đi qua vòng lặp.
      for (const [familyId, stash] of pendingBubbleMerges) {
        const baseRow = database.prepare(
          'SELECT id, content, media_url FROM messages WHERE thread_id = ? AND fb_message_id = ? LIMIT 1'
        ).get(threadId, familyId);
        if (baseRow) {
          if (stash.content && String(baseRow.content || '').trim() !== String(stash.content).trim()) {
            database.prepare('UPDATE messages SET content = ? WHERE id = ?').run(stash.content, baseRow.id);
          }
          if (stash.mediaUrl && !baseRow.media_url) {
            database.prepare('UPDATE messages SET media_url = ? WHERE id = ?').run(stash.mediaUrl, baseRow.id);
          }
        } else {
          // Base bị guard bỏ hoặc không tồn tại: bubble đại diện lên đời base.
          insertMsg.run(threadId, familyId, stash.senderId, stash.content, stash.mediaType, stash.mediaUrl,
            stash.timestampMs, stash.timestampSource, stash.isOutgoing,
            stash.isOutgoing ? 'operator' : 'customer', null, 'confirmed', stash.createdAt);
          result.insertedIds.push(familyId);
        }
      }
      return result;
    });
    const res = transaction(messages);
    ConversationRepository.normalizeMessageSequence(threadId, database);
    return res;
  }

  static normalizeMessageSequence(threadId, database = getDefaultDb()) {
    const rows = database.prepare(`
      SELECT id, fb_message_id, client_message_id, attachment_id, timestamp_ms, created_at, sequence_order
      FROM messages
      WHERE thread_id = ?
    `).all(threadId);

    if (rows.length === 0) return 0;

    function parseRowCreatedMs(row) {
      if (!row?.created_at) return 0;
      const s = String(row.created_at).trim();
      if (s.endsWith('Z') || s.includes('T')) return Date.parse(s) || 0;
      return Date.parse(s.replace(' ', 'T') + 'Z') || 0;
    }

    // Backfill timestamp_ms từ E2EE Snowflake ID nếu tin nhắn bị thiếu timestamp_ms (= 0)
    // hoặc bị đóng dấu nhầm bằng giờ quét lại (lệch > 2 giây so với giờ gốc trên server FB).
    // Ngoại lệ: row do CRM tạo (client_message_id / attachment_id) bị gắn nhầm anchor cũ __bubble_N
    // không bao giờ được lùi timestamp_ms về ngày hôm qua theo anchor cũ.
    const updateTsStmt = database.prepare("UPDATE messages SET timestamp_ms = ?, timestamp_source = 'facebook_payload' WHERE id = ?");
    for (const row of rows) {
      const createdMs = parseRowCreatedMs(row);
      const isCrmRowWithBubbleAnchor = Boolean(row.client_message_id || row.attachment_id)
        && /__bubble_\d+$/.test(String(row.fb_message_id || ''));
      const sfTs = ConversationRepository.extractSnowflakeTimestampMs(row.fb_message_id);
      if (isCrmRowWithBubbleAnchor && createdMs > 0 && sfTs > 0 && sfTs < createdMs - 30000) {
        if (Math.abs(Number(row.timestamp_ms || 0) - createdMs) > 2000) {
          row.timestamp_ms = createdMs;
          try { updateTsStmt.run(createdMs, row.id); } catch (_) {}
        }
        continue;
      }
      if (sfTs > 0) {
        const curTs = Number(row.timestamp_ms || 0);
        if (curTs <= 0 || Math.abs(curTs - sfTs) > 2000) {
          row.timestamp_ms = sfTs;
          try { updateTsStmt.run(sfTs, row.id); } catch (_) {}
        }
      }
    }

    if (rows.length < 2) return rows.length;

    function parseSafeUtcTimestamp(row) {
      const createdMs = parseRowCreatedMs(row);
      const isCrmRowWithBubbleAnchor = Boolean(row?.client_message_id || row?.attachment_id)
        && /__bubble_\d+$/.test(String(row?.fb_message_id || ''));
      const sfTs = ConversationRepository.extractSnowflakeTimestampMs(row?.fb_message_id);
      if (sfTs > 0 && !(isCrmRowWithBubbleAnchor && createdMs > 0 && sfTs < createdMs - 30000)) {
        return sfTs;
      }
      const ms = Number(row?.timestamp_ms || 0);
      if (Number.isFinite(ms) && ms > 0) return ms;
      if (Boolean(row?.client_message_id || row?.attachment_id || String(row?.fb_message_id || '').startsWith('sidebar_preview_'))) {
        return createdMs;
      }
      return 0;
    }

    rows.sort((a, b) => {
      const sfA = ConversationRepository.extractSnowflakeBigInt(a?.fb_message_id);
      const sfB = ConversationRepository.extractSnowflakeBigInt(b?.fb_message_id);
      if (sfA !== null && sfB !== null) {
        if (sfA !== sfB) return sfA < sfB ? -1 : 1;
        const occA = ConversationRepository.bubbleOccurrenceId(a?.fb_message_id);
        const occB = ConversationRepository.bubbleOccurrenceId(b?.fb_message_id);
        if (occA !== occB) return occA - occB;
      }

      const tsA = parseSafeUtcTimestamp(a);
      const tsB = parseSafeUtcTimestamp(b);
      if ((sfA !== null || sfB !== null) && tsA > 0 && tsB > 0 && tsA !== tsB) {
        return tsA - tsB;
      }
      const minuteA = tsA > 0 ? Math.floor(tsA / 60000) : 0;
      const minuteB = tsB > 0 ? Math.floor(tsB / 60000) : 0;
      if (minuteA > 0 && minuteB > 0 && minuteA !== minuteB) {
        return minuteA - minuteB;
      }

      const orderA = a.sequence_order !== null && a.sequence_order !== undefined ? Number(a.sequence_order) : a.id;
      const orderB = b.sequence_order !== null && b.sequence_order !== undefined ? Number(b.sequence_order) : b.id;
      if (orderA !== orderB) return orderA - orderB;

      return a.id - b.id;
    });

    const update = database.prepare('UPDATE messages SET sequence_order = ? WHERE id = ?');
    const normalize = database.transaction((orderedRows) => {
      orderedRows.forEach((row, index) => update.run(index + 1, row.id));
    });
    normalize(rows);
    return rows.length;
  }

  // Reconcile only the rows that Messenger has just exposed in one DOM
  // window. Their relative visual order is authoritative, while rows outside
  // that window keep their current slots. This repairs stale realtime/
  // optimistic ranks without moving unrelated older history around.
  static reconcileObservedDomSequence(threadId, observedMessages = [], database = getDefaultDb()) {
    const rows = database.prepare(`
      SELECT id, fb_message_id, COALESCE(sequence_order, id) AS sequence_order
      FROM messages
      WHERE thread_id = ?
      ORDER BY COALESCE(sequence_order, id) ASC, id ASC
    `).all(threadId);
    if (rows.length < 2 || !Array.isArray(observedMessages) || observedMessages.length < 2) return 0;

    const byFacebookId = new Map(rows
      .filter((row) => row.fb_message_id)
      .map((row) => [String(row.fb_message_id), row]));
    const seenRowIds = new Set();
    const observedRows = [];
    for (const message of observedMessages) {
      const observedId = String(message?.fb_message_id || '');
      if (!observedId) continue;
      let row = byFacebookId.get(observedId);
      // Media companions can be collapsed into their native parent before
      // this pass. Resolve that durable row while retaining the media's DOM
      // position in the observed sequence.
      if (!row && observedId.endsWith('_media')) {
        row = byFacebookId.get(observedId.slice(0, -'_media'.length));
      }
      if (!row || seenRowIds.has(row.id)) continue;
      seenRowIds.add(row.id);
      observedRows.push(row);
    }
    if (observedRows.length < 2) return 0;

    const observedRowIds = new Set(observedRows.map((row) => row.id));
    const slots = [];
    rows.forEach((row, index) => {
      if (observedRowIds.has(row.id)) slots.push(index);
    });
    if (slots.length !== observedRows.length) return 0;

    const alreadyOrdered = slots.every((slot, index) => rows[slot].id === observedRows[index].id);
    if (alreadyOrdered) return 0;

    const reconciled = [...rows];
    slots.forEach((slot, index) => { reconciled[slot] = observedRows[index]; });
    const update = database.prepare('UPDATE messages SET sequence_order = ? WHERE id = ?');
    const apply = database.transaction((orderedRows) => {
      orderedRows.forEach((row, index) => update.run(index + 1, row.id));
    });
    apply(reconciled);
    return observedRows.length;
  }
  // Test-only: clears direction-flip hysteresis state between test cases so
  // one test's pending candidate can't leak into another's assertions.
  static _resetDirectionFlipTracking() {
    directionFlipCandidates = new Map();
    geometryFlipLedger = new Map();
  }

  // Reconciles an already-existing message row with a freshly re-scanned
  // observation of it: upgrades the timestamp when the new source outranks the
  // stored one, and (for page_dom_observer specifically, whose geometry-based
  // direction detection is the most reliable signal for that source) corrects
  // is_outgoing when it disagrees with what's stored - but only once that
  // disagreement is confirmed twice (see shouldCommitDirectionFlip). Never
  // inserts a second row and never throws on repeated identical re-scans.
  static reconcileExistingMessage(stableMessageId, { source, isOutgoing, directionStatus, direction_status, directionConfidence, direction_confidence, directionEvidence = null, tsMs, tsSource, createdAt, content = null, senderName = null } = {}, database = getDefaultDb()) {
    const existingMsg = database.prepare('SELECT timestamp_ms, timestamp_source, is_outgoing, direction_status, sender_name, sender_id, client_message_id, sent_by_agent, delivery_status FROM messages WHERE fb_message_id = ?').get(stableMessageId);
    if (!existingMsg) return { updated: false, reason: 'not_found' };

    const shouldUpdateTimestamp = Boolean(
      tsMs && tsMs > 0 && ConversationRepository.shouldUpgradeTimestamp(
        existingMsg.timestamp_source,
        tsSource,
        existingMsg.timestamp_ms,
        tsMs
      )
    );
    const explicitStatus = directionStatus || direction_status;
    const explicitConfidence = directionConfidence || direction_confidence;
    const isDirectionKnown = isOutgoing === true || isOutgoing === false || isOutgoing === 1 || isOutgoing === 0;
    const isPendingObservation = explicitStatus === 'pending'
      || !isDirectionKnown
      || explicitConfidence === 'unknown';
    const normalizedOutgoing = isOutgoing === true || isOutgoing === 1 ? 1 : 0;

    // Unknown geometry must never complete or alter a direction decision. It
    // also clears any prior flip candidate so two separated noisy readings
    // cannot combine around an unknown observation.
    if (isPendingObservation) {
      directionFlipCandidates.delete(stableMessageId);
      if (!shouldUpdateTimestamp) return { updated: false, reason: 'no_change' };
      database.prepare(`
        UPDATE messages
        SET timestamp_ms = ?, timestamp_source = ?, created_at = ?
        WHERE fb_message_id = ?
      `).run(tsMs, tsSource, createdAt, stableMessageId);
      return {
        updated: true,
        timestampUpdated: true,
        directionUpdated: false,
        previousTimestampSource: existingMsg.timestamp_source,
        previousIsOutgoing: existingMsg.is_outgoing,
        previousDirectionStatus: existingMsg.direction_status
      };
    }

    const isPageObservation = source === 'page_dom_observer';
    // Personal Messenger crawler (dom_observer) and history sync (dom_history_sync)
    // can also produce noisy direction readings on restart. Apply the same 2-strike
    // hysteresis so a single bad crawl scan never corrupts a stored direction.
    const isCrawlObservation = isPageObservation || source === 'dom_observer' || source === 'dom_history_sync';
    const existingIsPending = existingMsg.direction_status === 'pending';
    const shouldPromotePending = isPageObservation && existingIsPending;

    // Row không dấu vết tin gửi từ CRM (không client_message_id, không
    // sent_by_agent, không pending): quan sát geometry quyết đoán (bong bóng
    // rõ một bên, direction_evidence='geometry') được sửa chiều NGAY, cả hai
    // hướng. Nhãn tên bị 2 acc trùng tên làm mơ hồ — geometry là bằng chứng
    // duy nhất tin được; không có lối này lần đọc sai trước bị khóa vĩnh viễn
    // vì mọi reading đúng bị guard dưới chặn (reproduce 2026-11-03 12:09).
    const existingRowHasNoCrmTrace = (existingMsg.client_message_id === null || existingMsg.client_message_id === '')
      && Number(existingMsg.sent_by_agent || 0) === 0
      && (existingMsg.delivery_status === null
        || !['pending', 'sending'].includes(String(existingMsg.delivery_status)));
    const isDecisiveGeometryObservation = isCrawlObservation
      && (directionEvidence === 'geometry' || (normalizedOutgoing === 0 && (directionEvidence === 'avatar' || directionEvidence === 'label_name')))
      && existingRowHasNoCrmTrace
      && Number(existingMsg.is_outgoing) !== normalizedOutgoing;

    // Hard guard: if the stored row is already confirmed outgoing (is_outgoing=1),
    // a crawl/history source alone must never flip it to incoming. Only an
    // explicit, authoritative source (e.g. facebook_payload, network confirmation)
    // may override a confirmed outgoing row.
    const crawlTriesToFlipOutgoing = isCrawlObservation
      && !isDecisiveGeometryObservation
      && Number(existingMsg.is_outgoing) === 1
      && normalizedOutgoing === 0
      && existingMsg.direction_status === 'confirmed';
    if (crawlTriesToFlipOutgoing) {
      // NGOẠI LỆ đối xứng với guard "named incoming" bên dưới: observation
      // mang TÊN người gửi giải được từ nhãn Messenger ("Message sent 12:10
      // PM by <Tên>:") là bằng chứng hướng đáng tin — được lật row outgoing
      // đã ghi sai do đoán hình học (reproduce 2026-11-03 12:10: tin khách
      // lật thành outgoing vì regex label EN không khớp, geometry cửa sổ ẩn
      // đoán sai, mọi reading đúng sau đó bị guard này chặn vĩnh viễn).
      const hasNamedSenderEvidence = Boolean(senderName)
        && !/^(?:bạn|you|khách hàng|customer)$/i.test(String(senderName).trim());
      if (hasNamedSenderEvidence) {
        database.prepare("UPDATE messages SET is_outgoing = 0, sender_name = ?, sender_role = 'customer' WHERE fb_message_id = ?").run(String(senderName).trim(), stableMessageId);
        console.log(`[ConversationRepo] 🔁 Lật chiều theo nhãn có tên: ${stableMessageId} -> incoming (${senderName})`);
        return { updated: true, reason: 'label_evidence_flip' };
      }
      // Record as a candidate but do NOT commit under any circumstance.
      // This prevents a consistently-wrong geometry reading on a wide video
      // from ever flipping our own sent media to incoming.
      console.log(`[ConversationRepo] 🛡️ Blocked crawl flip of confirmed outgoing row: ${stableMessageId} (source=${source})`);
      directionFlipCandidates.delete(stableMessageId);
      if (!shouldUpdateTimestamp) return { updated: false, reason: 'crawl_blocked_outgoing_flip' };
    }

    // Chiều ngược: quét lại với nhãn hydrate lỗi thời ("do Bạn gửi") không
    // được lật row INCOMING đã có tên người gửi thật thành OUTGOING.
    const crawlFlipsNamedIncoming = isCrawlObservation
      && Number(existingMsg.is_outgoing) === 0
      && normalizedOutgoing === 1
      && (existingMsg.sender_name
        && !/^(?:bạn|you|khách hàng|customer|người dùng facebook|facebook user)$/i.test(String(existingMsg.sender_name).trim()));
    if (crawlFlipsNamedIncoming) {
      console.log(`[ConversationRepo] 🛡️ Blocked crawl flip of named incoming row: ${stableMessageId} (source=${source})`);
      directionFlipCandidates.delete(stableMessageId);
      if (!shouldUpdateTimestamp) return { updated: false, reason: 'crawl_blocked_named_incoming_flip' };
    }

    // Lật geometry ngược chiều trong cooldown = artifact hydrate, chặn SẠCH
    // (không rơi xuống 2-strike crawl — phép đo xấu sẽ gom đủ 2 strike sau
    // cooldown nếu nó là thật; trong cửa sổ thì không được thắng).
    const geometryFlipBlockedByCooldown = isDecisiveGeometryObservation
      && Number(existingMsg.is_outgoing) !== normalizedOutgoing
      && !geometryFlipAllowed(stableMessageId, normalizedOutgoing);
    if (geometryFlipBlockedByCooldown) {
      console.log(`[ConversationRepo] ⏳ Chặn lật geometry ngược chiều trong cooldown: ${stableMessageId} -> ${normalizedOutgoing === 1 ? 'outgoing' : 'incoming'}`);
    }

    const shouldUpdateDirection = isCrawlObservation && !geometryFlipBlockedByCooldown
      && !crawlTriesToFlipOutgoing && !crawlFlipsNamedIncoming && (
      isDecisiveGeometryObservation
      || shouldPromotePending
      || shouldCommitDirectionFlip(stableMessageId, existingMsg.is_outgoing, normalizedOutgoing)
    );

    if (!shouldUpdateTimestamp && !shouldUpdateDirection) {
      return { updated: false, reason: 'no_change' };
    }

    database.prepare(`
      UPDATE messages
      SET timestamp_ms = CASE WHEN ? = 1 THEN ? ELSE timestamp_ms END,
          timestamp_source = CASE WHEN ? = 1 THEN ? ELSE timestamp_source END,
          created_at = CASE WHEN ? = 1 THEN ? ELSE created_at END,
          is_outgoing = CASE WHEN ? = 1 THEN ? ELSE is_outgoing END,
          direction_status = CASE WHEN ? = 1 THEN 'confirmed' ELSE direction_status END,
          content = CASE WHEN (content IS NULL OR content = '') AND (? IS NOT NULL AND ? != '') THEN ? ELSE content END
      WHERE fb_message_id = ?
    `).run(
      shouldUpdateTimestamp ? 1 : 0, tsMs,
      shouldUpdateTimestamp ? 1 : 0, tsSource,
      shouldUpdateTimestamp ? 1 : 0, createdAt,
      shouldUpdateDirection ? 1 : 0, normalizedOutgoing,
      shouldUpdateDirection ? 1 : 0,
      content, content, content,
      stableMessageId
    );

    if (shouldUpdateDirection && isDecisiveGeometryObservation) {
      rememberGeometryFlip(stableMessageId, normalizedOutgoing);
      // Lật chiều kèm vai người gửi: tin khách cần sender CONTACT, tin đi
      // cần sender account — không cập nhật kèm thì UI lệ vai dù is_outgoing đúng.
      database.prepare(`
        UPDATE messages
        SET sender_role = ?,
            sender_id = CASE WHEN ? = 0 THEN 'CONTACT'
                        ELSE COALESCE((SELECT account_id FROM threads
                          WHERE threads.id = messages.thread_id), sender_id) END,
            sender_name = CASE WHEN ? = 0 THEN NULL ELSE sender_name END
        WHERE fb_message_id = ?
      `).run(normalizedOutgoing === 1 ? 'operator' : 'customer', normalizedOutgoing, normalizedOutgoing, stableMessageId);
      console.log(`[ConversationRepo] 🔁 Sửa chiều theo geometry quyết đoán: ${stableMessageId} -> ${normalizedOutgoing === 1 ? 'outgoing' : 'incoming'}`);
    }

    return {
      updated: true,
      timestampUpdated: shouldUpdateTimestamp,
      directionUpdated: shouldUpdateDirection,
      previousTimestampSource: existingMsg.timestamp_source,
      previousIsOutgoing: existingMsg.is_outgoing,
      previousDirectionStatus: existingMsg.direction_status
    };
  }

  static getTimestampRank(source) {
    if (!source) return 1;
    const s = String(source).trim().toLowerCase();
    if (s === 'facebook_payload' || s === 'facebook_timestamp') return 6;
    if (s === 'facebook_label' || s === 'facebook_dom') return 5;
    if (s === 'separator_date_clock' || s === 'dom_clock_order') return 4;
    if (s === 'realtime_delta' || s === 'client_submit' || s === 'composer_confirmation' || s === 'realtime_fallback' || s === 'sync') return 3;
    if (s === 'dom_order') return 2;
    return 1;
  }

  static shouldUpgradeTimestamp(oldSource, newSource, oldTs = 0, newTs = 0) {
    const oldRank = ConversationRepository.getTimestampRank(oldSource);
    const newRank = ConversationRepository.getTimestampRank(newSource);
    // Stamp giờ-quét: ts mới ≈ "bây giờ" theo máy cào trong khi tin đã có giờ
    // cũ hơn hẳn (>= 10 phút) -> cấm nâng cấp, giữ giờ thật đã lưu. Ngoại lệ
    // rank 6 (facebook_payload/facebook_timestamp) - giờ từ server FB là giờ thật.
    if (newRank < 6 && newTs > 0 && oldTs > 0
      && Date.now() - Number(newTs) < 120000
      && Date.now() - Number(oldTs) >= 600000) return false;
    if (newRank > oldRank) return true;
    if (newRank < oldRank) return false;
    // When ranks are identical:
    // Never allow realtime_fallback or realtime_delta (volatile Date.now()) to drift timestamps on repeated rescans
    const s = String(newSource || '').trim().toLowerCase();
    if (s === 'realtime_fallback' || s === 'realtime_delta') return false;
    // dom_order cũng là stamp Date.now() lúc CÀO - mỗi lần crawler quét lại
    // các tin cũ vẫn mount trong DOM sẽ ghi đè giờ thật/giờ cũ bằng giờ cào
    // mới và sort đẩy tin cũ xuống cuối thread (reproduce 2026-09-24: tin
    // 19/09 biến thành 02:21 24/09). dom_order chỉ được dùng khi existing
    // chưa có giờ (unknown/0), không bao giờ ghi đè.
    if (s === 'dom_order') return false;
    // Allow upgrade if the new timestamp is valid (>0) and significantly different (>= 30s or across days)
    if (newTs > 0 && oldTs > 0 && Math.abs(Number(newTs) - Number(oldTs)) >= 30000) {
      return true;
    }
    return false;
  }

  static upgradeMessageTimestamp(threadId, fbMessageId, timestampMs, timestampSource, database = getDefaultDb()) {
    if (!threadId || !fbMessageId || !timestampMs || timestampMs <= 0) return null;
    const existing = database.prepare('SELECT id, timestamp_ms, timestamp_source FROM messages WHERE fb_message_id = ?').get(fbMessageId);
    if (!existing) return null;
    if (!ConversationRepository.shouldUpgradeTimestamp(existing.timestamp_source, timestampSource, existing.timestamp_ms, timestampMs)) {
      return null;
    }
    database.prepare(`
      UPDATE messages 
      SET timestamp_ms = ?, timestamp_source = ?
      WHERE fb_message_id = ?
    `).run(timestampMs, timestampSource, fbMessageId);
    ConversationRepository.normalizeMessageSequence(threadId, database);
    return database.prepare('SELECT * FROM messages WHERE fb_message_id = ?').get(fbMessageId);
  }
  static reconcileBatchWithAnchors(existingRows = [], incomingBatch = [], options = {}) {
    const mode = options.mode || 'page_initial';
    const boundaryEvidence = options.boundary_evidence || null;

    const existingMap = new Map();
    for (const row of existingRows) {
      if (row.fb_message_id) {
        existingMap.set(row.fb_message_id, row);
      }
    }

    if (!existingRows.length) {
      const mergedList = incomingBatch.map((msg, index) => ({
        ...msg,
        sequence_order: index + 1
      }));
      return { status: 'committed', mergedList };
    }

    const existingIndexMap = new Map();
    existingRows.forEach((r, idx) => {
      if (r.fb_message_id) existingIndexMap.set(r.fb_message_id, idx);
    });

    let firstIncomingMatch = -1;
    let firstExistingMatch = -1;
    let lastIncomingMatch = -1;
    let lastExistingMatch = -1;

    for (let i = 0; i < incomingBatch.length; i++) {
      const id = incomingBatch[i].fb_message_id;
      if (id && existingIndexMap.has(id)) {
        if (firstIncomingMatch === -1) {
          firstIncomingMatch = i;
          firstExistingMatch = existingIndexMap.get(id);
        }
        lastIncomingMatch = i;
        lastExistingMatch = existingIndexMap.get(id);
      }
    }

    if (firstIncomingMatch !== -1) {
      // Overlap exists between incoming batch and existing database rows!
      const olderIncoming = incomingBatch.slice(0, firstIncomingMatch);
      const newerIncoming = incomingBatch.slice(lastIncomingMatch + 1);

      const mergedList = [];
      const seenIds = new Set();

      const pushMsg = (m) => {
        if (!m || !m.fb_message_id || seenIds.has(m.fb_message_id)) return;
        seenIds.add(m.fb_message_id);
        mergedList.push(m);
      };

      // Existing rows that are strictly older than the first existing match
      for (let i = 0; i < firstExistingMatch; i++) {
        pushMsg(existingRows[i]);
      }

      // Older incoming items that appeared before the first anchor
      for (const m of olderIncoming) {
        pushMsg(m);
      }

      // Items in the overlapping window: follow the incoming batch's authoritative DOM order!
      const existingOverlapMap = new Map();
      for (let i = firstExistingMatch; i <= lastExistingMatch; i++) {
        if (existingRows[i].fb_message_id) {
          existingOverlapMap.set(existingRows[i].fb_message_id, existingRows[i]);
        }
      }

      for (let i = firstIncomingMatch; i <= lastIncomingMatch; i++) {
        const inc = incomingBatch[i];
        const ex = existingOverlapMap.get(inc.fb_message_id);
        pushMsg(ex ? { ...ex, ...inc } : inc);
      }

      // Also include any existing items in the overlap span that were unmounted/not in incomingBatch (skip stale synthetic likes)
      for (let i = firstExistingMatch; i <= lastExistingMatch; i++) {
        const exRow = existingRows[i];
        if (exRow && exRow.fb_message_id && exRow.fb_message_id.startsWith('page_like_')) {
          continue;
        }
        pushMsg(exRow);
      }

      // Newer incoming items that appeared after the last anchor
      for (const m of newerIncoming) {
        pushMsg(m);
      }

      // Any remaining existing rows after the last match (filter out stale synthetic like messages)
      for (let i = lastExistingMatch + 1; i < existingRows.length; i++) {
        const exRow = existingRows[i];
        if (exRow && exRow.fb_message_id && exRow.fb_message_id.startsWith('page_like_')) {
          continue;
        }
        pushMsg(exRow);
      }

      const isReachedTop = mode === 'page_scroll_older' && olderIncoming.length === 0;

      mergedList.forEach((msg, idx) => {
        msg.sequence_order = idx + 1;
      });

      return {
        status: isReachedTop ? 'reached_top' : 'committed',
        reached_top: isReachedTop,
        mergedList
      };
    }

    if (mode === 'page_scroll_older') {
      if (!boundaryEvidence || !boundaryEvidence.previous_oldest_message_id) {
        return { status: 'retry_required', reason: 'missing_anchor_and_invalid_boundary' };
      }

      const prevOldestId = boundaryEvidence.previous_oldest_message_id;
      const isKnownOldest = existingRows.length > 0 && existingRows[0].fb_message_id === prevOldestId;
      if (!isKnownOldest && !existingMap.has(prevOldestId)) {
        return { status: 'retry_required', reason: 'missing_anchor_and_invalid_boundary' };
      }

      const mergedList = [...incomingBatch, ...existingRows];
      mergedList.forEach((msg, idx) => {
        msg.sequence_order = idx + 1;
      });

      return { status: 'committed', mergedList };
    }

    const mergedMap = new Map();
    for (const row of existingRows) {
      mergedMap.set(row.fb_message_id, { ...row });
    }
    for (const msg of incomingBatch) {
      if (mergedMap.has(msg.fb_message_id)) {
        const prev = mergedMap.get(msg.fb_message_id);
        mergedMap.set(msg.fb_message_id, { ...prev, ...msg });
      } else {
        mergedMap.set(msg.fb_message_id, { ...msg });
      }
    }

    const mergedList = Array.from(mergedMap.values());
    mergedList.sort((a, b) => {
      // Timestamp là tiêu chí chính - bỏ so hash mid.$ (entropy ngẫu nhiên,
      // nguyên nhân đẩy tin hôm nay lên trước tin hôm qua).
      const tsA = Number(a.timestamp_ms || (a.created_at ? new Date(a.created_at).getTime() : 0));
      const tsB = Number(b.timestamp_ms || (b.created_at ? new Date(b.created_at).getTime() : 0));
      if (tsA !== tsB && tsA > 0 && tsB > 0) return tsA - tsB;
      const orderA = Number(a.sequence_order ?? a.dom_order ?? a.id ?? 0);
      const orderB = Number(b.sequence_order ?? b.dom_order ?? b.id ?? 0);
      return orderA - orderB;
    });
    mergedList.forEach((msg, idx) => {
      msg.sequence_order = idx + 1;
    });

    return { status: 'committed', mergedList };
  }

  static processPageBatchEnvelope(envelope, database = getDefaultDb()) {
    cleanExpiredScanIds();
    const { thread_id, session_epoch, generation, scan_id, mode, messages = [] } = envelope;

    // 2026-09-29: strip Business Suite attribution ("Người gửi: <agent>") khỏi
    // nội dung batch page - orphan harvester từng gửi row attr-only hoặc bubble
    // dính đuôi attribution (reproduce: Trịnh Mạnh Nguyen #1443). Defense-in-depth
    // phía server: hoạt động kể cả khi extension chưa reload.
    for (const m of messages) {
      if (m && typeof m.content === 'string' && m.content) {
        m.content = stripBizSentByAttribution(m.content);
      }
    }
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (!m) continue;
      const content = typeof m.content === 'string' ? m.content : '';
      const isOrphan = String(m.fb_message_id || '').startsWith('page_orphan_');
      const notOutgoing = !(m.is_outgoing === 1 || m.is_outgoing === true);
      if (isOrphan && isBizSentByAttributionOnly(content)) {
        messages.splice(i, 1);
        continue;
      }
      // 2026-09-29: thông báo handover AI + nút feedback "Phản hồi tốt/tệ" là
      // UI chrome của Business Suite, không phải tin nhắn (reproduce: Dũng
      // Trần #7264). Drop khi đến từ orphan hoặc phía không-outgoing.
      if ((isKnownPageSystemNotice(content) || isBizFeedbackOnly(content)) && (isOrphan || notOutgoing)) {
        messages.splice(i, 1);
        continue;
      }
      // 2026-09-29: orphan trùng nội dung 1 row có mid.$ thật cùng thread -
      // Business Suite thi thoảng render bubble không mang data-message-id rồi
      // crawl sau lấy lại đầy đủ -> cả hai id đều được lưu (reproduce: Dũng
      // Trần #7264 - "Cổng Nhôm Đúc Trống Đồng..." tồn tại 2 row). Giữ row
      // thật, bỏ orphan.
      if (isOrphan && content && database.prepare(
        "SELECT 1 FROM messages WHERE thread_id = ? AND content = ? AND (fb_message_id IS NULL OR fb_message_id NOT LIKE 'page_orphan_%') LIMIT 1"
      ).get(thread_id, content)) {
        messages.splice(i, 1);
      }
    }

    if (isBlacklistedThreadId(thread_id)) {
      return {
        status: 'rejected',
        reason: 'blacklisted_thread_id',
        thread_id,
        session_epoch,
        generation,
        scan_id
      };
    }

    const currentGen = threadGenerations.get(thread_id);
    if (currentGen && currentGen.session_epoch === session_epoch && generation < currentGen.generation) {
      return {
        status: 'rejected',
        reason: 'stale_generation',
        thread_id,
        session_epoch,
        generation,
        scan_id
      };
    }

    if (scanIdCache.has(scan_id)) {
      return {
        status: 'duplicate',
        thread_id,
        session_epoch,
        generation,
        scan_id
      };
    }

    threadGenerations.set(thread_id, { session_epoch, generation });

    // Before reconciliation, purge stale synthetic page_like_ entries from
    // the DB. These are generated when the extension cannot assign a real
    // mid.$ ID to a Like message. Once the extension is updated (or the
    // next sync provides the real ID), these orphans cause duplicates and
    // push Likes to the bottom of the conversation.
    //
    // 2026-09-28: chỉ purge like NẰM TRONG CỬA SỔ của batch incoming
    // (±60s quanh min/max timestamp batch). Like sâu lịch sử (ngoài viewport
    // batch không quét lại tới) trước đây bị xoá vĩnh viễn mỗi lần ingest
    // -> like biến mất khỏi CRM (reproduce: thread lead-quảng cáo mất 👍
    // đầu hội thoại).
    const incomingTsList = messages.map((m) => Number(m.timestamp_ms || 0)).filter((t) => t > 0);
    if (incomingTsList.length > 0) {
      const windowStart = Math.min(...incomingTsList) - 60000;
      const windowEnd = Math.max(...incomingTsList) + 60000;
      database.prepare(`
        DELETE FROM messages
        WHERE thread_id = ? AND fb_message_id LIKE 'page_like_%'
          AND COALESCE(timestamp_ms, 0) >= ? AND COALESCE(timestamp_ms, 0) <= ?
      `).run(thread_id, windowStart, windowEnd);
    } else {
      database.prepare(
        "DELETE FROM messages WHERE thread_id = ? AND fb_message_id LIKE 'page_like_%'"
      ).run(thread_id);
    }

    const existingRows = database.prepare(`
      SELECT * FROM messages WHERE thread_id = ? ORDER BY sequence_order ASC, id ASC
    `).all(thread_id);

    const reconcileRes = ConversationRepository.reconcileBatchWithAnchors(existingRows, messages, envelope);
    if (reconcileRes.status !== 'committed' && reconcileRes.status !== 'reached_top') {
      return {
        status: reconcileRes.status,
        reason: reconcileRes.reason,
        thread_id,
        session_epoch,
        generation,
        scan_id
      };
    }

    // Ensure thread exists in threads table to prevent FOREIGN KEY constraint failed
    const threadExists = database.prepare('SELECT id FROM threads WHERE id = ?').get(thread_id);
    if (!threadExists) {
      ConversationRepository.upsertThread({
        id: thread_id,
        external_thread_id: envelope.external_thread_id || thread_id,
        account_id: envelope.account_id,
        source_id: envelope.source_id || (envelope.page_id ? `src_page_${envelope.page_id}` : null),
        contact_name: envelope.contact_name || 'Khách hàng',
        last_message: messages.length > 0 ? (messages[messages.length - 1].content || 'Chưa có tin nhắn') : 'Chưa có tin nhắn',
        is_unread: 0,
        inbox_folder: 'INBOX'
      }, database);
    }

    const insertOrUpdate = database.prepare(`
      INSERT INTO messages (
        thread_id, fb_message_id, client_message_id, sender_id, content,
        media_type, media_url, timestamp_ms, timestamp_source, is_outgoing,
        sender_role, sequence_order, direction_status, created_at, sent_by_agent
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(fb_message_id) DO UPDATE SET
        content = CASE
          WHEN excluded.content IS NOT NULL AND (
            excluded.content GLOB '[0-9]:[0-9][0-9] / [0-9]:[0-9][0-9]' OR
            excluded.content GLOB '[0-9][0-9]:[0-9][0-9] / [0-9][0-9]:[0-9][0-9]' OR
            excluded.content GLOB '0:[0-9][0-9]' OR
            excluded.content GLOB '*:?? / *:??*'
          ) THEN ''
          WHEN messages.content IS NOT NULL AND (
            messages.content GLOB '[0-9]:[0-9][0-9] / [0-9]:[0-9][0-9]' OR
            messages.content GLOB '[0-9][0-9]:[0-9][0-9] / [0-9][0-9]:[0-9][0-9]' OR
            messages.content GLOB '0:[0-9][0-9]' OR
            messages.content GLOB '*:?? / *:??*'
          ) THEN COALESCE(excluded.content, '')
          WHEN excluded.content IS NOT NULL AND excluded.content <> ''
            THEN excluded.content
          ELSE messages.content
        END,
        media_type = CASE WHEN excluded.media_type IS NOT NULL AND excluded.media_type <> 'text' THEN excluded.media_type ELSE messages.media_type END,
        media_url = CASE WHEN messages.attachment_id IS NOT NULL AND messages.media_url IS NOT NULL THEN messages.media_url ELSE COALESCE(excluded.media_url, messages.media_url) END,
        timestamp_ms = CASE WHEN ? = 1 THEN excluded.timestamp_ms ELSE messages.timestamp_ms END,
        timestamp_source = CASE WHEN ? = 1 THEN excluded.timestamp_source ELSE messages.timestamp_source END,
        is_outgoing = CASE WHEN excluded.direction_status = 'confirmed' THEN excluded.is_outgoing ELSE messages.is_outgoing END,
        sender_role = CASE WHEN excluded.direction_status = 'confirmed' THEN excluded.sender_role ELSE messages.sender_role END,
        -- Giữ chỗ cũ khi timestamp không được phép upgrade: vị trí của tin đã
        -- biết phải bám theo giờ thật của nó, không bám theo giờ cào của batch
        -- (normalizeMessageSequence sẽ sắp lại theo timestamp sau vòng này).
        sequence_order = CASE WHEN ? = 1 THEN excluded.sequence_order ELSE messages.sequence_order END,
        direction_status = CASE WHEN excluded.direction_status = 'confirmed' THEN 'confirmed' ELSE messages.direction_status END,
        -- 2026-09-29: agent gui tin page (attribution "Nguoi gui: <agent>" trong
        -- BS DOM) la metadata hien thi trong CRM, khong phai noi dung tin nhan.
        sent_by_agent = COALESCE(excluded.sent_by_agent, messages.sent_by_agent)
    `);

    const updateTx = database.transaction((mergedList) => {
      for (const msg of mergedList) {
        const isOutgoing = msg.is_outgoing === true || msg.is_outgoing === 1 ? 1 : 0;
        const directionStatus = (msg.is_outgoing === null || msg.direction_status === 'pending') ? 'pending' : 'confirmed';
        const senderRole = isOutgoing ? 'operator' : 'customer';
        const senderId = msg.sender_id || (isOutgoing ? (msg.account_id || 'SYSTEM') : 'CONTACT');
        const tsMs = Number(msg.timestamp_ms || 0);
        const tsSource = msg.timestamp_source || 'unknown';
        const createdAt = msg.created_at || (tsMs > 0 ? new Date(tsMs).toISOString() : new Date().toISOString());

        const existing = database.prepare('SELECT timestamp_source, timestamp_ms FROM messages WHERE fb_message_id = ?').get(msg.fb_message_id);
        const canUpgrade = !existing || ConversationRepository.shouldUpgradeTimestamp(existing.timestamp_source, tsSource, existing.timestamp_ms, tsMs);

        let content = msg.content || null;
        if (msg.media_type === 'video' && content) {
          // Chỉ lọc duration rác ("0:00 / 0:19") - KHÔNG lọc chữ người dùng gõ
          // kiểu "video"/"ảnh" (caption hợp lệ, bị mất trước đây 2026-09-24).
          if (/^\s*\d{1,2}(?::\d{2}){1,2}\s*\/\s*\d{1,2}(?::\d{2}){1,2}\s*$/i.test(content) ||
              /^\s*\d{1,2}:\d{2}\s*$/i.test(content)) {
            content = null;
          }
        }

        insertOrUpdate.run(
          thread_id,
          msg.fb_message_id,
          msg.client_message_id || null,
          senderId,
          content,
          msg.media_type || 'text',
          msg.media_url || null,
          tsMs,
          tsSource,
          isOutgoing,
          senderRole,
          msg.sequence_order,
          directionStatus,
          createdAt,
          msg.sent_by || null,
          canUpgrade ? 1 : 0,
          canUpgrade ? 1 : 0,
          canUpgrade ? 1 : 0
        );
      }
    });

    updateTx(reconcileRes.mergedList);
    // 2026-09-28: thứ tự DOM trong cửa sổ quét là bằng chứng mới nhất về vị trí
    // hiển thị, nhưng reconcileBatchWithAnchors sort theo timestamp trước (DOM
    // chỉ là tiebreak khi ts bằng nhau) nên các timestamp tổng hợp lệch nhau
    // từng ms khiến thứ tự DOM bị bỏ qua và sai lệch đóng băng qua các lần quét
    // (reproduce: thread #1443 - tin 13:24 nhảy lên đầu, cụm 16:19-16:54 xáo
    // trộn giữa các đợt ingest). Chỉ re-slot các row CÓ fb_message_id khớp
    // trong batch này theo đúng thứ tự DOM; row ngoài cửa sổ giữ nguyên slot -
    // tin đã lưu không bao giờ bị kết quả quét sau đẩy khỏi vị trí.
    ConversationRepository.reconcileObservedDomSequence(thread_id, messages, database);
    ConversationRepository.normalizeMessageSequence(thread_id, database);
    scanIdCache.set(scan_id, Date.now());

    const isReachedTop = Boolean(envelope.reached_top || reconcileRes.reached_top || reconcileRes.status === 'reached_top');
    if (isReachedTop) {
      try {
        database.prepare('UPDATE threads SET history_completed = 1 WHERE id = ?').run(thread_id);
      } catch (_) {}
    }

    return {
      status: 'committed',
      reached_top: isReachedTop,
      thread_id,
      session_epoch,
      generation,
      scan_id,
      persisted_count: messages.length
    };
  }

  static fingerprint(threadId, message) {
    return 'history_' + crypto.createHash('sha256').update(JSON.stringify([
      threadId,
      message.sender_id || message.sender || '',
      message.content || message.text || message.cleaned || '',
      message.timestamp_ms || message.timestamp || 0,
      message.media_url || '',
      message.created_at || ''
    ])).digest('hex').slice(0, 32);
  }
}

module.exports = ConversationRepository;
