const test = require('node:test');
const assert = require('node:assert/strict');
const { isKnownPageSystemNotice } = require('../../src/server/utils/pageSystemNotice');
const { isSystemOrMetadataText } = require('../../src/server/utils/textFilter');

test('recognizes the repeated Meta automatic-lead notice despite whitespace/punctuation', () => {
  assert.equal(isKnownPageSystemNotice('Đã tự động tạo hoạt động về khách hàng tiềm năng cho bạn dựa trên cuộc trò chuyện này.'), true);
  assert.equal(isKnownPageSystemNotice('  Đã tự động tạo hoạt động về khách hàng tiềm năng cho bạn dựa trên cuộc trò chuyện này  '), true);
});

test('does not classify a real customer message merely because it has no Facebook id', () => {
  assert.equal(isKnownPageSystemNotice('Số điện thoại của em là 0989861561'), false);
  assert.equal(isKnownPageSystemNotice('Đã tự động tạo hoạt động cho cửa hàng rồi'), false);
});


test('backend text guard suppresses the Meta notice but preserves genuine phone text', () => {
  assert.equal(isSystemOrMetadataText('Đã tự động tạo hoạt động về khách hàng tiềm năng cho bạn dựa trên cuộc trò chuyện này.'), true);
  assert.equal(isSystemOrMetadataText('0989 861 561'), false);
});

test('recognizes the English AI-agent handover notice echoed as an outgoing page message', () => {
  assert.equal(isKnownPageSystemNotice('You took over this chat from your AI agent.'), true);
  assert.equal(isKnownPageSystemNotice('You took over this chat from your AI agent'), true);
  assert.equal(isKnownPageSystemNotice('  You TOOK over this chat from YOUR AI agent.  '), true);
  assert.equal(isSystemOrMetadataText('You took over this chat from your AI agent.'), true);
  assert.equal(isKnownPageSystemNotice('You took over this chat'), false);
  assert.equal(isKnownPageSystemNotice('I took over this chat from your AI agent.'), false);
});

test('Vietnamese AI-agent handover notice stays recognized', () => {
  assert.equal(isKnownPageSystemNotice('Tác nhân AI đã chuyển đoạn chat này cho bạn'), true);
  assert.equal(isKnownPageSystemNotice('Tác nhân AI đã chuyển đoạn chat này cho bạn.'), true);
});


test('extension boundary uses the same exact suppression while preserving a customer number', () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const source = fs.readFileSync('src/extension/textFilter.js', 'utf8');
  const context = { globalThis: {} };
  vm.runInNewContext(source, context, { filename: 'textFilter.js' });
  const filter = context.globalThis.FbCrmTextFilter;
  assert.equal(filter.isSystemOrMetadataText('Đã tự động tạo hoạt động về khách hàng tiềm năng cho bạn dựa trên cuộc trò chuyện này.'), true);
  assert.equal(filter.isSystemOrMetadataText('0989 861 561'), false);
});
