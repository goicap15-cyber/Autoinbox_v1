const fs = require('fs');
const path = require('path');

const asarPath = 'C:/Users/Admin/Downloads/Duan/CRM_FB1/release/win-unpacked/resources/app.asar';
const extBg = 'C:/Users/Admin/Downloads/Duan/CRM_FB1/release/win-unpacked/resources/extension/background.js';
const distDir = 'C:/Users/Admin/Downloads/Duan/CRM_FB1/release/win-unpacked/resources/app.asar';

// Build41 markers + all prior fixes must survive
const markers = [
  { name: 'ext: href_spoof_click (build37)', file: 'extbg', needle: 'href_spoof_click' },
  { name: 'ext: SYNC_JOB log (build38)', file: 'extbg', needle: "stage: 'SYNC_JOB'" },
  { name: 'ext: SPA_NAV log (build38)', file: 'extbg', needle: "stage: 'SPA_NAV'" },
  { name: 'ext: WS_RECV_STALE self-heal (build39)', file: 'extbg', needle: 'WS_RE_REGISTER' },
  { name: 'ext: lock renewal crm_navigation only (build40)', file: 'extbg', needle: "=== 'crm_navigation'" },
  { name: 'ext: sidebar_incoming bypass lock (build40)', file: 'extbg', needle: "baseReason !== 'sidebar_incoming'" },
  { name: 'asar server: WS_REMAPPED zombie fix (build39)', file: 'asar', needle: 'WS_REMAPPED' },
  { name: 'asar server: zombie previousIsZombie (build39)', file: 'asar', needle: 'previousIsZombie' },
  { name: 'asar server: MEDIA_HINT bumpedAtIso (build41)', file: 'asar', needle: 'bumpedAtIso' },
  { name: 'asar server: text-preview last_activity bump (build41)', file: 'asar', needle: 'last_activity = CURRENT_TIMESTAMP, is_unread = 1' },
  { name: 'asar client: THREAD_UNREAD_CHANGED last_activity (build41)', file: 'asar', needle: 'last_activity' },
];

// extract server.js + client bundle from asar
const asar = require('C:/Users/Admin/Downloads/Duan/CRM_FB1/node_modules/@electron/asar');
const B = String.fromCharCode(92);
function extractFromAsar(parts) {
  return asar.extractFile(asarPath, parts.join(B));
}

let ok = 0, fail = 0;
const serverBuf = extractFromAsar(['dist', 'server', 'server.js']);
console.log('server.js extracted:', serverBuf.length, 'bytes');

// find client bundle in asar
const asarList = asar.listPackage(asarPath);
const distFiles = asarList.filter((f) => f.includes('assets') && f.endsWith('.js') && f.includes('index-'));
console.log('client bundles in asar:', distFiles.slice(0, 5));

let clientSrc = '';
if (distFiles.length) {
  const inner = distFiles[0].replace(/^\\+/, '');
  clientSrc = extractFromAsar(inner.split(/[\\/]/)).toString('utf8');
  console.log('client bundle:', inner, clientSrc.length, 'bytes');
}

const extSrc = fs.readFileSync(extBg, 'utf8');
console.log('ext background.js:', extSrc.length, 'bytes');

for (const m of markers) {
  let src = '';
  if (m.file === 'extbg') src = extSrc;
  else if (m.file === 'asar') { src = serverBuf.toString('utf8') + '\n' + clientSrc; }
  const hit = src.includes(m.needle);
  if (hit) { ok++; console.log('  PASS', m.name); }
  else { fail++; console.log('  FAIL', m.name); }
}

console.log(`\n${ok}/${ok + fail} PASS`);
process.exit(fail ? 1 : 0);
