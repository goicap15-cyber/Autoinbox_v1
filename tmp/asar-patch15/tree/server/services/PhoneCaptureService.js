/**
 * PhoneCaptureService.js (spec 035)
 * Idempotent transaction that turns a first-time-persisted incoming
 * customer message into durable phone-capture evidence, filling an empty
 * contact phone without ever overwriting a manual/legacy/already-selected
 * value. Pure persistence - callers (server.js) own emitting any live
 * event, matching how OutboundConfirmationService is used elsewhere.
 */

let defaultDb;
function getDefaultDb() {
  if (!defaultDb) defaultDb = require('../database/db');
  return defaultDb;
}

const { findPhoneNumbers, RULE_VERSION } = require('../utils/vietnamPhone');
const { resolveInternalThreadId } = require('../utils/threadIdResolver');
const ContactPhoneCaptureRepository = require('../repositories/ContactPhoneCaptureRepository');

class PhoneCaptureService {
  /**
   * @param {object} params
   * @param {string} params.threadId - raw thread id as reported by the
   *   inbound message (may be a bare PSID for personal-Messenger DOM
   *   observations - resolved to the CRM's internal thread_id before any
   *   write, exactly like OutboundConfirmationService already does).
   * @param {string} params.accountId
   * @param {string} params.messageId - stable source message identity
   *   (fb_message_id). Required - no identity, no capture.
   * @param {string} params.content - already-cleaned incoming message text.
   * @param {number} [params.messageTimestampMs]
   * @param {object} [options]
   * @param {object} [options.database]
   * @returns {{ threadId: string|null, captures: object[] }} captures newly
   *   inserted or replayed for this message (empty array if nothing valid
   *   was found or the message/content was missing).
   */
  static processIncomingMessage(
    { threadId: rawThreadId, accountId, messageId, content, messageTimestampMs },
    { database = getDefaultDb() } = {}
  ) {
    if (!messageId || !content) return { threadId: null, captures: [], createdCaptures: [] };
    const found = findPhoneNumbers(content);
    if (found.length === 0) return { threadId: null, captures: [], createdCaptures: [] };

    const threadId = resolveInternalThreadId(database, accountId, rawThreadId);
    const capturedAt = new Date(Number(messageTimestampMs) || Date.now()).toISOString();
    const captures = [];
    const createdCaptures = [];

    const txn = database.transaction(() => {
      for (const candidate of found) {
        const { row, created } = ContactPhoneCaptureRepository.insertIfNew({
          threadId,
          normalizedPhone: candidate.normalized,
          rawPhone: candidate.raw,
          messageId,
          messageTimestampMs: Number(messageTimestampMs) || 0,
          ruleVersion: RULE_VERSION
        }, database);

        if (!created) {
          // Replay of an already-processed (message_id, normalized_phone)
          // pair - nothing new to persist or select (FR-004/SC-005).
          captures.push(row);
          continue;
        }

        // Fill an empty contact phone; COALESCE(NULLIF(contacts.phone, ''), ...)
        // keeps whatever the contact already has whenever it's non-empty -
        // manual, legacy or a previously selected capture always wins over
        // this new one (FR-006). Mirrors the exact guard the code this
        // replaces already used, just with the priority flipped: automated
        // capture may only fill a gap, never overwrite.
        database.prepare(`
          INSERT INTO contacts (thread_id, phone, phone_source, phone_capture_id, phone_captured_at)
          VALUES (?, ?, 'message_capture', ?, ?)
          ON CONFLICT(thread_id) DO UPDATE SET
            phone = COALESCE(NULLIF(contacts.phone, ''), excluded.phone),
            phone_source = CASE WHEN contacts.phone IS NULL OR contacts.phone = '' THEN excluded.phone_source ELSE contacts.phone_source END,
            phone_capture_id = CASE WHEN contacts.phone IS NULL OR contacts.phone = '' THEN excluded.phone_capture_id ELSE contacts.phone_capture_id END,
            phone_captured_at = CASE WHEN contacts.phone IS NULL OR contacts.phone = '' THEN excluded.phone_captured_at ELSE contacts.phone_captured_at END
        `).run(threadId, candidate.normalized, row.id, capturedAt);

        const nowSelected = database.prepare(
          'SELECT phone_capture_id FROM contacts WHERE thread_id = ?'
        ).get(threadId);
        const selectionState = nowSelected && nowSelected.phone_capture_id === row.id ? 'selected' : 'candidate';
        ContactPhoneCaptureRepository.setSelectionState(row.id, selectionState, database);
        row.selection_state = selectionState;
        captures.push(row);
        createdCaptures.push(row);
      }
    });
    txn();

    return { threadId, captures, createdCaptures };
  }

  /**
   * Read-side view matching contracts/phone-capture.md's contact payload
   * shape: current selected phone + provenance, plus dated candidates
   * (every capture whose normalized value differs from the selected one).
   */
  static getContactPhoneView(threadId, database = getDefaultDb()) {
    const contact = database.prepare(
      'SELECT phone, phone_source, phone_capture_id, phone_captured_at FROM contacts WHERE thread_id = ?'
    ).get(threadId);
    const allCaptures = ContactPhoneCaptureRepository.listForThread(threadId, database);
    const selectedCapture = contact && contact.phone_capture_id
      ? allCaptures.find((c) => c.id === contact.phone_capture_id) || null
      : null;
    const candidates = allCaptures.filter((c) => c.normalized_phone !== (contact ? contact.phone : null));

    return {
      phone: contact ? contact.phone : null,
      phone_source: contact ? contact.phone_source : null,
      phone_captured_at: contact ? contact.phone_captured_at : null,
      phone_capture: selectedCapture,
      phone_candidates: candidates
    };
  }
}

module.exports = PhoneCaptureService;
