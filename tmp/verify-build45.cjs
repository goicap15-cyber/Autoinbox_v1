// Verify build45 asar chua Fix A + Fix C markers.
const path = require('path');
const fs = require('fs');
const asar = require(path.join('C:/Users/Admin/Downloads/Duan/CRM_FB1/node_modules/@electron/asar'));
const asarPath = 'C:/Users/Admin/Downloads/Duan/CRM_FB1/release/win-unpacked/resources/app.asar';

const PROBES = [
  ['dist/extension/background.js', ['SYNC_LANE_TAKEOVER', 'incoming_grace_15s']],
  ['dist/server/server.js', ['PREVIEW_BUMP_REPEAT', 'row_fresh: rowFresh', 'unread_flipped: unreadFlippedToIncoming', 'else if (changed.row_fresh_new || changed.unread_flipped)', 'rowTimePrevSeen', 'row_fresh_new: rowFreshNew', 'isUnreadNow || !lastMsgMatches']],
  ['dist/server/utils/sidebarIncomingDetection.js', ['rowFreshNew === true', 'rowFreshNew = false', 'const samePreview']],
  ['dist/server/server.js', ['hasRecentMatchingOutbound,\r\n                  rowFreshNew']]
];

let bad = 0;
for (const [file, markers] of PROBES) {
  let content;
  try {
    content = asar.extractFile(asarPath, file.split('/').join(path.sep)).toString('utf8');
  } catch (e) {
    console.error('EXTRACT FAIL ' + file + ': ' + e.message);
    bad += 1;
    continue;
  }
  for (const m of markers) {
    const ok = content.includes(m);
    if (!ok) bad += 1;
    console.log((ok ? 'PASS' : 'FAIL') + ' ' + file + ' :: ' + m);
  }
}
const stat = fs.statSync(asarPath);
console.log('asar mtime:', stat.mtime.toISOString(), 'size:', stat.size);
process.exit(bad ? 1 : 0);
