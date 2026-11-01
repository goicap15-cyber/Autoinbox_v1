const asar = require('@electron/asar');
const files = asar.listPackage('release/win-unpacked/resources/app.asar');
const hits = files.filter(f => /VietSeeding|server\.js$|client\/assets/.test(f));
console.log(hits.slice(0, 20).join('\n'));
console.log('TOTAL=' + files.length);
