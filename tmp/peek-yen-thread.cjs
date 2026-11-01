const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const puppeteer = require('puppeteer-core');

function findCrmProfileDirs() {
  const { execFileSync } = require('child_process');
  const out = execFileSync('powershell', ['-NoProfile', '-Command',
    "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { $_.CommandLine -like '*autochatbot-fb-crm*' -and $_.CommandLine -like '*user-data-dir*' } | ForEach-Object { if ($_.CommandLine -match '--user-data-dir=([^ ]+)') { $Matches[1] } }"
  ], { encoding: 'utf8' });
  const dirs = new Set(out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
  return Array.from(dirs);
}

(async () => {
  const dirs = findCrmProfileDirs();
  console.log('CRM PROFILES:', dirs);
  for (const dir of dirs) {
    const portFile = path.join(dir, 'DevToolsActivePort');
    if (!fs.existsSync(portFile)) { console.log('NO_PORT_FILE', dir); continue; }
    const [port, wsPath] = fs.readFileSync(portFile, 'utf8').trim().split('\n');
    console.log('CONNECT port=', port);
    const browser = await puppeteer.connect({
      browserWSEndpoint: `ws://127.0.0.1:${port}${wsPath}`,
      defaultViewport: null
    });
    const pages = await browser.pages();
    for (const p of pages) {
      let url = '';
      try { url = p.url(); } catch (_) { continue; }
      if (!/messenger|facebook/.test(url)) continue;
      console.log('\nPAGE', url.slice(0, 100));
      // Chỉ soi tab chat đang mở hội thoại (có viewport article)
      const data = await p.evaluate(() => {
        const arts = Array.from(document.querySelectorAll('[data-message-id]'));
        if (!arts.length) return null;
        const last = arts.slice(-4);
        return {
          thread: location.pathname,
          total: arts.length,
          articles: last.map((a) => {
            const mid = a.getAttribute('data-message-id') || a.getAttribute('data-id') || a.id;
            const leaves = Array.from(a.querySelectorAll('div[dir="auto"], span[dir="auto"]'))
              .filter((b) => !b.querySelector('div[dir="auto"], span[dir="auto"]'))
              .map((b) => {
                const r = b.getBoundingClientRect();
                const s = getComputedStyle(b);
                return {
                  text: (b.textContent || '').trim().slice(0, 50),
                  visible: r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0'
                };
              });
            return { mid: String(mid).slice(0, 60), leafCount: leaves.length, leaves };
          })
        };
      }).catch((e) => ({ evalErr: e.message.slice(0, 80) }));
      if (data) console.log(JSON.stringify(data, null, 1));
    }
    browser.disconnect();
  }
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
