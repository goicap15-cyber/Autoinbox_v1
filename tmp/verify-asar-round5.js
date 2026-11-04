const asar = require('@electron/asar');
const B = String.fromCharCode(92);
const asarPath = ['C:', 'Users', 'Admin', 'Downloads', 'Duan', 'CRM_FB1', 'release', 'win-unpacked', 'resources', 'app.asar'].join(B);
const injected = asar.extractFile(asarPath, 'dist' + B + 'extension' + B + 'injected.js').toString();
const content = asar.extractFile(asarPath, 'dist' + B + 'extension' + B + 'content.js').toString();
const background = asar.extractFile(asarPath, 'dist' + B + 'extension' + B + 'background.js').toString();
const observer = asar.extractFile(asarPath, 'dist' + B + 'extension' + B + 'sidebarActivityObserver.js').toString();
const markers = {
  'root fix msgMeta threadKey': [/msgMeta\?\.threadKey\?\.threadFbId/, injected],
  'sawVideoAttachment': [/sawVideoAttachment/, injected],
  'prefix strip for(;;)': [/prefixMatch/, injected],
  'PARSE_MISS debug': [/PARSE_MISS/, injected],
  'CAPTURE_SKIP_PAGE guard': [/CAPTURE_SKIP_PAGE/, injected],
  'CAPTURE_MISS_SLOTS debug': [/CAPTURE_MISS_SLOTS/, injected],
  'replay QUERY_TEMPLATE_CAPTURED': [/QUERY_TEMPLATE_CAPTURED/, injected],
  'replay REPLAY_DONE': [/REPLAY_DONE/, injected],
  'replay CRM_FETCH_THREAD listener': [/data\.type === 'CRM_FETCH_THREAD'/, injected],
  'replay dtsg stored': [/latestDtsg = decodeURIComponent/, injected],
  'content relay CRM_QUERY_TEMPLATE': [/CRM_QUERY_TEMPLATE/, content],
  'content relay CRM_FETCH_THREAD': [/msg\.type === 'CRM_FETCH_THREAD'/, content],
  'background hint trigger': [/triggerGraphqlFastFetch\(sender/, background],
  'background HINT entry log': [/stage: 'HINT'/, background],
  'obs OBS_INSTALLED': [/OBS_INSTALLED/, observer],
  'obs HINT_SENT': [/HINT_SENT/, observer],
  'obs OBS_NO_ROWS': [/OBS_NO_ROWS/, observer],
  'obs messenger.com support': [/isMessengerHost/, observer],
  'obs messenger /t/ selector': [/a\[href\*="\/t\/"\]/, observer]
};
let fail = 0;
for (const [name, [re, target]] of Object.entries(markers)) {
  const ok = re.test(target);
  console.log(`${ok ? 'OK  ' : 'MISS'} ${name}`);
  if (!ok) fail++;
}
process.exit(fail ? 1 : 0);
