const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { getTestDatabase } = require('../helpers/testDatabase');
const { buildAdPostLink, applyAdReferral } = require('../../src/server/services/PageApiService');

function withDatabase(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autochatbot-test-'));
  const filename = path.join(dir, 'database.db');
  const db = getTestDatabase(filename);
  try { return run(db); } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}

function makeSource(db) {
  db.prepare('INSERT INTO accounts (id, name, profile_dir) VALUES (?, ?, ?)').run('acct-1', 'Test', '/tmp/test');
  db.prepare(`
    INSERT INTO inbox_sources (id, source_type, owner_account_id, external_id, display_name, status)
    VALUES ('src-page-1', 'page_messenger', 'acct-1', '111222333', 'Page test', 'ACTIVE')
  `).run();
  return {
    id: 'src-page-1',
    source_type: 'page_messenger',
    owner_account_id: 'acct-1',
    external_id: '111222333',
    display_name: 'Page test',
    status: 'ACTIVE',
  };
}

test('buildAdPostLink dựng permalink từ post_id dạng owner_story', () => {
  assert.equal(
    buildAdPostLink({ ads_context_data: { post_id: '123456789_987654321' } }, '111222333'),
    'https://www.facebook.com/permalink.php?story_fbid=987654321&id=123456789'
  );
});

test('buildAdPostLink post_id trần ghép với pageId', () => {
  assert.equal(
    buildAdPostLink({ ads_context_data: { post_id: '555000111' } }, '111222333'),
    'https://www.facebook.com/permalink.php?story_fbid=555000111&id=111222333'
  );
});

test('buildAdPostLink không có post_id thì dùng ad_id vào ads library', () => {
  assert.equal(
    buildAdPostLink({ ad_id: 'AD-777' }, '111222333'),
    'https://www.facebook.com/ads/library/?id=AD-777'
  );
});

test('buildAdPostLink không đủ dữ liệu trả null', () => {
  assert.equal(buildAdPostLink({ source: 'ADS', type: 'OPEN_THREAD' }, '111222333'), null);
  assert.equal(buildAdPostLink(null, '111222333'), null);
});

test('applyAdReferral referral-only event ADS lưu link + title + ảnh lên thread', () => withDatabase((db) => {
  const source = makeSource(db);
  const handled = applyAdReferral({
    sender: { id: 'PSID-1' },
    recipient: { id: '111222333' },
    timestamp: 1000,
    referral: {
      ref: 'SPAM_BLOCK',
      ad_id: 'AD-777',
      source: 'ADS',
      type: 'OPEN_THREAD',
      ads_context_data: {
        ad_title: 'Bàn phím cơ giá rẻ',
        photo_url: 'https://example.com/ad.jpg',
        post_id: '123456789_987654321',
      },
    },
  }, source, null, db);

  assert.equal(handled, true);
  const thread = db.prepare('SELECT * FROM threads WHERE id = ?').get('PSID-1');
  assert.ok(thread);
  assert.equal(thread.ad_post_link, 'https://www.facebook.com/permalink.php?story_fbid=987654321&id=123456789');
  assert.equal(thread.ad_title, 'Bàn phím cơ giá rẻ');
  assert.equal(thread.ad_photo_url, 'https://example.com/ad.jpg');
}));

test('applyAdReferral referral trong postback và message đều được bắt', () => withDatabase((db) => {
  const source = makeSource(db);
  assert.equal(applyAdReferral({
    sender: { id: 'PSID-2' },
    recipient: { id: '111222333' },
    postback: { payload: 'GET_STARTED', referral: { source: 'ADS', ad_id: 'AD-1', ads_context_data: { post_id: '1_2' } } },
  }, source, null, db), true);
  assert.equal(applyAdReferral({
    sender: { id: 'PSID-3' },
    recipient: { id: '111222333' },
    message: { mid: 'm.1', text: 'quan tâm', referral: { source: 'ADS', ads_context_data: { post_id: '3_4' } } },
  }, source, null, db), true);

  const t2 = db.prepare('SELECT ad_post_link FROM threads WHERE id = ?').get('PSID-2');
  const t3 = db.prepare('SELECT ad_post_link FROM threads WHERE id = ?').get('PSID-3');
  assert.equal(t2.ad_post_link, 'https://www.facebook.com/permalink.php?story_fbid=2&id=1');
  assert.equal(t3.ad_post_link, 'https://www.facebook.com/permalink.php?story_fbid=4&id=3');
}));

test('applyAdReferral bỏ qua referral không phải ADS và event không có referral', () => withDatabase((db) => {
  const source = makeSource(db);
  assert.equal(applyAdReferral({
    sender: { id: 'PSID-4' },
    recipient: { id: '111222333' },
    referral: { source: 'MESSENGER', type: 'OPEN_THREAD' },
  }, source, null, db), false);
  assert.equal(applyAdReferral({
    sender: { id: 'PSID-5' },
    recipient: { id: '111222333' },
    message: { mid: 'm.2', text: 'hello' },
  }, source, null, db), false);

  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM threads').get().count, 0);
}));
