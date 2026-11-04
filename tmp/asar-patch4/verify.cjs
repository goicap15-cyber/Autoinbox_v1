const asar = require('@electron/asar');
const buf = asar.extractFile('release/win-unpacked/resources/app.asar', 'dist\\server\\repositories\\MessageQueueRepository.js');
const s = buf.toString('utf8');
console.log('reuse-reset marker:', s.includes("existing.status === 'failed'") ? 'OK' : 'FAIL');
console.log('markQueueFailed hook:', s.includes('markQueueFailed') ? 'n/a here' : 'n/a');
const srv = asar.extractFile('release/win-unpacked/resources/app.asar', 'dist\\server\\server.js');
console.log('server markQueueFailed hook:', srv.toString('utf8').includes("markQueueFailed(queueId, errorReason)") ? 'OK' : 'FAIL');
