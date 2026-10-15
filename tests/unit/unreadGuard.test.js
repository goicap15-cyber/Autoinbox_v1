const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizePreviewText,
  shouldFlipUnreadFromPreview,
  shouldBumpUnreadFromSidebar,
  HintUnreadTracker
} = require('../../src/server/utils/unreadGuard');

test('normalizePreviewText strips prefix and collapses whitespace', () => {
  assert.equal(normalizePreviewText('  Bạn:   xin   chào '), 'xin chào');
  assert.equal(normalizePreviewText('You: hello'), 'hello');
  assert.equal(normalizePreviewText('  ok  '), 'ok');
  assert.equal(normalizePreviewText(''), '');
  assert.equal(normalizePreviewText(null), '');
});

test('manual khác -1 giữ nguyên hành vi flip cũ', () => {
  assert.equal(shouldFlipUnreadFromPreview({ manual: 0, previewContent: 'ok', recentRealContents: ['ok'] }), true);
  assert.equal(shouldFlipUnreadFromPreview({ manual: 1, previewContent: 'ok', recentRealContents: ['ok'] }), true);
  assert.equal(shouldFlipUnreadFromPreview({ manual: null, previewContent: '', unreadFlipped: false }), true);
});

test('manual = -1 chặn flip khi nội dung đã tồn tại (khớp chuẩn hóa)', () => {
  assert.equal(
    shouldFlipUnreadFromPreview({ manual: -1, previewContent: ' Bạn:  xin chào ', recentRealContents: ['xin chào'] }),
    false
  );
  assert.equal(
    shouldFlipUnreadFromPreview({ manual: -1, previewContent: 'ok', recentRealContents: ['dạ', 'ok'] }),
    false
  );
});

test('manual = -1 vẫn flip khi nội dung mới thật', () => {
  assert.equal(
    shouldFlipUnreadFromPreview({ manual: -1, previewContent: 'tin mới hoàn toàn', recentRealContents: ['xin chào'] }),
    true
  );
});

test('manual = -1 + preview rỗng (media) cần chấm xanh thật trên thread thường', () => {
  assert.equal(shouldFlipUnreadFromPreview({ manual: -1, previewContent: '', unreadFlipped: false }), false);
  assert.equal(shouldFlipUnreadFromPreview({ manual: -1, previewContent: '', unreadFlipped: true }), true);
  assert.equal(shouldFlipUnreadFromPreview({ manual: -1, previewContent: '', unreadFlipped: true, isSystemNotice: true }), false);
});

test('shouldBumpUnreadFromSidebar chỉ chặn khi manual = -1', () => {
  assert.equal(shouldBumpUnreadFromSidebar({ manual: 0 }), true);
  assert.equal(shouldBumpUnreadFromSidebar({ manual: 1 }), true);
  assert.equal(shouldBumpUnreadFromSidebar({ manual: -1, unreadFlipped: false }), false);
  assert.equal(shouldBumpUnreadFromSidebar({ manual: -1, unreadFlipped: true }), true);
  assert.equal(shouldBumpUnreadFromSidebar({ manual: -1, unreadFlipped: true, isSystemNotice: true }), false);
});

test('HintUnreadTracker: hint đầu tiên có chấm = flip, không chấm = không flip', () => {
  const tracker = new HintUnreadTracker();
  assert.equal(tracker.flip('acc:t1', 1), true);
  assert.equal(tracker.flip('acc:t2', 0), false);
});

test('HintUnreadTracker: chỉ flip khi chấm chuyển 0->1', () => {
  const tracker = new HintUnreadTracker();
  assert.equal(tracker.flip('acc:t1', 0), false); // chưa có chấm
  assert.equal(tracker.flip('acc:t1', 1), true);  // 0->1: flip thật
  assert.equal(tracker.flip('acc:t1', 1), false); // chấm giữ nguyên
  assert.equal(tracker.flip('acc:t1', 0), false); // 1->0: tắt chấm
  assert.equal(tracker.flip('acc:t1', 1), true);  // 0->1 lần nữa
});

test('HintUnreadTracker: scenario bấm đọc (DB 1->0) không tạo flip từ hint', () => {
  const tracker = new HintUnreadTracker();
  // Trước khi bấm đọc: FB vẫn báo hết chấm (extension đã mở thread trên FB)
  assert.equal(tracker.flip('acc:t1', 0), false);
  // Operator bấm đọc trong CRM -> DB 1->0, nhưng hint FB vẫn 0
  assert.equal(tracker.flip('acc:t1', 0), false);
  assert.equal(tracker.flip('acc:t1', 0), false);
});

test('HintUnreadTracker: trạng thái độc lập theo từng thread', () => {
  const tracker = new HintUnreadTracker();
  assert.equal(tracker.flip('acc:t1', 1), true);
  assert.equal(tracker.flip('acc:t2', 0), false);
  assert.equal(tracker.flip('acc:t2', 1), true);
  assert.equal(tracker.flip('acc:t1', 0), false);
  assert.equal(tracker.flip('acc:t1', 1), true);
  assert.equal(tracker.flip('acc:t2', 1), false);
});
