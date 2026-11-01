/**
 * CampaignPhoneCaptureService.js (spec 035)
 * Applies each affected campaign's opt-in phone-capture policy exactly once
 * per (campaign_recipient, capture) pair. `continue` just audits;
 * `stop_remaining` and `thank_then_stop` stop only work not yet dispatched -
 * never interrupts an attempt already in flight (CampaignRepository.finishAttempt
 * finalizes those once the in-flight attempt settles, see the "deferred stop"
 * logic there).
 */

let defaultDb;
function getDefaultDb() {
  if (!defaultDb) defaultDb = require('../database/db');
  return defaultDb;
}

const CampaignRepository = require('../repositories/CampaignRepository');
const RichMessageService = require('./RichMessageService');

const DEFAULT_THANK_YOU_TEXT = 'Cảm ơn bạn, bên mình đã nhận được số điện thoại.';

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class CampaignPhoneCaptureService {
  static async handleCaptures(threadId, captures, {
    database = getDefaultDb(),
    sleep = defaultSleep,
    timeoutMs,
    pollIntervalMs,
    capabilityOptions = {}
  } = {}) {
    if (!threadId || !Array.isArray(captures) || captures.length === 0) return [];
    const affected = CampaignRepository.findPhoneCapturePolicyRecipients(threadId, database);
    if (affected.length === 0) return [];
    const affectedCampaignIds = new Set();
    for (const capture of captures) {
      for (const recipient of affected) {
        affectedCampaignIds.add(recipient.campaign_id);
        await this.applyPolicyForRecipient(recipient, capture, { database, sleep, timeoutMs, pollIntervalMs, capabilityOptions });
      }
    }
    return [...affectedCampaignIds];
  }

  static async applyPolicyForRecipient(recipient, capture, { database, sleep, timeoutMs, pollIntervalMs, capabilityOptions }) {
    const created = CampaignRepository.createPhoneCaptureAction({
      campaignId: recipient.campaign_id,
      campaignRecipientId: recipient.id,
      phoneCaptureId: capture.id,
      policy: recipient.phone_capture_policy
    }, database);
    if (!created) return; // already handled this (recipient, capture) pair - replay-safe

    if (recipient.phone_capture_policy === 'continue') {
      CampaignRepository.addAudit(
        recipient.campaign_id, 'phone_captured',
        { phone_capture_id: capture.id, normalized_phone: capture.normalized_phone },
        recipient.id, database
      );
      return;
    }

    if (recipient.phone_capture_policy === 'stop_remaining') {
      this.applyStop(recipient, capture, database);
      return;
    }

    if (recipient.phone_capture_policy === 'thank_then_stop') {
      await this.thankThenStop(recipient, capture, { database, sleep, timeoutMs, pollIntervalMs, capabilityOptions });
    }
  }

  /**
   * Cancels the recipient's remaining work only if it's currently `pending`
   * (never a `processing` dispatch already underway). If it couldn't apply
   * immediately, the action stays in `pending` state - CampaignRepository's
   * `finishAttempt` finalizes it once that in-flight attempt settles.
   */
  static applyStop(recipient, capture, database) {
    const stopped = database.prepare(`
      UPDATE campaign_recipients SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'pending'
    `).run(recipient.id).changes > 0;

    if (!stopped) return false; // finalized later by CampaignRepository.finishAttempt

    const appliedStatusId = this.applyStatusIfConfigured(recipient, database);
    CampaignRepository.updatePhoneCaptureActionState(recipient.id, capture.id, 'stop_applied', database, {});
    database.prepare(
      "UPDATE campaign_phone_capture_actions SET applied_status_id = ? WHERE campaign_recipient_id = ? AND phone_capture_id = ?"
    ).run(appliedStatusId, recipient.id, capture.id);
    CampaignRepository.addAudit(
      recipient.campaign_id, 'phone_capture_stop_applied',
      { phone_capture_id: capture.id }, recipient.id, database
    );
    return true;
  }

  static applyStatusIfConfigured(recipient, database) {
    if (!recipient.phone_capture_status_id) return null;
    const status = database.prepare('SELECT id FROM lead_statuses WHERE id = ?').get(recipient.phone_capture_status_id);
    if (!status) {
      CampaignRepository.addAudit(
        recipient.campaign_id, 'phone_capture_status_unavailable',
        { status_id: recipient.phone_capture_status_id }, recipient.id, database
      );
      return null;
    }
    database.prepare('UPDATE contacts SET status_id = ? WHERE thread_id = ?').run(status.id, recipient.thread_id);
    return status.id;
  }

  /**
   * Queues exactly one thank-you through RichMessageService (the same
   * trusted, idempotent, already-confirmed-by-DOM-observation outbound path
   * every other CRM-initiated message uses - FR-011), waits for it to
   * settle, then stops remaining work only after that attempt is durably
   * recorded either way (Acceptance Scenario 3/5) - a failed thank-you still
   * stops follow-up (the customer already gave their number; continuing to
   * message them is worse than a missed acknowledgement).
   */
  static async thankThenStop(recipient, capture, { database, sleep, timeoutMs, pollIntervalMs, capabilityOptions = {} }) {
    const clientMessageId = 'phone_capture_thank_' + recipient.id + '_' + capture.id;
    const thankYouText = String(recipient.phone_capture_thank_you_text || DEFAULT_THANK_YOU_TEXT).trim();

    // Claim future campaign work before queuing the acknowledgement. Pending
    // recipients are cancelled now; an in-flight recipient remains untouched
    // until its current attempt settles, where CampaignRepository sees this
    // durable action and cancels the next message. That closes the window in
    // which the runner could send another campaign message while thank-you is
    // waiting for confirmation.
    const stopAlreadyApplied = this.applyStop(recipient, capture, database);

    let accepted;
    try {
      accepted = RichMessageService.submit(
        { threadId: recipient.thread_id, clientMessageId, content: thankYouText },
        { database, capabilityOptions }
      );
    } catch (error) {
      if (!stopAlreadyApplied) {
        CampaignRepository.updatePhoneCaptureActionState(recipient.id, capture.id, 'thank_failed', database, { errorDetail: error.message });
      }
      CampaignRepository.addAudit(
        recipient.campaign_id, 'phone_capture_thank_failed',
        { phone_capture_id: capture.id, error: error.message }, recipient.id, database
      );
      return;
    }

    // A recipient that was already pending has been durably stopped above.
    // Keep its action terminal as stop_applied; the acknowledgement's own
    // delivery is still represented by audit events and its message row.
    CampaignRepository.updatePhoneCaptureActionState(
      recipient.id,
      capture.id,
      stopAlreadyApplied ? 'stop_applied' : 'thank_queued',
      database,
      { thankYouClientMessageId: accepted.client_message_id || clientMessageId }
    );
    CampaignRepository.addAudit(
      recipient.campaign_id, 'phone_capture_thank_queued',
      { phone_capture_id: capture.id, client_message_id: clientMessageId }, recipient.id, database
    );

    const outcome = await this.waitForThankYouSettlement(clientMessageId, database, { sleep, timeoutMs, pollIntervalMs });
    if (outcome === 'sent') {
      if (!stopAlreadyApplied) {
        CampaignRepository.updatePhoneCaptureActionState(recipient.id, capture.id, 'thank_confirmed', database, {});
      }
      CampaignRepository.addAudit(
        recipient.campaign_id, 'phone_capture_thank_confirmed',
        { phone_capture_id: capture.id }, recipient.id, database
      );
    } else {
      if (!stopAlreadyApplied) {
        CampaignRepository.updatePhoneCaptureActionState(recipient.id, capture.id, 'thank_failed', database, { errorDetail: outcome });
      }
      CampaignRepository.addAudit(
        recipient.campaign_id, 'phone_capture_thank_failed',
        { phone_capture_id: capture.id, reason: outcome }, recipient.id, database
      );
    }
  }

  static async waitForThankYouSettlement(clientMessageId, database, { sleep = defaultSleep, timeoutMs = 120000, pollIntervalMs = 500 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const row = database.prepare(
        'SELECT delivery_status FROM messages WHERE client_message_id = ?'
      ).get(clientMessageId);
      if (row && row.delivery_status === 'sent') return 'sent';
      if (row && row.delivery_status === 'failed') return 'failed';
      await sleep(pollIntervalMs);
    }
    return 'timeout';
  }
}

module.exports = CampaignPhoneCaptureService;
