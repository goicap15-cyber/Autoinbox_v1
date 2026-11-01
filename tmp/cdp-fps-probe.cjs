const fs = require('fs');
const path = require('path');
const profileRoot = 'C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/profiles';
const ports = fs.readdirSync(profileRoot)
  .map((d) => path.join(profileRoot, d, 'DevToolsActivePort'))
  .filter((p) => { try { fs.accessSync(p); return true; } catch (_) { return false; } })
  .map((p) => Number(fs.readFileSync(p, 'utf8').split('\n')[0].trim()))
  .filter((p) => p > 0);

async function evalOn(wsUrl, label, expr) {
  return new Promise((resolve) => {
    let id = 0;
    const ws = new WebSocket(wsUrl);
    const t = setTimeout(() => { try { ws.close(); } catch (_) {} resolve(null); }, 8000);
    ws.onopen = () => ws.send(JSON.stringify({
      id: ++id, method: 'Runtime.evaluate',
      params: { expression: expr, awaitPromise: true, returnByValue: true }
    }));
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id === 1) {
        clearTimeout(t);
        try { ws.close(); } catch (_) {}
        console.log('=== ' + label + ' ===');
        console.log(JSON.stringify(m.result?.result?.value ?? m.result, null, 1).slice(0, 600));
        resolve();
      }
    };
    ws.onerror = () => { clearTimeout(t); resolve(); };
  });
}

(async () => {
  for (const port of ports) {
    let targets;
    try {
      const res = await fetch('http://127.0.0.1:' + port + '/json/list');
      targets = await res.json().then((l) => l.filter((t) => t.type === 'page' && t.url.includes('/messages/t/')));
    } catch (_) { continue; }
    const expr = `(async () => {
    const fps = await new Promise((r) => {
      let c = 0; const t0 = performance.now();
      const f = () => { c++; if (performance.now() - t0 < 1000) requestAnimationFrame(f); };
      requestAnimationFrame(f); setTimeout(() => r(c), 1100);
    });
    const vids = [...document.querySelectorAll('video')].map(v => ({paused: v.paused, muted: v.muted, t: (v.currentTime||0).toFixed(1), dur: (v.duration||0).toFixed(0)}));
    return { visibility: document.visibilityState, fps, domNodes: document.getElementsByTagName('*').length, videos: vids, animCount: document.getAnimations ? document.getAnimations().length : -1 };
  })()`;
    for (const t of targets) await evalOn(t.webSocketDebuggerUrl, t.url.split('/t/')[1].slice(0, 16) + ' @' + port, expr);
  }
})();
