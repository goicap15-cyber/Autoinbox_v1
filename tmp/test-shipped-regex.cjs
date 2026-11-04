const RE = /^[^?！?\n]{1,48}\s(?:đã trả lời|replied to)\s(?!(?:.*\s)?(?:chưa|rồi|xong|sao|đâu|gì|à|hả|nhỉ|nha|nhé|thôi|luôn|vậy|đấy|đó|ạ|nhá|rùi|nè|được|yet|already|right|now|ok|okay)\s*[?！?.!…]*$)[^?！?\n]{1,60}$/iu;
const cases = [
  'Hai đã trả lời Bảo Long',
  'Bảo Long đã trả lời Hai',
  'Chức đã trả lời tin của bạn',
  'Em đã trả lời khách rồi ạ',
  'Tôi đã trả lời rồi',
  'anh đã trả lời chưa?',
];
for (const c of cases) console.log(RE.test(c) ? 'MATCH ' : 'no    ', JSON.stringify(c));
console.log('flags:', RE.flags, 'source len:', RE.source.length);

// Giờ đọc đúng chuỗi regex trong file release và test lại
const fs = require('fs');
const src = fs.readFileSync('release/win-unpacked/resources/extension/background.js', 'utf8');
const m = src.match(/if \(!\/quảng cáo\|replied to \(\?:an \|your \)\?ad\/i\.test\(cleaned\)\n\s+&& (\/.+\/iu)\.test\(cleaned\)\) \{ bubble_idx\+\+; continue; \}/);
if (!m) { console.log('REGEX NOT FOUND in release file!'); process.exit(1); }
const shipped = eval(m[1]);
console.log('--- shipped regex ---');
for (const c of cases) console.log(shipped.test(c) ? 'MATCH ' : 'no    ', JSON.stringify(c));
