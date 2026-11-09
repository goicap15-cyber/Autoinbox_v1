function isChangedIncomingSidebarPreview({
  previousThread,
  incomingThread,
  cleanLastMessage,
  isActivitySummary,
  hasRecentMatchingOutbound = false,
  rowFresh = false,
  rowFreshNew = false
}) {
  if (!cleanLastMessage || /^(?:Chưa có tin nhắn|No messages?)$/i.test(String(cleanLastMessage).trim())) return false;
  if (isActivitySummary) return false;
  // An explicit self-preview must win over a stale unread marker.
  if (incomingThread?.preview_is_outgoing === true) return false;

  // Khách hàng MỚI hoàn toàn (chưa có trong bảng threads): nếu dòng thời gian
  // đang fresh ("Bây giờ"/"Vừa xong"/"1 phút") và không phải tin outgoing
  // thì phải bắt ngay làm tin mới.
  if (!previousThread) {
    return Boolean(rowFresh && incomingThread?.preview_is_outgoing === false);
  }

  // Preview lặp lại đúng chuỗi cũ vẫn phải được bắt khi row VỪA chuyển sang
  // "Bây giờ"/"1 phút" VÀ đang dính chấm chưa đọc/Like - khách nhắn lại đúng câu cũ
  // ("ok", "dạ") không được bị coi là "không đổi". Phải dùng rowFreshNew
  // (nhịp chuyển đổi) chứ KHÔNG dùng raw fresh: raw fresh đúng ở MỌI nhịp
  // quét trong ~60s -> ngập job sync (reproduce 2026-10-02: 177
  // sidebar_incoming/9 phút, app lag). Tự echo của CRM (không unread)
  // vẫn bị chặn như cũ tại đây.
  const samePreview = String(previousThread.last_message || '').trim() === String(cleanLastMessage).trim();
  if (samePreview
    && !(rowFreshNew === true
      && (Number(incomingThread?.is_unread) === 1 || incomingThread?.is_like === true))) return false;

  // Messenger can omit the self-prefix for one lazy-render tick. An exact
  // recent CRM outbound match is then an echo unless unread/Like provides
  // stronger evidence that the customer really sent a new message.
  const hasStrongIncomingSignal = Number(incomingThread?.is_unread) === 1
    || incomingThread?.is_like === true;
  if (hasRecentMatchingOutbound && !hasStrongIncomingSignal) return false;

  const hasIncomingSignal = hasStrongIncomingSignal
    // Hidden Messenger can mark a newly received conversation as read before
    // the CRM poll sees it. An explicit non-outgoing sidebar preview is still
    // safe evidence; undefined is deliberately not accepted.
    || incomingThread?.preview_is_outgoing === false;

  return hasIncomingSignal;
}

// Dòng thời gian trên row sidebar ("Bây giờ"/"Just now"/"vài giây trước"/"1 phút")
// là bằng chứng một tin VỪA đến - Facebook Messenger Web thường hiển thị "1 phút"
// ("1m") ngay lập tức khi khách vừa nhắn tin xong.
function isFreshRowTimeText(value) {
  const s = String(value || '').replace(/^[\s\u00b7\u2022.\-|•·]+|[\s\u00b7\u2022.\-|•·]+$/g, '').trim();
  if (!s || s.length > 24) return false;
  return /(?:bây giờ|just now|vừa xong|vài giây|giây trước|seconds? ago|^\d{1,2}\s*(?:giây|s)\b|^[1-3]\s*(?:phút|m|min|mins|minutes?)(?:\s*(?:trước|ago))?$)/i.test(s);
}

// Kiểm tra dòng thời gian của hội thoại cũ (từ 4 phút trở lên, giờ, ngày, tuần, năm)
// để tránh tạo bong bóng giả khi quét các hội thoại lịch sử cũ.
function isStaleRowTimeText(value) {
  const s = String(value || '').replace(/^[\s\u00b7\u2022.\-|•·]+|[\s\u00b7\u2022.\-|•·]+$/g, '').trim();
  if (!s) return false;
  if (isFreshRowTimeText(s)) return false;
  return /(?:hôm qua|yesterday|thứ\s+[a-zà-ỹ]+|mon|tue|wed|thu|fri|sat|sun|\d+\s*(?:giờ|ngày|tuần|tháng|năm|h|d|w|y|hr|hrs|wk|yr)|\b(?:[4-9]|\d{2,})\s*(?:phút|m|min|mins|minutes?))/iu.test(s);
}

module.exports = { isChangedIncomingSidebarPreview, isFreshRowTimeText, isStaleRowTimeText };
