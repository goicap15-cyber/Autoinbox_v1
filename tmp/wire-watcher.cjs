const fs = require('fs');
const P = 'src/server/server.js';
let src = fs.readFileSync(P, 'utf8');
const NL = src.includes('\r\n') ? '\r\n' : '\n';

// 1) startPageConversationWatcher sau poller
if (!src.includes('pageApiService.startPageConversationWatcher(io')) {
  const pollerLine = '  pageApiService.startBridgePolling(io, db, 5000);';
  if (!src.includes(pollerLine)) { console.error('poller line not found'); process.exit(1); }
  src = src.replace(pollerLine, pollerLine + NL +
    '  // T\u1EF1 \u0111\u1ED9ng \u0111\u1ED3ng b\u1ED9 h\u1ED9i tho\u1EA1i page 10s/l\u1EA7n \u2014 kh\u00E1ch nh\u1EAFn l\u00E0 tin t\u1EF1 v\u1EC1 CRM' + NL +
    '  pageApiService.startPageConversationWatcher(io, db, 10000);');
  console.log('watcher wired');
} else console.log('watcher already wired');

// 2) removeUntokenedPages sau watcher
if (!src.includes('pageApiService.removeUntokenedPages(db)')) {
  const watcherLine = '  pageApiService.startPageConversationWatcher(io, db, 10000);';
  src = src.replace(watcherLine, watcherLine + NL +
    '  // Quy t\u1EAFc: page ch\u1EC9 t\u1ED3n t\u1EA1i khi c\u00F3 token (do app t\u1EA1o ra) \u2014 d\u1ECDn page m\u1ED3 c\u00F4i' + NL +
    '  pageApiService.removeUntokenedPages(db);');
  console.log('removeUntokened wired');
} else console.log('removeUntokened already wired');

fs.writeFileSync(P, src);

// 3) XÁC MINH NGAY (không tin tưởng replace âm thầm nữa)
const check = fs.readFileSync(P, 'utf8');
console.log('VERIFY src watcher:', check.includes('pageApiService.startPageConversationWatcher(io'));
console.log('VERIFY src removeUntokened:', check.includes('pageApiService.removeUntokenedPages(db)'));
if (!check.includes('pageApiService.startPageConversationWatcher(io')) process.exit(1);
