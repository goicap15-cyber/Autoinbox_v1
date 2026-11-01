// Verify task #15 markers in the packed release (asar + extension dir).
const fs = require('fs');
const path = require('path');
const B = path.sep;
const { extractFile, listPackage } = require('@electron/asar');

const base = process.argv[2] || 'C:/Users/Admin/AppData/Local/Temp/crm_build_release/win-unpacked';
const asarPath = path.join(base, 'resources', 'app.asar');

function readAsar(relParts) {
  return extractFile(asarPath, relParts.join(B)).toString('utf8');
}

let fail = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' | ' + detail : ''}`);
  if (!ok) fail++;
}

// 1. server: member avatar pipeline markers
const serverSrc = readAsar(['dist', 'server', 'server.js']);
check('server: upsertMemberAvatar', serverSrc.includes('upsertMemberAvatar'));
check('server: WS_MEMBER_AVATAR_SAVED', serverSrc.includes('WS_MEMBER_AVATAR_SAVED'));
check('server: member_name realtime insert', serverSrc.includes("m.member_name || ''"));
check('server: NEW_MESSAGE sender_avatar mapping', serverSrc.includes('m.member_avatar || undefined'));
check('server: history avatar jobs', serverSrc.includes('memberAvatarJobs'));

// 2. server repo: sender_name column in INSERT
const repoSrc = readAsar(['dist', 'server', 'repositories', 'ConversationRepository.js']);
check('repo: sender_name column', repoSrc.includes('sender_id, sender_name, content'));
check('repo: member_name persist', repoSrc.includes('msg.member_name'));

// 3. db.js migration
const dbSrc = readAsar(['dist', 'server', 'database', 'db.js']);
check('db: migration 20261011001', dbSrc.includes('20261011001'));
check('db: message_sender_avatars table', dbSrc.includes('message_sender_avatars'));

// 4. client bundle: group member render markers (minifier mangles local
// identifiers - probe string literals only)
const entries = listPackage(asarPath).map((e) => String(e).replace(/^[\\/]/, ''));
const clientBundle = entries.find((e) => /^dist[\\/]client[\\/]assets[\\/]index-.*\.js$/.test(e));
check('client: bundle found', Boolean(clientBundle), clientBundle || 'missing');
if (clientBundle) {
  const clientSrc = readAsar(clientBundle.split(B));
  check('client: sender_avatar_url read', clientSrc.includes('sender_avatar_url'));
  check('client: member name span className', clientSrc.includes('mb-0.5 ml-1 select-text'));
}

// 5. extension background (outside asar, obfuscated)
const extPath = path.join(base, 'resources', 'extension', 'background.js');
let extExists = fs.existsSync(extPath);
let extSize = extExists ? fs.statSync(extPath).size : 0;
check('extension: background.js exists', extExists, String(extSize));
if (extExists) {
  const extSrc = fs.readFileSync(extPath, 'utf8');
  // obfuscator keeps string literals (encoded or plain) - probe both patterns
  check('extension: member_name payload', extSrc.includes('member_name'));
  check('extension: avatar harvest probe', extSrc.includes('fbcdn'));
}

console.log(fail === 0 ? 'ALL_MARKERS_OK' : `MARKERS_FAILED=${fail}`);
process.exit(fail === 0 ? 0 : 1);
