const asar = require('@electron/asar');
const fs = require('fs');
const dir = 'release/win-unpacked/resources/app.asar';
const assets = fs.readdirSync('dist/client/assets').filter((f) => /^index-.*\.js$/.test(f));
for (const name of assets) {
  try {
    const b = asar.extractFile(dir, ['client', 'assets', name].join('\\')).toString('utf8');
    console.log(name, 'len', b.length);
    console.log('  mentionMembers:', b.includes('mentionMembers'));
    console.log('  moi nguoi subtitle:', b.includes('Nhắc đến mọi người trong cuộc trò chuyện này'));
    console.log('  query.trim:', b.includes('.query.trim('));
  } catch (e) {
    console.log(name, 'NOT IN ASAR:', e.message);
  }
}
