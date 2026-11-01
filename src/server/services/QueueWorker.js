const fs = require('fs');
const MessageQueueRepository = require('../repositories/MessageQueueRepository');
const OutboundAttachmentRepository = require('../repositories/OutboundAttachmentRepository');
const OutboundAttemptRepository = require('../repositories/OutboundAttemptRepository');
const { checksumSha256 } = require('./attachmentValidation');

class QueueWorker {
  constructor() {
    this.isRunning = false;
    this.getExtensionConnection = null;
    this.isCampaignEnabled = () => false;
    this.onQueueFail = null;
    this.database = null;
    this.dispatchTimeoutMs = 3 * 60 * 1000;
    this.dispatchWatchdogs = new Map();
  }

  configure(config) {
    if (config.getConnection) this.getExtensionConnection = config.getConnection;
    if (config.onQueueFail) this.onQueueFail = config.onQueueFail;
    if (config.campaignEnabled) this.isCampaignEnabled = config.campaignEnabled;
    if (config.pageGraphSend) this.pageGraphSend = config.pageGraphSend;
    if (config.database) this.database = config.database;
    if (Number.isFinite(config.dispatchTimeoutMs)) {
      this.dispatchTimeoutMs = Math.max(1, Number(config.dispatchTimeoutMs));
    }
  }

  getDatabaseArgument() {
    return this.database || undefined;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.loop();
    console.log('[QueueWorker] Started.');
  }

  stop() {
    this.isRunning = false;
    for (const timer of this.dispatchWatchdogs.values()) clearTimeout(timer);
    this.dispatchWatchdogs.clear();
    console.log('[QueueWorker] Stopped.');
  }

  clearDispatchWatchdog(queueId) {
    const key = String(queueId || '');
    const timer = this.dispatchWatchdogs.get(key);
    if (timer) clearTimeout(timer);
    this.dispatchWatchdogs.delete(key);
  }

  acknowledgeDispatch(queueId) {
    this.clearDispatchWatchdog(queueId);
  }

  scheduleDispatchWatchdog(message) {
    if (!message?.outbound_attempt_id) return;
    this.clearDispatchWatchdog(message.id);
    const timer = setTimeout(() => {
      this.dispatchWatchdogs.delete(String(message.id));
      try {
        const database = this.getDatabaseArgument();
        const queue = MessageQueueRepository.getStatus(message.id, database);
        const attempt = OutboundAttemptRepository.getById(message.outbound_attempt_id, database);
        if (queue?.status !== 'processing' || attempt?.status !== 'dispatching') return;
        console.warn('[QueueWorker] Dispatch acknowledgement timed out for message ' + message.id + '.');
        this.fail(message, 'EXTENSION_DISPATCH_TIMEOUT');
      } catch (error) {
        console.error('[QueueWorker] Dispatch watchdog failed:', error.message);
      }
    }, this.dispatchTimeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
    this.dispatchWatchdogs.set(String(message.id), timer);
  }

  recoverStaleRichDispatches(options = {}) {
    const database = this.database || require('../database/db');
    const dispatchTimeoutMs = Number.isFinite(options.dispatchTimeoutMs)
      ? Number(options.dispatchTimeoutMs)
      : this.dispatchTimeoutMs;
    const confirmationTimeoutMs = Number.isFinite(options.confirmationTimeoutMs)
      ? Number(options.confirmationTimeoutMs)
      : 3 * 60 * 1000;
    const rows = database.prepare(`
      SELECT queue.*, attempt.status AS attempt_status,
             attempt.dispatched_at AS attempt_dispatched_at,
             attempt.updated_at AS attempt_updated_at
      FROM message_queue queue
      JOIN outbound_attempts attempt ON attempt.id = queue.outbound_attempt_id
      WHERE queue.status = 'processing'
        AND attempt.status IN ('dispatching', 'awaiting_confirmation')
    `).all();
    const recovered = { dispatching: 0, awaiting_confirmation: 0 };
    const now = Date.now();
    const parseTimestamp = (value) => {
      if (!value) return NaN;
      const raw = String(value);
      return Date.parse(raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z');
    };

    for (const row of rows) {
      const timestamp = parseTimestamp(
        row.attempt_dispatched_at || row.attempt_updated_at || row.processed_at || row.created_at
      );
      if (!Number.isFinite(timestamp)) continue;
      const timeoutMs = row.attempt_status === 'dispatching'
        ? dispatchTimeoutMs
        : confirmationTimeoutMs;
      if (now - timestamp < timeoutMs) continue;
      const reason = row.attempt_status === 'dispatching'
        ? 'EXTENSION_DISPATCH_TIMEOUT'
        : 'CONFIRMATION_TIMEOUT';
      this.fail(row, reason);
      recovered[row.attempt_status] += 1;
    }
    return recovered;
  }

  fail(message, reason) {
    this.clearDispatchWatchdog(message.id);
    const database = this.getDatabaseArgument();
    MessageQueueRepository.updateStatus(message.id, 'failed', reason, database);
    if (message.outbound_attempt_id) {
      OutboundAttemptRepository.transition(
        message.outbound_attempt_id,
        ['queued', 'dispatching', 'awaiting_confirmation'],
        'failed',
        { error_code: reason, error_message: reason },
        database
      );
      if (message.attachment_id) {
        OutboundAttachmentRepository.transition(
          message.attachment_id,
          ['queued', 'sending'],
          'failed',
          { validation_error: reason },
          database
        );
      }
    }
    if (this.onQueueFail) this.onQueueFail(message, reason);
  }

  buildAttachment(message) {
    if (!message.attachment_id) return null;
    if (!message.attachment_path || !message.attachment_mime_type || !fs.existsSync(message.attachment_path)) {
      throw new Error('ATTACHMENT_UNAVAILABLE');
    }
    const bytes = fs.readFileSync(message.attachment_path);
    if (
      Number(message.contract_version) === 2 &&
      (
        bytes.length !== Number(message.attachment_byte_size) ||
        checksumSha256(bytes) !== message.attachment_checksum
      )
    ) {
      throw new Error('ATTACHMENT_INTEGRITY_MISMATCH');
    }
    return {
      id: message.attachment_id,
      media_type: String(message.attachment_mime_type || '').startsWith('video/')
        ? 'video'
        : (message.attachment_media_type || 'image'),
      mime_type: message.attachment_mime_type,
      name: message.attachment_name,
      byte_size: bytes.length,
      checksum_sha256: message.attachment_checksum || checksumSha256(bytes),
      // The backend and extension always run on the same machine (desktop
      // Electron app), and Facebook's current Business Suite/Messenger
      // composers open a native OS file chooser rather than exposing a
      // scriptable <input type="file">. A base64 byte payload has nothing to
      // attach to; a real local path lets the extension supply the file via
      // CDP's Page.handleFileChooser instead (see background.js).
      local_path: message.attachment_path
    };
  }

  // Spec 040: several independently-selected files, or one folder ZIP,
  // dispatched together as one manifest. Reads member rows straight from
  // campaign_attachments (they already carry their own checksum/byte_size -
  // no need to duplicate that data onto message_queue). Any single member
  // failing its integrity check fails the WHOLE manifest, matching
  // CampaignAttachmentService.saveFolderAsZip's "reject the whole thing, not
  // silently a partial send" rule.
  buildAttachmentManifest(message, database) {
    if (!message.manifest_id) return null;
    const db = database || require('../database/db');
    const rows = db.prepare(
      'SELECT * FROM campaign_attachments WHERE manifest_id = ? ORDER BY created_at ASC, id ASC'
    ).all(message.manifest_id);
    if (!rows.length) throw new Error('ATTACHMENT_MANIFEST_EMPTY');
    return rows.map((row) => {
      if (!row.storage_path || !row.mime_type || !fs.existsSync(row.storage_path)) {
        throw new Error('ATTACHMENT_UNAVAILABLE');
      }
      const bytes = fs.readFileSync(row.storage_path);
      if (
        Number(message.contract_version) === 2 &&
        (bytes.length !== Number(row.byte_size) || checksumSha256(bytes) !== row.checksum)
      ) {
        throw new Error('ATTACHMENT_INTEGRITY_MISMATCH');
      }
      return {
        id: row.id,
        media_type: row.media_type || 'file',
        mime_type: row.mime_type,
        name: row.original_name,
        byte_size: bytes.length,
        checksum_sha256: row.checksum || checksumSha256(bytes),
        local_path: row.storage_path
      };
    });
  }

  async processNext() {
    const database = this.getDatabaseArgument();
    const message = MessageQueueRepository.popPending(database);
    if (!message) return null;

    if (message.campaign_id && !this.isCampaignEnabled()) {
      this.fail(message, 'CAMPAIGN_FEATURE_DISABLED');
      return { message, outcome: 'failed' };
    }

    const isRich = Number(message.contract_version) === 2 && Boolean(message.outbound_attempt_id);
    const routeInvalid = (message.campaign_id || isRich) && (
      !message.account_id ||
      !message.source_id ||
      !['personal_messenger', 'page_messenger'].includes(message.source_type) ||
      (message.source_type === 'page_messenger' && !message.page_id)
    );
    if (routeInvalid) {
      this.fail(message, message.campaign_id ? 'CAMPAIGN_ROUTE_INVALID' : 'RICH_MESSAGE_ROUTE_INVALID');
      return { message, outcome: 'failed' };
    }

    // Tin Page → Send API bằng Page Access Token (đường Graph API chính thức,
    // thay cho dispatch qua extension CDP Business Suite đã ngừng sử dụng).
    if (message.source_type === 'page_messenger') {
      if (isRich) {
        this.fail(message, 'PAGE_RICH_MESSAGE_NOT_SUPPORTED');
        return { message, outcome: 'failed' };
      }
      if (typeof this.pageGraphSend !== 'function') {
        this.fail(message, 'PAGE_GRAPH_SEND_NOT_CONFIGURED');
        return { message, outcome: 'failed' };
      }
      let outcome = null;
      let domDispatch = false;
      try {
        const r = await this.pageGraphSend(message);
        if (r && r.dispatchedViaDom) {
          // Đã bắn lệnh SEND_QUEUED_MESSAGE sang extension (luồng DOM Business
          // Suite). Kết quả thật do extension báo qua QUEUED_MESSAGE_RESULT —
          // giữ queue ở 'processing' như luồng personal qua extension.
          outcome = 'dispatched';
          domDispatch = true;
        } else if (r && r.success) {
          outcome = 'sent';
          MessageQueueRepository.updateStatus(message.id, 'sent');
        } else {
          outcome = 'failed';
          this.fail(message, (r && r.errorCode) || 'PAGE_SEND_FAILED');
        }
      } catch (error) {
        this.fail(message, error.message || 'PAGE_SEND_FAILED');
        outcome = 'failed';
      }
      return { message, outcome, domDispatch };
    }

    let attachment = null;
    let attachmentManifest = null;
    try {
      if (message.manifest_id) {
        attachmentManifest = this.buildAttachmentManifest(message, database);
      } else {
        attachment = this.buildAttachment(message);
      }
    } catch (error) {
      this.fail(message, error.message || 'ATTACHMENT_UNAVAILABLE');
      return { message, outcome: 'failed' };
    }

    const ws = this.getExtensionConnection ? this.getExtensionConnection(message.account_id) : null;
    if (!ws || ws.readyState !== 1) {
      console.warn('[QueueWorker] Extension not connected for account ' + message.account_id + '.');
      this.fail(message, 'EXTENSION_NOT_CONNECTED');
      return { message, outcome: 'failed' };
    }

    // Move into dispatching only after an existing extension socket is ready.
    if (isRich) {
      const transitioned = OutboundAttemptRepository.transition(
        message.outbound_attempt_id,
        ['queued'],
        'dispatching',
        { dispatch_method: 'rich-message-v1', dispatched_at: new Date().toISOString() },
        database
      );
      if (!transitioned) {
        this.fail(message, 'OUTBOUND_ATTEMPT_STATE_CONFLICT');
        return { message, outcome: 'failed' };
      }
      if (message.attachment_id) {
        OutboundAttachmentRepository.transition(
          message.attachment_id,
          ['queued'],
          'sending',
          {},
          database
        );
      }
    }

    const resolvedContactName = message.expected_contact_name || (() => {
      try {
        const db = database || require('../database/db');
        const row = db.prepare('SELECT contact_name FROM threads WHERE id = ?').get(message.thread_id);
        if (row?.contact_name) return row.contact_name;
        const contactRow = db.prepare('SELECT name FROM contacts WHERE thread_id = ?').get(message.thread_id);
        return contactRow?.name || null;
      } catch (_e) {
        return null;
      }
    })();
<<<<<<< Updated upstream

    const resolvedCustomerUid = message.customer_uid || (() => {
      try {
        const db = database || require('../database/db');
        const extractUid = (url) => {
          if (!url) return null;
          const m1 = String(url).match(/[?&]id=(\d+)/);
          if (m1) return m1[1];
          const m2 = String(url).match(/facebook\.com\/(?:profile\.php\?id=)?(\d+)/);
          if (m2 && !['1000', 'pages'].includes(m2[1])) return m2[1];
          return null;
        };
        const contactRow = db.prepare('SELECT profile_url FROM contacts WHERE thread_id = ?').get(message.thread_id);
        const uidFromContact = extractUid(contactRow?.profile_url);
        if (uidFromContact) return uidFromContact;

        if (resolvedContactName) {
          const matchByName = db.prepare('SELECT profile_url FROM contacts WHERE name = ? AND profile_url IS NOT NULL LIMIT 1').get(resolvedContactName);
          const uidByName = extractUid(matchByName?.profile_url);
          if (uidByName) return uidByName;
        }
        return null;
      } catch (_e) {
        return null;
      }
    })();

=======
    // Cold outreach (khách cmt bài viết): gửi lần đầu qua trang profile —
    // /messages/t/<uid> không mở được composer cho hội thoại chưa tồn tại.
    const isColdOutreach = String(message.idempotency_key || '').startsWith('comment_lead_');
    const coldProfileUid = isColdOutreach
      ? String(message.recipient_thread_id || message.thread_id || '').split(':').pop()
      : null;
>>>>>>> Stashed changes
    const envelope = {
      type: 'SEND_QUEUED_MESSAGE',
      data: {
        contract_version: (isRich || message.campaign_id) ? 2 : 1,
        queue_id: message.id,
        outbound_attempt_id: message.outbound_attempt_id || null,
        thread_id: message.thread_id,
        recipient_thread_id: message.recipient_thread_id || null,
        thread_url: message.thread_url || null,
        expected_contact_name: resolvedContactName || null,
        customer_uid: resolvedCustomerUid || null,
        account_id: message.account_id,
        content: message.content,
        source_type: message.source_type,
        page_id: message.page_id,
        source_id: message.source_id || null,
        attachment,
        attachment_manifest: attachmentManifest,
        campaign_id: message.campaign_id || null,
        campaign_recipient_id: message.campaign_recipient_id || null,
        campaign_attempt_id: message.campaign_attempt_id || null,
        idempotency_key: message.idempotency_key || null,
        ...(isColdOutreach && coldProfileUid ? { send_via_profile: true, profile_uid: coldProfileUid } : {})
      }
    };

    console.log('[QueueWorker] Dispatching message ' + message.id + ' for account ' + message.account_id);
    try {
      ws.send(JSON.stringify(envelope));
    } catch (error) {
      this.fail(message, 'EXTENSION_DISPATCH_FAILED');
      return { message, outcome: 'failed' };
    }
    this.scheduleDispatchWatchdog(message);
    return { message, envelope, outcome: 'dispatched' };
  }

  async loop() {
    while (this.isRunning) {
      try {
        const result = await this.processNext();
        if (result) {
          // Luồng DOM Business Suite nhịp chậm hơn hẳn (6-15s ngẫu nhiên) để
          // tránh Facebook quét spam khi Chrome admin gõ tin liên tục; các
          // luồng còn lại giữ nhịp 2-5s như cũ.
          const delayMs = result.domDispatch
            ? Math.floor(Math.random() * 9000) + 6000
            : Math.floor(Math.random() * 3000) + 2000;
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        } else {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } catch (error) {
        console.error('[QueueWorker] Error in loop:', error);
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }
}

module.exports = new QueueWorker();
