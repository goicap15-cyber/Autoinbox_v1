const fs = require('fs');
const server = fs.readFileSync('src/server/server.js', 'utf8');
const background = fs.readFileSync('src/extension/background.js', 'utf8');
const checks = [
  ['bg family strip', /const echoFamilyMid = echoMid\.replace\(\/__bubble_\\d\+\$\/, ''\);/.test(background)],
  ['bg bool family', /const echoHasRealMid = Boolean\(echoFamilyMid\)/.test(background)],
  ['bg prefix family', /&& !\/\^\(\?:dom_\|pending_\|history_\)\/\.test\(echoFamilyMid\)/.test(background)],
  ['squat cond', /if \(insertMsgResult\.changes === 0 && \/__bubble_\\d\+\/\.test\(String\(stableMessageId\)\)\)/.test(server)],
  ['squat window', /AND datetime\(created_at\) >= datetime\('now', '-900 seconds'\)/.test(server)],
  ['squat only IN2OUT', /Number\(squatterRow\.is_outgoing\) === 0\s*\n\s*&& isOutgoing && directionStatus === 'confirmed'/.test(server)],
  ['squat marker', server.includes("syncDebug('WS_FIX_FLIPPED_SQUATTER'")],
  ['squat update', /UPDATE messages SET is_outgoing = 1, sender_role = 'operator',/.test(server)],
];
for (const [name, ok] of checks) console.log(ok ? 'PASS' : 'FAIL', name);
const i = server.indexOf("Number(squatterRow.is_outgoing) === 0");
console.log(JSON.stringify(server.slice(i - 20, i + 140)));
