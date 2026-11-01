const asar = require('@electron/asar');
const BS = String.fromCharCode(92);
const get = (f) => {
  for (const p of [f, f.split('/').join(BS)]) {
    try { return asar.extractFile('release/win-unpacked/resources/app.asar', p).toString('utf8'); } catch (_) {}
  }
  throw new Error('not found: ' + f);
};
const checks = [
  ['dist/server/server.js', ['!isSameConnection) domReplaySuppressUntil.set', 'BACKEND_COMPOSER_MEDIA_CONFIRMED', 'contentAlreadyInThread', 'local_media_path = ?']],
  ['dist/extension/background.js', ['accountNameChanged || accountAvatarChanged', 'cosmetic updates']],
  ['dist/extension/content.js', ['lastReportedTokens']]
];
for (const [f, markers] of checks) {
  const s = get(f);
  console.log(f, JSON.stringify(markers.map(m => s.includes(m))));
}
