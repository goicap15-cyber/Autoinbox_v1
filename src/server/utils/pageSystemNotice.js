const AUTOMATIC_LEAD_ACTIVITY = 'Đã tự động tạo hoạt động về khách hàng tiềm năng cho bạn dựa trên cuộc trò chuyện này';
// 2026-09-29: thông báo handover của AI agent trong Business Suite từng bị
// orphan harvester nhặt thành tin nhắn (reproduce: Dũng Trần #7264).
const AI_AGENT_HANDOVER = 'Tác nhân AI đã chuyển đoạn chat này cho bạn';
// 2026-10-22: biến thể tiếng Anh — page dùng UI tiếng Anh thì webhook echo
// đẩy notice về như tin Page gửi thường (outgoing), guard WS lúc đó chỉ soi
// danh sách tiếng Việt nên lọt thành bubble thật (reproduce Sầm Dương).
const AI_AGENT_HANDOVER_EN = 'You took over this chat from your AI agent';

const KNOWN_PAGE_SYSTEM_NOTICES = [AUTOMATIC_LEAD_ACTIVITY, AI_AGENT_HANDOVER, AI_AGENT_HANDOVER_EN];

function normalizeNotice(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!…]+$/u, '')
    .toLocaleLowerCase('vi-VN');
}

function isKnownPageSystemNotice(value) {
  const normalized = normalizeNotice(value);
  return KNOWN_PAGE_SYSTEM_NOTICES.some((notice) => normalizeNotice(notice) === normalized);
}

module.exports = { AUTOMATIC_LEAD_ACTIVITY, AI_AGENT_HANDOVER, AI_AGENT_HANDOVER_EN, isKnownPageSystemNotice, normalizeNotice };
