const asar = require('@electron/asar');
const bg = asar.extractFile('release/win-unpacked/resources/app.asar', 'dist\\extension\\background.js').toString();
const i = bg.indexOf('CRM_QUERY_TEMPLATE_RESTORE');
console.log('idx', i);
console.log(JSON.stringify(bg.substring(Math.max(0, i - 80), i + 420)));
