const asar = require('@electron/asar');
const B = String.fromCharCode(92);
const asarPath = ['C:', 'Users', 'Admin', 'Downloads', 'Duan', 'CRM_FB1', 'release', 'win-unpacked', 'resources', 'app.asar'].join(B);
const injected = asar.extractFile(asarPath, 'dist' + B + 'extension' + B + 'injected.js').toString();
const content = asar.extractFile(asarPath, 'dist' + B + 'extension' + B + 'content.js').toString();
const markers = {
  'msgMeta threadKey (root fix)': /msgMeta\?\.threadKey\?\.threadFbId/,
  'msgMeta actorFbId': /msgMeta\?\.actorFbId/,
  'sawVideoAttachment': /sawVideoAttachment/,
  'relayMediaType': /relayMediaType/,
  'mimeType image detection': /\^image\\\/\/i\.test\(val\)/,
  'content.js Map dedupe': /relayedNetworkMids\.get\(midKey\)/,
  'content.js placeholder gate': /\(netMsg\.media_type \|\| 'text'\) === 'text'\) return;/,
  'instr CRM_MQTT_DEBUG': /CRM_MQTT_DEBUG/,
  'instr MQTT_FRAME_JSON': /MQTT_FRAME_JSON/,
  'instr MSG_NODE': /MSG_NODE/,
  'instr EMIT_BLOCKED': /EMIT_BLOCKED/,
  'instr WS_NEW': /WS_NEW/,
  'instr WS_DATA': /WS_DATA/,
  'content instr netDbg': /netDbg/,
  'content instr NO_THREAD_OR_MID': /NO_THREAD_OR_MID/,
  'content instr DEDUP_PLACEHOLDER': /DEDUP_PLACEHOLDER/,
  'content instr RELAYED': /RELAYED/
};
let fail = 0;
for (const [name, re] of Object.entries(markers)) {
  const target = name.startsWith('content') ? content : injected;
  const ok = re.test(target);
  console.log(`${ok ? 'OK  ' : 'MISS'} ${name}`);
  if (!ok) fail++;
}
process.exit(fail ? 1 : 0);
