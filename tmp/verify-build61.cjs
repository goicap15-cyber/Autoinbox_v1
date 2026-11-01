const asar = require('@electron/asar');
const path = require('path');
const fs = require('fs');
const asarPath = path.join('release', 'win-unpacked', 'resources', 'app.asar');
const server = asar.extractFile(asarPath, 'dist/server/server.js'.split('/').join(path.sep));
const s = server.toString('utf8');
const checks = [
  ['sweeper SELECT content/created_at', /SELECT id, fb_message_id, content, created_at FROM messages/],
  ['sweeper no failed emit (block)', null],
  ['sweeper keep-pending log', /Sweeper giữ pending/],
  ['sweeper capturedElsewhere dedupe', /fb_message_id LIKE 'mid\.%' OR fb_message_id LIKE '%@msgr\.%'/],
  ['sweeper content param', /pending\.content \?\? text/],
  ['page_id via getThreadSource', /page_id: ConversationRepository\.getThreadSource\(thread\.id\)\.pageId/],
];
let ok = true;
for (const [name, re] of checks) {
  if (re === null) continue;
  const found = re.test(s);
  console.log((found ? 'PASS' : 'FAIL') + ' - ' + name);
  if (!found) ok = false;
}
const start = s.indexOf('Never leave the CRM bubble pending forever');
const end = s.indexOf('}, 30000);', start);
const sweeper = s.slice(start, end);
const noFail = !/MESSAGE_SEND_FAILED/.test(sweeper);
console.log((noFail ? 'PASS' : 'FAIL') + ' - sweeper block has no MESSAGE_SEND_FAILED');
if (!noFail) ok = false;
console.log(ok ? 'ALL_OK' : 'SOME_FAILED');
