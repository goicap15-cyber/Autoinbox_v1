const AUTOMATIC_LEAD_ACTIVITY = 'Đã tự động tạo hoạt động về khách hàng tiềm năng cho bạn dựa trên cuộc trò chuyện này';
// 2026-09-29: thông báo handover của AI agent trong Business Suite từng bị
// orphan harvester nhặt thành tin nhắn (reproduce: Dũng Trần #7264).
const AI_AGENT_HANDOVER = 'Tác nhân AI đã chuyển đoạn chat này cho bạn';
// 2026-10-22: biến thể tiếng Anh — page dùng UI tiếng Anh thì webhook echo
// đẩy notice về như tin Page gửi thường (outgoing), guard WS lúc đó chỉ soi
// danh sách tiếng Việt nên lọt thành bubble thật (reproduce Sầm Dương).
const AI_AGENT_HANDOVER_EN = 'You took over this chat from your AI agent';
const AI_AGENT_WILL_RESPOND = 'Tác nhân AI sẽ phản hồi';
const AI_AGENT_WILL_RESPOND_EN = 'AI agent will respond';
const AI_AGENT_TOOK_OVER = 'Bạn đã tiếp quản đoạn chat này từ tác nhân AI';

const KNOWN_PAGE_SYSTEM_NOTICES = [
  AUTOMATIC_LEAD_ACTIVITY,
  AI_AGENT_HANDOVER,
  AI_AGENT_HANDOVER_EN,
  AI_AGENT_WILL_RESPOND,
  AI_AGENT_WILL_RESPOND_EN,
  AI_AGENT_TOOK_OVER
];

const KNOWN_PAGE_SYSTEM_NOTICE_PATTERNS = [
  /^tác nhân ai sẽ phản hồi$/iu,
  /^ai agent will respond$/iu,
  /^bạn đã tiếp quản đoạn chat này từ tác nhân ai$/iu,
  /^bạn đang phản hồi bình luận của người dùng về bài viết trên\b/iu,
  /^you are replying to a user(?:'s)? comment on a post on\b/iu,
  /^[^\n]{1,80}\s+đã trả lời một quảng cáo$/iu,
  /^[^\n]{1,80}\s+replied to an ad$/iu,
  /^đoạn chat này chứa tin trả lời quảng cáo\b/iu,
  /^this chat contains an ad reply\b/iu
];

function normalizeNotice(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!…]+$/u, '')
    .toLocaleLowerCase('vi-VN');
}

function isKnownPageSystemNotice(value) {
  const normalized = normalizeNotice(value);
  if (!normalized) return false;
  if (KNOWN_PAGE_SYSTEM_NOTICES.some((notice) => normalizeNotice(notice) === normalized)) {
    return true;
  }
  return KNOWN_PAGE_SYSTEM_NOTICE_PATTERNS.some((pattern) => pattern.test(normalized));
}

module.exports = { AUTOMATIC_LEAD_ACTIVITY, AI_AGENT_HANDOVER, AI_AGENT_HANDOVER_EN, isKnownPageSystemNotice, normalizeNotice };
