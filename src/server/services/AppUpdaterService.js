const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const JSZip = require('jszip');
const { APP_DATA_ROOT } = require('../utils/appDataRoot');

const DEFAULT_GITHUB_REPO = 'goicap15-cyber/Autoinbox_v1';
const DEFAULT_GITHUB_BRANCH = 'prod-owner-only';

let cachedGitCredentialToken = null;
function getGitCredentialToken() {
  if (cachedGitCredentialToken !== null) return cachedGitCredentialToken;
  try {
    const out = execFileSync('git', ['credential', 'fill'], {
      input: 'protocol=https\nhost=github.com\n\n',
      encoding: 'utf8',
      timeout: 4000,
      windowsHide: true,
    });
    const m = String(out || '').match(/^password=(.+)$/m);
    cachedGitCredentialToken = m ? m[1].trim() : '';
  } catch (_) {
    cachedGitCredentialToken = '';
  }
  return cachedGitCredentialToken;
}

function isElectronPackaged() {
  try {
    const electron = require('electron');
    return !!(electron && electron.app && electron.app.isPackaged);
  } catch (_) {
    return false;
  }
}

function getResourcesPath() {
  if (process.resourcesPath && fs.existsSync(process.resourcesPath)) {
    return process.resourcesPath;
  }
  const unpackedResources = path.resolve(__dirname, '../../../release/win-unpacked/resources');
  if (fs.existsSync(unpackedResources)) {
    return unpackedResources;
  }
  return path.resolve(__dirname, '../../..');
}

function compareSemver(a, b) {
  const pa = String(a || '0.0.0').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '0.0.0').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

function fetchBuffer(url, headers = {}, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const req = client.get(
      url,
      {
        headers: {
          'User-Agent': 'FB-Messenger-CRM-Updater/1.0',
          Accept: '*/*',
          ...headers,
        },
        timeout: 30000,
      },
      (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          if (maxRedirects <= 0) return reject(new Error('Quá nhiều lần chuyển hướng (redirect) khi tải bản cập nhật.'));
          const nextUrl = new URL(res.headers.location, url).toString();
          return resolve(fetchBuffer(nextUrl, headers, maxRedirects - 1));
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} khi truy cập ${url}`));
        }
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      }
    );
    req.on('timeout', () => {
      req.destroy(new Error('Hết thời gian chờ kết nối tới máy chủ cập nhật (timeout).'));
    });
    req.on('error', reject);
  });
}

class AppUpdaterService {
  constructor({ db, io } = {}) {
    this.db = db;
    this.io = io;
    this.status = {
      state: 'idle', // idle | checking | available | up_to_date | downloading | applying | restarting | error
      currentVersion: this.getCurrentVersion(),
      latestVersion: null,
      updateAvailable: false,
      releasedAt: null,
      notes: '',
      downloadUrl: '',
      progress: 0,
      message: '',
      error: null,
      checkedAt: null,
    };

    // Tự động kiểm tra bản cập nhật ngầm mỗi 25 giây để app đang mở tự nhận thông báo ngay
    this.pollTimer = setInterval(() => {
      if (!['checking', 'downloading', 'applying', 'restarting'].includes(this.status.state)) {
        this.checkForUpdates().catch(() => {});
      }
    }, 25000);
    if (this.pollTimer.unref) this.pollTimer.unref();
  }

  getConfig() {
    let saved = {};
    try {
      if (this.db) {
        const row = this.db.prepare("SELECT value FROM page_api_config WHERE key = 'app_updater_config'").get();
        if (row?.value) saved = JSON.parse(row.value);
      }
    } catch (_) {}
    const configPath = path.join(APP_DATA_ROOT, 'updater-config.json');
    if (fs.existsSync(configPath)) {
      try {
        saved = { ...JSON.parse(fs.readFileSync(configPath, 'utf8')), ...saved };
      } catch (_) {}
    }
    const savedRepo = String(saved.repo || '').trim();
    const effectiveRepo = (!savedRepo || savedRepo === 'itadsup1-boop/autoinbox')
      ? String(process.env.CRM_UPDATE_GITHUB_REPO || DEFAULT_GITHUB_REPO).trim()
      : savedRepo;
    return {
      repo: effectiveRepo,
      branch: String(saved.branch || process.env.CRM_UPDATE_GITHUB_BRANCH || DEFAULT_GITHUB_BRANCH).trim(),
      customManifestUrl: String(saved.customManifestUrl || process.env.CRM_UPDATE_MANIFEST_URL || '').trim(),
      githubToken: String(saved.githubToken || process.env.CRM_UPDATE_GITHUB_TOKEN || '').trim(),
    };
  }

  saveConfig(nextConfig = {}) {
    const current = this.getConfig();
    const merged = {
      repo: String(nextConfig.repo ?? current.repo).trim() || DEFAULT_GITHUB_REPO,
      branch: String(nextConfig.branch ?? current.branch).trim() || DEFAULT_GITHUB_BRANCH,
      customManifestUrl: String(nextConfig.customManifestUrl ?? current.customManifestUrl).trim(),
      githubToken: String(nextConfig.githubToken ?? current.githubToken).trim(),
    };
    try {
      if (this.db) {
        this.db.prepare(`
          INSERT INTO page_api_config (key, value, updated_at)
          VALUES ('app_updater_config', ?, CURRENT_TIMESTAMP)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
        `).run(JSON.stringify(merged));
      }
    } catch (_) {}
    try {
      fs.mkdirSync(APP_DATA_ROOT, { recursive: true });
      fs.writeFileSync(path.join(APP_DATA_ROOT, 'updater-config.json'), JSON.stringify(merged, null, 2), 'utf8');
    } catch (_) {}
    return merged;
  }

  getCurrentVersion() {
    try {
      const resourcesPath = getResourcesPath();
      const hotVersionPath = path.join(resourcesPath, 'hot-update', 'version.json');
      if (fs.existsSync(hotVersionPath)) {
        const hotMeta = JSON.parse(fs.readFileSync(hotVersionPath, 'utf8'));
        if (hotMeta?.version) return String(hotMeta.version).trim();
      }
    } catch (_) {}
    try {
      const pkgPath = path.resolve(__dirname, '../../../package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg?.version) return String(pkg.version).trim();
      }
    } catch (_) {}
    return '1.0.0';
  }

  emitStatus(patch = {}) {
    this.status = {
      ...this.status,
      currentVersion: this.getCurrentVersion(),
      ...patch,
    };
    if (this.io) {
      this.io.emit('app_update_status', this.status);
    }
    return this.status;
  }

  async fetchRemoteManifest() {
    const cfg = this.getConfig();
    const token = cfg.githubToken || getGitCredentialToken();
    const headers = {};
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    // 1. Nếu có cấu hình URL manifest trực tiếp
    if (cfg.customManifestUrl) {
      const buf = await fetchBuffer(`${cfg.customManifestUrl}${cfg.customManifestUrl.includes('?') ? '&' : '?'}t=${Date.now()}`, headers);
      return JSON.parse(buf.toString('utf8'));
    }

    // 2. Thử lấy từ GitHub Releases (/releases/latest)
    try {
      const releaseApiUrl = `https://api.github.com/repos/${cfg.repo}/releases/latest`;
      const buf = await fetchBuffer(releaseApiUrl, {
        ...headers,
        Accept: 'application/vnd.github+json',
      });
      const release = JSON.parse(buf.toString('utf8'));
      if (release && release.tag_name) {
        const version = String(release.tag_name).replace(/^v/i, '').trim();
        const zipAsset = Array.isArray(release.assets)
          ? release.assets.find((a) => /\.zip$/i.test(a.name || ''))
          : null;
        const manifestAsset = Array.isArray(release.assets)
          ? release.assets.find((a) => /version\.json$/i.test(a.name || ''))
          : null;

        if (manifestAsset?.browser_download_url) {
          const mBuf = await fetchBuffer(manifestAsset.browser_download_url, headers);
          const mJson = JSON.parse(mBuf.toString('utf8'));
          if (zipAsset?.browser_download_url && !mJson.downloadUrl) {
            mJson.downloadUrl = zipAsset.browser_download_url;
          }
          return mJson;
        }

        if (zipAsset?.browser_download_url) {
          return {
            version,
            releasedAt: release.published_at || release.created_at || new Date().toISOString(),
            notes: release.body || release.name || `Bản cập nhật v${version}`,
            downloadUrl: zipAsset.browser_download_url,
          };
        }
      }
    } catch (_) {
      // Fallback sang đọc trực tiếp từ nhánh (branch) trên GitHub
    }

    // 3. Ưu tiên đọc qua raw.githubusercontent.com (không bị giới hạn 60 req/giờ của GitHub API trên máy khách thuê)
    try {
      const rawHeaders = { ...headers, 'Cache-Control': 'no-cache', Pragma: 'no-cache' };
      // Với repo Public không cần gửi kèm local token nếu không cấu hình githubToken riêng
      if (!cfg.githubToken) delete rawHeaders.Authorization;
      const rawManifestUrl = `https://raw.githubusercontent.com/${cfg.repo}/${cfg.branch}/updates/version.json?t=${Date.now()}`;
      const rawBuf = await fetchBuffer(rawManifestUrl, rawHeaders);
      const manifest = JSON.parse(rawBuf.toString('utf8'));
      if (!manifest.downloadUrl) {
        manifest.downloadUrl = `https://raw.githubusercontent.com/${cfg.repo}/${cfg.branch}/updates/crm-update.zip?t=${Date.now()}`;
      }
      return manifest;
    } catch (_) {}

    // 4. Fallback đọc từ nhánh GitHub qua Contents API (hỗ trợ cả Repo Private)
    const contentsManifestUrl = `https://api.github.com/repos/${cfg.repo}/contents/updates/version.json?ref=${encodeURIComponent(cfg.branch)}`;
    const contentsBuf = await fetchBuffer(contentsManifestUrl, {
      ...headers,
      Accept: 'application/vnd.github.raw',
    });
    const manifest = JSON.parse(contentsBuf.toString('utf8'));
    if (!manifest.downloadUrl) {
      manifest.downloadUrl = `https://api.github.com/repos/${cfg.repo}/contents/updates/crm-update.zip?ref=${encodeURIComponent(cfg.branch)}`;
    }
    return manifest;
  }

  async checkForUpdates() {
    this.emitStatus({
      state: 'checking',
      message: 'Đang kiểm tra phiên bản mới nhất...',
      error: null,
    });

    try {
      const manifest = await this.fetchRemoteManifest();
      const currentVersion = this.getCurrentVersion();
      const latestVersion = String(manifest?.version || currentVersion).replace(/^v/i, '').trim();
      const isNewer = compareSemver(latestVersion, currentVersion) > 0;

      return this.emitStatus({
        state: isNewer ? 'available' : 'up_to_date',
        currentVersion,
        latestVersion,
        updateAvailable: isNewer,
        releasedAt: manifest?.releasedAt || null,
        requiresRestart: Boolean(manifest?.requiresRestart),
        notes: String(manifest?.notes || '').trim(),
        downloadUrl: String(manifest?.downloadUrl || '').trim(),
        progress: 0,
        checkedAt: new Date().toISOString(),
        message: isNewer
          ? `Đã có phiên bản mới v${latestVersion}! Bấm "Cập nhật ngay" để nâng cấp.`
          : `Bạn đang sử dụng phiên bản mới nhất (v${currentVersion}).`,
        error: null,
      });
    } catch (err) {
      const currentVersion = this.getCurrentVersion();
      const msg = err?.message || String(err);
      if (/HTTP 404/i.test(msg)) {
        return this.emitStatus({
          state: 'up_to_date',
          currentVersion,
          latestVersion: currentVersion,
          updateAvailable: false,
          checkedAt: new Date().toISOString(),
          message: `Bạn đang sử dụng phiên bản mới nhất (v${currentVersion}).`,
          error: null,
        });
      }
      return this.emitStatus({
        state: 'error',
        updateAvailable: false,
        checkedAt: new Date().toISOString(),
        message: `Không kết nối được máy chủ cập nhật. Vui lòng thử lại sau.`,
        error: msg,
      });
    }
  }

  async downloadWithProgress(url, headers = {}) {
    return new Promise((resolve, reject) => {
      const visit = (targetUrl, redirectsLeft) => {
        const client = targetUrl.startsWith('https:') ? https : http;
        const req = client.get(
          targetUrl,
          {
            headers: {
              'User-Agent': 'FB-Messenger-CRM-Updater/1.0',
              Accept: '*/*',
              ...headers,
            },
            timeout: 60000,
          },
          (res) => {
            if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
              res.resume();
              if (redirectsLeft <= 0) return reject(new Error('Quá nhiều redirect khi tải gói cập nhật.'));
              return visit(new URL(res.headers.location, targetUrl).toString(), redirectsLeft - 1);
            }
            if (res.statusCode < 200 || res.statusCode >= 300) {
              res.resume();
              return reject(new Error(`Lỗi tải gói cập nhật (HTTP ${res.statusCode}).`));
            }
            const total = parseInt(res.headers['content-length'] || '0', 10) || 0;
            let received = 0;
            const chunks = [];
            res.on('data', (chunk) => {
              chunks.push(chunk);
              received += chunk.length;
              const pct = total > 0 ? Math.min(90, Math.round((received / total) * 85)) : 45;
              this.emitStatus({
                state: 'downloading',
                progress: pct,
                message: `Đang tải bản cập nhật... (${(received / 1024 / 1024).toFixed(1)} MB)`,
              });
            });
            res.on('end', () => resolve(Buffer.concat(chunks)));
          }
        );
        req.on('timeout', () => req.destroy(new Error('Quá thời gian tải gói cập nhật.')));
        req.on('error', reject);
      };
      visit(url, 5);
    });
  }

  async downloadAndApplyUpdate() {
    if (['downloading', 'applying', 'restarting'].includes(this.status.state)) {
      return this.status;
    }

    try {
      if (!this.status.downloadUrl) {
        await this.checkForUpdates();
      }
      const downloadUrl = this.status.downloadUrl;
      if (!downloadUrl) {
        throw new Error('Không tìm thấy đường dẫn tải gói cập nhật trên GitHub.');
      }

      const cfg = this.getConfig();
      const token = cfg.githubToken || getGitCredentialToken();
      const headers = {
        Accept: 'application/vnd.github.raw',
      };
      if (token) headers.Authorization = `Bearer ${token}`;

      this.emitStatus({
        state: 'downloading',
        progress: 5,
        message: 'Đang kết nối GitHub và tải gói cập nhật...',
        error: null,
      });

      const zipBuffer = await this.downloadWithProgress(downloadUrl, headers);

      this.emitStatus({
        state: 'applying',
        progress: 92,
        message: 'Đang giải nén và áp dụng bản cập nhật...',
      });

      const zip = await JSZip.loadAsync(zipBuffer);
      const resourcesPath = getResourcesPath();
      const hotUpdateDir = path.join(resourcesPath, 'hot-update');
      const stagingDir = path.join(resourcesPath, `hot-update-staging-${Date.now()}`);

      fs.mkdirSync(stagingDir, { recursive: true });

      const entries = Object.keys(zip.files);
      for (const relPath of entries) {
        const entry = zip.files[relPath];
        const safeRel = path.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, '');
        const destPath = path.join(stagingDir, safeRel);
        if (entry.dir) {
          fs.mkdirSync(destPath, { recursive: true });
        } else {
          fs.mkdirSync(path.dirname(destPath), { recursive: true });
          const content = await entry.async('nodebuffer');
          fs.writeFileSync(destPath, content);
        }
      }

      // Đảm bảo có version.json trong gói
      const versionJsonPath = path.join(stagingDir, 'version.json');
      if (!fs.existsSync(versionJsonPath)) {
        fs.writeFileSync(
          versionJsonPath,
          JSON.stringify(
            {
              version: this.status.latestVersion || this.getCurrentVersion(),
              releasedAt: this.status.releasedAt || new Date().toISOString(),
              notes: this.status.notes || '',
              appliedAt: new Date().toISOString(),
            },
            null,
            2
          ),
          'utf8'
        );
      }

      // Chuyển stagingDir sang hot-update nguyên tử
      const backupDir = path.join(resourcesPath, `hot-update-old-${Date.now()}`);
      if (fs.existsSync(hotUpdateDir)) {
        try {
          fs.renameSync(hotUpdateDir, backupDir);
        } catch (_) {
          fs.rmSync(hotUpdateDir, { recursive: true, force: true });
        }
      }
      fs.renameSync(stagingDir, hotUpdateDir);
      if (fs.existsSync(backupDir)) {
        try {
          fs.rmSync(backupDir, { recursive: true, force: true });
        } catch (_) {}
      }

      // Cập nhật luôn thư mục extension bên ngoài để Chrome nạp bản mới ngay
      const stagedExt = path.join(hotUpdateDir, 'dist', 'extension');
      if (fs.existsSync(stagedExt)) {
        const targetExt1 = path.join(resourcesPath, 'extension');
        const targetExt2 = path.join(resourcesPath, 'app.asar.unpacked', 'dist', 'extension');
        try {
          fs.cpSync(stagedExt, targetExt1, { recursive: true, force: true });
        } catch (_) {}
        try {
          if (fs.existsSync(path.dirname(targetExt2))) {
            fs.cpSync(stagedExt, targetExt2, { recursive: true, force: true });
          }
        } catch (_) {}
      }

      // Cập nhật package.json version trên máy nếu đang ở môi trường dev
      if (!isElectronPackaged()) {
        try {
          const pkgPath = path.resolve(__dirname, '../../../package.json');
          if (fs.existsSync(pkgPath) && this.status.latestVersion) {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            pkg.version = this.status.latestVersion;
            fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
          }
        } catch (_) {}
      }

      const newVer = this.status.latestVersion || this.getCurrentVersion();
      const needsAppRestart = Boolean(this.status.requiresRestart);
      this.emitStatus({
        state: 'restarting',
        currentVersion: newVer,
        latestVersion: newVer,
        updateAvailable: false,
        progress: 100,
        message: needsAppRestart
          ? `Đã cập nhật hệ thống lên v${newVer}! Đang tự khởi động lại ứng dụng...`
          : `Đã cập nhật thành công lên v${newVer}! Đang làm mới giao diện ngay lập tức...`,
      });

      if (needsAppRestart) {
        setTimeout(() => {
          try {
            const electron = require('electron');
            if (electron && electron.app && typeof electron.app.relaunch === 'function') {
              electron.app.relaunch();
              electron.app.exit(0);
              return;
            }
          } catch (_) {}
        }, 1100);
      } else {
        setTimeout(() => {
          this.emitStatus({
            state: 'up_to_date',
            currentVersion: newVer,
            latestVersion: newVer,
            updateAvailable: false,
            progress: 100,
            message: `Bạn đang sử dụng phiên bản mới nhất (v${newVer}).`,
          });
        }, 2500);
      }

      return this.status;
    } catch (err) {
      const msg = err?.message || String(err);
      return this.emitStatus({
        state: 'error',
        progress: 0,
        message: `Cập nhật thất bại: ${msg}`,
        error: msg,
      });
    }
  }
}

module.exports = AppUpdaterService;

