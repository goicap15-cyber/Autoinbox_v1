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

const bundleName = fs.readdirSync(path.join(__dirname, 'tree', 'client', 'assets')).find((f) => /^index-.*\.js$/.test(f));
const bundle = read('client/assets/' + bundleName);
check('client bundle tồn tại: ' + bundleName, bundle.length > 100000);
check('composer: mentionMembers prop', bundle.includes('mentionMembers'));
check('composer: mọi người subtitle', bundle.includes('Nhắc đến mọi người trong cuộc trò chuyện này'));
check('composer: scanMention query trim', bundle.includes('.query.trim('));
check('composer: everyone row', bundle.includes('everyone'));
check('composer: avatars prefix', bundle.includes('/api/avatars/'));

const patch11 = read('server/services/PageApiService.js');
check('patch11 vẫn còn: reclaimPages', patch11.includes('function reclaimPages'));

console.log(fails === 0 ? 'ALL PASS' : 'FAILURES: ' + fails);
process.exit(fails === 0 ? 0 : 1);
