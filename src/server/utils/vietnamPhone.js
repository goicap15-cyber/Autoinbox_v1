/**
 * vietnamPhone.js
 * Exact Vietnamese mobile-number detection: versioned prefix allowlist,
 * normalization of domestic/+84/84 forms to a canonical 10-digit value, and
 * boundary-safe extraction from free-form message text (spec 035).
 *
 * Deliberately narrower than a broad "0[35789]x" regex: real carrier
 * prefixes are assigned individually, not by decade, and new ones (e.g. 095)
 * must be turned on explicitly rather than matched by accident.
 *
 * 2026-10-22: thêm dò số di động quốc tế (+CC...). libphonenumber-js (max)
 * xác thực từng ứng viên theo siêu dữ liệu ~240 quốc gia; chỉ nhận số còn
 * liên lạc được (loại trừ máy bàn/phí cao/tổng đài). Số VN (+84/84/0) vẫn do
 * registry đầu số riêng xử lý — nhánh quốc tế bỏ qua VN để một số không bị
 * lưu thành 2 dạng.
 */
const { parsePhoneNumberFromString } = require('libphonenumber-js/max');

// Bump whenever PREFIX_REGISTRY or the extraction shape changes - persisted
// per capture (contact_phone_captures.rule_version) so old evidence can be
// told apart from evidence produced under a newer rule set.
const RULE_VERSION = 1;
const INTL_RULE_VERSION = 2;

function rangePrefixes(startSuffix, endSuffix) {
  const out = [];
  for (let n = startSuffix; n <= endSuffix; n++) {
    out.push('0' + String(n).padStart(2, '0'));
  }
  return out;
}

// Each entry is independently toggleable. `active: true` entries are
// recognized today. `active: false` entries are known-but-not-yet-accepted -
// flip to true (and set effectiveDate for audit) only once confirmed, per
// FR-002. Never widen a range to "any 09x" to pre-approve future prefixes.
const PREFIX_REGISTRY = [
  ...rangePrefixes(32, 39).map((prefix) => ({ prefix, active: true, effectiveDate: null })),
  { prefix: '052', active: true, effectiveDate: null },
  { prefix: '055', active: true, effectiveDate: null },
  { prefix: '056', active: true, effectiveDate: null },
  { prefix: '058', active: true, effectiveDate: null },
  { prefix: '059', active: true, effectiveDate: null },
  { prefix: '070', active: true, effectiveDate: null },
  ...rangePrefixes(76, 79).map((prefix) => ({ prefix, active: true, effectiveDate: null })),
  ...rangePrefixes(81, 89).map((prefix) => ({ prefix, active: true, effectiveDate: null })),
  ...rangePrefixes(90, 94).map((prefix) => ({ prefix, active: true, effectiveDate: null })),
  ...rangePrefixes(96, 99).map((prefix) => ({ prefix, active: true, effectiveDate: null })),
  // Awarded to Viettel July 2026 (research.md) - enabled 2026-09-17: real
  // 095 numbers are in service, keeping this off silently dropped customer
  // phones from the capture pipeline.
  { prefix: '095', active: true, effectiveDate: '2026-07-01' }
];

const PREFIX_INDEX = new Map(PREFIX_REGISTRY.map((entry) => [entry.prefix, entry]));

/**
 * @param {string} prefix - 3-digit prefix, e.g. "034".
 * @returns {boolean}
 */
function isPrefixActive(prefix) {
  const entry = PREFIX_INDEX.get(prefix);
  return Boolean(entry && entry.active);
}

/**
 * Pure normalization/validation of a single already-located candidate token
 * (digits plus allowed separators, optionally with a leading + and 84/0
 * marker). Does not scan message text - see findPhoneNumbers for that.
 * @param {string} rawToken
 * @returns {{ valid: boolean, normalized: string|null, prefix: string|null, reason: string|null }}
 */
function normalizeVietnamMobile(rawToken) {
  if (typeof rawToken !== 'string') {
    return { valid: false, normalized: null, prefix: null, reason: 'NOT_A_STRING' };
  }
  const trimmed = rawToken.trim();
  const markerMatch = trimmed.match(/^(\+?84|0)([\s.\-]?\(?\d{1,4}\)?){1,4}$/);
  if (!markerMatch) {
    return { valid: false, normalized: null, prefix: null, reason: 'MALFORMED' };
  }
  const marker = markerMatch[1].replace('+', '');
  const restDigits = trimmed.slice(markerMatch[1].length).replace(/\D/g, '');

  if (restDigits.length !== 9) {
    return { valid: false, normalized: null, prefix: null, reason: 'WRONG_LENGTH' };
  }
  if (marker !== '0' && marker !== '84') {
    return { valid: false, normalized: null, prefix: null, reason: 'MALFORMED' };
  }

  const normalized = '0' + restDigits;
  const prefix = normalized.slice(0, 3);
  if (!isPrefixActive(prefix)) {
    return { valid: false, normalized, prefix, reason: 'INVALID_PREFIX' };
  }
  return { valid: true, normalized, prefix, reason: null };
}

// Locates candidate spans: starts at "0" or "84"/"+84", not immediately
// preceded/followed by another digit (so a 10-digit chunk embedded in a
// longer identifier is never matched), followed by 1-4 digit groups
// optionally separated by a single space/dot/hyphen and optionally
// paren-wrapped (e.g. "0 (345) 678 901"). Bounding the repetition count
// keeps the match from running away across unrelated trailing digits; the
// exact-length check happens afterward in normalizeVietnamMobile.
const CANDIDATE_PATTERN = /(?<!\d)(\+?84|0)(?:[\s.\-]?\(?\d{1,4}\)?){1,4}(?!\d)/g;

// Ứng viên quốc tế: cụm bắt đầu bằng '+' theo sau 6-19 ký tự số/dấu phân cách,
// chặn biên không khớp giữa chữ số. libphonenumber sẽ quyết định nhận hay bỏ.
const INTL_CANDIDATE_PATTERN = /\+[0-9][0-9\s.\-()]{5,18}[0-9]/g;

// Chỉ loại loại số không dùng để liên lạc khách: máy bàn, phí cao, tổng đài
// miễn phí, thư thoại, máy nhắn tin. MOBILE / FIXED_LINE_OR_MOBILE / VOIP /
// PERSONAL_NUMBER / UAN / không xác định đều nhận — ưu tiên không bỏ sót lead.
const INTL_REJECTED_TYPES = new Set(['FIXED_LINE', 'PREMIUM_RATE', 'TOLL_FREE', 'VOICEMAIL', 'PAGER']);

function findInternationalNumbers(text) {
  if (!text || typeof text !== 'string') return [];
  const results = [];
  let match;
  INTL_CANDIDATE_PATTERN.lastIndex = 0;
  while ((match = INTL_CANDIDATE_PATTERN.exec(text)) !== null) {
    const raw = match[0];
    const parsed = parsePhoneNumberFromString(raw);
    if (!parsed || !parsed.isValid() || parsed.country === 'VN') continue;
    if (INTL_REJECTED_TYPES.has(parsed.getType())) continue;
    results.push({
      raw,
      normalized: parsed.number,
      prefix: '+' + parsed.countryCallingCode,
      country: parsed.country
    });
  }
  return results;
}

/**
 * Scans free-form message text for valid Vietnamese mobile numbers.
 * Only returns entries that pass normalization + active-prefix checks;
 * malformed/invalid-prefix/wrong-length candidates are silently dropped, per
 * FR-003 - the detector's job is only to say what IS valid, not narrate why
 * a token was rejected outside of tests.
 * 2026-10-22: gộp thêm số di động quốc tế hợp lệ (normalized dạng E.164
 * '+CC...', kèm trường country; số VN không có trường country).
 * @param {string} text
 * @returns {{ raw: string, normalized: string, prefix: string, country?: string }[]}
 */
function findPhoneNumbers(text) {
  if (!text || typeof text !== 'string') return [];
  const results = [];
  let match;
  CANDIDATE_PATTERN.lastIndex = 0;
  while ((match = CANDIDATE_PATTERN.exec(text)) !== null) {
    const raw = match[0];
    const outcome = normalizeVietnamMobile(raw);
    if (outcome.valid) {
      results.push({ raw, normalized: outcome.normalized, prefix: outcome.prefix });
    }
  }
  for (const intl of findInternationalNumbers(text)) {
    results.push(intl);
  }
  return results;
}

module.exports = {
  RULE_VERSION,
  INTL_RULE_VERSION,
  PREFIX_REGISTRY,
  isPrefixActive,
  normalizeVietnamMobile,
  findInternationalNumbers,
  findPhoneNumbers
};
