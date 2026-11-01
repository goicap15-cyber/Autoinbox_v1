const fs = require('fs');
const path = require('path');
const profileRoot = 'C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/profiles';
const profileDir = fs.readdirSync(profileRoot).sort((a, b) => {
  const sa = fs.statSync(path.join(profileRoot, a)).mtimeMs;
  const sb = fs.statSync(path.join(profileRoot, b)).mtimeMs;
  return sb - sa;
})[0];
const PORT = Number(fs.readFileSync(path.join(profileRoot, profileDir, 'DevToolsActivePort'), 'utf8').split('\n')[0].trim());

async function probe(wsUrl, label, ms = 4000) {
  return new Promise((resolve) => {
    let id = 0;
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => { try { ws.close(); } catch (_) {} resolve(); }, ms + 5000);
    ws.onopen = () => {
      ws.send(JSON.stringify({ id: ++id, method: 'Profiler.enable' }));
      ws.send(JSON.stringify({ id: ++id, method: 'Profiler.start' }));
      setTimeout(() => ws.send(JSON.stringify({ id: ++id, method: 'Profiler.stop' })), ms);
    };
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id === 3 && m.result && m.result.profile) {
        const { nodes, samples, timeDeltas } = m.result.profile;
        const byId = new Map(nodes.map((n) => [n.id, n]));
        const self = new Map();
        let total = 0;
        for (let i = 0; i < samples.length; i++) {
          const d = timeDeltas[i] || 0;
          if (d <= 0) continue;
          const nid = samples[i];
          self.set(nid, (self.get(nid) || 0) + d);
          total += d;
        }
        const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
        console.log('\n=== ' + label + ' | total ' + (total / 1000).toFixed(0) + 'ms CPU trong ' + ms + 'ms ===');
        for (const [nid, d] of top) {
          const n = byId.get(nid);
          if (!n) continue;
          const cf = n.callFrame;
          const url = (cf.url || '').replace(/^chrome-extension:\/\/[^/]+\//, 'ext/').replace(/^https?:\/\/[^/]+\//, '');
          console.log(
            (d / 1000).toFixed(0).padStart(5) + 'ms  ' +
            ((cf.functionName || '(anon)') + '  ' + url + ':' + (cf.lineNumber + 1)).slice(0, 130)
          );
        }
        clearTimeout(timer);
        try { ws.close(); } catch (_) {}
        resolve();
      }
    };
    ws.onerror = () => { console.log(label + ' ERR'); clearTimeout(timer); resolve(); };
  });
}

(async () => {
  const res = await fetch('http://127.0.0.1:' + PORT + '/json/list');
  const targets = await res.json();
  const pick = [];
  for (const t of targets) {
    if (t.type === 'page' && t.url.includes('/messages/t/')) pick.push(['TAB ' + t.url.split('/t/')[1].slice(0, 15), t.webSocketDebuggerUrl]);
    if (t.type === 'service_worker') pick.push(['SW extension', t.webSocketDebuggerUrl]);
  }
  for (const [label, wsUrl] of pick) await probe(wsUrl, label, 4000);
})();
