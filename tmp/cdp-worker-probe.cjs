const PORT = 63986;

async function probe(wsUrl, label, ms = 4000) {
  return new Promise((resolve) => {
    let id = 0;
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => { try { ws.close(); } catch (_) {} resolve(); }, ms + 6000);
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
          self.set(samples[i], (self.get(samples[i]) || 0) + d);
          total += d;
        }
        const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
        console.log('\n=== ' + label + ' | ' + (total / 1000).toFixed(0) + 'ms CPU / ' + ms + 'ms ===');
        for (const [nid, d] of top) {
          const n = byId.get(nid);
          if (!n) continue;
          const cf = n.callFrame;
          const url = (cf.url || '').replace(/^chrome-extension:\/\/[^/]+\//, 'ext/').replace(/^https?:\/\/[^/]+\//, '').slice(0, 60);
          console.log((d / 1000).toFixed(0).padStart(5) + 'ms  ' + ((cf.functionName || '(anon)') + '  ' + url + ':' + (cf.lineNumber + 1)).slice(0, 120));
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
  for (const t of targets) {
    if (t.type === 'iframe') await probe(t.webSocketDebuggerUrl, 'IFRAME ' + (t.url.match(/fbsbx|facebook/) ? 'maw_proxy' : '?'), 3500);
    if (t.type === 'shared_worker') await probe(t.webSocketDebuggerUrl, 'SHARED_WORKER MAW', 3500);
    if (t.type === 'worker') await probe(t.webSocketDebuggerUrl, 'WORKER RST', 3500);
  }
})();
