/**
 * Persistence boundary for immutable phone-capture evidence (spec 035).
 * A row here is never edited except for `selection_state` - the raw/
 * normalized value, source message and timestamps are fixed at insert time.
 */

let defaultDb;
function getDefaultDb() {
  if (!defaultDb) defaultDb = require('../database/db');
  return defaultDb;
}

class ContactPhoneCaptureRepository {
  /**
   * Inserts a capture row unless (message_id, normalized_phone) already
   * exists - the replay-idempotency boundary required by FR-004. Returns
   * the row either way, with `created` telling the caller whether this is
   * the first time this exact message+number pair has been seen.
   */
  static insertIfNew({
    threadId,
    normalizedPhone,
    rawPhone,
    messageId,
    messageTimestampMs = 0,
    ruleVersion
  }, database = getDefaultDb()) {
    const info = database.prepare(`
      INSERT OR IGNORE INTO contact_phone_captures
        (thread_id, normalized_phone, raw_phone, message_id, message_timestamp_ms, rule_version, selection_state)
      VALUES (?, ?, ?, ?, ?, ?, 'candidate')
    `).run(threadId, normalizedPhone, rawPhone, messageId, messageTimestampMs || 0, ruleVersion);

    if (info.changes === 0) {
      return {
        row: database.prepare(
          'SELECT * FROM contact_phone_captures WHERE message_id = ? AND normalized_phone = ?'
        ).get(messageId, normalizedPhone),
        created: false
      };
    }
    return {
      row: database.prepare('SELECT * FROM contact_phone_captures WHERE id = ?').get(info.lastInsertRowid),
      created: true
    };
  }

  static getById(id, database = getDefaultDb()) {
    return database.prepare('SELECT * FROM contact_phone_captures WHERE id = ?').get(id);
  }

  static listForThread(threadId, database = getDefaultDb()) {
    return database.prepare(
      'SELECT * FROM contact_phone_captures WHERE thread_id = ? ORDER BY message_timestamp_ms DESC, id DESC'
    ).all(threadId);
  }

  static setSelectionState(id, state, database = getDefaultDb()) {
    if (!['selected', 'candidate', 'ignored'].includes(state)) throw new Error('INVALID_SELECTION_STATE');
    database.prepare('UPDATE contact_phone_captures SET selection_state = ? WHERE id = ?').run(state, id);
  }
}

module.exports = ContactPhoneCaptureRepository;
