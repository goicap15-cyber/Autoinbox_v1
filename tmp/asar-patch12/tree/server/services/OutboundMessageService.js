/**
 * Core outbound status states and safe diagnostic codes.
 */

const OUTBOUND_STATUS = {
  PENDING: 'pending',
  SENT: 'sent',
  FAILED: 'failed'
};

const OUTBOUND_ERROR_CODE = {
  NETWORK_TIMEOUT: 'NETWORK_TIMEOUT',
  EXTENSION_DISCONNECTED: 'EXTENSION_DISCONNECTED',
  FACEBOOK_API_ERROR: 'FACEBOOK_API_ERROR',
  ACCOUNT_MISMATCH: 'ACCOUNT_MISMATCH',
  INVALID_THREAD: 'INVALID_THREAD',
  UNAUTHORIZED: 'UNAUTHORIZED',
  UNKNOWN: 'UNKNOWN'
};

class OutboundMessageService {
  /**
   * Safely formats diagnostic metadata for logging or database, stripping out cookies/tokens.
   */
  static safeDiagnostics(rawPayload) {
    if (!rawPayload) return {};
    const safe = { ...rawPayload };
    if (safe.headers) {
      delete safe.headers.cookie;
      delete safe.headers.authorization;
    }
    if (safe.cookie) delete safe.cookie;
    if (safe.token) delete safe.token;
    if (safe.fb_dtsg) delete safe.fb_dtsg;
    return safe;
  }
}

module.exports = {
  OUTBOUND_STATUS,
  OUTBOUND_ERROR_CODE,
  OutboundMessageService
};
