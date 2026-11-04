const asar = require('@electron/asar');
const B = String.fromCharCode(92);
const p = ['C:', 'Users', 'Admin', 'Downloads', 'Duan', 'CRM_FB1', 'release', 'win-unpacked', 'resources', 'app.asar'].join(B);
const inj = asar.extractFile(p, ['dist', 'extension', 'injected.js'].join(B)).toString();
const con = asar.extractFile(p, ['dist', 'extension', 'content.js'].join(B)).toString();
const markers = [
  ['msgMeta threadKey (ROOT FIX)', /msgMeta\?\.threadKey\?\.threadFbId/.test(inj)],
  ['msgMeta actorFbId', /msgMeta\?\.actorFbId/.test(inj)],
  ['sawVideoAttachment', /sawVideoAttachment/.test(inj)],
  ['relayMediaType', /relayMediaType/.test(inj)],
  ['mimeType image detect', /sawImageAttachment = true/.test(inj)],
  ['content Map dedupe', /relayedNetworkMids\.get\(midKey\)/.test(con)],
  ['placeholder gate', /\(netMsg\.media_type \|\| 'text'\) === 'text'\) return;/.test(con)]
];
let fail = 0;
for (const [name, ok] of markers) {
  console.log((ok ? 'OK   ' : 'MISS ') + name);
  if (!ok) fail++;
}
process.exit(fail ? 1 : 0);
