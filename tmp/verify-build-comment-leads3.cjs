const asar = require('@electron/asar');
const asarPath = 'C:/Users/Admin/AppData/Local/Temp/crm_build_release/win-unpacked/resources/app.asar';
const list = asar.listPackage(asarPath).map((p) => p.replace(/\\/g, '/'));
const get = (p) => asar.extractFile(asarPath, p.replace(/^\/+/, '').split('/').join('\\')).toString('utf8');

const clientAsset = list.find((p) => /client\/assets\/index-.*\.js$/.test(p));
const client = get(clientAsset);
console.log('client asset:', clientAsset);
console.log('account label back:', client.includes('Tài khoản gửi'));
console.log('content label back:', client.includes('Dùng {ten} để chèn tên khách'));
console.log('idle recheck logic:', client.includes('hỏi lại sau 15s'));

const svc = get('dist/server/services/CommentLeadsService.js');
console.log('debugLog file:', svc.includes('comment-leads-debug.log'));
console.log('deep search:', svc.includes('findAccountsArray'));
console.log('request logging:', svc.includes('--> ${method} ${fullUrl}'));
console.log('fetch parsed log:', svc.includes('fetch parsed:'));

const server = get('dist/server/server.js');
console.log('server auto-pick kept:', server.includes("db.prepare('SELECT id FROM accounts').all()"));
console.log('server default template kept:', server.includes('DEFAULT_MESSAGE_TEMPLATE'));
