// Smoke test PageApiService + AppSetupAutomation (chạy bằng ELECTRON_RUN_AS_NODE
// để đúng ABI better-sqlite3; data ở thư mục tạm CRM_DATA_ROOT — không đụng data thật)
process.env.CRM_DATA_ROOT = require('path').resolve(__dirname, 'test-data');
process.env.PAGE_TOKEN_SECRET = process.env.PAGE_TOKEN_SECRET || 'test-secret';

const db = require('../src/server/database/db');
const pageApi = require('../src/server/services/PageApiService');
const setup = require('../src/server/services/AppSetupAutomation');

let pass = 0, fail = 0;
const ok = (cond, name) => { if (cond) { pass++; console.log('  ✅', name); } else { fail++; console.log('  ❌', name); } };

console.log('— Schema & KV config —');
pageApi.ensureSchema(db);
const t = pageApi.getOrCreateVerifyToken();
ok(/^crmwb_[0-9a-f]{32}$/.test(t), 'verify token tạo đúng định dạng: ' + t.slice(0, 12) + '…');
ok(pageApi.getOrCreateVerifyToken() === t, 'verify token giữ nguyên lần gọi sau');

console.log('— Bridge URL —');
pageApi.setBridgeUrl('https://example.com/webhook.php?key=SHOULD_BE_STRIPPED');
ok(pageApi.getGlobalConfig().bridge_url === 'https://example.com/webhook.php', 'bridge URL lưu và cắt query');

console.log('— App records —');
db.prepare("DELETE FROM page_api_config WHERE key = 'account:acc1'").run();
pageApi.appAdd('acc1', { appId: '111', name: 'CRM', email: 'a@b.c', status: 'success', note: 'n1', pages: [] });
pageApi.appAdd('acc1', { appId: '222', name: 'CRM2', email: 'a@b.c', status: 'success', note: 'n2', pages: [] });
ok(pageApi.appGetLatest('acc1')?.appId === '222', 'appGetLatest = app mới nhất');
pageApi.appUpdate('acc1', '222', { status: 'error', note: 'err' });
ok(pageApi.appGetLatest('acc1').status === 'error', 'appUpdate áp dụng patch');
ok(pageApi.appList('acc1').length === 2, 'appList có 2 bản ghi');
pageApi.appRemove('acc1', '222');
ok(pageApi.appGetLatest('acc1')?.appId === '111', 'appRemove xóa đúng bản ghi');
ok(pageApi.appGetLatest('accX') === null, 'account lạ trả null');

console.log('— Pages upsert (inbox_sources) —');
pageApi.upsertPages('acc1', [
  { pageId: '1001', name: 'Page A' },
  { pageId: '1002', name: 'Page B' },
]);
const rows = pageApi.listPages('acc1');
ok(rows.length === 2, 'upsert tạo 2 page source: ' + rows.map((r) => r.pageId).join(', '));
ok(rows.every((r) => r.name), 'page có tên');

console.log('— DEPS mapping của automation —');
setup.configurePageSetupAutomation({
  getOrCreateVerifyToken: () => pageApi.getOrCreateVerifyToken(),
  upsertPages: (a, p) => pageApi.upsertPages(a, p),
  listPages: (a) => pageApi.listPages(a),
  savePages: (a, p) => pageApi.savePages(a, p),
  appAdd: (a, r) => pageApi.appAdd(a, r),
  appUpdate: (a, id, patch) => pageApi.appUpdate(a, id, patch),
  appGetLatest: (a) => pageApi.appGetLatest(a),
  appRemove: (a, id) => pageApi.appRemove(a, id),
  appList: (a) => pageApi.appList(a),
  getCookies: async () => [],
  recordRun: () => {},
  onStatus: () => {},
  dataDir: process.env.CRM_DATA_ROOT,
});
ok(true, 'configurePageSetupAutomation nhận deps không lỗi');
ok(setup.getActive() === null, 'không có job active lúc đầu');
const r = setup.startAppCreation('test', '', '', 'acc1');
ok(!r.error && r.job && r.job.id, 'startAppCreation tạo job (sẽ fail ở getCookies — đúng kịch bản, cookie rỗng)');
// đợi job fail do cookie rỗng
setTimeout(() => {
  ok(setup.getActive() === null, 'job tự fail & dọn dẹp khi cookie rỗng');
  console.log(`\nKết quả: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
}, 1500);
