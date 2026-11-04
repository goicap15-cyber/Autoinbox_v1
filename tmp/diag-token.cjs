const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const crypto = require('crypto');
const db = new DatabaseSync(path.join(process.env.APPDATA, 'autochatbot-fb-crm', 'data', 'database.db'), { readOnly: true });
const row = db.prepare(`SELECT access_token_encrypted FROM inbox_sources WHERE external_id='664031873456106'`).get();
db.close();
function decrypt(enc) {
  const [ivHex, tagHex, dataHex] = enc.split(':');
  const key = crypto.createHash('sha256').update('default-insecure-key-change-me').digest();
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  d.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([d.update(Buffer.from(dataHex, 'hex')), d.final()]).toString('utf8');
}
let token;
try { token = decrypt(row.access_token_encrypted); }
catch (e) { console.log('DECRYPT_FAIL (secret khac fallback?):', e.message); process.exit(0); }
console.log('token prefix:', token.slice(0, 6) + '... len=' + token.length);
(async () => {
  const r1 = await fetch('https://graph.facebook.com/v21.0/me?access_token=' + encodeURIComponent(token)).then(r => r.json()).catch(e => ({ fetch_err: e.message }));
  console.log('GET /me =>', JSON.stringify(r1).slice(0, 400));
  const r2 = await fetch('https://graph.facebook.com/v21.0/1070082442529828?fields=name,status&access_token=' + encodeURIComponent(token)).then(r => r.json()).catch(e => ({ fetch_err: e.message }));
  console.log('GET /app =>', JSON.stringify(r2).slice(0, 400));
})();
