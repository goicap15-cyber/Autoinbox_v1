// Harness: chạy đúng code watchPageConversations của app trên DB COPY.
process.env.PAGE_TOKEN_SECRET = 'hunghel1oss';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = 'C:/Users/Admin/Downloads/Duan/CRM_FB1';
const SRC = path.join(ROOT, 'src/server/services/PageApiService.js');
const COPY_DB = path.join(ROOT, 'tmp/watcher-test.db');

// 1. Copy live DB
const LIVE_DB = 'C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/database.db';
fs.copyFileSync(LIVE_DB, COPY_DB);

// 2. Compile PageApiService với export thêm các hàm nội bộ (để test đúng code thật)
const src = fs.readFileSync(SRC, 'utf8');
const patched = src + '\nmodule.exports._test = { watchPageConversations, insertGraphMessage, ensurePageThread, graphGet };\n';
const m = new Module(SRC);
m.filename = SRC;
m.paths = Module._nodeModulePaths(path.dirname(SRC));
m._compile(patched, SRC);
const pageApi = m.exports._test;

// 3. Mở DB copy bằng better-sqlite3 (giống app — có .transaction)
const Database = require(path.join(ROOT, 'node_modules/better-sqlite3'));
const db = new Database(COPY_DB);
db.pragma('journal_mode = WAL');

const source = db.prepare("SELECT id, external_id, display_name, owner_account_id, status, access_token_encrypted FROM inbox_sources WHERE id = 'src_page_683923444796165'").get();
console.log('SOURCE:', JSON.stringify({ id: source.id, external_id: source.external_id, owner: source.owner_account_id, status: source.status, hasToken: !!source.access_token_encrypted }));

(async () => {
  const fakeIo = { emit: (ev, payload) => console.log('  [io.emit]', ev, JSON.stringify(payload).slice(0, 120)) };

  // Xem Graph trả gì trước
  const { decryptToken } = require(path.join(ROOT, 'src/server/utils/tokenEncryption'));
  const token = decryptToken(source.access_token_encrypted);
  const convs = await pageApi.graphGet(source.external_id + '/conversations', { fields: 'id,updated_time,participants', limit: '25', access_token: token }, db);
  console.log('GRAPH /conversations error:', convs.error ? convs.error.message : '(none)', '| count:', (convs.data || []).length);
  for (const c of (convs.data || [])) {
    const part = (c.participants?.data || []).map(p => p.id).join(',');
    console.log('  conv', c.id, 'updated', c.updated_time, 'participants', part);
  }

  try {
    await pageApi.watchPageConversations(source, fakeIo, db);
    console.log('watchPageConversations OK — kiểm tra DB...');
  } catch (e) {
    console.log('watchPageConversations THROW:', e && e.message);
    console.log(e && e.stack);
  }

  const check = db.prepare("SELECT id, content, datetime(timestamp_ms/1000,'unixepoch','localtime') t, fb_message_id, is_outgoing FROM messages WHERE content IN ('Zmmzz','Kszkzkzz','vcvccvc','Dkdkkđ','Dkkdkkkđ') OR content LIKE '%zmmz%'").all();
  console.log('INSERTED MATCHES:', JSON.stringify(check, null, 1));

  const newest = db.prepare("SELECT id, content, datetime(timestamp_ms/1000,'unixepoch','localtime') t FROM messages WHERE thread_id='39065684943075776' ORDER BY timestamp_ms DESC LIMIT 4").all();
  console.log('NEWEST IN THREAD:', JSON.stringify(newest, null, 1));
  db.close();
})();
