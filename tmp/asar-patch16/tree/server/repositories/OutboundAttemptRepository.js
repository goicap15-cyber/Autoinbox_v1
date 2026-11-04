const crypto = require('crypto');

let defaultDb;
function getDefaultDb() {
  if (!defaultDb) defaultDb = require('../database/db');
  return defaultDb;
}

class OutboundAttemptRepository {
  static create(data, database = getDefaultDb()) {
    const existing = this.getByIdempotencyKey(data.idempotency_key, database);
    if (existing) return existing;
    const id = data.id || crypto.randomUUID();
    try {
      database.prepare(
        'INSERT INTO outbound_attempts ' +
        '(id, message_id, queue_id, attachment_id, source_id, source_type, account_id, page_id, attempt_number, idempotency_key, status, dispatch_method, error_code, error_message) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        id,
        data.message_id,
        data.queue_id || null,
        data.attachment_id || null,
        data.source_id,
        data.source_type,
        data.account_id,
        data.page_id || null,
        data.attempt_number,
        data.idempotency_key,
        data.status || 'queued',
        data.dispatch_method || null,
        data.error_code || null,
        data.error_message || null
      );
      return this.getById(id, database);
    } catch (error) {
      if (/UNIQUE constraint failed: outbound_attempts.idempotency_key/.test(error.message)) {
        const repeated = this.getByIdempotencyKey(data.idempotency_key, database);
        if (repeated) return repeated;
      }
      throw error;
    }
  }

  static getById(id, database = getDefaultDb()) {
    return database.prepare('SELECT * FROM outbound_attempts WHERE id = ?').get(id) || null;
  }

  static getByIdempotencyKey(key, database = getDefaultDb()) {
    if (!key) return null;
    return database.prepare(
      'SELECT * FROM outbound_attempts WHERE idempotency_key = ?'
    ).get(key) || null;
  }

  static getLatestForMessage(messageId, database = getDefaultDb()) {
    return database.prepare(
      'SELECT * FROM outbound_attempts WHERE message_id = ? ORDER BY attempt_number DESC LIMIT 1'
    ).get(messageId) || null;
  }

  static nextAttemptNumber(messageId, database = getDefaultDb()) {
    return database.prepare(
      'SELECT COALESCE(MAX(attempt_number), 0) + 1 AS next_number FROM outbound_attempts WHERE message_id = ?'
    ).get(messageId).next_number;
  }

  static linkQueue(id, queueId, database = getDefaultDb()) {
    return database.prepare(
      'UPDATE outbound_attempts SET queue_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND queue_id IS NULL'
    ).run(queueId, id).changes === 1;
  }

  static transition(id, fromStatuses, toStatus, fields = {}, database = getDefaultDb()) {
    if (!Array.isArray(fromStatuses) || fromStatuses.length === 0) return false;
    const allowedFields = new Set([
      'queue_id', 'dispatch_method', 'error_code', 'error_message',
      'dispatched_at', 'confirmed_at', 'confirmation_message_id', 'confirmation_source'
    ]);
    const entries = Object.entries(fields).filter(([key]) => allowedFields.has(key));
    const assignments = ['status = ?', ...entries.map(([key]) => key + ' = ?'), 'updated_at = CURRENT_TIMESTAMP'];
    const placeholders = fromStatuses.map(() => '?').join(', ');
    const values = [toStatus, ...entries.map(([, value]) => value), id, ...fromStatuses];
    return database.prepare(
      'UPDATE outbound_attempts SET ' + assignments.join(', ') +
      ' WHERE id = ? AND status IN (' + placeholders + ')'
    ).run(...values).changes === 1;
  }
}

module.exports = OutboundAttemptRepository;
