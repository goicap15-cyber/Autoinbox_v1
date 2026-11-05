function parseDueTimestamp(value) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

// Khóa chuông lời nhắc: id + due_at — đặt nhắc MỚI trên cùng hội thoại phải
// re-arm chuông (khóa khác), không bị kế thừa trạng thái tắt/rung của nhắc cũ.
export function reminderBellKey(thread) {
  return String(thread?.id || '') + '|' + String(thread?.reminder_due_at || '');
}

export function getReminderDueState(thread, now = Date.now()) {
  const reminderStatus = thread?.reminder_status;
  if (!thread || (reminderStatus && reminderStatus !== 'active')) {
    return { isDue: false, label: null, overdueMs: 0 };
  }
  const dueTimestamp = parseDueTimestamp(thread.reminder_due_at);
  if (dueTimestamp == null || dueTimestamp > now) {
    return { isDue: false, label: null, overdueMs: 0 };
  }

  const overdueMs = Math.max(0, now - dueTimestamp);
  if (overdueMs < 60 * 1000) return { isDue: true, label: 'Đến hạn', overdueMs };
  if (overdueMs < 60 * 60 * 1000) {
    return { isDue: true, label: 'Quá ' + Math.floor(overdueMs / (60 * 1000)) + ' phút', overdueMs };
  }
  if (overdueMs < 24 * 60 * 60 * 1000) {
    return { isDue: true, label: 'Quá ' + Math.floor(overdueMs / (60 * 60 * 1000)) + ' giờ', overdueMs };
  }
  return { isDue: true, label: 'Quá ' + Math.floor(overdueMs / (24 * 60 * 60 * 1000)) + ' ngày', overdueMs };
}

export function getReminderDueAriaLabel(thread, now = Date.now()) {
  const state = getReminderDueState(thread, now);
  if (!state.isDue) return 'Không có lời nhắc đến hạn';
  const note = String(thread?.reminder_note || '').trim();
  return 'Cần nhắc, ' + state.label.toLowerCase() + (note ? '. ' + note : '');
}

export function sortDueReminders(threads, now = Date.now()) {
  const due = [];
  const normal = [];
  (Array.isArray(threads) ? threads : []).forEach((thread) => {
    (getReminderDueState(thread, now).isDue ? due : normal).push(thread);
  });
  return due.concat(normal);
}
