const asar = require('@electron/asar');
const B = String.fromCharCode(92);
const p = 'release/win-unpacked/resources/app.asar';
const serverFile = ['dist', 'server', 'services', 'InboxSyncScheduler.js'].join(B);
const s = asar.extractFile(p, serverFile).toString('utf8');
console.log('SERVER_PREEMPT:', s.includes("startsWith('sidebar_incoming')") ? 'OK' : 'MISSING');
