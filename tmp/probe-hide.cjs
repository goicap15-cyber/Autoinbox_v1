const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const PROFILE = 'C:/Users/Admin/AppData/Roaming/autochatbot-fb-crm/data/profiles/pending_20261001093516_qiaxz';

function psHideByPids(pidCsv, state) {
  const script = `
Add-Type -TypeDefinition 'using System; using System.Text; using System.Runtime.InteropServices; public class H2 {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lp);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h, int n);
}' -ErrorAction SilentlyContinue
$targets = New-Object 'System.Collections.Generic.HashSet[uint32]'
@(${pidCsv}) | ForEach-Object { [void]$targets.Add([uint32]$_) }
$found = @()
[HW]::EnumWindows({ param($h, $l)
  $p = [uint32]0
  [void][HW]::GetWindowThreadProcessId($h, [ref]$p)
  if ($targets.Contains($p)) {
    $sbC = New-Object System.Text.StringBuilder 128
    [void][HW]::GetClassName($h, $sbC, 128)
    if ($sbC.ToString().StartsWith('Chrome_WidgetWin')) {
      $sbN = New-Object System.Text.StringBuilder 256
      [void][HW]::GetWindowText($h, $sbN, 256)
      $script:found += ($sbN.ToString())
      [void][HW]::ShowWindowAsync($h, ${state})
    }
  }
  return $true }, [IntPtr]::Zero) | Out-Null
Write-Output ($found -join ' || ')`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { timeout: 15000 }, (err, stdout) => {
      resolve(err ? ('ERR ' + err.message) : stdout.trim());
    });
  });
}

async function main() {
  const puppeteer = (await import('puppeteer-core')).default || (await import('puppeteer-core'));
  const [port, wsPath] = fs.readFileSync(path.join(PROFILE, 'DevToolsActivePort'), 'utf8').trim().split('\n');
  const browser = await puppeteer.connect({ browserWSEndpoint: `ws://127.0.0.1:${port}${wsPath}`, defaultViewport: null });
  const session = await browser.target().createCDPSession();
  const info = await session.send('SystemInfo.getProcessInfo');
  const browserPids = [...new Set(info.processInfo.filter((p) => p.type === 'browser').map((p) => p.id))];
  console.log('browserPids:', browserPids.join(','), '|', await browser.version());
  try { await session.detach(); } catch (_) {}

  const pages = (await browser.pages()).filter((p) => /facebook\.com\/messages/.test(p.url() || ''));
  const watchUrls = new Set(pages.map((p) => p.url().replace(/[?#].*/, '')));
  const probe = async (tag) => {
    const current = (await browser.pages()).filter((p) => watchUrls.has(p.url().replace(/[?#].*/, '')));
    for (const page of current) {
      const r = await page.evaluate(async () => {
        const t0 = performance.now();
        for (let i = 0; i < 10; i += 1) await new Promise((res) => setTimeout(res, 100));
        let raf = -1;
        await new Promise((resolve) => {
          let n = 0; const start = performance.now();
          const loop = () => { n += 1; if (performance.now() - start < 600) requestAnimationFrame(loop); else { raf = n; resolve(); } };
          requestAnimationFrame(loop);
          setTimeout(() => { if (raf === -1) { raf = n; resolve(); } }, 1200);
        });
        return { vis: document.visibilityState, timer: Math.round(performance.now() - t0), raf };
      }).catch((e) => ({ vis: 'EVAL_FAIL', timer: 0, raf: 0, msg: e.message.slice(0, 60) }));
      console.log(`${tag} ${page.url().replace(/[?#].*/, '').slice(0, 60)} :: vis=${r.vis} timer=${r.timer}ms raf600=${r.raf}${r.msg ? ' ' + r.msg : ''}`);
    }
  };

  await probe('BEFORE:');
  const hideOut = await psHideByPids(browserPids.join(','), 0);
  console.log('HIDE →', hideOut || '(0 window)');
  await new Promise((r) => setTimeout(r, 3000));
  await probe('HIDDEN:');
  const showOut = await psHideByPids(browserPids.join(','), 5);
  console.log('SHOW →', showOut || '(0 window)');
  await new Promise((r) => setTimeout(r, 2000));
  await probe('SHOWN :');
  browser.disconnect();
}
main().catch((err) => { console.error('FATAL', err.message); process.exit(1); });
