// Sửa literal mojibake trong extractBubbleEmoji: return 'Ã°Å¸â€˜Â' -> return '\u{1F44D}'
const fs = require('fs');
const p = 'src/extension/content.js';
let s = fs.readFileSync(p, 'utf8');
let count = 0;
s = s.replace(/return '([^']*)';/g, (full, inner) => {
  const codes = [...inner].map((c) => c.codePointAt(0));
  const isLikeMojibake = codes.length <= 12 && codes[0] === 0x00c3 && codes[1] === 0x00b0;
  if (isLikeMojibake) { count++; return "return '\\u{1F44D}';"; }
  return full;
});
fs.writeFileSync(p, s);
console.log('replaced:', count);
// In các return emoji-ký-tự-cao còn lại để soát
for (const m of s.matchAll(/return '([^']*)';/g)) {
  if ([...m[1]].some((c) => c.codePointAt(0) > 127)) {
    console.log('còn lại:', JSON.stringify(m[1]), '->', [...m[1]].map((c) => c.codePointAt(0).toString(16)).join(' '));
  }
}
