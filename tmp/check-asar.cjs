const asar = require('@electron/asar');
const archive = 'release/win-unpacked/resources/app.asar';

const bg = asar.extractFile(archive, 'dist\\extension\\background.js').toString();
console.log('CDP_ENTER_ROUTE_REJECTED:', bg.includes('CDP_ENTER_ROUTE_REJECTED') ? 'OK' : 'FAIL');

const client = asar.extractFile(archive, 'dist\\client\\assets\\index-DbIVVpir.js').toString();
console.log('client size:', client.length);
console.log('draftByThreadRef:', client.includes('draftByThreadRef') ? 'OK' : 'FAIL');
