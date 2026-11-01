const path = require('path');
const asar = require('@electron/asar');

const newAsar = 'C:/Users/Admin/Downloads/Duan/CRM_FB1/tmp/asar-patch/out2/app.asar';
const B = '\\';

function get(p) {
  return asar.extractFile(newAsar, p.split('/').join(B).replace(/^\\/, ''));
}

const serverJs = get('dist/server/server.js').toString('utf8');
const serviceJs = get('dist/server/services/CommentLeadsService.js').toString('utf8');

function check(label, hay, needle) {
  console.log(label, hay.includes(needle) ? 'PASS' : 'FAIL');
}

check('server: postUrl passed      ', serverJs, 'postUrl: req.body?.post_url');
check('server: accountId passed     ', serverJs, 'accountId,\n      content:');
check('server: old snake_case gone  ', !serverJs.includes('post_url: req.body?.post_url') ? 'PASS' : 'FAIL');
check('server: 409 log present      ', serverJs, "debugLog('enqueue: chặn 409");
check('server: request log present  ', serverJs, 'enqueue: request account=');
check('service: entry log present   ', serviceJs, 'enqueue: vào service postUrl=');
check('service: debugLog exported   ', serviceJs, '  debugLog,');

const fs = require('fs');
const oldNode = fs.readFileSync('C:/Users/Admin/Downloads/Duan/CRM_FB1/release/win-unpacked/resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node');
const newNode = fs.readFileSync('C:/Users/Admin/Downloads/Duan/CRM_FB1/tmp/asar-patch/out2/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node');
console.log('native better_sqlite3.node identical:', oldNode.equals(newNode) ? 'PASS' : 'FAIL');
