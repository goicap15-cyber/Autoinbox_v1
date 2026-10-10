const { getTestDatabase } = require('../helpers/testDatabase');
const { encryptToken } = require('../../src/server/utils/tokenEncryption');

function seedOperator(db) {
  db.prepare("INSERT OR IGNORE INTO users (id, username, password_hash, role) VALUES (1, 'admin', 'test', 'ADMIN')").run();
}

function seedPageThread(db, {
  id,
  accountId = 'acct-1',
  sourceId = 'src-page-1',
  pageId = 'page-1',
  contactName,
  accountStatus = 'ACTIVE',
  sourceStatus = 'ACTIVE',
  optOut = false,
  noToken = false
} = {}) {
  db.prepare(`
    INSERT OR IGNORE INTO accounts (id, name, profile_dir, status)
    VALUES (?, ?, ?, ?)
  `).run(accountId, 'Test account', '/tmp/autochatbot-campaign-test', accountStatus);
  db.prepare(`
    INSERT OR IGNORE INTO inbox_sources
      (id, source_type, owner_account_id, external_id, display_name, status, access_token_encrypted)
    VALUES (?, 'page_messenger', ?, ?, ?, ?, ?)
  `).run(sourceId, accountId, pageId, 'Test page', sourceStatus, noToken ? null : encryptToken('test-page-token-' + pageId));
  db.prepare(`
    INSERT INTO threads (id, external_thread_id, account_id, source_id, contact_name)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, id, accountId, sourceId, contactName || id);
  db.prepare(`
    INSERT INTO contacts (thread_id, name, campaign_opt_out)
    VALUES (?, ?, ?)
  `).run(id, contactName || id, optOut ? 1 : 0);
  return id;
}

function seedPersonalThread(db, { id, accountId = 'acct-1' } = {}) {
  const sourceId = 'src-personal-' + accountId;
  db.prepare(`
    INSERT OR IGNORE INTO accounts (id, name, profile_dir, status)
    VALUES (?, ?, ?, 'ACTIVE')
  `).run(accountId, 'Personal account', '/tmp/autochatbot-campaign-test');
  db.prepare(`
    INSERT OR IGNORE INTO inbox_sources
      (id, source_type, external_id, display_name, status)
    VALUES (?, 'personal_messenger', ?, ?, 'ACTIVE')
  `).run(sourceId, accountId, 'Personal account');
  db.prepare(`
    INSERT INTO threads (id, external_thread_id, account_id, source_id, contact_name)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, id, accountId, sourceId, id);
  return id;
}

function withCampaignDatabase(run) {
  const db = getTestDatabase(':memory:');
  seedOperator(db);
  const result = Promise.resolve().then(() => run(db));
  return result.finally(() => db.close());
}

module.exports = { seedPageThread, seedPersonalThread, withCampaignDatabase };
