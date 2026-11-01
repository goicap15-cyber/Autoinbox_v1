const http = require('http');
const COOKIE = 'crm_session=LXkAInlZg7SaW0w2PreU7MzLVXlaYE_F45hKinhmD6M';
const seen = new Set();
const out = [];

function get(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: 5050, path, headers: { Cookie: COOKIE } }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve([]); } });
    }).on('error', reject);
  });
}

function ts(v) { return v ? new Date(v).toISOString().substring(11, 20) : '?'; }

async function poll() {
  try {
    const threads = await get('/api/threads?account_id=100004449999465&limit=200');
    const fresh = threads.filter((t) => t.last_activity && (Date.now() - new Date(t.last_activity).getTime()) < 240000);
    for (const t of fresh) {
      const msgs = await get(`/api/threads/${t.id}/messages?limit=15`);
      for (const m of msgs.reverse()) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        const sent = Number(m.timestamp_ms) || new Date(m.timestamp).getTime();
        const created = new Date(m.created_at).getTime();
        const latency = sent && created ? Math.round((created - sent) / 1000) : null;
        const line = `${new Date().toISOString().substring(11, 20)} NEW ${m.media_type || 'text'} thread=${t.id}(${t.contact_name}) sent=${sent ? new Date(sent).toISOString().substring(11, 20) : '?'} created=${ts(m.created_at)} latency=${latency == null ? '?' : latency + 's'} url=${(m.media_url || '').substring(0, 30) || '-'} content=${JSON.stringify((m.content || '')).substring(0, 24)}`;
        out.push(line);
        console.log(line);
      }
    }
  } catch (e) {
    console.log(`${new Date().toISOString().substring(11, 20)} ERR ${String(e.message).substring(0, 80)}`);
  }
}

console.log('watch started');
setInterval(poll, 8000);
poll();
