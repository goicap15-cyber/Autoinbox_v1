const asar = require('@electron/asar');
const BS = String.fromCharCode(92);
const archive = 'C:' + BS + 'Users' + BS + 'Admin' + BS + 'Downloads' + BS + 'Duan' + BS + 'CRM_FB1' + BS + 'release' + BS + 'win-unpacked' + BS + 'resources' + BS + 'app.asar';
const checks = [
  ['dist' + BS + 'extension' + BS + 'content.js', 'relayedNetworkMids'],
  ['dist' + BS + 'extension' + BS + 'content.js', 'media_url: netMsg.media_url || null'],
  ['dist' + BS + 'extension' + BS + 'injected.js', "foundVid ? 'video' : (foundPoster ? 'image' : 'text')"],
  ['dist' + BS + 'server' + BS + 'server.js', 'maxConcurrency: 4'],
  ['dist' + BS + 'server' + BS + 'services' + BS + 'MediaDownloader.js', 'Timeout tải media (90s)'],
  ['dist' + BS + 'server' + BS + 'services' + BS + 'InboxSyncScheduler.js', 'maxConcurrentPageLanes'],
  ['dist' + BS + 'server' + BS + 'utils' + BS + 'sidebarCompare.js', 'shouldSkip'],
];
let fail = 0;
for (const [file, marker] of checks) {
  let ok = false;
  try {
    ok = asar.extractFile(archive, file).toString('utf8').includes(marker);
  } catch (e) { console.log('ERR', file, e.message); fail++; continue; }
  console.log(ok ? 'OK  ' : 'MISS', marker.slice(0, 50));
  if (!ok) fail++;
}
process.exit(fail ? 1 : 0);
