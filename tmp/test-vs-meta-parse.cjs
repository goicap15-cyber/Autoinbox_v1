// Test parser meta (name/status) — payload GIẢ, không gọi API, không có cookie thật.
const svc = require('../src/server/services/VietSeedingImportService');

const payload = {
  data: [
    { uid: '111', name: 'Tài Khoản A', status: 'Live', cookies: 'c_user=111; xs=aaa' },
    { uid: '222', name: 'Tài Khoản B', status: 'Die', cookies: 'c_user=222; xs=bbb' },
    { username: 'user3', status: 'live', c_user: '333', xs: 'ccc', name: 'Tài Khoản C' },
    { uid: '444', status: 0, cookies: 'c_user=444; xs=ddd' }
  ]
};
const out = svc.parseCookieAccounts(payload);
console.log(JSON.stringify(out.map((a) => ({ identifier: a.identifier, name: a.name, status: a.status, cookieCount: a.cookies.length })), null, 2));

const ok = out.length === 4
  && out[0].name === 'Tài Khoản A' && out[0].status === 'Live'
  && out[1].status === 'Die'
  && out[2].identifier === '333' && out[2].name === 'Tài Khoản C'
  && out[3].status === '0';
console.log(ok ? 'PARSE_META_OK' : 'PARSE_META_FAIL');
process.exit(ok ? 0 : 1);
