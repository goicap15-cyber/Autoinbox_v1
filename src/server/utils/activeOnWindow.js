/**
 * activeOnWindow.js
 * Parse cửa sổ ngày cho bộ lọc "active-on" (sidebar): from/to YYYY-MM-DD
 * (một trong hai có thể trống) hoặc tham số cũ ?date= (coi như from = to).
 * Mốc "to" được tính trọn cả ngày đó (endMs = 00:00 hôm sau). Giờ tính theo
 * máy chạy server - khớp với getMessageDateKey phía client. Chọn ngược thì
 * tự hoán đổi thay vì trả về cửa sổ rỗng.
 */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * @param {{ from?: string, to?: string, date?: string }} query
 * @returns {{ error: 'MISSING_RANGE'|'BAD_FORMAT'|'BAD_DATE' } |
 *   {{ from: string|null, to: string|null, startMs: number|null, endMs: number|null }}}
 */
function resolveActiveOnWindow(query = {}) {
  let fromStr = String(query.from || '').trim();
  let toStr = String(query.to || '').trim();
  if (!fromStr && !toStr) {
    const legacyDate = String(query.date || '').trim();
    if (legacyDate) {
      fromStr = legacyDate;
      toStr = legacyDate;
    }
  }
  if (!fromStr && !toStr) return { error: 'MISSING_RANGE' };
  if ((fromStr && !DATE_PATTERN.test(fromStr)) || (toStr && !DATE_PATTERN.test(toStr))) {
    return { error: 'BAD_FORMAT' };
  }
  if (fromStr && toStr && fromStr > toStr) {
    const swap = fromStr;
    fromStr = toStr;
    toStr = swap;
  }
  const startMs = fromStr ? new Date(fromStr + 'T00:00:00').getTime() : null;
  const endMs = toStr ? new Date(toStr + 'T00:00:00').getTime() + 24 * 60 * 60 * 1000 : null;
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return { error: 'BAD_DATE' };
  return { from: fromStr || null, to: toStr || null, startMs, endMs };
}

module.exports = { resolveActiveOnWindow };
