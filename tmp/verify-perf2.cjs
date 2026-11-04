// Verify build 57: occlusion enabled (bo CalculateNativeWinOcclusion, giu timer flags)
const asar = require('@electron/asar');
const path = require('path');
const B = path.sep;
const base = path.join(__dirname, '..', 'release', 'win-unpacked', 'resources', 'app.asar');

let pmJs;
const tryPaths = [
  ['dist', 'server', 'services', 'ProcessManager.js'],
  ['src', 'server', 'services', 'ProcessManager.js'],
];
for (const p of tryPaths) {
  try { pmJs = asar.extractFile(base, p.join(B)).toString('utf8'); console.log('asar paths:', p.join('/')); break; } catch (_) {}
}
if (!pmJs) { console.log('FAIL: khong doc duoc ProcessManager trong asar'); process.exit(1); }

const checks = [
  ['PM: bo CalculateNativeWinOcclusion', !pmJs.includes('CalculateNativeWinOcclusion')],
  ['PM: giu IntensiveWakeUpThrottling disabled', pmJs.includes("'--disable-features=IntensiveWakeUpThrottling'")],
  ['PM: giu disable-background-timer-throttling', pmJs.includes("'--disable-background-timer-throttling'")],
  ['PM: giu disable-backgrounding-occluded-windows', pmJs.includes("'--disable-backgrounding-occluded-windows'")],
  ['PM: giu disable-renderer-backgrounding', pmJs.includes("'--disable-renderer-backgrounding'")],
  // kiem tra build truoc van con nguyen
  ['server.js: pre-gate pure hint (perf1)', (() => {
    try { return asar.extractFile(base, ['dist', 'server', 'server.js'].join(B)).toString('utf8').includes('isPureRealtimeHint'); } catch (_) { return false; }
  })()],
  ['content.js: pause anim hidden (perf1)', (() => {
    try { return asar.extractFile(base, ['dist', 'extension', 'content.js'].join(B)).toString('utf8').includes('installHiddenTabAnimationPause'); } catch (_) { return false; }
  })()],
];

let ok = true;
for (const [name, pass] of checks) {
  console.log(pass ? 'OK  ' : 'FAIL', name);
  if (!pass) ok = false;
}
process.exit(ok ? 0 : 1);
