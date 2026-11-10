const MessageQueueRepository = require('../repositories/MessageQueueRepository');
const OutboundConfirmationService = require('./OutboundConfirmationService');
const ConversationRepository = require('../repositories/ConversationRepository');

let defaultDb;
function getDefaultDb() {
  if (!defaultDb) defaultDb = require('../database/db');
  return defaultDb;
}

function updateQueueStatusFromClientMessage(clientMessageId, status, errorReason = null, database = getDefaultDb()) {
  if (typeof clientMessageId !== 'string' || !clientMessageId.startsWith('queue_')) return false;
  const queueId = clientMessageId.slice('queue_'.length);
  if (!queueId) return false;
  return MessageQueueRepository.updateStatus(queueId, status, errorReason, database);
}

class OutboundDomCorrelationService {
  static bareSnowflakePart(fbMessageId) {
    if (!fbMessageId) return null;
    const cleaned = String(fbMessageId)
      .replace(/::[^:]+$/, '')
      .replace(/_media$/, '')
      .replace(/__bubble_\d+$/, '')
      .trim();
    const m = cleaned.match(/^(?:\d+@(?:msgr|g\.us)\.)?(\d{15,21})$/);
    return m ? m[1] : null;
  }

  static hasRecentCrmImageOutbound(database, threadId, observedTimestamp = 0) {
    const observed = Number(observedTimestamp) || Date.now();
    return Boolean(database.prepare(`
      SELECT 1 FROM messages
      WHERE thread_id = ? AND is_outgoing = 1
        AND client_message_id IS NOT NULL
        AND media_type = 'image'
        AND ABS(COALESCE(NULLIF(timestamp_ms, 0), ?) - ?) <= 180000
      LIMIT 1
    `).get(threadId, observed, observed));
  }

  static findTemporaryIdUpgrade(database, threadId, message, isMedia = false) {
    if (!message?.fb_message_id) return null;
    const sfTs = ConversationRepository.extractSnowflakeTimestampMs(message.fb_message_id);
    const observedTimestamp = sfTs > 0
      ? sfTs
      : (Number(message.timestamp_ms) || Date.parse(message.created_at || '') || Date.now());
    const bareSf = this.bareSnowflakePart(message.fb_message_id);

    if (bareSf) {
      const exactSfMatch = database.prepare(`
        SELECT id, client_message_id, fb_message_id, timestamp_ms, attachment_id, media_url, media_type
        FROM messages
        WHERE thread_id = ? AND is_outgoing = 1
          AND fb_message_id IS NOT NULL AND fb_message_id != ?
          AND (fb_message_id = ? OR fb_message_id LIKE '%@msgr.' || ?)
        ORDER BY id DESC
        LIMIT 1
      `).get(threadId, message.fb_message_id, bareSf, bareSf);
      if (exactSfMatch) return exactSfMatch;
    }

    if (isMedia) {
      const candidates = database.prepare(`
        SELECT id, client_message_id, fb_message_id, timestamp_ms, created_at, attachment_id, media_url, media_type, delivery_status
        FROM messages
        WHERE thread_id = ? AND is_outgoing = 1 AND delivery_status IN ('sent', 'pending', 'failed')
          AND (client_message_id IS NOT NULL OR attachment_id IS NOT NULL)
          AND fb_message_id IS NOT NULL AND fb_message_id != ?
          AND (
            delivery_status = 'pending'
            OR fb_message_id LIKE 'pending_%'
            OR fb_message_id LIKE 'dom_%'
            OR fb_message_id LIKE '%__bubble_%'
            OR (fb_message_id GLOB '[0-9]*' AND fb_message_id NOT LIKE '%@msgr.%')
          )
          AND (attachment_id IS NOT NULL OR (media_type IS NOT NULL AND media_type != 'text'))
        ORDER BY id DESC
        LIMIT 10
      `).all(threadId, message.fb_message_id);

      for (const row of candidates) {
        const createdMs = Date.parse(row.created_at ? (String(row.created_at).includes('T') ? row.created_at : `${row.created_at}Z`) : '') || 0;
        const refTime = createdMs > 0 ? createdMs : (Number(row.timestamp_ms) || observedTimestamp);
        if (Math.abs(refTime - observedTimestamp) <= 60000) {
          return row;
        }
      }
      return null;
    }

    // Text upgrade: match a CRM text row that still holds a temporary ID
    // ('pending_*' or bare numeric OTID without '@msgr.' or delivery_status='pending')
    // within 90s of the observed message.
    return database.prepare(`
      SELECT id, client_message_id, fb_message_id, timestamp_ms
      FROM messages
      WHERE thread_id = ? AND is_outgoing = 1 AND (delivery_status = 'sent' OR delivery_status = 'pending')
        AND fb_message_id IS NOT NULL AND fb_message_id != ?
        AND (
          fb_message_id LIKE 'pending_%'
          OR delivery_status = 'pending'
          OR (fb_message_id GLOB '[0-9]*' AND fb_message_id NOT LIKE '%@msgr.%')
        )
        AND COALESCE(content, '') = COALESCE(?, '')
        AND attachment_id IS NULL AND (media_type IS NULL OR media_type = 'text')
        AND ABS(COALESCE(NULLIF(timestamp_ms, 0), ?) - ?) <= 90000
      ORDER BY ABS(COALESCE(NULLIF(timestamp_ms, 0), ?) - ?) ASC, id DESC
      LIMIT 1
    `).get(
      threadId,
      message.fb_message_id,
      message.content || '',
      observedTimestamp,
      observedTimestamp,
      observedTimestamp,
      observedTimestamp
    );
  }

  static collapseStoredTemporaryIdUpgrades(database, threadId) {
    const officialRows = database.prepare(`
      SELECT * FROM messages
      WHERE thread_id = ? AND is_outgoing = 1
        AND (fb_message_id LIKE 'mid.%' OR fb_message_id LIKE '%@msgr.%')
        AND fb_message_id NOT LIKE '%__bubble_%'
        AND client_message_id IS NULL
        AND attachment_id IS NULL
        AND latest_attempt_id IS NULL
      ORDER BY id ASC
    `).all(threadId);
    let collapsed = 0;
    for (const official of officialRows) {
      const temporary = this.findTemporaryIdUpgrade(database, threadId, official, this.isMediaConfirmationEvent(official));
      if (!temporary || Number(temporary.id) === Number(official.id)) continue;
      const hasAttemptRef = database.prepare('SELECT 1 FROM outbound_attempts WHERE message_id = ? LIMIT 1').get(official.id);
      if (hasAttemptRef) continue;
      database.prepare('DELETE FROM messages WHERE id = ?').run(official.id);
      const sfTs = ConversationRepository.extractSnowflakeTimestampMs(official.fb_message_id) || Number(official.timestamp_ms) || 0;
      database.prepare(`
        UPDATE OR IGNORE messages SET fb_message_id = ?, delivery_status = 'sent', delivery_error = NULL,
          media_type = COALESCE(?, media_type),
          media_url = CASE WHEN attachment_id IS NOT NULL THEN media_url ELSE COALESCE(?, media_url) END,
          local_media_path = COALESCE(?, local_media_path),
          timestamp_ms = CASE WHEN ? > 0 THEN ? ELSE timestamp_ms END,
          timestamp_source = COALESCE(?, timestamp_source) WHERE id = ?
      `).run(official.fb_message_id, official.media_type, official.media_url, official.local_media_path,
        sfTs, sfTs, sfTs > 0 ? 'facebook_payload' : official.timestamp_source, temporary.id);
      collapsed += 1;
    }
    return collapsed;
  }

  static mediaParentMessageId(fbMessageId) {
    const value = String(fbMessageId || '');
    return value.endsWith('_media') ? value.slice(0, -'_media'.length) : null;
  }

  static mergeMediaCompanion(database, threadId, message, isOutgoing) {
    const parentFbMessageId = this.mediaParentMessageId(message?.fb_message_id);
    if (!parentFbMessageId) return null;
    const parent = database.prepare(`
      SELECT * FROM messages
      WHERE thread_id = ? AND fb_message_id = ?
      LIMIT 1
    `).get(threadId, parentFbMessageId);
    const mergedIsOutgoing = (isOutgoing || Number(parent?.is_outgoing) === 1) ? 1 : 0;

    if (isOutgoing) {
      if (parent && (parent.attachment_id || parent.client_message_id)) {
        database.prepare(`UPDATE messages SET media_type = ?,
          media_url = CASE WHEN attachment_id IS NOT NULL THEN media_url ELSE COALESCE(?, media_url) END,
          local_media_path = COALESCE(local_media_path, ?)
          WHERE id = ?`).run(message.media_type || 'image', message.media_url || null,
            message.local_media_path || null, parent.id);
        return database.prepare('SELECT * FROM messages WHERE id = ?').get(parent.id);
      }
      const temporary = this.findTemporaryIdUpgrade(database, threadId, {
        ...message, fb_message_id: parentFbMessageId
      }, true);
      if (temporary) {
        if (parent && parent.id !== temporary.id) database.prepare('DELETE FROM messages WHERE id = ?').run(parent.id);
        database.prepare(`
          UPDATE messages SET fb_message_id = ?, media_type = ?,
            media_url = CASE WHEN attachment_id IS NOT NULL THEN media_url ELSE COALESCE(?, media_url) END,
            local_media_path = COALESCE(local_media_path, ?),
            timestamp_ms = timestamp_ms,
            timestamp_source = timestamp_source,
            sequence_order = sequence_order,
            content = CASE
              WHEN TRIM(COALESCE(content, '')) GLOB '[0-9]*'
               AND LENGTH(TRIM(COALESCE(content, ''))) <= 2
               AND CAST(TRIM(content) AS INTEGER) = CAST((? / 60000) AS INTEGER) % 60
              THEN '' ELSE content END
          WHERE id = ?
        `).run(parentFbMessageId, message.media_type || 'image', message.media_url || null,
          message.local_media_path || null,
          Number(message.timestamp_ms) || 0, temporary.id);
        return database.prepare('SELECT * FROM messages WHERE id = ?').get(temporary.id);
      }
    }
    if (!parent) return null;
    database.prepare(`
      UPDATE messages SET
        media_type = CASE WHEN ? IS NOT NULL AND ? != 'text' THEN ? ELSE media_type END,
        media_url = CASE WHEN attachment_id IS NOT NULL THEN media_url ELSE COALESCE(?, media_url) END,
        local_media_path = COALESCE(?, local_media_path),
        timestamp_ms = CASE WHEN ? > 0 THEN ? ELSE timestamp_ms END,
        timestamp_source = COALESCE(?, timestamp_source),
        sequence_order = COALESCE(?, sequence_order),
        is_outgoing = ?,
        sender_id = CASE WHEN ? = 1 THEN COALESCE(sender_id, 'current_user') ELSE sender_id END,
        sender_role = CASE WHEN ? = 1 THEN 'operator' ELSE sender_role END,
        direction_status = CASE WHEN ? = 1 THEN 'confirmed' ELSE direction_status END,
        content = CASE
          WHEN TRIM(COALESCE(content, '')) GLOB '[0-9]*'
           AND LENGTH(TRIM(COALESCE(content, ''))) <= 2
           AND CAST(TRIM(content) AS INTEGER) = CAST((? / 60000) AS INTEGER) % 60
          THEN '' ELSE content END
      WHERE id = ?
    `).run(message.media_type || null, message.media_type || null, message.media_type || null,
      message.media_url || null, message.local_media_path || null,
      Number(message.timestamp_ms) || 0, Number(message.timestamp_ms) || 0, message.timestamp_source || null,
      Number.isFinite(Number(message.sequence_order)) ? Number(message.sequence_order) : null,
      mergedIsOutgoing,
      mergedIsOutgoing, mergedIsOutgoing, mergedIsOutgoing,
      Number(message.timestamp_ms) || 0, parent.id);
    return database.prepare('SELECT * FROM messages WHERE id = ?').get(parent.id);
  }

  static collapseStoredMediaCompanions(database, threadId) {
    const companions = database.prepare(`
      SELECT media.id AS media_id, media.media_type, media.media_url, media.local_media_path
      FROM messages media
      WHERE media.thread_id = ? AND media.fb_message_id LIKE '%_media'
        AND media.client_message_id IS NULL
        AND media.attachment_id IS NULL
        AND media.latest_attempt_id IS NULL
    `).all(threadId);
    for (const row of companions) {
      const media = database.prepare('SELECT * FROM messages WHERE id = ?').get(row.media_id);
      const merged = this.mergeMediaCompanion(database, threadId, media, Boolean(media.is_outgoing));
      if (merged && Number(merged.id) !== Number(row.media_id)) {
        database.prepare('DELETE FROM messages WHERE id = ?').run(row.media_id);
      }
    }
    return companions.length;
  }

  static isMediaConfirmationEvent(m) {
    return !!(m?.media_url || (m?.media_type && m.media_type !== 'text'));
  }

  static matchPendingOutboundByRawContent(database, threadId, rawContent) {
    if (!rawContent) return null;
    const windowSeconds = Math.round(OutboundConfirmationService.DEFAULT_CONFIRMATION_WINDOW_MS / 1000);
    const candidate = database.prepare(`
      SELECT outbound.id, outbound.client_message_id, outbound.content FROM messages outbound
      LEFT JOIN outbound_attempts attempt ON outbound.latest_attempt_id = attempt.id
      LEFT JOIN message_queue queued ON (
        outbound.client_message_id = 'queue_' || queued.id
        OR attempt.id = queued.outbound_attempt_id
      )
      WHERE outbound.thread_id = ? AND outbound.is_outgoing = 1
        AND (
          outbound.delivery_status = 'pending'
          OR outbound.fb_message_id LIKE 'pending_%'
          OR (outbound.fb_message_id GLOB '[0-9]*' AND outbound.fb_message_id NOT LIKE '%@msgr.%')
        )
        AND datetime(outbound.created_at) >= datetime('now', '-' || ? || ' seconds')
        AND (queued.id IS NULL OR (queued.attachment_id IS NULL AND queued.manifest_id IS NULL))
        AND outbound.attachment_id IS NULL AND (outbound.media_type IS NULL OR outbound.media_type = 'text')
      ORDER BY outbound.id ASC LIMIT 1
    `).get(threadId, windowSeconds);
    if (!candidate) return null;
    const pendingContent = String(candidate.content || '').trim();
    if (!pendingContent) return null;
    if (rawContent === pendingContent || rawContent.includes(pendingContent) || pendingContent.includes(rawContent)) {
      return candidate;
    }
    return null;
  }

  static matchPendingImageOutbound(database, threadId, mediaType = 'any', observedTsMs = 0, fbMessageId = null) {
    const windowSeconds = Math.round(OutboundConfirmationService.DEFAULT_CONFIRMATION_WINDOW_MS / 1000);
    const sfTs = ConversationRepository.extractSnowflakeTimestampMs(fbMessageId);

    if (fbMessageId && /__bubble_\d+$/.test(String(fbMessageId))) {
      const baseFamilyId = String(fbMessageId).replace(/__bubble_\d+$/, '');
      const existingBase = database.prepare(
        'SELECT media_type, timestamp_ms, created_at FROM messages WHERE thread_id = ? AND fb_message_id = ? LIMIT 1'
      ).get(threadId, baseFamilyId);
      if (existingBase && (!existingBase.media_type || existingBase.media_type === 'text')) {
        return null;
      }
    }

    const normalizedMediaType = ['image', 'video', 'file'].includes(String(mediaType || '').toLowerCase())
      ? String(mediaType).toLowerCase()
      : 'any';
    const mediaTypeClause = normalizedMediaType === 'any'
      ? ''
      : "AND LOWER(COALESCE(oa.media_type, queued.attachment_media_type, outbound.media_type, '')) = ?";
    const params = normalizedMediaType === 'any'
      ? [threadId, windowSeconds]
      : [threadId, windowSeconds, normalizedMediaType];

    const candidates = database.prepare(`
      SELECT outbound.id, outbound.client_message_id, outbound.thread_id, outbound.attachment_id, outbound.media_type, outbound.created_at, outbound.timestamp_ms
      FROM messages outbound
      LEFT JOIN outbound_attempts attempt ON outbound.latest_attempt_id = attempt.id
      LEFT JOIN message_queue queued ON (
        outbound.client_message_id = 'queue_' || queued.id
        OR attempt.id = queued.outbound_attempt_id
      )
      LEFT JOIN outbound_attachments oa ON oa.id = COALESCE(outbound.attachment_id, queued.attachment_id)
      WHERE outbound.thread_id = ? AND outbound.is_outgoing = 1
        AND outbound.delivery_status = 'pending'
        AND (
          outbound.attachment_id IS NOT NULL
          OR (outbound.media_type IS NOT NULL AND outbound.media_type != 'text')
          OR queued.attachment_id IS NOT NULL
          OR queued.manifest_id IS NOT NULL
        )
        AND datetime(outbound.created_at) >= datetime('now', '-' || ? || ' seconds')
        ${mediaTypeClause}
      ORDER BY outbound.id ASC
    `).all(...params);

    for (const candidate of candidates) {
      const createdMs = Date.parse(candidate.created_at ? (String(candidate.created_at).includes('T') ? candidate.created_at : `${candidate.created_at}Z`) : '') || Number(candidate.timestamp_ms) || 0;
      if (sfTs > 0 && createdMs > 0 && sfTs < createdMs - 15000) {
        continue;
      }
      return candidate;
    }
    return null;
  }

  static confirmPendingOutbound(database, ioServer, pendingRow, { fbMessageId, tsMs = 0, tsSource = 'unknown', rawMessage }) {
    const confirmedId = fbMessageId || `dom_${pendingRow.client_message_id}`;
    if (fbMessageId) {
      const ownAttempt = database.prepare('SELECT latest_attempt_id FROM messages WHERE id = ?').get(pendingRow.id);
      const recycled = database.prepare(
        'SELECT id FROM outbound_attempts WHERE confirmation_message_id = ?'
      ).get(fbMessageId);
      if (recycled && recycled.id !== ownAttempt?.latest_attempt_id) {
        console.log(`[WS] Confirmation id ${fbMessageId} was already consumed by attempt ${recycled.id}; stale echo skipped.`);
        return false;
      }
    }
    const existingConfirmed = database.prepare(
      'SELECT id, thread_id, is_outgoing, media_type, media_url, attachment_id, timestamp_ms FROM messages WHERE fb_message_id = ?'
    ).get(confirmedId);
    if (existingConfirmed) {
      if (existingConfirmed.id === pendingRow.id) {
        return false;
      }
      if (existingConfirmed.is_outgoing === 0) {
        console.log(`[WS] Removing duplicate misidentified incoming row ${existingConfirmed.id} in favor of pending outbound row ${pendingRow.id}`);
        database.prepare('DELETE FROM messages WHERE id = ?').run(existingConfirmed.id);
      } else if (
        (pendingRow.attachment_id || (pendingRow.media_type && pendingRow.media_type !== 'text')) &&
        (existingConfirmed.media_url || (existingConfirmed.media_type && existingConfirmed.media_type !== 'text')) &&
        String(existingConfirmed.thread_id) === String(pendingRow.thread_id || rawMessage?.thread_id)
      ) {
        database.prepare('DELETE FROM messages WHERE id = ?').run(existingConfirmed.id);
      } else {
        console.log(`[WS] Confirmed ID ${confirmedId} already belongs to outgoing row ${existingConfirmed.id}; pending match skipped.`);
        return false;
      }
    }
    const sfTs = ConversationRepository.extractSnowflakeTimestampMs(confirmedId);
    const effectiveTsMs = sfTs > 0 ? sfTs : tsMs;
    database.prepare(`
      UPDATE messages SET fb_message_id = ?, delivery_status = 'sent', delivery_error = NULL,
        timestamp_ms = CASE WHEN ? > 0 THEN ? WHEN timestamp_ms > 0 THEN timestamp_ms WHEN ? > 0 THEN ? ELSE timestamp_ms END,
        timestamp_source = CASE WHEN ? > 0 THEN 'facebook_payload' WHEN timestamp_ms > 0 THEN timestamp_source WHEN ? <> 'unknown' THEN ? ELSE timestamp_source END
      WHERE id = ?
    `).run(confirmedId, sfTs, sfTs, effectiveTsMs, effectiveTsMs, sfTs, tsSource, tsSource, pendingRow.id);

    const updatedMsg = database.prepare('SELECT * FROM messages WHERE id = ?').get(pendingRow.id);
    const OutboundAttemptRepository = require('../repositories/OutboundAttemptRepository');
    if (updatedMsg && updatedMsg.latest_attempt_id) {
      OutboundAttemptRepository.transition(
        updatedMsg.latest_attempt_id,
        ['queued', 'dispatching', 'awaiting_confirmation'],
        'sent',
        {
          confirmed_at: new Date(effectiveTsMs || Date.now()).toISOString(),
          confirmation_message_id: confirmedId,
          confirmation_source: (tsSource === 'page_dom_observer' || tsSource === 'page_dom') ? 'page_dom' : 'personal_dom'
        },
        database
      );
      const attempt = OutboundAttemptRepository.getById(updatedMsg.latest_attempt_id, database);
      if (attempt && attempt.queue_id) {
        MessageQueueRepository.updateStatus(attempt.queue_id, 'sent', null, database);
      }
    }
    updateQueueStatusFromClientMessage(pendingRow.client_message_id, 'sent', null, database);

    if (ioServer) {
      const targetThreadId = pendingRow.thread_id || rawMessage?.thread_id;
      const resolvedMediaUrl = updatedMsg?.attachment_id
        ? (updatedMsg.media_url || `/api/outbound-attachments/${encodeURIComponent(updatedMsg.attachment_id)}/file`)
        : (updatedMsg?.media_url || rawMessage?.media_url || null);
      ioServer.emit('MESSAGE_SENT', { thread_id: targetThreadId, client_message_id: pendingRow.client_message_id, fb_message_id: confirmedId, status: 'sent' });
      ioServer.emit('MESSAGE_SEND_STATUS', {
        thread_id: targetThreadId,
        client_message_id: pendingRow.client_message_id,
        message_id: pendingRow.id,
        status: 'sent',
        fb_message_id: confirmedId
      });
      ioServer.emit('NEW_MESSAGE', {
        ...rawMessage,
        ...updatedMsg,
        media_url: resolvedMediaUrl,
        client_message_id: pendingRow.client_message_id,
        fb_message_id: confirmedId,
        delivery_status: 'sent',
        status: 'sent',
        is_outgoing: true,
        timestamp_ms: effectiveTsMs || updatedMsg?.timestamp_ms,
        timestamp_source: (sfTs > 0 ? 'facebook_payload' : tsSource) || updatedMsg?.timestamp_source,
        created_at: rawMessage?.created_at || updatedMsg?.created_at || new Date().toISOString()
      });
    }
    console.log(`[WS] Đã ghép DOM confirmation vào pending outbound ${pendingRow.client_message_id}`);
    return true;
  }
}

module.exports = OutboundDomCorrelationService;
