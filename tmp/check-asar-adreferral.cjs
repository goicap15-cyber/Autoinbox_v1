const path = require('path');
const fs = require('fs');
const asar = require('@electron/asar');
const B = path.sep;
const base = 'C:/Users/Admin/Downloads/Duan/CRM_FB1/release/win-unpacked/resources/app.asar';

function extract(rel) {
  const parts = rel.split('/').join(B).replace(/^\\+/, '');
  return asar.extractFile(base, parts).toString('utf8');
}

const server = extract('dist/server/server.js');
const pageApi = extract('dist/server/services/PageApiService.js');
const dbJs = extract('dist/server/database/db.js');

function has(name, text, markers) {
  for (const m of markers) {
    console.log(name + ' | ' + (text.includes(m) ? 'OK  ' : 'MISS') + ' | ' + m);
  }
}

has('server.js     ', server, ['resubscribeAllPages(db).catch', 'startPageConversationWatcher']);
has('PageApiService', pageApi, ['messaging_referrals', 'applyAdReferral', 'buildAdPostLink', 'resubscribeAllPages', "subscribed_fields: PAGE_SUBSCRIBE_FIELDS.join(',')"]);
has('db.js         ', dbJs, ['add_threads_ad_referral', 'ad_post_link', '20261008001']);

const entries = asar.listPackage(base).map((e) => String(e).replace(/^\\+/, ''));
const bundleFiles = entries.filter((e) => /^dist\\client\\assets\\index-.*\.js$/.test(e) || /^dist\/client\/assets\/index-.*\.js$/.test(e));
const bundle = bundleFiles.map((f) => extract(f.split(B).join('/'))).join('\n');
console.log('client bundle   | ' + (bundle.includes('ad_post_link') && bundle.includes('trả lời') ? 'OK  ' : 'MISS') + ' | ad_post_link + pattern trong ' + bundleFiles.length + ' file');
console.log('client bundle   | ' + (bundle.includes('Bài viết quảng cáo') ? 'OK  ' : 'MISS') + ' | fallback title card');

const ext = fs.readFileSync('C:/Users/Admin/Downloads/Duan/CRM_FB1/release/win-unpacked/resources/extension/background.js', 'utf8');
console.log('extension dir   | ' + (ext.length > 1000 ? 'OK   (ngoài asar, size=' + ext.length + ')' : 'MISS'));
