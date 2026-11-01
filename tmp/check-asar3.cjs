const asar = require('@electron/asar');
const bg = asar.extractFile('release/win-unpacked/resources/app.asar', 'dist\\extension\\background.js').toString();
const checks = [
  ['RECIPIENT_IDENTITY_REJECTED (text+attachment)', (bg.match(/RECIPIENT_IDENTITY_REJECTED/g) || []).length === 2],
  ['RECIPIENT_IDENTITY_MISMATCH error_code', bg.includes("error_code: 'RECIPIENT_IDENTITY_MISMATCH'")],
  ['identityMatches helper', bg.includes('const identityMatches = (expected, visible)')],
  ['identityOk wait in loop', bg.includes('const identityOk = !identityAvailable')],
  ['CDP_ENTER_ROUTE_REJECTED (guard trước đó)', bg.includes('CDP_ENTER_ROUTE_REJECTED')],
  ['warn cũ đã bỏ (SEND_MESSAGE identity warning)', !bg.includes('Contact identity mismatch warning')]
];
let fail = 0;
for (const [name, ok] of checks) { console.log(ok ? 'OK  ' : 'FAIL', name); if (!ok) fail++; }
process.exit(fail ? 1 : 0);
