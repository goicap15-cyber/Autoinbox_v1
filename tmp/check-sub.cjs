const { DatabaseSync } = require('node:sqlite');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
(async () => {
  const envTxt = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
  const m = envTxt.match(/^PAGE_TOKEN_SECRET=(.*)$/m);
  const secret = (m ? m[1] : 'default-insecure-key-change-me').trim().replace(/^"|"$/g, '');
  console.log('secret:', JSON.stringify(secret));
  const key = crypto.createHash('sha256').update(secret).digest();
  const db = new DatabaseSync(path.join(process.env.APPDATA, 'autochatbot-fb-crm', 'data', 'database.db'), { readOnly: true });
  for (const pageId of ['683923444796165', '664031873456106']) {
    const row = db.prepare("SELECT id, access_token_encrypted FROM inbox_sources WHERE source_type='page_messenger' AND external_id=?").get(pageId);
    if (!row) { console.log(pageId, ': no row'); continue; }
    const parts = String(row.access_token_encrypted || '').split(':');
    if (parts.length !== 3) { console.log(pageId, ': bad format'); continue; }
    const iv = Buffer.from(parts[0], 'hex'), tag = Buffer.from(parts[1], 'hex');
    const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
    d.setAuthTag(tag);
    const token = Buffer.concat([d.update(parts[2], 'hex'), d.final()]).toString('utf8');
    console.log(pageId, 'token len', token.length, 'prefix', token.slice(0, 12));
    const url = `https://graph.facebook.com/v21.0/${pageId}/subscribed_apps?access_token=${encodeURIComponent(token)}`;
    const t = await (await fetch(url)).text();
    console.log('  subscribed_apps:', t.slice(0, 300));
  }
})();
