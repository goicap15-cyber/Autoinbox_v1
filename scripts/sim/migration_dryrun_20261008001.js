const assert = require('node:assert/strict');
const db = require('../../src/server/database/db');

const cols = db.pragma('table_info(threads)').map((c) => c.name);
for (const col of ['ad_post_link', 'ad_title', 'ad_photo_url']) {
  assert.ok(cols.includes(col), 'threads thiếu cột ' + col);
}
const applied = db.prepare("SELECT version, name FROM migrations WHERE version = 20261008001").get();
assert.ok(applied && applied.name === 'add_threads_ad_referral', 'migration chưa ghi nhận');

const counts = {
  threads: db.prepare('SELECT COUNT(*) AS count FROM threads').get().count,
  messages: db.prepare('SELECT COUNT(*) AS count FROM messages').get().count,
  pageThreads: db.prepare("SELECT COUNT(*) AS count FROM threads WHERE source_id IS NOT NULL").get().count,
};
console.log('[SIM] threads=' + counts.threads + ' messages=' + counts.messages + ' pageThreads=' + counts.pageThreads);

// Cập nhật thử 1 thread page để chắc cột nhận giá trị thật
const sample = db.prepare("SELECT id FROM threads WHERE source_id IS NOT NULL LIMIT 1").get();
if (sample) {
  db.prepare('UPDATE threads SET ad_post_link = ?, ad_title = ?, ad_photo_url = ? WHERE id = ?')
    .run('https://www.facebook.com/permalink.php?story_fbid=1&id=2', 'Demo', 'https://example.com/a.jpg', sample.id);
  const back = db.prepare('SELECT ad_post_link, ad_title, ad_photo_url FROM threads WHERE id = ?').get(sample.id);
  assert.equal(back.ad_post_link, 'https://www.facebook.com/permalink.php?story_fbid=1&id=2');
  assert.equal(back.ad_title, 'Demo');
  // trả lại null như ban đầu (copy DB, nhưng vẫn giữ thói quen sạch)
  db.prepare('UPDATE threads SET ad_post_link = NULL, ad_title = NULL, ad_photo_url = NULL WHERE id = ?').run(sample.id);
  console.log('[SIM] OK - đọc/ghi 3 cột mới trên thread page thật');
} else {
  console.log('[SIM] Không có thread page để thử đọc/ghi (chỉ assert schema)');
}
console.log('[SIM] MIGRATION DRY-RUN PASS');
db.close();
