const fs = require('fs');
const P = 'src/server/services/AppSetupAutomation.js';
let src = fs.readFileSync(P, 'utf8');
const broken = "  await clickMatching(page, '^(?:đóng|close|đã hiểu|got it|ok|x|done|xong), '[role=\"button\"], button');";
const fixed = "  await clickMatching(page, '^(?:đóng|close|đã hiểu|got it|ok|x|done|xong)$', '[role=\"button\"], button');";
if (!src.includes(broken)) { console.error('broken line not found'); process.exit(1); }
src = src.split(broken).join(fixed);
fs.writeFileSync(P, src);
console.log('close-regex repaired');
