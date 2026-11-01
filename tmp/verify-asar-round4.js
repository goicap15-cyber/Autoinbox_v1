const asar = require('@electron/asar');
const B = String.fromCharCode(92);
const asarPath = ['C:', 'Users', 'Admin', 'Downloads', 'Duan', 'CRM_FB1', 'release', 'win-unpacked', 'resources', 'app.asar'].join(B);
const injected = asar.extractFile(asarPath, 'dist' + B + 'extension' + B + 'injected.js').toString();
const content = asar.extractFile(asarPath, 'dist' + B + 'extension' + B + 'content.js').toString();
const background = asar.extractFile(asarPath, 'dist' + B + 'extension' + B + 'background.js').toString();
const markers = {
  'root fix msgMeta threadKey': /msgMeta\?\.threadKey\?\.threadFbId/,
  'root fix msgMeta actorFbId': /msgMeta\?\.actorFbId/,
  'sawVideoAttachment': /sawVideoAttachment/,
  'relayMediaType': /relayMediaType/,
  'snippet field': /obj\.snippet/,
  'thread_key other_user_id': /obj\.thread_key\?\.other_user_id/,
  'instr CRM_MQTT_DEBUG': /CRM_MQTT_DEBUG/,
  'replay captureGraphqlTemplate': /captureGraphqlTemplate/,
  'replay QUERY_TEMPLATE_CAPTURED': /QUERY_TEMPLATE_CAPTURED/,
  'replay REPLAY_DONE': /REPLAY_DONE/,
  'replay CRM_FETCH_THREAD listener': /data\.type === 'CRM_FETCH_THREAD'/,
  'replay dtsg stored': /latestDtsg = decodeURIComponent/,
  'replay nullify cursor': /cursor\|before\|after\|until/,
  'content relay CRM_QUERY_TEMPLATE': /CRM_QUERY_TEMPLATE/,
  'content relay CRM_FETCH_RESULT': /CRM_FETCH_RESULT/,
  'content relay CRM_FETCH_THREAD': /msg\.type === 'CRM_FETCH_THREAD'/,
  'content netDbg': /netDbg/,
  'background handleCrmQueryTemplate': /handleCrmQueryTemplate/,
  'background triggerGraphqlFastFetch': /triggerGraphqlFastFetch/,
  'background session storage': /crmGraphqlTemplate:/,
  'background hint trigger': /triggerGraphqlFastFetch\(sender/
};
let fail = 0;
for (const [name, re] of Object.entries(markers)) {
  const target = name.startsWith('content') ? content : (name.startsWith('background') ? background : injected);
  const ok = re.test(target);
  console.log(`${ok ? 'OK  ' : 'MISS'} ${name}`);
  if (!ok) fail++;
}
process.exit(fail ? 1 : 0);
