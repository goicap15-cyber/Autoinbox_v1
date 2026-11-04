const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const dir = path.join(process.env.APPDATA, 'autochatbot-fb-crm', 'data', 'profiles', 'pending_20261007013337_b8olg');
const cookiesPath = path.join(dir, 'Default', 'Network', 'Cookies');
try {
  const db = new DatabaseSync(cookiesPath, { readOnly: true });
  const nowUs = BigInt(Date.now() + 11644473600000) * 1000n;
  const rows = db.prepare(`
    SELECT host_key, name, is_persistent,
           CASE WHEN expires_utc < ? THEN 'EXPIRED' ELSE 'ok' END AS exp
    FROM cookies WHERE host_key LIKE '%facebook%' AND name IN ('c_user','xs','sb','datr') ORDER BY name
  `).all(nowUs.toString());
  console.log(JSON.stringify(rows, null, 1));
} catch (e) {
  console.log('ERR', e.message);
}
