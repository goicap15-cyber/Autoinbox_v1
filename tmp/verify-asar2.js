const asar = require('@electron/asar');
const fs = require('fs');
const path = require('path');
const BS = String.fromCharCode(92);
const archive = 'C:' + BS + 'Users' + BS + 'Admin' + BS + 'Downloads' + BS + 'Duan' + BS + 'CRM_FB1' + BS + 'release' + BS + 'win-unpacked' + BS + 'resources' + BS + 'app.asar';

const checks = [
  ['dist' + BS + 'server' + BS + 'repositories' + BS + 'ConversationRepository.js',
    'excluded.timestamp_ms < messages.timestamp_ms'],
  ['dist' + BS + 'server' + BS + 'services' + BS + 'OutboundDomCorrelationService.js',
    'CASE WHEN timestamp_ms > 0 THEN timestamp_ms WHEN ? > 0 THEN ?'],
  ['dist' + BS + 'server' + BS + 'server.js', 'BACKEND_COMPOSER_MEDIA_CONFIRMED'],
  ['dist' + BS + 'server' + BS + 'server.js', 'contentAlreadyInThread'],
  ['dist' + BS + 'server' + BS + 'server.js', 'let extensionHealthMonitor = null'],
  ['dist' + BS + 'extension' + BS + 'background.js', 'cosmetic updates'],
  ['dist' + BS + 'extension' + BS + 'content.js', 'lastReportedTokens'],
];
let fail = 0;
for (const [file, marker] of checks) {
  let ok = false;
  try {
    const buf = asar.extractFile(archive, file);
    ok = buf.toString('utf8').includes(marker);
  } catch (e) {
    console.log('ERR extracting', file, e.message);
    fail++; continue;
  }
  console.log(ok ? 'OK  ' : 'MISS', marker.slice(0, 55), '<-', file);
  if (!ok) fail++;
}
const asarStat = fs.statSync(archive);
console.log('asar mtime:', asarStat.mtime.toISOString());
const rendererDir = 'C:' + BS + 'Users' + BS + 'Admin' + BS + 'Downloads' + BS + 'Duan' + BS + 'CRM_FB1' + BS + 'release' + BS + 'win-unpacked' + BS + 'resources' + BS + 'app.asar.unpacked';
process.exit(fail ? 1 : 0);
