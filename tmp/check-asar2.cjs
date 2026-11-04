const asar = require('@electron/asar');
const client = asar.extractFile('release/win-unpacked/resources/app.asar', 'dist\\client\\assets\\index-DbIVVpir.js').toString();
for (const pat of ['.current.get(', '.current.set(String', '.current.delete(String']) {
  const i = client.indexOf(pat);
  console.log(JSON.stringify(pat), i > -1 ? 'FOUND at ' + i : 'absent');
  if (i > -1) console.log('  ctx:', client.slice(Math.max(0, i - 100), i + 100).replace(/\n/g, ' '));
}
