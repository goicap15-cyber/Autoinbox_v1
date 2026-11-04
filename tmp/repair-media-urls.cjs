// One-off repair: điền media_url cho các message media của page source bị NULL
// (insert trước khi có enrichAttachmentUrls). Dùng node:sqlite — chạy được cả khi app đang mở (WAL).
process.env.PAGE_TOKEN_SECRET = 'hunghel1oss';
const path = require('path');
const ROOT = 'C:/Users/Admin/Downloads/Duan/CRM_FB1';
const { DatabaseSync } = require('node:sqlite');
const { decryptToken } = require(path.join(ROOT, 'src/server/utils/tokenEncryption'));

const LIVE_DB = 'C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/database.db';
const db = new DatabaseSync(LIVE_DB);
db.exec('PRAGMA busy_timeout = 15000');
db.exec('PRAGMA journal_mode = WAL');

const sources = db.prepare(`
  SELECT id, external_id, access_token_encrypted FROM inbox_sources
  WHERE source_type = 'page_messenger' AND access_token_encrypted IS NOT NULL
`).all();
console.log('sources có token:', sources.map((s) => s.external_id).join(', '));

async function urlForAttachments(mid, token) {
  const res = await fetch(`https://graph.facebook.com/v21.0/${mid}/attachments?fields=mime_type,name,image_data,video_data,audio_data,file_url&access_token=${token}`);
  const data = await res.json().catch(() => ({}));
  if (data.error) { console.log('  Graph error cho', mid, ':', data.error.message); return null; }
  const full = (data.data || [])[0];
  if (!full) return null;
  return full.image_data?.url || full.video_data?.url || full.video_data?.preview_url || full.audio_data?.url || full.file_url || null;
}

(async () => {
  for (const s of sources) {
    const token = decryptToken(s.access_token_encrypted);
    if (!token) { console.log(s.external_id, ': token lỗi'); continue; }
    const rows = db.prepare(`
      SELECT m.id, m.fb_message_id, m.media_type FROM messages m
      JOIN threads t ON t.id = m.thread_id
      WHERE t.source_id = ? AND m.media_type IN ('image','video','voice','file')
        AND (m.media_url IS NULL OR m.media_url = '')
    `).all(s.id);
    console.log(s.external_id, ': cần sửa', rows.length, 'row media');
    let fixed = 0;
    for (const r of rows) {
      if (!r.fb_message_id) continue;
      const url = await urlForAttachments(r.fb_message_id, token);
      if (url) {
        db.prepare("UPDATE messages SET media_url = ? WHERE id = ? AND (media_url IS NULL OR media_url = '')").run(url, r.id);
        fixed++;
        console.log('  fixed id=' + r.id, r.media_type, url.slice(0, 60));
      }
      await new Promise((res) => setTimeout(res, 300));
    }
    console.log('  done:', fixed + '/' + rows.length);
  }
  db.close();
  console.log('HOÀN TẤT');
})();
