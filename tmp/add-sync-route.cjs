const fs = require('fs');
const P = 'src/server/server.js';
let src = fs.readFileSync(P, 'utf8');
const NL = src.includes('\r\n') ? '\r\n' : '\n';

const ROUTE = [
  '// "Đồng bộ": quét danh sách page của account (cuộn tải hết), chỉ THÊM page mới',
  '// — page đã có trong hệ thống (mọi trạng thái) thì bỏ qua.',
  "app.post('/api/page-api/accounts/:id/sync-pages', async (req, res) => {",
  "  if (!enterpriseAccess.canAccessAccount(req.user, req.params.id)) {",
  "    return res.status(404).json({ success: false, error: 'Không tìm thấy tài khoản Facebook' });",
  '  }',
  '  const r = setupAutomation.startPageSync(String(req.params.id));',
  "  if (r.error) return res.status(409).json({ success: false, error: r.error });",
  '  res.json({ success: true, sync_id: r.job.id });',
  '});',
  '',
].join(NL);

const anchor = '// "Lấy token & Đăng ký": chạy lại phần cấu hình webhook + cào page + đăng ký field + lấy token';
if (!src.includes(anchor)) { console.error('route anchor not found'); process.exit(1); }
if (src.includes('/api/page-api/accounts/:id/sync-pages')) { console.log('route already present'); process.exit(0); }
src = src.replace(anchor, ROUTE + NL + anchor);
fs.writeFileSync(P, src);
console.log('route added');
