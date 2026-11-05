const { cleanMessageText } = require('./textFilter');

// Chuẩn hóa text preview trước khi so khớp "tin cũ bị quét lại" vs "tin mới
// thật". Sidebar Messenger hay đổi text giữa các lần quét dù cùng một tin
// (khoảng trắng, tiền tố "Bạn: ", biến thể emoji) — so khớp ký tự chính xác
// sẽ coi đó là tin mới và làm chấm chưa đọc hồi sinh sau khi operator đọc.
function normalizePreviewText(text) {
  return cleanMessageText(text)
    .replace(/^(?:Bạn|You):\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Operator vừa đánh dấu đã đọc (unread_manual = -1) thì tín hiệu từ bộ dò
// sidebar chỉ được bật lại chưa đọc khi có BẰNG CHỨNG MẠNH tin khách mới
// thật: nội dung mới (khác mọi tin thật gần đây sau chuẩn hóa), hoặc chấm
// xanh FB thật sự lật trên thread không phải hội thoại hệ thống.
function shouldFlipUnreadFromPreview({ manual, previewContent, recentRealContents = [], unreadFlipped = false, isSystemNotice = false }) {
  const manualVal = Number(manual || 0);
  if (manualVal !== -1) return true; // không ghim đã đọc → giữ hành vi cũ
  const normalizedPreview = normalizePreviewText(previewContent);
  if (normalizedPreview) {
    const matchesRecentReal = recentRealContents.some(
      (content) => normalizePreviewText(content) === normalizedPreview
    );
    if (matchesRecentReal) return false; // text đã có trong thread → quét lại, không phải tin mới
    return true; // nội dung mới thật
  }
  // Preview rỗng (media/ảnh...): không có text để chứng minh — chỉ tin chấm
  // xanh lật trên thread thường.
  return Boolean(unreadFlipped) && !isSystemNotice;
}

// Các nhánh bump heuristics (tin lặp nội dung cũ, hint media): với thread
// operator vừa đọc thì chỉ bump khi chấm xanh FB thật sự lật; manual != -1
// thì giữ nguyên hành vi cũ.
function shouldBumpUnreadFromSidebar({ manual, unreadFlipped = false, isSystemNotice = false }) {
  const manualVal = Number(manual || 0);
  if (manualVal !== -1) return true;
  return Boolean(unreadFlipped) && !isSystemNotice;
}

// Theo dõi chấm xanh FB theo hint sidebar qua các lần quét: chỉ báo flip khi
// chấm thật sự chuyển 0->1 giữa hai hint. KHÔNG dùng trạng thái DB — operator
// bấm đọc làm DB 1->0 nên "flip" tính từ DB luôn true ở scan kế tiếp, badge
// hồi sinh sau mỗi lần đọc (reproduce 2026-10-12, thread Kjgvkj).
class HintUnreadTracker {
  constructor() {
    this.prev = new Map();
  }

  flip(key, currentUnread, hasRecentEvidence = true) {
    const now = Number(currentUnread) === 1;
    const has = this.prev.has(key);
    const prev = has ? this.prev.get(key) : null;
    if (this.prev.size > 5000) this.prev.clear();
    this.prev.set(key, now);
    // Hint đầu tiên: chấm xanh đang bật CHỈ tính là flip khi thread có bằng
    // chứng tin thật mới nhất thuộc hôm nay. Chấm xanh FB không tự tắt khi
    // CRM trả lời bằng API (chỉ tắt khi người thật mở tin trong Messenger) —
    // nếu coi "có chấm" là flip thì MỖI lần restart server mọi hội thoại cũ
    // còn chấm xanh đều bị bump unread + đè last_activity hàng loạt
    // (reproduce 2026-10-21: 33 hội thoại cũ bị đè cùng giây sau khi start).
    if (!has) return now && hasRecentEvidence !== false;
    return !prev && now;
  }
}

module.exports = {
  normalizePreviewText,
  shouldFlipUnreadFromPreview,
  shouldBumpUnreadFromSidebar,
  HintUnreadTracker
};
