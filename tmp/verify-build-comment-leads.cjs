const asar = require('@electron/asar');
const asarPath = 'C:/Users/Admin/AppData/Local/Temp/crm_build_release/win-unpacked/resources/app.asar';
const get = (p) => asar.extractFile(asarPath, p.split('/').join('\\')).toString('utf8');

const client = get('dist/client/assets/index-DTOxN9BP.js');
console.log('client modal:', client.includes('Khách bình luận bài viết'));
console.log('client scan route:', client.includes('/api/comment-leads/scan'));
console.log('client enqueue route:', client.includes('/api/comment-leads/enqueue'));
console.log('client reply socket:', client.includes('COMMENT_LEAD_REPLIED'));

const server = get('dist/server/server.js');
console.log('server require:', server.includes("require('./services/CommentLeadsService')"));
console.log('server scan route:', server.includes("app.post('/api/comment-leads/scan'"));
console.log('server enqueue route:', server.includes("app.post('/api/comment-leads/enqueue'"));
console.log('server markQueueSent hook:', server.includes('CommentLeadsService.markQueueSent'));
console.log('server markQueueFailed hook:', server.includes('CommentLeadsService.markQueueFailed'));
console.log('server reply watcher:', server.includes('CommentLeadsService.startReplyWatcher'));

const svc = get('dist/server/services/CommentLeadsService.js');
console.log('service scanPost:', svc.includes('by-post/scan'));
console.log('service insertCampaignDispatch:', svc.includes('insertCampaignDispatch'));
console.log('service thread_url uid:', svc.includes('facebook.com/messages/t/'));
console.log('service timestamp comparator:', svc.includes('julianday(m.timestamp_ms / 1000.0'));
console.log('service idempotency:', svc.includes('comment_lead_'));

const db = get('dist/server/database/db.js');
console.log('migration 20261013001:', db.includes('20261013001'), '| table:', db.includes('CREATE TABLE IF NOT EXISTS comment_leads'));

const bg = get('dist/extension/background.js');
console.log('extension 11c intact:', bg.includes('group-h3-article-label-fix 2026-10-11c'));
console.log('extension quote skip:', bg.includes('inReplyQuote'));
