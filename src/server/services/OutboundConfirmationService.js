const MessageQueueRepository = require('../repositories/MessageQueueRepository');
const OutboundAttachmentRepository = require('../repositories/OutboundAttachmentRepository');
const OutboundAttemptRepository = require('../repositories/OutboundAttemptRepository');
const ConversationRepository = require('../repositories/ConversationRepository');

const DEFAULT_CONFIRMATION_WINDOW_MS = 2 * 60 * 1000;

class OutboundConfirmationService {
  static confirmObservation({
    threadId,
    fbMessageId,
    isOutgoing,
    mediaType = 'text',
    content = '',
    observedAt = Date.now(),
    confirmationSource
  }, {
    database = require('../database/db'),
    windowMs = DEFAULT_CONFIRMATION_WINDOW_MS
  } = {}) {
    if (
      !threadId ||
      !fbMessageId ||
      String(fbMessageId).startsWith('pending_') ||
      isOutgoing !== true
    ) return { matched: false, reason: 'INVALID_OBSERVATION' };

    const sfTs = ConversationRepository.extractSnowflakeTimestampMs(fbMessageId);
    const observedTime = sfTs > 0 ? sfTs : (Number(observedAt) || Date.now());
    const rows = database.prepare(
      "SELECT a.*, m.thread_id, m.client_message_id, m.content, m.media_type AS message_media_type, " +
      'm.delivery_status, oa.media_type AS attachment_media_type ' +
      'FROM outbound_attempts a JOIN messages m ON m.id = a.message_id ' +
      'LEFT JOIN outbound_attachments oa ON oa.id = a.attachment_id ' +
      "WHERE m.thread_id = ? AND m.is_outgoing = 1 AND m.delivery_status = 'pending' " +
      "AND a.status IN ('queued', 'dispatching', 'awaiting_confirmation')"
    ).all(threadId);

    const candidates = rows.filter((row) => {
      const dispatchTime = Date.parse(row.dispatched_at || row.created_at);
      if (!Number.isFinite(dispatchTime) || Math.abs(observedTime - dispatchTime) > windowMs) {
        return false;
      }
      if (sfTs > 0 && sfTs < dispatchTime - 15000) {
        return false;
      }
      const expectedMediaType = String(
        row.attachment_id
          ? (row.attachment_media_type || row.message_media_type || 'image')
          : (row.message_media_type || 'text')
      ).toLowerCase();
      const observedMediaType = String(mediaType || 'text').toLowerCase();
      const expectsMedia = Boolean(row.attachment_id) || (expectedMediaType !== '' && expectedMediaType !== 'text');
      const observedIsMedia = observedMediaType !== '' && observedMediaType !== 'text';
      if (expectsMedia !== observedIsMedia) return false;
      if (expectsMedia && expectedMediaType !== observedMediaType) return false;

      if (/__bubble_\d+$/.test(String(fbMessageId))) {
        const baseFamilyId = String(fbMessageId).replace(/__bubble_\d+$/, '');
        const existingBase = database.prepare(
          'SELECT timestamp_ms, created_at, media_type FROM messages WHERE thread_id = ? AND fb_message_id = ? AND id <> ? LIMIT 1'
        ).get(threadId, baseFamilyId, row.message_id);
        if (existingBase) {
          const baseTs = Number(existingBase.timestamp_ms) || Date.parse(existingBase.created_at || '') || 0;
          if (baseTs > 0 && baseTs < dispatchTime - 15000) return false;
          if (expectsMedia && (!existingBase.media_type || existingBase.media_type === 'text')) return false;
        }
      }

      const expectedText = String(row.content || '').trim();
      const observedText = String(content || '').trim();
      if (expectedText && observedText && expectedText !== observedText) return false;
      // A Facebook message id belongs to exactly one send. If it already
      // confirmed a different attempt, this observation is a stale DOM or
      // history echo of an older bubble in the same thread (live evidence:
      // one mid.$..._media id "confirmed" two video sends 49 minutes apart),
      // not proof for this candidate.
      const recycled = database.prepare(
        'SELECT id FROM outbound_attempts WHERE confirmation_message_id = ? AND id <> ?'
      ).get(fbMessageId, row.id);
      if (recycled) return false;
      return true;
    });

    if (candidates.length !== 1) {
      if (candidates.length > 1) {
        candidates.forEach((candidate) => {
          OutboundAttemptRepository.transition(
            candidate.id,
            ['dispatching', 'awaiting_confirmation'],
            'uncertain',
            {
              error_code: 'CONFIRMATION_AMBIGUOUS',
              error_message: 'Nhiều attempt cùng khớp một Facebook observation.'
            },
            database
          );
        });
      }
      return {
        matched: false,
        reason: candidates.length > 1 ? 'AMBIGUOUS' : 'NO_CANDIDATE'
      };
    }

    const candidate = candidates[0];
    const transaction = database.transaction(() => {
      const conflictingMessage = database.prepare(
        'SELECT id, thread_id, is_outgoing, media_type, media_url, content FROM messages WHERE fb_message_id = ? AND id <> ?'
      ).get(fbMessageId, candidate.message_id);
      if (conflictingMessage) {
        const candidateMediaType = candidate.attachment_id
          ? candidate.attachment_media_type
          : candidate.message_media_type;
        const isSameMediaEcho = conflictingMessage.is_outgoing === 1
          && String(conflictingMessage.thread_id) === String(candidate.thread_id)
          && (
            (mediaType !== 'text'
              && String(conflictingMessage.media_type || '') === String(mediaType)
              && String(candidateMediaType || '') === String(mediaType))
            || (
              String(conflictingMessage.content || '').trim() !== ''
              && String(conflictingMessage.content || '').trim() === String(candidate.content || '').trim()
            )
          );
        if (isSameMediaEcho) {
          database.prepare('DELETE FROM messages WHERE id = ?').run(conflictingMessage.id);
        } else {
          OutboundAttemptRepository.transition(
            candidate.id,
            ['dispatching', 'awaiting_confirmation'],
            'uncertain',
            {
              error_code: 'CONFIRMATION_ID_CONFLICT',
              error_message: 'Facebook message id already belongs to another row.'
            },
            database
          );
          return { matched: false, reason: 'ID_CONFLICT' };
        }
      }

      database.prepare(
        "UPDATE messages SET fb_message_id = ?, delivery_status = 'sent', delivery_error = NULL " +
        'WHERE id = ? AND delivery_status = ?'
      ).run(fbMessageId, candidate.message_id, 'pending');
      OutboundAttemptRepository.transition(
        candidate.id,
        ['dispatching', 'awaiting_confirmation'],
        'sent',
        {
          confirmed_at: new Date(observedTime).toISOString(),
          confirmation_message_id: fbMessageId,
          confirmation_source: confirmationSource
        },
        database
      );
      if (candidate.queue_id) {
        MessageQueueRepository.updateStatus(candidate.queue_id, 'sent', null, database);
      }
      if (candidate.attachment_id) {
        OutboundAttachmentRepository.transition(
          candidate.attachment_id,
          ['queued', 'sending'],
          'sent',
          {},
          database
        );
      }
      return {
        matched: true,
        message_id: candidate.message_id,
        attempt_id: candidate.id,
        queue_id: candidate.queue_id,
        client_message_id: candidate.client_message_id,
        fb_message_id: fbMessageId,
        confirmation_source: confirmationSource
      };
    });
    return transaction();
  }
}

OutboundConfirmationService.DEFAULT_CONFIRMATION_WINDOW_MS = DEFAULT_CONFIRMATION_WINDOW_MS;
module.exports = OutboundConfirmationService;
