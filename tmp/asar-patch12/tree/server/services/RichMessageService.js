const crypto = require('crypto');
const MessageQueueRepository = require('../repositories/MessageQueueRepository');
const OutboundAttachmentRepository = require('../repositories/OutboundAttachmentRepository');
const OutboundAttemptRepository = require('../repositories/OutboundAttemptRepository');
const RichMessageCapabilityService = require('./RichMessageCapabilityService');

class RichMessageError extends Error {
  constructor(code, message, httpStatus = 400) {
    super(message);
    this.name = 'RichMessageError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

class RichMessageService {
  static firstAttemptKey(threadId, clientMessageId) {
    return 'rich:' + threadId + ':' + clientMessageId;
  }

  static acceptedFromAttempt(attempt, database) {
    if (!attempt) return null;
    const message = database.prepare('SELECT * FROM messages WHERE id = ?').get(attempt.message_id);
    if (!message) return null;
    const attachment = attempt.attachment_id
      ? OutboundAttachmentRepository.getById(attempt.attachment_id, database)
      : null;
    return {
      thread_id: message.thread_id,
      client_message_id: message.client_message_id,
      message_id: message.id,
      attempt_id: attempt.id,
      queue_id: attempt.queue_id,
      status: attempt.status,
      attachment: attachment ? {
        id: attachment.id,
        media_type: attachment.media_type,
        mime_type: attachment.mime_type,
        name: attachment.safe_name,
        byte_size: attachment.byte_size
      } : null
    };
  }

  static assertContent(content, attachmentId) {
    const text = typeof content === 'string' ? content : '';
    if (!text.trim() && !attachmentId) {
      throw new RichMessageError('MESSAGE_EMPTY', 'Tin nhắn hoặc file đính kèm là bắt buộc.');
    }
    return text;
  }

  static assertCapabilityForAttachment(capability, attachment) {
    if (!attachment) return;
    const allowed = RichMessageCapabilityService.allowedMimeTypes(capability);
    if (!allowed.includes(attachment.mime_type)) {
      throw new RichMessageError(
        'ATTACHMENT_UNSUPPORTED',
        'Loại file này chưa được bật cho nguồn gửi đã chọn.',
        400
      );
    }
  }

  static submit({
    threadId,
    clientMessageId,
    content = '',
    attachmentId = null
  }, {
    database = require('../database/db'),
    capabilityOptions = {}
  } = {}) {
    if (!threadId) throw new RichMessageError('THREAD_REQUIRED', 'Thiếu hội thoại đích.');
    if (!clientMessageId || typeof clientMessageId !== 'string') {
      throw new RichMessageError('CLIENT_MESSAGE_ID_REQUIRED', 'Thiếu mã tin nhắn phía CRM.');
    }
    const text = this.assertContent(content, attachmentId);
    const idempotencyKey = this.firstAttemptKey(threadId, clientMessageId);
    const repeated = OutboundAttemptRepository.getByIdempotencyKey(idempotencyKey, database);
    if (repeated) return this.acceptedFromAttempt(repeated, database);

    const capability = RichMessageCapabilityService.getForThread(threadId, {
      ...capabilityOptions,
      database
    });
    if (!capability.text.enabled) {
      throw new RichMessageError(
        capability.connected ? 'RICH_MESSAGE_FEATURE_DISABLED' : 'SOURCE_DISCONNECTED',
        capability.disabled_reason || 'Nguồn gửi chưa sẵn sàng.',
        capability.connected ? 409 : 409
      );
    }

    const transaction = database.transaction(() => {
      const duplicate = OutboundAttemptRepository.getByIdempotencyKey(idempotencyKey, database);
      if (duplicate) return this.acceptedFromAttempt(duplicate, database);

      let attachment = null;
      if (attachmentId) {
        attachment = OutboundAttachmentRepository.getById(attachmentId, database);
        if (!attachment) {
          throw new RichMessageError('ATTACHMENT_NOT_FOUND', 'Không tìm thấy file đính kèm.', 404);
        }
        if (attachment.thread_id !== threadId) {
          throw new RichMessageError('ATTACHMENT_WRONG_THREAD', 'File đính kèm thuộc hội thoại khác.', 409);
        }
        if (attachment.status !== 'staged' || attachment.consumed_by_message_id != null) {
          throw new RichMessageError('ATTACHMENT_NOT_STAGED', 'File đính kèm đã được sử dụng hoặc hết hạn.', 409);
        }
        this.assertCapabilityForAttachment(capability, attachment);
      }

      const pendingFbId = 'pending_' + clientMessageId;
      const mediaType = attachment ? attachment.media_type : 'text';
      // Without an explicit timestamp_ms, this column defaults to 0 (schema.sql)
      // and every history query orders by timestamp_ms ASC first - a 0 sorts
      // ahead of every real historical message, regardless of when this row was
      // actually created. The legacy plain-text send path has the same gap at
      // insert time but self-corrects once its DOM confirmation match fires
      // (server.js ~line 609); rich messages have no equivalent correction yet
      // (OutboundConfirmationService.confirmObservation doesn't touch
      // timestamp_ms either), so the submit-time value here is what actually
      // determines this row's position, not just a placeholder.
      const submittedAtMs = Date.now();
      const insert = database.prepare(
        'INSERT INTO messages ' +
        '(thread_id, fb_message_id, client_message_id, sender_id, content, media_type, media_url, local_media_path, ' +
        'attachment_id, media_name, media_mime_type, media_size, is_outgoing, delivery_status, timestamp_ms, timestamp_source) ' +
        "VALUES (?, ?, ?, 'SYSTEM', ?, ?, ?, ?, ?, ?, ?, ?, 1, 'pending', ?, 'client_submit')"
      ).run(
        threadId,
        pendingFbId,
        clientMessageId,
        text,
        mediaType,
        attachment ? '/api/outbound-attachments/' + attachment.id + '/content' : null,
        // Never persist the server's absolute filesystem path here: this column
        // doubles as a browser-servable override for inbound-media caching, and
        // the client renders it ahead of media_url (MediaViewer.jsx). The real,
        // authenticated access URL is signed fresh per read in server.js.
        null,
        attachment ? attachment.id : null,
        attachment ? attachment.safe_name : null,
        attachment ? attachment.mime_type : null,
        attachment ? attachment.byte_size : null,
        submittedAtMs
      );
      const messageId = Number(insert.lastInsertRowid);

      if (attachment && !OutboundAttachmentRepository.bindToMessage(attachment.id, messageId, database)) {
        throw new RichMessageError('ATTACHMENT_STATE_CONFLICT', 'File đính kèm vừa được sử dụng bởi yêu cầu khác.', 409);
      }

      const attempt = OutboundAttemptRepository.create({
        id: crypto.randomUUID(),
        message_id: messageId,
        attachment_id: attachment ? attachment.id : null,
        source_id: capability.source_id,
        source_type: capability.source_type,
        account_id: capability.account_id,
        page_id: capability.page_id,
        attempt_number: 1,
        idempotency_key: idempotencyKey
      }, database);

      const queueId = MessageQueueRepository.insertRichMessage({
        thread_id: threadId,
        account_id: capability.account_id,
        source_id: capability.source_id,
        source_type: capability.source_type,
        page_id: capability.page_id,
        content: text,
        attachment_id: attachment ? attachment.id : null,
        attachment_path: attachment ? attachment.storage_path : null,
        attachment_mime_type: attachment ? attachment.mime_type : null,
        attachment_name: attachment ? attachment.safe_name : null,
        outbound_attempt_id: attempt.id,
        attachment_media_type: attachment ? attachment.media_type : null,
        attachment_byte_size: attachment ? attachment.byte_size : null,
        attachment_checksum: attachment ? attachment.checksum_sha256 : null
      }, database);

      if (!OutboundAttemptRepository.linkQueue(attempt.id, queueId, database)) {
        throw new RichMessageError('ATTEMPT_QUEUE_CONFLICT', 'Không thể liên kết hàng đợi gửi.', 409);
      }
      database.prepare(
        'UPDATE messages SET latest_attempt_id = ? WHERE id = ?'
      ).run(attempt.id, messageId);
      const preview = text || (attachment?.media_type === 'image' ? '[Hình ảnh]' : '[Tệp đính kèm]');
      database.prepare(
        'UPDATE threads SET last_message = ?, last_activity = CURRENT_TIMESTAMP WHERE id = ?'
      ).run(preview, threadId);

      return this.acceptedFromAttempt(
        OutboundAttemptRepository.getById(attempt.id, database),
        database
      );
    });

    return transaction();
  }

  static retry({
    threadId,
    messageId,
    expectedLatestAttemptId
  }, {
    database = require('../database/db'),
    capabilityOptions = {}
  } = {}) {
    const retryKey = 'rich-retry:' + messageId + ':' + expectedLatestAttemptId;
    const duplicate = OutboundAttemptRepository.getByIdempotencyKey(retryKey, database);
    if (duplicate) return this.acceptedFromAttempt(duplicate, database);

    const message = database.prepare(
      'SELECT * FROM messages WHERE id = ? AND thread_id = ? AND is_outgoing = 1'
    ).get(messageId, threadId);
    if (!message) throw new RichMessageError('MESSAGE_NOT_FOUND', 'Không tìm thấy tin nhắn cần gửi lại.', 404);
    const latest = OutboundAttemptRepository.getLatestForMessage(message.id, database);
    if (!latest || latest.id !== expectedLatestAttemptId) {
      throw new RichMessageError('ATTEMPT_CHANGED', 'Trạng thái gửi đã thay đổi, vui lòng tải lại.', 409);
    }
    if (['queued', 'dispatching', 'awaiting_confirmation'].includes(latest.status)) {
      throw new RichMessageError('ATTEMPT_ACTIVE', 'Tin nhắn vẫn đang được xử lý.', 409);
    }
    if (latest.status === 'uncertain') {
      throw new RichMessageError('RECONCILIATION_REQUIRED', 'Cần đối soát trước khi gửi lại.', 409);
    }

    const capability = RichMessageCapabilityService.getForThread(threadId, {
      ...capabilityOptions,
      database
    });
    if (!capability.text.enabled) {
      throw new RichMessageError('SOURCE_DISCONNECTED', capability.disabled_reason || 'Nguồn gửi chưa sẵn sàng.', 409);
    }

    const transaction = database.transaction(() => {
      const repeated = OutboundAttemptRepository.getByIdempotencyKey(retryKey, database);
      if (repeated) return this.acceptedFromAttempt(repeated, database);
      const attachment = latest.attachment_id
        ? OutboundAttachmentRepository.getById(latest.attachment_id, database)
        : null;
      this.assertCapabilityForAttachment(capability, attachment);
      const attempt = OutboundAttemptRepository.create({
        id: crypto.randomUUID(),
        message_id: message.id,
        attachment_id: attachment?.id || null,
        source_id: capability.source_id,
        source_type: capability.source_type,
        account_id: capability.account_id,
        page_id: capability.page_id,
        attempt_number: OutboundAttemptRepository.nextAttemptNumber(message.id, database),
        idempotency_key: retryKey
      }, database);
      const queueId = MessageQueueRepository.insertRichMessage({
        thread_id: threadId,
        account_id: capability.account_id,
        source_id: capability.source_id,
        source_type: capability.source_type,
        page_id: capability.page_id,
        content: message.content || '',
        attachment_id: attachment?.id || null,
        attachment_path: attachment?.storage_path || null,
        attachment_mime_type: attachment?.mime_type || null,
        attachment_name: attachment?.safe_name || null,
        outbound_attempt_id: attempt.id,
        attachment_media_type: attachment?.media_type || null,
        attachment_byte_size: attachment?.byte_size || null,
        attachment_checksum: attachment?.checksum_sha256 || null
      }, database);
      OutboundAttemptRepository.linkQueue(attempt.id, queueId, database);
      if (attachment) {
        OutboundAttachmentRepository.transition(
          attachment.id,
          ['failed', 'queued', 'sending'],
          'queued',
          {},
          database
        );
      }
      database.prepare(
        "UPDATE messages SET latest_attempt_id = ?, delivery_status = 'pending', delivery_error = NULL WHERE id = ?"
      ).run(attempt.id, message.id);
      return this.acceptedFromAttempt(
        OutboundAttemptRepository.getById(attempt.id, database),
        database
      );
    });
    return transaction();
  }
}

RichMessageService.Error = RichMessageError;
module.exports = RichMessageService;
