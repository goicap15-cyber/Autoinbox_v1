const asar = require('@electron/asar');
const fs = require('fs');
const path = require('path');

const ASAR = path.join(__dirname, 'out-app.asar');
function read(p) {
  return asar.extractFile(ASAR, p.split('/').join('\\')).toString('utf8');
}
let fails = 0;
function check(label, cond) {
  if (!cond) fails++;
  console.log((cond ? 'PASS' : 'FAIL') + ' - ' + label);
}

// NHÁNH SỐNG: dist/client + dist/server (app chạy dist/server, serve dist/client)
const assets = fs.readdirSync(path.join(__dirname, 'tree', 'dist', 'client', 'assets')).filter((f) => /^index-.*\.js$/.test(f));
const bundle = read('dist/client/assets/' + assets[0]);
console.log('dist bundle:', assets[0], bundle.length);
check('LIVE dist/client: mention code', bundle.includes('Nhắc đến mọi người trong cuộc trò chuyện này') && bundle.includes('mentionSuggestions'));
check('LIVE dist/client: fetch mention', bundle.includes('/api/mention-suggestions'));
check('LIVE dist/client: MENTION_SUGGESTIONS socket', bundle.includes('MENTION_SUGGESTIONS'));

const liveServer = read('dist/server/server.js');
check('LIVE dist/server: sendViaExtension mentions', liveServer.includes('client_message_id, mentions'));
check('LIVE dist/server: route mention-suggestions', liveServer.includes('/api/mention-suggestions'));
check('LIVE dist/server: FETCH_MENTION_SUGGESTIONS_RESULT', liveServer.includes('FETCH_MENTION_SUGGESTIONS_RESULT'));
const livePageApi = read('dist/server/services/PageApiService.js');
check('LIVE dist/server: reclaimPages (patch11)', livePageApi.includes('function reclaimPages'));

// root client/server đồng bộ cho chắc
const rootServer = read('server/server.js');
check('root server: mentions passthrough', rootServer.includes('/api/mention-suggestions'));
const rootClientAssets = fs.readdirSync(path.join(__dirname, 'tree', 'client', 'assets')).filter((f) => /^index-.*\.js$/.test(f));
const rootBundle = read('client/assets/' + rootClientAssets[0]);
check('root client: mention code', rootBundle.includes('mentionSuggestions'));

console.log(fails === 0 ? 'ALL PASS' : 'FAILURES: ' + fails);
process.exit(fails === 0 ? 0 : 1);
