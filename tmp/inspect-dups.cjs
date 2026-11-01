const http = require('http');
const COOKIE = 'crm_session=LXkAInlZg7SaW0w2PreU7MzLVXlaYE_F45hKinhmD6M';
function get(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: 5050, path, headers: { Cookie: COOKIE } }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve(null); } });
    }).on('error', reject);
  });
}
(async () => {
  const threads = await get('/api/threads?account_id=100004449999465&limit=60');
  if (!Array.isArray(threads)) { console.log('threads fail'); return; }
  let checked = 0;
  for (const t of threads.slice(0, 12)) {
    const msgs = await get(`/api/threads/${t.id}/messages?limit=40`);
    if (!Array.isArray(msgs)) continue;
    const byContent = new Map();
    for (const m of msgs) {
      const c = (m.content || '').trim();
      if (!c || c.length < 4) continue;
      if (!byContent.has(c)) byContent.set(c, []);
      byContent.get(c).push(m);
    }
    for (const [c, rows] of byContent) {
      if (rows.length >= 3) {
        checked++;
        console.log(`\nTHREAD ${t.id} (${t.contact_name}) content=${JSON.stringify(c.substring(0, 20))} x${rows.length}`);
        for (const m of rows) {
          const tms = Number(m.timestamp_ms) || Date.parse(m.timestamp) || 0;
          const tstr = tms ? new Date(tms).toISOString().substring(11, 19) : '?';
          console.log(`  id=${m.id} fb=${String(m.fb_message_id).substring(0, 30)} src=${m.source || '?'} out=${m.is_outgoing} ts=${tstr}`);
        }
      }
      if (checked >= 4) break;
    }
    if (checked >= 4) break;
  }
  if (!checked) console.log('no x3+ duplicate contents found in first 12 threads');
})();
