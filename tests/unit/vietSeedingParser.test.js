const { test } = require('node:test');
const assert = require('node:assert');
const { parseCookieAccounts } = require('../../src/server/services/VietSeedingImportService');

test('parse: chuỗi cookie "n=v; n2=v2" trong item', () => {
  const out = parseCookieAccounts([
    { username: 'user_a', cookies: 'c_user=1001; xs=ABC123; datr=xyz' }
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].identifier, '1001');
  const names = out[0].cookies.map((c) => c.name).sort();
  assert.deepEqual(names, ['c_user', 'datr', 'xs']);
});

test('parse: mảng cookie {name,value,domain} + identifier uid', () => {
  const out = parseCookieAccounts({
    data: [
      { uid: 2002, cookies: [
        { name: 'c_user', value: '2002', domain: '.facebook.com' },
        { name: 'xs', value: '4:abc' }
      ] }
    ]
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].identifier, '2002');
  assert.equal(out[0].cookies[0].domain, '.facebook.com');
});

test('parse: cookie dạng object map', () => {
  const out = parseCookieAccounts({ items: [
    { id: 'acc_3', cookies: { c_user: '3003', xs: 'X9' } }
  ] });
  assert.equal(out.length, 1);
  assert.equal(out[0].identifier, '3003');
});

test('parse: bỏ item thiếu c_user/xs (cookie rác)', () => {
  const out = parseCookieAccounts([
    { username: 'datr_only', cookies: 'datr=abc' },
    { username: 'ok', cookies: 'c_user=1001; xs=abc' }
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].identifier, '1001');
});

test('parse: identifier rơi về c_user ưu tiên hơn username', () => {
  const out = parseCookieAccounts([
    { username: 'tên hiển thị', c_user: '4004', cookies: 'c_user=4004; xs=k' }
  ]);
  assert.equal(out[0].identifier, '4004');
});

test('parse: payload lạ trả mảng rỗng thay vì nổ', () => {
  assert.deepEqual(parseCookieAccounts(null), []);
  assert.deepEqual(parseCookieAccounts({ unexpected: 1 }), []);
  assert.deepEqual(parseCookieAccounts('str'), []);
});

test('parse: cookie value rỗng bị bỏ, không nổ', () => {
  const out = parseCookieAccounts([
    { cookies: [{ name: 'c_user', value: '' }, { name: 'xs', value: 'keep' }] }
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].cookies.length, 1);
  assert.equal(out[0].cookies[0].name, 'xs');
});

test('parse: mảng cookie string trần', () => {
  const out = parseCookieAccounts({ data: ['c_user=5001; xs=A1', 'c_user=5002; xs=B2'] });
  assert.equal(out.length, 2);
  assert.equal(out[0].identifier, '5001');
  assert.equal(out[1].identifier, '5002');
});

test('parse: object map uid -> cookie string', () => {
  const out = parseCookieAccounts({ success: true, cookies: { 6001: 'c_user=6001; xs=Z9', 6002: 'c_user=6002; xs=Y8' } });
  assert.equal(out.length, 2);
  assert.equal(out[0].identifier, '6001');
});

test('parse: cookie trải trực tiếp trên item (c_user/xs là field)', () => {
  const out = parseCookieAccounts({ data: [
    { username: 'u1', password: 'secret', c_user: '7001', xs: 'X1', datr: 'D1' }
  ] });
  assert.equal(out.length, 1);
  assert.equal(out[0].identifier, '7001');
  const names = out[0].cookies.map((c) => c.name).sort();
  assert.deepEqual(names, ['c_user', 'datr', 'xs']); // password/username không thành cookie
});

test('parse: mảng lồng 1 tầng data.list', () => {
  const out = parseCookieAccounts({ data: { list: [
    { uid: '8001', cookies: 'c_user=8001; xs=W1' }
  ] } });
  assert.equal(out.length, 1);
  assert.equal(out[0].identifier, '8001');
});

test('describePayload: chỉ in tên field + type, không in giá trị', () => {
  const { describePayload } = require('../../src/server/services/VietSeedingImportService');
  const s = describePayload({ success: true, code: 200, data: [{ username: 'abc', cookie: 'c_user=1; xs=SECRET' }] });
  assert.ok(s.includes('success:boolean'));
  assert.ok(s.includes('cookie:string'));
  assert.ok(!s.includes('SECRET'));
  assert.ok(!s.includes('c_user=1'));
});
