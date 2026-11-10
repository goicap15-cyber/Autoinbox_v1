// AutoChatbot - Extension Text Filter Utility

(function () {
  const RELATIVE_TIME_METADATA_RE = /^\d+\s*(?:gi\u00e2y|ph\u00fat|gi\u1edd|ng\u00e0y|tu\u1ea7n|th\u00e1ng|n\u0103m|seconds?|minutes?|hours?|days?|weeks?|months?|years?)(?:\s*(?:tr\u01b0\u1edbc|ago))?$/iu;
  
// Số điện thoại di động VN dạng số trơn (0/84/+84 + 9 số, đầu số đang hoạt
// động). Khách hay gửi SĐT dưới dạng đúng các con số - pattern junk số dài
// phía dưới KHÔNG được nuốt các giá trị này, nếu không tin nhắn biến mất khỏi
// CRM ngay từ lúc sync và pipeline bắt SĐT (spec 035) không bao giờ thấy.
// Đầu số tham chiếu registry trong src/server/utils/vietnamPhone.js
// (032-039, 052/055/056/058/059, 070, 076-079, 081-089, 090-094, 096-099).
const VN_MOBILE_RE = /^(?:\+?84|0)(?:3[2-9]|5[25689]|7[06-9]|8[1-9]|9[0-46-9]|95)\d{7}$/;
function isBareVietnamMobileText(text) {
  const trimmed = String(text || '').trim();
  if (!/^[+\d][\d\s.\-()]{8,19}$/.test(trimmed)) return false;
  return VN_MOBILE_RE.test(trimmed.replace(/[\s.\-()]/g, ''));
}

  const SYSTEM_PATTERNS = [
    // E2EE & Security Notices
    /Tin nhắn và cuộc gọi (?:đang )?được bảo mật/i,
    /bảo mật bằng tính năng mã hóa/i,
    /bảo mật đầu cuối/i,
    // Notice E2EE thật trong tab hội thoại Messenger tiếng Anh - filter cũ chỉ
    // có bản VN và mẫu "Personal chats..." (sai chữ) nên notice bị bắt nhầm
    // thành tin của khách mỗi lần initial sweep mở thread (reproduce 2026-10-07).
    /^Messages and calls are secured with end-to-end encryption\.?$/i,
    /^Messages and calls are end-to-end encrypted\.?$/i,
    // Nhãn phân cách thời gian dạng tắt khi Messenger UI tiếng Anh ("9w",
    // "2d", "5h", "3m"...) - separator, không phải tin nhắn
    // (reproduce 2026-10-07: "9w" thành bubble rác trong hội thoại).
    /^\d{1,2}\s?(?:s|sec|m|min|h|hr|d|w|mo|y)$/i,

    // Footer, Privacy & Links
    /^Tìm hiểu thêm$/i,
    /^Xem thêm$/i,
    /^Quyền riêng tư/i,
    /^Cookie$/i,
    /^Facebook$/i,
    /^Messenger$/i,
    /^Meta$/i,
    /^Trang chủ$/i,
    /^Khôi phục ngay$/i,
    /^Khôi phục tin nhắn$/i,
    /^Restore now$/i,
    /^Restore messages$/i,
    /^Personal chats are secured with end-to-end encryption/i,
    // Bubble nhãn trợ năng trần (không có payload sau colon) - DOM thỉnh
    // thoảng nhả nguyên nhãn "Enter, Message sent 15:15 by Khang" thành một
    // row riêng, tin thật luôn đến bằng row của chính nó (reproduce 15:15).
    /^Enter,\s*Message sent \d{1,2}:\d{2}\s+by\s+.+$/i,
    /^Thiếu lịch sử chat/i,
    /^Thiếu tin nhắn\.?$/i,
    /^Không khôi phục được tin nhắn\.?$/i,
    /^Bạn đã tạo nhóm này/i,
    /^Chỉ những người tham gia/i,
    /^Bản quyền Meta/i,
    /^Thêm tin nhắn được cá nhân h(?:óa|oá)\.?$/i,
    /^(?:Chưa có tin nhắn|ChÃ†Â°a cÃƒÂ° tin nhÃ¡ÂºÂ¯n|No messages?)$/i,

    // Right sidebar & header UI elements
    /^(?:Trang cá nhân|View profile)$/i,
    /^(?:Tắt thông báo|Mute notifications)$/i,
    /^(?:Tìm kiếm|Search)$/i,
    /^(?:Thông tin về đoạn chat|Conversation information|Chat info|Chi tiết cuộc trò chuyện)$/i,
    /^(?:Tùy chỉnh đoạn chat|Customize chat)$/i,
    /^(?:File phương tiện,? file và liên kết|Media,? files and links)$/i,
    /^(?:Quyền riêng tư và hỗ trợ|Privacy and support|Privacy & support)$/i,
    /^(?:Chủ đề|Theme)$/i,
    /^(?:Biểu tượng cảm xúc|Emoji)$/i,
    /^(?:Biệt danh|Nicknames)$/i,
    /^(?:Tạo nhóm|Create group)$/i,
    /^(?:Thành viên|Members)$/i,
    /^(?:Tên người dùng|Username)$/i,
    /^(?:Gỡ|Remove|Unsend)$/i,
    /^(?:Trả lời|Reply)$/i,
    /^(?:Chuyển tiếp|Forward)$/i,
    /^(?:Ghim|Pin)$/i,
    /^(?:Sao chép|Copy)$/i,

    // Status & Presence (exact standalone matches only)
    /^(?:Đã gửi|Đã nhận|Đã xem|Sent|Delivered|Seen)$/i,
  /^(?:Đã gửi|Đã nhận|Đã xem|Sent|Delivered|Seen)\s+\d+\s+(?:giây|phút|giờ|ngày|tuần|tháng|năm)\s+(?:trước|ago)$/i,
    /^(?:Đang hoạt động.*|Hoạt động(?:\s+\d+.*)?|Đã hoạt động.*|Active now|Active recently|Active \d+.*|Online|Offline)$/i,
    /^(?:Typing[.…]*|Đang nhập[.…]*|Đang gửi[.…]*|Sending[.…]*)$/i,
    /^(?:Đang tải|Loading)[.…]*$/i,

    // Accessibility / System standalone
    /^(?:Tin nhắn do|Message sent by) .+?(?:gửi lúc|at) .+?:\s*.*$/i,
    /^Nhấn Enter để gửi$/i,
    /^(?:Bản nháp:?|Draft:?)\s*.*$/i,
    // Meta Business Suite lead-activity UI, not a message from the customer.
    /^Đã tự động tạo hoạt động về khách hàng tiềm năng cho bạn dựa trên cuộc trò chuyện này[.!…]*$/i,

    // Standalone Timestamps (e.g. 09:09, 16:36 T5, 18:00 T5, 12:30 AM, 20ch, 19ch, 8sa, 20:00ch, T5, CN)
    /^(?:(?:Thứ\s*(?:[2-7]|Hai|Ba|Tư|Năm|Sáu|Bảy)|Chủ Nhật|T[2-7]|CN),?\s*)?\d{1,2}:\d{2}(?:\s*(?:T[2-7]|CN|AM|PM|ch|sa|chiều|sáng|tối))?$/i,
    /^(?:(?:Thứ\s*(?:[2-7]|Hai|Ba|Tư|Năm|Sáu|Bảy)|Chủ Nhật|T[2-7]|CN),?\s*)?\d{1,2}\s*(?:ch|sa|am|pm|chiều|sáng|tối)$/i,
    /^(?:T[2-7]|CN)$/i,
    // Short date/time separator headers (e.g. "53 9 Tháng 9, 2026", "9 Tháng 9", "Thứ Năm, 9 Tháng 9")
    /^(?:(?:Thứ\s*(?:[2-7]|Hai|Ba|Tư|Năm|Sáu|Bảy)|Chủ Nhật|T[2-7]|CN),?\s*)?(?:\d{1,2}(?::\d{2})?(?:\s*(?:ch|sa|am|pm))?\s+)?\d{1,2}\s+(?:Tháng|thg)\s+\d{1,2}(?:,?\s*\d{4})?$/i,

    // Video player duration timestamps (e.g. 0:00 / 0:19, 00:00 / 01:23, 0:03, 0:19)
    /^\d{1,2}(?::\d{2}){1,2}\s*\/\s*\d{1,2}(?::\d{2}){1,2}$/i,
    /^0:\d{2}$/i,


    // Nhãn hệ thống của attachment unfurl (link share -> Messenger render
    // 'Bạn đã gửi một file đính kèm.') - không bao giờ là tin nhắn thật.
    /^Bạn đã gửi (?:một )?(?:file|tệp|tập tin|ảnh|video) đính kèm\.?$/i,
    /^You sent (?:an )?attachment\.?$/i,
    /^(?:(?:Bạn|Tôi|You|[^\n]{1,80})\s+)?(?:đã gửi|sent|shared)\s+(?:(?:một|\d+|an?|one)\s+)?(?:ảnh|bức ảnh|photo|photos|image|images|video|videos|tệp|file|files|tập tin|nhãn dán|sticker|GIF|tin nhắn thoại|file âm thanh|voice message|audio)(?:\s+đính kèm)?\.?$/iu,
    /^(?:[^\n]{1,60}[\s\u00a0]*[·•][\s\u00a0]*)?(?:Đã chỉnh sửa|Edited|Đã ghim|Pinned)\.?$/iu,
    /^(?:drive\.google\.com|docs\.google\.com|Google Docs|Google Drive|youtube\.com|youtu\.be|facebook\.com|fb\.watch|tiktok\.com|vt\.tiktok\.com|instagram\.com|zalo\.me|shopee\.vn|lazada\.vn|tiki\.vn|maps\.app\.goo\.gl|goo\.gl|bit\.ly)$/i,

    /^Bạn đã phản hồi ghi chú của (?:họ|họ\.|họ\.?)$/i,
    /^Bạn đã trả lời tin của .+\.$/i,
    // Header trích dẫn reply của Messenger: bubble quote render "Bạn đã trả
    // lời {tên người được reply}" (EN "You replied to {name}") trong row tin
    // reply - DOM nhặt thành tin outgoing riêng với mid thật (reproduce
    // 2026-10-11: nhóm Bi-aaaaaaa dính "Bạn đã trả lời Tiến Quang"/"...Linh").
    // Tin operator thật dạng "Bạn đã trả lời chưa?" / "Bạn đã trả lời em rồi"
    // phải sống sót -> loại từ nối/câu hỏi ở đuôi trước khi nhận diện. Đồng bộ
    // với src/server/utils/textFilter.js và heal (4c) trong server.js.
    /^Bạn đã trả lời (?!(?:.*\s)?(?:chưa|rồi|xong|sao|đâu|gì|à|hả|nhỉ|nha|thôi|luôn|vậy|đấy|đó|nhé)\s*[?！?.!…]*$)[^?！?\n]{1,60}$/iu,
    /^You replied to (?!(?:.*\s)?(?:yet|already|right|now|ok|okay)\s*[?！?.!…]*$)[^?！?\n]{1,60}$/iu,
    // Chiều ngược: quote reply của KHÁCH render "{tên khách} đã trả lời bạn" /
    // "{name} replied to you" - cùng lớp metadata, reproduce 2026-10-11
    // (thread Li Min Tài ×3). Từ nối đuôi được giữ lại như phía trên.
    /^(?!.+(?:chưa|rồi|xong|sao|đâu|gì|à|hả|nhỉ|nha|thôi|luôn|vậy|đấy|đó|nhé)\s*[?！?.!…]*$)[^?！?\n]{1,48} đã trả lời bạn\.?$/iu,
    /^(?!.+(?:yet|already|right|now|ok|okay)\s*[?！?.!…]*$)[^?！?\n]{1,48} replied to you\.?$/iu,
    // Chip gợi ý trả lời của Messenger (suggested replies hiện dưới ô soạn thảo,
    // vd 'Trao đổi thêm?') - DOM observer đọc nhầm thành bubble tin của khách.
    /^Trao đổi thêm\??$/i,

    // AI-agent UI của Business Suite (lead campaign bot) - các chip đánh giá
    // và system notice render trong vùng tin nhắn, crawler nuốt nhầm thành
    // bubble (reproduce 2026-09-28: thread Thành Lê Văn #1443 bị nhân đôi
    // chip + notice kèm timestamp NULL rơi thành cụm "Hôm Nay" ma).
    /^Bạn đã tiếp quản đoạn chat này từ tác nhân AI\.?$/i,
    /^Phản hồi tốt$/i,
    /^Cải thiện phản hồi$/i,
    /^Tác nhân AI sẽ phản hồi\.?$/i,
    // Banner quảng cáo ghim đỉnh hội thoại lead + chip bật AI (harvest orphan
    // dễ nhặt nhầm - 2026-09-28)
    /^Đoạn chat này chứa tin trả lời quảng cáo/i,
    /^Bạn đang phản hồi bình luận của người dùng về bài viết trên\b/i,
    /^You are replying to a user(?:'s)? comment on a post on\b/i,
    /^[^\n]{1,80}\s+đã trả lời một quảng cáo\.?$/i,
    /^[^\n]{1,80}\s+replied to an ad\.?$/i,
    /^Bật tính năng phản hồi bằng AI$/i,
    /^Xem quảng cáo$/i,
  /^Người gửi:?$/i,
  /^Sender:?$/i,

    // Debug trace and junk text patterns (TRACE_ONE_1509, dsdsdsds, numeric debug strings)
    /^TRACE_[A-Z0-9_]+$/i,
    /^(?:ds){2,}$/i,
    /^\d{9,}$/,

    // Media label placeholders (e.g. [Ảnh], [Video], [File], [Attachment])
    // Bracket BẮT BUỘC: chữ "ảnh"/"video" trần là caption/message thật của
    // người dùng (bị nuốt mất 2026-09-24 khi bracket tùy chọn).
    /^\[(?:Ảnh|Photo|Image|Video|Tệp|File|Sticker|Nhãn dán|Attachment)\]$/i,

    // Full date/time separator header Business Suite renders between message
    // groups (e.g. "13:52 6 Tháng 8, 2026") - mirrors the same addition in
    // src/server/utils/textFilter.js (keep both copies in sync).
    /^\d{1,2}:\d{2}\s+\d{1,2}\s+Tháng\s+\d{1,2},?\s+\d{4}$/i,
    // Short date-only separator, no time/year (e.g. "20 Tháng 4") - live
    // report (2026-08-20) found this leaking in as its own fake message row.
    /^\d{1,2}\s+Tháng\s+\d{1,2}(?:,?\s*\d{4})?$/i,
    // Short day-of-week / relative-day separator, same family (spec 047).
    /^(?:Thứ (?:Hai|Ba|Tư|Năm|Sáu|Bảy)|Chủ Nhật|Hôm nay|Hôm qua|Today|Yesterday)$/i,

    // Pill ngày EN giữa nhóm tin ("Oct 16, 2026, 10:49 AM") + mảnh pill bị
    // DOM cắt ("58 AM by Khang") nhặt thành tin rác (reproduce 2026-11-03).
    // Đồng bộ src/server/utils/textFilter.js và closure background.js.
    /^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}(?:,?\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)?$/i,
    /^\d{1,2}(?::\d{2})?\s*(?:AM|PM)\s+by\s+[A-ZÀ-ỸĐ][\p{L}\p{M}\s.]{0,40}$/u,

    // Meta Business Suite navigation / menu actions
    /^(?:Meta Business Suite|Liên kết|Chỉnh sửa|Trợ giúp|Tùy chọn khác|Cài đặt|Settings|Help|Edit)$/i,
    /^(?:Thông báo|Notifications)$/i,
    /^(?:Trình quản lý quảng cáo|Ads Manager)$/i,
    /^(?:Hộp thư|Hộp thư đến|Inbox)$/i,
    /^(?:Nội dung|Content)$/i,
    /^(?:Nền tảng kết nối người sáng tạo(?: nội dung)?|Creator (?:Studio|platform))$/i,
    /^(?:Công cụ lập kế hoạch|Planner)$/i,
    /^(?:Quảng cáo|Ads)$/i,
    /^(?:Thông tin chi tiết|Insights)$/i,
    /^(?:Kiếm tiền|Monetization)$/i,
    /^(?:Tất cả(?: các)? công cụ|All tools)$/i
  ];

  const SEPARATOR_ONLY_REGEX = /^[\s\u00b7\u2022.\-|•·]+$/;

  // Mảnh nhãn giờ-gửi FB dính vào bong bóng ("9:58 AM by Khang", "58 PM by
  // You" - reproduce 2026-11-03): label EN "Message sent October 16, 2026,
  // 9:58 AM by Khang" bị cắt mất đầu thành bubble rác. Tên người gửi phải
  // viết hoa đầu từ để không nuốt tin thật kiểu "gặp 3 PM by zoom". \s đã
  // bao gồm U+202F narrow space mà FB dùng giữa phút và AM/PM.
  const FB_SENDER_LABEL_FRAGMENT_PATTERNS = [
    /(?:^|\s)\d{0,2}:\d{2}\s?(?:AM|PM|SA|CH|SÁNG|CHIỀU|TỐI)?\s+by\s+(?:[A-ZÀ-Ỹ][^\s]*\s?){1,5}$/i,
    /^\d{1,2}\s?(?:AM|PM|SA|CH)\s+by\s+(?:[A-ZÀ-Ỹ][^\s]*\s?){1,5}$/i,
    // Nhãn trợ năng nguyên vẹn làm cả bubble: "Message sent October 16,
    // 2026, 9:58 AM by Khang" (có/không ngày), "Tin nhắn do X gửi lúc 9:58".
    /^message sent\b[^\n]*\b\d{1,2}:\d{2}\b[^\n]*\bby\s+[A-ZÀ-Ỹ][^\n]*$/i,
    /^tin nhắn do [^\n]+? gửi lúc\s*\d{1,2}:\d{2}/i
  ];

  function isSystemOrMetadataText(text) {
    if (isBareVietnamMobileText(text)) return false; // SĐT VN: không phải junk
    if (/^d{9,}$/.test(String(text || '').trim())) return true; // chuỗi số rác dài (đã loại SĐT VN)
    if (!text || typeof text !== 'string') return true;
    const trimmed = text.trim();
    if (!trimmed) return true;
    if (SEPARATOR_ONLY_REGEX.test(trimmed)) return true;
    if (/(?:Chưa\s*có\s*tin\s*nhắn|ChÃ|tin\s*nh[áÃaàáảãạâầấẩẫậăằắẳẵặ]*[n]|No\s*messages?)/i.test(trimmed)) return true;
    if (RELATIVE_TIME_METADATA_RE.test(trimmed)) return true;
    for (const pat of FB_SENDER_LABEL_FRAGMENT_PATTERNS) {
      if (pat.test(trimmed)) return true;
    }

    for (const pat of SYSTEM_PATTERNS) {
      if (pat.test(trimmed)) return true;
    }
    return false;
  }

  function cleanMessageText(rawText) {
    if (!rawText || typeof rawText !== 'string') return '';
    let text = rawText.trim();

    // Zero-width / invisibile chars (chip rỗng của AI-agent chứa \u200B) -
    // strip trước mọi check để chip rỗng về '' và bị lọc như rác.
    text = text.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
    if (!text) return '';

    // Messenger can prepend its unread divider to the first visible bubble.
    text = text.replace(/^(?:Tin nh\u1eafn ch\u01b0a \u0111\u1ecdc|Unread messages?):\s*/iu, '').trim();

    // Messenger can prepend its unread divider to the first visible bubble.
    text = text.replace(/^(?:Tin nh\u1eafn ch\u01b0a \u0111\u1ecdc|Unread messages?):\s*/iu, '').trim();
    if (!text) return '';

    // 1. Strip accessibility prefix (handling 'Tin nhắn do X gửi lúc Thứ Năm 18:00ch:', 'Tin nhắn do X gửi lúc 18:00:', etc.)
    text = text.replace(/^(?:Nhập,\s*)?Tin nhắn do [\s\S]+? gửi lúc [^\n]*?(?:ch:|\b\d{1,2}:\d{2}(?:\s*(?:ch|sa|am|pm))?:|\b\d{1,2}:\d{2}(?:\s*(?:ch|sa|am|pm))?\s+)\s*/i, '').trim();
    text = text.replace(/^(?:Nhập,\s*)?Message sent by [\s\S]+? at [^\n]*?(?::|\b\d{1,2}:\d{2}(?:\s*(?:[ap]m))?:|\b\d{1,2}:\d{2}(?:\s*(?:[ap]m))?\s+)\s*/i, '').trim();
    // Nhãn trợ năng dạng "Enter, Message sent 13:58 by Khang: <payload>" -
    // bubble icon-only/text của Messenger E2EE để nguyên nhãn này trong DOM
    // text; strip prefix giữ lại payload (emoji HOẶC text - bản cũ chỉ giữ
    // emoji làm tin text của operator thành bubble nhãn trần).
    text = text.replace(/^Enter,\s*Message sent\b[^:\n]*(?::\d{2}[^:\n]*)?:\s*/iu, '').trim();
    text = text.replace(/^Nhập,\s*/i, '').trim();
    text = text.replace(/^[:\s]+/, '').trim();

    const sentEmojiMatch = text.match(/^[^,\n]{1,80}\s+(?:đã gửi|sent),\s*(.+)$/i);
    if (sentEmojiMatch) {
      const payload = sentEmojiMatch[1].trim();
      if (payload && !/[A-Za-zÀ-ỹ0-9]/.test(payload)) {
        text = payload;
      }
    }

    // 2. Strip delivery status ONLY if appended on a separate line or after multi-space metadata (never strip inside normal text like 'Đã gửi hàng rồi')
    text = text.replace(/(?:\n|\r|\s{2,})(?:Đã gửi|Đã nhận|Đã xem|Sent|Delivered|Seen|Nhấn Enter để gửi)\s*$/i, '').trim();
    text = text.replace(/(?<=\S)(?:Đã gửi|Đã nhận|Đã xem|Sent|Delivered|Seen)$/i, '').trim();

    // 3. Strip leading/trailing timestamps ONLY if isolated/standalone on line
    text = text.replace(/^(?:(?:Thứ\s*(?:[2-7]|Hai|Ba|Tư|Năm|Sáu|Bảy)|Chủ Nhật|T[2-7]|CN),?\s*)?(?:\d{1,2}:\d{2}(?:\s*(?:T[2-7]|CN|AM|PM|ch|sa|chiều|sáng|tối))?|\d{1,2}\s*(?:ch|sa|am|pm|chiều|sáng|tối)|T[2-7]|CN)\s*$/i, '')
      .replace(/(?:\n|\r|\s{2,})\s*(?:(?:Thứ\s*(?:[2-7]|Hai|Ba|Tư|Năm|Sáu|Bảy)|Chủ Nhật|T[2-7]|CN),?\s*)?(?:\d{1,2}:\d{2}(?:\s*(?:T[2-7]|CN|AM|PM|ch|sa|chiều|sáng|tối))?|\d{1,2}\s*(?:ch|sa|am|pm|chiều|sáng|tối)|T[2-7]|CN)$/i, '').trim();
    text = text.replace(/^(?:(?:Thứ\s*(?:[2-7]|Hai|Ba|Tư|Năm|Sáu|Bảy)|Chủ Nhật|T[2-7]|CN),?\s*)?(?:\d{1,2}(?::\d{2})?(?:\s*(?:ch|sa|am|pm))?\s+)?\d{1,2}\s+(?:Tháng|thg)\s+\d{1,2}(?:,?\s*\d{4})?\s*$/i, '')
      .replace(/(?:\n|\r|\s{2,})\s*(?:(?:Thứ\s*(?:[2-7]|Hai|Ba|Tư|Năm|Sáu|Bảy)|Chủ Nhật|T[2-7]|CN),?\s*)?(?:\d{1,2}(?::\d{2})?(?:\s*(?:ch|sa|am|pm))?\s+)?\d{1,2}\s+(?:Tháng|thg)\s+\d{1,2}(?:,?\s*\d{4})?$/i, '').trim();
    text = text.replace(/^[:\s]+/, '').trim();

    // 4. Strip video player duration timestamps (e.g. 0:00 / 0:19)
    text = text.replace(/^\d{1,2}(?::\d{2}){1,2}\s*\/\s*\d{1,2}(?::\d{2}){1,2}(?:\s+|\n|\r)/i, '').trim();
    text = text.replace(/(?:\s+|\n|\r)\d{1,2}(?::\d{2}){1,2}\s*\/\s*\d{1,2}(?::\d{2}){1,2}$/i, '').trim();

    if (/^(?:thích|like|biểu tượng thích|biểu tượng cảm xúc thích|gửi biểu tượng thích|thumbs up)$/i.test(text)) {
      return '👍';
    }

    if (!text || SEPARATOR_ONLY_REGEX.test(text)) return '';

    if (isSystemOrMetadataText(text)) return '';

    return text;
  }

  const INVALID_CONTACT_NAME_PATTERNS = [
    /^(?:Tất cả tin nhắn|Tất cả|All messages|All)$/i,
    /(?:Tất cả tin nhắn\s*){2,}/i,
    /(?:All messages\s*){2,}/i,
    /(?:Hộp thư đến\s*){2,}/i,
    /Meta Business Suite/i,
    /^(?:Tin nhắn trực tiếp|Direct messages)$/i,
    /^(?:Tin nhắn|Messages)$/i,
    /^(?:Hộp thư đến|Hộp thư|Inbox)$/i,
    /^(?:Chưa đọc|Unread)$/i,
    /^(?:Đã xong|Done)$/i,
    /^(?:Gắn dấu sao|Đã gắn dấu sao|Starred)$/i,
    /^(?:Spam|Thư rác)$/i,
    /^(?:Bình luận.*|Comments.*)$/i,
    /^(?:Thông báo|Notifications)$/i,
    /^(?:Đang hoạt động.*|Hoạt động(?:\s+\d+.*)?|Đã hoạt động.*|Active now|Active recently|Active \d+.*|Online|Offline)$/i,
    /^(?:Đang|Loading|Đang tải)[.…]*$/i,
    /^(?:Nhấn Enter để gửi|Press Enter to send)$/i,
    /^(?:Tin nhắn và cuộc gọi.*|bảo mật.*)$/i,
    /^(?:Facebook|Messenger|Meta)$/i,
    // Chỉ chặn khi TOÀN BỘ chuỗi là chữ UI Business Suite (neo ^...$); nếu không
    // sẽ nuốt luôn tên khách chứa từ trùng (VD: "Võ Thanh Nhãn", "Phạm Ghi Chú").
    /^(?:Bài viết và thước phim\s*)+$/i,
    /^(?:Posts and reels\s*)+$/i,
    /^(?:Ghi chú\s*)+$/i,
    /^(?:Nhãn\s*)+$/i,
    /^(?:Hoạt động\s*)+$/i,
    /^(?:Chi tiết\s*)+$/i,
    /^(?:Bài viết và thước phim|Posts and reels|Ghi chú|Nhãn|Chi tiết)$/i
  ];

  function isInvalidContactName(name) {
    if (!name || typeof name !== 'string') return true;
    const trimmed = name.trim();
    if (!trimmed || trimmed.length < 2) return true;
    for (const pat of INVALID_CONTACT_NAME_PATTERNS) {
      if (pat.test(trimmed)) return true;
    }
    return false;
  }

  function cleanContactName(rawName, fallback = 'Khách hàng') {
    if (!rawName || typeof rawName !== 'string') return fallback;
    const trimmed = rawName.trim();
    if (isInvalidContactName(trimmed)) return fallback;
    return trimmed;
  }

  // 2026-09-29: Business Suite attribution "Người gửi: <agent>" under every
  // page-sent bubble - the orphan harvester harvested it as standalone rows or
  // glued it onto the bubble tail (reproduce: Trịnh Mạnh Nguyen #1443).
  const BIZ_SENT_BY_ATTR_RE = /(^|\n)\s*Ng\u01b0\u1eddi g\u1eedi:?\s*[^\n]{0,80}\s*$/;
  const BIZ_FEEDBACK_TAIL_RE = /(?:\n\s*Ph\u1ea3n h\u1ed3i (?:t\u1ed1t|t\u1ec7)\s*)+$/;
  const BIZ_FEEDBACK_ONLY_RE = /^(?:\s*Ph\u1ea3n h\u1ed3i (?:t\u1ed1t|t\u1ec7)\s*)+$/;

  function isBizFeedbackOnly(text) {
    const s = String(text || '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
    return s.length > 0 && BIZ_FEEDBACK_ONLY_RE.test(s);
  }

  function stripBizSentByAttribution(text) {
    if (typeof text !== 'string' || !text) return text;
    let stripped = text.replace(/[\u200B-\u200D\uFEFF]/g, '');
    if (stripped.indexOf('Ng\u01b0\u1eddi g\u1eedi') !== -1) {
      stripped = stripped.replace(BIZ_SENT_BY_ATTR_RE, '');
    }
    if (/Ph\u1ea3n h\u1ed3i (?:t\u1ed1t|t\u1ec7)/.test(stripped)) {
      stripped = stripped.replace(BIZ_FEEDBACK_TAIL_RE, '');
    }
    stripped = stripped.replace(/\s+$/, '');
    return stripped.length ? stripped : '';
  }

  function isBizSentByAttributionOnly(text) {
    const s = String(text || '').trim();
    if (!s || s.indexOf('Ng\u01b0\u1eddi g\u1eedi') !== 0) return false;
    const rest = s.replace(/^Ng\u01b0\u1eddi g\u1eedi:?\s*/, '');
    return rest.length <= 60 && rest.indexOf('\n') === -1;
  }

  globalThis.FbCrmTextFilter = {
    isSystemOrMetadataText,
    cleanMessageText,
    isInvalidContactName,
    cleanContactName,
    stripBizSentByAttribution,
    isBizSentByAttributionOnly,
    isBizFeedbackOnly
  };
})();
