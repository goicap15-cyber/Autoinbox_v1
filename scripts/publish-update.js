const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const JSZip = require('jszip');

const ROOT = path.resolve(__dirname, '..');

function bumpPatchVersion(ver) {
  const parts = String(ver || '1.0.0').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  while (parts.length < 3) parts.push(0);
  parts[2] += 1;
  return parts.join('.');
}

function addDirToZip(zip, fsDir, zipPrefix) {
  if (!fs.existsSync(fsDir)) return;
  for (const entry of fs.readdirSync(fsDir, { withFileTypes: true })) {
    const fullPath = path.join(fsDir, entry.name);
    const relZipPath = path.posix.join(zipPrefix, entry.name);
    if (entry.isDirectory()) {
      addDirToZip(zip, fullPath, relZipPath);
    } else {
      zip.file(relZipPath, fs.readFileSync(fullPath));
    }
  }
}

(async () => {
  const args = process.argv.slice(2);
  const noBump = args.includes('--no-bump');
  const shouldPush = args.includes('--push');
  const requiresRestart = args.includes('--restart');
  const noteArgs = args.filter((a) => !a.startsWith('--'));
  const releaseNotes = noteArgs.join(' ').trim() || 'Cập nhật tính năng và vá lỗi ổn định hệ thống.';

  const pkgPath = path.join(ROOT, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const nextVersion = noBump ? String(pkg.version || '1.0.0') : bumpPatchVersion(pkg.version);
  pkg.version = nextVersion;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  console.log(`=== Đóng gói bản cập nhật v${nextVersion} ===`);

  console.log('1. Đang build Client UI, Server và Chrome Extension...');
  execSync('node node_modules/vite/bin/vite.js build', { cwd: ROOT, stdio: 'inherit' });
  execSync('node scripts/build-bytecode.js', { cwd: ROOT, stdio: 'inherit' });
  execSync('node scripts/obfuscate-extension.js', { cwd: ROOT, stdio: 'inherit' });

  const versionMeta = {
    version: nextVersion,
    releasedAt: new Date().toISOString(),
    notes: releaseNotes,
    requiresRestart,
  };

  console.log('2. Đang nén gói Hot-Update (updates/crm-update.zip)...');
  const zip = new JSZip();
  addDirToZip(zip, path.join(ROOT, 'dist', 'client'), 'dist/client');
  addDirToZip(zip, path.join(ROOT, 'dist', 'server'), 'dist/server');
  addDirToZip(zip, path.join(ROOT, 'dist', 'extension'), 'dist/extension');
  if (fs.existsSync(path.join(ROOT, 'chrome-bundling', 'resolveChromePath.js'))) {
    zip.file('chrome-bundling/resolveChromePath.js', fs.readFileSync(path.join(ROOT, 'chrome-bundling', 'resolveChromePath.js')));
  }
  // Đóng gói kèm @puppeteer/browsers và các gói phụ thuộc nhỏ vào vendor/node_modules
  // để tự vá cho các máy khách đang chạy bản win-unpacked/Setup cũ thiếu @puppeteer/browsers trong app.asar
  const visitedVendor = new Set();
  function collectVendorPkg(pkgName) {
    if (visitedVendor.has(pkgName)) return;
    visitedVendor.add(pkgName);
    const pkgDir = path.join(ROOT, 'node_modules', pkgName);
    const pkgJson = path.join(pkgDir, 'package.json');
    if (!fs.existsSync(pkgJson)) return;
    addDirToZip(zip, pkgDir, `vendor/node_modules/${pkgName}`);
    try {
      const meta = JSON.parse(fs.readFileSync(pkgJson, 'utf8'));
      for (const dep of Object.keys(meta.dependencies || {})) {
        collectVendorPkg(dep);
      }
    } catch (_) {}
  }
  collectVendorPkg('@puppeteer/browsers');
  zip.file('package.json', fs.readFileSync(pkgPath));
  zip.file('src/electron.js', fs.readFileSync(path.join(ROOT, 'src', 'electron.js')));
  zip.file('src/preload.js', fs.readFileSync(path.join(ROOT, 'src', 'preload.js')));
  zip.file('version.json', JSON.stringify(versionMeta, null, 2));

  const zipBuf = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });

  const updatesDir = path.join(ROOT, 'updates');
  fs.mkdirSync(updatesDir, { recursive: true });
  const zipOutPath = path.join(updatesDir, 'crm-update.zip');
  fs.writeFileSync(zipOutPath, zipBuf);

  const sha256 = crypto.createHash('sha256').update(zipBuf).digest('hex');
  const finalManifest = {
    ...versionMeta,
    sizeBytes: zipBuf.length,
    sha256,
  };
  fs.writeFileSync(path.join(updatesDir, 'version.json'), JSON.stringify(finalManifest, null, 2) + '\n', 'utf8');

  console.log(`=== Đã tạo xong gói cập nhật ===`);
  console.log(`- Phiên bản : v${nextVersion}`);
  console.log(`- Dung lượng: ${(zipBuf.length / 1024 / 1024).toFixed(2)} MB`);
  console.log(`- File gói  : updates/crm-update.zip`);
  console.log(`- Manifest  : updates/version.json`);

  if (shouldPush) {
    console.log('3. Đang đẩy bản cập nhật lên nhánh phát hành GitHub (origin & autoinbox_v1 -> prod-owner-only)...');
    execSync('git add -f updates/version.json updates/crm-update.zip package.json', { cwd: ROOT, stdio: 'inherit' });
    execSync(`git commit -m "chore(release): publish hot-update v${nextVersion}"`, { cwd: ROOT, stdio: 'inherit' });
    execSync('git push origin HEAD:prod-owner-only', { cwd: ROOT, stdio: 'inherit' });
    try {
      execSync('git push autoinbox_v1 HEAD:prod-owner-only', { cwd: ROOT, stdio: 'inherit' });
    } catch (_) {}
    console.log('=== Đã đẩy bản cập nhật lên GitHub prod-owner-only thành công! ===');
  }
})();

