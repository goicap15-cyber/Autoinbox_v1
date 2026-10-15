const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { getTestDatabase } = require('../helpers/testDatabase');
const autoReplyEngine = require('../../src/server/services/AutoReplyEngine');

// Helper chạy test trên DB tạm cô lập, bơm vào engine qua _setDbForTests
async function withTestDb(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-auto-reply-test-'));
  const dbFile = path.join(dir, 'test.db');
  const db = getTestDatabase(dbFile);
  autoReplyEngine._setDbForTests(db);
  db.prepare("INSERT INTO accounts (id, name, profile_dir) VALUES ('acc_1', 'Tài khoản Demo', '/tmp/p1')").run();
  db.prepare("INSERT INTO threads (id, account_id, contact_name) VALUES ('thread_1', 'acc_1', 'Khách Hàng')").run();
  db.prepare("INSERT INTO threads (id, account_id, contact_name) VALUES ('thread_2', 'acc_1', 'Khách Khác')").run();
  try {
    return await run(db);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Tạo rule nhanh, trả về id
function makeRule(db, { keywords = [], trigger_keyword = null, template = 'Trả lời mẫu' }) {
  return autoReplyEngine.createRule({ account_id: 'acc_1', keywords, trigger_keyword, response_template: template }).id;
}

// Ghi lại các lần gửi để kiểm tra
function recordingSender(calls) {
  return async (thread_id, text) => { calls.push({ thread_id, text }); };
}

// ── Schema & CRUD ──

test('schema có bảng auto_reply_keywords và auto_reply_fired', () => withTestDb((db) => {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name);
  assert.ok(tables.includes('auto_reply_keywords'));
  assert.ok(tables.includes('auto_reply_fired'));
}));

test('createRule lưu nhiều cụm từ khóa và trigger_keyword giữ cụm đầu', () => withTestDb((db) => {
  const id = makeRule(db, { keywords: ['giá', 'báo giá', 'giá bao nhiêu'] });
  const rows = db.prepare('SELECT keyword, is_active FROM auto_reply_keywords WHERE auto_reply_id = ? ORDER BY id').all(id);
  assert.deepEqual(rows.map(r => r.keyword), ['giá', 'báo giá', 'giá bao nhiêu']);
  assert.ok(rows.every(r => r.is_active === 1));
  const rule = db.prepare('SELECT trigger_keyword FROM auto_replies WHERE id = ?').get(id);
  assert.equal(rule.trigger_keyword, 'giá');
}));

test('createRule tương thích client cũ gửi trigger_keyword đơn lẻ', () => withTestDb((db) => {
  const id = makeRule(db, { trigger_keyword: 'địa chỉ' });
  const rows = db.prepare('SELECT keyword FROM auto_reply_keywords WHERE auto_reply_id = ?').all(id);
  assert.deepEqual(rows.map(r => r.keyword), ['địa chỉ']);
}));

test('getRules trả kèm danh sách từ khóa của từng rule', () => withTestDb((db) => {
  makeRule(db, { keywords: ['giá', 'khuyến mãi'] });
  const rules = autoReplyEngine.getRules('acc_1');
  assert.equal(rules.length, 1);
  assert.equal(rules[0].keywords.length, 2);
  assert.ok(rules[0].keywords.every(k => typeof k.id === 'number' && k.keyword && typeof k.is_active === 'number'));
}));

test('deleteRule CASCADE xóa từ khóa và nhật ký đã trả lời', () => withTestDb((db) => {
  const id = makeRule(db, { keywords: ['giá'] });
  db.prepare('INSERT INTO auto_reply_fired (auto_reply_id, thread_id) VALUES (?, ?)').run(id, 'thread_1');
  autoReplyEngine.deleteRule(id);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM auto_reply_keywords WHERE auto_reply_id = ?').get(id).c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM auto_reply_fired WHERE auto_reply_id = ?').get(id).c, 0);
}));

test('addKeyword thêm cụm, từ chối cụm trống', () => withTestDb((db) => {
  const id = makeRule(db, { keywords: ['giá'] });
  const ok = autoReplyEngine.addKeyword(id, '  báo giá  ');
  assert.equal(ok.success, true);
  assert.equal(ok.keywords.length, 1);
  assert.equal(ok.keywords[0].keyword, 'báo giá');
  const empty = autoReplyEngine.addKeyword(id, '   ');
  assert.equal(empty.success, false);
}));

test('createRule tách chuỗi nhiều cụm cách nhau bởi dấu phẩy', () => withTestDb((db) => {
  const id = makeRule(db, { keywords: ['giá, báo giá', 'giá bao nhiêu'] });
  const rows = db.prepare('SELECT keyword FROM auto_reply_keywords WHERE auto_reply_id = ? ORDER BY id').all(id);
  assert.deepEqual(rows.map(r => r.keyword), ['giá', 'báo giá', 'giá bao nhiêu']);
}));

test('addKeyword tách dấu phẩy và bỏ trùng (không phân biệt hoa thường)', () => withTestDb((db) => {
  const id = makeRule(db, { keywords: ['giá'] });
  const ok = autoReplyEngine.addKeyword(id, 'báo giá, khuyến mãi, GIÁ');
  assert.equal(ok.success, true);
  assert.deepEqual(ok.keywords.map(k => k.keyword).sort(), ['báo giá', 'khuyến mãi']);
  const rows = db.prepare('SELECT keyword FROM auto_reply_keywords WHERE auto_reply_id = ?').all(id);
  assert.deepEqual(rows.map(r => r.keyword).sort(), ['báo giá', 'giá', 'khuyến mãi']);
}));

test('createRule với tài khoản không tồn tại trả lỗi rõ ràng, không ghi dòng nào', () => withTestDb((db) => {
  const result = autoReplyEngine.createRule({
    account_id: '100088912345678', // ID giả modal từng gửi
    keywords: ['giá'],
    response_template: 'Báo giá nè'
  });
  assert.equal(result.success, false);
  assert.match(result.error, /Tài khoản/);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM auto_replies').get().c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM auto_reply_keywords').get().c, 0);
}));

test('createRule thiếu từ khóa hoặc thiếu nội dung trả lỗi rõ ràng', () => withTestDb((db) => {
  const noKw = autoReplyEngine.createRule({ account_id: 'acc_1', keywords: [], response_template: 'X' });
  assert.equal(noKw.success, false);
  assert.match(noKw.error, /từ khóa/);

  const noTemplate = autoReplyEngine.createRule({ account_id: 'acc_1', keywords: ['giá'], response_template: '   ' });
  assert.equal(noTemplate.success, false);
  assert.match(noTemplate.error, /phản hồi/);

  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM auto_replies').get().c, 0);
}));

// ── Matching ──

test('khớp từ khóa không phân biệt hoa thường', () => withTestDb(async (db) => {
  makeRule(db, { keywords: ['Giá'], template: 'Báo giá nè' });
  const calls = [];
  const replied = await autoReplyEngine.processIncoming(
    { thread_id: 'thread_1', content: 'cho mình hỏi GIÁ bao nhiêu' },
    recordingSender(calls)
  );
  assert.equal(replied, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].text, 'Báo giá nè');
}));

test('không khớp thì không gửi và trả false', () => withTestDb(async (db) => {
  makeRule(db, { keywords: ['giá'] });
  const calls = [];
  const replied = await autoReplyEngine.processIncoming(
    { thread_id: 'thread_1', content: 'chào shop' },
    recordingSender(calls)
  );
  assert.equal(replied, false);
  assert.equal(calls.length, 0);
}));

test('cụm dài hơn thắng dù quy tắc ngắn tạo trước (phân biệt sản phẩm A/B)', () => withTestDb(async (db) => {
  const genericId = makeRule(db, { keywords: ['giá'], template: 'Bảng giá chung' });
  const productAId = makeRule(db, { keywords: ['giá sản phẩm A'], template: 'Giá sản phẩm A là 100k' });
  assert.ok(genericId < productAId, 'quy tắc chung phải được tạo trước');

  const calls = [];
  const replied = await autoReplyEngine.processIncoming(
    { thread_id: 'thread_1', content: 'cho hỏi giá sản phẩm A bao nhiêu' },
    recordingSender(calls)
  );
  assert.equal(replied, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].text, 'Giá sản phẩm A là 100k');
}));

test('hỏi chung chung vẫn vào quy tắc "giá"', () => withTestDb(async (db) => {
  makeRule(db, { keywords: ['giá'], template: 'Bảng giá chung' });
  makeRule(db, { keywords: ['giá sản phẩm A'], template: 'Giá sản phẩm A là 100k' });

  const calls = [];
  const replied = await autoReplyEngine.processIncoming(
    { thread_id: 'thread_1', content: 'giá bao nhiêu vậy shop' },
    recordingSender(calls)
  );
  assert.equal(replied, true);
  assert.equal(calls[0].text, 'Bảng giá chung');
}));

test('chỉ trả lời 1 lần cho 1 khách với mỗi quy tắc', () => withTestDb(async (db) => {
  makeRule(db, { keywords: ['giá'], template: 'Báo giá nè' });

  const calls1 = [];
  const first = await autoReplyEngine.processIncoming(
    { thread_id: 'thread_1', content: 'giá bao nhiêu' },
    recordingSender(calls1)
  );
  assert.equal(first, true);
  assert.equal(calls1.length, 1);

  const calls2 = [];
  const second = await autoReplyEngine.processIncoming(
    { thread_id: 'thread_1', content: 'giá bao nhiêu nữa vậy' },
    recordingSender(calls2)
  );
  assert.equal(second, false);
  assert.equal(calls2.length, 0);
}));

test('mỗi khách được trả lời riêng', () => withTestDb(async (db) => {
  makeRule(db, { keywords: ['giá'], template: 'Báo giá nè' });

  const calls = [];
  assert.equal(await autoReplyEngine.processIncoming({ thread_id: 'thread_1', content: 'giá?' }, recordingSender(calls)), true);
  assert.equal(await autoReplyEngine.processIncoming({ thread_id: 'thread_2', content: 'giá?' }, recordingSender(calls)), true);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(c => c.thread_id).sort(), ['thread_1', 'thread_2']);
}));

test('quy tắc đã trả lời rồi thì quy tắc khớp dài kế tiếp được dùng', () => withTestDb(async (db) => {
  const genericId = makeRule(db, { keywords: ['giá'], template: 'Bảng giá chung' });
  makeRule(db, { keywords: ['giá sản phẩm A'], template: 'Giá sản phẩm A là 100k' });

  // Quy tắc chung đã trả lời khách này rồi
  db.prepare('INSERT INTO auto_reply_fired (auto_reply_id, thread_id) VALUES (?, ?)').run(genericId, 'thread_1');

  const calls = [];
  const replied = await autoReplyEngine.processIncoming(
    { thread_id: 'thread_1', content: 'giá sản phẩm A bao nhiêu' },
    recordingSender(calls)
  );
  assert.equal(replied, true);
  assert.equal(calls[0].text, 'Giá sản phẩm A là 100k');
}));

// ── Hai tầng bật/tắt ──

test('tắt cục bộ 1 cụm: cụm đó không khớp, cụm khác vẫn chạy', () => withTestDb(async (db) => {
  const id = makeRule(db, { keywords: ['giá', 'khuyến mãi'], template: 'Trả lời chung' });
  const kwRows = db.prepare('SELECT id, keyword FROM auto_reply_keywords WHERE auto_reply_id = ? ORDER BY id').all(id);
  const khuyenMai = kwRows.find(k => k.keyword === 'khuyến mãi');
  autoReplyEngine.toggleKeyword(khuyenMai.id, false);

  const calls = [];
  assert.equal(await autoReplyEngine.processIncoming({ thread_id: 'thread_1', content: 'có khuyến mãi gì không' }, recordingSender(calls)), false);
  assert.equal(await autoReplyEngine.processIncoming({ thread_id: 'thread_2', content: 'giá bao nhiêu' }, recordingSender(calls)), true);
  assert.equal(calls.length, 1);

  // Bật lại thì cụm hoạt động trở lại (thử trên thread_1 — thread_2 đã bị
  // quy tắc trả lời rồi nên không thể trả lời lần 2)
  autoReplyEngine.toggleKeyword(khuyenMai.id, true);
  assert.equal(await autoReplyEngine.processIncoming({ thread_id: 'thread_1', content: 'có khuyến mãi gì không' }, recordingSender(calls)), true);
}));

test('tắt toàn quy tắc thì mọi cụm đều ngừng', () => withTestDb(async (db) => {
  const id = makeRule(db, { keywords: ['giá', 'báo giá'], template: 'Trả lời chung' });
  autoReplyEngine.toggleRule(id, false);

  const calls = [];
  assert.equal(await autoReplyEngine.processIncoming({ thread_id: 'thread_1', content: 'giá bao nhiêu' }, recordingSender(calls)), false);
  assert.equal(calls.length, 0);
}));

// ── Đánh dấu "đã trả lời" chỉ khi gửi thành công ──

test('gửi lỗi thì không đánh dấu, lần sau được thử lại', () => withTestDb(async (db) => {
  makeRule(db, { keywords: ['giá'], template: 'Báo giá nè' });

  const failingSender = async () => { throw new Error('extension offline'); };
  await assert.rejects(
    autoReplyEngine.processIncoming({ thread_id: 'thread_1', content: 'giá?' }, failingSender),
    /extension offline/
  );
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM auto_reply_fired').get().c, 0);

  const calls = [];
  const replied = await autoReplyEngine.processIncoming(
    { thread_id: 'thread_1', content: 'giá?' },
    recordingSender(calls)
  );
  assert.equal(replied, true);
  assert.equal(calls.length, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM auto_reply_fired').get().c, 1);
}));

// ── Biến cá nhân hóa ──

test('{account_name} lấy tên tài khoản (không phải id) và {ten_khach_hang} lấy tên khách', () => withTestDb(async (db) => {
  makeRule(db, { keywords: ['chào'], template: 'Chào {ten_khach_hang}, mình là {account_name}' });

  const calls = [];
  await autoReplyEngine.processIncoming(
    { thread_id: 'thread_1', content: 'chào shop' },
    recordingSender(calls)
  );
  assert.equal(calls[0].text, 'Chào Khách Hàng, mình là Tài khoản Demo');
}));

test('{keyword} thay bằng cụm từ khóa đã khớp', () => withTestDb(async (db) => {
  makeRule(db, { keywords: ['giá', 'báo giá'], template: 'Bạn hỏi "{keyword}" đúng không?' });

  const calls = [];
  await autoReplyEngine.processIncoming(
    { thread_id: 'thread_1', content: 'báo giá đi shop' },
    recordingSender(calls)
  );
  assert.equal(calls[0].text, 'Bạn hỏi "báo giá" đúng không?');
}));
