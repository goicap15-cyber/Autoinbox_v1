const { isSystemConversationNotice, isSystemOrMetadataText } = require('../src/server/utils/textFilter');
const junk = [
  'Các bạn hiện đã được kết nối trên Messenger',
  'Các bạn hiện đã được kết nối trên Messenger.',
  'Bạn và Tây hiện đã là bạn bè.',
  'Toản đã gọi cho bạn.',
  'Cuộc gọi thoại đã kết thúc.',
  'Cuộc gọi video đã kết thúc.',
  'Thảo đã rời khỏi nhóm.',
  'Bạn đã gửi 2 ảnh.',
  'Chi đã gửi một nhãn dán.'
];
const real = [
  'alo anh ơi', 'ok', '600 r', 'cho mình xin giá với ạ', 'lồn',
  'Bạn đã gửi 2 ảnh đẹp quá', // câu thật chứa cụm 'Bạn đã gửi 2 ảnh'? -> phải KHÔNG bị lọc vì có thêm chữ
  'ok để tôi gọi cho bạn sau'
];
let fail = 0;
for (const s of junk) {
  if (!isSystemConversationNotice(s)) { console.log('JUNK MISS:', s); fail++; }
  if (!isSystemOrMetadataText(s)) { console.log('SYS MISS:', s); fail++; }
}
for (const s of real) {
  if (isSystemConversationNotice(s)) { console.log('REAL FALSE-POSITIVE:', s); fail++; }
}
console.log(fail === 0 ? 'ALL PASS' : `FAIL ${fail}`);
