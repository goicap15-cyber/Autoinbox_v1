const asar = require('@electron/asar');
const asarPath = 'C:/Users/Admin/AppData/Local/Temp/crm_build_release/win-unpacked/resources/app.asar';
const get = (p) => asar.extractFile(asarPath, p.split('/').join('\\').replace(/^\\/, '')).toString('utf8');

const list = asar.listPackage(asarPath).map((p) => p.replace(/\\/g, '/'));
const clientAsset = list.find((p) => /client\/assets\/index-.*\.js$/.test(p));
const client = get(clientAsset);
console.log('client asset:', clientAsset);
console.log('no account select label:', !client.includes('Tài khoản gửi'));
console.log('no content label:', !client.includes('Nội dung tin nhắn'));
console.log('auto note present:', client.includes('Quét xong tự đẩy toàn bộ khách'));

const server = get('dist/server/server.js');
console.log('server auto-pick account:', server.includes("db.prepare('SELECT id FROM accounts').all()"));
console.log('server default template fallback:', server.includes('DEFAULT_MESSAGE_TEMPLATE'));

const svc = get('dist/server/services/CommentLeadsService.js');
console.log('service template const:', svc.includes('Chào {ten}! Mình thấy bạn vừa bình luận'));
console.log('service export template:', svc.includes('DEFAULT_MESSAGE_TEMPLATE'));
