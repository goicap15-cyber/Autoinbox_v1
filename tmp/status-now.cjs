const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const DB = path.join(process.env.APPDATA, 'autochatbot-fb-crm', 'data', 'database.db');
const BASE = 'http://127.0.0.1:5050';
const token = crypto.randomBytes(32).toString('base64url');
const hash = crypto.createHash('sha256').update(token).digest('hex');
const db = new DatabaseSync(DB);
db.exec('PRAGMA busy_timeout = 10000');
db.prepare("INSERT INTO auth_sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)").run(15, hash, new Date(Date.now() + 3600000).toISOString());
db.close();
fetch(BASE + '/api/page-api/sync-status', { headers: { Cookie: 'crm_session=' + token } })
  .then(r => r.text())
  .then(t => { console.log(t.slice(0, 1500)); });
