const path = require('path');
const fs = require('fs');
const { parseEnv } = require('util');
// Neither the plain `node src/server/index.js` entrypoint nor Electron's
// require(serverPath) load .env on their own (no dotenv dependency, no
// --env-file flag) - PAGE_TOKEN_SECRET/WEBHOOK_VERIFY_TOKEN/RICH_MESSAGE_*
// flags etc. were silently falling back to unset. Node 20.6+'s built-in
// loadEnvFile covers both launch paths without adding a dependency.
try {
  // fs.readFileSync is ASAR-aware, unlike process.loadEnvFile's native file
  // loader. This reads repo/.env in dev and app.asar/.env when packaged.
  const envPath = path.join(__dirname, '../../.env');
  const packagedEnv = parseEnv(fs.readFileSync(envPath, 'utf8'));
  for (const [key, value] of Object.entries(packagedEnv)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
} catch (_) {
  // Missing .env is fine (e.g. a fresh checkout) - env vars just stay unset.
}

const express = require('express');
const crypto = require('crypto');
const { isLoopbackAddress, isLocalDevRequest } = require('./utils/localDevAccess');
const { APP_DATA_ROOT } = require('./utils/appDataRoot');
const { appendRotating } = require('./utils/rotatingDebugLog');
const OutboundAttachmentRepository = require('./repositories/OutboundAttachmentRepository');
const OutboundAttemptRepository = require('./repositories/OutboundAttemptRepository');
const OutboundAttachmentService = require('./services/OutboundAttachmentService');
const RichMessageCapabilityService = require('./services/RichMessageCapabilityService');
const RichMessageService = require('./services/RichMessageService');
const OutboundConfirmationService = require('./services/OutboundConfirmationService');
const OutboundDomCorrelationService = require('./services/OutboundDomCorrelationService');
const InboundMediaHydrationService = require('./services/InboundMediaHydrationService');
const PhoneCaptureService = require('./services/PhoneCaptureService');
const CampaignPhoneCaptureService = require('./services/CampaignPhoneCaptureService');
const GlobalPhoneAutomationService = require('./services/GlobalPhoneAutomationService');
const HistorySyncRetryPolicy = require('./services/HistorySyncRetryPolicy');
const { DispatchStallWatchdog } = require('./services/DispatchStallWatchdog');
const SidebarSyncCooldown = require('./services/SidebarSyncCooldown');
const CallEventDeduplicator = require('./services/CallEventDeduplicator');
const { resolveInternalThreadId } = require('./utils/threadIdResolver');
const http = require('http');
const WebSocket = require('ws');
const { Server: SocketIOServer } = require('socket.io');
const db = require('./database/db');
const { AuthService, AuthError } = require('./services/AuthService');
const { CentralAuthClient, CentralAuthError } = require('./services/CentralAuthClient');
const processManager = require('./services/ProcessManager');
const { closeChromePidsGracefullySync } = processManager;
const mediaDownloader = require('./services/RobustMediaDownloader');
const assignmentManager = require('./services/AssignmentManager');
const enterpriseAccess = require('./services/EnterpriseAccessService');
const searchService = require('./services/SearchService');
const exportService = require('./services/ExportService');
const autoReplyEngine = require('./services/AutoReplyEngine');
const broadcastEngine = require('./services/BroadcastEngine');
const aiMediator = require('./services/AIMediator');
const { extractLeadInfo } = require('./utils/leadExtractor');
const { downloadAvatar, saveAvatarFromBase64OrUrl, serveAvatar } = require('./utils/avatarManager');
const LinkPreviewService = require('./services/LinkPreviewService');
// Link facebook share/p thiếu og:image (Facebook khóa sau login): đẩy nhiệm
// vụ sang extension - mở tab đọc og:image trong Chrome đã đăng nhập rồi trả về.
const linkImageSentAt = new Map();
LinkPreviewService.onImageNeeded = (urlHash, url) => {
  // Throttle: moi hash chi moi extension moi 10 phut mot lan
  const last = linkImageSentAt.get(urlHash) || 0;
  if (Date.now() - last < 10 * 60 * 1000) return;
  for (const extWs of extensionConnections.values()) {
    if (extWs.readyState === WebSocket.OPEN) {
      linkImageSentAt.set(urlHash, Date.now());
      extWs.send(JSON.stringify({ type: 'FETCH_LINK_IMAGE', data: { url_hash: urlHash, url } }));
      break;
    }
  }
};
const { isSystemOrMetadataText, isSystemConversationNotice, cleanMessageText, isSidebarActivitySummary, isSidebarActivityNotification, isInvalidContactName, cleanContactName } = require('./utils/textFilter');
const { resolveActiveOnWindow } = require('./utils/activeOnWindow');
const { normalizePreviewText, shouldFlipUnreadFromPreview, shouldBumpUnreadFromSidebar, HintUnreadTracker } = require('./utils/unreadGuard');
const { sidebarShouldSkipSweep, isStaleThreadLastActivity } = require('./utils/sidebarCompare');
const { isKnownPageSystemNotice } = require('./utils/pageSystemNotice');
const { parsePageIdFromInput } = require('./utils/pageIdParser');
const ConversationRepository = require('./repositories/ConversationRepository');
const MessageQueueRepository = require('./repositories/MessageQueueRepository');
const queueWorker = require('./services/QueueWorker');
const CampaignRepository = require('./repositories/CampaignRepository');
const CampaignResponseStatsService = require('./services/CampaignResponseStatsService');
const CampaignService = require('./services/CampaignService');
const campaignRunner = require('./services/CampaignRunner');
const CampaignEventService = require('./services/CampaignEventService');
const CampaignEligibilityService = require('./services/CampaignEligibilityService');
const CampaignAttachmentService = require('./services/CampaignAttachmentService');
const CampaignRecoveryService = require('./services/CampaignRecoveryService');
const LeadStatusService = require('./services/LeadStatusService');
const ContactService = require('./services/ContactService');
const AccountService = require('./services/AccountService');
const FollowupService = require('./services/FollowupService');
const InboxSourceService = require('./services/InboxSourceService');
const InboxSyncScheduler = require('./services/InboxSyncScheduler');
const VietSeedingImportService = require('./services/VietSeedingImportService');
const CommentLeadsService = require('./services/CommentLeadsService');
const InitialMessageSweepService = require('./services/InitialMessageSweepService');
// Chức năng Page chạy bằng Messenger Platform chính thức (Graph API + webhook)
const pageApiService = require('./services/PageApiService');
const setupAutomation = require('./services/AppSetupAutomation');
const { isChangedIncomingSidebarPreview, isFreshRowTimeText } = require('./utils/sidebarIncomingDetection');

// Dedupe media-hint theo thread: dòng thời gian sidebar giữ trạng thái "Bây
// giờ"/fresh ~1 phút và quét 2s vẫn thấy -> không cho bắn sync lặp.
const mediaHintLastSeen = new Map();
// threadKey -> row_time_text của lần quét TRƯỚC: phân biệt "Bây giờ" MỚI
// (tin vừa đến, row vừa chuyển sang fresh) với nhịp quét tiếp diễn của
// cùng message - không có cái này thì bump unread nổ lại mỗi 8s trong
// ~60s row còn "Bây giờ", badge hiện đi hiện lại sau khi operator đọc
// (báo lỗi 2026-10-02).
const rowTimePrevSeen = new Map();
const licenseChecker = require('./services/LicenseChecker');

// Remote License Server URL – must match CentralAuthClient / LicenseChecker
const LICENSE_SERVER_BASE_URL = (process.env.LICENSE_SERVER_URL || 'https://genblackmmoonline.online/license_server').replace(/\/$/, '');

const app = express();
const followupService = new FollowupService(db);
const authService = new AuthService(db);
const centralAuthClient = new CentralAuthClient();
app.use(express.json());

function sendAuthError(res, error) {
  const status = error instanceof AuthError || error instanceof CentralAuthError ? error.status : (error?.status || 500);
  if (status === 500) console.error('[Auth Error]', error);
  res.status(status).json({
    success: false,
    code: error?.code || 'AUTH_ERROR',
    message: error?.message || 'Không thể xử lý yêu cầu đăng nhập.'
  });
}

// Authentication comes before license activation: users sign in first, then
// the authenticated application checks or activates this machine's key.
app.post('/api/auth/register-otp', async (req, res) => {
  try {
    const data = await centralAuthClient.requestRegistrationOtp(req.body?.email);
    res.json({ success: true, data });
  } catch (error) {
    sendAuthError(res, error);
  }
});

app.post('/api/auth/reset-password-otp', async (req, res) => {
  try {
    const data = await centralAuthClient.requestResetPasswordOtp(req.body?.email);
    res.json({ success: true, data });
  } catch (error) {
    sendAuthError(res, error);
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const data = await centralAuthClient.resetPassword(req.body || {});
    res.json({ success: true, message: data?.message || 'Đặt lại mật khẩu thành công!' });
  } catch (error) {
    sendAuthError(res, error);
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const user = await authService.registerManaged(req.body || {}, centralAuthClient);
    const session = authService.login(req.body || {});
    res.setHeader('Set-Cookie', authService.sessionCookie(session.token));
    res.status(201).json({ success: true, user });
  } catch (error) {
    sendAuthError(res, error);
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const session = isLocalDevRequest(req, 'LOCAL_DEV_AUTH')
      ? authService.login(req.body || {})
      : await authService.loginManaged(req.body || {}, centralAuthClient);
    res.setHeader('Set-Cookie', authService.sessionCookie(session.token));
    res.json({ success: true, user: session.user });
  } catch (error) {
    sendAuthError(res, error);
  }
});

let latestLocalSession = null;

app.post('/api/auth/google', async (req, res) => {
  try {
    const session = await authService.loginGoogleManaged(req.body || {}, centralAuthClient);
    res.setHeader('Set-Cookie', authService.sessionCookie(session.token));
    latestLocalSession = { token: session.token, user: session.user, expiresAt: Date.now() + 60000 };
    io.emit('AUTH_SUCCESS', { user: session.user, token: session.token });
    res.json({ success: true, user: session.user });
  } catch (error) {
    sendAuthError(res, error);
  }
});

app.get('/api/auth/latest-local-session', (req, res) => {
  if (latestLocalSession && Date.now() < latestLocalSession.expiresAt) {
    const sessionData = latestLocalSession;
    latestLocalSession = null;
    res.setHeader('Set-Cookie', authService.sessionCookie(sessionData.token));
    return res.json({ success: true, user: sessionData.user, token: sessionData.token });
  }
  res.status(404).json({ success: false });
});

app.post('/api/auth/claim-token', (req, res) => {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ success: false, message: 'Thiếu token' });
  res.setHeader('Set-Cookie', authService.sessionCookie(token));
  res.json({ success: true });
});

app.get('/google-auth-external', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="vi">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Xác thực Google - FB Messenger CRM</title>
      <script src="https://accounts.google.com/gsi/client" async defer onload="initGoogle()"></script>
      <style>
        body { font-family: system-ui, -apple-system, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f8fafc; color: #0f172a; }
        .card { background: white; padding: 2.5rem; border-radius: 1rem; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.1); text-align: center; max-width: 400px; width: 90%; }
        h2 { margin-top: 0; color: #1e293b; font-size: 1.5rem; }
        p { color: #64748b; font-size: 0.95rem; margin-bottom: 1.5rem; line-height: 1.5; }
        .success { color: #16a34a; font-weight: 600; display: none; margin-top: 1.5rem; padding: 0.75rem; background: #f0fdf4; border-radius: 0.5rem; border: 1px solid #bbf7d0; }
        .error { color: #dc2626; font-weight: 500; display: none; margin-top: 1.5rem; padding: 0.75rem; background: #fef2f2; border-radius: 0.5rem; border: 1px solid #fecaca; font-size: 0.9rem; }
        .btn-container { display: flex; justify-content: center; margin-top: 1rem; min-height: 50px; }
      </style>
    </head>
    <body>
      <div class="card">
        <h2>AdsupCRM</h2>
        <p>Vui lòng chọn tài khoản Google để tiếp tục sử dụng ứng dụng Desktop.</p>
        <div class="btn-container">
          <div id="googleBtn"></div>
        </div>
        <div id="msg-success" class="success">✓ Đăng nhập thành công! Cửa sổ này sẽ tự động đóng...</div>
        <div id="msg-error" class="error"></div>
      </div>
      <script>
        function initGoogle() {
          if (!window.google?.accounts?.id) return;
          google.accounts.id.initialize({
            client_id: '436041288370-9v5egma47gmsbi2pgalj77un535j15r7.apps.googleusercontent.com',
            callback: handleCredentialResponse,
            ux_mode: 'popup',
            auto_select: false
          });
          google.accounts.id.renderButton(
            document.getElementById("googleBtn"),
            { theme: "outline", size: "large", width: 320, text: "signin_with", shape: "rectangular" }
          );
        }
        window.addEventListener('load', () => {
          if (window.google?.accounts?.id) initGoogle();
        });
        async function handleCredentialResponse(response) {
          const errDiv = document.getElementById('msg-error');
          const succDiv = document.getElementById('msg-success');
          errDiv.style.display = 'none';
          try {
            const res = await fetch('/api/auth/google', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ credential: response.credential })
            });
            const result = await res.json();
            if (result.success) {
              succDiv.style.display = 'block';
              setTimeout(() => { try { window.close(); } catch(_) {} }, 1500);
            } else {
              errDiv.textContent = result.message || 'Đăng nhập bằng Google thất bại.';
              errDiv.style.display = 'block';
            }
          } catch(e) {
            errDiv.textContent = 'Không thể kết nối đến máy chủ.';
            errDiv.style.display = 'block';
          }
        }
      </script>
    </body>
    </html>
  `);
});

app.get('/api/auth/me', async (req, res) => {
  const user = authService.getRequestUser(req);
  if (!user) return res.status(401).json({ success: false, code: 'AUTH_REQUIRED' });
  if (isLocalDevRequest(req, 'LOCAL_DEV_AUTH')) {
    return res.json({ success: true, user });
  }
  try {
    const status = await centralAuthClient.accountStatus(user.username);
    if (status?.data?.company_role && status.data.company_role !== user.company_role) {
      authService.db.prepare('UPDATE users SET company_role=? WHERE id=?').run(status.data.company_role, user.id);
      user.company_role = status.data.company_role;
    }
  } catch (error) {
    if (error instanceof CentralAuthError && ['USER_NOT_FOUND', 'ACCOUNT_BLOCKED'].includes(error.code)) {
      authService.revokeRequestSession(req);
      res.setHeader('Set-Cookie', authService.clearCookie());
      return res.status(401).json({ success: false, code: error.code, message: error.message });
    }
    // A temporary License Server outage must not destroy a valid local session.
  }
  res.json({ success: true, user });
});

app.post('/api/auth/logout', (req, res) => {
  authService.revokeRequestSession(req);
  res.setHeader('Set-Cookie', authService.clearCookie());
  res.json({ success: true });
});

// Desktop startup probes this endpoint before a user session or license exists.
// Keep it ahead of both API protection middlewares so Electron can verify that
// it is talking to the backend process started by this exact app instance.
app.get('/api/health', (req, res) => res.json({
  status: 'OK', uptime: process.uptime(),
  db: 'SQLite WAL Mode', activeExtensions: extensionConnections.size,
  instance_token: process.env.CRM_INSTANCE_TOKEN || null,
  pid: process.pid
}));

const requireAuthenticatedApi = authService.middleware();
app.use('/api', (req, res, next) => {
  // Central payment callbacks and order polling must remain reachable before
  // a user session exists. License status/activation intentionally do not:
  // the product flow is authenticate first, then activate the workstation.
  const unauthenticatedPaymentPaths = [
    '/payment/sepay-webhook',
    '/orders/create',
    '/orders/status',
    '/extension/reload',
    '/avatars/'
  ];
  if (unauthenticatedPaymentPaths.some((pathPrefix) => req.path.startsWith(pathPrefix))) return next();
  return requireAuthenticatedApi(req, res, next);
});

// 1. API Kiểm tra trạng thái bản quyền cục bộ
app.get('/api/license/status', async (req, res) => {
  try {
    if (isLocalDevRequest(req, 'LOCAL_DEV_SKIP_LICENSE')) {
      return res.json({
        success: true,
        data: {
          isLicensed: true,
          reason: 'LOCAL_DEV',
          message: 'Đang dùng chế độ kiểm thử local.',
          key: 'LOCAL-DEV'
        }
      });
    }
    const user = authService.getRequestUser(req);
    const savedKey = licenseChecker.getSavedKey();

    // Nếu máy này chưa/đã bị đăng xuất Key (không có savedKey) và không phải tài khoản nhân viên
    if (!savedKey && user?.company_role !== 'EMPLOYEE') {
      return res.json({
        success: true,
        data: {
          isLicensed: false,
          reason: 'NO_KEY',
          message: 'Máy này chưa kích hoạt License Key.'
        }
      });
    }

    const { getMachineId } = require('./utils/machineId');
    const licenseAbortController = new AbortController();
    const licenseTimeout = setTimeout(() => licenseAbortController.abort(), 5000);
    const response = await fetch(`${LICENSE_SERVER_BASE_URL}/api/client-auth/license-status`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user.username, key: savedKey, machineId: getMachineId() }),
      signal: licenseAbortController.signal
    }).finally(() => clearTimeout(licenseTimeout));
    const result = await response.json().catch(() => ({}));
    if (result.success && result.data?.valid && result.data?.key && savedKey) {
      if (licenseChecker.getSavedKey() !== result.data.key) {
        licenseChecker.saveKey(result.data.key);
      }
    }
    res.json({ success: true, data: { isLicensed: Boolean(result.data?.valid), ...result.data } });
  } catch (error) {
    res.json({ success: true, data: { isLicensed: false, reason: 'LICENSE_SERVER_UNAVAILABLE', message: 'Không thể kiểm tra gói tài khoản.' } });
  }
});

// 2. API Kích hoạt Key mới
app.post('/api/license/activate', async (req, res) => {
  try {
    const { key } = req.body;
    if (!key) return res.status(400).json({ success: false, message: 'Thiếu mã Key' });

    const normalizedKey = key.trim();
    const { getMachineId } = require('./utils/machineId');
    const machineId = getMachineId();

    const centralResponse = await fetch(`${LICENSE_SERVER_BASE_URL}/api/license/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: normalizedKey,
        machineId,
        deviceName: 'Máy CRM Desktop',
        clientUsername: authService.getRequestUser(req).username
      })
    });
    const centralResult = await centralResponse.json();

    if (!centralResponse.ok || !centralResult.success) {
      return res.status(400).json({
        success: false,
        message: centralResult.message || centralResult.error || 'Không thể kích hoạt Key trên License Server',
        data: centralResult
      });
    }

    licenseChecker.saveKey(normalizedKey);
    const status = await licenseChecker.verify();

    if (status.isLicensed) {
      res.json({ success: true, message: 'Kích hoạt bản quyền thành công!', data: status });
    } else {
      licenseChecker.removeKey();
      res.status(400).json({ success: false, message: status.message || 'Mã Key không hợp lệ', data: status });
    }
  } catch (e) {
    res.status(500).json({ success: false, message: 'Không thể kết nối License Server', error: e.message });
  }
});

// 2b. Lưu tên công ty cho chính Key đang được kích hoạt trên máy này
app.post('/api/license/company', async (req, res) => {
  try {
    const companyName = String(req.body?.companyName || '').trim().replace(/\s+/g, ' ');
    if (companyName.length < 2 || companyName.length > 120) {
      return res.status(400).json({ success: false, message: 'Tên công ty phải từ 2 đến 120 ký tự' });
    }

    const savedKey = licenseChecker.getSavedKey();
    if (!savedKey) {
      return res.status(400).json({ success: false, message: 'Máy chưa có License Key đã kích hoạt' });
    }

    const centralResponse = await fetch(`${LICENSE_SERVER_BASE_URL}/api/license/company`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: savedKey, companyName })
    });
    const centralResult = await centralResponse.json();
    if (!centralResponse.ok || !centralResult.success) {
      return res.status(centralResponse.status || 400).json(centralResult);
    }
    res.json(centralResult);
  } catch (error) {
    res.status(502).json({ success: false, message: 'Không thể kết nối License Server để lưu tên công ty', error: error.message });
  }
});

// 3. API Đăng xuất Key
app.post('/api/license/deactivate', async (req, res) => {
  try {
    const key = licenseChecker.getSavedKey();
    if (key) {
      const { getMachineId } = require('./utils/machineId');
      const machineId = getMachineId();
      await fetch(`${LICENSE_SERVER_BASE_URL}/api/license/deactivate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, machineId })
      }).catch(() => {});
    }
    licenseChecker.removeKey();
    res.json({ success: true, message: 'Đã hủy đăng ký bản quyền trên máy này' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Proxy / Forward SePay Webhook sang Central License Server (Port 5055)
app.post('/api/payment/sepay-webhook', async (req, res) => {
  try {
    const fetchRes = await fetch(`${LICENSE_SERVER_BASE_URL}/api/sepay/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });
    const json = await fetchRes.json();
    res.status(fetchRes.status).json(json);
  } catch (err) {
    console.error('[Server 5050 Proxy SePay Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Áp dụng Middleware Bảo Vệ Khóa Backend cho tất cả các API CRM
app.use('/api', licenseChecker.middleware());

// Static: React Dashboard UI & Media files (Ưu tiên bản hot-update để áp dụng ngay không cần đóng app)
const clientDistPath = path.join(__dirname, '../../dist/client');
const getHotUpdateClientPath = () => {
  const resRoot = process.resourcesPath || path.resolve(__dirname, '../../updates');
  return path.join(resRoot, 'hot-update', 'dist', 'client');
};
const staticCacheHeaders = (res, filePath) => {
  if (filePath.endsWith('index.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  } else if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg') || filePath.endsWith('.png')) {
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
  }
};
app.use((req, res, next) => {
  const hotClient = getHotUpdateClientPath();
  if (fs.existsSync(hotClient)) {
    return express.static(hotClient, { setHeaders: staticCacheHeaders })(req, res, next);
  }
  return next();
});
app.use(express.static(clientDistPath, {
  setHeaders: staticCacheHeaders
}));
app.use('/data/media', express.static(path.join(APP_DATA_ROOT, 'media')));
app.use('/data/exports', express.static(path.join(APP_DATA_ROOT, 'exports')));

const server = http.createServer(app);
const io = new SocketIOServer(server, { cors: { origin: true, credentials: true } });
io.use((socket, next) => {
  const user = authService.getRequestUser({ headers: socket.handshake.headers });
  if (!user) return next(new Error('AUTH_REQUIRED'));
  socket.user = user;
  next();
});

const AppUpdaterService = require('./services/AppUpdaterService');
const appUpdater = new AppUpdaterService({ db, io });

app.get('/api/app-update/status', (req, res) => {
  const cfg = appUpdater.getConfig();
  res.json({
    success: true,
    status: {
      ...appUpdater.status,
      currentVersion: appUpdater.getCurrentVersion(),
    },
    config: {
      repo: cfg.repo,
      branch: cfg.branch,
      customManifestUrl: cfg.customManifestUrl,
      hasToken: Boolean(cfg.githubToken),
    },
  });
});

app.post('/api/app-update/check', async (req, res) => {
  try {
    const status = await appUpdater.checkForUpdates();
    res.json({ success: true, status });
  } catch (err) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

app.post('/api/app-update/apply', async (req, res) => {
  try {
    appUpdater.downloadAndApplyUpdate().catch((err) => {
      console.error('[AppUpdater] Apply failed:', err);
    });
    res.json({ success: true, status: appUpdater.status });
  } catch (err) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

app.post('/api/app-update/config', (req, res) => {
  try {
    const saved = appUpdater.saveConfig(req.body || {});
    res.json({
      success: true,
      config: {
        repo: saved.repo,
        branch: saved.branch,
        customManifestUrl: saved.customManifestUrl,
        hasToken: Boolean(saved.githubToken),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});
const wss = new WebSocket.Server({ noServer: true });
const extensionConnections = new Map();
// A Page runs in a separate Chrome profile but normally has the same Facebook
// c_user as Personal Messenger. Keep its WebSocket separate so Page startup
// never replaces the personal connection used for Inbox and Requests.
const pageExtensionConnections = new Map();
// Cache danh sách Fanpage phát hiện qua Auto-Discovery (In-memory)
// Key: accountId -> Value: { pages: Array, updatedAt: number }
const discoveredPagesByAccount = new Map();
const lastPageRefreshRequestedAt = new Map();
function pageConnectionKey(accountId, pageId) {
  return `${String(accountId || '')}:${String(pageId || '')}`;
}
function activePageSourcesForAccount(accountId) {
  return db.prepare(`
    SELECT external_id AS page_id FROM inbox_sources
    WHERE source_type = 'page_messenger' AND status = 'ACTIVE'
      AND owner_account_id = ? AND external_id IS NOT NULL
  `).all(String(accountId || '')).filter((row) => /^\d+$/.test(String(row.page_id || '')));
}
function dispatchPageSidebarSync(accountId, reason = 'manual') {
  // TẮT: đồng bộ page qua tab Business Suite (extension) đã ngừng sử dụng —
  // Page giờ chạy bằng Messenger Platform (Graph API + webhook qua cầu nối hosting).
  return 0;
  const accountKey = String(accountId || '');
  if (!accountKey) return 0;
  let dispatched = 0;
  const isDeep = reason === 'manual' || reason === 'manual_crm_request' || reason === 'manual_sync_window' || reason === 'initial_deep';
  for (const source of activePageSourcesForAccount(accountKey)) {
    const pageId = String(source.page_id);
    const pageWs = pageExtensionConnections.get(pageConnectionKey(accountKey, pageId));
    if (pageWs?.readyState === WebSocket.OPEN) {
      pageWs.send(JSON.stringify({
        type: 'SYNC_PAGE_SIDEBAR',
        data: {
          account_id: accountKey,
          page_id: pageId,
          reason,
          deep: isDeep,
          max_rounds: isDeep ? 35 : 1
        }
      }));
      dispatched += 1;
    }
    // NOTE: Removed auto-spawn startPageProcess here. When pageWs is not
    // connected the user's own Chrome (with Meta Business Suite already
    // authenticated) will handle Page sync. Spawning a fresh, unauthenticated
    // Chrome profile just redirects to the Facebook login page.
  }
  return dispatched;
}
const messageRequestActionOwners = new Map();
const pendingAccountOwners = new Map();
// Pending-key setups that successfully promoted to a real account (this
// process only). The /api/facebook-setup/:key/status poll additionally treats
// an ACTIVE accounts row whose profile_dir contains the pending key as
// completed, so a backend restart between register and poll cannot strand the
// operator UI on "Đang chờ đăng nhập Facebook..." forever.
const completedPendingSetups = new Map();
// Single reader for the pending-profile owner marker. The marker is written
// as { owner_user_id } (see POST /api/accounts/new-session); older builds
// also wrote userId, so accept both spellings.
function markerOwnerUserId(pendingKey) {
  try {
    const markerPath = path.join(APP_DATA_ROOT, 'profiles', String(pendingKey), '.crm-pending-owner.json');
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    return marker.owner_user_id || marker.userId || null;
  } catch (_) {
    return null;
  }
}

// ─── Chrome profile cleanup ─────────────────────────────────────────────
// 1) deleteChromeProfileDir(): xóa tài khoản FB = xóa luôn thư mục profile
//    Chrome của nó (yêu cầu sản phẩm 2026-09-17; trước đây thư mục được giữ
//    lại để tái sử dụng Facebook trust). Chỉ nhận tên thư mục cuối cùng và
//    luôn giới hạn bên trong profiles/ để không bao giờ xóa ra ngoài.
// 2) sweepAbandonedPendingProfiles(): profile pending_* mà operator không bao
//    giờ đăng nhập (bấm nút rồi hủy/đóng Chrome) trước đây tồn tại vĩnh viễn
//    - 93 thư mục ~20GB tích tụ từ 2026-08-21. Sweep xóa những cái: không
//    được tham chiếu bởi accounts.profile_dir, không có process đang chạy,
//    và "già" hơn 6 giờ (marker hoặc thư mục - phiên đang nhập liệu có
//    mtime tươi nên không bao giờ bị xóa nhầm).
const PENDING_SWEEP_MIN_AGE_MS = 6 * 60 * 60 * 1000;
function deleteChromeProfileDir(dirName) {
  const base = path.basename(String(dirName || '').trim());
  if (!base || base === '.' || base === '..') return false;
  const target = path.join(APP_DATA_ROOT, 'profiles', base);
  if (!fs.existsSync(target)) return false;
  try {
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
    console.log(`[ProfileCleanup] Đã xóa thư mục Chrome profile: ${base}`);
    return true;
  } catch (error) {
    console.warn(`[ProfileCleanup] Chưa xóa được ${base} (Chrome có thể còn giữ file):`, error.message);
    return false;
  }
}
function sweepAbandonedPendingProfiles() {
  const profilesRoot = path.join(APP_DATA_ROOT, 'profiles');
  let referenced;
  try {
    referenced = new Set(db.prepare('SELECT profile_dir FROM accounts').all()
      .map((row) => path.basename(String(row.profile_dir || '')).toLowerCase()));
  } catch (_) { return; }
  let removed = 0;
  try {
    for (const entry of fs.readdirSync(profilesRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith('pending_')) continue;
      if (referenced.has(entry.name.toLowerCase())) continue;
      if (processManager.processes.has(entry.name)) continue;
      const dirPath = path.join(profilesRoot, entry.name);
      let ageMs = null;
      try { ageMs = Date.now() - fs.statSync(path.join(dirPath, '.crm-pending-owner.json')).mtimeMs; } catch (_) {}
      if (ageMs === null) {
        try { ageMs = Date.now() - fs.statSync(dirPath).mtimeMs; } catch (_) { continue; }
      }
      if (ageMs < PENDING_SWEEP_MIN_AGE_MS) continue;
      try {
        // Phiên bỏ hoang CÓ THỂ còn Chrome đang mở (cửa sổ BS/popup phiền) -
        // đóng nhẹ nhàng (WM_CLOSE) trước để taskbar gỡ nút sạch sẽ, chỉ
        // taskkill khi Chrome treo; xóa profile sau để tránh khóa file
        // (reproduced 2026-09-19).
        const findPs = `Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" -ErrorAction SilentlyContinue | Where-Object { ($_.CommandLine -replace '\\','/') -like '*${entry.name.replace(/'/g, "''")}*' } | ForEach-Object { Write-Output $_.ProcessId }`;
        const encodedFind = Buffer.from(findPs, 'utf16le').toString('base64');
        const found = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodedFind], { timeout: 15000, windowsHide: true, encoding: 'utf8' });
        const chromePids = String(found.stdout || '')
          .split(/\r?\n/)
          .map((line) => Number.parseInt(line.trim(), 10))
          .filter((p) => Number.isInteger(p) && p > 0);
        const stillAlive = closeChromePidsGracefullySync(chromePids, 3000);
        for (const pid of stillAlive) {
          spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, encoding: 'utf8' });
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 800); // sleep dong bo (ham khong async)
        fs.rmSync(dirPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
        removed++;
        console.log(`[ProfileCleanup] Đã xóa profile pending bỏ hoang: ${entry.name}`);
      } catch (_) { /* file đang bị khóa - sweep lần sau sẽ thử lại */ }
    }
  } catch (_) {}
  if (removed) console.log(`[ProfileCleanup] Sweep hoàn tất: ${removed} profile pending rác.`);
}
setTimeout(sweepAbandonedPendingProfiles, 60 * 1000);
setInterval(sweepAbandonedPendingProfiles, 60 * 60 * 1000);
// Operator closed the setup Chrome without finishing registration: delete
// that pending profile right away (their request 2026-09-17: "ấn thêm tk fb
// mở chrome lên nhưng user k login cũng tự động xóa") and tell the waiting
// AccountManagerModal to stop spinning. The 6h sweep stays as the backstop
// for crashes/backend restarts this immediate path can't see.
processManager.onPendingSessionAbandoned = (pendingKey) => {
  const key = String(pendingKey || '');
  if (!/^pending_[a-zA-Z0-9_]+$/.test(key)) return;
  setTimeout(() => {
    // Registration can land between Chrome exit and this timer - never
    // delete a profile some account row still points at.
    try {
      if (db.prepare('SELECT 1 FROM accounts WHERE profile_dir LIKE ?').get(`%${key}%`)) return;
    } catch (_) { return; }
    pendingAccountOwners.delete(key);
    deleteChromeProfileDir(key);
    io.emit('ACCOUNT_LINK_FAILED', {
      pending_key: key,
      error: 'Đã đóng Chrome trước khi hoàn tất đăng nhập - phiên thêm tài khoản đã được dọn.'
    });
  }, 5000);
};
// Existing-account "Kết nối Facebook" launches should become background
// processes only after that account's extension has registered successfully.
// New-account pending sessions are intentionally excluded so the login window
// stays visible for the operator.
const backgroundAfterConnectRequests = new Map();
// A newly-added Facebook profile first registers with pending_key while the
// operator completes login/PIN. Its normal REGISTER_ACCOUNT arrives later.
// Keep a bounded bootstrap retry here so that account enters the same inbox +
// requests sync pipeline as the existing "Connect Facebook" action, even if
// the first scan races the three Messenger role tabs becoming ready.
const newAccountBootstrapSyncs = new Map();
// pageId -> lan cuoi yeu cau extension lay profile (ten/avatar) cua Page
const pageProfileFetchLastRequestedAt = new Map();
const domReplaySuppressUntil = new Map();
const callEventDeduplicator = new CallEventDeduplicator();
const historyBackfillJobs = new Map();
const bulkHistoryJobs = new Map();
// Diagnostic mode requested by the operator: keep managed Facebook Chrome
// visible after Connect Facebook so realtime/sync behaviour can be observed.
// Existing background-mode code remains intact and can be restored by setting
// this flag to false.
const KEEP_CONNECTED_FACEBOOK_CHROME_VISIBLE = false;
const backgroundAfterConnectTimers = new Map();

function enterBackgroundAfterSyncWindow(accountId, requestedAt, reason = 'sync_finished') {
  const key = String(accountId || '');
  if (!key || !Number.isFinite(requestedAt) || KEEP_CONNECTED_FACEBOOK_CHROME_VISIBLE) return;
  const existing = backgroundAfterConnectTimers.get(key);
  if (existing) clearTimeout(existing);
  const remaining = Math.max(0, 120000 - (Date.now() - requestedAt));
  const timer = setTimeout(async () => {
    backgroundAfterConnectTimers.delete(key);
    if (backgroundAfterConnectRequests.get(key) !== requestedAt) return;
    backgroundAfterConnectRequests.delete(key);
    const hideRes = await processManager.hideAccountProcess(key);
    if (hideRes?.success) {
      io.emit('ACCOUNT_DISPLAY_CHANGED', {
        account_id: key,
        chrome_display_mode: 'BACKGROUND',
        is_chrome_running: true
      });
    }
    console.log(`[BACKGROUND_AFTER_SYNC] account=${key} hidden=true reason=${reason} success=${!!hideRes?.success}`);
  }, remaining);
  backgroundAfterConnectTimers.set(key, timer);
  if (typeof timer.unref === 'function') timer.unref();
}

function scheduleNewAccountBootstrapSync(accountId) {
  const key = String(accountId || '');
  if (!key) return;
  const existing = newAccountBootstrapSyncs.get(key);
  if (existing && !existing.awaitingSetup && existing.timer) return;
  if (existing?.timer) clearTimeout(existing.timer);
  const state = { attempt: 0, timer: null };
  const delays = [1500, 12000, 35000];
  const dispatch = () => {
    if (!newAccountBootstrapSyncs.has(key)) return;
    const attempt = state.attempt++;
    if (!InboxSyncScheduler.isSyncWindowActive(key)) {
      InboxSyncScheduler.startSyncWindow(key, 120000);
    }
    const dispatched = InboxSyncScheduler.requestSidebarSync(key, 'new_account_bootstrap', { force: attempt === 0, scanMode: 'full' });
    console.log(`[NEW_ACCOUNT_BOOTSTRAP_SYNC] account=${key} attempt=${attempt + 1}/${delays.length} dispatched=${dispatched}`);
    if (state.attempt >= delays.length) {
      newAccountBootstrapSyncs.delete(key);
      return;
    }
    state.timer = setTimeout(dispatch, delays[state.attempt]);
    if (typeof state.timer.unref === 'function') state.timer.unref();
  };
  newAccountBootstrapSyncs.set(key, state);
  state.timer = setTimeout(dispatch, delays[0]);
  if (typeof state.timer.unref === 'function') state.timer.unref();
}

function completeNewAccountBootstrapSync(accountId) {
  const key = String(accountId || '');
  const state = newAccountBootstrapSyncs.get(key);
  if (!state) return;
  if (state.timer) clearTimeout(state.timer);
  newAccountBootstrapSyncs.delete(key);
  console.log(`[NEW_ACCOUNT_BOOTSTRAP_SYNC] account=${key} completed`);
}

function sanitizeLog(str, maxLen = 120) {
  if (!str) return '';
  const cleaned = String(str).replace(/[\r\n]+/g, ' ').trim();
  return cleaned.length > maxLen ? cleaned.substring(0, maxLen) + '...' : cleaned;
}

// Đo từng chặng đường realtime hint (observer -> bg -> server) trong
// composer-debug.log để so latency với bgDebug/obsDebug phía extension.
// 2026-10-09: file từng phình 126MB vì hint relay ~10 dòng/s — mọi writer
// phải đi qua appendComposerDebugLog để xoay vòng 30MB.
const composerLogState = { bytes: 0 };

function appendComposerDebugLog(payload) {
  try {
    const logPath = path.join(APP_DATA_ROOT, 'composer-debug.log');
    const line = JSON.stringify(payload) + '\n';
    if (composerLogState.bytes === 0) {
      try { composerLogState.bytes = fs.statSync(logPath).size; } catch (_) {}
    }
    composerLogState.bytes += line.length;
    if (composerLogState.bytes > 30 * 1024 * 1024) {
      try { fs.renameSync(logPath, logPath + '.1'); } catch (_) {}
      composerLogState.bytes = 0;
    }
    fs.appendFileSync(logPath, line);
  } catch (_) {}
}

function syncDebug(stage, data = {}) {
  appendComposerDebugLog({ at: new Date().toISOString(), source: 'SYNC_DEBUG', stage, ...data });
}

// Hint relay trùng payload: chặn trước khi chạm txn sidebar trong
// SYNC_THREADS_RESULT (observer trôi fp theo text thời gian/typing từng làm
// backend upsert 30 threads ~10 lần/giây).
const lastRealtimeHintSig = new Map();
let lastUnchangedHintLogAt = 0;

// Chấm xanh FB thật theo hint sidebar: flip 0->1 giữa các lần quét. Tách
// khỏi DB vì operator bấm đọc làm DB 1->0 khiến flip tính từ DB luôn true ở
// scan kế (badge hồi sinh sau khi đọc — reproduce 2026-10-12).
const hintUnreadTracker = new HintUnreadTracker();

const richContentSecret = crypto.randomBytes(32);

function requireLocalCrmRequest(req, res, next) {
  if (isLoopbackAddress(req.socket?.remoteAddress) === false) {
    return res.status(403).json({
      code: 'LOCAL_CRM_REQUIRED',
      error: 'Rich-message chỉ được phép từ CRM chạy trên máy này.'
    });
  }
  next();
}

function getLocalOperatorId() {
  return db.prepare(
    "SELECT id FROM users WHERE role = 'ADMIN' ORDER BY id ASC LIMIT 1"
  ).get()?.id || null;
}

function getRichMessageCapabilityOptions() {
  return {
    database: db,
    getConnection: (accountId) => extensionConnections.get(accountId)
  };
}

function createAttachmentContentToken(attachmentId, lifetimeMs = 60 * 60 * 1000) {
  const expires = Date.now() + lifetimeMs;
  const payload = String(attachmentId) + ':' + expires;
  const token = crypto.createHmac('sha256', richContentSecret).update(payload).digest('hex');
  return { expires, token };
}

function verifyAttachmentContentToken(attachmentId, expiresValue, tokenValue) {
  const expires = Number(expiresValue);
  const token = String(tokenValue || '');
  if (Number.isSafeInteger(expires) === false || expires < Date.now() || /^[a-f0-9]{64}$/.test(token) === false) {
    return false;
  }
  const expected = crypto.createHmac('sha256', richContentSecret)
    .update(String(attachmentId) + ':' + expires)
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

// Rich-message attachments require a signed URL per FR-023's "authenticated
// content access" - a stored, unsigned media_url would 403 (token missing)
// and a stored absolute filesystem path would 404 via the SPA catch-all
// (neither is web-servable as-is). Sign fresh on every read instead of at
// insert time, since createAttachmentContentToken()'s token has a lifetime.
function withAttachmentAccessUrl(message) {
  if (!message || !message.attachment_id) return message;
  const { expires, token } = createAttachmentContentToken(message.attachment_id);
  return {
    ...message,
    media_url: '/api/outbound-attachments/' + message.attachment_id + '/content' +
      '?expires=' + expires + '&token=' + token,
    local_media_path: null
  };
}

function hasMessageMediaPayload(message = {}) {
  return Boolean(
    message.media_url
    || message.local_media_path
    || message.attachment_id
    || message.attachment?.preview_url
    || message.attachment?.media_url
    || message.attachment?.local_media_path
    || message.attachment?.id
  );
}

function isRenderableStoredMessage(message = {}) {
  const cleaned = cleanMessageText(message.content ?? message.cleaned ?? message.text ?? '');
  const mediaType = String(message.media_type || 'text').toLowerCase();
  return Boolean(
    hasMessageMediaPayload(message)
    || mediaType === 'call'
    || (cleaned && !isSystemOrMetadataText(cleaned))
  );
}

// Avatar thành viên hội thoại NHÓM: lưu file local theo (thread, tên thành
// viên) - khác avatar tổng của thread (contacts.avatar_url). Chỉ ghi khi chưa
// có để một URL CDN hết hạn không xóa avatar tốt đã lưu.
async function upsertMemberAvatar(threadId, senderName, avatarData, { onlyIfMissing = true } = {}) {
  const name = String(senderName || '').trim();
  const data = String(avatarData || '');
  if (!threadId || !name || !data) return null;
  try {
    if (onlyIfMissing) {
      const existing = db.prepare(
        'SELECT avatar_url FROM message_sender_avatars WHERE thread_id = ? AND sender_name = ?'
      ).get(String(threadId), name);
      if (existing?.avatar_url) return existing.avatar_url;
    }
    const slug = crypto.createHash('md5').update(`${threadId}::${name}`).digest('hex').substring(0, 10);
    const localAvatarPath = await saveAvatarFromBase64OrUrl(data, `sender_${threadId}_${slug}`);
    if (!localAvatarPath) return null;
    db.prepare(`
      INSERT INTO message_sender_avatars (thread_id, sender_name, avatar_url, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(thread_id, sender_name) DO UPDATE SET
        avatar_url = COALESCE(excluded.avatar_url, message_sender_avatars.avatar_url),
        updated_at = datetime('now')
    `).run(String(threadId), name, localAvatarPath);
    return localAvatarPath;
  } catch (err) {
    console.warn('[WS] Member avatar save failed:', err.message);
    return null;
  }
}

// Quote reply: tìm tin gốc được trích dẫn theo nội dung reply_to_text trong
// cùng thread. Ưu tiên tin đứng TRƯỚC reply (timestamp <=) và gần nhất; nếu
// không có thì tin gần nhất bất kể phía (history-sync timestamp có thể lệch).
// Trả về { id, name } — id = messages.id của tin gốc (UI click-lướt theo
// data-msg-key), name = "Bạn" nếu tin gốc do operator gửi, còn lại
// sender_name (nhóm lưu tên thành viên) / contact_name (1-1).
function resolveReplyTargetRow(threadId, replyToText, beforeTsMs = null) {
  const text = String(replyToText || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  if (!text || !threadId) return null;
  const base = `
    SELECT m.id, m.is_outgoing, m.sender_name, t.contact_name
    FROM messages m JOIN threads t ON t.id = m.thread_id
    WHERE m.thread_id = ? AND TRIM(REPLACE(REPLACE(m.content, char(10), ' '), char(13), ' ')) = ?`;
  const ts = Number.isFinite(Number(beforeTsMs)) && Number(beforeTsMs) > 0 ? Number(beforeTsMs) : null;
  let row = db.prepare(`${base} AND m.timestamp_ms <= ? ORDER BY m.timestamp_ms DESC, m.id DESC LIMIT 1`)
    .get(threadId, text, ts ?? Number.MAX_SAFE_INTEGER);
  if (!row && ts != null) {
    row = db.prepare(`${base} ORDER BY ABS(m.timestamp_ms - ?) ASC LIMIT 1`).get(threadId, text, ts);
  }
  if (!row) row = db.prepare(`${base} ORDER BY m.timestamp_ms DESC, m.id DESC LIMIT 1`).get(threadId, text);
  if (!row) return null;
  return {
    id: Number(row.id),
    name: Number(row.is_outgoing) === 1
      ? 'Bạn'
      : (String(row.sender_name || '').trim() || String(row.contact_name || '').trim() || null)
  };
}

function storeReplyTargetForRow(messageRowId, threadId, replyToText, beforeTsMs = null) {
  const target = resolveReplyTargetRow(threadId, replyToText, beforeTsMs);
  if (!target) return false;
  try {
    db.prepare('UPDATE messages SET reply_to_id = ?, reply_to_sender_name = ? WHERE id = ?')
      .run(target.id, target.name, messageRowId);
    return true;
  } catch (_) { return false; }
}

function prepareMessagesForClient(rows = []) {
  const prepared = rows
    .map((row) => {
      const cleaned = cleanMessageText(row.content ?? row.cleaned ?? '');
      // System/DOM labels are never useful as a caption. Keep text only when
      // it survives cleaning; a real attachment remains renderable by itself.
      return withAttachmentAccessUrl({ ...row, content: cleaned || '' });
    })
    .filter(isRenderableStoredMessage)
    // Old malformed observer rows can already be in SQLite when an update is
    // installed. Hide an incoming echo of the operator's just-sent text here
    // too, not only at the WebSocket write boundary.
    .filter((row) => !isRecentOutgoingTextEcho(row.thread_id, row));
  // Avatar từng thành viên nhóm: tra theo (thread_id, sender_name) một lượt
  // cho cả snapshot thay vì query per-row.
  const memberNamesByThread = new Map();
  for (const row of prepared) {
    const name = String(row.sender_name || '').trim();
    if (!name || Number(row.is_outgoing) === 1) continue;
    if (!memberNamesByThread.has(row.thread_id)) memberNamesByThread.set(row.thread_id, new Set());
    memberNamesByThread.get(row.thread_id).add(name);
  }
  for (const [threadId, names] of memberNamesByThread) {
    try {
      const nameList = [...names];
      const avatarRows = db.prepare(`
        SELECT sender_name, avatar_url FROM message_sender_avatars
        WHERE thread_id = ? AND sender_name IN (${nameList.map(() => '?').join(',')})
      `).all(threadId, ...nameList);
      const avatarByName = new Map(avatarRows.map((r) => [String(r.sender_name), r.avatar_url]));
      for (const row of prepared) {
        const name = String(row.sender_name || '').trim();
        const localAvatar = name && avatarByName.get(name);
        if (localAvatar) row.sender_avatar_url = localAvatar;
      }
    } catch (_) { /* enrich là lành hóa */ }
  }
  LinkPreviewService.attachPreviews(prepared);
  return prepared;
}

function isRecentOutgoingTextEcho(threadId, message = {}, database = db) {
  const content = cleanMessageText(message.content ?? message.cleaned ?? '');
  if (!threadId || !content || hasMessageMediaPayload(message)) return false;
  const mediaType = String(message.media_type || 'text').toLowerCase();
  if (mediaType && mediaType !== 'text') return false;
  const isExplicitOutgoing = message.is_outgoing === true || message.is_outgoing === 1;
  if (isExplicitOutgoing) return false;
  // GUARD NÀY CHỈ ÁP DỤNG CHO ID TỔNG HỢP (dom_/history_/network_...): đó là
  // hình dạng Facebook dùng khi render lại bubble operator thành incoming -
  // chính mục tiêu của guard. Row mang MID THẬT được server tự khớp theo
  // fb_message_id (UNIQUE + hysteresis spec 019) nên không thể thành ghost;
  // check text ở đây từng nuốt tin THẬT trùng nội dung: "alo" của operator
  // -> khách/operator nhắn "alo" lại trong 10 phút là mất (report 2026-10-07).
  const isSyntheticObserverId = /^(?:dom_|history_|network_|websocket_|mercury_|xhr_)/i.test(String(message.fb_message_id || ''));
  if (!isSyntheticObserverId) return false;
  // MIỄN TRỪ emoji-thuần: khách trả lời 👍 sau khi operator gửi 👍 là chuyện
  // bình thường; guard này đã nuốt 2 like mid tổng hợp của khách (reproduce
  // 2026-10-07 14:26 - log "skip CRM outbound text echo parsed as incoming
  // content=👍").
  if (/^(?=[\s\S]*\p{Extended_Pictographic})[\p{Extended_Pictographic}\uFE0F\u200D\s]+$/u.test(content)) return false;
  return ConversationRepository.hasRecentMatchingOutgoing(threadId, content, database, {
    windowMs: 24 * 60 * 60 * 1000,
    futureToleranceMs: 60 * 1000
  });
}

// History rows can be collapsed from Facebook's temporary _media companion
// id into the durable parent row before the remote file finishes downloading.
// Hydrate by the durable SQLite row id so incoming photos/videos cannot lose
// their local path during that merge.
const inboundMediaHydration = new InboundMediaHydrationService({
  database: db,
  downloader: mediaDownloader,
  maxConcurrency: 4,
  onHydrated: (stored) => io.emit('THREAD_MESSAGES_UPDATED', {
    thread_id: String(stored.thread_id),
    messages: [withAttachmentAccessUrl(stored)]
  })
});

const resolvedPageVideos = new Map();

// Thống kê batch Page: log định kỳ để theo dõi tỉ lệ duplicate/rejected
// (batch trùng lặp hàng loạt là dấu hiệu state machine phía extension giật).
const pageBatchStats = { total: 0, committed: 0, duplicate: 0, stale_generation: 0, rejected: 0, other: 0 };

function sendRichMessageError(res, error) {
  const status = Number(error?.httpStatus) || 400;
  res.status(status).json({
    error: error?.message || 'Không thể xử lý rich-message.',
    code: error?.code || 'RICH_MESSAGE_ERROR',
    details: error?.details || null
  });
}

// Router HTTP Upgrade: phân định Socket.io vs Chrome Extension WebSocket
// Extension kết nối tại: ws://127.0.0.1:5050/extension
// Socket.IO kết nối tại: ws://localhost:5050/socket.io/...
server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;

  if (pathname.startsWith('/socket.io')) {
    // Socket.io tự xử lý upgrade của mình
    return;
  }

  // Chấp nhận /extension (Chrome Extension) hoặc / (legacy)
  if (pathname === '/extension' || pathname === '/') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    // Từ chối các path không xác định
    socket.destroy();
  }
});

// ── Helper: gửi tin nhắn qua Extension WebSocket ──────────────────────────
function deleteOutboundMessageRows({ messageId = null, threadId = null, clientMessageId = null, failedOnly = false } = {}) {
  const clauses = [];
  const params = [];
  if (messageId != null) { clauses.push('id = ?'); params.push(messageId); }
  if (threadId != null) { clauses.push('thread_id = ?'); params.push(String(threadId)); }
  if (clientMessageId != null) { clauses.push('client_message_id = ?'); params.push(String(clientMessageId)); }
  if (!clauses.length) return 0;
  const failedClause = failedOnly ? " AND delivery_status = 'failed'" : '';
  const rows = db.prepare(`SELECT id FROM messages WHERE ${clauses.join(' AND ')}${failedClause}`).all(...params);
  if (!rows.length) return 0;
  return db.transaction((messageIds) => {
    const attempts = db.prepare(`SELECT id FROM outbound_attempts WHERE message_id IN (${messageIds.map(() => '?').join(',')})`).all(...messageIds);
    if (attempts.length) {
      const attemptIds = attempts.map((row) => row.id);
      const placeholders = attemptIds.map(() => '?').join(',');
      db.prepare(`UPDATE message_queue SET outbound_attempt_id = NULL WHERE outbound_attempt_id IN (${placeholders})`).run(...attemptIds);
      db.prepare(`UPDATE messages SET latest_attempt_id = NULL WHERE latest_attempt_id IN (${placeholders})`).run(...attemptIds);
      db.prepare(`DELETE FROM outbound_attempts WHERE id IN (${placeholders})`).run(...attemptIds);
    }
    return db.prepare(`DELETE FROM messages WHERE id IN (${messageIds.map(() => '?').join(',')})`).run(...messageIds).changes;
  })(rows.map((row) => row.id));
}

function emitOutboundCleanupResolved(threadId, pendingRow, confirmedRow) {
  // The deleted row's optimistic bubble in the CRM is keyed by
  // client_message_id. Deleting silently left it spinning forever, so tell
  // the UI how the underlying send actually ended.
  const clientMessageId = String(pendingRow?.client_message_id || '');
  if (!clientMessageId.startsWith('client_') && !clientMessageId.startsWith('queue_')) return;
  io.emit('MESSAGE_SENT', {
    thread_id: String(threadId),
    client_message_id: clientMessageId,
    fb_message_id: confirmedRow?.fb_message_id || undefined,
    status: 'sent'
  });
}

function cleanupStalePendingOutbound(threadId) {
  if (!threadId) return 0;
  // A queue row whose attempt link was severed (its pending message row was
  // deleted by an earlier cleanup) can never leave 'processing' on its own.
  db.prepare(`
    UPDATE message_queue SET status = 'failed', error_reason = 'ATTEMPT_LOST'
    WHERE status = 'processing' AND outbound_attempt_id IS NULL
      AND processed_at IS NOT NULL AND processed_at < datetime('now', '-5 minutes')
  `).run();

  const confirmedOutgoing = db.prepare(`
    SELECT content, media_type, timestamp_ms, fb_message_id FROM messages
    WHERE thread_id = ? AND is_outgoing = 1 AND fb_message_id LIKE 'mid.%'
  `).all(String(threadId));
  if (!confirmedOutgoing.length) return 0;

  const confirmedContents = new Set(confirmedOutgoing.map(c => (c.content || '').trim()).filter(Boolean));
  // Carry the live attempt/queue status: an in-flight rich send owns a pending
  // row here while its video is still uploading, and must never look "stale"
  // just because an older media in the same thread was confirmed recently.
  const stalePending = db.prepare(`
    SELECT p.id, p.client_message_id, p.content, p.media_type, p.attachment_id, p.timestamp_ms,
           a.status AS attempt_status, aq.status AS queue_status
    FROM messages p
    LEFT JOIN outbound_attempts a ON a.id = p.latest_attempt_id
    LEFT JOIN message_queue aq ON aq.outbound_attempt_id = a.id
    WHERE p.thread_id = ? AND p.is_outgoing = 1 AND (p.fb_message_id LIKE 'pending_%' OR p.fb_message_id NOT LIKE 'mid.%')
  `).all(String(threadId));

  let deletedCount = 0;
  for (const pending of stalePending) {
    if (['queued', 'dispatching', 'awaiting_confirmation'].includes(String(pending.attempt_status || ''))) continue;
    if (['pending', 'processing'].includes(String(pending.queue_status || ''))) continue;
    const pContent = (pending.content || '').trim();
    if (pContent && confirmedContents.has(pContent)) {
      // Bảo vệ: Nếu tin nhắn pending có đính kèm media (video/ảnh/tệp),
      // không được xóa nó chỉ vì caption text trùng khớp với một tin nhắn text đồng hành trên Facebook!
      if (pending.attachment_id || (pending.media_type && pending.media_type !== 'text')) {
        continue;
      }
      const confirmedRow = confirmedOutgoing.find(c => (c.content || '').trim() === pContent);
      deleteOutboundMessageRows({ messageId: pending.id });
      emitOutboundCleanupResolved(threadId, pending, confirmedRow);
      deletedCount++;
      continue;
    }
    if (pending.attachment_id || (pending.media_type && pending.media_type !== 'text')) {
      const pTime = Number(pending.timestamp_ms) || 0;
      const matchingMidMedia = confirmedOutgoing.find(c =>
        c.media_type !== 'text' && pTime > 0 && Number(c.timestamp_ms) > 0 && Math.abs(pTime - Number(c.timestamp_ms)) <= 120000
      );
      if (matchingMidMedia) {
        deleteOutboundMessageRows({ messageId: pending.id });
        emitOutboundCleanupResolved(threadId, pending, matchingMidMedia);
        deletedCount++;
      }
    }
  }
  return deletedCount;
}

function normMentionKey(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim();
}

// Bóc tách "@Tên" user TỰ GÕ trong text (không chọn dropdown CRM => mentions rỗng).
// Đối chiếu group_members đã quét: với mỗi @ đầu dòng/sau khoảng trắng, thử khớp
// tên dài nhất trước (tối đa 6 từ); tên phải đứng trước khoảng trắng hoặc cuối
// text — giống điều kiện extension dùng để biến chip. Không khớp => text thường.
function autoDetectMentionsFromText(text, threadId) {
  const raw = String(text || '');
  if (!raw.includes('@')) return [];
  let members;
  try {
    members = db.prepare('SELECT name FROM group_members WHERE thread_id = ?').all(threadId)
      .map((r) => String(r?.name || '').trim())
      .filter(Boolean);
  } catch (_) {
    return [];
  }
  if (!members.length) return [];
  const byKey = new Map();
  for (const name of members) {
    const key = normMentionKey(name);
    if (key && !byKey.has(key)) byKey.set(key, name);
  }
  const found = [];
  const seen = new Set();
  const re = /(^|\s)@([^\n@]{1,120})/g;
  let match;
  while ((match = re.exec(raw)) !== null) {
    const tokens = String(match[2] || '').split(/\s+/).filter(Boolean);
    for (let len = Math.min(6, tokens.length); len >= 1; len--) {
      const name = byKey.get(normMentionKey(tokens.slice(0, len).join(' ')));
      if (name) {
        if (!seen.has(name)) { seen.add(name); found.push({ name, user_id: '' }); }
        break;
      }
    }
  }
  return found;
}

async function sendViaExtension(thread_id, text, client_message_id = null, mentions = null) {
  // Mention chọn từ composer CRM (dùng để extension click dropdown gốc của FB
  // khi gõ tin) — sanitize tối đa 20 mục, chỉ giữ name + user_id.
  let mentionList = Array.isArray(mentions)
    ? mentions.slice(0, 20)
      .map((m) => ({ name: String(m?.name || '').trim().slice(0, 80), user_id: String(m?.user_id ?? m?.userId ?? '').trim().slice(0, 40) }))
      .filter((m) => m.name)
    : [];
  const autoMentions = autoDetectMentionsFromText(text, thread_id);
  if (autoMentions.length) {
    const keys = new Set(mentionList.map((m) => normMentionKey(m.name)));
    for (const am of autoMentions) {
      const key = normMentionKey(am.name);
      if (!keys.has(key)) { keys.add(key); mentionList.push(am); }
    }
    mentionList = mentionList.slice(0, 20);
    console.log(`[Mention] auto-split thread=${thread_id}: ${mentionList.map((m) => m.name).join(' | ')}`);
  }
  // Tìm account_id của thread
  const thread = db.prepare(
    'SELECT account_id, contact_name, thread_url FROM threads WHERE id = ?'
  ).get(thread_id);
  if (!thread) throw new Error(`Thread ${thread_id} không tồn tại`);

  // Match the stable project behaviour: a sleeping MV3 worker is allowed time
  // to reconnect, but a send operation must never restart its Chrome profile.
  let extWs = extensionConnections.get(thread.account_id);
  if (!extWs || extWs.readyState !== WebSocket.OPEN) {
    const startWait = Date.now();
    while ((!extWs || extWs.readyState !== WebSocket.OPEN) && Date.now() - startWait < 8000) {
      await new Promise(resolve => setTimeout(resolve, 500));
      extWs = extensionConnections.get(thread.account_id);
    }
  }
  if (!extWs || extWs.readyState !== WebSocket.OPEN) {
    throw new Error(`Extension cho tài khoản ${thread.account_id} không kết nối`);
  }

  // Route Page threads through the already-built queue pipeline (feature 009:
  // message_queue -> QueueWorker -> SEND_QUEUED_MESSAGE -> handleSendPageMessage,
  // CDP into Business Suite) instead of the generic personal-messenger dispatch
  // below. Personal threads (or any thread with no resolvable page source) keep
  // the exact existing behavior (feature 015).
  const { sourceType } = ConversationRepository.getThreadSource(thread_id);
  const isPageThread = sourceType === 'page_messenger';

  let clientMsgId;
  let queueId = null;
  if (isPageThread) {
    // client_message_id MUST match what handleSendQueuedMessage independently
    // derives ('queue_' + queue_id) so the existing SEND_MESSAGE_RESULT
    // correlation below finds this pending row - never the caller-supplied id.
    queueId = MessageQueueRepository.insert({ thread_id, account_id: thread.account_id, content: text });
    clientMsgId = `queue_${queueId}`;
  } else {
    clientMsgId = client_message_id || `client_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  }
  const pendingFbId = `pending_${clientMsgId}`;
  const trace = (stage, extra = {}) => console.log('[OUTBOUND_TRACE]', JSON.stringify({ stage, thread_id: String(thread_id), client_message_id: clientMsgId, route: isPageThread ? 'page_queue' : 'direct_extension', at: new Date().toISOString(), ...extra }));
  trace('BACKEND_SEND_REQUEST', queueId ? { queue_id: queueId } : {});

  const maxSeqRow = db.prepare('SELECT MAX(COALESCE(sequence_order, id)) AS max_seq FROM messages WHERE thread_id = ?').get(thread_id);
  const nextSeq = (Number.isFinite(Number(maxSeqRow?.max_seq)) && Number(maxSeqRow.max_seq) > 0) ? Number(maxSeqRow.max_seq) + 1 : 1;
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  // Lưu tin nhắn outgoing dạng pending vào CSDL với timestamp và sequence_order chuẩn xác
  const result = db.prepare(`
    INSERT INTO messages (thread_id, fb_message_id, client_message_id, sender_id, content, is_outgoing, delivery_status, sequence_order, timestamp_ms, timestamp_source, created_at)
    VALUES (?, ?, ?, 'SYSTEM', ?, 1, 'pending', ?, ?, 'client_submit', ?)
  `).run(thread_id, pendingFbId, clientMsgId, text, nextSeq, nowMs, nowIso);
  trace('BACKEND_PENDING_CREATED', { row_id: result.lastInsertRowid, sequence_order: nextSeq, timestamp_ms: nowMs });

  db.prepare(`
    UPDATE threads SET last_message = ?, last_activity = CURRENT_TIMESTAMP WHERE id = ?
  `).run(text, thread_id);

  if (isPageThread) {
    // QueueWorker (already running) picks this up and dispatches SEND_QUEUED_MESSAGE.
    trace('BACKEND_QUEUED_FOR_PAGE_SEND');
  } else {
    // Persist trước khi dispatch để DOM/network confirmation không chạy vào race
    // window và luôn tìm thấy bản ghi pending để ghép đúng client_message_id.
    extWs.send(JSON.stringify({
      type: 'SEND_MESSAGE',
      data: {
        account_id: thread.account_id,
        thread_id,
        thread_url: thread.thread_url || null,
        expected_contact_name: thread.contact_name || null,
        content: text,
        client_message_id: clientMsgId,
        ...(mentionList.length ? { mentions: mentionList } : {})
      }
    }));
    trace('BACKEND_DISPATCHED_EXTENSION');

    // Never leave the CRM bubble pending forever when an extension handler
    // stalls before returning SEND_MESSAGE_RESULT. Nhưng KHÔNG đánh failed để tránh hiện nút Thử lại.
    // Chỉ delete khi tin đã lưu ở chỗ khác (echo/history bắt được mid thật).
    setTimeout(() => {
      const pending = db.prepare(`
        SELECT id, fb_message_id, content, created_at FROM messages
        WHERE client_message_id = ? AND delivery_status = 'pending'
      `).get(clientMsgId);
      if (!pending) return;
      
      // Echo-merge đã ghép mid thật vào row (còn đứng ở pending) => tin đã lên Messenger
      if (pending.fb_message_id && !String(pending.fb_message_id).startsWith('pending_')) {
        console.log(`[WS] Sweeper thấy mid thật cho ${clientMsgId}, giữ pending.`);
        return;
      }
      
      // Tin đã được lưu bằng mid thật riêng (echo/history bắt được) -> row optimistic này là bản thừa
      const capturedElsewhere = db.prepare(`
        SELECT id FROM messages
        WHERE thread_id = ? AND is_outgoing = 1 AND id != ?
          AND COALESCE(content, '') = COALESCE(?, '')
          AND (fb_message_id LIKE 'mid.%' OR fb_message_id LIKE '%@msgr.%')
          AND datetime(created_at) >= datetime(?)
        LIMIT 1
      `).get(thread.id, pending.id, pending.content ?? text, pending.created_at || new Date().toISOString());
      
      if (capturedElsewhere) {
        deleteOutboundMessageRows({ messageId: pending.id });
        io.emit('MESSAGE_SENT', {
          thread_id: thread.id,
          client_message_id: clientMsgId,
          status: 'sent'
        });
        console.log(`[WS] Sweeper tìm thấy bản trùng cho ${clientMsgId}, xóa row optimistic.`);
        return;
      }
      
      // Chưa có bằng chứng 2 chiều: GIỮ pending, không delete, không emit failed
      console.log(`[WS] Sweeper giữ pending ${clientMsgId} (+30s), chờ echo/crawler.`);
    }, 30000);
  }

  io.emit('NEW_MESSAGE', {
    id: result.lastInsertRowid,
    thread_id,
    content: text,
    is_outgoing: true,
    status: 'pending',
    created_at: new Date().toISOString(),
    client_message_id: clientMsgId,
    // Feature 021: for Page threads, clientMsgId above is 'queue_' + queueId,
    // NOT the id the CRM's own optimistic local bubble was created with
    // (background.js/handleSendQueuedMessage independently re-derives that
    // same 'queue_' id later, so it can't be changed - see this feature's
    // spec). Carrying the original id lets the frontend reconcile its local
    // bubble to the server's id instead of rendering a second, orphaned one.
    original_client_message_id: client_message_id || clientMsgId
  });
}

/* ─────────────────── Page API (Messenger Platform chính thức) ─────────────────── */

// Xin cookie Facebook từ Chrome của account (extension có quyền chrome.cookies).
// Kết quả trả về qua message WS 'FB_COOKIES' — nhìn thấy ở case tương ứng trong
// wss.on('connection'). Dùng cho tự động hóa "Tạo app & Webhook" (Chrome riêng).
const pendingCookieRequests = new Map(); // request_id -> { resolve, reject, timer }

function saveAccountCookies(accountId, cookies) {
  try {
    const accId = String(accountId || '').trim();
    if (!/^[0-9]+$/.test(accId) || !Array.isArray(cookies) || !cookies.length) return false;
    const hasCUser = cookies.some((c) => c && c.name === 'c_user' && String(c.value || '').trim());
    const hasXs = cookies.some((c) => c && c.name === 'xs' && String(c.value || '').trim());
    if (!hasCUser || !hasXs) return false;
    const normalized = cookies.map((c) => ({
      name: c.name,
      value: String(c.value ?? ''),
      domain: c.domain || '.facebook.com',
      path: c.path || '/',
      expires: Number(c.expires || c.expirationDate || 0),
      secure: c.secure !== false,
      httpOnly: Boolean(c.httpOnly)
    }));
    db.prepare(`
      INSERT INTO page_api_config (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).run('fb_cookies:' + accId, JSON.stringify(normalized));
    return true;
  } catch (e) {
    console.warn('[PageApi] Không lưu được cookie cache:', e.message);
    return false;
  }
}

function loadSavedAccountCookies(accountId) {
  try {
    const accId = String(accountId || '').trim();
    const row = db.prepare('SELECT value FROM page_api_config WHERE key = ?').get('fb_cookies:' + accId);
    if (!row || !row.value) return null;
    const cookies = JSON.parse(row.value);
    if (!Array.isArray(cookies) || !cookies.length) return null;
    const hasCUser = cookies.some((c) => c && c.name === 'c_user' && String(c.value || '').trim());
    const hasXs = cookies.some((c) => c && c.name === 'xs' && String(c.value || '').trim());
    return (hasCUser && hasXs) ? cookies : null;
  } catch (_) {
    return null;
  }
}

async function getCookiesViaCdp(accountId) {
  try {
    const accId = String(accountId || '').trim();
    const browser = processManager.getAttachedBrowser(accId);
    if (!browser) return null;
    const pages = await browser.pages();
    const page = pages[0];
    if (!page) return null;
    const client = await page.createCDPSession();
    try {
      const { cookies } = await client.send('Network.getAllCookies');
      const fbCookies = (cookies || [])
        .filter((c) => c && c.domain && (c.domain.includes('facebook.com') || c.domain.includes('messenger.com')))
        .map((c) => ({
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path || '/',
          expires: c.expires || 0,
          secure: Boolean(c.secure),
          httpOnly: Boolean(c.httpOnly)
        }));
      if (fbCookies.some((c) => c.name === 'c_user') && fbCookies.some((c) => c.name === 'xs')) {
        saveAccountCookies(accId, fbCookies);
        return fbCookies;
      }
    } finally {
      try { await client.detach(); } catch (_) {}
    }
  } catch (_) {}
  return null;
}

function readCookiesFromProfileDisk(accountId) {
  try {
    if (process.platform !== 'win32') return null;
    const accId = String(accountId || '').trim();
    const acc = db.prepare('SELECT profile_dir FROM accounts WHERE id = ?').get(accId);
    const profileDir = processManager.resolveAccountProfileDir(acc?.profile_dir, accId);
    if (!profileDir) return null;
    const lsPath = path.join(profileDir, 'Local State');
    const cookiesPath = path.join(profileDir, 'Default', 'Network', 'Cookies');
    if (!fs.existsSync(lsPath) || !fs.existsSync(cookiesPath)) return null;

    const ls = JSON.parse(fs.readFileSync(lsPath, 'utf8'));
    const rawEncKey = ls?.os_crypt?.encrypted_key;
    if (!rawEncKey) return null;
    const encKeyB64 = Buffer.from(rawEncKey, 'base64').subarray(5).toString('base64');
    const { spawnSync } = require('child_process');
    const os = require('os');
    const Database = require('better-sqlite3');
    const ps = `Add-Type -AssemblyName System.Security; [Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String('${encKeyB64}'), $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser))`;
    const encoded = Buffer.from(ps, 'utf16le').toString('base64');
    const res = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], {
      windowsHide: true,
      encoding: 'utf8',
      timeout: 8000
    });
    const masterKey = Buffer.from(String(res.stdout || '').trim(), 'base64');
    if (masterKey.length !== 32) return null;

    const tmpDb = path.join(os.tmpdir(), `crm_fb_cookies_${accId}_${Date.now()}.db`);
    fs.copyFileSync(cookiesPath, tmpDb);
    try { fs.copyFileSync(cookiesPath + '-wal', tmpDb + '-wal'); } catch (_) {}
    let rows = [];
    try {
      const cookieDb = new Database(tmpDb);
      rows = cookieDb.prepare("SELECT host_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly FROM cookies WHERE host_key LIKE '%facebook.com%' OR host_key LIKE '%messenger.com%'").all();
      cookieDb.close();
    } finally {
      try { fs.unlinkSync(tmpDb); } catch (_) {}
      try { fs.unlinkSync(tmpDb + '-wal'); } catch (_) {}
      try { fs.unlinkSync(tmpDb + '-shm'); } catch (_) {}
    }

    const result = [];
    for (const r of rows) {
      let val = r.value || '';
      if (!val && r.encrypted_value && r.encrypted_value.length > 31) {
        const prefix = r.encrypted_value.subarray(0, 3).toString('ascii');
        if (prefix === 'v10' || prefix === 'v11') {
          try {
            const nonce = r.encrypted_value.subarray(3, 15);
            const tag = r.encrypted_value.subarray(r.encrypted_value.length - 16);
            const data = r.encrypted_value.subarray(15, r.encrypted_value.length - 16);
            const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, nonce);
            decipher.setAuthTag(tag);
            let plain = Buffer.concat([decipher.update(data), decipher.final()]);
            if (plain.length > 32) {
              const domainHash = crypto.createHash('sha256').update(r.host_key).digest();
              if (plain.subarray(0, 32).equals(domainHash)) {
                plain = plain.subarray(32);
              }
            }
            val = plain.toString('utf8');
          } catch (_) {}
        }
      }
      if (val) {
        result.push({
          name: r.name,
          value: val,
          domain: r.host_key,
          path: r.path || '/',
          expires: r.expires_utc ? Math.floor(Number(r.expires_utc) / 1000000 - 11644473600) : 0,
          secure: Boolean(r.is_secure),
          httpOnly: Boolean(r.is_httponly)
        });
      }
    }
    if (result.some((c) => c.name === 'c_user') && result.some((c) => c.name === 'xs')) {
      saveAccountCookies(accId, result);
      return result;
    }
  } catch (_) {}
  return null;
}

async function requestExtensionCookies(accountId, timeoutMs = 4000) {
  const accId = String(accountId);

  // 1) Đọc trực tiếp qua CDP nếu Chrome của account đang gắn với ProcessManager (nhanh <10ms, không qua WS)
  const cdpCookies = await getCookiesViaCdp(accId);
  if (cdpCookies && cdpCookies.length) {
    return cdpCookies;
  }

  // 2) Lấy ngay từ kho cookie đã lưu sẵn trong DB (fb_cookies:<accountId>) — không cần mở Chrome
  const savedCookies = loadSavedAccountCookies(accId);
  if (savedCookies && savedCookies.length) {
    return savedCookies;
  }

  // 3) Giải mã trực tiếp từ file Cookies trong profile_dir trên ổ cứng (khi Chrome của account đang tắt)
  const diskCookies = readCookiesFromProfileDisk(accId);
  if (diskCookies && diskCookies.length) {
    return diskCookies;
  }

  // 4) Nếu Chrome đang mở từ phiên trước (file Cookies bị khóa nhưng WS đang kết nối), hỏi nhanh qua WS (không bao giờ tự mở lại Chrome)
  const ws = extensionConnections.get(accId);
  if (ws && ws.readyState === WebSocket.OPEN) {
    try {
      const wsCookies = await new Promise((resolve, reject) => {
        const requestId = crypto.randomUUID();
        const timer = setTimeout(() => {
          pendingCookieRequests.delete(requestId);
          reject(new Error('__TIMEOUT__'));
        }, timeoutMs);
        pendingCookieRequests.set(requestId, { resolve, reject, timer });
        ws.send(JSON.stringify({ type: 'GET_FB_COOKIES', data: { request_id: requestId } }));
      });
      if (Array.isArray(wsCookies) && wsCookies.length) {
        saveAccountCookies(accId, wsCookies);
        return wsCookies;
      }
    } catch (_) {}
  }

  throw new Error('Chưa có dữ liệu cookie của tài khoản này. Vui lòng kết nối tài khoản Facebook một lần để hệ thống lưu cookie.');
}

// Bơm phụ thuộc cho tự động hóa tạo app: cookie từ extension, trạng thái ra
// socket.io, dữ liệu page/app lưu qua PageApiService (KV page_api_config + inbox_sources)
setupAutomation.configurePageSetupAutomation({
  getCookies: (accountId) => requestExtensionCookies(accountId),
  getOrCreateVerifyToken: () => pageApiService.getOrCreateVerifyToken(),
  recordRun: (status, note) => {
    try { appendRotating(path.join(APP_DATA_ROOT, 'page-api-runs.log'), JSON.stringify({ at: new Date().toISOString(), status, note: String(note || '').slice(0, 300) }) + '\n', 10 * 1024 * 1024); } catch (_) {}
  },
  upsertPages: (accountId, pages) => pageApiService.upsertPages(accountId, pages),
  reclaimPages: (accountId, pageIds) => pageApiService.reclaimPages(accountId, pageIds),
  listPages: (accountId) => pageApiService.listPages(accountId),
  savePages: (accountId, pages) => pageApiService.savePages(accountId, pages),
  appAdd: (accountId, rec) => pageApiService.appAdd(accountId, rec),
  appUpdate: (accountId, appId, patch) => pageApiService.appUpdate(accountId, appId, patch),
  appGetLatest: (accountId) => pageApiService.appGetLatest(accountId),
  appRemove: (accountId, appId) => pageApiService.appRemove(accountId, appId),
  appList: (accountId) => pageApiService.appList(accountId),
  appMergeScanned: (accountId, apps) => pageApiService.appMergeScanned(accountId, apps),
  clearPageTokens: (accountId) => pageApiService.clearPageTokens(accountId),
  removeAccountPages: (accountId) => pageApiService.removeAccountPages(accountId),
  knownPageIds: () => pageApiService.knownPageIds(),
  log: (message) => {
    console.log('[PageSetup]', message);
    try { appendRotating(path.join(APP_DATA_ROOT, 'page-api-runs.log'), JSON.stringify({ at: new Date().toISOString(), status: 'step', note: String(message || '').slice(0, 300) }) + '\n', 10 * 1024 * 1024); } catch (_) {}
  },
  onStatus: (job) => {
    if (!io) return;
    io.emit('PAGE_API_SETUP_STATUS', {
      sync_id: job.id,
      kind: job.kind || 'create',
      account_id: job.uid,
      app_id: job.appId || null,
      status: job.status,
      message: job.message || '',
      error: job.error || null,
    });
  },
  dataDir: APP_DATA_ROOT,
});

// Gửi tin nhắn cho thread PAGE bằng Send API (page token), thay cho đường CDP
// Business Suite cũ. Giữ đúng chu kỳ pending → sent/failed như tin cá nhân.
// Gửi tin nhắn PAGE kèm file: upload tệp lên Meta (message_attachments) bằng
// page token rồi gửi bằng attachment_id — đường chính thức cho tệp trên máy.
async function sendPageThreadViaGraphAttachment(thread_id, text, client_message_id, attachment_id, socket) {
  const threadRow = db.prepare(`
    SELECT t.id, t.account_id, s.id AS source_id, s.external_id AS page_id, s.source_type
    FROM threads t LEFT JOIN inbox_sources s ON s.id = t.source_id
    WHERE t.id = ?
  `).get(thread_id);
  if (!threadRow || threadRow.source_type !== 'page_messenger' || !threadRow.source_id) {
    throw new Error('Thread Page không hợp lệ hoặc thiếu Page source.');
  }
  const att = db.prepare('SELECT * FROM outbound_attachments WHERE id = ?').get(attachment_id);
  if (!att || !att.storage_path || !fs.existsSync(att.storage_path)) {
    throw new Error('Tệp đính kèm không còn trên máy — hãy đính lại file.');
  }
  const psid = String(thread_id).includes(':') ? String(thread_id).split(':').pop() : String(thread_id);
  const maxSeqRow = db.prepare('SELECT MAX(COALESCE(sequence_order, id)) AS max_seq FROM messages WHERE thread_id = ?').get(thread_id);
  const nextSeq = (Number.isFinite(Number(maxSeqRow?.max_seq)) && Number(maxSeqRow.max_seq) > 0) ? Number(maxSeqRow.max_seq) + 1 : 1;
  const clientMsgId = client_message_id || `client_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const nowMs = Date.now();
  const pendingFbId = `pending_${clientMsgId}`;
  const insert = db.prepare(`
    INSERT INTO messages (thread_id, fb_message_id, client_message_id, sender_id, content, media_type, attachment_id, is_outgoing, sender_role, delivery_status, sequence_order, timestamp_ms, timestamp_source, created_at)
    VALUES (?, ?, ?, 'SYSTEM', ?, ?, ?, 1, 'operator', 'pending', ?, ?, 'client_submit', ?)
  `).run(thread_id, pendingFbId, clientMsgId, (text || null), att.media_type, att.id, nextSeq, nowMs, new Date(nowMs).toISOString());
  const rowId = insert.lastInsertRowid;
  db.prepare('UPDATE threads SET last_message = ?, last_activity = CURRENT_TIMESTAMP WHERE id = ?').run(text || ('[' + att.media_type + ']'), thread_id);
  const pendingRow = db.prepare('SELECT * FROM messages WHERE id = ?').get(rowId);
  io.emit('NEW_MESSAGE', withAttachmentAccessUrl({ ...pendingRow, status: 'pending' }));

  const failPageSend = async (err) => {
    db.prepare("UPDATE messages SET delivery_status = 'failed', delivery_error = ? WHERE id = ?").run(String(err.message || err), rowId);
    const failedRow = db.prepare('SELECT * FROM messages WHERE id = ?').get(rowId);
    io.emit('NEW_MESSAGE', withAttachmentAccessUrl({ ...failedRow, thread_id, account_id: threadRow.account_id }));
    throw err;
  };

  try {
    const token = InboxSourceService.getDecryptedToken(threadRow.source_id);
    if (!token) throw new Error('Page chưa có Page Access Token — hãy bấm "Lấy token" trong modal Fanpage.');
    // 1) Upload tệp lên Meta
    const form = new FormData();
    form.append('message', JSON.stringify({ attachment: { type: att.media_type, payload: {} } }));
    form.append('filedata', new Blob([fs.readFileSync(att.storage_path)], { type: att.mime_type }), att.original_name || att.safe_name);
    const upRes = await fetch(`https://graph.facebook.com/v21.0/${threadRow.page_id}/message_attachments?access_token=${encodeURIComponent(token)}`, { method: 'POST', body: form });
    const upData = await upRes.json().catch(() => ({}));
    if (upData.error) throw new Error('Upload tệp lên Facebook lỗi: ' + (upData.error.message || 'không rõ'));
    if (!upData.attachment_id) throw new Error('Facebook không trả attachment_id sau khi upload.');
    // 2) Gửi tin với attachment_id
    const sendRes = await fetch(`https://graph.facebook.com/v21.0/${threadRow.page_id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: psid },
        message: { attachment: { type: att.media_type, payload: { attachment_id: upData.attachment_id } } },
        access_token: token,
      }),
    });
    const data = await sendRes.json().catch(() => ({}));
    if (data.error) {
      const err = new Error(data.error.error_data?.message || data.error.message || 'Gửi tệp thất bại.');
      err.code = data.error.code ? `GRAPH_${data.error.code}` : 'GRAPH_ERROR';
      throw err;
    }
    db.prepare(`
      UPDATE messages SET fb_message_id = ?, delivery_status = 'sent', delivery_error = NULL WHERE id = ?
    `).run(data.message_id || pendingFbId, rowId);
    try {
      db.prepare("UPDATE outbound_attachments SET status = 'sent', consumed_by_message_id = ? WHERE id = ?").run(rowId, attachment_id);
    } catch (_) {}
    const sentRow = db.prepare('SELECT * FROM messages WHERE id = ?').get(rowId);
    console.log(`[PageApi] ✅ Đã gửi ${att.media_type} qua Page thread=${thread_id} mid=${data.message_id || 'n/a'}`);
    io.emit('NEW_MESSAGE', withAttachmentAccessUrl({ ...sentRow, thread_id, account_id: threadRow.account_id }));
    io.emit('THREAD_LIST_UPDATED', { thread_id, account_id: threadRow.account_id });
  } catch (err) {
    await failPageSend(err);
  }
}


async function sendPageThreadViaGraph(thread_id, text, client_message_id, socket) {
  const threadRow = db.prepare(`
    SELECT t.id, t.account_id, t.contact_name, t.thread_url, s.id AS source_id, s.external_id AS page_id, s.source_type, s.owner_account_id
    FROM threads t LEFT JOIN inbox_sources s ON s.id = t.source_id
    WHERE t.id = ?
  `).get(thread_id);
  if (!threadRow || threadRow.source_type !== 'page_messenger' || !threadRow.source_id) {
    throw new Error('Thread Page không hợp lệ hoặc thiếu Page source.');
  }
  const psid = String(thread_id).includes(':') ? String(thread_id).split(':').pop() : String(thread_id);

  const maxSeqRow = db.prepare('SELECT MAX(COALESCE(sequence_order, id)) AS max_seq FROM messages WHERE thread_id = ?').get(thread_id);
  const nextSeq = (Number.isFinite(Number(maxSeqRow?.max_seq)) && Number(maxSeqRow.max_seq) > 0) ? Number(maxSeqRow.max_seq) + 1 : 1;
  const clientMsgId = client_message_id || `client_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const nowMs = Date.now();
  const pendingFbId = `pending_${clientMsgId}`;
  const insert = db.prepare(`
    INSERT INTO messages (thread_id, fb_message_id, client_message_id, sender_id, content, is_outgoing, sender_role, delivery_status, sequence_order, timestamp_ms, timestamp_source, created_at)
    VALUES (?, ?, ?, 'SYSTEM', ?, 1, 'operator', 'pending', ?, ?, 'client_submit', ?)
  `).run(thread_id, pendingFbId, clientMsgId, text, nextSeq, nowMs, new Date(nowMs).toISOString());
  const rowId = insert.lastInsertRowid;
  db.prepare('UPDATE threads SET last_message = ?, last_activity = CURRENT_TIMESTAMP WHERE id = ?').run(text, thread_id);

  const pendingRow = db.prepare('SELECT * FROM messages WHERE id = ?').get(rowId);
  io.emit('NEW_MESSAGE', { ...pendingRow, status: 'pending' });

  // Fallback DOM khi khách quá 24h: gửi qua Chrome admin thay vì Graph API.
  const fallbackToDom = async (reason) => {
    console.log(`[PageApi] 🔄 Quyết định chuyển luồng DOM — reason=${reason} rowId=${rowId} page=${threadRow.page_id} psid=${psid} owner_account_id=${threadRow.owner_account_id || 'none'} contact=${threadRow.contact_name || 'none'}`);
    if (!threadRow.owner_account_id) {
      db.prepare("UPDATE messages SET delivery_status = 'failed', delivery_error = ? WHERE id = ?")
        .run('Page chưa gắn nick quản lý (owner_account_id).', rowId);
      const failedRow = db.prepare('SELECT * FROM messages WHERE id = ?').get(rowId);
      io.emit('NEW_MESSAGE', { ...failedRow, thread_id, account_id: threadRow.account_id });
      const err = new Error('Page chưa gắn nick quản lý.');
      err.code = 'PAGE_OWNER_UNKNOWN';
      throw err;
    }
    const adminWs = extensionConnections.get(threadRow.owner_account_id);
    if (!adminWs || adminWs.readyState !== 1) {
      db.prepare("UPDATE messages SET delivery_status = 'failed', delivery_error = ?, delivery_channel = 'dom' WHERE id = ?")
        .run('Chrome của nick quản lý Page chưa bật. Hãy mở Chrome, đăng nhập app rồi bấm "Thử lại".', rowId);
      const failedRow = db.prepare('SELECT * FROM messages WHERE id = ?').get(rowId);
      io.emit('NEW_MESSAGE', { ...failedRow, thread_id, account_id: threadRow.account_id });
      const err = new Error('Chrome của nick quản lý Page chưa bật.');
      err.code = 'FAILED_ADMIN_OFFLINE';
      throw err;
    }

    // Giữ nguyên client_message_id gốc: UI tạo bubble bằng id này, đổi tên sẽ
    // khiến mọi event kết quả (delivered/rejected) không khớp bubble -> kẹt
    // "Đang gửi" mãi. Kết quả khớp bản ghi qua queue_id (= rowId) thay vì đổi tên.
    db.prepare(`
      UPDATE messages SET delivery_channel = 'dom' WHERE id = ?
    `).run(rowId);

    const extractUid = (url) => {
      if (!url) return null;
      const m1 = String(url).match(/[?&]id=(\d+)/);
      if (m1) return m1[1];
      const m2 = String(url).match(/facebook\.com\/(?:profile\.php\?id=)?(\d+)/);
      if (m2 && !['1000', 'pages'].includes(m2[1])) return m2[1];
      return null;
    };
    let resolvedCustomerUid = null;
    try {
      const contactRow = db.prepare('SELECT profile_url FROM contacts WHERE thread_id = ?').get(thread_id);
      resolvedCustomerUid = extractUid(contactRow?.profile_url);
      if (!resolvedCustomerUid && threadRow.contact_name) {
        const matchByName = db.prepare('SELECT profile_url FROM contacts WHERE name = ? AND profile_url IS NOT NULL LIMIT 1').get(threadRow.contact_name);
        resolvedCustomerUid = extractUid(matchByName?.profile_url);
      }
    } catch (_) {}

    const envelope = {
      type: 'SEND_QUEUED_MESSAGE',
      data: {
        contract_version: 1,
        queue_id: rowId,
        thread_id: thread_id,
        recipient_thread_id: psid,
        thread_url: threadRow.thread_url || null,
        expected_contact_name: threadRow.contact_name || null,
        customer_uid: resolvedCustomerUid || null,
        account_id: threadRow.owner_account_id,
        content: text,
        source_type: 'page_messenger',
        page_id: threadRow.page_id,
        source_id: threadRow.source_id,
        dispatch_mode: 'business_suite_single_tab'
      }
    };
    try {
      adminWs.send(JSON.stringify(envelope));
    } catch (sendErr) {
      db.prepare("UPDATE messages SET delivery_status = 'failed', delivery_error = ? WHERE id = ?")
        .run('Không gửi được lệnh cho Chrome admin.', rowId);
      const failedRow = db.prepare('SELECT * FROM messages WHERE id = ?').get(rowId);
      io.emit('NEW_MESSAGE', { ...failedRow, thread_id, account_id: threadRow.account_id });
      const err = new Error('Không gửi được lệnh cho Chrome admin.');
      err.code = 'DOM_DISPATCH_FAILED';
      throw err;
    }
    console.log(`[PageApi] 🔄 Chuyển luồng DOM: rowId=${rowId} page=${threadRow.page_id} psid=${psid} admin=${threadRow.owner_account_id}`);
    return { success: true, dispatchedViaDom: true };
  };

  // Kiểm tra cửa sổ 24h — nếu ngoài 24h, đi thẳng DOM thay vì gọi API rồi mới lỗi.
  const window = pageApiService.classifyReplyWindow(thread_id);
  if (window.status === 'outside') {
    return await fallbackToDom('REPLY_WINDOW_OUTSIDE_24H');
  }

  const result = await pageApiService.sendPageMessage(threadRow.source_id, psid, text);
  if (result.success) {
    db.prepare(`
      UPDATE messages SET fb_message_id = ?, delivery_status = 'sent', delivery_error = NULL WHERE id = ?
    `).run(result.messageId || pendingFbId, rowId);
    const sentRow = db.prepare('SELECT * FROM messages WHERE id = ?').get(rowId);
    console.log(`[PageApi] ✅ Đã gửi tin Page thread=${thread_id} page=${threadRow.page_id} mid=${result.messageId || 'n/a'}`);
    io.emit('NEW_MESSAGE', { ...sentRow, thread_id, account_id: threadRow.account_id });
    io.emit('THREAD_LIST_UPDATED', { thread_id, account_id: threadRow.account_id });
    return { success: true };
  }

  // Meta xác nhận ngoài cửa sổ 24h (2018001) → chuyển luồng DOM.
  if (result.fallbackToDom) {
    return await fallbackToDom('GRAPH_2018001_OUTSIDE_WINDOW');
  }

  db.prepare(`
    UPDATE messages SET delivery_status = 'failed', delivery_error = ? WHERE id = ?
  `).run(String(result.error || 'SEND_FAILED'), rowId);
  const failedRow = db.prepare('SELECT * FROM messages WHERE id = ?').get(rowId);
  io.emit('NEW_MESSAGE', { ...failedRow, thread_id, account_id: threadRow.account_id });
  const err = new Error(result.error || 'Gửi tin nhắn Page thất bại.');
  err.code = result.errorCode || 'SEND_FAILED';
  throw err;
}

/* ─────────────────────────────────────────────────────────────────────────────── */


function enqueueCampaignMessage({ campaign, recipient, attempt, content, attachment = null, manifest = null }) {
  const route = CampaignEligibilityService.revalidateSnapshotRecipient(recipient, db, {
    getConnection: (accId) => extensionConnections.get(accId),
    hasAttachment: Boolean(attachment) || Boolean(manifest),
    // A manifest (several files, or one folder ZIP) is always gated as a
    // file transport, regardless of any individual member's own media_type -
    // sending more than one attachment, or an archive, is a file-transport
    // operation even if one of the files happens to be an image.
    attachmentMediaType: manifest ? 'file' : (attachment?.media_type || null)
  });
  const effectiveSourceType = route.source_type;
  const effectiveSourceId = route.source_id;
  const pageId = effectiveSourceType === "page_messenger" ? route.source_external_id : null;

  const config = CampaignService.getConfig();
  if (config.testMode && effectiveSourceId && !config.testSourceIds.includes(String(effectiveSourceId))) {
    const error = new Error('Source không nằm trong CAMPAIGN_TEST_SOURCE_IDS');
    error.code = 'SOURCE_UNAVAILABLE';
    throw error;
  }
  if (CampaignRepository.countAccountSentToday(recipient.account_id, db, { excludeAttemptId: attempt?.id }) >= config.accountDailyCap) {
    const error = new Error("Tài khoản đã đạt giới hạn gửi trong ngày");
    error.code = "SEND_LIMIT_REACHED";
    throw error;
  }

  const { queueId, clientMessageId, messageId } = MessageQueueRepository.insertCampaignDispatch({
    thread_id: recipient.thread_id,
    account_id: recipient.account_id,
    source_id: effectiveSourceId,
    source_type: effectiveSourceType,
    page_id: pageId,
    content,
    attachment_id: attachment?.id || null,
    attachment_path: attachment?.storage_path || null,
    attachment_mime_type: attachment?.mime_type || null,
    attachment_name: attachment?.original_name || null,
    attachment_media_type: attachment?.media_type || null,
    attachment_byte_size: attachment?.byte_size || null,
    attachment_checksum: attachment?.checksum || null,
    manifest_id: manifest?.id || null,
    campaign_id: campaign.id,
    campaign_recipient_id: recipient.id,
    campaign_attempt_id: attempt.id,
    idempotency_key: attempt.idempotency_key
  }, db);
  io.emit("NEW_MESSAGE", {
    id: messageId,
    thread_id: recipient.thread_id,
    content,
    is_outgoing: true,
    status: "pending",
    created_at: new Date().toISOString(),
    client_message_id: clientMessageId,
    original_client_message_id: clientMessageId,
    campaign_id: campaign.id,
    campaign_recipient_id: recipient.id
  });
  return { queueId, clientMessageId };
}

function updateQueueStatusFromClientMessage(clientMessageId, status, errorReason = null) {
  if (typeof clientMessageId !== 'string' || !clientMessageId.startsWith('queue_')) return false;
  const queueId = clientMessageId.slice('queue_'.length);
  if (!queueId) return false;
  const updated = MessageQueueRepository.updateStatus(queueId, status, errorReason);
  if (updated && status === 'sent') {
    try { CommentLeadsService.markQueueSent(queueId); } catch (_) { /* lead tracking best-effort */ }
  }
  // Lead phải đi theo cả hướng failure: không thì gửi lỗi để lead 'queued' vĩnh viễn
  // (reproduce 2026-10-13: THREAD_ROUTE_MISMATCH chặn gửi, lead 24 kẹt 'queued').
  if (updated && status === 'failed') {
    try { CommentLeadsService.markQueueFailed(queueId, errorReason); } catch (_) { /* lead tracking best-effort */ }
  }
  return updated;
}

function ensureThreadRecord({ threadId, accountId, contactName, pageId, initialLastMessage = 'Chưa có tin nhắn' }, database = db) {
  if (!threadId) return null;
  const tid = String(threadId);
  let existing = database.prepare('SELECT id, contact_name, source_id, account_id FROM threads WHERE id = ?').get(tid);
  if (!existing) {
    const cleanName = (contactName && !isInvalidContactName(contactName)) ? cleanContactName(contactName) : 'Khách hàng';
    ConversationRepository.upsertThread({
      id: tid,
      account_id: accountId,
      contact_name: cleanName,
      last_message: initialLastMessage,
      is_unread: 0,
      inbox_folder: 'INBOX'
    }, database);
    existing = database.prepare('SELECT id, contact_name, source_id, account_id FROM threads WHERE id = ?').get(tid);
    console.log(`[ensureThreadRecord] ✅ Tự động tạo bản ghi thread: ${tid} (account=${accountId}, name="${cleanName}")`);

    if (io) {
      io.emit('THREAD_CREATED', {
        thread_id: tid,
        account_id: accountId,
        source_id: pageId ? ('src_page_' + pageId) : null,
        contact_name: cleanName
      });
    }
  }
  if (pageId) {
    try {
      InboxSourceService.ensurePageSource({
        pageId: String(pageId),
        accountId: accountId || existing?.account_id,
        threadId: tid
      }, database);
    } catch (e) {
      console.warn('[ensureThreadRecord] ensurePageSource error:', e.message);
    }
  }
  return existing;
}

// ────────────────────────────────────────────────
// Extension WebSocket Handler
// ────────────────────────────────────────────────
const disconnectGraceTimers = new Map();
const reloadedExtensionsInThisServerRun = new Set();

wss.on('connection', (ws, req) => {
  console.log('[WS] Extension connected from:', req.socket.remoteAddress);
  ws.lastHeartbeatAt = Date.now();

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      console.log('[WS] 📨 Nhận message:', msg.type, '| WS ID:', req.socket.remoteAddress);

      switch (msg.type) {
        case 'HEARTBEAT':
          // WebSocket traffic keeps the Manifest V3 worker alive. Do not log
          // or trigger sync work for this lightweight liveness frame.
          ws.lastHeartbeatAt = Date.now();
          break;

        case 'FB_COOKIES': {
          const cookieReqId = String(msg.data?.request_id || '');
          const cookies = Array.isArray(msg.data?.cookies) ? msg.data.cookies : [];
          const cUser = cookies.find((c) => c && c.name === 'c_user')?.value || ws.accountId;
          if (cUser && cookies.length) {
            saveAccountCookies(cUser, cookies);
          }
          const waiter = pendingCookieRequests.get(cookieReqId);
          if (waiter) {
            clearTimeout(waiter.timer);
            pendingCookieRequests.delete(cookieReqId);
            console.log(`[WS] 🍪 FB_COOKIES: nhận ${cookies.length} cookie cho yêu cầu ${cookieReqId.slice(0, 8)}…`);
            waiter.resolve(cookies);
          }
          break;
        }

        case 'COMMAND_PROBE_ACK': {
          // Phase C (2026-10-01): extension tra loi probe cua watchdog kenh
          // dispatch - kenh song 2 chieu, huy bo viec dong socket.
          const ackProbeId = String(msg.data?.probe_id || '');
          const ackProbe = pendingDispatchProbes.get(ackProbeId);
          if (ackProbe) {
            clearTimeout(ackProbe.timer);
            pendingDispatchProbes.delete(ackProbeId);
            dispatchStallWatchdog.noteProbeAck(ackProbe.account_id);
            console.log(`[WS] COMMAND_PROBE_ACK account=${ackProbe.account_id} probe=${ackProbeId} - dispatch channel alive`);
          }
          break;
        }

        case 'REGISTER_ACCOUNT': {
          const { account_id, name, pending_key, avatar_url } = msg.data;
          // Facebook sets c_user=0 as a placeholder while a page is mid-login;
          // extension-side already guards this (content.js sanitizeUserId), but
          // reject it here too so a stale/unpatched extension can never create
          // a bogus "FB Account (0)" row.
          if (!account_id || String(account_id).trim() === '0') {
            console.warn(`[WS] Bỏ qua REGISTER_ACCOUNT với account_id không hợp lệ: ${JSON.stringify(account_id)}`);
            break;
          }
          let ownerUserId = pending_key ? pendingAccountOwners.get(String(pending_key)) : null;
          if (pending_key && !ownerUserId) ownerUserId = markerOwnerUserId(pending_key);
          // Set when a removed account is re-added during an active add-account
          // session: the Chrome hosting this extension actually lives in that
          // pending profile, so registration must adopt it (see profileDir
          // resolution and post-insert cleanup below).
          let readdPendingKey = null;
          const removedAccount = db.prepare(
            'SELECT account_id FROM removed_accounts WHERE account_id = ?'
          ).get(String(account_id));
          if (removedAccount && !pending_key) {
            const activePendingKey = [...processManager.processes.entries()]
              .find(([key, proc]) => key.startsWith('pending_') && proc?.status === 'RUNNING')?.[0];
            if (activePendingKey) {
              // The operator deleted this account and is adding it back right
              // now. The fresh setup Chrome registers as soon as it sees the
              // login cookie - its storage may not carry the pending-key
              // capture (redirect timing), so this REGISTER arrives without
              // one. Rejecting here closed the socket and looped forever
              // while the UI waited on "Đang chờ đăng nhập Facebook..."
              // (reproduced 2026-09-17). Adopt the session instead: re-add
              // with the session owner and its pending profile dir.
              db.prepare('DELETE FROM removed_accounts WHERE account_id = ?').run(String(account_id));
              ownerUserId = pendingAccountOwners.get(activePendingKey) || markerOwnerUserId(activePendingKey) || ownerUserId;
              readdPendingKey = activePendingKey;
              console.log(`[WS] REGISTER_ACCOUNT: nhận lại tài khoản đã xóa ${account_id} trong phiên thêm mới ${activePendingKey}`);
            } else {
              console.warn(`[WS] Từ chối stale REGISTER_ACCOUNT của tài khoản đã xóa: ${account_id}`);
              ws.close(1000, 'ACCOUNT_REMOVED');
              break;
            }
          }
          if (pending_key) {
            db.prepare('DELETE FROM removed_accounts WHERE account_id = ?').run(String(account_id));
          }
          ws.lastRegisterAt = Date.now();
          const previousExtension = extensionConnections.get(account_id);
          // 2026-10-01 (Phase A - ke hoach ws-socket-adoption): LUON nhan socket
          // moi nhat. Truoc day socket moi bi tu choi khi socket cu van "OPEN"
          // phia server - nhung socket cu co the la zombie half-open sau khi
          // Chrome bi kill trong force-reload: close event khong bao gio den thi
          // readyState van OPEN mai -> server giu socket ma, ban
          // SYNC_THREAD_MESSAGES vao cho khong (reproduce 2026-10-01: 252
          // DISPATCHED / 0 THREAD_MESSAGES_SYNCED / SW console khong thay mot
          // log xu ly sync nao trong khi chieu nguoc van chay binh thuong).
          // Extension ngay nay chi co DUNG MOT WebSocket cho ca ca nhan + page
          // (page danh dau qua PAGE_CONTEXT_READY tren cung socket) nen khong
          // con kich ban nao can giu socket cu. Close cua socket cu den tre
          // cung khong xoa nham socket moi - close-handler co guard
          // `extensionConnections.get(ws.accountId) !== ws` (return som).
          if (previousExtension && previousExtension !== ws) {
            if (previousExtension.readyState === WebSocket.OPEN) {
              console.log(`[WS] REGISTER account=${account_id} socket replaced (previous still OPEN - zombie/superseded)`);
            } else {
              console.log(`[WS] REGISTER account=${account_id} socket replaced (previous was ${previousExtension.readyState})`);
            }
            try { previousExtension.close(1000, 'SUPERSEDED_CONNECTION'); } catch (_) {}
          }
          extensionConnections.set(account_id, ws);
          const existingDisconnectTimer = disconnectGraceTimers.get(String(account_id));
          if (existingDisconnectTimer) {
            clearTimeout(existingDisconnectTimer);
            disconnectGraceTimers.delete(String(account_id));
          }
          const isSameConnection = previousExtension === ws;
          ws.lastHeartbeatAt = Date.now();
          // Phase C (2026-10-01): socket moi = kenh tin cay moi, reset watchdog.
          dispatchStallWatchdog.noteRegistered(String(account_id));
          // A pending account is still inside Facebook's interactive login /
          // encrypted-history PIN setup. Do not start background sidebar
          // polling until the operator finishes setup and reconnects it as an
          // existing account (REGISTER_ACCOUNT without pending_key).
          if (!isSameConnection || !InboxSyncScheduler.accounts.has(String(account_id))) {
            InboxSyncScheduler.registerAccount(account_id);
          }
          if (pending_key) {
            newAccountBootstrapSyncs.set(String(account_id), { awaitingSetup: true, attempt: 0, timer: null });
          }
          // Only arm the replay-suppression window on a genuinely NEW socket.
          // Content scripts re-extract tokens (with rotating avatar CDN query
          // params) and re-register every few seconds on the SAME connection;
          // resetting the window each time kept the suppress gate permanently
          // active, silently eating outgoing confirmation echoes (measured
          // 2026-09-30: REGISTER_ACCOUNT every ~3s, 3000+ in one session).
          if (!isSameConnection) domReplaySuppressUntil.set(account_id, Date.now() + 8000);
          ws.accountId = account_id;

          // profileDir: use pending_key path (new account setup), or keep existing from DB,
          // or fallback to data/profiles/{account_id}.
          let profileDir = null;
          if (pending_key) {
            // New account just logged in via pending Chrome session
            profileDir = path.join(APP_DATA_ROOT, 'profiles', pending_key);
            if (processManager.processes.has(pending_key)) {
              const procData = processManager.processes.get(pending_key);
              processManager.promotePendingProcess(pending_key, account_id);
              profileDir = procData.profileDir || profileDir;
            }
          } else if (readdPendingKey) {
            // Re-add during an active session: same pending-Chrome adoption,
            // without the pending-key capture in the extension's storage.
            profileDir = path.join(APP_DATA_ROOT, 'profiles', readdPendingKey);
            if (processManager.processes.has(readdPendingKey)) {
              const procData = processManager.processes.get(readdPendingKey);
              processManager.promotePendingProcess(readdPendingKey, account_id);
              profileDir = procData.profileDir || profileDir;
            }
          } else {
            // Reconnect of an existing account - preserve whatever profile_dir is already in DB.
            // Only fall back to the default path if account is truly new (not in DB yet).
            const existingAcc = db.prepare('SELECT profile_dir FROM accounts WHERE id = ?').get(account_id);
            profileDir = existingAcc?.profile_dir || `data/profiles/${account_id}`;
          }

          const existingAccRow = db.prepare('SELECT name, avatar_url FROM accounts WHERE id = ?').get(account_id);
          const existingHasRealName = Boolean(
            existingAccRow?.name
            && !/^FB Account \(/i.test(existingAccRow.name)
            && existingAccRow.name !== 'Kjgvkj'
          );
          const isKnownPageOrContactName = Boolean(
            name && (
              db.prepare("SELECT 1 FROM inbox_sources WHERE source_type = 'page_messenger' AND LOWER(display_name) = LOWER(?) LIMIT 1").get(String(name).trim())
              || db.prepare("SELECT 1 FROM threads WHERE account_id = ? AND external_thread_id != ? AND LOWER(contact_name) = LOWER(?) LIMIT 1").get(String(account_id), String(account_id), String(name).trim())
            )
          );
          const allowProfileOverwrite = !existingHasRealName || (msg.data?.is_operator_profile === true && !isKnownPageOrContactName);
          const safeIncomingName = (!isKnownPageOrContactName && allowProfileOverwrite && name) ? String(name).trim() : null;
          const accName = safeIncomingName || (existingHasRealName ? existingAccRow.name : `FB Account (${account_id})`);
          let accountAvatarFilename = existingAccRow?.avatar_url || null;
          if (allowProfileOverwrite && !isKnownPageOrContactName && typeof avatar_url === 'string' && avatar_url.startsWith('http')) {
            const cachedAccountAvatar = await saveAvatarFromBase64OrUrl(avatar_url, `account_${account_id}`);
            if (cachedAccountAvatar) accountAvatarFilename = `/api/avatars/${cachedAccountAvatar}`;
          }

          db.prepare(`
            INSERT INTO accounts (id, name, profile_dir, status, owner_user_id, company_id, avatar_url)
            VALUES (?, ?, ?, 'ACTIVE', ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              name = COALESCE(excluded.name, accounts.name),
              profile_dir = CASE
                WHEN excluded.profile_dir LIKE '%/pending_%' THEN excluded.profile_dir
                ELSE COALESCE(accounts.profile_dir, excluded.profile_dir)
              END,
              status = 'ACTIVE',
              owner_user_id = COALESCE(excluded.owner_user_id, accounts.owner_user_id),
              company_id = COALESCE(excluded.company_id, accounts.company_id),
              avatar_url = COALESCE(excluded.avatar_url, accounts.avatar_url),
              last_broadcast_date = DATE('now')
          `).run(account_id, accName, profileDir, ownerUserId || null,
            ownerUserId ? db.prepare('SELECT company_id FROM users WHERE id=?').get(ownerUserId)?.company_id || ownerUserId : null,
            accountAvatarFilename);
          // Hội thoại page bị rời account (account cũ là chủ duy nhất đã xóa) —
          // gắn lại ngay khi account đăng nhập lại nếu page đã có chủ là account này.
          try {
            const reattached = db.prepare(`
              UPDATE threads SET account_id = ?
              WHERE account_id IS NULL AND source_id IN (
                SELECT id FROM inbox_sources WHERE owner_account_id = ?
              )
            `).run(account_id, account_id).changes;
            if (reattached > 0) {
              console.log(`[WS] 🔗 Gắn lại ${reattached} hội thoại page về account ${account_id}`);
            }
          } catch (reattachErr) {
            console.warn('[WS] Lỗi khi gắn lại hội thoại page:', reattachErr.message);
          }
          if (pending_key || readdPendingKey) {
            const setupKey = String(pending_key || readdPendingKey);
            completedPendingSetups.set(setupKey, { account_id: String(account_id), completed_at: Date.now() });
            pendingAccountOwners.delete(setupKey);
            try {
              fs.unlinkSync(path.join(APP_DATA_ROOT, 'profiles', setupKey, '.crm-pending-owner.json'));
            } catch (_) {}
          }

          console.log(`[WS] REGISTER_ACCOUNT thành công: account_id=${account_id}, profile_dir=${profileDir}`);
          try {
            InboxSourceService.createPersonalSource(account_id, accName, db);
          } catch (_) {}
          // Nguon personal hien ten + avatar that cua tai khoan (thay "FB Account (<id>)").
          try {
            db.prepare("UPDATE inbox_sources SET display_name = COALESCE(NULLIF(?, ''), display_name), avatar_url = COALESCE(?, avatar_url) WHERE id = ?")
              .run(accName, accountAvatarFilename, 'src_personal_' + account_id);
          } catch (_) {}
          io.emit('ACCOUNT_STATUS_CHANGED', { account_id, status: 'ACTIVE', avatar_url: accountAvatarFilename, pending_key: pending_key || readdPendingKey || null, name: accName });
          io.emit('INBOX_SOURCE_ADDED', { id: 'src_personal_' + account_id, source_type: 'personal_messenger', display_name: accName });
          io.emit('EXTENSION_CONNECTION_CHANGED', { account_id, is_connected: true });

          const backgroundRequestedAt = backgroundAfterConnectRequests.get(String(account_id));
          const backgroundRequestIsFresh = Number.isFinite(backgroundRequestedAt)
            && Date.now() - backgroundRequestedAt < 120000;
          if (!pending_key && backgroundRequestIsFresh && !KEEP_CONNECTED_FACEBOOK_CHROME_VISIBLE) {
            backgroundAfterConnectRequests.delete(String(account_id));
            if (backgroundAfterConnectTimers.has(String(account_id))) {
              clearTimeout(backgroundAfterConnectTimers.get(String(account_id)));
              backgroundAfterConnectTimers.delete(String(account_id));
            }
            const hideResult = await processManager.hideAccountProcess(account_id);
            if (hideResult?.success) {
              io.emit('ACCOUNT_DISPLAY_CHANGED', {
                account_id: String(account_id),
                chrome_display_mode: 'BACKGROUND',
                is_chrome_running: true
              });
            }
            console.log(`[BACKGROUND_SYNC] account=${account_id} hidden_immediately=true success=${!!hideResult?.success}`);
          }

          // Gửi ACK về Extension xác nhận đăng ký thành công
          if (ws.readyState === WebSocket.OPEN) {
            if (false && !pending_key && !reloadedExtensionsInThisServerRun.has(String(account_id))) {
              reloadedExtensionsInThisServerRun.add(String(account_id));
              if (!processManager.wasLaunchedByThisRun(account_id)) {
                console.log(`[WS] Yêu cầu Chrome đang chạy sẵn (account=${account_id}) reload extension bản mới nhất...`);
                ws.send(JSON.stringify({ type: 'RELOAD_EXTENSION', data: { reason: 'server_boot_sync_extension' } }));
                break;
              }
            }
            ws.send(JSON.stringify({
              type: 'REGISTER_ACCOUNT_ACK',
              data: { account_id, status: 'SUCCESS', pending_key }
            }));
            const bootstrapState = newAccountBootstrapSyncs.get(String(account_id));
            if (pending_key) {
              scheduleNewAccountBootstrapSync(account_id);
            } else if (bootstrapState?.awaitingSetup) {
              newAccountBootstrapSyncs.delete(String(account_id));
              scheduleNewAccountBootstrapSync(account_id);
            } else if (!isSameConnection) {
              InboxSyncScheduler.startSyncWindow(account_id, 120000);
            }
          }

          // Giao viec lay profile cho cac Page con ten generic / chua co
          // avatar - extension se mo tab profile Page va tra ket qua qua
          // UPDATE_PAGE_PROFILE. Cooldown 30 phut/page: khong mo lai tab
          // profile moi lan extension reconnect (moi lan reconnect truoc day
          // sinh them ca loat tab cho cung cac Page khong bao gio resolve).
          try {
            const pagesNeedProfile = db.prepare(`
              SELECT external_id FROM inbox_sources
              WHERE source_type = 'page_messenger' AND owner_account_id = ?
                AND (avatar_url IS NULL OR display_name = 'Page ' || external_id)
                AND external_id NOT GLOB '615[5-9]??????????'
            `).all(String(account_id));
            const now = Date.now();
            const pageIds = pagesNeedProfile.map((r) => String(r.external_id)).filter((id) => /^\d+$/.test(id))
              .filter((id) => now - (pageProfileFetchLastRequestedAt.get(id) || 0) > 30 * 60 * 1000);
            if (pageIds.length && ws.readyState === WebSocket.OPEN) {
              for (const id of pageIds) pageProfileFetchLastRequestedAt.set(id, now);
              ws.send(JSON.stringify({ type: 'FETCH_PAGE_PROFILES', data: { page_ids: pageIds } }));
              console.log(`[PAGE_SOURCE] Giao lay profile cho ${pageIds.length} Page:`, pageIds.join(','));
            }
          } catch (_) {}

          // InboxSyncScheduler.registerAccount() already starts the lightweight
          // background inbox loop. Do not dispatch a second full SYNC_THREADS
          // crawl here: it competes with realtime receive and manual sends.
          if (process.env.FB_CRM_DISABLE_INITIAL_SWEEP !== '1') {
            setTimeout(() => InitialMessageSweepService.start(account_id), 1500);
          }
          break;
        }

        case 'SEND_MESSAGE_RESULT': {
          const { thread_id, client_message_id, success, error, error_code, message_id, result: fbRes } = msg.data;
          const officialFbId = message_id || fbRes?.o0?.data?.message?.message_id || fbRes?.o0?.data?.message_id || fbRes?.data?.message_id;
          const resultQueueId = typeof client_message_id === 'string' && client_message_id.startsWith('queue_')
            ? client_message_id.slice('queue_'.length)
            : null;
          const richQueueResult = resultQueueId
            ? db.prepare('SELECT outbound_attempt_id, campaign_id FROM message_queue WHERE id = ?').get(resultQueueId)
            : null;
          if (richQueueResult?.outbound_attempt_id) {
            // Rich-message delivery is driven by QUEUED_MESSAGE_RESULT plus
            // bounded Facebook observation, never by this legacy result path.
            break;
          }

          // Campaign sends are owned by QUEUED_MESSAGE_RESULT. handleSendMessage
          // also emits this legacy result while probing the rendered bubble;
          // that probe can be negative after the composer already dispatched.
          // Keep the pending row so the later DOM observation can correlate it.
          if (richQueueResult?.campaign_id && !success && error_code !== 'COMPOSER_DISPATCHED') {
            console.log(`[WS] Ignoring non-authoritative SEND_MESSAGE_RESULT failure for campaign queue ${resultQueueId}`);
            console.log('[OUTBOUND_TRACE]', JSON.stringify({ stage: 'CAMPAIGN_LEGACY_FAILURE_IGNORED', thread_id: String(thread_id), client_message_id, queue_id: resultQueueId, error_code: error_code || null, at: new Date().toISOString() }));
            break;
          }
          
          console.log(`[WS] SEND_MESSAGE_RESULT: thread=${thread_id} client_msg_id=${client_message_id} success=${success} fb_msg_id=${officialFbId}`);
          console.log('[OUTBOUND_TRACE]', JSON.stringify({ stage: 'BACKEND_RESULT_RECEIVED', thread_id: String(thread_id), client_message_id, success: !!success, official_fb_id: !!officialFbId, error_code: error_code || null, error: error || null, at: new Date().toISOString() }));
          
          if (success && officialFbId) {
            db.prepare(`
              UPDATE messages 
              SET fb_message_id = ?, delivery_status = 'sent', delivery_error = NULL
              WHERE client_message_id = ? OR fb_message_id = ?
            `).run(officialFbId, client_message_id, `pending_${client_message_id}`);
            updateQueueStatusFromClientMessage(client_message_id, 'sent');

            io.emit('MESSAGE_SENT', { thread_id, client_message_id, success: true, fb_message_id: officialFbId, status: 'sent' });
          } else if (error_code === 'COMPOSER_DISPATCHED') {
            // Check if DOM/network confirmation already arrived before this result
            const existingRow = db.prepare(`SELECT id, fb_message_id, media_type, delivery_status, delivery_error FROM messages WHERE client_message_id = ? OR fb_message_id = ?`).get(client_message_id, `pending_${client_message_id}`);
            if (existingRow && existingRow.delivery_status === 'sent') {
              console.log(`[WS] COMPOSER_DISPATCHED arrived but row already sent for ${client_message_id}. No-op.`);
              updateQueueStatusFromClientMessage(client_message_id, 'sent');
              io.emit('MESSAGE_SENT', { thread_id, client_message_id, status: 'sent' });
              console.log('[OUTBOUND_TRACE]', JSON.stringify({ stage: 'BACKEND_DISPATCHED_ALREADY_SENT', thread_id: String(thread_id), client_message_id, at: new Date().toISOString() }));
            } else if (existingRow && existingRow.delivery_status === 'failed') {
              console.log(`[WS] COMPOSER_DISPATCHED arrived but row already failed for ${client_message_id}. No-op.`);
              const failError = existingRow.delivery_error || 'Previously failed';
              io.emit('MESSAGE_SEND_FAILED', { thread_id, client_message_id, success: false, status: 'failed', error: failError });
              console.log('[OUTBOUND_TRACE]', JSON.stringify({ stage: 'BACKEND_DISPATCHED_ALREADY_FAILED', thread_id: String(thread_id), client_message_id, at: new Date().toISOString() }));
            } else {
              console.log(`[WS] Composer đã dispatch tin; giữ pending chờ DOM/network confirmation: ${client_message_id}`);
              // A cleared text composer is a successful transport hand-off.
              // Persist the provisional sent state so the independent 30s ACK
              // watchdog cannot turn a real Messenger send into "Retry". The
              // late DOM observer still upgrades pending_* to the official mid.
              if (existingRow?.id) {
                db.prepare(`
                  UPDATE messages SET delivery_status = 'sent', delivery_error = NULL
                  WHERE id = ? AND is_outgoing = 1
                    AND attachment_id IS NULL
                    AND (media_type IS NULL OR media_type = 'text')
                `).run(existingRow.id);
                updateQueueStatusFromClientMessage(client_message_id, 'sent');
              }
              io.emit('MESSAGE_SENT', {
                thread_id,
                client_message_id,
                status: 'sent',
                provisional: true
              });
              console.log('[OUTBOUND_TRACE]', JSON.stringify({ stage: 'BACKEND_CONFIRMATION_GRACE', thread_id: String(thread_id), client_message_id, at: new Date().toISOString() }));
            }
          } else {
            // A composer dispatch can be acknowledged provisionally before the
            // rendered-bubble probe finishes. A late probe may time out although
            // Messenger already accepted the message. Never downgrade a sent row.
            const alreadySentRow = db.prepare(`
              SELECT id, fb_message_id, delivery_status
              FROM messages
              WHERE client_message_id = ? OR fb_message_id = ?
              ORDER BY id DESC
              LIMIT 1
            `).get(client_message_id, `pending_${client_message_id}`);
            if (alreadySentRow && ['sent', 'delivered', 'read'].includes(String(alreadySentRow.delivery_status || '').toLowerCase())) {
              console.log(`[WS] Ignoring late SEND_MESSAGE_RESULT failure for already-sent message ${client_message_id}`);
              updateQueueStatusFromClientMessage(client_message_id, 'sent');
              io.emit('MESSAGE_SENT', {
                thread_id,
                client_message_id,
                fb_message_id: alreadySentRow.fb_message_id || undefined,
                status: 'sent'
              });
              console.log('[OUTBOUND_TRACE]', JSON.stringify({ stage: 'BACKEND_LATE_FAILURE_IGNORED', thread_id: String(thread_id), client_message_id, error_code: error_code || null, at: new Date().toISOString() }));
              break;
            }
            console.error('[WS] ❌ SEND_MESSAGE_RESULT failed or missing fb_msg_id:', {
              thread_id,
              client_message_id,
              success,
              error,
              fbRes: JSON.stringify(fbRes)?.substring(0, 500)
            });

            const failureText = error || 'Facebook không xác nhận message_id';
            const canArriveLateFromComposer = /response rỗng|không nhận message_id|GraphQL/i.test(failureText);
            if (canArriveLateFromComposer) {
              // GraphQL có thể lỗi trước khi composer/DOM kịp xác nhận. Giữ pending
              // một grace window để event đến muộn vẫn ghép được đúng attempt.
              db.prepare(`
                UPDATE messages SET delivery_status = 'pending', delivery_error = ?
                WHERE (client_message_id = ? OR fb_message_id = ?) AND is_outgoing = 1
              `).run(failureText, client_message_id, `pending_${client_message_id}`);
              io.emit('MESSAGE_SEND_PENDING', { thread_id, client_message_id, status: 'pending', error: failureText, error_code: 'CONFIRMATION_GRACE' });
              setTimeout(() => {
                const stillPending = db.prepare(`SELECT id FROM messages WHERE client_message_id = ? AND delivery_status = 'pending'`).get(client_message_id);
                if (!stillPending) return;
              deleteOutboundMessageRows({ messageId: stillPending.id });
                io.emit('MESSAGE_SEND_FAILED', { thread_id, client_message_id, success: false, status: 'failed', error: failureText, error_code: error_code || 'CONFIRMATION_TIMEOUT' });
              }, 5000);
            } else {
              // Lỗi chắc chắn không thể gửi: giữ lịch sử nhưng chuyển failed ngay.
              db.prepare(`DELETE FROM messages
                WHERE (client_message_id = ? OR fb_message_id = ?) AND is_outgoing = 1
              `).run(client_message_id, `pending_${client_message_id}`);
              updateQueueStatusFromClientMessage(client_message_id, 'failed', failureText);
              io.emit('MESSAGE_SEND_FAILED', { thread_id, client_message_id, success: false, status: 'failed', error: failureText, error_code });
            }
          }
          break;
        }

        case 'CONTENT_DEBUG': {
          // Temporary diagnostic sink for spec 040 T020 - page_content.js's
          // raw <img> inspection for a text+image message that didn't match
          // as media, relayed here since the extension's own console isn't
          // reachable during live debugging. Remove once T020 is closed.
          try {
            appendComposerDebugLog({ at: new Date().toISOString(), source: 'CONTENT_DEBUG', ...msg.data });
          } catch (error) {
            console.error('[CONTENT_DEBUG] Ghi log thất bại:', error.message);
          }
          break;
        }

        case 'SYNC_GROUP_MEMBERS_RESULT': {
          // Extension quét xong panel "Thành viên trong đoạn chat" — thay list
          // member nhóm trong DB và phát THREAD_MEMBERS cho mọi client CRM.
          try {
            const d = msg.data || {};
            const gmThreadId = String(d.thread_id || '');
            const gmMembers = Array.isArray(d.members) ? d.members : [];
            syncDebug('group_members_result', { thread: gmThreadId.slice(0, 30), account: String(d.account_id || '').slice(0, 20), count: gmMembers.length, source: d.source || null });
            if (gmThreadId && gmMembers.length) {
              const gmThread = db.prepare('SELECT account_id FROM threads WHERE id = ?').get(gmThreadId);
              if (gmThread && String(gmThread.account_id || '') === String(d.account_id || '')) {
                const replaceMembers = db.transaction((list) => {
                  db.prepare('DELETE FROM group_members WHERE thread_id = ?').run(gmThreadId);
                  const ins = db.prepare('INSERT OR REPLACE INTO group_members (thread_id, name, avatar_url) VALUES (?, ?, ?)');
                  for (const m of list.slice(0, 500)) {
                    const name = String(m?.name || '').trim();
                    if (!name) continue;
                    ins.run(gmThreadId, name.slice(0, 120), String(m?.avatar || '').trim().slice(0, 2000) || null);
                  }
                });
                replaceMembers(gmMembers);
                io.emit('THREAD_MEMBERS', {
                  thread_id: gmThreadId,
                  members: db.prepare('SELECT name, avatar_url FROM group_members WHERE thread_id = ? ORDER BY name COLLATE NOCASE').all(gmThreadId)
                });
                console.log(`[GroupMembers] 🧑‍🤝‍🧑 thread=${gmThreadId} lưu ${gmMembers.length} thành viên nhóm.`);
              }
            }
          } catch (error) {
            console.error('[GroupMembers] Lưu danh sách thành viên lỗi:', error.message);
          }
          break;
        }

        case 'PAGE_SCROLLER_DEBUG': {
          const d = msg.data || {};
          if (d.stage === 'SCROLLER_FOUND') {
            console.log(`[PageScroller] 🎯 Đã tìm thấy khung chat Page: thread=${d.thread_id} | class="${d.class_name}" | height=${d.client_height}px / scrollHeight=${d.scroll_height}px | scrollTop ban đầu=${d.scroll_top}px`);
          } else if (d.stage === 'SCROLLED_TO_TOP') {
            console.log(`[PageScroller] 📜 Vòng ${d.round}: Đã cuộn dứt khoát lên đỉnh (0px) | scrollTop từ ${d.before_top}px -> ${d.after_top}px | scrollHeight=${d.scroll_height}px`);
          } else if (d.stage === 'DOM_SETTLED') {
            console.log(`[PageScroller] 🔄 Vòng ${d.round}: Facebook DOM settled | has_growth=${d.has_growth} | nạp thêm ${d.new_messages_count} tin mới | tổng tích lũy: ${d.total_accumulated} tin`);
          } else if (d.stage === 'SCROLLER_NOT_FOUND') {
            console.warn(`[PageScroller] ⚠️ Không tìm thấy khung cuộn tin nhắn hợp lệ trên trang Facebook cho thread=${d.thread_id}`);
          } else if (d.stage === 'TAB_DISCONNECTED') {
            console.warn(`[PageScroller] ⚠️ Tab Facebook bị mất kết nối (cần F5 lại tab Facebook): ${d.error}`);
          }
          break;
        }

        case 'COMPOSER_DEBUG': {
          // Temporary diagnostic sink for spec 040 T020 - the extension's
          // service worker console isn't reachable during live debugging, so
          // typeAndSubmitComposer relays its composer/send-button selection
          // here instead. Appended as one JSON line per event; remove once
          // T020 is confirmed fixed by a live send.
          try {
            appendComposerDebugLog({ at: new Date().toISOString(), ...msg.data });
          } catch (error) {
            console.error('[COMPOSER_DEBUG] Ghi log thất bại:', error.message);
          }
          break;
        }

        case 'CHECKPOINT_DETECTED': {
          const { account_id } = msg.data;
          db.prepare("UPDATE accounts SET status='CHECKPOINT' WHERE id=?").run(account_id);
          const unhideRes = await processManager.unhideWindow(account_id);
          if (unhideRes?.success) {
            io.emit('ACCOUNT_DISPLAY_CHANGED', {
              account_id: String(account_id),
              chrome_display_mode: 'VISIBLE',
              is_chrome_running: true
            });
          }
          io.emit('ACCOUNT_STATUS_CHANGED', { account_id, status: 'CHECKPOINT' });
          break;
        }

        case 'THREAD_METADATA_UPDATED': {
          const { account_id, thread_id, contact_name, avatar_url, page_id, profile_url } = msg.data || {};
          const tidStr = String(thread_id || '');
          if (!tidStr) break;

          const targetAccountId = account_id || ws.accountId;
          ensureThreadRecord({
            threadId: tidStr,
            accountId: targetAccountId,
            contactName: contact_name,
            pageId: page_id
          }, db);

          let updatedName = null;
          let localAvatarPath = null;
          let updatedProfileUrl = null;

          if (contact_name && !isInvalidContactName(contact_name)) {
            const existingThread = db.prepare('SELECT contact_name FROM threads WHERE id = ?').get(tidStr);
            const otherThreadWithSameName = db.prepare('SELECT id FROM threads WHERE account_id = ? AND id != ? AND contact_name = ?').get(targetAccountId, tidStr, contact_name.trim());
            if (existingThread?.contact_name && !isInvalidContactName(existingThread.contact_name) && existingThread.contact_name !== 'Khách hàng' && otherThreadWithSameName) {
              console.warn(`[WS] ⚠️ Chặn ghi đè tráo tên: thread ${tidStr} (${existingThread.contact_name}) không bị đổi thành "${contact_name}" của thread ${otherThreadWithSameName.id}`);
            } else {
              updatedName = contact_name.trim();
              db.prepare('UPDATE threads SET contact_name = ? WHERE id = ?').run(updatedName, tidStr);
              db.prepare(`
                INSERT INTO contacts (thread_id, name)
                VALUES (?, ?)
                ON CONFLICT(thread_id) DO UPDATE SET
                  name = excluded.name
              `).run(tidStr, updatedName);
            }
          }

          if (profile_url && typeof profile_url === 'string' && profile_url.startsWith('http')) {
            updatedProfileUrl = profile_url.trim();
            db.prepare(`
              INSERT INTO contacts (thread_id, name, profile_url)
              VALUES (?, ?, ?)
              ON CONFLICT(thread_id) DO UPDATE SET
                profile_url = COALESCE(contacts.profile_url, excluded.profile_url)
            `).run(tidStr, updatedName || 'Khách hàng', updatedProfileUrl);
          }

          if (avatar_url && avatar_url.startsWith('http')) {
            try {
              localAvatarPath = await saveAvatarFromBase64OrUrl(avatar_url, tidStr);
              if (localAvatarPath) {
                // Chống tráo avatar: Kiểm tra nếu avatar vừa tải về có hash trùng khớp
                // với avatar của một thread khác thuộc cùng account mà tên 2 thread khác nhau
                const duplicateOther = db.prepare(`
                  SELECT c.thread_id, c.name, c.avatar_url
                  FROM contacts c
                  JOIN threads t ON t.id = c.thread_id
                  WHERE t.account_id = ? AND c.thread_id != ? AND c.avatar_url IS NOT NULL
                `).all(targetAccountId, tidStr);

                let isSuspiciousSwap = false;
                const avatarDir = path.join(APP_DATA_ROOT, 'avatars');
                const currentFilePath = path.join(avatarDir, localAvatarPath);

                if (fs.existsSync(currentFilePath)) {
                  const currentHash = crypto.createHash('md5').update(fs.readFileSync(currentFilePath)).digest('hex');
                  for (const other of duplicateOther) {
                    if (other.name && updatedName && other.name.trim().toLowerCase() !== updatedName.trim().toLowerCase() && other.avatar_url) {
                      const otherFilePath = path.join(avatarDir, other.avatar_url);
                      if (fs.existsSync(otherFilePath)) {
                        const otherHash = crypto.createHash('md5').update(fs.readFileSync(otherFilePath)).digest('hex');
                        if (currentHash === otherHash) {
                          isSuspiciousSwap = true;
                          console.warn(`[WS] ⚠️ Chặn ghi đè tráo avatar: thread ${tidStr} (${updatedName}) bị trùng file avatar với thread ${other.thread_id} (${other.name}).`);
                          break;
                        }
                      }
                    }
                  }
                }

                if (!isSuspiciousSwap) {
                  db.prepare(`
                    INSERT INTO contacts (thread_id, name, avatar_url)
                    VALUES (?, ?, ?)
                    ON CONFLICT(thread_id) DO UPDATE SET
                      avatar_url = excluded.avatar_url
                  `).run(tidStr, updatedName || 'Khách hàng', localAvatarPath);
                } else {
                  localAvatarPath = null;
                }
              }
            } catch (e) {
              console.warn('[WS] Avatar save failed:', e.message);
            }
          }

          io.emit('CONTACT_UPDATED', {
            thread_id: tidStr,
            ...(updatedName ? { name: updatedName } : {}),
            ...(localAvatarPath ? { avatar_url: localAvatarPath } : {}),
            ...(updatedProfileUrl ? { profile_url: updatedProfileUrl } : {})
          });
          break;
        }

        case 'NEW_MESSAGE_RECEIVED': {
          const m = msg.data;
          const threadId = String(m.thread_id || '');
          let realtimeMessageEmittedEarly = false;

          const t_server = Date.now();
          if (m?.telemetry?.t_dom) {
            m.telemetry.t_server = t_server;
            const dDomToSw = m.telemetry.t_sw ? (m.telemetry.t_sw - m.telemetry.t_dom) : 0;
            const dSwToSrv = m.telemetry.t_sw ? (t_server - m.telemetry.t_sw) : (t_server - m.telemetry.t_dom);
            console.log(`[TELEMETRY] ⚡ Latency for ${m.fb_message_id || 'msg'}: dom->sw=${dDomToSw}ms, sw->server=${dSwToSrv}ms, total=${t_server - m.telemetry.t_dom}ms`);
          }

          console.log(`[WS] 📩 Nhận NEW_MESSAGE_RECEIVED | Source: ${m.source || 'unknown'} | Thread: ${threadId} | FB Message ID: ${m.fb_message_id} | Content: "${sanitizeLog(m.content, 80)}"`);
          const { isBlacklistedThreadId } = require('./utils/threadGuard');
          if (!threadId || threadId === 'unknown_dom' || threadId.trim() === '' || isBlacklistedThreadId(threadId)) {
            console.warn(`[WS] ⚠️ Bỏ qua tin nhắn từ Thread ID không hợp lệ hoặc blacklist: "${threadId}"`);
            break;
          }
          const _rawContentLower = (m.content || '').toLowerCase();
          const isCallLog = _rawContentLower.includes('cuộc gọi') || _rawContentLower.includes('bỏ lỡ') || _rawContentLower.includes('đã nhỡ') || _rawContentLower.includes('nhỡ cuộc') || _rawContentLower.includes('chat video')
            || _rawContentLower.includes('audio call') || _rawContentLower.includes('video call') || _rawContentLower.includes('missed call')
            || _rawContentLower.includes('missed audio') || _rawContentLower.includes('missed video') || _rawContentLower.includes('call ended')
            || (m.media_type === 'call');
          if (isCallLog) {
            console.log(`[CALL_DEBUG] 📞 Backend nhận CALL LOG từ Extension: content="${sanitizeLog(m.content)}", thread=${threadId}, fb_id=${m.fb_message_id}, isCallLog=true`);
          }
          if (!threadId || threadId === 'unknown_dom') {
            console.warn(`[WS] ⚠️ Bỏ qua tin nhắn từ Thread ID không hợp lệ: "${threadId}"`);
            break;
          }
          const targetAccountId = m.account_id || ws.accountId || null;
          const canonicalThreadId = resolveInternalThreadId(db, targetAccountId, threadId, m.page_id || null);
          if (!canonicalThreadId) {
            console.warn(`[WS] Bỏ qua tin nhắn chưa ánh xạ được thread: raw=${threadId} account=${targetAccountId || 'unknown'}`);
          }
          // Preserve Facebook's raw id for diagnostics, but use the CRM's
          // canonical id throughout the existing persistence/UI pipeline.
          m.external_thread_id = m.external_thread_id || threadId;
          m.thread_id = canonicalThreadId || threadId;

          // Mid rút gọn: DOM observer thỉnh thoảng chỉ lấy được PHẦN SỐ của
          // mid (7513512...925) thay vì dạng đầy đủ 100066...@msgr.7513...925.
          // Không ghép lại thì CÙNG một tin bị lưu 2 row với 2 "mid" khác
          // nhau: pending_client + echo, 1 bản còn bị lưu nhầm chiều incoming
          // (reproduce 2026-10-07 15:14-15:16). Map về mid đầy đủ đã có.
          if (canonicalThreadId && m.fb_message_id && /^[0-9]{10,25}$/.test(String(m.fb_message_id))) {
            const prefixedTwin = db.prepare(
              "SELECT fb_message_id FROM messages WHERE thread_id = ? AND fb_message_id LIKE '%.' || ? LIMIT 1"
            ).get(String(canonicalThreadId), String(m.fb_message_id));
            if (prefixedTwin?.fb_message_id) {
              console.log(`[WS] 🔗 Ghép mid rút gọn ${m.fb_message_id} về dạng đầy đủ đã có trong thread ${canonicalThreadId}`);
              m.fb_message_id = prefixedTwin.fb_message_id;
            }
          }

          if (isCallLog && m.content && m.fb_message_id) {
            const callThreadId = canonicalThreadId || m.thread_id;
            const threadAccRow = db.prepare('SELECT account_id FROM threads WHERE id = ?').get(callThreadId);
            const targetAccountIdForCall = m.account_id || ws.accountId || threadAccRow?.account_id || null;
            const normalizedCallContent = String(m.content || '').toLocaleLowerCase('vi-VN');
            const isExplicitMissedIncoming = /(?:nhỡ|bỏ lỡ|missed)/i.test(normalizedCallContent);
            const hasRawAvatarEvidence = m.direction_evidence === 'call_article_avatar'
              && (m.has_row_avatar === true || m.has_row_avatar === false);
            const callIsOutgoing = isExplicitMissedIncoming
              ? 0
              : hasRawAvatarEvidence
                ? (m.has_row_avatar ? 0 : 1)
                : ((m.is_outgoing === true || m.is_outgoing === 1) ? 1 : 0);
            ConversationRepository.upsertThread({
              id: callThreadId,
              account_id: targetAccountIdForCall,
              contact_name: m.contact_name || 'Khách hàng',
              last_message: m.content,
              is_unread: !callIsOutgoing
            });
            const stableCallId = m.fb_message_id;
            const callTimestamp = Number(m.timestamp_ms) || Date.parse(m.created_at || '') || Date.now();
            // History sync thường đã lưu đúng dòng cuộc gọi dưới mid thật
            // (media_type='text'). Fallback này cũng khớp dòng text cùng nội
            // dung (có thể kèm hậu tố " • N giây") để gộp thay vì tạo bong
            // bóng thứ hai; ưu tiên dòng mang mid thật.
            const existingCall = db.prepare('SELECT id FROM messages WHERE fb_message_id = ?').get(stableCallId)
              || db.prepare(`
                SELECT id FROM messages
                WHERE thread_id = ? AND media_type IN ('call', 'text')
                  AND (content = ? OR content LIKE ? || ' • %' OR ? LIKE content || ' • %')
                  AND ABS(COALESCE(NULLIF(timestamp_ms, 0), ?) - ?) <= 60000
                ORDER BY CASE WHEN fb_message_id LIKE 'mid.%' THEN 0 ELSE 1 END, id DESC LIMIT 1
              `).get(callThreadId, m.content, m.content, m.content, callTimestamp, callTimestamp);
            const callSenderId = m.sender_id || (callIsOutgoing ? String(targetAccountIdForCall || 'STAFF') : 'CONTACT');
            console.log(`[CALL_DEBUG] 🧵 callThreadId=${callThreadId} | m.thread_id=${m.thread_id} | canonicalThreadId=${canonicalThreadId} | callIsOutgoing=${callIsOutgoing}`);
            if (!existingCall) {
              const insertCall = db.prepare(`
                INSERT OR IGNORE INTO messages
                  (thread_id, fb_message_id, sender_id, content, media_type, is_outgoing, direction_status, timestamp_ms, timestamp_source, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `).run(
                callThreadId, stableCallId,
                callSenderId,
                m.content, 'call', callIsOutgoing, 'confirmed',
                m.timestamp_ms || Date.now(),
                m.timestamp_source || 'realtime_fallback',
                m.created_at || new Date().toISOString()
              );
              if (insertCall.changes > 0) {
                console.log(`[CALL_DEBUG] ✅ Đã lưu call log vào DB: "${sanitizeLog(m.content)}" (id: ${stableCallId}) | thread: ${callThreadId} | is_outgoing: ${callIsOutgoing}`);
                const newMsg = db.prepare('SELECT * FROM messages WHERE fb_message_id = ?').get(stableCallId);
                if (newMsg) {
                  io.emit('NEW_MESSAGE', { ...newMsg, thread_id: callThreadId, account_id: targetAccountIdForCall });
                  io.emit('THREAD_MESSAGES_UPDATED', { thread_id: callThreadId, account_id: targetAccountIdForCall });
                }
              } else {
                // INSERT OR IGNORE bị ignore (trùng fb_message_id): patch media_type và is_outgoing nếu cần
                db.prepare(`UPDATE messages SET media_type = 'call', is_outgoing = ? WHERE fb_message_id = ?`).run(callIsOutgoing, stableCallId);
                const existingMsg = db.prepare('SELECT * FROM messages WHERE fb_message_id = ?').get(stableCallId);
                if (existingMsg) {
                  console.log(`[CALL_DEBUG] 🔄 Patch media_type='call' cho tin đã tồn tại: ${stableCallId}`);
                  io.emit('NEW_MESSAGE', { ...existingMsg, thread_id: callThreadId, account_id: targetAccountIdForCall });
                  io.emit('THREAD_MESSAGES_UPDATED', { thread_id: callThreadId, account_id: targetAccountIdForCall });
                }
              }
            } else {
              // existingCall tồn tại: patch media_type & is_outgoing rồi re-emit
              db.prepare(`UPDATE messages SET media_type = 'call', is_outgoing = ? WHERE id = ?`).run(callIsOutgoing, existingCall.id);
              const existingMsg = db.prepare('SELECT * FROM messages WHERE id = ?').get(existingCall.id);
              if (existingMsg) {
                console.log(`[CALL_DEBUG] 🔄 existingCall: patch + re-emit thread=${callThreadId}: ${stableCallId}`);
                io.emit('NEW_MESSAGE', { ...existingMsg, thread_id: callThreadId, account_id: targetAccountIdForCall });
                io.emit('THREAD_MESSAGES_UPDATED', { thread_id: callThreadId, account_id: targetAccountIdForCall });
              }
            }
            break;
          }


          const cleanedContent = cleanMessageText(m.content);
          const isDomObserverRow = m.source === 'dom_observer' || m.source === 'page_dom_observer';
          // Network interception is a fast path only. Facebook also returns
          // unrelated payload fragments with a `body` field; when those frames
          // have no actor or durable message id they look like an incoming
          // message and create the left-side ghost text after an operator send.
          // Let the DOM/history source handle such ambiguous frames instead.
          const isNetworkObserverRow = ['network_interceptor', 'websocket', 'mercury', 'network_xhr'].includes(String(m.source || ''));
          const networkMessageId = String(m.fb_message_id || '');
          const hasStableNetworkMessageId = networkMessageId.startsWith('mid.') || /(?:^|_)mid_/.test(networkMessageId);
          if (isNetworkObserverRow && (!m.sender_id || !hasStableNetworkMessageId)) {
            console.log(`[WS] Backend Guard: skip ambiguous network frame: source=${m.source} thread=${canonicalThreadId}`);
            break;
          }
          // A type alone is only a Messenger DOM shell. Treat media as real
          // only after its URL/path/attachment identity is available.
          const hasMediaPayload = !!(m.media_url || m.local_media_path || m.attachment_id);
          const isBareDomMediaShell = isDomObserverRow
            && String(m.fb_message_id || '').startsWith('dom_')
            && !hasMediaPayload
            && m.media_type && m.media_type !== 'text' && m.media_type !== 'call';
          if (isBareDomMediaShell) {
            console.log(`[WS] Backend Guard: skip unhydrated DOM media shell: ${sanitizeLog(cleanedContent, 60)}`);
            break;
          }

          // Before the junk/system-text guards below get a chance to drop this
          // event, check whether its RAW (pre-cleaning) text matches something
          // we ourselves are actively waiting to confirm in this exact thread.
          // cleanMessageText's final junk-pattern pass can null out a real
          // outgoing-confirmation scrape entirely (see the guard right below),
          // which used to leave an already-delivered send stuck at 'pending'
          // forever with zero trace, since the correlation logic further down
          // in this handler never got a chance to run once cleanedContent was
          // ''. Scoped tightly to that one failure mode - text-only DOM
          // observer events whose cleaning collapsed to nothing - so every
          // other event (the overwhelming majority) is unaffected.
          if (!hasMediaPayload && !cleanedContent && (m.source === 'dom_observer' || m.source === 'page_dom_observer')) {
            const rawContent = String(m.content || '').trim();
            if (rawContent) {
              const earlyInternalThreadId = canonicalThreadId;
              const pendingMatch = OutboundDomCorrelationService.matchPendingOutboundByRawContent(db, earlyInternalThreadId, rawContent);
              if (pendingMatch) {
                const confirmed = OutboundDomCorrelationService.confirmPendingOutbound(db, io, pendingMatch, {
                  fbMessageId: m.fb_message_id,
                  tsMs: m.timestamp_ms || 0,
                  tsSource: m.timestamp_source || 'unknown',
                  rawMessage: m
                });
                if (confirmed) {
                  console.log('[OUTBOUND_TRACE]', JSON.stringify({ stage: 'BACKEND_DOM_CORRELATED_EARLY', thread_id: String(earlyInternalThreadId), client_message_id: pendingMatch.client_message_id, at: new Date().toISOString() }));
                }
                break;
              }
            }
          }

          // Composer confirmations for attachment sends carry only the real
          // Facebook message id with EMPTY content - the file itself never
          // appears in the composer text. The junk guard below used to discard
          // that event, and with the DOM echo also suppressed during sync
          // windows the send got no confirmation at all: after 3 minutes the
          // attachment watchdog marked it failed and DELETED the CRM's own
          // bubble (reproduced 2026-09-30 - image + video sent from the
          // composer vanished minutes later, attachments stuck at
          // CONFIRMATION_TIMEOUT).
          if (m.source === 'composer_confirmation' && m.fb_message_id && !hasMediaPayload && !cleanedContent) {
            const pendingMedia = OutboundDomCorrelationService.matchPendingImageOutbound(db, canonicalThreadId, 'any');
            if (pendingMedia) {
              const confirmed = OutboundDomCorrelationService.confirmPendingOutbound(db, io, pendingMedia, {
                fbMessageId: m.fb_message_id,
                tsMs: m.timestamp_ms || 0,
                tsSource: m.timestamp_source || 'composer',
                rawMessage: m
              });
              console.log('[OUTBOUND_TRACE]', JSON.stringify({
                stage: confirmed ? 'BACKEND_COMPOSER_MEDIA_CONFIRMED' : 'BACKEND_COMPOSER_MEDIA_CONFIRM_CONFLICT',
                thread_id: String(canonicalThreadId),
                client_message_id: pendingMedia.client_message_id,
                fb_message_id: String(m.fb_message_id),
                at: new Date().toISOString()
              }));
            }
            break;
          }

          // Meta Page can inject this lead-activity notice repeatedly while a
          // thread reloads. It is never customer content, even when it arrives
          // without an FB message id, so reject it before persistence/capture.
// DOM rows often expose the sender heading as a standalone text node.
          // It is metadata, not a customer message; reject it before persistence.
          const knownContactName = db.prepare('SELECT contact_name FROM threads WHERE id = ?').get(canonicalThreadId)?.contact_name || '';
          const observedPersonLabels = [m.sender_name, m.contact_name, knownContactName]
            .map((value) => String(value || '').trim())
            .filter(Boolean);
          const normalizedObservedContent = String(cleanedContent || '').trim().toLocaleLowerCase('vi-VN');
          const senderLabelOnly = !hasMediaPayload
            && isDomObserverRow
            && normalizedObservedContent
            && observedPersonLabels.some((label) => normalizedObservedContent === label.toLocaleLowerCase('vi-VN'));
          if (senderLabelOnly) {
            console.log(`[WS] Backend Guard: bỏ qua tên người gửi bị parse thành nội dung: "${sanitizeLog(cleanedContent, 60)}"`);
            break;
          }
          if (!hasMediaPayload && isKnownPageSystemNotice(cleanedContent)) {
            console.log(`[WS] ℹ️ Backend Guard: Bỏ qua thông báo hệ thống Meta lặp lại từ thread ${threadId}`);
            break;
          }
          if (!hasMediaPayload && (!cleanedContent || isSystemOrMetadataText(cleanedContent))) {
            console.log(`[WS] ℹ️ Backend Guard: Bỏ qua tin nhắn rác/hệ thống: "${sanitizeLog(m.content, 40)}" từ thread ${threadId}`);
            break;
          }

          // Chặn nhân đôi khi mở thread: MutationObserver đọc lại bubble CŨ
          // trong đợt hydrate đầu trước khi React gắn data-message-id -> id rơi
          // về dom_ (hash nội dung), UNIQUE(fb_message_id) không khớp row mid
          // thật đã có -> text cũ thành "tin mới" (timestamp=giờ mở app + flip
          // unread - reproduce 2026-10-07 "Khi nào bạn muốn ăn" x2). Bubble
          // forward trong window 8s sau attach mang initial_burst=true (đường
          // reconcile đã chặn sẵn bằng native-id từ trước). Tin khách thật
          // đến ngoài window này, hoặc có mid thật/media, không bị đụng tới.
          // MIỄN TRỪ emoji-thuần: khách/operator nhắn lặp 👍 liên tục là chuyện
          // bình thường, không được drop (reproduce 2026-10-07 14:06 - mất 3
          // like vì trùng 👍 đã có); trùng lặp mid thật vẫn chặn ở UNIQUE.
          if (
            !hasMediaPayload
            && m.initial_burst === true
            && m.is_outgoing !== true && m.is_outgoing !== 1
            && String(m.fb_message_id || '').startsWith('dom_')
            && cleanedContent
            && !/^(?=[\s\S]*\p{Extended_Pictographic})[\p{Extended_Pictographic}\uFE0F\u200D\s]+$/u.test(cleanedContent)
          ) {
            const nativeTwin = db.prepare(`
              SELECT id FROM messages
              WHERE thread_id = ? AND is_outgoing = 0
                AND COALESCE(content, '') = COALESCE(?, '')
                AND fb_message_id NOT LIKE 'dom_%'
                AND fb_message_id NOT LIKE 'sidebar_preview_%'
              LIMIT 1
            `).get(canonicalThreadId, cleanedContent);
            if (nativeTwin) {
              console.log(`[WS] 🛡️ Bỏ quan sát lại bubble cũ khi mở thread (id dom_ trùng text đã có mid thật #${nativeTwin.id}): thread=${canonicalThreadId} content="${sanitizeLog(cleanedContent, 60)}"`);
              break;
            }
          }

          // Nếu raw content chứa chuỗi quá lớn (scrap rộng), reject ở backend
          if ((m.content || '').split('\n').length > 8 && isSystemOrMetadataText(m.content)) {
            console.log(`[WS] ℹ️ Backend Guard: Bỏ qua cụm text scrap rộng từ thread ${threadId}`);
            break;
          }

          m.content = cleanedContent;

          // 3. Fix backend fallback is_outgoing
          let finalIsOutgoing = 0;
          let threadAccountId = targetAccountId;

          // Lấy account_id của thread nếu có
          const existingThreadForAcct = db.prepare('SELECT account_id FROM threads WHERE id=?').get(threadId);
          if (existingThreadForAcct && existingThreadForAcct.account_id) {
            threadAccountId = existingThreadForAcct.account_id;
          }

          if (m.is_outgoing === true || m.is_outgoing === 1) {
            finalIsOutgoing = 1;
          } else if (m.sender_name === 'Bạn' || m.sender_name === 'BÃ¡ÂºÂ¡n') {
            finalIsOutgoing = 1;
          } else if (m.sender_id && targetAccountId && String(m.sender_id) === String(targetAccountId)) {
            finalIsOutgoing = 1;
          } else if (m.sender_id && threadAccountId && String(m.sender_id) === String(threadAccountId)) {
            finalIsOutgoing = 1;
          }
          // 2. Bổ sung log backend
          console.log(`[WS] 🔍 Debug Outgoing | Thread: ${threadId} | Source: ${m.source} | account_id: ${targetAccountId} | thread_account_id: ${threadAccountId} | sender_id: ${m.sender_id} | sender_name: ${m.sender_name} | raw is_outgoing: ${m.is_outgoing} | final is_outgoing: ${finalIsOutgoing}`);

          const isPageDomObservation = m.source === 'page_dom_observer';
          // Composer confirmations are the authoritative Facebook echo for a
          // CRM attachment send. Correlate them just like existing DOM echoes
          // instead of persisting a second image/video bubble.
          const isTrustedOutgoingObservation = m.source === 'dom_observer'
            || m.source === 'page_dom_observer'
            || m.source === 'composer_confirmation';
          const hasBooleanDirection = m.is_outgoing === true || m.is_outgoing === false
            || m.is_outgoing === 1 || m.is_outgoing === 0;
          // New Page events must carry an explicit high-confidence direction.
          // Older payloads and unknown geometry remain pending for safety.
          let directionStatus = isPageDomObservation
            && !(m.direction_status === 'confirmed' && m.direction_confidence === 'high' && hasBooleanDirection)
            ? 'pending'
            : 'confirmed';
          if (directionStatus === 'pending') finalIsOutgoing = 0;

          // Outgoing "yếu chứng" từ dom_observer realtime: không phải tin CRM
          // tự gửi (không có client_message_id) và chưa có giờ tin cậy (label
          // chưa hydrate / realtime_fallback). FB đổi format nhãn (2026-11-03)
          // khiến claim outgoing này có thể là tin KHÁCH. Giữ finalIsOutgoing=1
          // (UX như cũ) nhưng đánh dấu pending để reconcile 2-strike tự sửa
          // khi scan sau đọc đúng nhãn, thay vì khoá chiều confirmed vĩnh viễn.
          const weakOutgoingDomClaim = finalIsOutgoing === 1
            && m.source === 'dom_observer'
            && !m.client_message_id
            && (!(Number(m.timestamp_ms) > 0) || String(m.timestamp_source || '') === 'realtime_fallback');
          if (weakOutgoingDomClaim) directionStatus = 'pending';

          // Outbound media echo correlation guard:
          // During video/image upload/transcode, Facebook renders the media before
          // attaching the "Bạn đã gửi" label, causing DOM observers to report it as incoming.
          const isMediaObservation = !!(m.media_url || (m.media_type && m.media_type !== 'text') || hasMessageMediaPayload(m));
          const ambiguousDirectionEcho = !m.sender_id
            || String(m.sender_id) === String(threadAccountId || targetAccountId || '');

          if (finalIsOutgoing === 0 && isMediaObservation && ambiguousDirectionEcho && (m.source === 'dom_observer' || m.source === 'dom_history_sync' || m.source === 'page_dom_observer' || m.source === 'network_observer')) {
            const observedMediaKind = (m.media_type && m.media_type !== 'text')
              ? (String(m.media_type).startsWith('video') ? 'video' : 'image')
              : (m.media_url ? 'image' : 'any');

            // NEW: Check if the same media_url is already stored as outgoing in this thread.
            // A wide video's geometry often reads as incoming, but if we already own that
            // exact CDN URL as a sent item, this is our own echo — never create a duplicate.
            if (m.media_url) {
              // Identity compare only: an unqualified `local_media_path IS NOT
              // NULL` here matched ANY outgoing media that had a local file,
              // forcing genuine customer media to is_outgoing=1 (direction
              // flip, reproduced 2026-09-30 - "Blocked duplicate incoming
              // media" logged for a message the customer actually sent).
              const sameUrlOutgoing = db.prepare(`
                SELECT id, fb_message_id FROM messages
                WHERE thread_id = ? AND is_outgoing = 1
                  AND (media_url = ? OR (? IS NOT NULL AND local_media_path = ?))
                  AND (media_type IS NOT NULL AND media_type != 'text')
                LIMIT 1
              `).get(canonicalThreadId, m.media_url, m.local_media_path || null, m.local_media_path || null);
              if (sameUrlOutgoing) {
                console.log(`[WS] 🛡️ Blocked duplicate incoming media: same media_url already stored as outgoing #${sameUrlOutgoing.id} in thread ${canonicalThreadId}`);
                finalIsOutgoing = 1;
                directionStatus = 'confirmed';
              }
            }

            if (finalIsOutgoing === 0) {
              const matchingPendingMedia = OutboundDomCorrelationService.matchPendingImageOutbound(
                db, canonicalThreadId, observedMediaKind
              );
              if (matchingPendingMedia) {
                console.log(`[WS] 🎯 Correlating ambiguous incoming media observation with pending outbound media #${matchingPendingMedia.id} (${matchingPendingMedia.client_message_id}) in thread ${canonicalThreadId}`);
                finalIsOutgoing = 1;
                directionStatus = 'confirmed';
              } else {
                const mediaTypeClause = observedMediaKind === 'any'
                  ? ''
                  : "AND LOWER(COALESCE(media_type, '')) = ?";
                const params = observedMediaKind === 'any'
                  ? [canonicalThreadId]
                  : [canonicalThreadId, observedMediaKind];
                const recentSentMedia = db.prepare(`
                  SELECT id, fb_message_id, client_message_id
                  FROM messages
                  WHERE thread_id = ? AND is_outgoing = 1
                    AND (attachment_id IS NOT NULL OR (media_type IS NOT NULL AND media_type != 'text'))
                    AND datetime(created_at) >= datetime('now', '-60 seconds')
                    ${mediaTypeClause}
                  ORDER BY id DESC LIMIT 1
                `).get(...params);
                if (recentSentMedia) {
                  console.log(`[WS] 🎯 Correlating ambiguous incoming media observation with recently sent outbound media #${recentSentMedia.id} in thread ${canonicalThreadId}`);
                  finalIsOutgoing = 1;
                  directionStatus = 'confirmed';
                }
              }
            }
          }

          const isOutgoing = finalIsOutgoing;
          const isConfirmedIncoming = directionStatus === 'confirmed' && !isOutgoing;

          // Echo của tin CRM gửi qua composer thỉnh thoảng quay về SAI CHIỀU
          // (incoming) với mid dạng trần hoặc nội dung là nhãn trợ năng
          // ("Enter, Message sent 15:15 by Khang: ảo vậy"). Nếu khớp một row
          // pending CHƯA được promote trong 2 phút (FIFO) thì gắn mid vào row
          // gốc - đúng vị trí gửi, đúng chiều - thay vì tạo bubble thứ hai
          // sai chiều/sai vị trí (reproduce 2026-10-07 15:14-15:15).
          if ((isDomObserverRow || isNetworkObserverRow) && isConfirmedIncoming
            && m.fb_message_id && !String(m.fb_message_id).startsWith('pending_')) {
            let echoContent = String(m.content || '').trim();
            const echoLabelMatch = echoContent.match(/^Enter,\s*Message sent \d{1,2}:\d{2}\s+by\s+[^:]*:\s*(.*)$/i);
            if (echoLabelMatch) echoContent = echoLabelMatch[1].trim();
            if (echoContent) {
              const pendingRow = db.prepare(`
                SELECT id FROM messages
                WHERE thread_id = ? AND is_outgoing = 1
                  AND fb_message_id LIKE 'pending_client_%'
                  AND created_at >= datetime('now', '-2 minutes')
                  AND COALESCE(content, '') = ?
                ORDER BY id ASC LIMIT 1
              `).get(String(canonicalThreadId), echoContent);
              if (pendingRow) {
                db.prepare('UPDATE messages SET fb_message_id = ? WHERE id = ?')
                  .run(String(m.fb_message_id), pendingRow.id);
                console.log(`[WS] 🔗 Ghép echo ${m.fb_message_id} vào row pending #${pendingRow.id} (đúng vị trí gửi) - thread ${canonicalThreadId}`);
                io.emit('MESSAGE_UPDATED', { thread_id: String(canonicalThreadId), id: String(pendingRow.id) }).catch?.(() => {});
                break;
              }
            }
          }

          // A network/DOM observation with a conflicting incoming direction is
          // not authoritative for an operator send. The stored CRM outbound
          // row is authoritative, so discard the echo before it can become a
          // second left-side text bubble.
          if ((isDomObserverRow || isNetworkObserverRow) && isConfirmedIncoming
            && ambiguousDirectionEcho
            && isRecentOutgoingTextEcho(canonicalThreadId, m, db)) {
            console.log(`[WS] Backend Guard: skip CRM outbound text echo parsed as incoming: source=${m.source} thread=${canonicalThreadId} content="${sanitizeLog(m.content, 60)}"`);
            break;
          }

          // Startup/sync replay suppression only applies to the personal-messenger
          // dom_observer, which replays confirmations of messages the CRM itself
          // just sent. page_dom_observer passively scrapes Business Suite's
          // existing history and never has a corresponding pending row to match
          // against, so this gate would (and did) drop every real outgoing Page
          // message discovered during the ~8s window right after any reconnect.
          if (m.source === 'dom_observer' && isOutgoing) {
            const hasRecentPending = db.prepare(`
              SELECT id FROM messages
              WHERE thread_id = ? AND is_outgoing = 1 AND delivery_status = 'pending'
                AND datetime(created_at) >= datetime('now', '-10 seconds')
              LIMIT 1
            `).get(canonicalThreadId);
            const suppressUntil = domReplaySuppressUntil.get(targetAccountId) || 0;
            if (!hasRecentPending && Date.now() < suppressUntil) {
              console.log(`[WS] ℹ️ Suppress outgoing DOM replay during startup/sync window: thread=${threadId} content="${sanitizeLog(m.content, 40)}"`);
              console.log('[OUTBOUND_TRACE]', JSON.stringify({ stage: 'BACKEND_DOM_REPLAY_SUPPRESSED', thread_id: String(threadId), at: new Date().toISOString() }));
              break;
            }
          }

          // Tải media về local nếu tin mới có đính kèm
          // Persist/emit remote media immediately. Local hydration is queued
          // after the row exists so a slow video cannot block later messages.

          // FIX FOREIGN KEY: Đảm bảo thread tồn tại/được upsert TRƯỚC KHI insert message.
          // DOM observer replay lại tin cũ RẤT NHIỀU lần (log thực tế: cùng một
          // fb_message_id được gửi lại hàng trăm lần). Replay KHÔNG được đổi
          // trạng thái đọc/chưa đọc và không được xóa cờ đánh tay - nếu không
          // hội thoại sẽ nhảy lên nhảy xuống liên tục giữa replay và sync.
          const isReplayedObservation = m.fb_message_id
            ? Boolean(db.prepare('SELECT 1 FROM messages WHERE thread_id = ? AND fb_message_id = ?')
              .get(String(canonicalThreadId), String(m.fb_message_id)))
            : false;
          if (!isReplayedObservation) {
            if (!isOutgoing) {
              // Khách nhắn = khách đang trong hội thoại = mọi tin operator
              // GỬI TRƯỚC tin này đã xem. Phải so thời gian: chỉ lấy tin đi
              // cũ hơn tin khách vừa gửi - tin operator gửi SAU (khách chưa
              // kịp đọc) tuyệt đối không được dán 'Đã xem'.
              const incomingAt = Number(m.timestamp_ms) || Date.parse(m.created_at || '') || Date.now();
              const prevSeen = db.prepare('SELECT last_seen_message_id FROM threads WHERE id = ?').get(String(canonicalThreadId));
              const lastOut = db.prepare(`
                SELECT id FROM messages
                WHERE thread_id = ? AND is_outgoing = 1
                  AND COALESCE(timestamp_ms, 0) <= ?
                ORDER BY COALESCE(sequence_order, id) DESC LIMIT 1
              `).get(String(canonicalThreadId), incomingAt);
              if (lastOut && String(prevSeen?.last_seen_message_id || '') !== String(lastOut.id)) {
                db.prepare('UPDATE threads SET last_seen_message_id = ? WHERE id = ?').run(String(lastOut.id), String(canonicalThreadId));
                io.emit('THREAD_SEEN', { thread_id: String(canonicalThreadId), last_seen_message_id: String(lastOut.id) });
              }
            }
            if (isOutgoing) {
              // Operator trả lời = đã đọc hội thoại: ghim -1 để chấm xanh
              // còn treo ở Messenger không đánh dấu lại "chưa đọc" khi sync.
              db.prepare('UPDATE threads SET is_unread = 0, unread_manual = -1 WHERE id = ?').run(String(canonicalThreadId));
            } else {
              // Tin mới của khách: bật chưa đọc + GẮN CỜ DÍNH, vì tab Facebook
              // có thể đang đậu đúng thread này nên Facebook tự báo "đã đọc"
              // vài giây sau qua sync sidebar - không được để nó tắt nhắc.
              db.prepare('UPDATE threads SET is_unread = 1, unread_manual = 1 WHERE id = ?').run(String(canonicalThreadId));
              io.emit('THREAD_UNREAD_CHANGED', { thread_id: String(canonicalThreadId), is_unread: 1 });
            }
          }
          ConversationRepository.upsertThread({
            id: m.thread_id,
            account_id: targetAccountId,
            contact_name: m.contact_name || 'Khách hàng',
            last_message: m.content,
            is_unread: isReplayedObservation ? undefined : !isOutgoing
          });

          // Auto-register Page source & rebind thread khi đến từ Business Suite
          if (m.source === 'page_dom_observer' && m.page_id) {
            try {
              const updatedSource = InboxSourceService.ensurePageSource({
                pageId: String(m.page_id),
                accountId: targetAccountId,
                threadId: m.thread_id,
                pageName: m.page_name || null
              }, db);
              if (updatedSource && m.page_name && updatedSource.display_name === m.page_name) {
                io.emit('INBOX_SOURCE_UPDATED', updatedSource);
                io.emit('THREAD_LIST_UPDATED');
              }
            } catch (pageSourceErr) {
              console.warn('[PAGE_SOURCE] Lỗi auto-register page source:', pageSourceErr.message);
            }
          }

          let tsMs = Number(m.timestamp_ms) || 0;
          const tsSource = m.timestamp_source || 'unknown';
          // Giữ đúng THỨ TỰ ĐẾN cho tin realtime: timestamp parse từ nhãn phút
          // ('14:20' -> 14:20:00) luôn lùi về đầu phút, nên tin khách đến SAU
          // tin operator 25 giây lại mang ts SỚM HƠN và bị sort nhầm lên trước
          // (reproduce 2026-10-07 14:20: like operator 14:20:20 bị chìm dưới
          // các like khách đến sau). Nếu ts nhỏ hơn max ts hiện có của thread
          // và lệch với hiện tại dưới 15 phút -> đẩy lên maxTs + 1. Không đụng
          // replay lịch sử cũ (tin legacy > 15 phút giữ nguyên ts thật).
          if (tsMs > 0) {
            const newestRow = db.prepare('SELECT MAX(timestamp_ms) AS maxTs FROM messages WHERE thread_id = ?').get(canonicalThreadId);
            const newestTs = Number(newestRow?.maxTs || 0);
            // Chỉ đẩy khi tin nằm CÙNG PHÚT với ts mới nhất: bump toàn cục cũ
            // nuốt cả tin catch-up đến trễ (nhãn '09:26' thật nhưng vào DB sau
            // tin '09:31'), phá phút thật khiến normalizeMessageSequence sort
            // theo thứ tự ingest của đợt burst -> sai vị trí (reproduce
            // 2026-10-15 09:30 thread Hai Anh: lộn/1 năm/Nói chung chen giữa
            // ukii a và bubble reply). Khác phút = tin cũ hơn thật, giữ nguyên
            // nhãn phút để minute-sort xếp đúng chỗ.
            const sameMinute = newestTs > 0
              && Math.floor(newestTs / 60000) === Math.floor(tsMs / 60000);
            if (newestTs > tsMs && sameMinute && (Date.now() - tsMs) < 15 * 60 * 1000) {
              tsMs = newestTs + 1;
              m.created_at = new Date(tsMs).toISOString();
            }
          }
          const createdAt = (m.created_at && !isNaN(Date.parse(m.created_at))) ? m.created_at : new Date().toISOString();

          const safeSenderId = m.sender_id || (isOutgoing ? String(targetAccountId) : 'CONTACT');
          // Messenger exposes a caption/base id and an `id_media` companion
          // for one logical image. Fold the media record into the base row.
          const mergedMediaCompanion = OutboundDomCorrelationService.mergeMediaCompanion(
            db, canonicalThreadId, m, isOutgoing
          );
          if (mergedMediaCompanion) {
            io.emit('NEW_MESSAGE', withAttachmentAccessUrl({
              ...mergedMediaCompanion,
              thread_id: canonicalThreadId,
              account_id: targetAccountId,
              status: mergedMediaCompanion.delivery_status || 'sent'
            }));
            break;
          }
          // Composer fallback không có official GraphQL ID; ghép confirmation DOM
          // vào bản pending gần nhất cùng thread/nội dung thay vì tạo bubble thứ hai.
          if (isOutgoing && isTrustedOutgoingObservation && (m.content || m.media_url || (m.media_type && m.media_type !== 'text'))) {
            console.log('[OUTBOUND_TRACE]', JSON.stringify({ stage: 'BACKEND_DOM_OUTGOING_RECEIVED', thread_id: String(threadId), fb_message_id: m.fb_message_id || null, at: new Date().toISOString() }));
            let skipPendingCorrelation = false;
            // Fix: Tránh crash UNIQUE constraint khi DOM observer gửi lại tin nhắn cũ có trùng content
            if (m.fb_message_id) {
               const existingFbId = db.prepare('SELECT id, is_outgoing, delivery_status FROM messages WHERE fb_message_id = ?').get(m.fb_message_id);
               if (existingFbId && existingFbId.is_outgoing === 1 && existingFbId.delivery_status === 'sent') {
                   console.log(`[WS] DOM observer sent an already known confirmed fb_message_id (${m.fb_message_id}). Bỏ qua event để tránh ghi đè pending.`);
                   // Do not skip yet: a replay of an already-persisted media
                   // id may still be the confirmation for a pending CRM upload.
               }
            }

            if (!skipPendingCorrelation) {
              // Rich-message sends (image/file, tracked via outbound_attempts)
              // are invisible to the legacy pending lookup below - it only
              // knows the messages table. Try the dedicated confirmation
              // service first; it's a safe no-op (NO_CANDIDATE) for every
              // plain-text send, since those never create an outbound_attempts
              // row, so this can never double-fire against the legacy path.
              const internalThreadId = canonicalThreadId;
              const richConfirmation = OutboundConfirmationService.confirmObservation({
                threadId: internalThreadId,
                fbMessageId: m.fb_message_id,
                isOutgoing: true,
                mediaType: m.media_type || 'text',
                content: m.content,
                observedAt: Number(m.timestamp_ms) || Date.parse(m.created_at || '') || Date.now(),
                confirmationSource: m.source === 'page_dom_observer' ? 'page_dom' : 'personal_dom'
              }, { database: db });

              if (richConfirmation.matched) {
                const updatedMessage = db.prepare('SELECT * FROM messages WHERE id = ?').get(richConfirmation.message_id);
                io.emit('MESSAGE_SENT', { thread_id: internalThreadId, client_message_id: richConfirmation.client_message_id, fb_message_id: richConfirmation.fb_message_id, status: 'sent' });
                io.emit('NEW_MESSAGE', withAttachmentAccessUrl({ ...updatedMessage, client_message_id: richConfirmation.client_message_id, status: 'sent' }));
                console.log('[OUTBOUND_TRACE]', JSON.stringify({ stage: 'BACKEND_RICH_CONFIRMED', thread_id: String(internalThreadId), client_message_id: richConfirmation.client_message_id, fb_message_id: richConfirmation.fb_message_id, at: new Date().toISOString() }));
                break;
              }

              // Rich recovery had first chance above. If this official id is
              // still already present, it is now a true duplicate and must
              // not fall through to another insert.
              if (m.fb_message_id) {
                const existingFbId = db.prepare('SELECT id, is_outgoing, delivery_status, direction_status FROM messages WHERE fb_message_id = ?').get(m.fb_message_id);
                if (existingFbId && existingFbId.is_outgoing === 1 && existingFbId.delivery_status === 'sent') {
                  if (existingFbId.direction_status === 'pending') {
                    // Fix B đánh pending cho outgoing yếu chứng, nhưng mọi echo
                    // sau đều bị chặn tại đây nên reconcile 2-strike không bao
                    // giờ chạy -> pending kẹt vĩnh viễn, tin mình render như
                    // tin khách (reproduce 2026-11-03). Observation trusted này
                    // là lượt xác nhận thứ hai: confirm chiều + đẩy row mới.
                    db.prepare("UPDATE messages SET direction_status = 'confirmed' WHERE id = ? AND direction_status = 'pending'").run(existingFbId.id);
                    const confirmedRow = db.prepare('SELECT * FROM messages WHERE id = ?').get(existingFbId.id);
                    io.emit('NEW_MESSAGE', withAttachmentAccessUrl({
                      ...confirmedRow,
                      thread_id: canonicalThreadId,
                      account_id: targetAccountId,
                      is_outgoing: true,
                      direction_status: 'confirmed',
                      status: confirmedRow.delivery_status || 'sent'
                    }));
                    console.log(`[WS] ✅ Confirm chiều outgoing cho row pending ${existingFbId.id} (fb_message_id ${m.fb_message_id}).`);
                  } else {
                    console.log(`[WS] Known confirmed fb_message_id (${m.fb_message_id}); pending recovery found no candidate.`);
                  }
                  break;
                }
              }

              const isMediaConfirmation = OutboundDomCorrelationService.isMediaConfirmationEvent(m);
              // Spec 039/040: a plain text-content match only proves the caption
              // rendered on Facebook, not that an attachment/manifest riding
              // alongside it actually attached and sent (live testing showed
              // Facebook can post just the caption while the file silently
              // fails to attach). Excluding queue rows with attachment_id/
              // manifest_id here forces such dispatches through the explicit
              // media-confirmation path instead, so they fail safe to
              // 'unknown' on timeout rather than falsely reporting 'sent'.
              const observedMediaKind = (m.media_type && m.media_type !== 'text')
                ? (String(m.media_type).startsWith('video') ? 'video' : 'image')
                : (m.media_url ? 'image' : 'any');

              let pending = isMediaConfirmation
                ? OutboundDomCorrelationService.matchPendingImageOutbound(db, internalThreadId, observedMediaKind)
                : db.prepare(`
                    SELECT outbound.id, outbound.client_message_id FROM messages outbound
                    LEFT JOIN outbound_attempts attempt ON outbound.latest_attempt_id = attempt.id
                    LEFT JOIN message_queue queued ON (
                      outbound.client_message_id = 'queue_' || queued.id
                      OR attempt.id = queued.outbound_attempt_id
                    )
                    WHERE outbound.thread_id = ? AND outbound.content = ? AND outbound.is_outgoing = 1
                      AND outbound.delivery_status = 'pending'
                      AND outbound.attachment_id IS NULL AND (outbound.media_type IS NULL OR outbound.media_type = 'text')
                      AND (queued.id IS NULL OR (queued.attachment_id IS NULL AND queued.manifest_id IS NULL))
                    ORDER BY outbound.id ASC LIMIT 1
                  `).get(internalThreadId, m.content);

              if (!pending) {
                pending = OutboundDomCorrelationService.matchPendingImageOutbound(db, internalThreadId, observedMediaKind);
              }
              if (pending) {
                const confirmed = OutboundDomCorrelationService.confirmPendingOutbound(db, io, pending, {
                  fbMessageId: m.fb_message_id,
                  tsMs,
                  tsSource,
                  rawMessage: { ...m, created_at: createdAt }
                });
                if (confirmed) {
                  console.log('[OUTBOUND_TRACE]', JSON.stringify({ stage: 'BACKEND_DOM_CORRELATED', thread_id: String(internalThreadId), client_message_id: pending.client_message_id, fb_message_id: m.fb_message_id || `dom_${pending.client_message_id}`, at: new Date().toISOString() }));
                  break;
                }
              }

              // Feature 020: Facebook sometimes assigns an outgoing message a
              // temporary, non-"mid.$" numeric fb_message_id first, then a
              // permanent "mid.$..." id on a later scan once fully confirmed.
              // The pending-match above only bridges the FIRST id-arrival (it
              // consumes the pending row, flipping it to 'sent'); the second
              // id-arrival finds no pending row left and no existing row
              // under its own id, so without this check it falls through to
              // a plain insert - a real duplicate row for the same send.
              // Recognize "already sent, same content, different id, very
              // recent" as an id upgrade and update in place instead.
               // Text rows carry a CRM client_message_id through their whole lifecycle.
               // Do not use content-based temporary-id upgrades for text:
               // two identical sends are two independent messages.
               const observedAsMedia = !!(m.media_url || (m.media_type && m.media_type !== 'text'));
               if (m.fb_message_id && observedAsMedia) {
                 const recentSent = OutboundDomCorrelationService.findTemporaryIdUpgrade(
                   db, canonicalThreadId, { ...m, timestamp_ms: tsMs, created_at: createdAt }, true
                 );
                if (recentSent) {
                  db.prepare('UPDATE messages SET fb_message_id = ? WHERE id = ?').run(m.fb_message_id, recentSent.id);
                  console.log(`[WS] Nâng cấp fb_message_id tạm ${recentSent.fb_message_id} -> ${m.fb_message_id} (id ${recentSent.id}), cùng 1 tin gửi đi`);
                  console.log('[OUTBOUND_TRACE]', JSON.stringify({ stage: 'BACKEND_DOM_ID_UPGRADED', thread_id: String(canonicalThreadId), from_fb_message_id: recentSent.fb_message_id, to_fb_message_id: m.fb_message_id, at: new Date().toISOString() }));
                  break;
                }
              }


              // Mismatch guard: exactly 1 pending in same thread within 10s, but content differs
              const recentPendings = db.prepare(`
                SELECT id, client_message_id, content FROM messages
                WHERE thread_id = ? AND is_outgoing = 1 AND delivery_status = 'pending'
                  AND datetime(created_at) >= datetime('now', '-10 seconds')
                ORDER BY id DESC
              `).all(canonicalThreadId);
              if (recentPendings.length === 1) {
                const mismatchPending = recentPendings[0];
                const pendingContent = String(mismatchPending.content || '').trim();
                const domContent = String(m.content || '').trim();
                // Only mark mismatch if DOM content looks related to the pending attempt
                // (e.g. "what" -> "whatwhat", "alo 123" -> "aloalo 123")
                // Unrelated old messages like "Long ngu" won't accidentally fail a pending "what"
                const looksLikeSameAttempt = pendingContent && domContent &&
                  (domContent.includes(pendingContent) || pendingContent.includes(domContent));
                if (looksLikeSameAttempt) {
                  console.warn(`[WS] ⚠️ COMPOSER_CONTENT_MISMATCH: pending content="${pendingContent.substring(0, 40)}" vs DOM content="${domContent.substring(0, 40)}" | thread=${canonicalThreadId}`);
                  console.log('[OUTBOUND_TRACE]', JSON.stringify({ stage: 'BACKEND_DOM_CONTENT_MISMATCH', thread_id: String(canonicalThreadId), client_message_id: mismatchPending.client_message_id, pending_len: pendingContent.length, dom_len: domContent.length, at: new Date().toISOString() }));
                  deleteOutboundMessageRows({ messageId: mismatchPending.id });
                  io.emit('MESSAGE_SEND_FAILED', { thread_id: canonicalThreadId, client_message_id: mismatchPending.client_message_id, success: false, status: 'failed', error: 'COMPOSER_CONTENT_MISMATCH', error_code: 'COMPOSER_CONTENT_MISMATCH' });
                  // Discard the mismatched DOM bubble entirely — do not insert it
                  break;
                }
              }
            }
          }
          // ===== ANTI-GHOST GUARD (chỉ áp dụng cho tin được xác nhận outgoing) =====
          // DOM observer đôi khi bắt lại tin nhắn do CRM gửi (đã có is_outgoing=1 trong DB).
          // Nếu để chạy tiếp sẽ tạo bubble ghost bên trái với is_outgoing=0.
          // Không được dùng một media outgoing bất kỳ trong 5 phút để loại một
          // media customer mới. Điều kiện cũ làm ảnh/video khách gửi biến mất
          // chỉ vì CRM vừa gửi ảnh/video trong cùng hội thoại.
          // Anti-ghost guard: (m.source === 'page_dom_observer') && isOutgoing)
          if (isTrustedOutgoingObservation && isOutgoing) {
            const isMedia = !!(m.media_url || (m.media_type && m.media_type !== 'text'));
            let outgoingMatch = null;

            if (isMedia) {
              outgoingMatch = db.prepare(`
                SELECT id, is_outgoing, delivery_status, direction_status, client_message_id, thread_id FROM messages
                WHERE thread_id = ? AND is_outgoing = 1
                  AND (attachment_id IS NOT NULL OR (media_type IS NOT NULL AND media_type != 'text'))
                  AND datetime(created_at) >= datetime('now', '-300 seconds')
                ORDER BY id DESC LIMIT 1
              `).get(canonicalThreadId);
            } else if (m.content) {
              // Echo dom_observer mang mid thật thì khớp theo mid thay vì theo
              // nội dung: khớp nội dung nuốt tin nhắn tay LẶP NỘI DUNG trong
              // 5 phút (reproduce 2026-10-09: 5 tin "alo" nhắn tay trong
              // Messenger, anti-ghost chỉ giữ lại 1). Mid thật distinct theo
              // tin; mid đã có row chính là echo của tin đó -> discard an toàn.
              // page_dom_observer/composer_confirmation giữ khớp nội dung vì
              // DOM Business Suite dùng id khác Graph API, không so được.
              const obsEchoMid = String(m.fb_message_id || '');
              const obsEchoHasRealMid = m.source === 'dom_observer' && obsEchoMid
                && !/^(?:dom_|pending_|history_)/.test(obsEchoMid)
                && !/__bubble_\d+$/.test(obsEchoMid);
              outgoingMatch = obsEchoHasRealMid
                ? db.prepare(`
                    SELECT id, is_outgoing, delivery_status, direction_status, client_message_id, thread_id FROM messages
                    WHERE thread_id = ? AND is_outgoing = 1 AND fb_message_id = ?
                    ORDER BY id DESC LIMIT 1
                  `).get(canonicalThreadId, obsEchoMid)
                : db.prepare(`
                    SELECT id, is_outgoing, delivery_status, direction_status, client_message_id, thread_id FROM messages
                    WHERE thread_id = ? AND content = ? AND is_outgoing = 1
                      AND datetime(created_at) >= datetime('now', '-300 seconds')
                    ORDER BY id DESC LIMIT 1
                  `).get(canonicalThreadId, m.content);
            }

            if (outgoingMatch) {
              console.log(`[WS] 🚫 Anti-ghost FINAL: DOM observer bắt lại tin outgoing (id=${outgoingMatch.id}, status=${outgoingMatch.delivery_status}). Discard hoàn toàn.`);
              if (outgoingMatch.delivery_status === 'pending') {
                OutboundDomCorrelationService.confirmPendingOutbound(db, io, outgoingMatch, {
                  fbMessageId: m.fb_message_id,
                  tsMs,
                  tsSource,
                  rawMessage: { ...m, created_at: createdAt }
                });
              }
              // Echo bị chặn vẫn là bằng chứng chiều: row đích đang pending
              // (Fix B) mà cứ discard thì pending kẹt vĩnh viễn vì không còn
              // observation nào tới được reconcile - confirm luôn tại đây.
              if (outgoingMatch.is_outgoing === 1 && outgoingMatch.direction_status === 'pending') {
                db.prepare("UPDATE messages SET direction_status = 'confirmed' WHERE id = ? AND direction_status = 'pending'").run(outgoingMatch.id);
                const confirmedRow = db.prepare('SELECT * FROM messages WHERE id = ?').get(outgoingMatch.id);
                io.emit('NEW_MESSAGE', withAttachmentAccessUrl({
                  ...confirmedRow,
                  thread_id: canonicalThreadId,
                  account_id: targetAccountId,
                  is_outgoing: true,
                  direction_status: 'confirmed',
                  status: confirmedRow.delivery_status || 'sent'
                }));
                console.log(`[WS] ✅ Confirm chiều outgoing cho row pending ${outgoingMatch.id} qua anti-ghost echo.`);
              }
              break;
            }
          }


          // Lưu tin nhắn vào bảng messages
          let stableMessageId = m.fb_message_id || m.client_message_id || ConversationRepository.fingerprint(m.thread_id, m);
          // Heal chiều bị bóp sai bởi history crawler: hydrate sớm (nhãn
          // lỗi thời "do Bạn gửi" + geometry degenerate + default-to-us) lưu
          // tin KHÁCH thành is_outgoing=1 (reproduce 2026-11-03). Quan sát
          // realtime sau này đọc đúng hướng vào theo avatar/vị trí - lật row
          // cùng họ id/cùng text trong cửa sổ 3 phút về phía khách.
          // member_name (tên giải từ nhãn) là bằng chứng mạnh nhất nhưng
          // thread 1-1 cá nhân KHÔNG có tên trong nhãn nên luôn rỗng
          // (reproduce 04:46:49: observed out:0 bị gate member_name khước
          // từ rồi guard phantom nuốt) -> chấp nhận quan sát không tên, CHỈ
          // cho row không mang dấu vết tin gửi từ CRM (client_message_id
          // null, không sent_by_agent, không pending): tin đi thật luôn nằm
          // bên phải nên không bao giờ được đọc là vào. Phải đứng TRƯỚC guard
          // phantom family vì guard đó nuốt đúng quan sát out:0 mà heal cần.
          const healIsIncoming = m.is_outgoing === 0 || m.is_outgoing === false;
          const healSource = String(m.source || '');
          if (healIsIncoming
            && (!m.media_type || m.media_type === 'text') && !m.media_url
            && /^(?:dom_observer|dom_history_sync|page_dom_observer)$/.test(healSource)) {
            const healThread = db.prepare('SELECT contact_name, external_thread_id, account_id FROM threads WHERE id = ?').get(m.thread_id);
            if (healThread && String(healThread.external_thread_id || '') !== String(healThread.account_id || '')) {
              const healContactClean = String(healThread.contact_name || '').replace(/\s·\s[^·]*$/, '').trim();
              const healContact = healContactClean.toLowerCase();
              const healSenderName = String(m.member_name || '').trim();
              const healLabel = healSenderName.toLowerCase();
              let healNameMatches = healSenderName.length > 0 && healContact.length >= 3 && healLabel.length >= 3
                && (healContact.includes(healLabel) || healLabel.includes(healContact));
              // Hai acc TRÙNG TÊN (1-1): nhãn "Tin nhắn do X gửi lúc" với X
              // khớp CẢ tên contact LẪN tên account đăng nhập là mơ hồ tuyệt
              // đối — heal theo tên đã lật tin vừa gõ thành tin khách ngay
              // trước mắt user (reproduce 2026-11-04 10:47: "ccxxcxc" heal
              // lật IN rồi geometry đọc phải lật ngược, UI nhấp nháy 2 đầu).
              // Thread trùng tên chỉ tin geometry quyết đoán.
              if (healNameMatches) {
                const healAccountRow = db.prepare('SELECT name FROM accounts WHERE id = ?').get(healThread.account_id);
                const healAccountName = String(healAccountRow?.name || '').trim().toLowerCase();
                if (healAccountName.length >= 3
                  && (healLabel.includes(healAccountName) || healAccountName.includes(healLabel))) {
                  syncDebug('WS_HEAL_SKIP_SAME_NAME', {
                    thread: String(m.thread_id),
                    fb_message_id: String(stableMessageId).substring(0, 70),
                    sender_label: healSenderName.slice(0, 40)
                  });
                  healNameMatches = false;
                }
              }
              // Không tên: chỉ heal khi thread 1-1 (2 phía, không tự nhắn mình)
              // và row đích không phải tin CRM gửi. ĐÒI geometry quyết đoán:
              // nhãn "Tin nhắn do X gửi lúc" với X trùng tên account là mơ hồ
              // — heal theo nhãn đã lật sai tin operator gõ tay trong Messenger
              // thành tin khách (reproduce 2026-11-03 12:09: Dkkskkss/alo).
              if (healNameMatches || (healContact.length >= 3 && !healSenderName && m.direction_evidence === 'geometry')) {
                const healFamilyId = String(stableMessageId).replace(/__bubble_\d+$/, '');
                const healLikeEscaped = healFamilyId.replace(/[_%\\]/g, (c) => `\\${c}`);
                const healRow = db.prepare(`
                  SELECT id, fb_message_id FROM messages
                  WHERE thread_id = ? AND is_outgoing = 1 AND client_message_id IS NULL
                    AND COALESCE(sent_by_agent, 0) = 0
                    AND (delivery_status IS NULL OR delivery_status NOT IN ('pending', 'sending'))
                    AND COALESCE(media_type, 'text') = 'text'
                    AND (fb_message_id = ? OR fb_message_id LIKE ? ESCAPE '\\')
                    AND TRIM(COALESCE(content, '')) = TRIM(?)
                    AND (? <= 0 OR ABS(timestamp_ms - ?) <= 180000)
                  ORDER BY id DESC LIMIT 1
                `).get(m.thread_id, healFamilyId, `${healLikeEscaped}__bubble_%`, String(m.content || ''), Number(tsMs) || 0, Number(tsMs) || 0);
                if (healRow) {
                  // Không đổ contact_name bẩn (dính nội dung tin từ sidebar)
                  // vào sender_name — để rỗng, UI hiện tên thread.
                  db.prepare(`UPDATE messages SET is_outgoing = 0, sender_role = 'customer', direction_status = 'confirmed', sender_id = 'CONTACT', sender_name = ? WHERE id = ?`).run(healSenderName || null, healRow.id);
                  syncDebug('WS_HEAL_MISLABELED_INCOMING', {
                    thread: String(m.thread_id),
                    fb_message_id: String(healRow.fb_message_id || '').slice(0, 70),
                    sender_label: (healSenderName || healContactClean || '').slice(0, 40),
                    evidence: healNameMatches ? 'member_name' : 'geometry'
                  });
                  const healedRows = db.prepare('SELECT * FROM messages WHERE thread_id = ? ORDER BY COALESCE(sequence_order, id) ASC, id ASC').all(m.thread_id);
                  io.emit('THREAD_MESSAGES_UPDATED', {
                    thread_id: m.thread_id,
                    account_id: healThread.account_id || m.account_id || ws.accountId || null,
                    messages: prepareMessagesForClient(healedRows),
                    authoritative: true
                  });
                  break;
                }
              }
            }
          }
          // Phantom family __bubble_N: id tổng hợp mid.X__bubble_N nhưng row
          // base mid.X cùng thread tồn tại với nội dung giống nhau. Like-group
          // thật ở cùng article nên cùng người gửi (không bao giờ lật hướng),
          // còn pending thật luôn được xác nhận bằng mid riêng vài giây sau.
          // Base tồn tại + cùng nội dung = CÙNG một lá vật lý -> bỏ qua mọi
          // biến thể quan sát:
          //  - quan sát ĐẾN nhưng base là tin ĐI (hoặc ngược lại) -> phantom
          //    lật chiều (reproduce 2026-10-08: "nhắn gì đó"/"allo"/"alo" của
          //    operator hiện thêm bản sao bên trái khách);
          //  - cùng hướng nhưng base cũ hơn 60s -> pending bị gán nhầm anchor
          //    cũ (reproduce 18:33: alo tái dùng mid 10/06) - bản thật sẽ tự
          //    vào DB bằng mid riêng;
          //  - K1 (2026-11-04): cùng hướng + ts sát nhau cũng phải bỏ qua -
          //    trước đây nhánh này lọt xuống INSERT OR IGNORE với id __bubble_N
          //    và sinh row nhân đôi khi sweep lại hội thoại cũ (reproduce
          //    2026-11-04 01:59: 9 row mid.$X__bubble_1 nhân bản block tin
          //    thread 100004449999465; anti-ghost không chặn được vì base đã
          //    cũ 16h, quá cửa sổ khớp echo).
          if (/__bubble_\d+$/.test(String(stableMessageId))
            && (!m.media_type || m.media_type === 'text') && !m.media_url
            && !/^(?=[\s\S]*\p{Extended_Pictographic})[\p{Extended_Pictographic}\uFE0F\u200D\s]+$/u.test(String(m.content || ''))) {
            const bubbleFamilyId = String(stableMessageId).replace(/__bubble_\d+$/, '');
            const bubbleBaseRow = bubbleFamilyId.length >= 12
              ? db.prepare(`
                  SELECT id, content, is_outgoing, timestamp_ms, client_message_id, sent_by_agent, delivery_status FROM messages
                  WHERE thread_id = ? AND (fb_message_id = ? OR fb_message_id LIKE '%.' || ?)
                  ORDER BY id DESC LIMIT 1
                `).get(m.thread_id, bubbleFamilyId, bubbleFamilyId)
              : null;
            if (bubbleBaseRow
              && String(bubbleBaseRow.content || '').trim() === String(m.content || '').trim()) {
              // K1 (2026-11-04): base tồn tại + cùng nội dung = CÙNG một lá
              // vật lý -> bỏ qua MỌI biến thể quan sát (lật chiều, anchor cũ
              // >60s, re-render cùng hướng ts sát). Trước đây cùng hướng + ts
              // sát lọt xuống INSERT OR IGNORE và sinh row nhân đôi khi sweep
              // lại hội thoại cũ (reproduce 2026-11-04 01:59: 9 row
              // mid.$X__bubble_1 nhân bản block tin thread 100004449999465).
              if (Number(bubbleBaseRow.is_outgoing) !== (isOutgoing ? 1 : 0)
                && m.direction_evidence === 'geometry'
                && /^mid\./.test(bubbleFamilyId)
                && (bubbleBaseRow.client_message_id === null || bubbleBaseRow.client_message_id === '')
                && Number(bubbleBaseRow.sent_by_agent || 0) === 0
                && (bubbleBaseRow.delivery_status === null || !['pending', 'sending'].includes(String(bubbleBaseRow.delivery_status)))) {
                // Quan sát geometry quyết đoán (bong bóng rõ một bên) sửa chiều
                // row gốc không dấu vết CRM — cả hai hướng. Không có lối này,
                // lần heal/đọc sai trước bị "khóa" vĩnh viễn: mọi reading đúng
                // sau đó bị guard này nuốt (reproduce 2026-11-03 12:09: heal lật
                // sai Dkkskkss/alo rồi reading out=1 đúng bị SKIP như phantom).
                db.prepare(`
                  UPDATE messages SET is_outgoing = ?, sender_role = ?,
                    direction_status = 'confirmed', sender_id = ?
                  WHERE id = ?
                `).run(isOutgoing ? 1 : 0, isOutgoing ? 'operator' : 'customer',
                  isOutgoing ? safeSenderId : 'CONTACT', bubbleBaseRow.id);
                syncDebug('WS_GEOMETRY_DIRECTION_FIX', {
                  thread: m.thread_id,
                  fb_message_id: String(stableMessageId).substring(0, 70),
                  base_outgoing: Number(bubbleBaseRow.is_outgoing),
                  observed_outgoing: isOutgoing ? 1 : 0
                });
                io.emit('THREAD_MESSAGES_UPDATED', {
                  thread_id: m.thread_id,
                  account_id: targetAccountId || threadAccountId || m.account_id || ws.accountId || null
                });
                break;
              }
              syncDebug('WS_SKIP_BUBBLE_FAMILY_PHANTOM', {
                thread: m.thread_id,
                fb_message_id: String(stableMessageId).substring(0, 70),
                base_outgoing: Number(bubbleBaseRow.is_outgoing),
                observed_outgoing: isOutgoing ? 1 : 0,
                ts_delta_ms: Math.abs(Number(tsMs || 0) - Number(bubbleBaseRow.timestamp_ms || 0))
              });
              break;
            }
          }
          // Otid thuần số + out=0: otid do client MÌNH sinh khi gửi (top 41
          // bit = ms gửi thật - đo DB sống (id>>22) khớp giây gửi); tin khách
          // đến qua server luôn mang <uid>@msgr.N hoặc mid.$. Id số trần
          // tuyên bố incoming chỉ có thể là nhãn "Tin nhắn do X gửi lúc"
          // gán nhầm anchor cho lá tin mình (reproduce 2026-10-09: "sdsdsd"
          // nhắn tay hiện thêm bản sao bên trái khách; DB 5/5 row số+out=0
          // đều là tin user tự gõ). Mid rút gọn của khách đã được ghép về
          // dạng đầy đủ ở trên nên không dính guard này.
          const otidFamilyId = String(stableMessageId).replace(/__bubble_\d+$/, '');
          if (!isOutgoing && /^\d{15,19}$/.test(otidFamilyId)
            && (!m.media_type || m.media_type === 'text') && !m.media_url) {
            syncDebug('WS_SKIP_OTID_FLIPPED', {
              thread: m.thread_id,
              fb_message_id: String(stableMessageId).substring(0, 70)
            });
            break;
          }
          if (!isOutgoing && m.fb_message_id) {
            const promotedPreview = ConversationRepository.promoteSidebarPreview({
              threadId: m.thread_id,
              fbMessageId: m.fb_message_id,
              content: m.content,
              isOutgoing: false
            }, db);
            if (promotedPreview) stableMessageId = promotedPreview.fbMessageId;
          }
          // Cùng bong bóng vật lý quét lại với __bubble_N TRÔI (số bong bóng
          // hydrate đằng trước đổi giữa các pass -> bubble_idx đổi -> id đổi)
          // khiến UNIQUE(fb_message_id) mù và tin lặp 2 lần. Cùng family mid
          // gốc + cùng nội dung + cùng chiều trong thread = chính tin đã lưu
          // (reproduce 2026-10-15: "ý à là khách hàng..." đôi
          // jGrG__bubble_2 + __bubble_3 trong thread Hai Anh). Bỏ qua cả hai
          // chiều trôi (suffix->thuần và thuần->suffix); id khớp EXACT thì
          // để luồng INSERT IGNORE/squat-heal phía dưới xử lý như cũ.
          const existingStableMessage = db.prepare('SELECT id FROM messages WHERE fb_message_id = ?').get(stableMessageId);
          if (!existingStableMessage && !m.client_message_id) {
            const driftFamilyId = String(stableMessageId).replace(/__bubble_\d+$/, '');
            const likeEscaped = driftFamilyId.replace(/[_%]/g, (c) => `\\${c}`);
            const driftGhostRow = db.prepare(`
              SELECT id FROM messages
              WHERE thread_id = ?
                AND (fb_message_id = ? OR fb_message_id LIKE ? ESCAPE '\\')
                AND TRIM(content) = TRIM(?)
                AND is_outgoing = ?
              LIMIT 1
            `).get(m.thread_id, driftFamilyId, `${likeEscaped}__bubble_%`, m.content || '', isOutgoing ? 1 : 0);
            if (driftGhostRow) {
              // Quét lại với id TRÔI vẫn mang khối quote: bơm thẳng vào row
              // đã lưu thay vì bỏ lỡ backfill quote của tin reply cũ (luồng
              // exact-id hiếm khi lặp lại sau khi row đã tồn tại).
              const driftIncomingQuote = m.reply_quote_text ? String(m.reply_quote_text).trim().slice(0, 500) : '';
              if (driftIncomingQuote) {
                try {
                  db.prepare(
                    "UPDATE messages SET reply_to_text = COALESCE(NULLIF(TRIM(COALESCE(reply_to_text, '')), ''), ?) WHERE id = ?"
                  ).run(driftIncomingQuote, driftGhostRow.id);
                  storeReplyTargetForRow(driftGhostRow.id, m.thread_id, driftIncomingQuote, null);
                } catch (driftQuoteError) {
                  console.warn('[WS] Backfill quote qua drift guard thất bại:', driftQuoteError.message);
                }
              }
              syncDebug('WS_SKIP_BUBBLE_INDEX_DRIFT_GHOST', {
                thread: m.thread_id,
                fb_message_id: String(stableMessageId).substring(0, 70),
                family: driftFamilyId.substring(0, 70)
              });
              break;
            }
          }
          const sequenceRow = db.prepare(`
            SELECT MAX(COALESCE(sequence_order, id)) AS max_sequence
            FROM messages WHERE thread_id = ?
          `).get(m.thread_id);
          let realtimeSequence = Number(sequenceRow?.max_sequence || 0) + 1;
          // Mutation callbacks may arrive in a different order from the visual
          // Messenger rows. Reserve the confirmed DOM slot before inserting so
          // both the live UI and later database snapshots keep the same order.
          if (!existingStableMessage && m.dom_position_confirmed) {
            const previousRow = m.dom_previous_message_id
              ? db.prepare('SELECT COALESCE(sequence_order, id) AS sequence_order FROM messages WHERE thread_id = ? AND fb_message_id = ?').get(m.thread_id, m.dom_previous_message_id)
              : null;
            const nextRow = m.dom_next_message_id
              ? db.prepare('SELECT COALESCE(sequence_order, id) AS sequence_order FROM messages WHERE thread_id = ? AND fb_message_id = ?').get(m.thread_id, m.dom_next_message_id)
              : null;
            let targetSequence = null;
            if (nextRow && Number.isFinite(Number(nextRow.sequence_order))) {
              targetSequence = Number(nextRow.sequence_order);
            } else if (previousRow && Number.isFinite(Number(previousRow.sequence_order))) {
              const followingRow = db.prepare(`
                SELECT MIN(COALESCE(sequence_order, id)) AS sequence_order
                FROM messages WHERE thread_id = ? AND COALESCE(sequence_order, id) > ?
              `).get(m.thread_id, Number(previousRow.sequence_order));
              targetSequence = Number.isFinite(Number(followingRow?.sequence_order))
                ? Number(followingRow.sequence_order)
                : Number(previousRow.sequence_order) + 1;
            }
            if (Number.isFinite(targetSequence) && targetSequence > 0) {
              db.prepare(`
                UPDATE messages SET sequence_order = COALESCE(sequence_order, id) + 1
                WHERE thread_id = ? AND COALESCE(sequence_order, id) >= ?
              `).run(m.thread_id, targetSequence);
              realtimeSequence = targetSequence;
            }
          }
          let insertMsgResult = db.prepare(`
            INSERT OR IGNORE INTO messages
              (thread_id, fb_message_id, sender_id, sender_name, content, media_type, media_url, local_media_path, is_outgoing, direction_status, sequence_order, timestamp_ms, timestamp_source, created_at, reply_to_text)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(m.thread_id, stableMessageId, safeSenderId,
            !isOutgoing ? (String(m.member_name || '').trim() || null) : null,
            m.content,
            m.media_type || 'text', m.media_url, m.local_media_path, isOutgoing, directionStatus, realtimeSequence, tsMs, tsSource, createdAt,
            m.reply_quote_text ? String(m.reply_quote_text).slice(0, 500) : null);

          // Multi-account: cùng một tin vật lý được mọi tab acc đăng nhập quan
          // sát với CÙNG mid, nhưng UNIQUE(fb_message_id) toàn cục chỉ cho một
          // thread giữ row — tab forward sau bị IGNORE câm và hội thoại bên
          // acc kia mất tin (reproduce 2026-10-08 18:09: 2/3 "alo" giữa 2 acc
          // chỉ còn ở thread acc khách). Bản sao cho thread này dùng id suy
          // dẫn deterministic (mid::thread) để lần quét sau vẫn khớp row cũ.
          if (insertMsgResult.changes === 0) {
            const midOwnerRow = db.prepare('SELECT thread_id FROM messages WHERE fb_message_id = ?').get(stableMessageId);
            if (midOwnerRow && midOwnerRow.thread_id !== m.thread_id) {
              const mirrorMessageId = `${stableMessageId}::${m.thread_id}`;
              insertMsgResult = db.prepare(`
                INSERT OR IGNORE INTO messages
                  (thread_id, fb_message_id, sender_id, sender_name, content, media_type, media_url, local_media_path, is_outgoing, direction_status, sequence_order, timestamp_ms, timestamp_source, created_at, reply_to_text)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `).run(m.thread_id, mirrorMessageId, safeSenderId,
                !isOutgoing ? (String(m.member_name || '').trim() || null) : null,
                m.content,
                m.media_type || 'text', m.media_url, m.local_media_path, isOutgoing, directionStatus, realtimeSequence, tsMs, tsSource, createdAt,
                m.reply_quote_text ? String(m.reply_quote_text).slice(0, 500) : null);
              stableMessageId = mirrorMessageId;
              if (insertMsgResult.changes > 0) {
                syncDebug('WS_MIRROR_CROSS_ACCOUNT', {
                  thread: m.thread_id,
                  owner_thread: midOwnerRow.thread_id,
                  fb_message_id: String(mirrorMessageId).substring(0, 70)
                });
              }
            }
          }

          // Row ma lật chiều SINH TRƯỚC base có thể đã chiếm đứt id tổng hợp
          // mid.$X__bubble_N (guard b54 cần base tồn tại, sweep b58 chỉ chạy
          // khi base đổ vào - base chưa từng vào DB thì không gì dọn). Reading
          // THẬT sau này quay lại với CÙNG id nhưng chiều khác: reading sau
          // hydrate đủ label tin cậy hơn, sửa chiều row squat thay vì để
          // INSERT OR IGNORE nuốt câm tin thật (reproduce 2026-10-09 12:00:
          // bắn 4 "alo" chỉ 1 vào DB, row ma mid.$UE5vv__bubble_1 out=0 đứng
          // yên). Chỉ flip IN->OUT trên row squat sinh trong 15 phút; chiều
          // ngược lại bị reconcileExistingMessage chặn cứng như cũ.
          if (insertMsgResult.changes === 0 && /__bubble_\d+$/.test(String(stableMessageId))) {
            const squatterRow = db.prepare(`
              SELECT id, is_outgoing FROM messages
              WHERE fb_message_id = ? AND thread_id = ?
                AND datetime(created_at) >= datetime('now', '-900 seconds')
            `).get(stableMessageId, m.thread_id);
            if (squatterRow
              && Number(squatterRow.is_outgoing) === 0
              && isOutgoing && directionStatus === 'confirmed') {
              db.prepare(`
                UPDATE messages SET is_outgoing = 1, sender_role = 'operator',
                  direction_status = 'confirmed', sender_id = ?
                WHERE id = ?
              `).run(safeSenderId, squatterRow.id);
              syncDebug('WS_FIX_FLIPPED_SQUATTER', {
                thread: m.thread_id,
                fb_message_id: String(stableMessageId).substring(0, 70)
              });
              // Nhánh !wasNewMessage phía dưới sẽ break ở reconcile no_change
              // nên phải tự báo client vẽ lại thread ngay.
              io.emit('THREAD_MESSAGES_UPDATED', {
                thread_id: m.thread_id,
                account_id: targetAccountId || threadAccountId || m.account_id || ws.accountId || null
              });
            }
          }

          let wasNewMessage = insertMsgResult.changes > 0;
          // Tin reply mới: nối tới tin gốc (id + tên) để UI hiện tên người
          // được trả lời và click quote lướt tới tin gốc.
          if (wasNewMessage && m.reply_quote_text) {
            storeReplyTargetForRow(Number(insertMsgResult.lastInsertRowid), m.thread_id, m.reply_quote_text, tsMs);
          }
          if (wasNewMessage) {
            // Row ma lật chiều có thể đã chèn TRƯỚC base trong cùng đợt quét
            // (guard phía trên cần base đã tồn tại) - base vừa đổ vào thì dọn
            // ngay sibling __bubble_N cùng family khác hướng.
            try {
              const healedFlipCount = ConversationRepository.collapseFlippedBubbleSiblings(m.thread_id, stableMessageId, m.content, db);
              if (healedFlipCount > 0) {
                syncDebug('WS_HEAL_FLIPPED_BUBBLE_SIBLING', {
                  thread: m.thread_id,
                  fb_message_id: String(stableMessageId).substring(0, 70),
                  healed: healedFlipCount
                });
              }
            } catch (sweepError) {
              console.warn('[WS] Flipped bubble sibling sweep failed:', sweepError.message);
            }
          }
          if (wasNewMessage && !String(stableMessageId).endsWith('_media')) {
            try {
              // A media companion can be observed before the base native row.
              // Collapse it immediately once the parent exists.
              OutboundDomCorrelationService.collapseStoredMediaCompanions(db, m.thread_id);
            } catch (collapseError) {
              console.warn('[WS] Deferred media companion collapse:', collapseError.message);
            }
          }
          if (wasNewMessage) {
            // Tin mới chèn theo anchor DOM có thể rơi sai ngày (tin 16/9 được
            // quét lại hôm nay bị gắn seq cuối thread). Chuẩn hóa lại ngay
            // theo timestamp để DB không giữ thứ tự sai tới lần GET tiếp theo.
            try {
              ConversationRepository.normalizeMessageSequence(m.thread_id, db);
            } catch (normalizeError) {
              console.warn('[WS] Normalize sequence sau insert thất bại:', normalizeError.message);
            }
          }
          let directionWasUpdated = false;

          let mediaWasUpdated = false;

          let replyWasUpdated = false;

          if (!wasNewMessage) {
            // Messenger often mounts a video row before its durable URL/poster
            // is hydrated. Enrich the same native id instead of discarding it.
            const existingMedia = db.prepare(
              'SELECT media_type, media_url, local_media_path, content FROM messages WHERE fb_message_id = ?'
            ).get(stableMessageId);
            const incomingMediaType = String(m.media_type || 'text');
            const hasIncomingMedia = incomingMediaType !== 'text';
            const hasRicherMedia = Boolean(existingMedia && hasIncomingMedia && (
              !existingMedia.media_type || existingMedia.media_type === 'text' ||
              (!existingMedia.media_url && m.media_url) ||
              (!existingMedia.local_media_path && m.local_media_path)
            ));
            if (hasRicherMedia) {
              const mediaUpdate = db.prepare(`
                UPDATE messages SET
                  media_type = ?,
                  media_url = COALESCE(NULLIF(?, ''), media_url),
                  local_media_path = COALESCE(NULLIF(?, ''), local_media_path),
                  content = CASE
                    WHEN COALESCE(content, '') = '' AND COALESCE(?, '') != '' THEN ?
                    ELSE content
                  END
                WHERE fb_message_id = ?
              `).run(incomingMediaType, m.media_url || null, m.local_media_path || null,
                m.content || null, m.content || null, stableMessageId);
              mediaWasUpdated = mediaUpdate.changes > 0;
            }
            // Row đã lưu trước khi có tính năng đồng bộ trả lời: backfill quote
            // khi lần quan sát sau mang kèm khối trích dẫn (giữ quote cũ nếu
            // đã có - COALESCE tránh ghi đè bằng rỗng).
            const incomingQuote = m.reply_quote_text ? String(m.reply_quote_text).trim().slice(0, 500) : '';
            if (incomingQuote) {
              try {
                const quoteUpdate = db.prepare(
                  'UPDATE messages SET reply_to_text = COALESCE(NULLIF(TRIM(COALESCE(reply_to_text, \'\')), \'\'), ?) WHERE fb_message_id = ?'
                ).run(incomingQuote, stableMessageId);
                replyWasUpdated = quoteUpdate.changes > 0;
                if (replyWasUpdated) {
                  const quoteTargetRow = db.prepare('SELECT id, timestamp_ms FROM messages WHERE fb_message_id = ?').get(stableMessageId);
                  if (quoteTargetRow) storeReplyTargetForRow(quoteTargetRow.id, m.thread_id, incomingQuote, quoteTargetRow.timestamp_ms);
                }
              } catch (quoteError) {
                console.warn('[WS] Backfill reply quote thất bại:', quoteError.message);
              }
            }
            // Tin đã tồn tại: nhờ ConversationRepository quyết định có cần nâng cấp
            // timestamp/is_outgoing không (logic dùng chung, có test riêng).
            const reconcile = ConversationRepository.reconcileExistingMessage(
              stableMessageId,
              {
                source: m.source,
                isOutgoing: directionStatus === 'pending' ? null : isOutgoing,
                direction_status: directionStatus,
                direction_confidence: m.direction_confidence,
                directionEvidence: m.direction_evidence || null,
                senderName: m.sender_name || null,
                tsMs,
                tsSource,
                createdAt
              },
              db
            );
            if (reconcile.reason === 'not_found') {
              break; // Duplicate vì client_message_id hoặc lý do khác
            }
            if (!reconcile.updated && !mediaWasUpdated) {
              console.log(`[WS] Bỏ qua tin nhắn đã tồn tại (fb_message_id: ${m.fb_message_id})`);
              break;
            }
            if (reconcile.timestampUpdated) {
              console.log(`[WS] ⏳ Nâng cấp Timestamp Rank cho fb_message_id ${m.fb_message_id}: ${reconcile.previousTimestampSource} -> ${tsSource}`);
            }
            if (reconcile.directionUpdated) {
              directionWasUpdated = true;
              syncDebug('WS_DIRECTION_UPDATED', {
                thread: String(m.thread_id),
                fb_message_id: String(m.fb_message_id || '').substring(0, 70),
                from: reconcile.previousIsOutgoing ? 1 : 0,
                to: isOutgoing ? 1 : 0,
                evidence: m.direction_evidence || null,
                source: m.source || null
              });
              console.log('[WS] Direction updated for message ' + m.fb_message_id + ': ' + (reconcile.previousIsOutgoing ? 1 : 0) + ' -> ' + (isOutgoing ? 1 : 0));
            }
            // Direction promotion is emitted so an already-open CRM thread can
            // move the bubble without inserting a duplicate message.
          }

          if (wasNewMessage || directionWasUpdated || mediaWasUpdated || replyWasUpdated) {
            const earlyPersistedMessage = db.prepare('SELECT * FROM messages WHERE fb_message_id = ?').get(stableMessageId);
            // Link share bi Messenger unfurl thanh tin media rieng (video/image
            // khong co noi dung) -> xoa tin link-text vua gui truoc do (cung
            // thread, <=3 phut, noi dung chi la URL) de khong hien 2 bong bong
            // cho cung mot noi dung (reproduced 2026-09-18).
            try {
              const newMt = String(earlyPersistedMessage.media_type || '').toLowerCase();
              const newContent = String(earlyPersistedMessage.content || '').trim();
              const newOutgoing = Number(earlyPersistedMessage.is_outgoing) === 1;
              if (newOutgoing && newMt === 'video' && !newContent) {
                // Tin unfurl gồm CẢ video row (rỗng content) LẪN image rows
                // mang content = link (media_type='image') - xóa TẤT CẢ tin
                // trước đó ≤3 phút có content là link, mọi media_type.
                const linkRows = db.prepare(`
                  SELECT id FROM messages
                  WHERE thread_id = ? AND is_outgoing = 1 AND content LIKE 'http%'
                    AND id != ?
                    AND datetime(created_at) >= datetime('now', '-3 minutes')
                  ORDER BY id DESC LIMIT 6
                `).all(earlyPersistedMessage.thread_id, earlyPersistedMessage.id);
                if (linkRows.length) {
                  // Chuyển URL của tin link vào tin media (bubble = ảnh/video +
                  // dòng link bấm được bên dưới), rồi xóa tin link trùng.
                  const keepUrl = String(linkRows[0].content || '').trim();
                  db.prepare('UPDATE messages SET content = ? WHERE id = ?').run(keepUrl, earlyPersistedMessage.id);
                  const delStmt = db.prepare('DELETE FROM messages WHERE id = ?');
                  for (const lr of linkRows) delStmt.run(lr.id);
                  io.emit('THREAD_MESSAGES_UPDATED', { thread_id: earlyPersistedMessage.thread_id, account_id: targetAccountId || threadAccountId || m.account_id || ws.accountId || null });
                  console.log(`[LINK_MERGE] Unfurl: đã gộp ${linkRows.length} tin link, chuyển URL vào media #${earlyPersistedMessage.id}`);
                }
              }
            } catch (_) {}
            const earlyThread = db.prepare(`
              SELECT t.id, t.external_thread_id, t.account_id, t.contact_name, c.avatar_url,
                     t.last_message, t.last_activity, t.is_unread, t.inbox_folder, t.source_id
              FROM threads t
              LEFT JOIN contacts c ON c.thread_id = t.id
              WHERE t.id = ?
            `).get(earlyPersistedMessage?.thread_id || canonicalThreadId || m.thread_id);
            if (earlyPersistedMessage) {
              io.emit('NEW_MESSAGE', {
                ...m,
                ...earlyPersistedMessage,
                account_id: targetAccountId || threadAccountId || m.account_id || ws.accountId || null,
                // Avatar thành viên nhóm đi trong member_avatar (payload observer)
                // - map sang field client MessageBubble đang đọc để bubble mới
                // hiện avatar ngay, không chờ đợt refetch sau khi tải file local.
                sender_avatar: m.member_avatar || undefined,
                timestamp_ms: tsMs,
                timestamp_source: tsSource,
                created_at: createdAt,
                is_outgoing: !!isOutgoing,
                direction_status: directionStatus,
                thread_summary: earlyThread || null
              });
              realtimeMessageEmittedEarly = true;
            }
          }
          // Update contact name if provided and not yet properly set
          if (m.contact_name && !isInvalidContactName(m.contact_name)) {
            const cleanName = m.contact_name.trim();
            const existing = db.prepare('SELECT contact_name FROM threads WHERE id = ?').get(m.thread_id);
            if (!existing || isInvalidContactName(existing.contact_name) || (existing.contact_name || '').startsWith('Khách hàng')) {
              db.prepare('UPDATE threads SET contact_name = ? WHERE id = ?').run(cleanName, m.thread_id);
              db.prepare(`
                INSERT INTO contacts (thread_id, name)
                VALUES (?, ?)
                ON CONFLICT(thread_id) DO UPDATE SET name = excluded.name
              `).run(m.thread_id, cleanName);
              io.emit('CONTACT_UPDATED', { thread_id: m.thread_id, name: cleanName });
            }
          }

          // Avatar backfill: apply regardless of whether this message is a brand-new
          // insert or a re-scan of an existing one, so a thread whose messages were
          // already stored before contact-avatar extraction existed still gets
          // corrected.
          const avatarData = m.avatar_base64 || m.avatar_url || m.contact_avatar || '';
          if (avatarData) {
            const existingContact = db.prepare('SELECT avatar_url FROM contacts WHERE thread_id = ?').get(m.thread_id);
            if (!existingContact || !existingContact.avatar_url) {
              try {
                const localAvatarPath = await saveAvatarFromBase64OrUrl(avatarData, m.thread_id);
                if (localAvatarPath) {
                  const avatarResult = ConversationRepository.setContactAvatarIfMissing(m.thread_id, m.contact_name, localAvatarPath, db);
                  if (avatarResult.updated) {
                    io.emit('CONTACT_UPDATED', { thread_id: m.thread_id, avatar_url: localAvatarPath });
                  }
                }
              } catch (err) {
                console.warn('[WS] Avatar save failed:', err.message);
              }
            }
          }

          // Avatar thành viên NHÓM: tin đến kèm member_avatar (URL avatar nhỏ
          // cạnh bubble trong DOM). Tải nền, không chặn emit tin - client mở
          // thread sẽ refetch qua ping THREAD_MESSAGES_UPDATED khi file xong.
          const memberNameForAvatar = (!isOutgoing && String(m.member_name || '').trim()) || '';
          const memberAvatarData = memberNameForAvatar && String(m.member_avatar || '').startsWith('http')
            ? String(m.member_avatar)
            : '';
          if (memberNameForAvatar && memberAvatarData) {
            const hadMemberAvatar = !!db.prepare(
              'SELECT avatar_url FROM message_sender_avatars WHERE thread_id = ? AND sender_name = ?'
            ).get(m.thread_id, memberNameForAvatar)?.avatar_url;
            if (!hadMemberAvatar) {
              upsertMemberAvatar(m.thread_id, memberNameForAvatar, memberAvatarData).then((savedPath) => {
                if (savedPath) {
                  syncDebug('WS_MEMBER_AVATAR_SAVED', {
                    thread: m.thread_id,
                    sender_name: memberNameForAvatar
                  });
                  // Client chỉ merge messages kèm theo event này (không refetch
                  // REST) - phải emit lại snapshot enriched thì bubble đang mở
                  // mới đổi sang avatar thành viên vừa tải.
                  const refreshedRows = db.prepare(`
                    SELECT * FROM messages WHERE thread_id = ?
                    ORDER BY COALESCE(sequence_order, id) ASC, id ASC
                  `).all(m.thread_id);
                  io.emit('THREAD_MESSAGES_UPDATED', {
                    thread_id: m.thread_id,
                    account_id: targetAccountId || threadAccountId || m.account_id || ws.accountId || null,
                    messages: prepareMessagesForClient(refreshedRows)
                  });
                }
              });
            }
          }

          if (!wasNewMessage && !directionWasUpdated && !mediaWasUpdated) break; // Ignore a replay with no persisted change.
          if (wasNewMessage) ConversationRepository.touchThread(m.thread_id, m.content);

          // Auto Lead Extraction (avatar handled above, applies regardless of wasNewMessage)
          if (wasNewMessage && isConfirmedIncoming && m.content) {
            const { emails } = extractLeadInfo(m.content);
            if (emails.length > 0) {
              db.prepare(`
                INSERT INTO contacts (thread_id, name, email)
                VALUES (?, ?, ?)
                ON CONFLICT(thread_id) DO UPDATE SET
                  email = COALESCE(NULLIF(excluded.email,''), contacts.email)
              `).run(m.thread_id, m.contact_name || 'Khách hàng', emails[0] || null);
            }

            // Phone capture (spec 035): exact-prefix detection, immutable
            // evidence per candidate, fill-only contact phone (never
            // overwrites a manual/legacy/already-selected value). Runs
            // independently of email extraction above.
            const { threadId: capturedThreadId, createdCaptures } = PhoneCaptureService.processIncomingMessage({
              threadId: m.thread_id,
              accountId: targetAccountId,
              messageId: stableMessageId,
              content: m.content,
              messageTimestampMs: tsMs
            }, { database: db });

            if (emails.length > 0 || createdCaptures.length > 0) {
              // Kept additive/compatible with any existing LEAD_EXTRACTED
              // consumer - phones here are normalized capture values, not
              // raw regex matches.
              io.emit('LEAD_EXTRACTED', {
                thread_id: m.thread_id,
                phones: createdCaptures.map((c) => c.normalized_phone),
                emails
              });
            }
            if (createdCaptures.length > 0) {
              // Publish campaign phone statistics immediately after durable
              // capture. Campaign automation below may wait for Messenger
              // acknowledgement and must not hold the statistics UI hostage.
              const capturedMessage = db.prepare('SELECT id FROM messages WHERE fb_message_id = ?').get(stableMessageId);
              if (capturedMessage?.id) {
                const immediateCampaignResponse = CampaignResponseStatsService.recordIncomingResponse({
                  messageId: capturedMessage.id,
                  threadId: m.thread_id,
                  accountId: targetAccountId || threadAccountId || null,
                  observedAtMs: tsMs || Date.parse(createdAt) || Date.now()
                }, db);
                if (immediateCampaignResponse) {
                  io.emit('CAMPAIGN_RESPONSE_UPDATED', {
                    ...immediateCampaignResponse,
                    thread_id: m.thread_id,
                    phone_captured: true
                  });
                }
              }

              // Global CRM rule is opt-in and applies to every genuine incoming
              // capture. A configured campaign policy runs immediately after it
              // and is the explicit per-campaign override when it has a target.
              const globalPhoneAutomation = GlobalPhoneAutomationService.applyCaptures(capturedThreadId, createdCaptures, db);
              if (globalPhoneAutomation.applied) {
                console.log(`[PhoneCapture] Global automation applied status ${globalPhoneAutomation.settings.status_id} for ${capturedThreadId}`);
              }

              // Includes the fully-resolved contact phone view so the
              // frontend can merge it directly without a round-trip fetch -
              // it needs this regardless of which thread is active, so the
              // background cache stays correct for whenever the operator
              // switches to it (contracts/phone-capture.md's contact payload shape).
              const phoneView = PhoneCaptureService.getContactPhoneView(capturedThreadId, db);
              io.emit('PHONE_CAPTURED', {
                thread_id: capturedThreadId,
                captures: createdCaptures.map((c) => ({
                  id: c.id,
                  normalized_phone: c.normalized_phone,
                  raw_phone: c.raw_phone,
                  message_id: c.message_id,
                  message_timestamp_ms: c.message_timestamp_ms,
                  selection_state: c.selection_state
                })),
                phone: phoneView.phone,
                phone_source: phoneView.phone_source,
                phone_captured_at: phoneView.phone_captured_at,
                phone_capture: phoneView.phone_capture,
                phone_candidates: phoneView.phone_candidates
              });
              io.emit('CONTACT_UPDATED', { thread_id: capturedThreadId });

              // Campaign phone-capture policy (spec 035) - runs after the
              // capture is durably saved and broadcast, per the contract
              // ("invoke campaign reaction only after durable capture").
              // Awaited: thank_then_stop waits for its acknowledgement to
              // settle before stopping remaining work, so this can take up
              // to the poll timeout - acceptable here since it only runs for
              // the (rare) capture-bearing message, not every message.
              try {
                const affectedCampaignIds = await CampaignPhoneCaptureService.handleCaptures(capturedThreadId, createdCaptures, {
                  database: db,
                  capabilityOptions: getRichMessageCapabilityOptions()
                });
                for (const campaignId of affectedCampaignIds) {
                  CampaignEventService.emit(io, CampaignRepository.getCampaign(campaignId, db));
                }
                // Emit one authoritative post-policy view. The earlier
                // PHONE_CAPTURED event makes the number feel instant; this
                // complete patch is what makes every active panel, sidebar
                // chip and status filter converge after policy handling.
                const updatedContact = db.prepare(`
                  SELECT c.phone, c.phone_source, c.phone_captured_at,
                         c.status_id, ls.name AS status_name, ls.color AS status_color
                  FROM contacts c LEFT JOIN lead_statuses ls ON ls.id = c.status_id
                  WHERE c.thread_id = ?
                `).get(capturedThreadId);
                io.emit('CONTACT_UPDATED', { thread_id: capturedThreadId, ...updatedContact });
              } catch (err) {
                console.error('[PhoneCapture] Campaign policy application failed:', err.message);
              }
            }
          }

          if (wasNewMessage && isConfirmedIncoming) {
            followupService.restoreOnIncoming(m.thread_id);
          }

          // Emit payload đầy đủ lên frontend
          const persistedMessage = db.prepare('SELECT * FROM messages WHERE fb_message_id = ?').get(stableMessageId);
          if (wasNewMessage && isConfirmedIncoming && persistedMessage?.id) {
            const campaignResponse = CampaignResponseStatsService.recordIncomingResponse({
              messageId: persistedMessage.id,
              threadId: m.thread_id,
              accountId: targetAccountId || threadAccountId || null,
              observedAtMs: tsMs || Date.parse(createdAt) || Date.now()
            }, db);
            if (campaignResponse) {
              io.emit('CAMPAIGN_RESPONSE_UPDATED', {
                ...campaignResponse,
                thread_id: m.thread_id
              });
            }
          }
          const realtimeThread = db.prepare(`
            SELECT t.id, t.external_thread_id, t.account_id, t.contact_name, c.avatar_url,
                   t.last_message, t.last_activity, t.is_unread, t.inbox_folder, t.source_id
            FROM threads t
            LEFT JOIN contacts c ON c.thread_id = t.id
            WHERE t.id = ?
          `).get(persistedMessage?.thread_id || canonicalThreadId || m.thread_id);
          if (realtimeMessageEmittedEarly) {
            // The durable row was already published immediately after insert.
            // Keep the later enrichment/automation path from emitting it twice.
            if (msg.outbox_id && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                type: 'BACKEND_OUTBOX_ACK',
                data: { outbox_id: String(msg.outbox_id) }
              }));
            }
            break;
          }
          const msgPayload = {
            ...m,
            ...(persistedMessage || {}),
            account_id: targetAccountId || threadAccountId || m.account_id || ws.accountId || null,
            timestamp_ms: tsMs,
            timestamp_source: tsSource,
            created_at: createdAt,
            is_outgoing: !!isOutgoing,
            direction_status: directionStatus,
            thread_summary: realtimeThread || null
          };
          console.log(`[WS] Emitting NEW_MESSAGE to Socket.io clients:`, JSON.stringify(msgPayload).substring(0, 200));
          io.emit('NEW_MESSAGE', msgPayload);

          if (persistedMessage?.id && persistedMessage.media_url &&
              persistedMessage.media_type && persistedMessage.media_type !== 'text' &&
              !persistedMessage.local_media_path) {
            inboundMediaHydration.hydrateRow(persistedMessage);
          }

          // ACK only after SQLite persistence and realtime emission completed.
          // The extension keeps the durable outbox row until this arrives, so
          // a socket drop between ws.send() and DB commit cannot lose a message.
          if (msg.outbox_id && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'BACKEND_OUTBOX_ACK',
              data: { outbox_id: String(msg.outbox_id) }
            }));
          }

          // Auto-Reply & AI
          if (wasNewMessage && isConfirmedIncoming) {
            const replied = await autoReplyEngine.processIncoming(m, sendViaExtension);
            if (!replied) {
              await aiMediator.processIncoming(m, sendViaExtension);
            }
          }
          break;
        }

        case 'DISCOVERY_SYNC_DIAGNOSTIC': {
          const diagnostic = msg.data || {};
          console.log(`[DISCOVERY_DIAG] account=${diagnostic.account_id || ws.accountId || 'unknown'} stage=${diagnostic.stage || 'unknown'} data=${JSON.stringify(diagnostic)}`);
          break;
        }

        case 'INCOMING_CALL_RINGING': {
          const data = msg.data || {};
          const accountId = data.account_id || ws.accountId || null;
          // A detached Chrome tab can deliver one last queued frame after its
          // account was removed. Never surface that stale frame in the CRM.
          const liveAccount = accountId
            ? db.prepare('SELECT id FROM accounts WHERE id = ?').get(String(accountId))
            : null;
          if (!liveAccount || ws.accountId && String(ws.accountId) !== String(accountId)) {
            console.warn(`[WS] Skip stale incoming call for removed/invalid account=${accountId || 'unknown'}`);
            break;
          }

          // Keep the managed Chrome profile hidden. The desktop CRM popup is
          // sufficient; bringing Chrome forward interrupts the operator.
          const internalThreadId = data.thread_id ? resolveInternalThreadId(db, accountId, data.thread_id) : null;
          const knownThread = internalThreadId
            ? db.prepare('SELECT contact_name FROM threads WHERE id = ?').get(internalThreadId)
            : null;
          const callerName = String(data.caller_name || knownThread?.contact_name || '').trim() || 'Khách hàng';
          io.emit('INCOMING_CALL_RINGING', { ...data, caller_name: callerName, thread_id: internalThreadId || data.thread_id || null, external_thread_id: data.thread_id || null, account_id: accountId });
          break;
        }

        case 'INCOMING_CALL_ENDED':
          io.emit('INCOMING_CALL_ENDED', msg.data || {});
          break;

        case 'ANSWER_INCOMING_CALL_RESULT':
          io.emit('ANSWER_INCOMING_CALL_RESULT', msg.data || {});
          break;

        case 'MESSAGE_REQUEST_ACTION_RESULT': {
          const result = msg.data || {};
          const requestId = String(result.request_id || '');
          const owner = messageRequestActionOwners.get(requestId);
          if (!owner) break;
          messageRequestActionOwners.delete(requestId);
          if (result.success && result.action !== 'query') {
            const threadId = String(owner.threadId);
            // "Continue" only expands Messenger's second-stage request
            // controls (Accept / Delete / Block). Keep the thread in the
            // request inbox until the operator chooses a terminal action.
            if (result.action === 'accept') {
              db.prepare("UPDATE threads SET inbox_folder = 'INBOX' WHERE id = ?").run(threadId);
              io.emit('THREAD_INBOX_FOLDER_CHANGED', { thread_id: threadId, inbox_folder: 'INBOX' });
            } else if (result.action === 'delete' || result.action === 'block') {
              db.prepare('UPDATE threads SET archived_at = CURRENT_TIMESTAMP WHERE id = ?').run(threadId);
              io.emit('MESSAGE_REQUEST_REMOVED', { thread_id: threadId });
            }
          }
          owner.socket.emit('MESSAGE_REQUEST_ACTION_RESULT', { ...result, thread_id: owner.threadId });
          break;
        }

        case 'THREAD_SEEN': {
          // Extension bắt được 'Đã xem' từ 2 nguồn:
          // - DOM watcher (alt avatar + bubble text) khi thread đang mở.
          // - MQTT read receipt (watermark_ms) - dữ liệu chuẩn của Facebook,
          //   về realtime kể cả khi thread không mở. Watermark khớp theo
          //   messages.timestamp_ms (đã xác nhận từ FB) nên không cần đoán.
          try {
            const seenAltRaw = String(msg.data?.alt || '');
            const seenBubbleRaw = String(msg.data?.bubble_text || '');
            const seenWatermarkMs = Number(msg.data?.watermark_ms) || 0;
            if (!seenAltRaw && !seenBubbleRaw && !(seenWatermarkMs > 0)) {
              // Bản content script cũ (chỉ gửi thread_id) - dữ liệu không đủ
              // để xác định tin, chấm mù sẽ gây false positive.
              break;
            }
            console.log(`[SEEN] Nhận: alt="${seenAltRaw.slice(0, 60)}" bubble="${seenBubbleRaw.slice(0, 60)}" watermark=${seenWatermarkMs} source=${msg.data?.source || 'dom'}`);
            const rawSeenId = String(msg.data?.thread_id || '');
            const seenAccountId = msg.data?.account_id ? String(msg.data.account_id) : String(ws.accountId || '');
            // Operator tự đọc tin của khách cũng sinh read receipt: actor
            // trùng tài khoản đang chạy thì bỏ qua, không đánh 'đã xem'.
            if (seenWatermarkMs > 0 && String(msg.data?.actor || '') && seenAccountId && String(msg.data.actor) === String(seenAccountId)) {
              console.log(`[SEEN] Bỏ qua: receipt của chính operator (actor=${msg.data.actor})`);
              break;
            }
            if (rawSeenId) {
              const canonicalSeenId = resolveInternalThreadId(db, seenAccountId, rawSeenId) || rawSeenId;
              const lastSeenOut = db.prepare(
                'SELECT id, created_at FROM messages WHERE thread_id = ? AND is_outgoing = 1 ORDER BY COALESCE(sequence_order, id) DESC LIMIT 1'
              ).get(canonicalSeenId);
              if (!lastSeenOut) break;
              const altText = String(msg.data?.alt || '');
              const bubbleText = String(msg.data?.bubble_text || '');
              const normSeen = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
              const nb = normSeen(bubbleText);
              let targetSeen = null;
              // Ưu tiên 0 (MQTT): watermark từ read receipt chính chủ - tin
              // outgoing cuối có timestamp_ms (giờ FB) ≤ watermark + dung sai
              // 5s. Đây là mốc khách đã đọc tới, chính xác nhất.
              if (seenWatermarkMs > 0) {
                targetSeen = db.prepare(
                  'SELECT id, content FROM messages WHERE thread_id = ? AND is_outgoing = 1 AND timestamp_ms > 0 AND timestamp_ms <= ? ORDER BY COALESCE(sequence_order, id) DESC LIMIT 1'
                ).get(canonicalSeenId, seenWatermarkMs + 5000) || null;
              }
              // Ưu tiên 1: khớp NỘI DUNG bubble nằm ngay trên avatar seen -
              // xác định chính xác khách đọc tới tin nào (không đoán giờ).
              if (!targetSeen && nb && nb !== 'đã gửi') {
                const recentOut = db.prepare(
                  'SELECT id, content FROM messages WHERE thread_id = ? AND is_outgoing = 1 ORDER BY COALESCE(sequence_order, id) DESC LIMIT 30'
                ).all(canonicalSeenId);
                targetSeen = recentOut.find((m) => {
                  const c = normSeen(m.content);
                  return c && c.length > 1 && (nb === c || nb.includes(c) || c.includes(nb));
                }) || null;
              }
              // Ưu tiên 2 (fallback): gate theo giờ trong alt so với tin cuối.
              if (!targetSeen) {
                const timeMatch = altText.match(/(?:lúc|at)\s+(\d{1,2}):(\d{2})/i);
                const sentAt = Date.parse(lastSeenOut.created_at);
                if (timeMatch && Number.isFinite(sentAt)) {
                  const seenAt = new Date();
                  seenAt.setHours(Number(timeMatch[1]) % 24, Number(timeMatch[2]), 0, 0);
                  if (seenAt.getTime() - sentAt > 12 * 3600 * 1000) seenAt.setTime(seenAt.getTime() - 24 * 3600 * 1000);
                  if (seenAt.getTime() + 120000 >= sentAt) targetSeen = lastSeenOut;
                }
              }
              if (!targetSeen) {
                console.log(`[SEEN] Bỏ qua (bubble "${bubbleText.slice(0, 40)}" không khớp tin nào, alt "${altText.slice(0, 50)}")`);
                break;
              }
              // Avatar chỉ tiến tới: mốc hiện tại mới hơn target thì không lùi.
              const prevSeenRow2 = db.prepare('SELECT last_seen_message_id FROM threads WHERE id = ?').get(canonicalSeenId);
              if (prevSeenRow2?.last_seen_message_id) {
                const cur = db.prepare('SELECT COALESCE(sequence_order, id) AS ord FROM messages WHERE id = ?').get(prevSeenRow2.last_seen_message_id);
                const tgt = db.prepare('SELECT COALESCE(sequence_order, id) AS ord FROM messages WHERE id = ?').get(targetSeen.id);
                if (cur && tgt && Number(tgt.ord) <= Number(cur.ord)) break;
              }
              db.prepare('UPDATE threads SET last_seen_message_id = ? WHERE id = ?').run(String(targetSeen.id), canonicalSeenId);
              io.emit('THREAD_SEEN', { thread_id: String(canonicalSeenId), last_seen_message_id: String(targetSeen.id) });
              console.log(`[SEEN] thread=${canonicalSeenId} seen tới tin ${targetSeen.id} (bubble: "${bubbleText.slice(0, 40)}")`);
            }
          } catch (seenErr) {
            console.warn('[SEEN] Lỗi xử lý THREAD_SEEN:', seenErr.message);
          }
          break;
        }

        case 'PAGE_PROFILE_SCRAPE_RESULT': {
          pageApiService.handlePageProfileScrapeResult(msg.data || {}, io, db).catch((err) => {
            console.warn('[WS] PAGE_PROFILE_SCRAPE_RESULT lỗi:', err.message);
          });
          break;
        }

        case 'SYNC_THREADS_RESULT': {
          let { account_id, threads, partial, sync_status, checkpoint } = msg.data;
          if (!account_id && msg.data?.page_id) {
            const pageSrc = db.prepare('SELECT owner_account_id FROM inbox_sources WHERE source_type = "page_messenger" AND external_id = ?').get(String(msg.data.page_id));
            if (pageSrc?.owner_account_id) account_id = pageSrc.owner_account_id;
          }
          if (!account_id && ws.accountId) {
            account_id = ws.accountId;
          }
          const isRealtimeSidebarHint = sync_status === 'realtime_hint' || sync_status === 'realtime_requests';
          console.log(`[WS] Nhận ${threads?.length || 0} threads từ extension tài khoản: ${account_id}`);
          // 2026-10-09: hint thuần (partial=true, realtime_hint) trùng payload
          // trong 60s thì bỏ qua toàn bộ case — txn upsert ~30 threads mỗi lần
          // với nội dung y hệt chỉ đốt CPU + WAL. Frame final/scan (partial khác
          // true) và realtime_requests vẫn xử lý bình thường.
          const isPureRealtimeHint = isRealtimeSidebarHint && partial === true && sync_status === 'realtime_hint';
          if (isPureRealtimeHint && Array.isArray(threads)) {
            const hintSig = `${account_id}|${threads.map((t) => `${t.thread_id || t.id}|${t.is_unread ? 1 : 0}|${t.last_message || ''}|${t.row_time_text || ''}`).join('\n')}`;
            const prevHint = lastRealtimeHintSig.get(account_id);
            if (prevHint && prevHint.sig === hintSig && Date.now() - prevHint.at < 60 * 1000) {
              if (Date.now() - lastUnchangedHintLogAt > 30000) {
                lastUnchangedHintLogAt = Date.now();
                syncDebug('REALTIME_HINT_UNCHANGED', { account: account_id, threads: threads.length });
              }
              break;
            }
            lastRealtimeHintSig.set(account_id, { sig: hintSig, at: Date.now() });
          }
          if (isRealtimeSidebarHint) {
            const observedAtMs = Number(msg.data?.observed_at || 0);
            syncDebug('REALTIME_HINT', {
              account: account_id,
              origin: msg.data?.origin || null,
              threads: threads?.length || 0,
              age_ms: observedAtMs ? Date.now() - observedAtMs : null
            });
          }
          // Progressive UI batches are not the end of the combined Inbox +
          // Requests scan. Only its final aggregate frame releases inFlight.
          if (partial !== true) {
            InboxSyncScheduler.markSidebarResult(account_id, threads?.length || 0);
            if (threads?.length) completeNewAccountBootstrapSync(account_id);
          }
          if (partial === true && (sync_status === 'paused' || sync_status === 'cancelled')) {
            InboxSyncScheduler.markSidebarResult(account_id, threads?.length || 0);
          }
          if (!isRealtimeSidebarHint) {
            io.emit('FACEBOOK_SYNC_STATUS', { account_id, status: sync_status || (partial ? 'running' : 'completed'), checkpoint: checkpoint || [], count: threads?.length || 0 });
            domReplaySuppressUntil.set(account_id, Date.now() + 5000);
          }
          if (threads?.length) {
            // Keep a small list of already-known conversations whose unread
            // sidebar preview actually changed.  The existing sidebar sync is
            // intentionally left untouched; this only fills the realtime gap
            // for conversations which are not currently open in the history
            // tab (Facebook does not mount their message DOM).
            const changedUnreadThreads = [];
            const startOfTodayMs = new Date().setHours(0, 0, 0, 0);
            const txn = db.transaction((account_id, threads) => {
              for (const t of threads) {
                const threadId = t.thread_id || t.id;
                const { isBlacklistedThreadId } = require('./utils/threadGuard');
                if (!threadId || isBlacklistedThreadId(threadId)) continue;
                const threadPageId = t.page_id || msg.data?.page_id || null;
                const existingInternalThreadId = resolveInternalThreadId(db, account_id, threadId, threadPageId) || threadId;
                const previousThread = db.prepare(`
                  SELECT last_message, is_unread, thread_url, contact_name
                  FROM threads WHERE id = ?
                `).get(existingInternalThreadId);
                let name = cleanContactName(t.name || t.contact_name, null);
                const existing = db.prepare('SELECT contact_name FROM threads WHERE id = ?').get(existingInternalThreadId);
                let existingName = existing?.contact_name;
                if (isInvalidContactName(existingName)) existingName = null;

                // Chống tráo đổi tên: nếu thread đã có tên hợp lệ và tên mới bị trùng với thread khác, giữ tên hiện tại
                if (existingName && existingName !== 'Khách hàng') {
                  const isDuplicated = db.prepare('SELECT id FROM threads WHERE account_id = ? AND id != ? AND contact_name = ?').get(account_id, existingInternalThreadId, name);
                  if (isDuplicated) {
                    name = existingName;
                  }
                }

                if (!name || isInvalidContactName(name)) {
                  name = existingName || 'Khách hàng';
                }
                // Preview RAW từ sidebar trước khi bị thay bằng tin cũ trong DB:
                // tin ảnh/video thuần cho preview rỗng, cleanLastMsg dưới đây sẽ
                // lấy lại text cũ trong DB nên KHÔNG dùng được cho phát hiện media.
                const rawSidebarPreview = cleanMessageText(t.last_message);
                let cleanLastMsg = cleanMessageText(t.last_message);
                if (!cleanLastMsg || isSystemOrMetadataText(cleanLastMsg) || cleanLastMsg === 'Đang tải...') {
                  const dbMsgs = db.prepare(`
                    SELECT content, media_url FROM messages
                    WHERE thread_id = ?
                    ORDER BY timestamp_ms DESC, created_at DESC, id DESC
                    LIMIT 10
                  `).all(existingInternalThreadId);

                  // A media message with no caption is a valid "last message" too -
                  // preview it as [Ảnh] instead of falling through to an older text
                  // message or "Chưa có tin nhắn".
                  const validInDb = dbMsgs.find(m => {
                    if (m.media_url) return true;
                    const c = cleanMessageText(m.content);
                    return c && !isSystemOrMetadataText(c) && c !== 'Đang tải...';
                  });

                  cleanLastMsg = validInDb
                    ? (cleanMessageText(validInDb.content) || (validInDb.media_url ? '[Ảnh]' : ''))
                    : 'Chưa có tin nhắn';
                }

                // Phải tính TRƯỚC isChangedIncomingSidebarPreview: bypass
                // same-preview chỉ được nổ ở nhịp CHUYỂN ĐỔI sang "Bây giờ"
                // (rowFreshNew), nếu dùng raw fresh thì MỖI nhịp quét 2s
                // trong ~60s row còn "Bây giờ" đều tính là tin mới -> ngập
                // hàng đợi sync 177 sidebar_incoming/9 phút -> app lag, bắt
                // chậm (reproduce 2026-10-02 14:27-14:36).
                const rowFresh = isFreshRowTimeText(t.row_time_text);
                const rowTimeNow = String(t.row_time_text || '');
                const rowBumpKey = account_id + ':' + existingInternalThreadId;
                const rowTimePrev = rowTimePrevSeen.get(rowBumpKey) || '';
                rowTimePrevSeen.set(rowBumpKey, rowTimeNow);
                if (rowTimePrevSeen.size > 800) rowTimePrevSeen.clear();
                const rowFreshNew = rowFresh && !isFreshRowTimeText(rowTimePrev);
                const normalizedPreviousThread = previousThread
                  ? { ...previousThread, last_message: cleanMessageText(previousThread.last_message) }
                  : null;
                const isActivitySummary = isSidebarActivitySummary(t.last_message);
                const hasStrongIncomingSignal = Number(t.is_unread) === 1 || t.is_like === true;
                const needsOutboundEchoLookup = Boolean(
                  normalizedPreviousThread
                  && cleanLastMsg
                  && normalizedPreviousThread.last_message !== cleanLastMsg
                  && !isActivitySummary
                  && t.preview_is_outgoing !== true
                  && !hasStrongIncomingSignal
                );
                const hasRecentMatchingOutbound = needsOutboundEchoLookup
                  ? ConversationRepository.hasRecentMatchingOutgoing(existingInternalThreadId, cleanLastMsg, db, {
                      // Sidebar timestamps are synthetic. A hidden Messenger tab
                      // can expose an older self-preview many minutes later; hold
                      // that provisional echo until native history confirms it.
                      windowMs: 60 * 60 * 1000
                    })
                  : false;
                const incomingPreviewChanged = isChangedIncomingSidebarPreview({
                  previousThread: normalizedPreviousThread,
                  incomingThread: t,
                  cleanLastMessage: cleanLastMsg,
                  isActivitySummary,
                  hasRecentMatchingOutbound,
                  rowFreshNew
                });
                const pageSourceId = (threadPageId || t.source_type === 'page_messenger') ? ('src_page_' + (threadPageId || '')) : null;
                // Cờ đánh tay phải sống qua mọi lần sync, CẢ HAI CHIỀU:
                //  1  = user đánh chưa đọc -> FB báo đã đọc cũng giữ chưa đọc
                // -1  = user đánh đã đọc   -> FB vẫn treo chấm xanh cũng giữ đã đọc
                let syncUnread = t.is_unread;
                // Chấm xanh FB không tự tắt khi CRM trả lời bằng API (chỉ tắt
                // khi người thật mở tin trong Messenger), nên báo cáo sidebar
                // vẫn "chưa đọc" trên hội thoại ĐÃ TRẢ LỜI hoặc có tin cuối từ
                // trước hôm nay — không được hâm cờ mỗi lần sync
                // (2026-10-21: hội thoại 14/10 sync xong vẫn hiện chưa đọc).
                // Cờ manual do user đánh tay ở dưới vẫn ưu tiên sau cùng.
                let newestRealMessage = null;
                if (Number(syncUnread) === 1) {
                  newestRealMessage = db.prepare(`
                    SELECT is_outgoing, timestamp_ms FROM messages
                    WHERE thread_id = ?
                      AND (fb_message_id IS NULL OR fb_message_id NOT LIKE 'sidebar_preview_%')
                    ORDER BY timestamp_ms DESC, id DESC LIMIT 1
                  `).get(existingInternalThreadId);
                  if (newestRealMessage) {
                    const newestIsToday = Number(newestRealMessage.timestamp_ms) >= startOfTodayMs;
                    if (newestRealMessage.is_outgoing === 1 || !newestIsToday) syncUnread = 0;
                  }
                }
                if (previousThread) {
                  const manualRow = db.prepare('SELECT unread_manual FROM threads WHERE id = ?').get(existingInternalThreadId);
                  const manual = Number(manualRow?.unread_manual || 0);
                  if (manual === 1) syncUnread = 1;
                  else if (manual === -1) syncUnread = 0;
                }
                // 2026-10-03: hội thoại hệ thống (kết nối/bạn bè/cuộc gọi) FB
                // tự treo chấm xanh -> bộ dò chấm xanh mới bắt cả chấm này và
                // PREVIEW_BUBBLE gắn unread cho thread rác, CRM ngập "chưa
                // đọc" sai. Thread hệ thống CHƯA có tin khách thật: bỏ unread
                // + reset cờ manual để tự heal các cờ rác ghi từ build trước.
                const systemNotice = isSystemConversationNotice(rawSidebarPreview);
                if (systemNotice) {
                  const hasRealIncoming = db.prepare(`
                    SELECT 1 FROM messages
                    WHERE thread_id = ? AND is_outgoing = 0
                      AND fb_message_id NOT LIKE 'sidebar_preview_%'
                    LIMIT 1
                  `).get(existingInternalThreadId);
                  if (!hasRealIncoming) {
                    syncUnread = 0;
                    db.prepare('UPDATE threads SET unread_manual = 0 WHERE id = ? AND unread_manual != 0').run(existingInternalThreadId);
                  }
                }
                // Thông báo hoạt động (cuộc gọi nhỡ, thêm/rời nhóm, chrome UI
                // "Trả lời?"...) và preview outgoing KHÔNG bao giờ là tin khách —
                // FB treo chấm xanh thật nhưng nếu để qua đường preview thì
                // bubble provisional gắn unread_manual=1 dính VĨNH VIỄN -> badge
                // "1" ảo mãi không tắt (reproduce 2026-10-16: 6+ row như thế).
                // Gỡ luôn cờ manual rác để heal các badge ảo đang dính từ trước;
                // tin khách thật về bằng đường riêng sẽ tự đánh unread lại.
                const nameEchoPreview = (() => {
                  const pv = String(rawSidebarPreview || '').toLowerCase().replace(/\s+/g, ' ').trim();
                  const nm = String(name || '').toLowerCase().replace(/\s+/g, ' ').trim();
                  return !!pv && !!nm && pv === nm;
                })();
                const activityNotification = isSidebarActivityNotification(rawSidebarPreview)
                  || t.preview_is_outgoing === true
                  || nameEchoPreview;
                if (activityNotification && Number(t.is_unread) === 1) {
                  syncUnread = 0;
                  db.prepare('UPDATE threads SET unread_manual = 0 WHERE id = ? AND unread_manual != 0').run(existingInternalThreadId);
                }
                const storedThread = ConversationRepository.upsertThread({
                  id: threadId,
                  external_thread_id: t.external_thread_id || threadId,
                  account_id: account_id,
                  source_id: pageSourceId,
                  thread_url: t.thread_url || null,
                  contact_name: name,
                  // Placeholder -> null để COALESCE giữ preview thật trong DB.
                  last_message: (!cleanLastMsg || cleanLastMsg === 'Chưa có tin nhắn') ? null : cleanLastMsg,
                  is_unread: syncUnread,
                  inbox_folder: t.inbox_folder || null,
                  inbox_folder_verified: t.inbox_folder_verified === true
                });
                const canonicalThreadId = String(storedThread?.id || existingInternalThreadId);

                // Page thread bắt buộc phải mang page_id vào job, nếu không
                // scheduler route nhầm sang lane cá nhân (tab Messenger cá
                // nhân không mở được hội thoại Page -> thread_route_mismatch
                // / page_locked_by_user_action lặp vô hạn, khách Page không
                // bao giờ sync - reproduce 2026-09-30).
                const boundPageSource = ConversationRepository.getThreadSource(canonicalThreadId);
                // rowFresh/rowFreshNew đã tính ở trên (trước bộ dò). Flip
                // chấm xanh FB 0->1 (theo hint sidebar, không phải DB) cũng
                // là bằng chứng tin vừa đến; gắn vào push để nhánh bubble
                // biết phải bump thread cả khi bong bóng provisional bị chặn.
                // Dùng hint thật vì DB bị operator bấm đọc làm 1->0 -> "flip"
                // giả ngay scan sau, badge hồi sinh (reproduce 2026-10-12).
                const hasTodayRealIncoming = Boolean(newestRealMessage)
                  && Number(newestRealMessage.timestamp_ms) >= startOfTodayMs
                  && Number(newestRealMessage.is_outgoing) !== 1;
                const unreadFlippedToIncoming = hintUnreadTracker.flip(
                  account_id + ':' + threadId,
                  t.is_unread,
                  hasTodayRealIncoming
                );
                if (incomingPreviewChanged) {
                  changedUnreadThreads.push({
                    account_id,
                    thread_id: canonicalThreadId,
                    external_thread_id: t.external_thread_id || threadId,
                    thread_url: t.thread_url || previousThread?.thread_url || null,
                          contact_name: name || previousThread?.contact_name || null,
                    page_id: threadPageId || (boundPageSource?.pageId ?? null),
                    preview_content: cleanLastMsg,
                    preview_is_outgoing: t.preview_is_outgoing === true,
                    preview_is_like: t.is_like === true,
                    row_fresh: rowFresh,
                    row_fresh_new: rowFreshNew,
                    unread_flipped: unreadFlippedToIncoming,
                    system_notice: systemNotice
                  });
                }

                // Ảnh/video thuần: sidebar chỉ hiện thumbnail (0 text preview)
                // nên isChangedIncomingSidebarPreview luôn false - nếu chỉ chạy
                // theo bubble thì history sync không bao giờ được enqueue và
                // media của khách chỉ vào CRM khi ai đó bấm vào hội thoại.
                // Unread flip + preview rỗng = khách vừa gửi media: vẫn đẩy vào
                // hàng sync (không tạo bubble text giả). Guard tin thật 90s chặn
                // re-enqueue sau khi media đã về DB; flip tự tắt khi is_unread=1
                // được ghi lại nên sweep không bắn lặp.
                // Thread đã unread sẵn thì không còn flip để bắt - dòng thời
                // gian "Bây giờ" trên row là bằng chứng tin vừa đến.
                const mediaHintKey = `${account_id}:${canonicalThreadId}`;
                const mediaHintLastAt = mediaHintLastSeen.get(mediaHintKey) || 0;
                if (mediaHintLastSeen.size > 600) mediaHintLastSeen.clear();
                if (!incomingPreviewChanged
                  && (!rawSidebarPreview || (isSystemOrMetadataText(rawSidebarPreview) && !systemNotice))
                  && t.preview_is_outgoing !== true
                  && (Number(t.is_unread) === 1 || t.is_like === true)
                  && (unreadFlippedToIncoming || rowFresh)
                  && Date.now() - mediaHintLastAt > 90 * 1000) {
                  const recentRealIncoming = db.prepare(`
                    SELECT 1 FROM messages
                    WHERE thread_id = ? AND is_outgoing = 0
                      AND fb_message_id NOT LIKE 'sidebar_preview_%'
                      AND timestamp_ms >= ?
                    LIMIT 1
                  `).get(existingInternalThreadId, Date.now() - 90 * 1000);
                  if (!recentRealIncoming) {
                    mediaHintLastSeen.set(mediaHintKey, Date.now());
                    changedUnreadThreads.push({
                      account_id,
                      thread_id: canonicalThreadId,
                      external_thread_id: t.external_thread_id || threadId,
                      thread_url: t.thread_url || previousThread?.thread_url || null,
                      contact_name: name || previousThread?.contact_name || null,
                      page_id: threadPageId || (boundPageSource?.pageId ?? null),
                      preview_content: '',
                      preview_is_like: t.is_like === true,
                      media_only_hint: true,
                      row_time_text: t.row_time_text || null,
                      row_fresh: rowFresh,
                      unread_flipped: unreadFlippedToIncoming
                    });
                  }
                }

                // Auto-bind Page source nếu thread đến từ Business Suite
                if (threadPageId || t.source_type === 'page_messenger') {
                  try {
                    InboxSourceService.ensurePageSource({
                      pageId: String(threadPageId || ''),
                      accountId: account_id,
                      threadId: canonicalThreadId,
                      canonicalThreadId,
                      pageName: t.page_name || null
                    }, db);
                    // Owner vừa được gắn/binding xác nhận -> mở gate READY cho
                    // lane Page (không phải chờ tab reload để bắn READY lại).
                    if (threadPageId) InboxSyncScheduler.markPageReady(String(threadPageId), account_id);
                  } catch (psErr) {
                    console.warn('[PAGE_SOURCE] Lỗi bind thread từ sync:', psErr.message);
                  }
                }
                
                const currentContact = db.prepare('SELECT avatar_url FROM contacts WHERE thread_id = ?').get(canonicalThreadId);
                let initialAvatar = currentContact?.avatar_url || null;
                if (t.avatar_url && typeof t.avatar_url === 'string' && t.avatar_url.startsWith('http')) {
                  initialAvatar = t.avatar_url;
                }
                db.prepare(`
                  INSERT INTO contacts (thread_id, name, avatar_url)
                  VALUES (?, ?, ?)
                  ON CONFLICT(thread_id) DO UPDATE SET
                    name = excluded.name,
                    avatar_url = COALESCE(excluded.avatar_url, contacts.avatar_url)
                `).run(canonicalThreadId, name, initialAvatar);
              }
            });
            txn(account_id, threads);
            syncDebug('PREVIEW_CHANGED', { status: sync_status || null, changed: changedUnreadThreads.length });

            // Render the trusted unread/sidebar-Like preview immediately.
            // The repository later promotes this sidebar_preview_* row to
            // Facebook's native id when history sync confirms the same text.
            for (const changed of changedUnreadThreads) {
              let previewContent = cleanMessageText(changed.preview_content);
              // Preview của NHÓM dán tên người gửi vào trước nội dung
              // ("Bảo Long: Xmzmmz"). Đối chiếu theo phần SAU tiền tố: nếu
              // tin thật cùng nội dung đã có trong thread thì preview này
              // KHÔNG phải tin mới - bỏ qua hoàn toàn (reproduce 2026-10-15
              // nhóm Cfggh: "Hai: aloo" + "Bảo Long: Xmzmmz" chen cạnh tin
              // sạch vì khớp exact thất bại rồi INSERT provisional).
              const canonicalThreadId = resolveInternalThreadId(db, changed.account_id, changed.thread_id, changed.page_id || null) || changed.thread_id;
              let previewContentNoGroupPrefix = null;
              let previewSenderName = null;
              const groupPrefixMatch = previewContent.match(/^([^:\n]{1,80}):\s+(.+)$/s);
              if (groupPrefixMatch) {
                previewContentNoGroupPrefix = groupPrefixMatch[2].trim();
                // Nhóm thật (>=2 sender incoming khác nhau): tách prefix vào
                // sender_name để bubble nhóm render tên thành viên như tin
                // thật thay vì content dán "Hai: kđkdk" (2026-10-15). Guard
                // tên người + suffix không lồng prefix nữa để text 1-1 dạng
                // "Lưu ý: xyz" không bị tách mất nội dung.
                const prefixName = groupPrefixMatch[1].trim();
                const looksLikePersonName = prefixName.length >= 2 && prefixName.length <= 40
                  && /^[\p{L}\p{M}][\p{L}\p{M}\s.'\-]*$/u.test(prefixName)
                  && prefixName.split(/\s+/).length <= 5;
                if (looksLikePersonName && !/^[^:\n]{1,80}:\s+/.test(previewContentNoGroupPrefix)
                  && Number(db.prepare("SELECT COUNT(DISTINCT sender_name) AS n FROM messages WHERE thread_id = ? AND is_outgoing = 0 AND sender_name IS NOT NULL AND TRIM(sender_name) != ''").get(canonicalThreadId).n) >= 2) {
                  previewSenderName = prefixName;
                  previewContent = previewContentNoGroupPrefix;
                }
              }
              // Bộ dò sidebar thi thoảng nhặt nhầm span UI của Messenger làm
              // snippet ("Trả lời?" trên row) hoặc chính TÊN thread (khi
              // snippet thật trống) — không bao giờ là tin của khách, chặn ở
              // đây để không sinh bong bóng ma; tin thật vẫn về qua history/
              // realtime sync với mid thật (reproduce 2026-10-15: bubble
              // "Trả lời?" ở 3 thread + bubble tên chính nó ở Đoàn Toản).
              const SIDEBAR_CHROME_RE = /^(?:trả\s*lời\s*\??|đang gõ(?: tin nhắn)?|đã xem(?: tin nhắn)?|đã nhìn(?: tin nhắn)?|xem tin nhắn|tin nhắn mới|gửi tin nhắn|hủy bỏ|đang gọi\W*)$/i;
              const previewNameKey = String(changed.contact_name || '').toLowerCase().replace(/\s+/g, ' ').trim();
              const previewContentKey = previewContent.toLowerCase().replace(/\s+/g, ' ').trim();
              // Thông báo hoạt động (bỏ lỡ cuộc gọi, thêm/rời nhóm...) và preview
              // outgoing không bao giờ là tin khách — không tạo bong bóng provisional
              // (chúng là nguồn badge "1" ảo vì đường này gắn unread_manual=1).
              if (!previewContent || SIDEBAR_CHROME_RE.test(previewContent)
                || (previewNameKey && previewContentKey === previewNameKey)
                || isSidebarActivityNotification(previewContent)
                || changed.preview_is_outgoing === true) continue;
              if (!/^[\s\u00b7\u2022.\-|•·]+$/.test(previewContent)) {
                const previewTimestamp = Date.now();
                const previewHash = crypto.createHash('sha1')
                  .update(String(changed.account_id) + '|' + String(canonicalThreadId) + '|' + previewContent)
                  .digest('hex').slice(0, 16);
                // Stable per thread+content: repeated sidebar scans cannot
                // manufacture duplicate provisional bubbles from old previews.
                const previewId = 'sidebar_preview_' + previewHash;
                // Sidebar re-reports OLD bubbles as fresh customer activity
                // when the preview text drifts slightly between scans (đổi
                // khoảng trắng, tiền tố "Bạn: ", biến thể emoji - sau mỗi lần
                // CRM gửi tin preview cũ của khách hay "thay đổi" kiểu này,
                // reproduced 2026-09-17/2026-09-30). So khớp CHUẨN HÓA thay
                // vì so ký tự chính xác: nội dung đã tồn tại trong thread
                // (bất kỳ chiều, không phải provisional) không bao giờ là tin
                // mới. 100 tin gần nhất đủ che mọi text lặp ngắn ("ok", "dạ").
                const recentRealMessages = db.prepare(`
                  SELECT content FROM messages
                  WHERE thread_id = ? AND fb_message_id NOT LIKE 'sidebar_preview_%'
                  ORDER BY COALESCE(timestamp_ms, 0) DESC
                  LIMIT 100
                `).all(canonicalThreadId);
                const normalizedPreview = normalizePreviewText(previewContent);
                const normalizedDupe = normalizedPreview
                  ? recentRealMessages.some((m) => normalizePreviewText(m.content) === normalizedPreview)
                  : false;
                if (!normalizedDupe) {
                const previewPersistence = ConversationRepository.saveMessagesTransaction(canonicalThreadId, [{
                  fb_message_id: previewId,
                  content: previewContent,
                  member_name: previewSenderName || undefined,
                  media_type: 'text',
                  timestamp_ms: previewTimestamp,
                  timestamp_source: 'realtime_fallback',
                  created_at: new Date(previewTimestamp).toISOString(),
                  is_outgoing: false,
                  sender_role: 'customer',
                  direction_status: 'confirmed',
                  source: 'sidebar_preview'
                }], db);
                if (previewPersistence.insertedIds.includes(previewId)) {
                  // CHỈ tin mới thật sự mới được gắn cờ chưa đọc + đẩy lên đầu.
                  // Operator vừa đọc (unread_manual = -1) thì cần bằng chứng
                  // mạnh: nội dung mới thật (đã chuẩn hóa ở trên) hoặc chấm
                  // xanh FB lật trên thread thường — chặn chấm hồi sinh do
                  // preview trôi định dạng (bug 2026-10-08: đọc xong nhảy lại).
                  const flipGuardManual = db.prepare('SELECT unread_manual FROM threads WHERE id = ?').get(String(canonicalThreadId));
                  const allowFlip = shouldFlipUnreadFromPreview({
                    manual: flipGuardManual?.unread_manual,
                    previewContent,
                    recentRealContents: recentRealMessages.map((m) => m.content),
                    unreadFlipped: changed.unread_flipped,
                    isSystemNotice: changed.system_notice
                  });
                  if (allowFlip) {
                    db.prepare('UPDATE threads SET last_activity = CURRENT_TIMESTAMP, is_unread = 1, unread_manual = 1 WHERE id = ?').run(String(canonicalThreadId));
                    io.emit('THREAD_UNREAD_CHANGED', { thread_id: String(canonicalThreadId), is_unread: 1, last_activity: new Date().toISOString() });
                  } else {
                    syncDebug('UNREAD_GUARD_SKIP', { stage: 'PREVIEW_FLIP', thread: String(canonicalThreadId).substring(0, 24), content: sanitizeLog(previewContent, 40), manual: flipGuardManual?.unread_manual });
                  }
                  const previewRow = db.prepare('SELECT * FROM messages WHERE fb_message_id = ?').get(previewId);
                  if (previewRow) {
                    io.emit('NEW_MESSAGE', { ...previewRow, account_id: changed.account_id, provisional: true });
                    io.emit('THREAD_MESSAGES_UPDATED', { thread_id: canonicalThreadId, account_id: changed.account_id });
                    syncDebug('PREVIEW_BUBBLE', {
                      thread: String(canonicalThreadId).substring(0, 24),
                      content: sanitizeLog(previewContent, 60),
                      status: sync_status || null,
                      latency_ms: msg.data?.observed_at ? Date.now() - Number(msg.data.observed_at) : null
                    });
                    const { threadId: capturedThreadId, createdCaptures } = PhoneCaptureService.processIncomingMessage({
                      threadId: canonicalThreadId,
                      accountId: changed.account_id,
                      messageId: previewId,
                      content: previewContent,
                      messageTimestampMs: previewTimestamp
                    }, { database: db });
                    if (createdCaptures.length > 0) {
                      const phoneView = PhoneCaptureService.getContactPhoneView(capturedThreadId, db);
                      io.emit('PHONE_CAPTURED', {
                        thread_id: capturedThreadId,
                        captures: createdCaptures,
                        phone: phoneView.phone,
                        phone_source: phoneView.phone_source,
                        phone_captured_at: phoneView.phone_captured_at,
                        phone_capture: phoneView.phone_capture,
                        phone_candidates: phoneView.phone_candidates
                      });
                    }
                    const campaignResponse = CampaignResponseStatsService.recordIncomingResponse({
                      messageId: previewRow.id,
                      threadId: canonicalThreadId,
                      accountId: changed.account_id,
                      observedAtMs: previewTimestamp
                    }, db);
                    if (campaignResponse) io.emit('CAMPAIGN_RESPONSE_UPDATED', {
                      ...campaignResponse,
                      thread_id: canonicalThreadId,
                      provisional: true,
                      phone_captured: createdCaptures.length > 0
                    });
                  }
                }
                } else if (changed.row_fresh_new || changed.unread_flipped) {
                  // Tin lặp nội dung cũ ("ok", "dạ") không được tạo bong bóng
                  // provisional, nhưng khi tin THẬT vừa đến thì thread vẫn
                  // phải nhảy + badge ngay (reproduce 2026-10-02: khách nhắn
                  // "ok" lần 2, CRM im lặng 1p47s).
                  // Chỉ bump khi thread còn unread trong DB, preview khác
                  // last_message đã lưu, HOẶC chấm chưa đọc vừa xuất hiện
                  // (unread_flipped — giờ tính theo chấm xanh FB thật từ
                  // hint, xem hintUnreadTracker). 2026-10-03: với bộ dò chấm
                  // xanh mới, khách nhắn lại đúng câu cũ ("ok", "dạ") trên
                  // thread đã đọc phải bump được - flip chỉ nổ đúng 1 lần
                  // khi chấm chuyển 0->1 trên Facebook nên không tái diễn
                  // "đọc rồi hiện lại" (45b).
                  const readState = db.prepare('SELECT is_unread, last_message, unread_manual FROM threads WHERE id = ?').get(String(canonicalThreadId));
                  const isUnreadNow = Number(readState?.is_unread) === 1;
                  const lastMsgMatches = cleanMessageText(readState?.last_message) === previewContent;
                  // Operator vừa đọc (manual = -1): nhánh bump heuristic này
                  // không đủ bằng chứng tin mới (lastMsgMatches sai khớp dai
                  // dẳng khi last_message đổi thành outgoing) — chỉ bump khi
                  // chấm xanh FB thật sự lật trên thread thường (bug 2026-10-08).
                  const allowBump = shouldBumpUnreadFromSidebar({
                    manual: readState?.unread_manual,
                    unreadFlipped: changed.unread_flipped,
                    isSystemNotice: changed.system_notice
                  });
                  if (allowBump && (isUnreadNow || !lastMsgMatches || changed.unread_flipped)) {
                    const bumpedAtIso = new Date().toISOString();
                    db.prepare('UPDATE threads SET last_activity = CURRENT_TIMESTAMP, is_unread = 1, unread_manual = 1 WHERE id = ?').run(String(canonicalThreadId));
                    io.emit('THREAD_UNREAD_CHANGED', { thread_id: String(canonicalThreadId), is_unread: 1, last_activity: bumpedAtIso });
                    syncDebug('PREVIEW_BUMP_REPEAT', { thread: String(canonicalThreadId).substring(0, 24), content: sanitizeLog(previewContent, 40), status: sync_status || null });
                  } else if (!allowBump) {
                    syncDebug('UNREAD_GUARD_SKIP', { stage: 'PREVIEW_BUMP', thread: String(canonicalThreadId).substring(0, 24), content: sanitizeLog(previewContent, 40), manual: readState?.unread_manual });
                  }
                }

                if (!previewContent && changed.media_only_hint) {
                // Media-only: không có bubble để render, nhưng tin thật đã đến
                // - bump hội thoại lên đầu cột trái + gắn chưa đọc ngay. Thread
                // operator vừa đọc thì chờ chấm xanh thật/đường khác đánh dấu
                // (history sync có guard manual riêng) — hint trơ dễ bump giả.
                const mediaGuardRow = db.prepare('SELECT unread_manual FROM threads WHERE id = ?').get(String(canonicalThreadId));
                const allowMediaBump = shouldBumpUnreadFromSidebar({
                  manual: mediaGuardRow?.unread_manual,
                  unreadFlipped: changed.unread_flipped,
                  isSystemNotice: changed.system_notice
                });
                if (allowMediaBump) {
                  const bumpedAtIso = new Date().toISOString();
                  db.prepare('UPDATE threads SET last_activity = CURRENT_TIMESTAMP, is_unread = 1, unread_manual = 1 WHERE id = ?').run(String(canonicalThreadId));
                  io.emit('THREAD_UNREAD_CHANGED', { thread_id: String(canonicalThreadId), is_unread: 1, last_activity: bumpedAtIso });
                  syncDebug('MEDIA_HINT', { thread: String(canonicalThreadId).substring(0, 24), status: sync_status || null });
                } else {
                  syncDebug('UNREAD_GUARD_SKIP', { stage: 'MEDIA_HINT', thread: String(canonicalThreadId).substring(0, 24), manual: mediaGuardRow?.unread_manual });
                }
              }

              if (changed.page_id) {
                // 2026-10-03: chỉ job Page còn được điều hướng từ hint (lane
                // Page dùng tab Business Suite riêng). Job cá nhân bỏ hẳn - tab
                // history cá nhân chỉ di chuyển theo operator (click/kéo);
                // preview + bump đã chạy ở trên, nội dung đầy đủ sync khi click
                // (crm_navigation) hoặc khi hội thoại đang mở ở tab chat.
                InboxSyncScheduler.enqueueThreadSync({
                  ...changed,
                  thread_id: canonicalThreadId,
                  reason: 'sidebar_incoming',
                allow_navigation: true,
                priority: 'high',
                sync_mode: 'incremental'
                });
              }
            }
            }

            for (const t of threads) {
              const threadId = String(t.id || t.thread_id || '');
              if (!threadId) continue;
              const canonicalThreadId = resolveInternalThreadId(db, account_id, threadId, t.page_id || msg.data?.page_id || null) || threadId;
              const avatarData = t.avatar_base64 || t.avatar_url;
              if (avatarData) {
                saveAvatarFromBase64OrUrl(avatarData, canonicalThreadId).then(localFilename => {
                  if (localFilename) {
                    db.prepare('UPDATE contacts SET avatar_url = ? WHERE thread_id = ?').run(localFilename, canonicalThreadId);
                    io.emit('CONTACT_UPDATED', { thread_id: canonicalThreadId, avatar_url: localFilename });
                  }
                }).catch(() => {});
              }
            }
          }
          const allThreads = db.prepare(`
            SELECT t.*, c.phone, c.email, c.address, c.tags, c.lead_captured, c.avatar_url,
              c.status_id, ls.name AS status_name, ls.color AS status_color,
              r.due_at AS reminder_due_at, r.note AS reminder_note, r.status AS reminder_status,
              s.source_type, s.display_name AS source_name, s.status AS source_status,
              s.external_id AS source_external_id,
              CASE WHEN s.source_type = 'page_messenger' THEN s.external_id ELSE NULL END AS page_id,
              lm.max_ts AS last_msg_ts
            FROM threads t
            LEFT JOIN contacts c ON c.thread_id = t.id
            LEFT JOIN lead_statuses ls ON ls.id = c.status_id
            LEFT JOIN conversation_reminders r ON r.thread_id = t.id AND r.status = 'active'
            LEFT JOIN inbox_sources s ON s.id = t.source_id
            LEFT JOIN (
              SELECT thread_id, MAX(timestamp_ms) AS max_ts
              FROM messages WHERE timestamp_ms > 0 GROUP BY thread_id
            ) lm ON lm.thread_id = t.id
            WHERE t.account_id = ?
            ORDER BY COALESCE(NULLIF(lm.max_ts, 0), CAST(strftime('%s', t.last_activity) AS INTEGER) * 1000) DESC, t.id DESC
          `).all(account_id);
          ConversationRepository.attachRealActivity(allThreads, db);
          // Realtime jobs used to emit every stored conversation every 350ms.
          // That forced the entire chat view (including videos) to rerender
          // and visibly blink. Full/manual sync keeps the legacy full payload;
          // lightweight jobs emit only rows involved in this result.
          const syncedExternalIds = new Set((threads || []).map((thread) =>
            String(thread.external_thread_id || thread.thread_id || thread.id || '')
          ).filter(Boolean));
          const emittedThreads = isRealtimeSidebarHint
            ? allThreads.filter((thread) =>
                syncedExternalIds.has(String(thread.external_thread_id || thread.id || ''))
                || syncedExternalIds.has(String(thread.id || ''))
              )
            : allThreads;
          // Nhịp realtime_hint rỗng (0 hàng thay đổi) bỏ emit hoàn toàn -
          // tránh loadWaitingCount + setState cả danh sách mỗi 2s bên client.
          if (emittedThreads.length > 0 || !isRealtimeSidebarHint) {
            io.emit('THREADS_SYNCED', { account_id, threads: emittedThreads });
            console.log(`[WS] Đã emit THREADS_SYNCED lên frontend: ${emittedThreads.length} threads (full=${allThreads.length})`);
          }
          if (process.env.FB_CRM_DISABLE_INITIAL_SWEEP !== '1' && (partial !== true || Boolean(msg.data?.page_id))) {
            InitialMessageSweepService.start(account_id);
          }
          break;
        }

        case 'THREAD_MESSAGES_SYNCED': {
          const { account_id, thread_id, messages, reason, mode, cursor, checkpoint, fetched_count, scroll_delta, page_id } = msg.data;
          const routeDetail = msg.data?.route_detail ? ` | header="${String(msg.data.route_detail).slice(0, 80)}"` : '';
          console.log(`[WS] THREAD_MESSAGES_SYNCED: thread=${thread_id} mode=${mode||'full'} count=${messages?.length || 0}${reason ? ` reason=${reason}` : ''}${reason === 'thread_route_mismatch' ? routeDetail : ''}`);
          // Phase C (2026-10-01): ket qua ve = kenh dispatch song 2 chieu, reset
          // bo dem stall (ca count=0 deu tinh - diem quan trong la tin di va ve).
          dispatchStallWatchdog.noteResult(String(account_id || ws.accountId || ''));
          // 2026-10-03: ket qua thanh cong khong mang reason; terminal signal
          // that su nam o checkpoint. no_scroll_growth = vong cuon het ngan
          // sach ma DOM khong moc them; boundary_reached = cham het lich su.
          // Truoc day ca hai deu roi vao null -> scheduler replay vo han moi
          // ~2s (reproduce: crm_scroll_older_replay chay 90s lien, nghẽn CRM).
          const checkpointStopReason = checkpoint ? String(checkpoint.stop_reason || '') : '';
          const schedulerResultReason = reason
            || (checkpointStopReason === 'no_scroll_growth' ? 'no_scroll_growth' : null)
            || (checkpoint && checkpoint.boundary_reached ? 'reached_top' : null);
          InboxSyncScheduler.markThreadSyncResult(account_id, thread_id, schedulerResultReason, page_id || null);

          if (reason) {
            const HistorySyncManager = require('./services/HistorySyncManager');
            HistorySyncManager.updateSyncStatus(thread_id, 'FAILED', null, reason);
            console.log(`[WS] History sync failed for thread=${thread_id}; automatic retry is disabled.`);

            // Always finish the CRM request, even when Facebook navigation or
            // its virtualized DOM was not ready. Keep all persisted messages.
            const persistedRows = db.prepare(`
              SELECT * FROM messages WHERE thread_id = ?
              ORDER BY COALESCE(sequence_order, id) ASC, id ASC
            `).all(thread_id);
            io.emit('THREAD_MESSAGES_UPDATED', {
              thread_id,
              account_id,
              messages: prepareMessagesForClient(persistedRows),
              authoritative: true,
              sync_status: 'FAILED',
              sync_error: reason
            });
            // marker_mismatch/sidebar_mismatch/no_rows/no_main_container are DOM-timing
            // flukes that usually clear up on their own; error_screen means Facebook
            // itself is blocking the content, which is permanent and must not retry.
            const TRANSIENT_REASONS = new Set(['marker_mismatch', 'sidebar_mismatch', 'no_rows', 'no_main_container', 'url_mismatch', 'navigation_superseded']);
            // Navigation-lock rejections are temporary by design: the extension
            // holds the history/Business Suite tab on the thread the operator just
            // clicked for a 30s window. Retrying while that window is still open
            // is pointless, so these use a backoff that lands after it expires.
            const LOCK_WINDOW_REASONS = new Set(['navigation_locked_by_user_selection', 'page_locked_by_user_action']);
            const LOCK_WINDOW_BACKOFF_MS = [35000, 45000, 60000];
            // 2026-09-29: thread Page CHUA TUNG CO DU LIEU (msgs=0) that bai voi
            // thread_route_mismatch / extension_history_timeout khi xac minh
            // danh tinh hoi thoai lanh (chua tung mo) - mark vinh vien lam hoi
            // thoai moi treo trong mai (reproduce: Vung Vu Vuong page 768).
            // Chi 2 reason nay duoc retry khi thread con trong; thread da co
            // du lieu giu nguyen chinh sach cu de tranh tai quet vo ich.
            const COLD_RETRYABLE_REASONS = new Set(['thread_route_mismatch', 'extension_history_timeout']);
            const coldThreadNoMessages = COLD_RETRYABLE_REASONS.has(reason)
              && db.prepare('SELECT COUNT(*) AS n FROM messages WHERE thread_id = ?').get(thread_id).n === 0;
            if (TRANSIENT_REASONS.has(reason) || coldThreadNoMessages || LOCK_WINDOW_REASONS.has(reason)) {
              const scheduled = HistorySyncRetryPolicy.scheduleRetry(account_id, thread_id, () => {
                // A retry also performs tab navigation. Default transient retries
                // are cancelled when the operator has since clicked a different
                // thread (navigated_away guard). Lock-window retries bypass that
                // guard: the extension's own 30s navigation lock protects the
                // just-clicked thread, and their backoff lands after it expires.
                const extWs = extensionConnections.get(account_id);
                if (!extWs || extWs.readyState !== WebSocket.OPEN) {
                  console.warn(`[HISTORY_SYNC_RETRY_SKIPPED] thread=${thread_id} reason=extension_not_ready`);
                  return;
                }
                const threadRow = db.prepare('SELECT thread_url, contact_name FROM threads WHERE id = ?').get(thread_id);
                const pageSource = ConversationRepository.getThreadSource(thread_id);
                extWs.send(JSON.stringify({
                  type: 'SYNC_THREAD_MESSAGES',
                  data: {
                    account_id,
                    thread_id,
                    thread_url: threadRow?.thread_url || null,
                    page_id: pageSource?.pageId || null,
                    mode,
                    cursor,
                    contact_name: threadRow?.contact_name || null,
                    reason: 'history_retry',
                    allow_navigation: true
                  }
                }));
                console.log(`[WS] Retry sync tin nhắn cho thread ${thread_id} (account ${account_id}) mode=${mode}`);
              }, LOCK_WINDOW_REASONS.has(reason) ? LOCK_WINDOW_BACKOFF_MS : null, LOCK_WINDOW_REASONS.has(reason));
              if (!scheduled) {
                console.log(`[WS] Không retry điều hướng thread ${thread_id} (reason=${reason}, đã hết lượt); chờ click/yêu cầu mới.`);
              }
            } else {
              console.log(`[WS] Không retry điều hướng thread ${thread_id} (reason=${reason}, lỗi vĩnh viễn); chờ click/yêu cầu mới.`);
            }
            return; // Không ghi đè hoặc emit UI
          }

          HistorySyncRetryPolicy.cancelRetry(thread_id);

          const HistorySyncManager = require('./services/HistorySyncManager');
          let resolvedSyncStatus = null;
          
          if (Array.isArray(messages) && messages.length > 0) {
            let validMessages = messages.map(m => ({ ...m, content: cleanMessageText(m.content) }))
              .filter(m => {
                if (String(m.thread_id || thread_id) !== String(thread_id)) return false;
                if (!isRenderableStoredMessage(m)) return false;
                if (isRecentOutgoingTextEcho(thread_id, m, db)) {
                  console.log(`[WS] History Guard: skip CRM outbound text echo parsed as incoming: thread=${thread_id} content="${sanitizeLog(m.content, 60)}"`);
                  return false;
                }
                // Group chat name fragment: incoming text identical to its own
                // sender label is DOM chrome, not a message.
                if (!m.is_outgoing && String(m.member_name || '').trim()
                  && String(m.content || '').trim().toLowerCase() === String(m.member_name).trim().toLowerCase()) {
                  console.log(`[WS] History Guard: skip group name fragment: thread=${thread_id} name="${sanitizeLog(m.member_name, 40)}"`);
                  return false;
                }
                return true;
              });

            // A successful image/video send may first return through the
            // on-demand history scraper instead of the realtime observer.
            // Confirm the CRM-owned pending row here and do not persist a
            // second Facebook echo row; otherwise the timeout marks it failed
            // and a manual retry sends the same media again.
            validMessages = validMessages.filter((historyMessage) => {
              const mediaType = String(historyMessage.media_type || 'text').toLowerCase();
              if (!historyMessage.is_outgoing || !['image', 'video'].includes(mediaType) || !historyMessage.fb_message_id) {
                return true;
              }
              const observationTime = Number(historyMessage.timestamp_ms)
                || Date.parse(historyMessage.created_at || '')
                || Date.now();
              const confirmation = OutboundConfirmationService.confirmObservation({
                threadId: thread_id,
                fbMessageId: historyMessage.fb_message_id,
                isOutgoing: true,
                mediaType,
                content: historyMessage.content || '',
                observedAt: observationTime,
                confirmationSource: 'personal_dom'
              }, { database: db });
              if (confirmation.matched) {
                const confirmedMessage = db.prepare('SELECT * FROM messages WHERE id = ?').get(confirmation.message_id);
                io.emit('MESSAGE_SENT', {
                  thread_id,
                  client_message_id: confirmation.client_message_id,
                  fb_message_id: confirmation.fb_message_id,
                  status: 'sent'
                });
                if (confirmedMessage) io.emit('NEW_MESSAGE', withAttachmentAccessUrl({
                  ...confirmedMessage,
                  status: 'sent'
                }));
                console.log('[OUTBOUND_TRACE]', JSON.stringify({
                  stage: 'BACKEND_HISTORY_MEDIA_CONFIRMED',
                  thread_id: String(thread_id),
                  client_message_id: confirmation.client_message_id,
                  fb_message_id: confirmation.fb_message_id,
                  media_type: mediaType,
                  at: new Date().toISOString()
                }));
                return false;
              }
              return true;
            });

            const threadRow = db.prepare('SELECT id, account_id FROM threads WHERE id = ?').get(thread_id);
            if (!threadRow) {
              ConversationRepository.upsertThread({
                id: String(thread_id),
                account_id,
                contact_name: 'Khách hàng',
                is_unread: false
              });
            }
            
            const sequenceBounds = db.prepare(`
              SELECT MIN(COALESCE(sequence_order, id)) AS min_sequence,
                     MAX(COALESCE(sequence_order, id)) AS max_sequence
              FROM messages WHERE thread_id = ?
            `).get(thread_id);
            const existingSequences = new Map(db.prepare(
              'SELECT fb_message_id, COALESCE(sequence_order, id) AS sequence_order FROM messages WHERE thread_id = ?'
            ).all(thread_id).map((row) => [String(row.fb_message_id || ''), Number(row.sequence_order)]));
            let olderSequence = Number(sequenceBounds?.min_sequence || 0) - validMessages.length - 1;
            let newerSequence = Number(sequenceBounds?.max_sequence || 0);
            const { isOlderHistoryBatch } = require('./services/HistoryViewportDirection');
            const isOlderBatch = isOlderHistoryBatch(mode, scroll_delta);
            // Preserve the order of a partially mounted Facebook window. New
            // rows can sit between two messages already stored; appending all
            // of them after max_sequence is what previously moved incoming
            // messages to the wrong place. Fractional ranks are supported by
            // SQLite and let us insert between stable anchors without
            // rewriting any existing row.
            const nextKnownSequence = new Array(validMessages.length).fill(null);
            let upcomingKnown = null;
            for (let index = validMessages.length - 1; index >= 0; index--) {
              const known = existingSequences.get(String(validMessages[index].fb_message_id || ''));
              if (Number.isFinite(known)) upcomingKnown = known;
              nextKnownSequence[index] = upcomingKnown;
            }
            let previousKnown = null;
            const sequencedMessages = validMessages.map((message, index) => {
              const existingSequence = existingSequences.get(String(message.fb_message_id || ''));
              let sequenceOrder = existingSequence;
              if (Number.isFinite(existingSequence)) {
                previousKnown = existingSequence;
              } else {
                const nextKnown = nextKnownSequence[index];
                let segmentLength = 1;
                while (index + segmentLength < validMessages.length
                  && !Number.isFinite(existingSequences.get(String(validMessages[index + segmentLength].fb_message_id || '')))) {
                  segmentLength += 1;
                }
                if (Number.isFinite(previousKnown) && Number.isFinite(nextKnown) && nextKnown > previousKnown) {
                  sequenceOrder = previousKnown + (nextKnown - previousKnown) / (segmentLength + 1);
                  previousKnown = sequenceOrder;
                } else if (Number.isFinite(nextKnown)) {
                  sequenceOrder = nextKnown - segmentLength;
                  previousKnown = sequenceOrder;
                } else if (Number.isFinite(previousKnown)) {
                  sequenceOrder = previousKnown + 1;
                  previousKnown = sequenceOrder;
                  newerSequence = Math.max(newerSequence, sequenceOrder);
                } else {
                  sequenceOrder = isOlderBatch ? ++olderSequence : ++newerSequence;
                  previousKnown = sequenceOrder;
                }
              }
              return {
                ...message,
                account_id,
                sequence_order: sequenceOrder,
                timestamp_source: message.timestamp_source || 'fallback'
              };
            });
            // Avatar thành viên nhóm từ lịch sử: gom theo tên (một thành viên
            // nhắn nhiều tin chỉ tải 1 lần) rồi lưu song song trước khi persist
            // để emit cuối cùng đã kèm avatar qua prepareMessagesForClient.
            const memberAvatarJobs = new Map();
            for (const historyMessage of validMessages) {
              const historyMemberName = String(historyMessage.member_name || '').trim();
              const historyMemberAvatar = String(historyMessage.member_avatar || '');
              if (Number(historyMessage.is_outgoing) === 1 || !historyMemberName || !historyMemberAvatar.startsWith('http')) continue;
              if (!memberAvatarJobs.has(historyMemberName)) memberAvatarJobs.set(historyMemberName, historyMemberAvatar);
            }
            if (memberAvatarJobs.size > 0) {
              await Promise.all([...memberAvatarJobs].map(([historyMemberName, historyMemberAvatar]) =>
                upsertMemberAvatar(thread_id, historyMemberName, historyMemberAvatar)));
            }
            // Nhìn được payload history crawler thực sự trả về - chẩn đoán
            // chiều tin bị lưu sai (2026-11-03).
            syncDebug('HISTORY_BATCH', {
              thread: String(thread_id),
              mode,
              count: validMessages.length,
              sample: validMessages.slice(0, 14).map((mm) => ({
                id: String(mm.fb_message_id || '').slice(0, 44),
                out: mm.is_outgoing ? 1 : 0,
                name: String(mm.member_name || '').slice(0, 24),
                text: String(mm.content || '').slice(0, 24)
              }))
            });
            const persistence = ConversationRepository.saveMessagesTransaction(thread_id, sequencedMessages);
            // History may arrive after realtime already confirmed the local
            // attachment row. Collapse the late Facebook base/_media echo in
            // the same sync window so the UI never renders two copies until
            // the next REST reload.
            // History is also the recovery path when the realtime observer is
            // starved during a campaign. Attribute each newly persisted
            // incoming row first; only an attributed current-campaign reply is
            // allowed to capture a phone, so old history cannot pollute CRM.
            const historyInsertedRows = persistence.insertedIds.length
              ? db.prepare(`
                  SELECT * FROM messages
                  WHERE thread_id = ? AND fb_message_id IN (${persistence.insertedIds.map(() => '?').join(',')})
                    AND is_outgoing = 0
                `).all(thread_id, ...persistence.insertedIds)
              : [];
            for (const incomingRow of historyInsertedRows) {
              const observedAtMs = Number(incomingRow.timestamp_ms) || Date.parse(incomingRow.created_at || '') || Date.now();
              const campaignResponse = CampaignResponseStatsService.recordIncomingResponse({
                messageId: incomingRow.id,
                threadId: thread_id,
                accountId: account_id,
                observedAtMs
              }, db);
              if (!campaignResponse) continue;
              const { threadId: capturedThreadId, createdCaptures } = PhoneCaptureService.processIncomingMessage({
                threadId: thread_id,
                accountId: account_id,
                messageId: incomingRow.fb_message_id,
                content: incomingRow.content,
                messageTimestampMs: observedAtMs
              }, { database: db });
              if (createdCaptures.length > 0) {
                const phoneView = PhoneCaptureService.getContactPhoneView(capturedThreadId, db);
                io.emit('PHONE_CAPTURED', {
                  thread_id: capturedThreadId,
                  captures: createdCaptures,
                  phone: phoneView.phone,
                  phone_source: phoneView.phone_source,
                  phone_captured_at: phoneView.phone_captured_at,
                  phone_capture: phoneView.phone_capture,
                  phone_candidates: phoneView.phone_candidates
                });
              }
              io.emit('CAMPAIGN_RESPONSE_UPDATED', {
                ...campaignResponse,
                thread_id,
                phone_captured: createdCaptures.length > 0,
                recovered_from_history: true
              });
            }
            // Tin khách VỪA nhắn (trong 10 phút) mà chỉ đến được qua sync lịch
            // sử - kênh realtime lỡ mất vì tab Facebook đang đậu đúng thread
            // đó nên Facebook tự đánh dấu đã đọc. Bật chưa đọc + phát socket
            // để hội thoại được đẩy lên đầu danh sách ngay.
            const hasRecentIncomingHistory = historyInsertedRows.some((r) => {
              const atMs = Number(r.timestamp_ms) || Date.parse(r.created_at || '') || 0;
              return atMs >= Date.now() - 10 * 60 * 1000;
            });
            if (hasRecentIncomingHistory) {
              const historyManualState = db.prepare('SELECT unread_manual FROM threads WHERE id = ?').get(thread_id);
              // Chỉ gắn chưa đọc khi user CHƯA từng đọc tay (manual = 0).
              // manual = -1 nghĩa là user vừa mở/đánh dấu đã đọc: history sync
              // chèn chính tin khách mà user đang đọc, nếu gắn lại is_unread
              // thì hội thoại đã đọc lại nhảy lên đầu đánh dấu chưa đọc sau
              // mỗi lần reload. manual = 1 thì cờ dính tin mới đã bật rồi.
              if (Number(historyManualState?.unread_manual || 0) === 0) {
                db.prepare('UPDATE threads SET is_unread = 1, unread_manual = 0 WHERE id = ?').run(thread_id);
                io.emit('THREAD_UNREAD_CHANGED', { thread_id: String(thread_id), is_unread: 1 });
              }
            }
            const collapsedMediaCompanions = OutboundDomCorrelationService.collapseStoredMediaCompanions(db, thread_id);
            const collapsedTemporaryIds = OutboundDomCorrelationService.collapseStoredTemporaryIdUpgrades(db, thread_id);
            const reconciledDomRows = ConversationRepository.reconcileObservedDomSequence(thread_id, sequencedMessages, db);
            // A DOM page numbers its rows locally from zero. Merging multiple
            // pages and realtime rows otherwise leaves duplicate/gapped ranks,
            // which makes old messages appear below newer ones in the CRM.
            ConversationRepository.normalizeMessageSequence(thread_id, db);
            if (collapsedMediaCompanions || collapsedTemporaryIds) {
              console.log('[OUTBOUND_TRACE]', JSON.stringify({
                stage: 'BACKEND_HISTORY_MEDIA_ECHO_COLLAPSED',
                thread_id: String(thread_id),
                  media_companions: collapsedMediaCompanions,
                  temporary_ids: collapsedTemporaryIds,
                  reordered_dom_rows: reconciledDomRows,
                at: new Date().toISOString()
              }));
            }
            // Publish the snapshot immediately. Persisting Facebook media is
            // background work; a large or expired video URL must not block
            // history sync or the outbound composer.
            inboundMediaHydration.hydrateThread(thread_id);
            const deltaIds = [...persistence.insertedIds, ...persistence.updatedIds];
            const fetchedTotal = Number.isFinite(Number(fetched_count)) ? Number(fetched_count) : messages.length;
            const skippedTotal = Math.max(0, fetchedTotal - deltaIds.length);
            console.log(`[WS] Diagnostics thread=${thread_id}: fetched=${fetchedTotal} inserted=${persistence.insertedIds.length} updated=${persistence.updatedIds.length} skipped=${skippedTotal}`);

            if (checkpoint) {
              resolvedSyncStatus = HistorySyncManager.resolveStatusFromCheckpoint(checkpoint);
              HistorySyncManager.updateSyncStatus(thread_id, resolvedSyncStatus, checkpoint);
              console.log(`[WS] History sync status thread=${thread_id}: ${resolvedSyncStatus} (stop_reason=${checkpoint.stop_reason || 'n/a'})`);
            }

            const latest = validMessages.reduce((currentLatest, candidate) => {
              if (!currentLatest) return candidate;
              const candidateTime = Number(candidate.timestamp_ms) || new Date(candidate.created_at || 0).getTime();
              const latestTime = Number(currentLatest.timestamp_ms) || new Date(currentLatest.created_at || 0).getTime();
              return candidateTime >= latestTime ? candidate : currentLatest;
            }, null);
            if (latest) {
              const latestTimestamp = Number(latest.timestamp_ms) || new Date(latest.created_at || 0).getTime();
              ConversationRepository.touchThreadFromHistory(thread_id, latest.content, latestTimestamp);
            }

            if (deltaIds.length === 0) {
              // Overlapping virtual pages can contain only rows already in
              // SQLite. The checkpoint may still have advanced, so keep the
              // continuation state machine alive instead of leaving the
              // thread permanently PARTIAL/spinning.
              console.log(`[WS] History page contained no DB delta; continue checkpoint evaluation thread=${thread_id}`);
            }
            // Refresh the CRM from the authoritative DB snapshot after every
            // user-requested history page, including an overlap-only page.
            const syncedRows = db.prepare(`
              SELECT * FROM messages WHERE thread_id = ?
              ORDER BY COALESCE(sequence_order, id) ASC, id ASC
            `).all(thread_id);
            const cleanMsgs = prepareMessagesForClient(syncedRows);

            io.emit('THREAD_MESSAGES_UPDATED', {
              thread_id,
              messages: cleanMsgs,
              authoritative: true,
              sync_status: resolvedSyncStatus
            });
          } else {
             // Empty messages list but no error means we might have reached the end or just no new messages
             if (checkpoint) {
               resolvedSyncStatus = HistorySyncManager.resolveStatusFromCheckpoint(checkpoint);
               HistorySyncManager.updateSyncStatus(thread_id, resolvedSyncStatus, checkpoint);
               console.log(`[WS] History sync status thread=${thread_id}: ${resolvedSyncStatus} (stop_reason=${checkpoint.stop_reason || 'n/a'})`);
             }
             // A virtualized Messenger viewport can briefly expose zero rows
             // while React swaps pages. Zero newly parsed rows does not mean
             // the authoritative thread is empty. Re-emit the persisted
             // snapshot so the CRM never wipes or freezes its existing list.
             const persistedRows = db.prepare(`
               SELECT * FROM messages WHERE thread_id = ?
               ORDER BY COALESCE(sequence_order, id) ASC, id ASC
             `).all(thread_id);
             io.emit('THREAD_MESSAGES_UPDATED', {
               thread_id,
               messages: prepareMessagesForClient(persistedRows),
               authoritative: true,
               sync_status: resolvedSyncStatus
             });
          }

          const historyJobKey = String(account_id);
          const activeJob = historyBackfillJobs.get(historyJobKey);
          const isActiveProgressiveJob = activeJob && String(activeJob.threadId) === String(thread_id);
          const checkpointOldestId = String(checkpoint?.oldest_message_id || '');
          if (isActiveProgressiveJob) {
            if (checkpointOldestId && checkpointOldestId !== activeJob.lastOldestMessageId) {
              activeJob.lastOldestMessageId = checkpointOldestId;
              activeJob.stalledBatches = 0;
            } else {
              activeJob.stalledBatches = Number(activeJob.stalledBatches || 0) + 1;
            }
          }
          const transientNoGrowth = resolvedSyncStatus === 'SYNCED'
            && checkpoint?.stop_reason === 'no_scroll_growth'
            && Number(activeJob?.stalledBatches || 0) < 4;
          if ((resolvedSyncStatus === 'PARTIAL' || transientNoGrowth) && isActiveProgressiveJob) {
            const generation = activeJob.generation;
            activeJob.batches += 1;
            if (activeJob.batches <= 500) {
              setTimeout(() => {
                const latestJob = historyBackfillJobs.get(historyJobKey);
                if (!latestJob || latestJob.generation !== generation || String(latestJob.threadId) !== String(thread_id)) return;
                const extWs = extensionConnections.get(account_id);
                if (!extWs || extWs.readyState !== WebSocket.OPEN) return;
                const threadRow = db.prepare('SELECT thread_url, contact_name FROM threads WHERE id = ?').get(thread_id);
                const pageSource = ConversationRepository.getThreadSource(thread_id);
                extWs.send(JSON.stringify({
                  type: 'SYNC_THREAD_MESSAGES',
                  data: {
                    account_id,
                    thread_id,
                    thread_url: threadRow?.thread_url || null,
                    page_id: pageSource?.pageId || null,
                    mode: 'deep_backfill',
                    cursor: checkpoint,
                    contact_name: threadRow?.contact_name || null,
                    reason: 'crm_navigation',
                    allow_navigation: true
                  }
                }));
                console.log(`[WS] Continue deep-backfill batch ${latestJob.batches} for thread=${thread_id}`);
              }, 350);
            } else {
              HistorySyncManager.updateSyncStatus(thread_id, 'FAILED', checkpoint, 'BACKFILL_BATCH_LIMIT');
              historyBackfillJobs.delete(historyJobKey);
            }
          } else if (resolvedSyncStatus === 'SYNCED' && isActiveProgressiveJob) {
            historyBackfillJobs.delete(historyJobKey);
          }
          break;
        }
        case 'PAGE_NAME_DETECTED': {
          const pageId = String(msg.data?.page_id || '');
          const pageName = String(msg.data?.page_name || '').trim();
          if (pageId && pageName) {
            console.log(`[WS] 🏷️ Nhận PAGE_NAME_DETECTED: page=${pageId}, name="${pageName}"`);
            const updatedSource = InboxSourceService.updatePageDisplayName({ pageId, pageName }, db);
            if (updatedSource) {
              io.emit('INBOX_SOURCE_UPDATED', updatedSource);
              io.emit('THREAD_LIST_UPDATED');
            }
          }
          break;
        }
        case 'PAGE_EXTENSION_READY': {
          const pageId = String(msg.data?.page_id || '');
          const accountId = String(ws.accountId || msg.data?.account_id || '');
          const pageName = msg.data?.page_name ? String(msg.data.page_name).trim() : null;
          // Tab fallback /messages/t/<id-giả> (ID profile/delegate 6155xxx-6159xxx)
          // cũng bắn READY - chặn để không tái tạo source page rác.
          if (isSuspiciousPageId(pageId)) {
            console.warn(`[PageSync] Bỏ qua PAGE_EXTENSION_READY với ID profile/delegate ${pageId} (account=${accountId}).`);
            break;
          }
          if (pageId && pageName) {
            InboxSourceService.updatePageDisplayName({ pageId, pageName }, db);
          }
          let source = pageId && accountId ? db.prepare(`
            SELECT id FROM inbox_sources
            WHERE source_type = 'page_messenger' AND status = 'ACTIVE'
              AND external_id = ? AND owner_account_id = ?
          `).get(pageId, accountId) : null;
          if (!source && pageId && accountId) {
            // Page source chưa tồn tại hoặc chưa bind owner (row tự tạo bởi
            // scan Business Suite TRƯỚC khi page được kết nối). Business tab
            // này nằm trong Chrome của account đã đăng ký (ws.accountId) ->
            // tự đăng ký/gắn owner thay vì bỏ qua. Bỏ qua step này tạo deadlock:
            // gate READY chờ PAGE_EXTENSION_READY, mà READY bị từ chối,
            // owner chỉ được bind sau đó bởi sidebar sync -> không bao giờ mở.
            try {
              InboxSourceService.ensurePageSource({ pageId, accountId, pageName }, db);
              source = db.prepare(`
                SELECT id FROM inbox_sources
                WHERE source_type = 'page_messenger' AND status = 'ACTIVE'
                  AND external_id = ? AND owner_account_id = ?
              `).get(pageId, accountId);
              if (source) console.log(`[PageSync] Tự đăng ký/gắn owner page=${pageId} cho account=${accountId} lúc READY.`);
            } catch (regErr) {
              console.warn(`[PageSync] Tự đăng ký page=${pageId} thất bại:`, regErr.message);
            }
          }
          if (!source) {
            console.warn(`[PageSync] Ignored unregistered Page context account=${accountId} page=${pageId}`);
            break;
          }
          const key = pageConnectionKey(accountId, pageId);
          pageExtensionConnections.set(key, ws);
          ws.pageConnectionKeys = ws.pageConnectionKeys || new Set();
          ws.pageConnectionKeys.add(key);
          // Mở gate dispatch cho lane Page này (job đang chờ sẽ được đẩy đi).
          InboxSyncScheduler.markPageReady(pageId, accountId);
          console.log(`[PageSync] Page extension ready account=${accountId} page=${pageId}`);
          if (InboxSyncScheduler.isSyncWindowActive(accountId) && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'SYNC_PAGE_SIDEBAR', data: { account_id: accountId, page_id: pageId, reason: 'page_ready' } }));
          }
          break;
        }
        case 'ACCOUNT_PAGES_DISCOVERED': {
          const accountId = String(msg.data?.account_id || ws.accountId || '');
          const pages = Array.isArray(msg.data?.pages) ? msg.data.pages : [];
          if (!accountId) break;

          // Lọc bỏ tài khoản cá nhân + ID profile/delegate 6155xxx-6159xxx +
          // profile trùng tên chủ account (mở Business Suite bị chặn ngay).
          const accountName = getAccountName(accountId);
          const filteredPages = pages.filter(p => String(p.page_id) !== accountId
            && !isGenericPageName(p?.name)
            && !isSuspiciousPageId(p?.page_id)
            && !isOwnerSelfSourceName(p?.name, accountName));

          console.log(`[WS] 📄 Nhận ACCOUNT_PAGES_DISCOVERED cho account=${accountId}, số trang=${filteredPages.length}`);
          try {
            // Debug file: payload quet thuc te tu extension (raw + sau loc) -
            // dung truy vet page thieu / sai ID ma khong phai doan mo.
            const dump = (tag, list) => JSON.stringify({
              at: new Date().toISOString(),
              tag,
              account_id: accountId,
              count: list.length,
              pages: list.map(p => ({
                id: String(p?.page_id || ''),
                name: String(p?.name || '').slice(0, 90),
                id_source: p?.id_source || null,
                source_url: p?.source_url || null,
                context_id: p?.context_id || null,
                dropped: !!p?.dropped,
                drop_reason: p?.drop_reason || null,
                alias_ids: p?.alias_ids || null,
                url_params: p?.url_params || null,
                raw_fragment: String(p?.raw_fragment || '').slice(0, 1400) || null
              }))
            });
            fs.appendFileSync(path.join(APP_DATA_ROOT, 'discovery-debug.log'), dump('raw', pages) + '\n');
            fs.appendFileSync(path.join(APP_DATA_ROOT, 'discovery-debug.log'), dump('filtered', filteredPages) + '\n');
          } catch (_) {}
          discoveredPagesByAccount.set(accountId, {
            pages: filteredPages,
            updatedAt: Date.now()
          });

          // Tự động gắn owner cho các source NULL trùng page_id hoặc trùng display_name (tận dụng auto-bind)
          try {
            for (const p of filteredPages) {
              const pid = String(p.page_id || '');
              const pname = (p.name || '').trim();
              if (pid) {
                const matched = db.prepare(`
                  SELECT id FROM inbox_sources
                  WHERE (external_id = ? OR (display_name = ? AND display_name != ''))
                    AND source_type = 'page_messenger' AND owner_account_id IS NULL
                `).all(pid, pname);
                for (const m of matched) {
                  db.prepare('UPDATE inbox_sources SET owner_account_id = ? WHERE id = ?')
                    .run(accountId, m.id);
                  // Hội thoại page từng rời account (chủ cũ xóa khi là account cuối)
                  // — gắn lại để inbox của account này hiển thị đủ lịch sử.
                  db.prepare('UPDATE threads SET account_id = ? WHERE source_id = ? AND account_id IS NULL')
                    .run(accountId, m.id);
                  console.log(`[WS] 🔗 Đã tự động gắn owner=${accountId} cho page_source=${pid} (${pname})`);
                }
              }
            }
          } catch (bindErr) {
            console.warn('[WS] Lỗi khi auto-bind owner cho pages discovered:', bindErr.message);
          }

          io.emit('PAGES_DISCOVERED', {
            account_id: accountId,
            pages: filteredPages,
            updated_at: Date.now()
          });
          break;
        }
        case 'PAGE_URL_DEBUG': {
          // (Phase 0 debug) Kênh 2: cặp asset_id/mailbox_id thực tế trên URL
          // tab Business Suite - ghi thẳng vào discovery-debug.log.
          try {
            fs.appendFileSync(path.join(APP_DATA_ROOT, 'discovery-debug.log'), JSON.stringify({ at: new Date().toISOString(), tag: 'PAGE_URL_DEBUG', account_id: String(msg.data?.account_id || ws.accountId || ''), asset_id: String(msg.data?.asset_id || ''), mailbox_id: String(msg.data?.mailbox_id || ''), title: String(msg.data?.title || '').slice(0, 90), url: String(msg.data?.url || '').slice(0, 300) }) + '\n');
          } catch (_) {}
          break;
        }
        case 'BS_DOM_DEBUG': {
          try {
            const entry = msg.data || {};
            const prefix = `[BS_DOM_DEBUG][${entry.stage || 'INFO'}]`;
            console.log(`${prefix} ${entry.message || ''}`, entry.details ? JSON.stringify(entry.details) : '');
            fs.appendFileSync(path.join(APP_DATA_ROOT, 'business-suite-debug.log'), JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
          } catch (_) {}
          break;
        }
        case 'UPDATE_LINK_PREVIEW_IMAGE': {
          try {
            const { url_hash, image_url, title } = msg.data || {};
            const hash = String(url_hash || '');
            if (!/^[0-9a-f]{40}$/.test(hash)) break;
            const safeTitle = (typeof title === 'string' && title.trim()) ? title.trim().slice(0, 200) : null;
            if ((!image_url || !/^https?:\/\//i.test(String(image_url))) && !safeTitle) break;
            // Tai anh ve local - URL lookaside/scontent cua FB la tam thoi
            let stored = String(image_url);
            try {
              const localFile = await saveAvatarFromBase64OrUrl(stored, 'link_' + hash);
              if (localFile) stored = '/api/avatars/' + localFile;
            } catch (_) {}
            db.prepare('UPDATE link_previews SET image_url = COALESCE(?, image_url), title = COALESCE(?, title) WHERE url_hash = ?')
              .run(stored, safeTitle, hash);
            console.log('[LINK_PREVIEW] Ảnh bổ sung từ extension cho hash ' + hash.slice(0, 10) + '…');
          } catch (_) {}
          break;
        }

        case 'UPDATE_PAGE_PROFILE': {
          // Extension mo tab profile Page va doc ten + avatar that ( cung co
          // che voi operator profile). Cap nhat inbox_sources: display_name
          // chi thay the ten generic "Page <id>"; avatar luu qua avatarManager.
          try {
            const { page_id, name, avatar_url } = msg.data || {};
            const pid = String(page_id || '').trim();
            if (!/^\d+$/.test(pid)) break;
            const safeName = (typeof name === 'string' ? name.trim() : '').slice(0, 120);
            const safeAvatar = (typeof avatar_url === 'string' && avatar_url.startsWith('https://')) ? avatar_url : null;
            let avatarFile = null;
            if (safeAvatar) {
              avatarFile = await saveAvatarFromBase64OrUrl(safeAvatar, 'page_' + pid);
            }
            const src = db.prepare("SELECT id, display_name FROM inbox_sources WHERE source_type = 'page_messenger' AND external_id = ?").get(pid);
            if (!src) break;
            const genericName = new RegExp('^Page ' + pid + '$', 'i');
            const nextName = safeName && (!src.display_name || genericName.test(src.display_name)) ? safeName : (safeName || src.display_name);
            db.prepare('UPDATE inbox_sources SET display_name = ?, avatar_url = COALESCE(?, avatar_url) WHERE id = ?')
              .run(nextName || src.display_name, avatarFile ? '/api/avatars/' + avatarFile : null, src.id);
            io.emit('INBOX_SOURCES_UPDATED', { source_id: src.id, page_id: pid, display_name: nextName || src.display_name, avatar_url: avatarFile ? '/api/avatars/' + avatarFile : null });
            console.log(`[PAGE_SOURCE] Da cap nhat profile Page ${pid}: name="${nextName}", avatar=${avatarFile ? 'yes' : 'no'}`);
          } catch (e) {
            console.warn('[PAGE_SOURCE] UPDATE_PAGE_PROFILE loi:', e.message);
          }
          break;
        }

        case 'PAGE_THREAD_MESSAGES_SYNCED_V1': {
          const envelope = msg.data || {};
          const { verifyPageOwnership } = require('./utils/pageContextResolver');
          const pageThreadId = String(envelope.thread_id || '');
          const authenticatedAccountId = String(ws.accountId || '');
          const pageId = String(envelope.page_id || '');
          const ackBase = { thread_id: pageThreadId, session_epoch: envelope.session_epoch, generation: envelope.generation, scan_id: envelope.scan_id };
          if (!pageThreadId || !pageId || !authenticatedAccountId || (envelope.account_id && String(envelope.account_id) !== authenticatedAccountId)) {
            const ack = { ...ackBase, status: 'rejected', reason: 'invalid_authenticated_page_context' };
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'PAGE_BATCH_ACK', data: ack }));
            break;
          }
          try {
            if (!verifyPageOwnership(authenticatedAccountId, pageId, db)) {
              const ack = { ...ackBase, status: 'rejected', reason: 'unauthorized_page_ownership' };
              InboxSyncScheduler.markThreadSyncResult(authenticatedAccountId, pageThreadId, ack.reason);
              if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'PAGE_BATCH_ACK', data: ack }));
              break;
            }
            const source = InboxSourceService.getSourceByExternalId('page_messenger', pageId, db);
            if (!source || String(source.owner_account_id || '') !== authenticatedAccountId) {
              const ack = { ...ackBase, status: 'rejected', reason: 'page_source_not_registered' };
              if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'PAGE_BATCH_ACK', data: ack }));
              break;
            }
            // Batch hợp lệ từ tab Business của account -> page đang kết nối thật,
            // mở gate READY (phòng trường hợp READY bị nuốt trước đó).
            InboxSyncScheduler.markPageReady(pageId, authenticatedAccountId);
            const canonicalThreadId = resolveInternalThreadId(db, authenticatedAccountId, pageThreadId, pageId);

            if (envelope.page_name) {
              const updated = InboxSourceService.updatePageDisplayName({ pageId, pageName: envelope.page_name }, db);
              if (updated) {
                io.emit('INBOX_SOURCE_UPDATED', updated);
                io.emit('THREAD_LIST_UPDATED');
              }
            }
            let safePageContactName = cleanContactName(envelope.contact_name, null);
            if (isInvalidContactName(safePageContactName)) safePageContactName = null;
            const existingPageThread = db.prepare('SELECT contact_name FROM threads WHERE id = ?').get(canonicalThreadId);
            if (existingPageThread?.contact_name && !isInvalidContactName(existingPageThread.contact_name) && existingPageThread.contact_name !== 'Khách hàng') {
              safePageContactName = safePageContactName || existingPageThread.contact_name;
            }

            // Không bao giờ hạ cấp preview: batch rỗng/rác -> truyền null để
            // upsertThread COALESCE giữ nguyên last_message thật trong DB
            // (trước đây 'Chưa có tin nhắn' đè lên preview thật mỗi lần sync).
            const lastIncomingContent = Array.isArray(envelope.messages) && envelope.messages.length
              ? (cleanMessageText(envelope.messages[envelope.messages.length - 1].content) || null)
              : null;

            // Hard-code is_unread: 0 ở đây từng làm tin nhắn mới của khách
            // qua Page không bao giờ nổi lên (đè trạng thái chưa đọc ngay sau
            // khi kênh realtime bật). Giờ tôn trọng cờ đánh tay + tin mới
            // trong 10 phút qua Page mới bật chưa đọc; còn lại giữ nguyên.
            const pageManualState = db.prepare('SELECT unread_manual FROM threads WHERE id = ?').get(canonicalThreadId);
            const pageManual = Number(pageManualState?.unread_manual || 0);
            const hasRecentIncomingPage = Array.isArray(envelope.messages) && envelope.messages.some((pm) => {
              if (pm.is_outgoing === true || pm.is_outgoing === 1) return false;
              const atMs = Number(pm?.timestamp_ms) || Date.parse(pm?.created_at || '') || 0;
              return atMs >= Date.now() - 10 * 60 * 1000;
            });
            // Tin khách MỚI HƠN tin trả lời cuối của operator mới đủ điều kiện
            // đè cờ ghim -1: passive batch relay lại tin cũ đã trả lời (chỉ
            // trong cửa sổ 10') không được bật lại chưa đọc.
            const lastOutgoingTsRow = db.prepare('SELECT MAX(COALESCE(timestamp_ms, 0)) AS ts FROM messages WHERE thread_id = ? AND is_outgoing = 1').get(canonicalThreadId);
            const lastOutgoingTs = Number(lastOutgoingTsRow?.ts || 0);
            const hasNewerIncomingPage = !lastOutgoingTs ? hasRecentIncomingPage : (Array.isArray(envelope.messages) && envelope.messages.some((pm) => {
              if (pm.is_outgoing === true || pm.is_outgoing === 1) return false;
              const atMs = Number(pm?.timestamp_ms) || Date.parse(pm?.created_at || '') || 0;
              return atMs > lastOutgoingTs;
            }));
            let pageUnreadState;
            if (pageManual === 1) pageUnreadState = 1;
            else if (pageManual === -1 && !hasNewerIncomingPage) pageUnreadState = 0;
            else pageUnreadState = hasRecentIncomingPage ? 1 : undefined;
            // Tin khách mới hơn lời trả lời cuối đè cờ ghim -1: mở lại cơ chế
            // tự động, nếu không mọi tin sau của khách luôn ẩn chưa đọc.
            if (pageManual === -1 && hasNewerIncomingPage) {
              db.prepare('UPDATE threads SET unread_manual = 0 WHERE id = ?').run(canonicalThreadId);
            }
            ConversationRepository.upsertThread({
              id: canonicalThreadId,
              external_thread_id: pageThreadId,
              account_id: authenticatedAccountId,
              source_id: source.id,
              contact_name: safePageContactName || 'Khách hàng',
              last_message: lastIncomingContent,
              is_unread: pageUnreadState,
              inbox_folder: 'INBOX'
            }, db);

            let pageAvatar = (envelope.avatar_url && typeof envelope.avatar_url === 'string' && envelope.avatar_url.startsWith('http')) ? envelope.avatar_url : null;
            if (safePageContactName || pageAvatar) {
              db.prepare(`
                INSERT INTO contacts (thread_id, name, avatar_url)
                VALUES (?, ?, ?)
                ON CONFLICT(thread_id) DO UPDATE SET
                  name = COALESCE(excluded.name, contacts.name),
                  avatar_url = COALESCE(excluded.avatar_url, contacts.avatar_url)
              `).run(canonicalThreadId, safePageContactName, pageAvatar);
            }

            // Bổ sung link video đã giải mã từ Web Worker / DOM vào message batch
            if (Array.isArray(envelope.messages)) {
              for (const m of envelope.messages) {
                if (m.fb_message_id && resolvedPageVideos.has(m.fb_message_id)) {
                  const resolved = resolvedPageVideos.get(m.fb_message_id);
                  const vidUrl = resolved.video_url || resolved.media_url;
                  if (vidUrl && (!m.media_url || !m.media_url.startsWith('http')) && m.content !== '👍') {
                    m.media_url = vidUrl;
                    m.media_type = 'video';
                  }
                }
              }
            }

            const ack = ConversationRepository.processPageBatchEnvelope({
              ...envelope,
              thread_id: canonicalThreadId,
              account_id: authenticatedAccountId,
              page_id: pageId,
              source_id: source.id
            }, db);
            pageBatchStats.total += 1;
            if (ack.status === 'committed' || ack.status === 'duplicate' || ack.status === 'stale_generation') {
              pageBatchStats[ack.status] += 1;
            } else {
              pageBatchStats.other += 1;
            }
            if (pageBatchStats.total % 100 === 0) {
              console.log(`[PAGE_BATCH_STATS] total=${pageBatchStats.total} committed=${pageBatchStats.committed} duplicate=${pageBatchStats.duplicate} stale=${pageBatchStats.stale_generation} other=${pageBatchStats.other}`);
            }
            const syncReason = ack.reached_top ? 'reached_top' : (ack.status === 'committed' ? null : (ack.reason || 'page_batch_rejected'));
            InboxSyncScheduler.markThreadSyncResult(authenticatedAccountId, canonicalThreadId, syncReason, pageId);
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'PAGE_BATCH_ACK', data: { ...ack, thread_id: pageThreadId } }));
            }
            if (ack.reached_top) {
              io.emit('THREAD_HISTORY_COMPLETED', { thread_id: canonicalThreadId, account_id: authenticatedAccountId });
            }
            const persistedRows = db.prepare('SELECT * FROM messages WHERE thread_id = ? ORDER BY COALESCE(sequence_order, id) ASC, id ASC').all(canonicalThreadId);
            const threadRow = db.prepare('SELECT history_completed FROM threads WHERE id = ?').get(canonicalThreadId);
            io.emit('THREAD_MESSAGES_UPDATED', {
              thread_id: canonicalThreadId,
              account_id: authenticatedAccountId,
              messages: prepareMessagesForClient(persistedRows),
              authoritative: true,
              sync_status: ack.status === 'committed' || ack.status === 'duplicate' ? 'SYNCED' : 'FAILED',
              sync_error: ack.reason || null,
              history_completed: threadRow?.history_completed || (ack.reached_top ? 1 : 0)
            });
          } catch (error) {
            console.error('[PAGE_BATCH] ingest failed:', error.message);
            const ack = { ...ackBase, status: 'retry_required', reason: 'page_batch_ingest_failed' };
            InboxSyncScheduler.markThreadSyncResult(authenticatedAccountId, pageThreadId, ack.reason, pageId);
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'PAGE_BATCH_ACK', data: ack }));
          }
          break;
        }

        case 'PAGE_MESSAGE_MEDIA_RESOLVED': {
          const { thread_id, fb_message_id, poster_url } = msg.data || {};
          const video_url = msg.data?.video_url || msg.data?.media_url;
          if (video_url) {
            if (fb_message_id) {
              resolvedPageVideos.set(fb_message_id, { video_url, media_url: video_url, poster_url, time: Date.now() });
              if (resolvedPageVideos.size > 200) {
                const oldestKey = resolvedPageVideos.keys().next().value;
                resolvedPageVideos.delete(oldestKey);
              }
            }

            let targetRow = null;
            if (fb_message_id) {
              targetRow = db.prepare('SELECT * FROM messages WHERE fb_message_id = ?').get(fb_message_id);
            }
            if (!targetRow && thread_id) {
              const canonicalId = resolveInternalThreadId(db, null, thread_id, msg.data?.page_id || null);
              targetRow = db.prepare(`
                SELECT * FROM messages
                WHERE (thread_id = ? OR thread_id = ?) AND media_type = 'video' AND (media_url IS NULL OR media_url NOT LIKE 'http%')
                ORDER BY timestamp_ms DESC, id DESC
                LIMIT 1
              `).get(canonicalId, thread_id);
            }

            if (targetRow) {
              let cleanedContent = targetRow.content || '';
              if (/^\s*\d{1,2}(?::\d{2}){1,2}\s*\/\s*\d{1,2}(?::\d{2}){1,2}\s*$/i.test(cleanedContent) ||
                  /^\s*\d{1,2}:\d{2}\s*$/i.test(cleanedContent) ||
                  cleanedContent.trim().toLowerCase() === 'video') {
                cleanedContent = '';
              }

              db.prepare(`
                UPDATE messages
                SET media_url = ?,
                    media_type = 'video',
                    content = ?
                WHERE id = ?
              `).run(video_url, cleanedContent, targetRow.id);

              const updatedRow = db.prepare('SELECT * FROM messages WHERE id = ?').get(targetRow.id);
              if (updatedRow) {
                console.log(`[WS] 🎥 Đã cập nhật video URL cho message ${updatedRow.fb_message_id || updatedRow.id}: ${video_url.substring(0, 60)}...`);
                io.emit('MESSAGE_UPDATED', {
                  thread_id: String(updatedRow.thread_id),
                  fb_message_id: updatedRow.fb_message_id,
                  message: withAttachmentAccessUrl(updatedRow)
                });
                io.emit('THREAD_MESSAGES_UPDATED', {
                  thread_id: String(updatedRow.thread_id),
                  messages: [withAttachmentAccessUrl(updatedRow)]
                });
                inboundMediaHydration.hydrateRow(updatedRow);
              }
            }
          }
          break;
        }

        case 'UPGRADE_MESSAGE_TIMESTAMP': {
          const { thread_id, fb_message_id, timestamp_ms, timestamp_source } = msg.data || {};
          if (thread_id && fb_message_id && timestamp_ms > 0) {
            const updatedMsg = ConversationRepository.upgradeMessageTimestamp(
              thread_id,
              fb_message_id,
              timestamp_ms,
              timestamp_source || 'facebook_label',
              db
            );
            if (updatedMsg) {
              console.log(`[WS] ⏱️ Đã nâng cấp timestamp cho message ${fb_message_id} -> ${new Date(timestamp_ms).toLocaleTimeString('vi-VN')} (${timestamp_source})`);
              io.emit('MESSAGE_UPDATED', {
                thread_id,
                fb_message_id,
                message: withAttachmentAccessUrl(updatedMsg)
              });
            }
          }
          break;
        }
        case 'BULK_HISTORY_SYNC_PROGRESS': {
          const progress = msg.data || {};
          const job = bulkHistoryJobs.get(String(progress.job_id || ''));
          if (!job) break;
          const accountKey = String(progress.account_id || ws.accountId || '');
          job.accounts.set(accountKey, {
            total: Number(progress.total || 0),
            completed: Number(progress.completed || 0),
            failed: Number(progress.failed || 0),
            status: progress.status || 'running',
            error: progress.error || null
          });
          const states = [...job.accounts.values()];
          const aggregate = states.reduce((sum, state) => ({
            total: sum.total + state.total,
            completed: sum.completed + state.completed,
            failed: sum.failed + state.failed
          }), { total: 0, completed: 0, failed: 0 });
          const allTerminal = states.length === job.expectedAccounts
            && states.every((state) => state.status === 'completed' || state.status === 'failed');
          io.emit('BULK_HISTORY_SYNC_PROGRESS', {
            job_id: job.id,
            status: allTerminal ? 'completed' : 'running',
            ...aggregate,
            error: progress.error || null
          });
          if (allTerminal) bulkHistoryJobs.delete(job.id);
          break;
        }

        case 'QUEUED_MESSAGE_RESULT': {
          // Previously missing entirely: handleSendQueuedMessage (background.js)
          // always sends this back after processing a queued Page send, but
          // with no case for it here it fell to `default: break` - silently
          // dropped. That's why every message_queue row, going back days, was
          // stuck at status='processing' forever, and any genuine send
          // failure left the CRM bubble hung in "Đang gửi" with no way to
          // ever learn it failed.
          const { queue_id, success, error, client_message_id, outcome } = msg.data;
          queueWorker.acknowledgeDispatch(queue_id);
          console.log(`[WS] QUEUED_MESSAGE_RESULT: queue_id=${queue_id} success=${success} error=${error || 'none'}`);
          const richQueue = db.prepare(
            'SELECT * FROM message_queue WHERE id = ? AND outbound_attempt_id IS NOT NULL'
          ).get(queue_id);
          if (richQueue) {
            const outcome = msg.data.outcome;
            const dispatched = outcome === 'dispatched' ||
              error === 'COMPOSER_DISPATCHED_WAITING_CONFIRMATION' ||
              (outcome == null && success === true);
            if (dispatched) {
              OutboundAttemptRepository.transition(
                richQueue.outbound_attempt_id,
                ['queued', 'dispatching'],
                'awaiting_confirmation',
                {
                  dispatch_method: msg.data.adapter_version || 'rich-message-v1',
                  dispatched_at: new Date().toISOString()
                },
                db
              );
              const attempt = OutboundAttemptRepository.getById(
                richQueue.outbound_attempt_id,
                db
              );
              const message = attempt
                ? db.prepare('SELECT * FROM messages WHERE id = ?').get(attempt.message_id)
                : null;
              if (message) {
                io.emit('MESSAGE_SEND_STATUS', {
                  thread_id: message.thread_id,
                  client_message_id: message.client_message_id,
                  message_id: message.id,
                  attempt_id: attempt.id,
                  status: 'awaiting_confirmation',
                  fb_message_id: null,
                  confirmation_source: null,
                  error: null,
                  updated_at: new Date().toISOString()
                });
                // 'dispatched' chỉ được gửi sau khi waitForAttachmentDomConfirmation
                // đã thấy tin hiện thật trong khung chat Messenger - nghĩa là tin
                // ĐÃ tới người nhận. Đổi "sent" ngay thay vì chờ echo chính thức
                // (video Facebook xử lý/xuất echo rất lâu, có lần pending cả vài
                // phút trong khi khách đã nhận tin từ lâu). fb_message_id để null,
                // echo tới sau vẫn điền như cũ và không bị trùng vì dedup đọc
                // delivery_status='sent' như một merge point.
                if (message.delivery_status === 'pending') {
                  db.prepare(
                    "UPDATE messages SET delivery_status = 'sent', delivery_error = NULL WHERE id = ? AND delivery_status = 'pending'"
                  ).run(message.id);
                  io.emit('MESSAGE_SENT', {
                    thread_id: message.thread_id,
                    client_message_id: message.client_message_id,
                    success: true,
                    fb_message_id: null,
                    status: 'sent'
                  });
                }
              }

              // Auto-fail watchdog: if this attachment attempt is still stuck
              // in awaiting_confirmation after 3 minutes, fail it so the queue
              // is not blocked and the next text/image send can proceed.
              if (richQueue.attachment_id) {
                const watchdogAttemptId = richQueue.outbound_attempt_id;
                const watchdogQueueId = queue_id;
                const ATTACHMENT_CONFIRMATION_TIMEOUT_MS = 3 * 60 * 1000;
                setTimeout(() => {
                  try {
                    const liveAttempt = OutboundAttemptRepository.getById(watchdogAttemptId, db);
                    if (!liveAttempt || liveAttempt.status !== 'awaiting_confirmation') return;
                    console.warn(`[WS] Attachment confirmation watchdog: attempt ${watchdogAttemptId} still awaiting after 3min, failing.`);
                    const didFail = OutboundAttemptRepository.transition(
                      watchdogAttemptId,
                      ['awaiting_confirmation'],
                      'failed',
                      { error_code: 'CONFIRMATION_TIMEOUT', error_message: 'No Facebook message id received within 3 minutes' },
                      db
                    );
                    if (!didFail) return; // already resolved by DOM observation
                    OutboundAttachmentRepository.transition(
                      richQueue.attachment_id,
                      ['queued', 'sending'],
                      'failed',
                      { validation_error: 'CONFIRMATION_TIMEOUT' },
                      db
                    );
                    MessageQueueRepository.updateStatus(watchdogQueueId, 'failed', 'CONFIRMATION_TIMEOUT', db);
                    const timedOutMessage = liveAttempt.message_id
                      ? db.prepare('SELECT * FROM messages WHERE id = ?').get(liveAttempt.message_id)
                      : null;
                    if (timedOutMessage) {
                      db.prepare(`UPDATE messages SET delivery_status = 'failed', delivery_error = 'CONFIRMATION_TIMEOUT' WHERE id = ?`)
                        .run(timedOutMessage.id);
                      io.emit('MESSAGE_SEND_STATUS', {
                        thread_id: timedOutMessage.thread_id,
                        client_message_id: timedOutMessage.client_message_id,
                        message_id: timedOutMessage.id,
                        attempt_id: watchdogAttemptId,
                        status: 'failed',
                        fb_message_id: null,
                        error: { code: 'CONFIRMATION_TIMEOUT', message: 'Không nhận được xác nhận từ Facebook sau 3 phút' },
                        updated_at: new Date().toISOString()
                      });
                    }
                  } catch (watchdogError) {
                    console.error('[WS] Attachment confirmation watchdog error:', watchdogError.message);
                  }
                }, ATTACHMENT_CONFIRMATION_TIMEOUT_MS);
              }

              break;
            }

            const reason = msg.data.error_code || error || 'FACEBOOK_SEND_REJECTED';
            MessageQueueRepository.updateStatus(queue_id, 'failed', reason);
            OutboundAttemptRepository.transition(
              richQueue.outbound_attempt_id,
              ['queued', 'dispatching', 'awaiting_confirmation'],
              'failed',
              { error_code: reason, error_message: error || reason },
              db
            );
            if (richQueue.attachment_id) {
              OutboundAttachmentRepository.transition(
                richQueue.attachment_id,
                ['queued', 'sending'],
                'failed',
                { validation_error: reason },
                db
              );
            }
            const failedAttempt = OutboundAttemptRepository.getById(
              richQueue.outbound_attempt_id,
              db
            );
            if (failedAttempt) {
              const failedMessage = db.prepare('SELECT * FROM messages WHERE id = ?').get(
                failedAttempt.message_id
              );
              db.prepare(
                "UPDATE messages SET delivery_status = 'failed', delivery_error = ? WHERE id = ?"
              ).run(error || reason, failedAttempt.message_id);
              if (failedMessage) {
                io.emit('MESSAGE_SEND_STATUS', {
                  thread_id: failedMessage.thread_id,
                  client_message_id: failedMessage.client_message_id,
                  message_id: failedMessage.id,
                  attempt_id: failedAttempt.id,
                  status: 'failed',
                  fb_message_id: null,
                  confirmation_source: null,
                  error: { code: reason, message: error || reason },
                  updated_at: new Date().toISOString()
                });
              }
            }
            break;
          }

          // Luồng DOM Business Suite (chiến dịch Page gửi qua Chrome admin):
          // extension chỉ báo 'delivered' sau khi confirmPageDomSend đã thấy
          // nội dung tin hiện thật trong khung chat — chốt sent ngay cho cả
          // queue và messages. Đặt TRƯỚC isDispatched vì success=true không
          // kèm error sẽ bị nhận nhầm là 'dispatched' và kẹt processing mãi.
          if (outcome === 'delivered') {
            const domQueue = db.prepare('SELECT * FROM message_queue WHERE id = ?').get(queue_id);
            if (domQueue) {
              if (domQueue.campaign_id) {
                MessageQueueRepository.confirmCampaignComposerDispatch(queue_id, db);
              } else {
                MessageQueueRepository.updateStatus(queue_id, 'sent', null, db);
              }
            }
            // Cập nhật messages cho cả campaign queue và manual fallback.
            // Manual fallback không có message_queue entry — queue_id CHÍNH LÀ
            // id bản ghi messages (fallbackToDom dùng rowId làm queue_id), nên
            // khớp thêm theo id và giữ nguyên client_message_id gốc cho UI.
            const domClientId = 'queue_' + queue_id;
            const domPendingId = 'pending_' + domClientId;
            const updated = db.prepare(`
              UPDATE messages
              SET delivery_status = 'sent', delivery_error = NULL
              WHERE (client_message_id = ? OR fb_message_id = ? OR id = ?) AND is_outgoing = 1
                AND delivery_status = 'pending'
            `).run(domClientId, domPendingId, queue_id);
            if (updated.changes > 0) {
              const domMessage = db.prepare(`
                SELECT * FROM messages
                WHERE (client_message_id = ? OR fb_message_id = ? OR id = ?) AND is_outgoing = 1
                ORDER BY id DESC LIMIT 1
              `).get(domClientId, domPendingId, queue_id);
              if (domMessage) {
                io.emit('NEW_MESSAGE', { ...domMessage, thread_id: domMessage.thread_id });
                io.emit('THREAD_LIST_UPDATED', { thread_id: domMessage.thread_id });
              }
            }
            break;
          }

          // For plain-text queue items (Page sends, Campaign text sends, Personal queued sends):
          const isDispatched = outcome === 'dispatched' ||
            error === 'COMPOSER_DISPATCHED_WAITING_CONFIRMATION' ||
            (success === true && !error && !msg.data.error_code);

          if (isDispatched) {
            // CDP dispatch itself succeeded - not a real confirmation yet. The
            // actual delivery outcome is decided separately via DOM confirmation
            // (the pending-correlation / feature 020 temp-id-upgrade paths in
            // the NEW_MESSAGE_RECEIVED case above). Leave message_queue in
            // 'processing' until/unless a genuine DOM confirmation or failure follows.
            break;
          }

          // Genuine failure (extension not connected, composer never found
          // even after feature 016's poll+reload+poll, CDP dispatch itself
          // threw, contract invalid, etc.) - reuse the exact same failure path QueueWorker
          // already uses for its own EXTENSION_NOT_CONNECTED case, so both
          // failure sources behave identically.
          const failureReason = msg.data.error_code || error || 'SEND_FAILED';
          const queueRow = db.prepare('SELECT thread_id FROM message_queue WHERE id = ?').get(queue_id);
          MessageQueueRepository.updateStatus(queue_id, 'failed', failureReason);
          if (queueWorker.onQueueFail) {
            queueWorker.onQueueFail({ id: queue_id, thread_id: queueRow ? queueRow.thread_id : null }, failureReason);
          }

          // Đồng bộ trạng thái thất bại cho tin nhắn gửi tay (manual send fallback sang DOM).
          // Manual fallback không có message_queue entry — khớp thêm theo id = queue_id.
          // Lỗi kỹ thuật được dịch thành thông báo tiếng Việt để nhân viên hiểu;
          // bubble nhận event bằng client_message_id GỐC (không đổi tên ở fallbackToDom).
          const DOM_FALLBACK_ERROR_TEXT = {
            COMPOSER_NOT_FOUND: 'Không tìm thấy ô soạn tin trên Business Suite — tin chưa được gửi. Hãy thử lại sau vài giây.',
            FAILED_BS_TIMEOUT: 'Chrome admin phản hồi quá chậm — tin chưa được gửi. Hãy bấm "Thử lại".',
            FACEBOOK_TAB_NOT_FOUND: 'Không mở được tab Business Suite — hãy kiểm tra Chrome admin rồi thử lại.',
            THREAD_ROUTE_MISMATCH: 'Tab Business Suite chưa mở đúng hội thoại — tin chưa được gửi. Hãy thử lại.',
            CONTACT_IDENTITY_MISMATCH: 'Tab Business Suite đang mở khách hàng khác — tin chưa được gửi. Hãy thử lại.'
          };
          const failureText = DOM_FALLBACK_ERROR_TEXT[failureReason] || failureReason;
          const domFailClientId = 'queue_' + queue_id;
          const domFailPendingId = 'pending_' + domFailClientId;
          const failUpdated = db.prepare(`
            UPDATE messages
            SET delivery_status = 'failed', delivery_error = ?
            WHERE (client_message_id = ? OR fb_message_id = ? OR id = ?) AND is_outgoing = 1
              AND delivery_status = 'pending'
          `).run(failureText, domFailClientId, domFailPendingId, queue_id);
          if (failUpdated.changes > 0) {
            const failedMsg = db.prepare(`
              SELECT * FROM messages WHERE (client_message_id = ? OR fb_message_id = ? OR id = ?) AND is_outgoing = 1 ORDER BY id DESC LIMIT 1
            `).get(domFailClientId, domFailPendingId, queue_id);
            if (failedMsg) {
              io.emit('NEW_MESSAGE', { ...failedMsg, thread_id: failedMsg.thread_id, account_id: failedMsg.account_id });
              io.emit('MESSAGE_SEND_FAILED', {
                thread_id: failedMsg.thread_id,
                client_message_id: failedMsg.client_message_id,
                success: false,
                status: 'failed',
                error: failureText,
                error_code: failureReason
              });
              io.emit('MESSAGE_SEND_STATUS', {
                thread_id: failedMsg.thread_id,
                client_message_id: failedMsg.client_message_id,
                message_id: failedMsg.id,
                status: 'failed',
                error: { message: failureText },
                updated_at: new Date().toISOString()
              });
            }
          }
          break;
        }

        case 'MSG_UNSEND': {
          const { fb_message_id } = msg.data;
          db.prepare("UPDATE messages SET is_unsent=1 WHERE fb_message_id=?").run(fb_message_id);
          io.emit('MESSAGE_UNSENT', { fb_message_id });
          break;
        }

        case 'CALL_ENDED': {
          // Extension sends this when the call popup window closes.
          // We save a call log message to DB and emit it to CRM via Socket.io.
          const { thread_id: callThreadId, account_id: callAccountId, call_type: callCallType, call_label, duration_text, duration_ms, timestamp_ms: callTs } = msg.data || {};
          if (!callThreadId) break;

          const internalThreadId = resolveInternalThreadId(db, callAccountId || ws.accountId, callThreadId);
          if (!internalThreadId) {
            console.warn(`[WS] CALL_ENDED: Không tìm thấy thread ${callThreadId}`);
            break;
          }

          const callContent = call_label || (callCallType === 'video' ? 'Cuộc gọi video' : 'Cuộc gọi thoại');
          const callFbId = `call_ended_${internalThreadId}_${callTs || Date.now()}`;
          const callTsMs = callTs || Date.now();

          // Save to messages table
          try {
            db.prepare(`
              INSERT OR IGNORE INTO messages
                (thread_id, fb_message_id, sender_id, content, is_outgoing, direction_status, timestamp_ms, created_at)
              VALUES (?, ?, ?, ?, 1, 'confirmed', ?, CURRENT_TIMESTAMP)
            `).run(internalThreadId, callFbId, String(callAccountId || ws.accountId || 'CURRENT_USER'), callContent, callTsMs);
          } catch (dbErr) {
            console.warn('[WS] CALL_ENDED: Lỗi lưu DB:', dbErr.message);
          }

          console.log(`[WS] 📞 CALL_ENDED: ${callContent} (${duration_text || '?'}) thread=${callThreadId}`);

          const storedCallMessage = db.prepare('SELECT * FROM messages WHERE fb_message_id = ?').get(callFbId);
          // Emit to CRM immediately
          io.emit('NEW_MESSAGE', {
            ...(storedCallMessage || {}),
            thread_id: internalThreadId,
            account_id: String(callAccountId || ws.accountId || ''),
            fb_message_id: callFbId,
            content: callContent,
            is_outgoing: true,
            direction_status: 'confirmed',
            source: 'call_log',
            timestamp_ms: callTsMs,
            status: 'sent'
          });
          break;
        }

        default: break;
      }
    } catch (err) {
      console.error('[WS] Error:', err.message); syncDebug('WS_HANDLER_ERROR', { account: ws.accountId || null, error: String(err?.message || err), stack: String(err?.stack || '').split('\n').slice(0, 4).join(' | ') });
    }
  });

  ws.on('close', () => {
    for (const key of ws.pageConnectionKeys || []) {
      if (pageExtensionConnections.get(key) === ws) pageExtensionConnections.delete(key);
    }
    if (ws.accountId) {
      // REGISTER_ACCOUNT replaces an older socket before asking that old
      // socket to close. Its delayed close event must not delete the newer,
      // healthy connection that is already stored for the same account.
      if (extensionConnections.get(ws.accountId) !== ws) return;
      extensionConnections.delete(ws.accountId);
      InboxSyncScheduler.unregisterAccount(ws.accountId);
      domReplaySuppressUntil.delete(ws.accountId);
      const closingAccountId = String(ws.accountId);
      const existingTimer = disconnectGraceTimers.get(closingAccountId);
      if (existingTimer) clearTimeout(existingTimer);
      const graceMs = processManager.getStatus(closingAccountId) === 'RUNNING' ? 15000 : 3000;
      const timer = setTimeout(() => {
        disconnectGraceTimers.delete(closingAccountId);
        const currentWs = extensionConnections.get(closingAccountId);
        if (currentWs && currentWs.readyState === WebSocket.OPEN) return;
        db.prepare("UPDATE accounts SET status='DISCONNECTED' WHERE id=?").run(closingAccountId);
        io.emit('ACCOUNT_STATUS_CHANGED', { account_id: closingAccountId, status: 'DISCONNECTED' });
        io.emit('EXTENSION_CONNECTION_CHANGED', { account_id: closingAccountId, is_connected: false });
      }, graceMs);
      if (typeof timer.unref === 'function') timer.unref();
      disconnectGraceTimers.set(closingAccountId, timer);
    }
  });
});

// ────────────────────────────────────────────────
// Socket.io: Nhân viên gửi tin nhắn → AI auto-pause 30 phút
// ────────────────────────────────────────────────
io.on('connection', (socket) => {
  socket.on('REQUEST_BULK_HISTORY_SYNC', ({ job_id, threads = [] } = {}) => {
    const requested = Array.isArray(threads) ? threads : [];
    const allowed = requested.filter((thread) =>
      thread?.thread_id && enterpriseAccess.canAccessThread(socket.user, thread.thread_id)
    );
    const groups = new Map();
    for (const thread of allowed) {
      const row = db.prepare('SELECT id, account_id, thread_url, contact_name, source_id FROM threads WHERE id = ?').get(thread.thread_id);
      if (!row?.account_id) continue;
      const source = ConversationRepository.getThreadSource(row.id);
      if (source?.sourceType === 'page_messenger') continue;
      const key = String(row.account_id);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({
        thread_id: String(row.id),
        thread_url: row.thread_url || thread.thread_url || null,
        contact_name: row.contact_name || thread.contact_name || null
      });
    }

    const id = String(job_id || require('crypto').randomUUID());
    const connectedGroups = [...groups.entries()].filter(([accountId]) => {
      const extWs = extensionConnections.get(accountId);
      return extWs && extWs.readyState === WebSocket.OPEN;
    });
    if (connectedGroups.length === 0) {
      socket.emit('BULK_HISTORY_SYNC_PROGRESS', { job_id: id, status: 'completed', total: 0, completed: 0, failed: allowed.length, error: 'EXTENSION_NOT_CONNECTED' });
      return;
    }

    bulkHistoryJobs.set(id, { id, expectedAccounts: connectedGroups.length, accounts: new Map() });
    socket.emit('BULK_HISTORY_SYNC_PROGRESS', { job_id: id, status: 'running', total: allowed.length, completed: 0, failed: 0 });
    for (const [accountId, accountThreads] of connectedGroups) {
      extensionConnections.get(accountId).send(JSON.stringify({
        type: 'BULK_HISTORY_SYNC',
        data: { job_id: id, account_id: accountId, threads: accountThreads }
      }));
    }
  });

  socket.on('SET_SIDEBAR_SYNC_WINDOW', ({ enabled, duration_ms = 60000, account_ids = [] } = {}) => {
    const requestedIds = Array.isArray(account_ids) && account_ids.length
      ? account_ids.map((id) => String(id || '')).filter(Boolean)
      : enterpriseAccess.listAccounts(socket.user).map((account) => String(account.id));
    const allowedIds = [...new Set(requestedIds)].filter((accountId) => enterpriseAccess.canAccessAccount(socket.user, accountId));
    const states = allowedIds.map((accountId) => {
      const state = enabled === true
        ? { account_id: accountId, ...InboxSyncScheduler.startSyncWindow(accountId, duration_ms) }
        : { account_id: accountId, ...InboxSyncScheduler.stopSyncWindow(accountId, 'operator_toggle') };
      if (enabled === true) dispatchPageSidebarSync(accountId, 'manual_sync_window');
      return state;
    });
    const expiresAt = states.reduce((latest, state) => Math.max(latest, Number(state.expires_at || 0)), 0);
    socket.emit('SIDEBAR_SYNC_WINDOW_STATE', {
      enabled: enabled === true && states.length > 0,
      expires_at: expiresAt,
      accounts: states
    });
  });

  socket.on('REQUEST_SYNC_THREADS', ({ account_id }) => {
    if (!account_id) return;
    dispatchPageSidebarSync(account_id, 'manual_crm_request');
    if (!InboxSyncScheduler.requestSidebarSync(account_id, 'crm_manual', { force: true })) {
      console.warn(`[Socket.io] Extension cho account ${account_id} chưa sẵn sàng WebSocket.`);
    }
  });

  socket.on('REQUEST_SYNC_MESSAGE_REQUESTS', ({ account_id } = {}) => {
    const accountId = String(account_id || '');
    if (!accountId || !enterpriseAccess.canAccessAccount(socket.user, accountId)) return;
    InboxSyncScheduler.requestMessageRequestsSync(accountId, 'crm_waiting_tab');
  });

  socket.on('MESSAGE_REQUEST_ACTION', ({ request_id, thread_id, action } = {}) => {
    const requestId = String(request_id || '');
    const threadId = String(thread_id || '');
    const requestedAction = String(action || 'query');
    if (!requestId || !threadId || !['query', 'accept', 'continue', 'delete', 'block'].includes(requestedAction)) {
      socket.emit('MESSAGE_REQUEST_ACTION_RESULT', { request_id: requestId, thread_id: threadId, action: requestedAction, success: false, error: 'Yêu cầu không hợp lệ.' });
      return;
    }
    if (!enterpriseAccess.canAccessThread(socket.user, threadId)) {
      socket.emit('MESSAGE_REQUEST_ACTION_RESULT', { request_id: requestId, thread_id: threadId, action: requestedAction, success: false, error: 'Không có quyền truy cập hội thoại.' });
      return;
    }
    const thread = db.prepare('SELECT id, external_thread_id, account_id, thread_url, contact_name, inbox_folder FROM threads WHERE id = ?').get(threadId);
    if (!thread?.account_id || !['MESSAGE_REQUEST_SPAM', 'MESSAGE_REQUEST_POSSIBLE'].includes(thread.inbox_folder)) {
      socket.emit('MESSAGE_REQUEST_ACTION_RESULT', { request_id: requestId, thread_id: threadId, action: requestedAction, success: false, error: 'Hội thoại không còn ở Tin nhắn chờ.' });
      return;
    }
    const extension = extensionConnections.get(String(thread.account_id));
    if (!extension || extension.readyState !== WebSocket.OPEN) {
      socket.emit('MESSAGE_REQUEST_ACTION_RESULT', { request_id: requestId, thread_id: threadId, action: requestedAction, success: false, error: 'Extension Facebook chưa kết nối.' });
      return;
    }
    messageRequestActionOwners.set(requestId, { socket, threadId, createdAt: Date.now() });
    setTimeout(() => {
      const pending = messageRequestActionOwners.get(requestId);
      if (!pending) return;
      messageRequestActionOwners.delete(requestId);
      pending.socket.emit('MESSAGE_REQUEST_ACTION_RESULT', { request_id: requestId, thread_id: threadId, action: requestedAction, success: false, error: 'Messenger phản hồi quá thời gian.' });
    }, 15000).unref?.();
    extension.send(JSON.stringify({
      type: 'MESSAGE_REQUEST_ACTION',
      data: {
        request_id: requestId,
        thread_id: thread.id,
        external_thread_id: thread.external_thread_id || thread.id,
        account_id: thread.account_id,
        thread_url: thread.thread_url,
        contact_name: thread.contact_name,
        action: requestedAction
      }
    }));
  });

  socket.on('CONTINUE_FACEBOOK_SYNC', ({ account_id } = {}) => {
    const accountId = String(account_id || '');
    if (!accountId || !enterpriseAccess.canAccessAccount(socket.user, accountId)) return;
    backgroundAfterConnectRequests.set(accountId, Date.now());
    InboxSyncScheduler.requestSidebarSync(accountId, 'crm_continue', { force: true });
  });

  socket.on('CANCEL_FACEBOOK_SYNC', ({ account_id } = {}) => {
    const accountId = String(account_id || '');
    if (!accountId || !enterpriseAccess.canAccessAccount(socket.user, accountId)) return;
    const extension = extensionConnections.get(accountId);
    if (extension?.readyState === WebSocket.OPEN) {
      extension.send(JSON.stringify({ type: 'CANCEL_THREADS_SYNC', data: { account_id: accountId } }));
    }
  });

  socket.on('REQUEST_SYNC_THREAD_MESSAGES', async ({ thread_id, direction = 'initial', scroll_delta = 0 } = {}) => {
    const threadId = String(thread_id || '');
    if (!threadId || !enterpriseAccess.canAccessThread(socket.user, threadId)) return;
    const thread = db.prepare(`
      SELECT t.id, t.external_thread_id, t.account_id, t.thread_url, t.contact_name,
             t.sync_status, t.sync_cursor, t.history_completed, t.source_id,
             s.source_type, s.external_id AS page_id
      FROM threads t LEFT JOIN inbox_sources s ON s.id = t.source_id
      WHERE t.id = ?
    `).get(threadId);
    if (!thread?.account_id) return;

    // B1: thread Page thiếu tên thật -> làm giàu qua Messenger Profile API
    if (thread.source_type === 'page_messenger' && thread.source_id && thread.external_thread_id) {
      pageApiService.enrichPageContactProfile(thread.id, thread.source_id, thread.external_thread_id, io).catch(() => {});
      // A3: thread Page chưa có link profile -> nhờ extension đang mở Biz Suite
      // cào right rail (chốt: có link rồi thì thôi, chưa có thì mỗi lần mở cào lại)
      const scrapePayload = pageApiService.beginPageProfileScrape(thread, db);
      if (scrapePayload) {
        const scrapeExt = extensionConnections.get(String(thread.account_id));
        if (scrapeExt?.readyState === WebSocket.OPEN) {
          scrapeExt.send(JSON.stringify({ type: 'REQUEST_PAGE_PROFILE_SCRAPE', data: scrapePayload }));
          console.log('[WS] 🔗 yêu cầu cào profile thread=' + scrapePayload.thread_id + ' conv=' + scrapePayload.conv_id);
        } else {
          pageApiService.releasePageProfileScrape(scrapePayload.thread_id);
          console.log('[WS] ⚠️ bỏ qua cào profile thread=' + scrapePayload.thread_id + ' — extension chưa kết nối (account ' + thread.account_id + '). Mở lại hội thoại sau khi extension đã nối.');
        }
      }
    }

    if ((direction === 'older' || (direction === 'viewport' && Number(scroll_delta) < 0)) && Number(thread.history_completed) === 1) {
      console.log(`[REQUEST_SYNC_THREAD_MESSAGES] thread=${threadId} skip=history_completed`);
      return;
    }

    const interactionExtension = extensionConnections.get(String(thread.account_id));
    if (interactionExtension?.readyState === WebSocket.OPEN && thread.source_type !== 'page_messenger') {
      interactionExtension.send(JSON.stringify({
        type: 'PREPARE_CHAT_THREAD',
        data: {
          account_id: thread.account_id,
          thread_id: thread.id,
          external_thread_id: thread.external_thread_id || thread.id,
          thread_url: thread.thread_url,
          contact_name: thread.contact_name
        }
      }));
    }
    HistorySyncRetryPolicy.noteManualRequest(thread.account_id, threadId);
    const laneKey = (thread.source_type === 'page_messenger' && thread.page_id)
      ? ('page:' + thread.page_id)
      : ('personal:' + thread.account_id);
    InitialMessageSweepService.noteUserActivity(thread.account_id, laneKey);
    InboxSyncScheduler.clearQueuedThreadSyncs(thread.account_id, (job) => (
      ['crm_navigation', 'crm_scroll_older', 'crm_scroll_viewport'].some((prefix) => String(job.reason || '').startsWith(prefix))
      && String(job.thread_id) !== threadId
    ));
    InboxSyncScheduler.clearPendingThreadSyncs(thread.account_id, (job) => (
      ['crm_navigation', 'crm_scroll_older', 'crm_scroll_viewport'].some((prefix) => String(job.reason || '').startsWith(prefix))
      && String(job.thread_id) !== threadId
    ));
    // A manual conversation change must take ownership of the single history
    // tab immediately. The extension navigation token cancels the superseded
    // DOM pass; releasing only that old scheduler slot lets the new user run
    // without waiting for the previous scroll timeout.
    InboxSyncScheduler.preemptActiveThreadSync(thread.account_id, (job) => String(job.thread_id) !== threadId);
    // History is controlled only by the CRM operator. Opening a conversation
    // synchronizes the currently mounted viewport; subsequent Messenger
    // movement is requested exclusively by CRM viewport scroll events.
    // Cancel any old progressive job so selecting a user can never start an
    // unsolicited background crawl.
    const historyJobKey = String(thread.account_id);
    historyBackfillJobs.delete(historyJobKey);
    InboxSyncScheduler.enqueueThreadSync({
      account_id: thread.account_id,
      thread_id: thread.id,
      external_thread_id: thread.external_thread_id || thread.id,
      thread_url: thread.thread_url,
      // threads không có cột source_type/page_id — phải resolve qua join
      // inbox_sources, nếu không mọi job Page rơi lane cá nhân (page:false)
      page_id: ConversationRepository.getThreadSource(thread.id).pageId,
      contact_name: thread.contact_name,
      reason: (direction === 'older' || (direction === 'viewport' && Number(scroll_delta) < 0)) ? 'crm_scroll_older' : (direction === 'viewport' ? 'crm_scroll_viewport' : 'crm_navigation'),
      allow_navigation: true,
      priority: 'high',
      // Opening/switching user must never scroll Messenger. A saved PARTIAL
      // checkpoint is consumed only after an explicit CRM scroll-to-top event.
      sync_mode: (direction === 'older' || (direction === 'viewport' && Number(scroll_delta) < 0)) ? 'ondemand_older' : (direction === 'viewport' ? 'ondemand_viewport' : 'ondemand_initial'),
      // Preserve the operator's real upward wheel distance for older-page
      // requests. Dropping it here made the extension fall back to -1px,
      // which is too small to move Messenger's virtualized history scroller.
      scroll_delta: ['viewport', 'older'].includes(direction) ? Number(scroll_delta) || 0 : 0
    });
  });

  socket.on('TRIGGER_CALL', ({ thread_id, call_type = 'audio', account_id, call_request_id }) => {
    if (!enterpriseAccess.canAccessThread(socket.user, thread_id)) return socket.emit('CALL_ERROR', { error: 'Không có quyền sử dụng hội thoại này.' });
    let targetAccId = account_id;
    if (!targetAccId && thread_id) {
      const thread = db.prepare('SELECT account_id FROM threads WHERE id = ?').get(thread_id);
      if (thread?.account_id) targetAccId = thread.account_id;
    }
    if (!targetAccId && extensionConnections.size > 0) {
      targetAccId = extensionConnections.keys().next().value;
    }
    if (!targetAccId || !thread_id) {
      socket.emit('CALL_TRIGGER_RESPONSE', { success: false, error: 'Thiếu thông tin tài khoản hoặc hội thoại' });
      return;
    }

    if (!callEventDeduplicator.claimOutgoing({
      accountId: targetAccId,
      threadId: thread_id,
      callType: call_type
    })) {
      socket.emit('CALL_TRIGGER_RESPONSE', {
        success: false,
        error: 'Cuộc gọi này vừa được kích hoạt. Vui lòng chờ trong giây lát.'
      });
      return;
    }

    const requestId = String(call_request_id || require('crypto').randomUUID());
    const extWs = extensionConnections.get(targetAccId);
    if (extWs && extWs.readyState === WebSocket.OPEN) {
      console.log(`[Socket.io] 📞 Yêu cầu kích hoạt cuộc gọi Messenger ${call_type} cho thread ${thread_id} (account ${targetAccId})`);
      extWs.send(JSON.stringify({
        type: 'TRIGGER_MESSENGER_CALL',
        data: { account_id: targetAccId, thread_id, call_type, call_request_id: requestId }
      }));
      socket.emit('CALL_TRIGGER_RESPONSE', { success: true, message: 'Đã gửi lệnh kích hoạt cuộc gọi tới Extension' });
    } else {
      console.warn(`[Socket.io] Extension cho account ${targetAccId} chưa sẵn sàng WebSocket.`);
      socket.emit('CALL_TRIGGER_RESPONSE', { success: false, error: 'Extension Facebook chưa được kết nối' });
    }
  });

  socket.on('ANSWER_INCOMING_CALL', ({ action, thread_id, account_id, source_tab_id, source_frame_id, call_id } = {}) => {
    if (action !== 'accept' && action !== 'decline') {
      socket.emit('ANSWER_INCOMING_CALL_RESPONSE', { success: false, action, thread_id, error: 'Invalid call action' });
      return;
    }
    const targetAccount = account_id || extensionConnections.keys().next().value;
    const extension = targetAccount ? extensionConnections.get(targetAccount) : null;
    if (extension?.readyState === WebSocket.OPEN) {
      extension.send(JSON.stringify({ type: 'ANSWER_INCOMING_CALL', data: { action, thread_id, account_id: targetAccount, source_tab_id, source_frame_id, call_id } }));
      socket.emit('ANSWER_INCOMING_CALL_RESPONSE', { success: true, action, thread_id });
    } else {
      socket.emit('ANSWER_INCOMING_CALL_RESPONSE', { success: false, action, thread_id, error: 'Facebook extension is not connected' });
    }
  });

  socket.on('SEND_MESSAGE', async (payload = {}) => {
    const { thread_id, content, client_message_id, attachment_id, contract_version, mentions } = payload;
    const isRichMessage = Number(contract_version) === 2 || Boolean(attachment_id);
    if (!enterpriseAccess.canAccessThread(socket.user, thread_id)) {
      return socket.emit('SEND_ERROR', { client_message_id, code: 'ACCOUNT_NOT_ASSIGNED', error: 'Tài khoản Facebook chưa được Admin cấp cho bạn.' });
    }

    // Nhân viên gõ tay → tạm dừng AI 30 phút
    const pauseResult = aiMediator.pauseForThread(thread_id);
    io.emit('AI_PAUSED', { thread_id, until: pauseResult.until });

    const threadRow = db.prepare(`
      SELECT t.id, t.account_id, s.source_type, s.external_id AS page_id
      FROM threads t LEFT JOIN inbox_sources s ON s.id = t.source_id
      WHERE t.id = ?
    `).get(thread_id);
    if (threadRow?.account_id) {
      const laneKey = (threadRow.source_type === 'page_messenger' && threadRow.page_id)
        ? ('page:' + threadRow.page_id)
        : ('personal:' + threadRow.account_id);
      InitialMessageSweepService.noteUserActivity(threadRow.account_id, laneKey);
      InboxSyncScheduler.preemptActiveThreadSync(threadRow.account_id, (job) => String(job.thread_id) !== String(thread_id));
    }

    try {
      // Thread PAGE → gửi bằng Send API với Page Access Token (không qua extension)
      const pageThreadRow = db.prepare(`
        SELECT s.source_type FROM threads t LEFT JOIN inbox_sources s ON s.id = t.source_id WHERE t.id = ?
      `).get(thread_id);
      if (pageThreadRow?.source_type === 'page_messenger') {
        if (isRichMessage && attachment_id) {
          await sendPageThreadViaGraphAttachment(thread_id, content, client_message_id, attachment_id, socket);
          return;
        }
        if (isRichMessage) {
          throw new RichMessageService.Error('PAGE_ATTACHMENT_NOT_SUPPORTED', 'Tin nhắn Page kèm file chưa hỗ trợ trên đường API mới.', 400);
        }
        await sendPageThreadViaGraph(thread_id, content, client_message_id, socket);
        return;
      }
      if (isRichMessage) {
        if (isLoopbackAddress(socket.handshake?.address) === false) {
          throw new RichMessageService.Error(
            'LOCAL_CRM_REQUIRED',
            'Rich-message chỉ được phép từ CRM chạy trên máy này.',
            403
          );
        }
        const forbiddenRoutingFields = ['account_id', 'source_id', 'source_type', 'page_id'];
        if (forbiddenRoutingFields.some((field) => Object.prototype.hasOwnProperty.call(payload, field))) {
          throw new RichMessageService.Error(
            'ROUTING_FIELDS_FORBIDDEN',
            'CRM không được tự chỉ định tài khoản hoặc nguồn gửi.',
            400
          );
        }
        const richThread = db.prepare('SELECT account_id FROM threads WHERE id = ?').get(thread_id);
        if (!richThread?.account_id) {
          throw new RichMessageService.Error('THREAD_NOT_FOUND', 'Conversation was not found.', 404);
        }
        const accepted = RichMessageService.submit({
          threadId: thread_id,
          clientMessageId: client_message_id,
          // Preserve text caption alongside attachment
          content: content || '',
          attachmentId: attachment_id || null
        }, {
          database: db,
          capabilityOptions: getRichMessageCapabilityOptions()
        });
        const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(accepted.message_id);
        socket.emit('MESSAGE_SEND_ACCEPTED', accepted);
        io.emit('NEW_MESSAGE', withAttachmentAccessUrl({
          ...message,
          status: accepted.status,
          attempt_id: accepted.attempt_id,
          queue_id: accepted.queue_id,
          attachment: accepted.attachment
        }));
        return;
      }

      await sendViaExtension(thread_id, content, client_message_id, mentions);
    } catch (err) {
      console.error('[Socket] Lỗi gửi tin nhắn:', err.message);
      try {
        appendComposerDebugLog({
          at: new Date().toISOString(),
          stage: 'socket_send_error',
          thread_id: String(thread_id || ''),
          client_message_id: client_message_id || null,
          attachment_id: attachment_id || null,
          error_code: err.code || 'SEND_FAILED',
          error: err.message || String(err)
        });
      } catch (_) { }
      socket.emit('SEND_ERROR', {
        error: err.message,
        code: err.code || 'SEND_FAILED',
        client_message_id
      });
      io.emit('MESSAGE_SEND_FAILED', {
        thread_id,
        client_message_id,
        success: false,
        error: err.message,
        error_code: err.code || 'SEND_FAILED'
      });
    }
  });

  socket.on('RETRY_MESSAGE', (payload = {}) => {
    try {
      if (!enterpriseAccess.canAccessThread(socket.user, payload.thread_id)) throw Object.assign(new Error('Tài khoản Facebook chưa được Admin cấp cho bạn.'), { code: 'ACCOUNT_NOT_ASSIGNED' });
      if (isLoopbackAddress(socket.handshake?.address) === false) {
        throw new RichMessageService.Error(
          'LOCAL_CRM_REQUIRED',
          'Rich-message chỉ được phép từ CRM chạy trên máy này.',
          403
        );
      }
      const accepted = RichMessageService.retry({
        threadId: payload.thread_id,
        messageId: payload.message_id,
        expectedLatestAttemptId: payload.expected_latest_attempt_id
      }, {
        database: db,
        capabilityOptions: getRichMessageCapabilityOptions()
      });
      socket.emit('MESSAGE_SEND_ACCEPTED', accepted);
      io.emit('MESSAGE_SEND_STATUS', {
        thread_id: accepted.thread_id,
        client_message_id: accepted.client_message_id,
        message_id: accepted.message_id,
        attempt_id: accepted.attempt_id,
        status: accepted.status,
        fb_message_id: null,
        confirmation_source: null,
        error: null,
        updated_at: new Date().toISOString()
      });
    } catch (error) {
      socket.emit('SEND_ERROR', {
        error: error.message,
        code: error.code || 'RETRY_FAILED',
        message_id: payload.message_id
      });
    }
  });
});

// ────────────────────────────────────────────────
// REST API
// ────────────────────────────────────────────────

function requireCompanyAdmin(req, res, next) {
  if (enterpriseAccess.isCompanyAdmin(req.user) || (req.user.role === 'ADMIN' && req.user.username === 'admin')) return next();
  return res.status(403).json({ success: false, error: 'Chỉ Admin doanh nghiệp được sử dụng chức năng này.' });
}

app.get('/api/company/employees', requireCompanyAdmin, (req, res) => {
  res.json({ success: true, employees: enterpriseAccess.listEmployees(req.user), assignments: enterpriseAccess.assignmentMap(req.user.company_id), accounts: enterpriseAccess.listAccounts(req.user) });
});

app.post('/api/company/employees', requireCompanyAdmin, async (req, res) => {
  try {
    const centralResponse = await fetch(`${LICENSE_SERVER_BASE_URL}/api/client-auth/company-employees`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminUsername: req.user.username, username: req.body?.username, password: req.body?.password })
    });
    const central = await centralResponse.json().catch(() => ({}));
    if (!centralResponse.ok || !central.success) return res.status(centralResponse.status).json({ success: false, error: central.message || 'License Server từ chối tạo nhân viên.' });
    const employee = enterpriseAccess.createEmployee(req.user, req.body || {});
    res.status(201).json({ success: true, employee });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, error: error.message || 'Không thể tạo nhân viên.' });
  }
});

app.delete('/api/company/employees/:id', requireCompanyAdmin, async (req, res) => {
  const employee = db.prepare("SELECT username FROM users WHERE id=? AND company_id=? AND company_role='EMPLOYEE'").get(Number(req.params.id), req.user.company_id);
  if (!employee) return res.status(404).json({ success: false, error: 'Không tìm thấy nhân viên.' });
  try {
    const centralResponse = await fetch(`${LICENSE_SERVER_BASE_URL}/api/client-auth/company-employees`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminUsername: req.user.username, username: employee.username })
    });
    if (!centralResponse.ok && centralResponse.status !== 404) throw new Error('Không thể xóa nhân viên trên License Server.');
    enterpriseAccess.deleteEmployee(req.user, req.params.id);
    res.json({ success: true });
  } catch (error) { res.status(502).json({ success: false, error: error.message }); }
});

app.put('/api/company/employees/:id/accounts', requireCompanyAdmin, (req, res) => {
  try {
    const accountIds = enterpriseAccess.setAssignments(req.user, req.params.id, Array.isArray(req.body?.account_ids) ? req.body.account_ids : []);
    res.json({ success: true, account_ids: accountIds });
  } catch (error) { res.status(error.status || 500).json({ success: false, error: error.message }); }
});

let healedAccountNamesAndCookiesOnce = false;
function ensureAccountNamesAndCookiesHealed() {
  if (healedAccountNamesAndCookiesOnce) return;
  healedAccountNamesAndCookiesOnce = true;
  try {
    const fixed = db.prepare("UPDATE accounts SET name = 'Lê Văn Khang', avatar_url = '/api/avatars/avatar_account_100066325187762_c97ea7b4.jpg' WHERE id = '100066325187762' AND name = 'Kjgvkj'").run();
    if (fixed.changes > 0) {
      db.prepare("UPDATE inbox_sources SET display_name = 'Lê Văn Khang', avatar_url = '/api/avatars/avatar_account_100066325187762_c97ea7b4.jpg' WHERE id = 'src_personal_100066325187762'").run();
    }
    const allAccs = db.prepare('SELECT id FROM accounts').all();
    setTimeout(() => {
      for (const a of allAccs) {
        if (!loadSavedAccountCookies(a.id)) {
          try { readCookiesFromProfileDisk(a.id); } catch (_) {}
        }
      }
    }, 500);
  } catch (_) {}
}

app.get('/api/accounts', (req, res) => {
  ensureAccountNamesAndCookiesHealed();
  const accounts = enterpriseAccess.listAccounts(req.user);
  const result = accounts.map(acc => {
    const accIdStr = String(acc.id);
    const personalWs = extensionConnections.get(accIdStr) || extensionConnections.get(acc.id);
    const isPersonalConnected = Boolean(
      (personalWs && personalWs.readyState === WebSocket.OPEN)
      || disconnectGraceTimers.has(accIdStr)
    );
    let isPageConnected = false;
    for (const [key, pageWs] of pageExtensionConnections.entries()) {
      if (key.startsWith(accIdStr + ':') && pageWs?.readyState === WebSocket.OPEN) {
        isPageConnected = true;
        break;
      }
    }
    return {
      ...acc,
      is_extension_connected: isPersonalConnected || isPageConnected,
      is_chrome_running: processManager.getStatus(acc.id) === 'RUNNING',
      chrome_display_mode: processManager.getDisplayMode(acc.id)
    };
  });
  res.json(result);
});
app.post('/api/accounts/:id/start', async (req, res) => {
  const accountId = String(req.params.id);
  // Key dạng page:<ownerAcc>:<pageId> không phải tài khoản trong bảng accounts -
  // chính sách 1 Chrome/account: bảo đảm Chrome cá nhân chạy + mở tab Business.
  if (accountId.startsWith('page:')) {
    const parts = accountId.split(':');
    const ownerAccountId = parts[1];
    const pageId = parts[2];
    if (!ownerAccountId || !pageId) return res.status(400).json({ success: false, error: 'Key Page không hợp lệ' });
    if (isSuspiciousPageId(pageId)) {
      return res.status(400).json({ success: false, error: `ID ${pageId} là ID profile/delegate, không phải Fanpage - không mở tab.` });
    }
    const ok = await processManager.openBusinessTabForPage(pageId, ownerAccountId);
    return res.json({ success: ok });
  }
  if (!enterpriseAccess.canAccessAccount(req.user, req.params.id)) {
    return res.status(404).json({ success: false, error: 'Không tìm thấy tài khoản Facebook' });
  }
  const startInBackground = req.body?.background === true;
  if (startInBackground) {
    backgroundAfterConnectRequests.set(accountId, Date.now());
  } else {
    backgroundAfterConnectRequests.delete(accountId);
    if (backgroundAfterConnectTimers.has(accountId)) {
      clearTimeout(backgroundAfterConnectTimers.get(accountId));
      backgroundAfterConnectTimers.delete(accountId);
    }
  }

  // 2026-10-09: đã kết nối thì không mở lại Chrome — trước đây bấm nút lần 2
  // khiến Chrome đang chạy bị tắt rồi mở lại; mở lại thất bại (profile khóa,
  // RAM) báo "Không thể mở Chrome" dù mọi thứ vẫn ổn.
  const currentExtensionWs = extensionConnections.get(accountId);
  if (currentExtensionWs && currentExtensionWs.readyState === WebSocket.OPEN) {
    if (startInBackground) {
      processManager.hideAccountProcess(accountId).then((result) => {
        if (result?.success) {
          io.emit('ACCOUNT_DISPLAY_CHANGED', {
            account_id: accountId,
            chrome_display_mode: 'BACKGROUND',
            is_chrome_running: true
          });
        }
      });
    }
    return res.json({ success: true, already_connected: true });
  }

  const success = await processManager.startAccountProcess(accountId, null, { forceExtensionReload: true });
  if (!success) {
    backgroundAfterConnectRequests.delete(accountId);
    return res.json({
      success: false,
      error: `Không thể mở Chrome: ${processManager.lastLaunchError || 'Không rõ nguyên nhân'}`
    });
  }

  // If extension is already connected and background requested, hide immediately
  if (startInBackground && extensionConnections.has(accountId)) {
    processManager.hideAccountProcess(accountId).then((result) => {
      if (result?.success) {
        io.emit('ACCOUNT_DISPLAY_CHANGED', {
          account_id: accountId,
          chrome_display_mode: 'BACKGROUND',
          is_chrome_running: true
        });
      }
    });
  }

  // TẮT: mở tab Business Suite cho từng Page khi bấm "Kết nối Facebook" —
  // Page chạy qua Messenger Platform (Graph API + webhook), không cần tab.
  // Trước đây 11 page = 11 tab biz trong Chrome account (báo lỗi 2026-10-06).

  res.json({ success: true, page_windows_requested: 0 });
});
app.post('/api/accounts/:id/stop', (req, res) => {
  if (!enterpriseAccess.canAccessAccount(req.user, req.params.id)) {
    return res.status(404).json({ success: false, error: 'Không tìm thấy tài khoản Facebook' });
  }
  const accountId = String(req.params.id);
  backgroundAfterConnectRequests.delete(accountId);
  if (backgroundAfterConnectTimers.has(accountId)) {
    clearTimeout(backgroundAfterConnectTimers.get(accountId));
    backgroundAfterConnectTimers.delete(accountId);
  }
  const stopped = processManager.stopAccountProcess(accountId);
  if (stopped) {
    io.emit('ACCOUNT_DISPLAY_CHANGED', {
      account_id: accountId,
      chrome_display_mode: 'STOPPED',
      is_chrome_running: false
    });
  }
  res.json({ success: true, stopped });
});
app.post('/api/extension/reload', (req, res) => {
  let count = 0;
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      try {
        client.send(JSON.stringify({ type: 'RELOAD_EXTENSION' }));
        count++;
      } catch (_) {}
    }
  });
  console.log(`[WS] 🔄 Đã gửi tín hiệu RELOAD_EXTENSION tới ${count} kết nối Extension WebSocket.`);
  res.json({ success: true, reloaded: count });
});
app.post('/api/accounts/:id/open', async (req, res) => {
  if (!enterpriseAccess.canAccessAccount(req.user, req.params.id)) {
    return res.status(404).json({ success: false, error: 'Không tìm thấy tài khoản Facebook' });
  }
  const accountId = String(req.params.id);
  if (processManager.getStatus(accountId) !== 'RUNNING') {
    return res.status(409).json({ success: false, error: 'Hãy kết nối tài khoản Facebook trước khi bật hiển thị Chrome.' });
  }
  // Cancel any pending auto-hide requests/timers so Chrome doesn't get hidden again
  backgroundAfterConnectRequests.delete(accountId);
  if (backgroundAfterConnectTimers.has(accountId)) {
    clearTimeout(backgroundAfterConnectTimers.get(accountId));
    backgroundAfterConnectTimers.delete(accountId);
  }

  const result = await processManager.unhideWindow(accountId);
  if (result?.success) {
    io.emit('ACCOUNT_DISPLAY_CHANGED', {
      account_id: accountId,
      chrome_display_mode: 'VISIBLE',
      is_chrome_running: true
    });
  }
  res.json({ success: !!result?.success, error: result?.error });
});
app.post('/api/accounts/:id/background', async (req, res) => {
  if (!enterpriseAccess.canAccessAccount(req.user, req.params.id)) {
    return res.status(404).json({ success: false, error: 'Không tìm thấy tài khoản Facebook' });
  }
  const accountId = String(req.params.id);
  if (processManager.getStatus(accountId) !== 'RUNNING') {
    return res.status(409).json({ success: false, error: 'Tài khoản Facebook chưa được kết nối.' });
  }
  const result = await processManager.hideAccountProcess(accountId);
  if (result?.success) {
    io.emit('ACCOUNT_DISPLAY_CHANGED', {
      account_id: accountId,
      chrome_display_mode: 'BACKGROUND',
      is_chrome_running: true
    });
  }
  res.json({ success: !!result?.success, error: result?.error });
});

// ────────────────────────────────────────────────
// Fanpage Auto-Discovery & Batch-Open Endpoints
// ────────────────────────────────────────────────
// Đồng bộ với GENERIC_EXCLUDE_REGEX trong src/extension/pageDiscovery.js:
// các chuỗi này là tiêu đề UI Facebook, không phải tên Page thật.
const GENERIC_PAGE_NAME_REGEX = /^(?:facebook|messenger|trang|page|trang cá nhân|profile|hộp thư|inbox|bảng tin|feed|thông báo|notifications|cài đặt|settings|xem tất cả|see all|quản lý|manage|quản lý trang|trang của bạn|trang bạn quản lý|trang của tôi|tất cả trang|your pages|pages you manage|manage pages|my pages)$/i;

function isGenericPageName(name) {
  if (!name || typeof name !== 'string') return false;
  const trimmed = name.trim();
  if (GENERIC_PAGE_NAME_REGEX.test(trimmed)) return true;
  if (/^page \d+$/i.test(trimmed)) return true;
  return false;
}

// ID profile/delegate mới của Facebook có 14 chữ số bắt đầu 6155-6159
// (vd 61564781823946). Business Suite chặn asset_id dạng này với lỗi
// "nội dung này hiện không khả dụng" - chỉ ID page thật (11-16 chữ số
// hợp lệ) mới mở được inbox. Lọc bỏ 615[5-9]\d{10} (profile/delegate).
const SUSPICIOUS_PAGE_ID_REGEX = /^615[5-9]\d{10}$/;

function isSuspiciousPageId(id) {
  return SUSPICIOUS_PAGE_ID_REGEX.test(String(id || '').trim());
}

// Tên page trùng khớp tên chủ tài khoản (khác ID account) = profile cá nhân
// khác của chủ bị quét nhầm thành page.
function isOwnerSelfSourceName(name, accountName) {
  const n = (name || '').trim().toLowerCase();
  const a = (accountName || '').trim().toLowerCase();
  return !!n && !!a && n === a;
}

function getAccountName(accountId) {
  try {
    return db.prepare('SELECT name FROM accounts WHERE id = ?').get(String(accountId))?.name || '';
  } catch (_) {
    return '';
  }
}

/* ─────────────── Routes Page API (Messenger Platform chính thức) ─────────────── */

// Cấu hình toàn cục: URL cầu nối hosting (webhook.php) + verify token
app.get('/api/page-api/config', (req, res) => {
  // Gọi getOrCreateVerifyToken trước để KV được chuẩn hóa theo .env
  // (đề phòng CSDL còn giữ token tự sinh từ bản cũ).
  const verifyToken = pageApiService.getOrCreateVerifyToken();
  const g = pageApiService.getGlobalConfig();
  res.json({
    success: true,
    bridge_url: g.bridge_url || null,
    verify_token: verifyToken,
    webhook_url: g.bridge_url || null,
  });
});

app.post('/api/page-api/config', (req, res) => {
  const url = String((req.body || {}).bridge_url || '').trim();
  if (url && !/^https:\/\//.test(url)) {
    return res.status(400).json({ success: false, error: 'URL cầu nối phải là https (webhook.php trên hosting của bạn).' });
  }
  pageApiService.setBridgeUrl(url);
  res.json({ success: true, bridge_url: pageApiService.getGlobalConfig().bridge_url });
});

// Danh sách page của 1 account theo đường API mới (kèm trạng thái có token)
app.get('/api/page-api/accounts/:id/pages', (req, res) => {
  if (!enterpriseAccess.canAccessAccount(req.user, req.params.id)) {
    return res.status(404).json({ success: false, error: 'Không tìm thấy tài khoản Facebook' });
  }
  const accountId = String(req.params.id);
  const rows = db.prepare(`
    SELECT id, external_id, display_name, avatar_url, status, access_token_encrypted, created_at
    FROM inbox_sources WHERE source_type = 'page_messenger' AND owner_account_id = ?
    ORDER BY created_at ASC
  `).all(accountId);
  const pages = rows.map((r) => ({
    page_id: String(r.external_id),
    name: r.display_name,
    avatar_url: r.avatar_url || `https://graph.facebook.com/${r.external_id}/picture?type=normal`,
    category: 'Trang Facebook',
    has_token: Boolean(r.access_token_encrypted),
    token: r.access_token_encrypted ? (InboxSourceService.getDecryptedToken(r.id) || '') : '',
    is_connected: r.status === 'ACTIVE',
    connected_at: r.created_at,
  }));
  const latestApp = pageApiService.appGetLatest(accountId);
  const allApps = pageApiService.appList(accountId);
  res.json({
    success: true,
    account_id: accountId,
    pages,
    app: latestApp ? {
      app_id: latestApp.appId,
      name: latestApp.name,
      status: latestApp.status,
      note: latestApp.note || '',
      webhook_url: latestApp.webhookUrl || null,
      created_at: latestApp.createdAt,
    } : null,
    // Trả ĐỦ danh sách app đã tạo (mới nhất trước) — trước đây chỉ trả 1 app
    // nên tạo app lần 2 là app cũ biến mất khỏi popup.
    apps: allApps.map((a) => ({
      app_id: a.appId,
      name: a.name,
      status: a.status,
      note: a.note || '',
      webhook_url: a.webhookUrl || null,
      created_at: a.createdAt,
      mode: a.mode || null,
      type: a.type || null,
      source: a.source || null,
      last_page_sync_at: a.lastPageSyncAt || null,
    })),
  });
});

// Bấm "Tạo app & Webhook": mở Chrome riêng, tự tạo app + điền webhook + connect page + cào page
app.post('/api/page-api/accounts/:id/create-app', async (req, res) => {
  if (!enterpriseAccess.canAccessAccount(req.user, req.params.id)) {
    return res.status(404).json({ success: false, error: 'Không tìm thấy tài khoản Facebook' });
  }
  const accountId = String(req.params.id);
  const g = pageApiService.getGlobalConfig();
  if (!g.bridge_url) {
    return res.status(400).json({ success: false, error: 'Hãy cấu hình URL cầu nối hosting (webhook.php) trước khi tạo app.' });
  }
  const body = req.body || {};
  const appName = String(body.appName || '').trim() || ('CRM Page ' + Date.now().toString().slice(-6));
  const email = String(body.email || '').trim();
  const webhookUrl = g.bridge_url;
  const r = setupAutomation.startAppCreation(appName, email, webhookUrl, accountId);
  if (r.error) return res.status(409).json({ success: false, error: r.error });
  res.json({ success: true, sync_id: r.job.id });
});

// Xóa app trên Facebook (Chrome tự động hóa: menu ⋯ → Gỡ ứng dụng) + dọn data CRM
app.post('/api/page-api/accounts/:id/delete-app', async (req, res) => {
  if (!enterpriseAccess.canAccessAccount(req.user, req.params.id)) {
    return res.status(404).json({ success: false, error: 'Không tìm thấy tài khoản Facebook' });
  }
  const accountId = String(req.params.id);
  const latest = pageApiService.appGetLatest(accountId);
  const appId = String((req.body || {}).appId || (latest ? latest.appId : '') || '').trim();
  if (!/^\d+$/.test(appId)) {
    return res.status(400).json({ success: false, error: 'Chưa có app nào để xóa.' });
  }
  const r = setupAutomation.startDeleteApp(appId, accountId);
  if (r.error) return res.status(409).json({ success: false, error: r.error });
  res.json({ success: true, sync_id: r.job.id });
});

// "Đồng bộ": quét danh sách page của account — user chọn app trước (popup),
// không chọn app thì dùng app mới nhất. Thêm page mới + gắn lại page cũ đang
// thuộc account khác/mồ côi về account này (xóa tk rồi login lại là ca chính).
app.post('/api/page-api/accounts/:id/sync-pages', async (req, res) => {
  if (!enterpriseAccess.canAccessAccount(req.user, req.params.id)) {
    return res.status(404).json({ success: false, error: 'Không tìm thấy tài khoản Facebook' });
  }
  const appId = String((req.body || {}).appId || '').trim();
  const r = setupAutomation.startPageSync(String(req.params.id), appId);
  if (r.error) return res.status(409).json({ success: false, error: r.error });
  res.json({ success: true, sync_id: r.job.id });
});

// "Đồng bộ app": mở developers.facebook.com/apps/ quét MỌI app của tài khoản
// (kể cả app tạo ngoài CRM) — có sẵn thì cập nhật tên/chế độ, chưa có thì thêm
// vào cuối danh sách (không đổi app đang dùng).
app.post('/api/page-api/accounts/:id/sync-apps', async (req, res) => {
  if (!enterpriseAccess.canAccessAccount(req.user, req.params.id)) {
    return res.status(404).json({ success: false, error: 'Không tìm thấy tài khoản Facebook' });
  }
  const r = setupAutomation.startAppsScan(String(req.params.id));
  if (r.error) return res.status(409).json({ success: false, error: r.error });
  res.json({ success: true, sync_id: r.job.id });
});

// "Lấy token & Đăng ký": chạy lại phần cấu hình webhook + cào page + đăng ký field + lấy token
app.post('/api/page-api/accounts/:id/page-setup', async (req, res) => {
  if (!enterpriseAccess.canAccessAccount(req.user, req.params.id)) {
    return res.status(404).json({ success: false, error: 'Không tìm thấy tài khoản Facebook' });
  }
  const accountId = String(req.params.id);
  const g = pageApiService.getGlobalConfig();
  if (!g.bridge_url) {
    return res.status(400).json({ success: false, error: 'Hãy cấu hình URL cầu nối hosting (webhook.php) trước.' });
  }
  const body = req.body || {};
  const latest = pageApiService.appGetLatest(accountId);
  const appId = String(body.appId || (latest ? latest.appId : '') || '').trim();
  if (!/^\d+$/.test(appId)) {
    return res.status(400).json({ success: false, error: 'Chưa có app nào. Hãy bấm "Tạo app & Webhook" trước.' });
  }
  const pageIds = Array.isArray(body.pageIds) ? body.pageIds.map(String) : [];
  const r = setupAutomation.startPageSetup(appId, pageIds, accountId, g.bridge_url);
  if (r.error) return res.status(409).json({ success: false, error: r.error });
  res.json({ success: true, sync_id: r.job.id });
});

// Trạng thái job tự động hóa đang chạy
app.get('/api/page-api/sync-status', (req, res) => {
  const active = setupAutomation.getActive();
  const id = String(req.query.sync_id || '');
  const job = active || (id ? setupAutomation.getJob(id) : null);
  res.json({
    success: true,
    active: Boolean(active),
    job: job ? {
      sync_id: job.id,
      kind: job.kind || 'create',
      account_id: job.uid,
      app_id: job.appId || null,
      status: job.status,
      message: job.message || '',
      error: job.error || null,
    } : null,
  });
});

app.post('/api/page-api/sync-cancel', (req, res) => {
  const id = String((req.body || {}).sync_id || '');
  const ok = setupAutomation.cancelSync(id);
  res.json({ success: ok });
});

// Hiện/ẩn cửa sổ Chrome tự động hóa (chạy ngầm) — bấm từ modal Fanpage khi job đang chạy
app.post('/api/page-api/chrome-visibility', (req, res) => {
  const visible = !!(req.body || {}).visible;
  const r = setupAutomation.setAutomationChromeVisible(visible);
  if (r.error) return res.status(400).json({ success: false, error: r.error });
  res.json({ success: true });
});

// User nhập mật khẩu khi Facebook hỏi lại (re-auth) — KHÔNG lưu lại
app.post('/api/page-api/submit-password', (req, res) => {
  const { sync_id, password } = req.body || {};
  const ok = setupAutomation.submitPassword(String(sync_id || ''), String(password || ''));
  res.json({ success: ok });
});

// ── Token tools: copy token page + dán token NGOÀI để nhận diện & đồng bộ ──
// Toàn bộ chuỗi sync page chỉ cần row inbox_sources + token: backfill kéo
// toàn bộ hội thoại qua Graph, watcher 6s bắt tin mới, Send API để trả lời -
// không phụ thuộc app record/FB account trong data (page "ngoài" vẫn chạy).
app.get('/api/page-api/page-tokens', (req, res) => {
  const rows = db.prepare(`
    SELECT id, external_id, display_name, avatar_url, status, access_token_encrypted
    FROM inbox_sources
    WHERE source_type = 'page_messenger' AND access_token_encrypted IS NOT NULL
    ORDER BY display_name COLLATE NOCASE ASC
  `).all();
  const pages = rows.map((r) => {
    let token = '';
    try { token = InboxSourceService.getDecryptedToken(r.id) || ''; } catch (_) {}
    return {
      page_id: String(r.external_id),
      name: r.display_name,
      avatar_url: r.avatar_url || `https://graph.facebook.com/${r.external_id}/picture?type=normal`,
      status: r.status,
      token,
    };
  });
  res.json({ success: true, pages });
});

const PAGE_TOKEN_GRAPH_BASE = 'https://graph.facebook.com/v21.0';
async function pageTokenGraphGet(path, params) {
  const qs = new URLSearchParams(params).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const resp = await fetch(`${PAGE_TOKEN_GRAPH_BASE}/${String(path).replace(/^\/+/, '')}?${qs}`, { signal: controller.signal });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.error) throw new Error(data.error?.message || `Graph HTTP ${resp.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

app.post('/api/page-api/import-tokens', async (req, res) => {
  const raw = Array.isArray(req.body?.tokens) ? req.body.tokens.join('\n') : String(req.body?.tokens || '');
  const tokens = [...new Set(raw.split(/[\s,;]+/).map((t) => t.trim()).filter((t) => t.length >= 20))];
  if (!tokens.length) return res.status(400).json({ success: false, error: 'Chưa có token hợp lệ nào (token thường dài hơn 20 ký tự)' });
  if (tokens.length > 50) return res.status(400).json({ success: false, error: 'Tối đa 50 token mỗi lần dán' });
  // Gán page import về account đang mở modal (nếu có) — nếu không, danh sách
  // page lọc theo owner_account_id sẽ không hiện page mới lên (reproduce: ✅
  // ADSUP Agency import xong nhưng list 0/0 vì owner NULL).
  let importAccountId = req.body?.account_id ? String(req.body.account_id) : null;
  if (importAccountId && !enterpriseAccess.canAccessAccount(req.user, importAccountId)) {
    importAccountId = null;
  }
  const mask = (t) => `${String(t).slice(0, 8)}…${String(t).slice(-6)}`;

  const importOnePage = (pageId, pageName, pageToken) => {
    // savePages đọc p.pageId (KHÔNG phải p.id) - sai tên field trước đây làm
    // savePages continue âm thầm, page không bao giờ được lưu dù Graph nhận
    // diện OK (reproduce: ✅ ADSUP Agency nhưng inbox_sources trống).
    pageApiService.savePages(importAccountId, [{ pageId: String(pageId), name: String(pageName || 'Facebook Page'), token: pageToken }], db);
    const src = db.prepare("SELECT id FROM inbox_sources WHERE source_type = 'page_messenger' AND external_id = ?").get(String(pageId));
    if (src) {
      // Backfill chạy nền: kéo toàn bộ hội thoại cũ; tin mới do watcher 6s tự bắt
      pageApiService.backfillConversations(src.id, io, { convLimit: 50 })
        .then((r) => console.log(`[PAGE_TOKEN] Backfill page ${pageId}: ${JSON.stringify(r).slice(0, 200)}`))
        .catch((e) => console.warn(`[PAGE_TOKEN] Backfill page ${pageId} lỗi: ${e.message}`));
    }
    return src?.id || null;
  };

  const results = [];
  for (const token of tokens) {
    try {
      const me = await pageTokenGraphGet('me', {
        fields: 'id,name',
        metadata: '1',
        metadata_fields: 'type',
        access_token: token,
      });
      const tokenType = String(me?.metadata?.type || 'Page');
      if (tokenType === 'User') {
        // User token: kéo TOÀN BỘ page của user đó (kèm page token) — dán 1 token nhận cả chục page
        let accounts;
        try {
          accounts = await pageTokenGraphGet('me/accounts', { fields: 'id,name,access_token', limit: 100, access_token: token });
        } catch (e) {
          results.push({ token: mask(token), type: 'User', status: 'error', error: `User token không liệt kê được page (${e.message}) — cần quyền pages_show_list` });
          continue;
        }
        const list = (accounts?.data || []).map((p) => ({ id: String(p.id), name: p.name || 'Facebook Page', token: p.access_token }));
        if (!list.length) {
          results.push({ token: mask(token), type: 'User', status: 'error', error: 'User này không quản lý Fanpage nào' });
          continue;
        }
        for (const p of list) importOnePage(p.id, p.name, p.token);
        results.push({ token: mask(token), type: 'User', status: 'imported', pages: list.map((p) => p.name) });
      } else {
        importOnePage(me.id, me.name, token);
        results.push({ token: mask(token), type: 'Page', status: 'imported', page_id: String(me.id), pageName: me.name || '' });
      }
    } catch (e) {
      results.push({ token: mask(token), status: 'error', error: e.message });
    }
  }
  res.json({ success: true, results, note: 'Hội thoại đang được kéo về nền — danh sách page/tin nhắn sẽ cập nhật dần.' });
});

// Input từ popup đăng ký developer (quốc gia / số điện thoại / mã OTP)
app.post('/api/page-api/register-input', (req, res) => {
  const { sync_id, type, value } = req.body || {};
  const ok = setupAutomation.resolveRegisterInput(String(sync_id || ''), String(type || ''), value);
  res.json({ success: ok });
});

app.post('/api/page-api/resend-sms', (req, res) => {
  const { sync_id } = req.body || {};
  const ok = setupAutomation.resendRegisterSms(String(sync_id || ''));
  res.json({ success: ok });
});

// Backfill hội thoại của các page có token (đưa tin cũ về CRM)
app.post('/api/page-api/accounts/:id/backfill', async (req, res) => {
  if (!enterpriseAccess.canAccessAccount(req.user, req.params.id)) {
    return res.status(404).json({ success: false, error: 'Không tìm thấy tài khoản Facebook' });
  }
  const accountId = String(req.params.id);
  const sources = db.prepare(`
    SELECT id, external_id, display_name FROM inbox_sources
    WHERE source_type = 'page_messenger' AND owner_account_id = ? AND status = 'ACTIVE'
      AND access_token_encrypted IS NOT NULL
  `).all(accountId);
  if (!sources.length) {
    return res.json({ success: false, error: 'Chưa có page nào có Page Access Token.' });
  }
  const results = [];
  for (const s of sources) {
    const r = await pageApiService.backfillConversations(s.id, io);
    results.push({ page_id: s.external_id, name: s.display_name, ...r });
  }
  res.json({ success: true, results });
});

// Webhook local (nếu user tự expose server): verify + nhận event từ Meta
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const g = pageApiService.getGlobalConfig();
  const expected = g.verify_token || pageApiService.getOrCreateVerifyToken();
  if (mode === 'subscribe' && token === expected) {
    res.type('text/plain').send(String(challenge || ''));
  } else {
    res.status(403).json({ error: 'Verify token mismatch' });
  }
});

app.post('/webhook', (req, res) => {
  try {
    pageApiService.handleWebhookBody(req.body, io);
  } catch (e) {
    console.warn('[PageApi] Lỗi xử lý webhook POST:', e.message);
  }
  res.status(200).send('OK');
});

/* ─────────────────────────────────────────────────────────────────────────────── */


// ── TẮT: đường page cũ chạy qua extension DOM Business Suite ──
// Chức năng Page chuyển sang Messenger Platform chính thức (Graph API + webhook).
// Giữ lại code để tham khảo, không còn route nào dưới đây được đăng ký.
/*
app.get('/api/accounts/:id/pages', (req, res) => {
  if (!enterpriseAccess.canAccessAccount(req.user, req.params.id)) {
    return res.status(404).json({ success: false, error: 'Không tìm thấy tài khoản Facebook' });
  }
  const accountId = String(req.params.id);
  const accountName = getAccountName(accountId);
  // Tự dọn source rác đã lỡ tạo từ đợt quét buggy cũ: tên là tiêu đề UI
  // Facebook ("Quản lý trang") hoặc placeholder ("Page 123...") - mở tab
  // Business Suite cho chúng luôn bị chặn "nội dung không khả dụng".
  // Tương tự với ID profile/delegate 6155xxx-6159xxx (14 chữ số) và profile
  // cá nhân trùng tên chủ account.
  const junkSources = db.prepare(`
    SELECT id, external_id, display_name FROM inbox_sources
    WHERE source_type = 'page_messenger' AND owner_account_id = ?
  `).all(accountId).filter((s) => isGenericPageName(s.display_name)
    || isSuspiciousPageId(s.external_id)
    || isOwnerSelfSourceName(s.display_name, accountName));
  if (junkSources.length > 0) {
    const deleteSource = db.prepare('DELETE FROM inbox_sources WHERE id = ?');
    for (const junk of junkSources) deleteSource.run(junk.id);
    console.log(`[Pages] Đã dọn ${junkSources.length} source page rác của account ${accountId}: ${junkSources.map((j) => j.display_name).join(', ')}`);
  }
  const cached = discoveredPagesByAccount.get(accountId);
  // Loại bỏ tài khoản cá nhân ra khỏi danh sách quét được
  // + lọc luôn entry ID profile/delegate 6155xxx-6159xxx và profile trùng tên chủ
  const rawPages = (cached?.pages || []).filter(p => String(p.page_id) !== accountId
    && !isGenericPageName(p.name)
    && !isSuspiciousPageId(p.page_id)
    && !isOwnerSelfSourceName(p.name, accountName));

  // Lấy các source Page đã ACTIVE của account này trong database (bỏ qua personal profile)
  const activeSources = db.prepare(`
    SELECT external_id, display_name, avatar_url, status
    FROM inbox_sources
    WHERE source_type = 'page_messenger' AND owner_account_id = ? AND status = 'ACTIVE'
  `).all(accountId).filter(s => String(s.external_id) !== accountId
    && !isGenericPageName(s.display_name)
    && !isSuspiciousPageId(s.external_id)
    && !isOwnerSelfSourceName(s.display_name, accountName));

  const activeById = new Map();
  const activeByName = new Map();
  // 1 Page có thể bị discovery quét nhầm ID profile kiểu mới (10007...) thay vì
  // ID legacy mà Business Suite nhận. Map tên "lỏng" (bỏ dấu cách/ký tự) giữa
  // page quét được và mọi source ACTIVE để thay ID sai bằng ID chuẩn trong DB.
  const looseNameKey = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9\u00c0-\u024f\u1e00-\u1eff]+/g, '');
  const anyPageSources = db.prepare(`
    SELECT external_id, display_name, owner_account_id
    FROM inbox_sources
    WHERE source_type = 'page_messenger' AND status = 'ACTIVE'
  `).all();
  const activeByLooseName = new Map();
  const anyByLooseName = new Map();
  for (const s of anyPageSources) {
    const key = looseNameKey(s.display_name);
    if (!key) continue;
    if (!anyByLooseName.has(key)) anyByLooseName.set(key, s);
    if (String(s.owner_account_id) === String(accountId) && !activeByLooseName.has(key)) activeByLooseName.set(key, s);
  }
  for (const s of activeSources) {
    const extId = String(s.external_id);
    activeById.set(extId, s);
    const norm = (s.display_name || '').trim().toLowerCase();
    if (norm) {
      activeByName.set(norm, s);
    }
  }

  // Kết hợp danh sách:
  // Dùng normalizedName làm khóa để đảm bảo không bao giờ bị nhân đôi 2 Page cùng tên
  const combinedByName = new Map();

  for (const p of rawPages) {
    const pid = String(p.page_id);
    const norm = (p.name || '').trim().toLowerCase();
    const loose = looseNameKey(p.name);
    let effectivePid = pid;
    if (!activeById.has(pid)) {
      const cand = (loose && (activeByLooseName.get(loose) || anyByLooseName.get(loose))) || null;
      if (cand) effectivePid = String(cand.external_id);
    }
    const matchedSource = activeById.get(effectivePid)
      || (norm ? activeByName.get(norm) : null)
      || (loose ? activeByLooseName.get(loose) : null);
    const isConn = !!matchedSource;
    // Ưu tiên dùng ID từ database nếu đã kết nối (ID legacy 16 số chuẩn), nếu chưa có thì dùng pid quét được
    const effectiveId = matchedSource ? String(matchedSource.external_id) : effectivePid;
    const effectiveName = matchedSource?.display_name || p.name || ('Page ' + effectiveId);
    const key = norm || effectiveId;

    if (!combinedByName.has(key)) {
      combinedByName.set(key, {
        page_id: effectiveId,
        name: effectiveName,
        avatar_url: p.avatar_url || matchedSource?.avatar_url || `https://graph.facebook.com/${effectiveId}/picture?type=normal`,
        category: p.category || 'Trang Facebook',
        is_connected: isConn
      });
    }
  }

  // Bổ sung các page trong CSDL mà discovery chưa quét ra
  for (const s of activeSources) {
    const extId = String(s.external_id);
    const norm = (s.display_name || '').trim().toLowerCase();
    const key = norm || extId;
    if (!combinedByName.has(key)) {
      combinedByName.set(key, {
        page_id: extId,
        name: s.display_name || ('Page ' + extId),
        avatar_url: s.avatar_url || `https://graph.facebook.com/${extId}/picture?type=normal`,
        category: 'Trang Facebook',
        is_connected: true
      });
    }
  }

  // Bổ sung source page chưa rõ chủ (owner NULL, vd tạo từ thread cũ):
  // discovery không trả về chúng nên không bao giờ được auto-bind owner -
  // nếu không thêm vào đây thì modal thiếu page so với Business Suite.
  // User bấm "Mở" sẽ qua ensurePageSource -> tự gắn owner cho account này.
  // Page mồ côi (owner NULL, thường là page của account đã bị xóa) phải có
  // hội thoại thật mới được đề xuất kết nối - nếu không modal sẽ ngập page rác
  // của account khác (30 thay vì 18 page).
  const unownedSources = db.prepare(`
    SELECT s.external_id, s.display_name, s.avatar_url
    FROM inbox_sources s
    WHERE s.source_type = 'page_messenger' AND s.owner_account_id IS NULL AND s.status = 'ACTIVE'
      AND EXISTS (SELECT 1 FROM threads t WHERE t.source_id = s.id)
  `).all().filter(s => String(s.external_id) !== accountId
    && !isGenericPageName(s.display_name)
    && !isSuspiciousPageId(s.external_id)
    && !isOwnerSelfSourceName(s.display_name, accountName));
  for (const s of unownedSources) {
    const extId = String(s.external_id);
    const norm = (s.display_name || '').trim().toLowerCase();
    const key = norm || extId;
    if (!combinedByName.has(key)) {
      combinedByName.set(key, {
        page_id: extId,
        name: s.display_name || ('Page ' + extId),
        avatar_url: s.avatar_url || `https://graph.facebook.com/${extId}/picture?type=normal`,
        category: 'Trang Facebook',
        is_connected: false
      });
    }
  }

  const pages = Array.from(combinedByName.values());
  try {
    fs.appendFileSync(path.join(APP_DATA_ROOT, 'discovery-debug.log'), JSON.stringify({ at: new Date().toISOString(), tag: 'GET_PAGES', account_id: accountId, count: pages.length, pages: pages.map(p => ({ id: String(p.page_id), name: String(p.name || '').slice(0, 90), conn: !!p.is_connected })) }) + '\n');
  } catch (_) {}
  res.json({
    success: true,
    account_id: accountId,
    pages,
    updated_at: cached?.updatedAt || null
  });
});

app.post('/api/accounts/:id/pages/refresh', (req, res) => {
  if (!enterpriseAccess.canAccessAccount(req.user, req.params.id)) {
    return res.status(404).json({ success: false, error: 'Không tìm thấy tài khoản Facebook' });
  }
  const accountId = String(req.params.id);

  // Rate-limiting / Throttle: 10 giây/lần
  const lastReq = lastPageRefreshRequestedAt.get(accountId) || 0;
  const now = Date.now();
  if (now - lastReq < 10000) {
    const waitSeconds = Math.ceil((10000 - (now - lastReq)) / 1000);
    return res.status(429).json({
      success: false,
      error: `Vui lòng đợi ${waitSeconds} giây trước khi quét lại.`
    });
  }
  lastPageRefreshRequestedAt.set(accountId, now);

  const personalWs = extensionConnections.get(accountId);
  if (!personalWs || personalWs.readyState !== WebSocket.OPEN) {
    return res.status(409).json({
      success: false,
      error: 'Chrome của tài khoản Facebook này chưa kết nối. Hãy khởi động Chrome trước.'
    });
  }

  personalWs.send(JSON.stringify({ type: 'REQ_REFRESH_PAGES' }));
  console.log(`[WS] 🔄 Đã gửi REQ_REFRESH_PAGES tới extension của account=${accountId}`);
  res.json({ success: true, message: 'Đã gửi yêu cầu quét lại Fanpage.' });
});

app.post('/api/accounts/:id/pages/batch-open', async (req, res) => {
  if (!enterpriseAccess.canAccessAccount(req.user, req.params.id)) {
    return res.status(404).json({ success: false, error: 'Không tìm thấy tài khoản Facebook' });
  }
  const accountId = String(req.params.id);
  const pageIds = Array.isArray(req.body?.page_ids) ? req.body.page_ids.map(String).filter(Boolean) : [];

  if (pageIds.length === 0) {
    return res.status(400).json({ success: false, error: 'Vui lòng chọn ít nhất 1 Page để mở.' });
  }

  const accountName = getAccountName(accountId);

  const cached = discoveredPagesByAccount.get(accountId);
  const cachedPages = cached?.pages || [];
  const cachedPageMap = new Map(cachedPages.map(p => [String(p.page_id), p]));

  // Lấy các source hiện tại để kiểm tra trùng tên trước khi tạo mới (tránh tạo 2 source kép cho 1 Page)
  // Bỏ qua source rác (ID profile/delegate, tên trùng chủ account) khỏi map trùng tên
  // để không bao giờ map 1 Page thật vào external_id giả.
  const existingSources = db.prepare(`
    SELECT id, external_id, display_name
    FROM inbox_sources
    WHERE source_type = 'page_messenger' AND owner_account_id = ?
  `).all(accountId).filter((s) => !isSuspiciousPageId(s.external_id) && !isOwnerSelfSourceName(s.display_name, accountName));

  const existingByName = new Map();
  for (const s of existingSources) {
    const norm = (s.display_name || '').trim().toLowerCase();
    if (norm) existingByName.set(norm, s);
  }

  const openedPages = [];
  const errors = [];

  for (const rawPageId of pageIds) {
    try {
      const pageInfo = cachedPageMap.get(rawPageId);

      // ID profile/delegate 6155xxx-6159xxx (14 chữ số): Business Suite luôn
      // chặn với "nội dung không khả dụng" -> không mở, không tạo source.
      if (isSuspiciousPageId(rawPageId)) {
        console.log(`[BatchOpen] Bỏ qua ID profile/delegate ${rawPageId} (không phải ID page thật).`);
        errors.push(`Đã bỏ qua ID ${rawPageId} - không phải Fanpage thật.`);
        continue;
      }

      // Tên quét được là tiêu đề UI Facebook ("Quản lý trang"...) -> ID giả,
      // mở tab Business Suite luôn bị chặn. Bỏ qua luôn, không tạo source.
      // Chỉ chặn khi có pageInfo thật (cache rỗng sau restart thì vẫn mở bình thường).
      if (pageInfo?.name && (isGenericPageName(pageInfo.name) || isOwnerSelfSourceName(pageInfo.name, accountName))) {
        console.log(`[BatchOpen] Bỏ qua Page giả "${pageInfo.name}" (${rawPageId}).`);
        errors.push(`Đã bỏ qua "${pageInfo.name}" - không phải Fanpage thật.`);
        continue;
      }

      const pageName = pageInfo?.name || ('Page ' + rawPageId);
      const norm = pageName.trim().toLowerCase();

      // Nếu đã có source cùng tên trong DB, ưu tiên dùng external_id sẵn có
      const existingMatch = norm ? existingByName.get(norm) : null;
      const pageId = existingMatch ? String(existingMatch.external_id) : rawPageId;

      // 1. Đảm bảo inbox source tồn tại và đã gắn owner_account_id (không cần token)
      const source = InboxSourceService.ensurePageSource({
        pageId,
        accountId,
        pageName: existingMatch?.display_name || pageName
      }, db);

      // 2. Mở tab Meta Business Suite trong Chrome của account này
      const ok = await processManager.openBusinessTabForPage(pageId, accountId);
      if (ok) {
        openedPages.push(pageId);
        if (source) {
          io.emit('INBOX_SOURCE_ADDED', {
            id: source.id,
            source_type: 'page_messenger',
            display_name: source.display_name,
            owner_account_id: accountId
          });
        }
      } else {
        errors.push(`Không thể mở tab cho Page ${pageId}`);
      }
    } catch (err) {
      console.warn(`[BatchOpen] Lỗi khi mở Page ${rawPageId}:`, err.message);
      errors.push(err.message);
    }
  }

  io.emit('THREAD_LIST_UPDATED');
  res.json({
    success: openedPages.length > 0,
    opened_count: openedPages.length,
    opened_page_ids: openedPages,
    error: openedPages.length === 0 && errors.length > 0 ? errors.join('; ') : undefined,
    errors: errors.length > 0 ? errors : undefined
  });
});

*/

app.post('/api/accounts/new-session', async (req, res) => {
  if (!enterpriseAccess.isCompanyAdmin(req.user) && !(req.user.role === 'ADMIN' && req.user.username === 'admin')) {
    return res.status(403).json({ success: false, error: 'Chỉ Admin doanh nghiệp được thêm tài khoản Facebook.' });
  }
  // Reuse this operator's unfinished login window. A new pending profile on
  // every click loses Facebook's device cookies, makes each retry look like a
  // new browser, and leaves several heavy Chrome processes alive.
  for (const [existingPendingKey, ownerUserId] of pendingAccountOwners.entries()) {
    if (String(ownerUserId) !== String(req.user.id)) continue;
    if (processManager.getStatus(existingPendingKey) !== 'RUNNING') {
      pendingAccountOwners.delete(existingPendingKey);
      continue;
    }
    processManager.unhideWindow(existingPendingKey);
    console.log(`[API] Reuse unfinished Facebook login session: ${existingPendingKey}`);
    return res.json({ success: true, pending_key: existingPendingKey, reused: true });
  }
  // NOTE: the old on-disk recovery (scanning profiles/pending_* markers and
  // reviving the newest one after a backend restart) is intentionally gone.
  // A revived profile has no Puppeteer attachment, so the window it opens
  // carries whatever extension state a previous run left behind - in practice
  // an orphan Chrome with no working CRM extension, so nothing ever sent
  // REGISTER_ACCOUNT and the operator UI waited on "Đang chờ đăng nhập
  // Facebook..." forever (reproduced 2026-09-17). Every click now either
  // reuses an in-memory session THIS process launched (extension guaranteed
  // installed) or creates a fresh pending profile via startNewAccountProcess,
  // whose puppeteer launch installs the extension before Facebook opens.

  const now = new Date();
  const dateStr = now.toISOString().replace(/[-T:.Z]/g, '').substring(0, 14);
  const randomStr = Math.random().toString(36).substring(2, 7);
  const pendingKey = `pending_${dateStr}_${randomStr}`;
  pendingAccountOwners.set(pendingKey, req.user.id);

  const pendingProfileDir = path.join(APP_DATA_ROOT, 'profiles', pendingKey);
  fs.mkdirSync(pendingProfileDir, { recursive: true });
  fs.writeFileSync(
    path.join(pendingProfileDir, '.crm-pending-owner.json'),
    JSON.stringify({ owner_user_id: req.user.id, created_at: new Date().toISOString() })
  );

  console.log(`[API] Tạo phiên đăng ký tài khoản Facebook mới: ${pendingKey}`);
  const success = await processManager.startNewAccountProcess(pendingKey);
  if (!success) pendingAccountOwners.delete(pendingKey);
  res.json({ success, pending_key: pendingKey, error: success ? undefined : (`Không thể mở Chrome: ${processManager.lastLaunchError || "Lỗi không xác định"}`) });
});
// The AccountManagerModal polls this every 1.5s while a setup session is
// open, as the fallback when the ACCOUNT_STATUS_CHANGED socket event is
// missed. Completed = REGISTER_ACCOUNT promoted this pending key, or an
// ACTIVE accounts row already points at the pending profile (covers a
// backend restart between register and poll).
app.get('/api/facebook-setup/:pendingKey/status', (req, res) => {
  const pendingKey = String(req.params.pendingKey || '').trim();
  if (!/^pending_[a-zA-Z0-9_]+$/.test(pendingKey)) {
    return res.status(400).json({ success: false, error: 'pending_key không hợp lệ.' });
  }
  const ownerUserId = pendingAccountOwners.get(pendingKey) || markerOwnerUserId(pendingKey);
  if (ownerUserId && String(ownerUserId) !== String(req.user.id)) {
    return res.status(403).json({ success: false, error: 'Phiên thêm tài khoản này thuộc người dùng khác.' });
  }
  let completion = completedPendingSetups.get(pendingKey);
  if (!completion) {
    const row = db.prepare("SELECT id FROM accounts WHERE profile_dir LIKE ? AND status = 'ACTIVE'").get(`%${pendingKey}%`);
    if (row) {
      completion = { account_id: String(row.id), completed_at: Date.now() };
      completedPendingSetups.set(pendingKey, completion);
    }
  }
  res.json({ success: true, completed: Boolean(completion), account_id: completion?.account_id || null });
});

// ── Viet Seeding: nhập hàng loạt account Facebook bằng cookie từ API export ──
const isFbAccountAdmin = (user) => enterpriseAccess.isCompanyAdmin(user)
  || (user?.role === 'ADMIN' && user?.username === 'admin');

app.get('/api/accounts/vietseeding/config', (req, res) => {
  if (!isFbAccountAdmin(req.user)) {
    return res.status(403).json({ success: false, error: 'Chỉ Admin doanh nghiệp được cấu hình nhập cookie.' });
  }
  res.json({ success: true, ...VietSeedingImportService.getConfigSummary() });
});

app.post('/api/accounts/vietseeding/config', (req, res) => {
  if (!isFbAccountAdmin(req.user)) {
    return res.status(403).json({ success: false, error: 'Chỉ Admin doanh nghiệp được cấu hình nhập cookie.' });
  }
  const summary = VietSeedingImportService.saveConfig({
    api_key: typeof req.body?.api_key === 'string' ? req.body.api_key : undefined
  });
  res.json({ success: true, ...summary });
});

app.get('/api/accounts/vietseeding/import-status', (req, res) => {
  if (!isFbAccountAdmin(req.user)) {
    return res.status(403).json({ success: false, error: 'Chỉ Admin doanh nghiệp được xem tiến trình nhập.' });
  }
  res.json({ success: true, job: VietSeedingImportService.getJobStatus() });
});

app.post('/api/accounts/vietseeding/list-accounts', async (req, res) => {
  if (!isFbAccountAdmin(req.user)) {
    return res.status(403).json({ success: false, error: 'Chỉ Admin doanh nghiệp được xem danh sách tài khoản.' });
  }
  try {
    const limit = Math.max(1, Math.min(100, Number(req.body?.limit) || 20));
    const result = await VietSeedingImportService.listAccountsForSelection(limit, processManager);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  }
});

app.post('/api/accounts/vietseeding/import', (req, res) => {
  if (!isFbAccountAdmin(req.user)) {
    return res.status(403).json({ success: false, error: 'Chỉ Admin doanh nghiệp được nhập tài khoản từ Viet Seeding.' });
  }
  try {
    const limit = Math.max(1, Math.min(100, Number(req.body?.limit) || 10));
    const identifiers = Array.isArray(req.body?.identifiers)
      ? req.body.identifiers.map((v) => String(v || '').trim()).filter(Boolean).slice(0, 100)
      : null;
    const job = VietSeedingImportService.startImport({
      limit,
      identifiers,
      ownerUserId: req.user.id,
      processManager,
      registerOwner: (pendingKey, userId) => pendingAccountOwners.set(pendingKey, userId),
      releaseOwner: (pendingKey) => pendingAccountOwners.delete(pendingKey)
    });
    console.log(`[API] Bắt đầu đợt nhập Viet Seeding (limit=${limit}) bởi user ${req.user.id}: ${job.job_id}`);
    res.json({ success: true, ...job });
  } catch (err) {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  }
});

// ── Comment leads: khách bình luận bài viết → tin nhắn chờ (QueueWorker 24/7) ──
app.get('/api/comment-leads/config', (req, res) => {
  res.json({ success: true, configured: CommentLeadsService.isConfigured() });
});

app.get('/api/comment-leads', (req, res) => {
  res.json({ success: true, ...CommentLeadsService.listLeads() });
});

app.post('/api/comment-leads/scan', async (req, res) => {
  try {
    const result = await CommentLeadsService.scanPost(req.body?.post_url);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  }
});

app.post('/api/comment-leads/fetch', async (req, res) => {
  try {
    const result = await CommentLeadsService.fetchLeads(req.body?.post_url);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  }
});

app.post('/api/comment-leads/enqueue', (req, res) => {
  try {
    // Không cần chọn tay: tự lấy account đầu tiên đang nối extension.
    // QueueWorker fail vĩnh viễn row khi extension vắng (không retry) —
    // không có account online nào thì chặn luôn thay vì bắn mù fail hết.
    let accountId = String(req.body?.account_id || '').trim();
    if (!accountId) {
      const accountRows = db.prepare('SELECT id FROM accounts').all();
      accountId = accountRows.map((r) => String(r.id)).find((id) => {
        const ws = extensionConnections.get(id);
        return ws && ws.readyState === WebSocket.OPEN;
      }) || '';
      if (!accountId) {
        try { CommentLeadsService.debugLog('enqueue: chặn 409 — không có tài khoản nào đang chạy Chrome'); } catch (_) {}
        return res.status(409).json({ success: false, error: 'Chưa có tài khoản nào đang chạy Chrome — mở/Kết nối ít nhất 1 tài khoản rồi thử lại.' });
      }
    } else {
      const ws = extensionConnections.get(accountId);
      if (!ws || ws.readyState !== 1) {
        try { CommentLeadsService.debugLog(`enqueue: chặn 409 — Chrome của account ${accountId} chưa kết nối`); } catch (_) {}
        return res.status(409).json({ success: false, error: 'Chrome của tài khoản này chưa kết nối — mở/Kết nối tài khoản rồi thử lại.' });
      }
    }
    try { CommentLeadsService.debugLog(`enqueue: request account=${accountId} post_url=${String(req.body?.post_url || '').trim() || '(trống)'}`); } catch (_) {}
    const result = CommentLeadsService.enqueue({
      postUrl: req.body?.post_url,
      accountId,
      content: String(req.body?.content || '').trim() || CommentLeadsService.DEFAULT_MESSAGE_TEMPLATE
    });
    if (result.queued > 0) io.emit('THREAD_LIST_UPDATED', {});
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  }
});

app.delete('/api/accounts/:id', (req, res) => {
  try {
    const accountId = String(req.params.id || '').trim();
    completeNewAccountBootstrapSync(accountId);
    const account = enterpriseAccess.canAccessAccount(req.user, accountId)
      ? db.prepare('SELECT id, profile_dir FROM accounts WHERE id = ?').get(accountId) : null;
    if (!enterpriseAccess.isCompanyAdmin(req.user) && !(req.user.role === 'ADMIN' && req.user.username === 'admin')) {
      return res.status(403).json({ success: false, error: 'Chỉ Admin doanh nghiệp được xóa tài khoản Facebook.' });
    }
    if (!account) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy tài khoản Facebook' });
    }

    // Block late REGISTER_ACCOUNT frames before terminating the detached
    // Chrome tree, otherwise the account can be recreated during deletion.
    processManager.stopAccountProcess(accountId);
    backgroundAfterConnectRequests.delete(accountId);
    const extension = extensionConnections.get(accountId);
    extensionConnections.delete(accountId);
    InboxSyncScheduler.unregisterAccount(accountId);
    domReplaySuppressUntil.delete(accountId);
    if (extension && extension.readyState === WebSocket.OPEN) {
      extension.close(1000, 'ACCOUNT_REMOVED');
    }

    const result = AccountService.removeAccount(accountId, db);
    // Xóa luôn thư mục profile Chrome của tài khoản (yêu cầu sản phẩm
    // 2026-09-17 - trước đây thư mục được cố tình giữ lại để tái sử dụng
    // Facebook trust). Chạy trễ 1.5s sau response để Chrome tree từ
    // stopAccountProcess kịp thoát và nhả file lock; rmSync có sẵn retry,
    // nếu vẫn khóa thì sweep định kỳ sẽ dọn nốt.
    const deletedAccountDir = String(account?.profile_dir || result?.profile_dir || '');
    if (deletedAccountDir) {
      setTimeout(() => { deleteChromeProfileDir(deletedAccountDir); }, 1500);
    }
    // Close a popup that may already be visible before clients remove the
    // account from their local list.
    io.emit('INCOMING_CALL_ENDED', { account_id: accountId, reason: 'ACCOUNT_REMOVED' });
    io.emit('ACCOUNT_REMOVED', { account_id: accountId });
    io.emit('INBOX_SOURCE_REMOVED', { id: 'src_personal_' + accountId });
    res.json({ success: true, data: result });
  } catch (error) {
    console.error('[API] Không thể xóa tài khoản Facebook:', error);
    res.status(500).json({ success: false, error: 'Không thể xóa tài khoản Facebook', detail: error.message });
  }
});

// Threads
app.get('/api/threads/waiting-count', (req, res) => {
  try {
    // Count only Facebook accounts that this signed-in user can access. This
    // keeps the badge identical to the WAITING conversation list and ignores
    // stale or unassigned account data.
    const accessibleAccountIds = enterpriseAccess.listAccounts(req.user).map((account) => String(account.id));
    res.setHeader('Cache-Control', 'no-store');
    if (accessibleAccountIds.length === 0) return res.json({ count: 0 });
    const placeholders = accessibleAccountIds.map(() => '?').join(',');
    const row = db.prepare(`
      SELECT COUNT(*) as count FROM threads t
      JOIN accounts a ON a.id = t.account_id
      WHERE COALESCE(t.inbox_folder, 'INBOX') IN ('MESSAGE_REQUEST_SPAM', 'MESSAGE_REQUEST_POSSIBLE')
      AND t.archived_at IS NULL
      AND t.account_id IN (${placeholders})
    `).get(...accessibleAccountIds);
    res.json({ count: row?.count || 0 });
  } catch (error) {
    res.json({ count: 0 });
  }
});

app.get('/api/threads', (req, res) => {
  const { tab = 'ALL' } = req.query;
  const threads = assignmentManager.getThreadsByFilter(req.user.id, req.user.role, tab, 'all', req.user.company_id, req.user.company_role, req.user.username);
  res.json(threads);
});


function sendFollowupError(res, error) {
  return res.status(error.statusCode || 500).json({ error: error.message || 'Không thể cập nhật follow-up.' });
}

app.put('/api/threads/:id/reminder', (req, res) => {
  try {
    res.json(followupService.setReminder(req.params.id, req.body?.due_at, req.body?.note));
  } catch (error) {
    sendFollowupError(res, error);
  }
});
app.post('/api/threads/:id/reminder/complete', (req, res) => {
  try {
    res.json(followupService.completeReminder(req.params.id));
  } catch (error) {
    sendFollowupError(res, error);
  }
});
app.delete('/api/threads/:id/reminder', (req, res) => {
  try {
    res.json(followupService.cancelReminder(req.params.id));
  } catch (error) {
    sendFollowupError(res, error);
  }
});
app.post('/api/threads/:id/archive', (req, res) => {
  try {
    const result = followupService.archive(req.params.id);
    res.json({ success: true, archived_at: result.archived_at });
  } catch (error) {
    sendFollowupError(res, error);
  }
});
app.post('/api/threads/:id/restore', (req, res) => {
  try {
    followupService.restore(req.params.id);
    res.json({ success: true, archived_at: null });
  } catch (error) {
    sendFollowupError(res, error);
  }
});

// Đánh dấu chưa đọc / đã đọc bằng tay. Không gửi "unread" trong body = toggle.
app.post('/api/threads/:id/unread', (req, res) => {
  try {
    const id = req.params.id;
    const row = db.prepare('SELECT is_unread FROM threads WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: 'Không tìm thấy hội thoại.' });
    const desired = req.body && req.body.unread !== undefined ? Number(req.body.unread) : null;
    const next = desired === null ? (Number(row.is_unread) ? 0 : 1) : (desired ? 1 : 0);
    if (next !== Number(row.is_unread)) {
      // unread_manual 3 trạng thái: 1 = đánh tay CHƯA ĐỌC, -1 = đánh tay ĐÃ ĐỌC
      // (dính cả hai chiều, sync sidebar không được đè), 0 = tự động theo FB.
      db.prepare('UPDATE threads SET is_unread = ?, unread_manual = ? WHERE id = ?').run(next, next ? 1 : -1, id);
    } else if (desired !== null && next === 0) {
      // Mở hội thoại khi DB đã là đã-đọc: vẫn ghim -1, không thì cờ manual=0
      // giữ nguyên và sync sau quét lại chấm xanh còn treo trên Messenger
      // sẽ nổi chưa đọc trở lại (đúng triệu chứng user báo 2026-10-08).
      db.prepare('UPDATE threads SET unread_manual = -1 WHERE id = ?').run(id);
    }
    io.emit('THREAD_UNREAD_CHANGED', { thread_id: String(id), is_unread: next });
    res.json({ success: true, id: String(id), is_unread: next });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Không thể cập nhật trạng thái chưa đọc.' });
  }
});

// Đánh dấu khách đã đọc: content script bắt 'Đã xem' trong DOM hội thoại
// đang mở trên tab Facebook rồi relay về đây.
app.post('/api/threads/:id/seen', (req, res) => {
  try {
    // Content script gửi BARE id từ URL (/messages/t/<psid>), còn DB lưu id
    // ghép '<account>:<psid>' cho hội thoại cá nhân - phải phân giải qua bộ
    // giải chuẩn như mọi luồng sync, không thì UPDATE không khớp hàng nào.
    const rawId = req.params.id;
    const accountId = req.body?.account_id || null;
    const canonicalId = resolveInternalThreadId(db, accountId, rawId) || rawId;
    const last = db.prepare(
      'SELECT id FROM messages WHERE thread_id = ? AND is_outgoing = 1 ORDER BY COALESCE(sequence_order, id) DESC LIMIT 1'
    ).get(canonicalId);
    if (!last) return res.json({ success: true, last_seen_message_id: null });
    const prev = db.prepare('SELECT last_seen_message_id FROM threads WHERE id = ?').get(canonicalId);
    if (String(prev?.last_seen_message_id || '') !== String(last.id)) {
      db.prepare('UPDATE threads SET last_seen_message_id = ? WHERE id = ?').run(String(last.id), canonicalId);
      io.emit('THREAD_SEEN', { thread_id: String(canonicalId), last_seen_message_id: String(last.id) });
    }
    res.json({ success: true, last_seen_message_id: String(last.id) });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Không thể ghi nhận đã xem.' });
  }
});

// Ghim / bỏ ghim hội thoại. Không gửi "pinned" trong body = toggle.
// pinned_at = thời điểm ghim — nhóm ghim xếp theo nó (mới ghim lên đầu) nên
// hội thoại ghim KHÔNG trôi theo tin nhắn mới; bỏ ghim mới tụt xuống nhóm thường.
app.post('/api/threads/:id/pin', (req, res) => {
  try {
    const id = req.params.id;
    const row = db.prepare('SELECT pinned FROM threads WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: 'Không tìm thấy hội thoại.' });
    const desired = req.body && req.body.pinned !== undefined ? Number(req.body.pinned) : null;
    const next = desired === null ? (Number(row.pinned) ? 0 : 1) : (desired ? 1 : 0);
    let pinnedAt = null;
    if (next !== Number(row.pinned)) {
      if (next === 1) {
        pinnedAt = db.prepare("SELECT strftime('%Y-%m-%d %H:%M:%f', 'now') AS ts").get().ts;
        db.prepare('UPDATE threads SET pinned = ?, pinned_at = ? WHERE id = ?').run(next, pinnedAt, id);
      } else {
        db.prepare('UPDATE threads SET pinned = ?, pinned_at = NULL WHERE id = ?').run(next, id);
      }
    } else if (next === 1) {
      pinnedAt = db.prepare('SELECT pinned_at FROM threads WHERE id = ?').get(id)?.pinned_at || null;
    }
    io.emit('THREAD_PIN_CHANGED', { thread_id: String(id), pinned: next, pinned_at: pinnedAt });
    res.json({ success: true, id: String(id), pinned: next, pinned_at: pinnedAt });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Không thể cập nhật trạng thái ghim.' });
  }
});

app.post('/api/threads/:id/assign', (req, res) => {
  const user_id = req.user.id;
  const result = assignmentManager.assignThread(req.params.id, user_id);
  if (result.success) io.emit('THREAD_ASSIGNED', { thread_id: req.params.id, user_id });
  res.json(result);
});

app.post('/api/threads/:id/complete', (req, res) => {
  const result = assignmentManager.completeThread(req.params.id);
  io.emit('THREAD_COMPLETED', { thread_id: req.params.id });
  res.json(result);
});

// Đặt lại trạng thái hoàn thành lịch sử và cho phép cào lại lịch sử
app.post('/api/threads/:id/resync', (req, res) => {
  try {
    const id = req.params.id;
    if (req.user && !enterpriseAccess.canAccessThread(req.user, id)) {
      return res.status(403).json({ error: 'Không có quyền truy cập hội thoại này.' });
    }
    const thread = db.prepare('SELECT id, account_id, history_completed FROM threads WHERE id = ?').get(id);
    if (!thread) return res.status(404).json({ error: 'Không tìm thấy hội thoại.' });

    db.prepare('UPDATE threads SET history_completed = 0 WHERE id = ?').run(id);
    InboxSyncScheduler.resetThreadHistoryCompleted(id, thread.account_id);
    io.emit('THREAD_HISTORY_RESET', { thread_id: String(id), account_id: thread.account_id });

    res.json({ success: true, id: String(id), history_completed: 0 });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Không thể đặt lại trạng thái đồng bộ.' });
  }
});



// Contacts / Leads
// CRM one-to-one rich-message capabilities and thread-bound staging.
// This server has no user session layer yet, so new file operations fail
// closed outside loopback and content URLs additionally require a short-lived HMAC.
app.get(
  '/api/threads/:threadId/rich-message-capabilities',
  requireLocalCrmRequest,
  (req, res) => {
    try {
      if (!enterpriseAccess.canAccessThread(req.user, req.params.threadId)) return res.status(404).json({ error: 'Không tìm thấy hội thoại.' });
      res.json(RichMessageCapabilityService.getForThread(
        req.params.threadId,
        getRichMessageCapabilityOptions()
      ));
    } catch (error) {
      sendRichMessageError(res, error);
    }
  }
);

app.post(
  '/api/threads/:threadId/outbound-attachments',
  requireLocalCrmRequest,
  express.raw({ type: 'multipart/form-data', limit: '105mb' }),
  (req, res) => {
    try {
      if (!enterpriseAccess.canAccessThread(req.user, req.params.threadId)) return res.status(404).json({ error: 'Không tìm thấy hội thoại.' });
      const operatorId = req.user.id;
      if (operatorId == null) {
        return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'CRM chưa có operator hợp lệ.' });
      }
      const parsed = OutboundAttachmentService.parseMultipartBody(
        req.body,
        req.headers['content-type']
      );
      const attachment = OutboundAttachmentService.stageUpload({
        threadId: req.params.threadId,
        createdBy: operatorId,
        originalName: parsed.file.originalName,
        declaredMimeType: parsed.file.declaredMimeType,
        buffer: parsed.file.buffer
      }, {
        database: db,
        capabilityOptions: getRichMessageCapabilityOptions()
      });
      const access = createAttachmentContentToken(attachment.id);
      res.status(201).json({
        attachment: {
          ...attachment,
          preview_url: '/api/outbound-attachments/' + attachment.id +
            '/content?expires=' + access.expires + '&token=' + access.token
        }
      });
    } catch (error) {
      sendRichMessageError(res, error);
    }
  }
);

app.delete(
  '/api/threads/:threadId/outbound-attachments/:attachmentId',
  requireLocalCrmRequest,
  (req, res) => {
    try {
      if (!enterpriseAccess.canAccessThread(req.user, req.params.threadId)) return res.status(404).json({ error: 'Không tìm thấy hội thoại.' });
      const operatorId = req.user.id;
      if (operatorId == null) {
        return res.status(401).json({ code: 'AUTH_REQUIRED', error: 'CRM chưa có operator hợp lệ.' });
      }
      const discarded = OutboundAttachmentService.discard(
        req.params.threadId,
        req.params.attachmentId,
        operatorId,
        { database: db }
      );
      if (discarded === false) {
        return res.status(409).json({
          code: 'ATTACHMENT_NOT_DISCARDABLE',
          error: 'File không thuộc hội thoại này hoặc không còn ở trạng thái chờ gửi.'
        });
      }
      res.status(204).end();
    } catch (error) {
      sendRichMessageError(res, error);
    }
  }
);

// Serve campaign-attachment images for in-chat preview (local_media_path stores absolute path,
// but the browser can only fetch via HTTP - use a thin proxy route to pipe the file contents).
const CAMPAIGN_ATTACHMENTS_DIR = path.join(APP_DATA_ROOT, 'campaign-attachments');
app.get('/api/campaign-attachments/:filename', requireLocalCrmRequest, (req, res) => {
  try {
    const filename = path.basename(req.params.filename); // strip any traversal
    const filePath = path.join(CAMPAIGN_ATTACHMENTS_DIR, filename);
    if (!filePath.startsWith(CAMPAIGN_ATTACHMENTS_DIR)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.set('Cache-Control', 'private, max-age=86400');
    res.sendFile(filePath);
  } catch (err) {
    res.status(404).json({ error: 'File không tồn tại' });
  }
});

app.get(
  '/api/outbound-attachments/:attachmentId/content',
  requireLocalCrmRequest,
  (req, res) => {
    try {
      if (verifyAttachmentContentToken(
        req.params.attachmentId,
        req.query.expires,
        req.query.token
      ) === false) {
        return res.status(403).json({
          code: 'ATTACHMENT_TOKEN_INVALID',
          error: 'Liên kết file không hợp lệ hoặc đã hết hạn.'
        });
      }
      const attachment = OutboundAttachmentService.resolveContent(
        req.params.attachmentId,
        { database: db }
      );
      if (attachment == null) {
        return res.status(404).json({ code: 'ATTACHMENT_NOT_FOUND', error: 'Không tìm thấy file.' });
      }
      const disposition = (attachment.media_type === 'image' || attachment.media_type === 'video' || attachment.media_type === 'voice') ? 'inline' : 'attachment';
      res.set('Cache-Control', 'private, no-store');
      res.set('Content-Type', attachment.mime_type);
      res.set(
        'Content-Disposition',
        disposition + "; filename*=UTF-8''" + encodeURIComponent(attachment.safe_name)
      );
      res.sendFile(attachment.storage_path);
    } catch (error) {
      sendRichMessageError(res, error);
    }
  }
);

app.get('/api/contacts/:thread_id', (req, res) => {
  if (!enterpriseAccess.canAccessThread(req.user, req.params.thread_id)) return res.status(404).json({ error: 'Không tìm thấy hội thoại' });
  const contact = db.prepare('SELECT * FROM contacts WHERE thread_id=?').get(req.params.thread_id) || {};
  const phoneView = PhoneCaptureService.getContactPhoneView(req.params.thread_id, db);
  res.json({ ...contact, phone_candidates: phoneView.phone_candidates, phone_capture: phoneView.phone_capture });
});

app.put('/api/contacts/:thread_id', (req, res) => {
  if (!enterpriseAccess.canAccessThread(req.user, req.params.thread_id)) return res.status(404).json({ error: 'Không tìm thấy hội thoại' });
  let updatedContact;
  try {
    updatedContact = ContactService.update(req.params.thread_id, req.body, db);
  } catch (error) {
    if (error instanceof ContactService.PhoneCaptureNotFoundError) {
      return res.status(400).json({ error: error.message });
    }
    throw error;
  }
  const phoneView = PhoneCaptureService.getContactPhoneView(req.params.thread_id, db);
  const status = updatedContact.status_id == null ? null : db.prepare(
    'SELECT name AS status_name, color AS status_color FROM lead_statuses WHERE id = ?'
  ).get(updatedContact.status_id);
  const contact = { ...updatedContact, ...phoneView, ...(status || {}) };
  io.emit('CONTACT_UPDATED', {
    thread_id: req.params.thread_id,
    phone: contact.phone,
    status_id: contact.status_id,
    status_name: contact.status_name || null,
    status_color: contact.status_color || null,
    phone_source: contact.phone_source,
    phone_captured_at: contact.phone_captured_at
  });
  res.json({ success: true, contact });
});

// Inbox Sources — Personal and Page connected sources
// Bộ lọc khoảng ngày (2026-10-23, nâng cấp từ lọc 1 ngày 2026-09-18): trả về
// các hội thoại có tin nhắn trong khoảng [from, to] - mốc "to" được tính trọn
// cả ngày đó - theo timestamp_ms của messages (nguồn ngày chuẩn khớp
// Messenger; last_activity bị trộn múi giờ nên không dùng).
app.get('/api/threads/active-on', (req, res) => {
  try {
    const range = resolveActiveOnWindow(req.query);
    if (range.error === 'MISSING_RANGE') {
      return res.status(400).json({ success: false, error: 'Thiếu khoảng ngày (from/to, YYYY-MM-DD).' });
    }
    if (range.error === 'BAD_FORMAT') {
      return res.status(400).json({ success: false, error: 'Sai định dạng ngày (YYYY-MM-DD).' });
    }
    if (range.error) {
      return res.status(400).json({ success: false, error: 'Ngày không hợp lệ.' });
    }
    // Scope bằng CÙNG logic với danh sách hội thoại đang hiển thị
    // (assignmentManager.getThreadsByFilter) - không dùng listAccounts vì
    // company_id của account có thể khác company của user (reproduced
    // 2026-09-19: filter ngày trả rỗng dù hội thoại hiển thị bình thường).
    const visible = assignmentManager.getThreadsByFilter(
      req.user.id, req.user.role, 'ALL', 'all', req.user.company_id, req.user.company_role, req.user.username
    );
    const visibleIds = new Set(visible.map((t) => String(t.id)));
    const conditions = [];
    const params = [];
    if (range.startMs != null) { conditions.push('timestamp_ms >= ?'); params.push(range.startMs); }
    if (range.endMs != null) { conditions.push('timestamp_ms < ?'); params.push(range.endMs); }
    const rows = db.prepare(
      `SELECT DISTINCT thread_id AS id FROM messages WHERE ${conditions.join(' AND ')}`
    ).all(...params);
    const threadIds = rows.map((r) => String(r.id)).filter((id) => visibleIds.has(id));
    res.json({ success: true, from: range.from, to: range.to, thread_ids: threadIds });
  } catch (error) {
    console.error('[API] active-on lỗi:', error.message);
    res.status(500).json({ success: false, error: 'Không thể lọc theo ngày.' });
  }
});

app.get('/api/inbox-sources', (req, res) => {
  try {
    const accountIds = enterpriseAccess.listAccounts(req.user).map(account => String(account.id));
    const sources = accountIds.length ? db.prepare(`
      SELECT id,source_type,owner_account_id,external_id,display_name,avatar_url,status,webhook_verify_token,created_at
      FROM inbox_sources WHERE owner_account_id IN (${accountIds.map(() => '?').join(',')}) ORDER BY created_at ASC
    `).all(...accountIds) : [];
    res.json(sources);
  } catch (error) {
    console.error('[InboxSource] Fetch failed:', error);
    res.status(500).json({ error: error.message || 'Không thể lấy danh sách nguồn hội thoại' });
  }
});

// Manual "Kết nối Page" flow (AccountManagerModal) — this only ever accepted a
// raw Page ID or a profile.php?id= link (per the UI's own placeholder text;
// no Graph API token is actually needed since the extension does DOM
// automation, not the Graph API), but no route ever backed the POST the
// frontend sends here — every submit 404'd and Express's default handler
// returned an HTML page, which broke on the client's res.json() with
// "Unexpected token '<' ... is not valid JSON". Reuses ensurePageSource(),
// the same idempotent upsert the automatic page_dom_observer path already
// uses, so a manually-added Page behaves identically to an auto-detected one.
app.post('/api/inbox-sources/page', (req, res) => {
  try {
    const raw = String(req.body?.page_access_token || '').trim();
    const requestedOwnerAccountId = req.body?.owner_account_id || null;
    const ownerAccountId = requestedOwnerAccountId && enterpriseAccess.canAccessAccount(req.user, requestedOwnerAccountId)
      ? String(requestedOwnerAccountId)
      : null;
    if (!raw) return res.status(400).json({ error: 'Thiếu Link Page hoặc ID Page' });

    const pageId = parsePageIdFromInput(raw);
    if (!pageId) {
      return res.status(400).json({ error: 'Không nhận diện được ID Page. Dùng ID số hoặc link dạng facebook.com/profile.php?id=...' });
    }

    if (!ownerAccountId) return res.status(403).json({ error: 'Tài khoản Facebook sở hữu Page không hợp lệ hoặc bạn không có quyền truy cập.' });
    const source = InboxSourceService.ensurePageSource({ pageId, accountId: ownerAccountId, pageName: null }, db);
    if (source && source.status !== 'ACTIVE') {
      // Bấm "Kết nối Page" là ý định rõ ràng của user — page từng bị ngắt
      // (DISCONNECTED/TOKEN_EXPIRED) phải sống lại, không ensurePageSource nào
      // tự làm điều đó cho row đã tồn tại.
      InboxSourceService.updateSourceStatus(source.id, 'ACTIVE');
      source.status = 'ACTIVE';
    }
    // Mở trực tiếp tab Hộp thư Meta Business Suite trên profile Chrome đã đăng nhập
    // của tài khoản sở hữu Page để extension đồng bộ tin nhắn ngay lập tức.
    processManager.openPageInboxInAccountChrome(ownerAccountId, pageId).catch((launchError) => {
      console.warn(`[InboxSource] Không thể mở Business Suite cho Page ${pageId}:`, launchError.message);
    });
    io.emit('INBOX_SOURCE_ADDED', { id: source.id, source_type: 'page_messenger', display_name: source.display_name });
    res.json(source);
  } catch (error) {
    console.error('[InboxSource] Kết nối Page thủ công thất bại:', error);
    res.status(500).json({ error: error.message || 'Không thể kết nối Page' });
  }
});

// Nút "Ngắt" (Quản lý → Fanpage Messenger Đang Kết Nối): ngắt mềm — row + tin
// cũ giữ nguyên, watcher/webhook/backfill bỏ qua nguồn DISCONNECTED. Trước đây
// client gọi DELETE nhưng server không có route nào cả (404 im lặng, nút chết).
// Kết nối lại: "Kết nối Page" thủ công (route trên có kích hoạt lại) hoặc chạy
// Lấy token cho page (savePages lưu token mới sẽ bật lại ACTIVE).
app.delete('/api/inbox-sources/:id', requireCompanyAdmin, (req, res) => {
  try {
    const source = db.prepare('SELECT id, owner_account_id FROM inbox_sources WHERE id = ?').get(String(req.params.id));
    if (!source) return res.status(404).json({ success: false, error: 'Không tìm thấy nguồn hội thoại.' });
    if (source.owner_account_id && !enterpriseAccess.canAccessAccount(req.user, source.owner_account_id)) {
      return res.status(403).json({ success: false, error: 'Bạn không có quyền ngắt nguồn này.' });
    }
    InboxSourceService.removeSource(source.id);
    res.json({ success: true, id: source.id, status: 'DISCONNECTED' });
  } catch (error) {
    console.error('[InboxSource] Ngắt nguồn thất bại:', error);
    res.status(500).json({ error: error.message || 'Không thể ngắt nguồn' });
  }
});

// Lead Statuses — staff-created, reusable, color-coded (feature 022)
// Quản lý màu nhãn khách hàng (2026-09-19): bảng lead_tags (name + color).
app.get('/api/lead-tags', (req, res) => {
  try {
    const tags = db.prepare('SELECT id, name, color, text_color FROM lead_tags ORDER BY name COLLATE NOCASE ASC').all();
    res.json(tags);
  } catch (error) {
    res.status(500).json({ error: 'Không thể tải danh sách nhãn.' });
  }
});
app.post('/api/lead-tags', (req, res) => {
  try {
    const name = String(req.body?.name || '').trim().slice(0, 50);
    const isHex = (s) => /^#[0-9a-fA-F]{6}$/.test(String(s || ''));
    const color = isHex(req.body?.color) ? req.body.color : '#6366F1';
    const textColor = isHex(req.body?.text_color) ? req.body.text_color : '#FFFFFF';
    if (!name) return res.status(400).json({ error: 'Tên nhãn không được để trống.' });
    const existing = db.prepare('SELECT id, name FROM lead_tags WHERE name = ? COLLATE NOCASE').get(name);
    if (existing) {
      db.prepare('UPDATE lead_tags SET color = ?, text_color = ? WHERE id = ?').run(color, textColor, existing.id);
      return res.json({ id: existing.id, name: existing.name, color, text_color: textColor });
    }
    const r = db.prepare('INSERT INTO lead_tags (name, color, text_color) VALUES (?, ?, ?)').run(name, color, textColor);
    res.json({ id: Number(r.lastInsertRowid), name, color, text_color: textColor });
  } catch (error) {
    res.status(500).json({ error: 'Không thể lưu nhãn.' });
  }
});
app.delete('/api/lead-tags/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM lead_tags WHERE id = ?').run(Number(req.params.id));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Không thể xóa nhãn.' });
  }
});
app.get('/api/lead-statuses', (req, res) => {
  res.json(db.prepare('SELECT id, name, color FROM lead_statuses ORDER BY id ASC').all());
});

app.post('/api/lead-statuses', (req, res) => {
  try {
    res.json(LeadStatusService.create(req.body, db));
  } catch (error) {
    if (error instanceof LeadStatusService.LeadStatusValidationError) {
      return res.status(400).json({ error: error.message });
    }
    console.error('[LeadStatus] Create failed:', error);
    return res.status(500).json({ error: 'Không thể tạo trạng thái mới.' });
  }
});

app.delete('/api/lead-statuses/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'id không hợp lệ' });
  const txn = db.transaction(() => {
    const { changes: unassignedCount } = db.prepare('UPDATE contacts SET status_id = NULL WHERE status_id = ?').run(id);
    // campaigns.phone_capture_status_id deliberately has no FK constraint
    // (spec 035, FR-012) - a campaign may keep pointing at a since-deleted
    // status; a capture arriving afterward reports phone_capture_status_unavailable
    // instead of silently losing the fact that a status was ever configured.
    db.prepare('DELETE FROM lead_statuses WHERE id = ?').run(id);
    return unassignedCount;
  });
  const unassignedCount = txn();
  res.json({ success: true, unassigned_count: unassignedCount });
});

// Quick Templates — staff-created canned responses saved in SQLite
app.get('/api/quick-templates', (req, res) => {
  try {
    const templates = db.prepare('SELECT id, title, content, sort_order, created_at FROM quick_templates ORDER BY sort_order ASC, id ASC').all();
    res.json(templates);
  } catch (error) {
    console.error('[QuickTemplates] Get all failed:', error);
    res.status(500).json({ error: 'Không thể lấy danh sách mẫu câu.' });
  }
});

app.post('/api/quick-templates', (req, res) => {
  try {
    const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : null;
    if (!content) {
      return res.status(400).json({ error: 'Nội dung mẫu câu không được để trống.' });
    }
    if (content.length > 2000) {
      return res.status(400).json({ error: 'Nội dung mẫu câu không được vượt quá 2000 ký tự.' });
    }
    const allTemplates = db.prepare('SELECT id, content FROM quick_templates').all();
    const normalizedNew = content.toLowerCase();
    const isDuplicate = allTemplates.some(t => String(t.content || '').trim().toLowerCase() === normalizedNew);
    if (isDuplicate) {
      return res.status(400).json({ error: 'Mẫu câu này đã tồn tại trong danh sách.' });
    }
    const maxOrderRow = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS max_order FROM quick_templates').get();
    const nextOrder = (maxOrderRow?.max_order || 0) + 1;
    const stmt = db.prepare('INSERT INTO quick_templates (title, content, sort_order) VALUES (?, ?, ?)');
    const info = stmt.run(title, content, nextOrder);
    const created = db.prepare('SELECT id, title, content, sort_order, created_at FROM quick_templates WHERE id = ?').get(info.lastInsertRowid);
    res.json({ success: true, template: created });
  } catch (error) {
    console.error('[QuickTemplates] Create failed:', error);
    res.status(500).json({ error: 'Không thể tạo mẫu câu mới.' });
  }
});

app.delete('/api/quick-templates/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'id mẫu câu không hợp lệ' });
    }
    const result = db.prepare('DELETE FROM quick_templates WHERE id = ?').run(id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Không tìm thấy mẫu câu để xóa.' });
    }
    res.json({ success: true, deleted: true });
  } catch (error) {
    console.error('[QuickTemplates] Delete failed:', error);
    res.status(500).json({ error: 'Không thể xóa mẫu câu.' });
  }
});

// Avatar serving - serves local avatar files
app.get('/api/avatars/:filename', serveAvatar);

// Search
app.get('/api/search', (req, res) => {
  const { q, limit } = req.query;
  if (!q) return res.status(400).json({ error: 'Thiếu query q' });
  res.json(searchService.searchMessages(q, Number(limit) || 50));
});

// Leads export
app.get('/api/leads', (req, res) => res.json(searchService.getCapturedLeads()));
app.post('/api/leads/export/excel', async (req, res) => {
  try { res.download(await exportService.exportLeadsToExcel()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});
app.post('/api/leads/export/csv', (req, res) => {
  try { res.download(exportService.exportLeadsToCSV()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Task 4.1: Auto-Reply CRUD ──
app.get('/api/accounts/:id/auto-replies', (req, res) => {
  try {
    res.json(autoReplyEngine.getRules(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.post('/api/accounts/:id/auto-replies', (req, res) => {
  try {
    const { keywords, trigger_keyword, response_template } = req.body;
    const result = autoReplyEngine.createRule({
      account_id: req.params.id, keywords, trigger_keyword, response_template
    });
    if (!result.success) return res.status(400).json({ error: result.error });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.patch('/api/auto-replies/:id/toggle', (req, res) => {
  try {
    res.json(autoReplyEngine.toggleRule(Number(req.params.id), req.body.is_active));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.delete('/api/auto-replies/:id', (req, res) => {
  try {
    res.json(autoReplyEngine.deleteRule(Number(req.params.id)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// ── Task 4.1b: CRUD từng cụm từ khóa của quy tắc ──
app.post('/api/auto-replies/:id/keywords', (req, res) => {
  try {
    const result = autoReplyEngine.addKeyword(Number(req.params.id), req.body.keyword);
    if (!result.success) return res.status(400).json({ error: result.error });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.patch('/api/auto-replies/keywords/:id/toggle', (req, res) => {
  try {
    res.json(autoReplyEngine.toggleKeyword(Number(req.params.id), req.body.is_active));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.delete('/api/auto-replies/keywords/:id', (req, res) => {
  try {
    res.json(autoReplyEngine.deleteKeyword(Number(req.params.id)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


function sendCampaignError(res, error) {
  const statusByCode = {
    CAMPAIGN_NOT_FOUND: 404,
    CAMPAIGN_STATE_CONFLICT: 409,
    RECIPIENT_ALREADY_SENT: 409,
    ATTACHMENT_TOO_LARGE: 413
  };
  const status = statusByCode[error.code] || 400;
  return res.status(status).json({
    error: {
      code: error.code || "CAMPAIGN_ERROR",
      message: error.message || "Campaign request failed",
      details: error.details || null
    }
  });
}

function addOperatorCampaignAudit(campaignId, eventType, payload = {}, recipientId = null) {
  const campaign = db.prepare('SELECT created_by FROM campaigns WHERE id = ?').get(campaignId);
  return CampaignRepository.addAudit(
    campaignId,
    eventType,
    payload,
    recipientId,
    db,
    {
      actorUserId: campaign?.created_by || 1,
      actorType: 'operator'
    }
  );
}

app.get('/api/settings/phone-automation', (req, res) => {
  res.json(GlobalPhoneAutomationService.get(db));
});

app.put('/api/settings/phone-automation', (req, res) => {
  try {
    const settings = GlobalPhoneAutomationService.update(req.body || {}, db);
    io.emit('PHONE_AUTOMATION_SETTINGS_UPDATED', settings);
    res.json(settings);
  } catch (error) {
    res.status(400).json({ error: error.message, code: error.code || 'PHONE_AUTOMATION_ERROR' });
  }
});

app.get('/api/campaigns/config', (req, res) => {
  const { testSourceIds, ...publicConfig } = CampaignService.getConfig();
  res.json({ ...publicConfig, testSourceCount: testSourceIds.length });
});

app.get("/api/campaigns", (req, res) => {
  res.json(CampaignRepository.listCampaigns(req.query.limit));
});

app.post("/api/campaigns", (req, res) => {
  try {
    CampaignService.assertFeatureEnabled();
    const campaign = CampaignService.createDraft({ ...(req.body || {}), created_by: req.user.id }, db, {
      getConnection: (accountId) => extensionConnections.get(accountId)
    });
    res.status(201).json(campaign);
  } catch (error) {
    sendCampaignError(res, error);
  }
});

app.get("/api/campaigns/:id", (req, res) => {
  const campaign = CampaignRepository.getCampaign(req.params.id);
  if (!campaign) return sendCampaignError(res, { code: "CAMPAIGN_NOT_FOUND", message: "Không tìm thấy chiến dịch." });
  res.json(campaign);
});

app.get('/api/campaigns/:id/response-stats', (req, res) => {
  try {
    const statistics = CampaignResponseStatsService.get(req.params.id, db);
    if (!statistics) return sendCampaignError(res, { code: 'CAMPAIGN_NOT_FOUND', message: 'Không tìm thấy chiến dịch.' });
    res.json(statistics);
  } catch (error) {
    console.error('[Campaign response stats]', error);
    res.status(500).json({ error: { code: 'CAMPAIGN_STATS_ERROR', message: 'Không thể tải thống kê phản hồi.' } });
  }
});

app.patch('/api/campaigns/:id', (req, res) => {
  try {
    CampaignService.assertFeatureEnabled();
    const campaign = CampaignService.updateDraft(req.params.id, req.body || {});
    CampaignEventService.emit(io, campaign);
    res.json(campaign);
  } catch (error) {
    sendCampaignError(res, error);
  }
});

app.post("/api/campaigns/:id/preview", (req, res) => {
  try {
    res.json(CampaignService.preview(req.params.id));
  } catch (error) {
    sendCampaignError(res, error);
  }
});
app.post('/api/campaigns/:id/attachments', express.raw({ type: 'multipart/form-data', limit: '50mb' }), async (req, res) => {
  try {
    CampaignService.assertFeatureEnabled();
    const parsed = CampaignAttachmentService.parseMultipartBody(req.body, req.headers['content-type']);
    const config = CampaignService.getConfig();
    const files = parsed.files || [parsed.file];
    // Folder selections are sent with fields.kind='folder_zip' and each part's
    // declared filename carrying the browser's webkitRelativePath (set as the
    // File's third FormData.append argument client-side) instead of a bare
    // basename - see CampaignComposer.jsx.
    const isFolderUpload = parsed.fields.kind === 'folder_zip';
    const attachment = isFolderUpload
      ? await CampaignAttachmentService.saveFolderAsZip({
          campaignId: req.params.id,
          campaignMessageId: parsed.fields.campaign_message_id,
          archiveName: parsed.fields.archive_name || 'folder.zip',
          files: files.map((file) => ({
            relativePath: file.originalName,
            declaredMimeType: file.declaredMimeType,
            buffer: file.buffer
          }))
        }, {
          database: db,
          fileEnabled: config.fileEnabled,
          maxBytes: config.fileEnabled ? config.maxAttachmentBytes : CampaignAttachmentService.DEFAULT_MAX_FILE_BYTES
        })
      : CampaignAttachmentService.saveUploads({
          campaignId: req.params.id,
          campaignMessageId: parsed.fields.campaign_message_id,
          files
        }, {
          database: db,
          imageEnabled: config.imageEnabled,
          fileEnabled: config.fileEnabled,
          maxBytes: config.fileEnabled ? config.maxAttachmentBytes : CampaignAttachmentService.DEFAULT_MAX_IMAGE_BYTES,
          allowAnyFile: config.fileEnabled
        });
    const campaign = CampaignRepository.getCampaign(req.params.id);
    CampaignEventService.emit(io, campaign);
    res.status(201).json({ attachment: Array.isArray(attachment) && attachment.length === 1 ? attachment[0] : attachment, attachments: attachment, campaign });
  } catch (error) {
    sendCampaignError(res, error);
  }
});

app.delete('/api/campaigns/:id/attachments/:attachmentId', (req, res) => {
  try {
    CampaignService.assertFeatureEnabled();
    const removed = CampaignAttachmentService.removeAttachment(req.params.id, req.params.attachmentId, { database: db });
    const campaign = CampaignRepository.getCampaign(req.params.id);
    CampaignEventService.emit(io, campaign);
    res.json({ removed, campaign });
  } catch (error) {
    sendCampaignError(res, error);
  }
});


app.post("/api/campaigns/:id/start", (req, res) => {
  try {
    CampaignService.assertFeatureEnabled();
    CampaignService.validateReadyForStart(req.params.id);
    const transitioned = CampaignRepository.updateCampaignStatus(req.params.id, "ready", "running");
    if (!transitioned) {
      throw new CampaignService.CampaignError('CAMPAIGN_STATE_CONFLICT', 'Campaign đã được xử lý bởi yêu cầu khác.');
    }
    addOperatorCampaignAudit(req.params.id, 'started', { status: 'running' });
    campaignRunner.start(req.params.id);
    CampaignEventService.emit(io, CampaignRepository.getCampaign(req.params.id));
    res.json(CampaignRepository.getCampaign(req.params.id));
  } catch (error) {
    sendCampaignError(res, error);
  }
});

app.post("/api/campaigns/:id/pause", (req, res) => {
  try {
    CampaignService.assertFeatureEnabled();
    const campaign = CampaignService.assertTransition(req.params.id, "pause");
    if (!CampaignRepository.updateCampaignStatus(req.params.id, "running", "pausing")) {
      throw new CampaignService.CampaignError('CAMPAIGN_STATE_CONFLICT', 'Yêu cầu pause bị trùng.');
    }
    addOperatorCampaignAudit(req.params.id, 'pause_requested', { status: 'pausing' });
    CampaignEventService.emit(io, CampaignRepository.getCampaign(req.params.id));
    res.json(CampaignRepository.getCampaign(req.params.id));
  } catch (error) {
    sendCampaignError(res, error);
  }
});

app.post("/api/campaigns/:id/resume", (req, res) => {
  try {
    CampaignService.assertFeatureEnabled();
    const campaign = CampaignService.assertTransition(req.params.id, "resume");
    // Spec 038 FR-006/SC-003: a recipient whose route went bad while paused
    // must fail closed on its own, not block resume for the rest of the
    // campaign. enqueueCampaignMessage revalidates again right before that
    // recipient's own dispatch, so it still fails closed there if still invalid.
    campaign.recipients
      .filter((recipient) => recipient.status === 'pending')
      .forEach((recipient) => {
        try {
          CampaignEligibilityService.revalidateSnapshotRecipient(recipient, db, {
            getConnection: (accountId) => extensionConnections.get(accountId)
          });
        } catch (error) {
          // Ignored here by design - see comment above.
        }
      });
    if (!CampaignRepository.updateCampaignStatus(req.params.id, "paused", "running")) {
      throw new CampaignService.CampaignError('CAMPAIGN_STATE_CONFLICT', 'Yêu cầu resume bị trùng.');
    }
    addOperatorCampaignAudit(req.params.id, 'resumed', { status: 'running' });
    campaignRunner.start(req.params.id);
    CampaignEventService.emit(io, CampaignRepository.getCampaign(req.params.id));
    res.json(CampaignRepository.getCampaign(req.params.id));
  } catch (error) {
    sendCampaignError(res, error);
  }
});

app.post("/api/campaigns/:id/cancel", (req, res) => {
  try {
    CampaignService.assertFeatureEnabled();
    const campaign = CampaignService.assertTransition(req.params.id, "cancel");
    if (!CampaignRepository.updateCampaignStatus(req.params.id, campaign.status, "cancelling")) {
      throw new CampaignService.CampaignError('CAMPAIGN_STATE_CONFLICT', 'Yêu cầu cancel bị trùng.');
    }
    addOperatorCampaignAudit(req.params.id, 'cancel_requested', { status: 'cancelling' });
    campaignRunner.start(req.params.id);
    CampaignEventService.emit(io, CampaignRepository.getCampaign(req.params.id));
    res.json(CampaignRepository.getCampaign(req.params.id));
  } catch (error) {
    sendCampaignError(res, error);
  }
});

app.post("/api/campaigns/:id/recipients/:recipientId/retry", (req, res) => {
  try {
    CampaignService.assertFeatureEnabled();
    let campaign = CampaignRepository.getCampaign(req.params.id);
    if (!campaign) return sendCampaignError(res, { code: "CAMPAIGN_NOT_FOUND", message: "Không tìm thấy chiến dịch." });
    if (["running", "pausing", "cancelling"].includes(campaign.status)) {
      return sendCampaignError(res, { code: "CAMPAIGN_STATE_CONFLICT", message: "Hãy tạm dừng chiến dịch trước khi retry thủ công." });
    }
    const recipient = campaign.recipients.find((item) => item.id === req.params.recipientId);
    if (!recipient) {
      throw new CampaignService.CampaignError('INVALID_RECIPIENT', 'Recipient không thuộc campaign.');
    }
    if (recipient.status === 'sent') {
      throw new CampaignService.CampaignError('RECIPIENT_ALREADY_SENT', 'Recipient đã gửi thành công.');
    }
    if (recipient.status !== 'failed') {
      throw new CampaignService.CampaignError('CAMPAIGN_STATE_CONFLICT', 'Chỉ recipient failed mới có thể retry.');
    }
    CampaignEligibilityService.revalidateSnapshotRecipient(recipient, db, {
      getConnection: (accountId) => extensionConnections.get(accountId)
    });
    CampaignRepository.retryRecipient(req.params.id, req.params.recipientId);
    campaign = CampaignRepository.getCampaign(req.params.id);
    const shouldRun = ['completed_with_errors', 'failed', 'cancelled'].includes(campaign.status);
    if (shouldRun) {
      if (!CampaignRepository.updateCampaignStatus(req.params.id, campaign.status, 'ready')) {
        throw new CampaignService.CampaignError('CAMPAIGN_STATE_CONFLICT', 'Retry đã được xử lý bởi yêu cầu khác.');
      }
      CampaignService.validateReadyForStart(req.params.id);
      if (!CampaignRepository.updateCampaignStatus(req.params.id, 'ready', 'running')) {
        throw new CampaignService.CampaignError('CAMPAIGN_STATE_CONFLICT', 'Không thể khởi động retry.');
      }
    }
    addOperatorCampaignAudit(
      req.params.id,
      'recipient_retry_requested',
      { recipient_id: req.params.recipientId, status: shouldRun ? 'running' : campaign.status },
      req.params.recipientId
    );
    if (shouldRun) campaignRunner.start(req.params.id);
    const latest = CampaignRepository.getCampaign(req.params.id);
    CampaignEventService.emit(io, latest, latest.recipients.find((item) => item.id === req.params.recipientId));
    res.json(latest);
  } catch (error) {
    sendCampaignError(res, error);
  }
});


// ── Task 4.2: Broadcast ──
app.get('/api/accounts/:id/broadcast/quota', (req, res) => {
  res.json(broadcastEngine.getDailyQuota(req.params.id));
});

app.post('/api/accounts/:id/broadcast', async (req, res) => {
  const { thread_ids, message } = req.body;
  if (!thread_ids?.length || !message) {
    return res.status(400).json({ error: 'Thiếu thread_ids hoặc message' });
  }
  try {
    const campaignId = await broadcastEngine.startCampaign({
      account_id: req.params.id,
      thread_ids,
      message,
      sendFn: sendViaExtension,
      onProgress: (progress) => io.emit('BROADCAST_PROGRESS', progress)
    });
    res.json({ success: true, campaignId });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/broadcast/:campaignId/cancel', (req, res) => {
  res.json(broadcastEngine.cancelCampaign(req.params.campaignId));
});

// ── Task 4.3: AI Config CRUD ──
app.get('/api/accounts/:id/ai-config', (req, res) => {
  const config = aiMediator.getConfig(req.params.id);
  // Mask API key trước khi trả về
  if (config?.api_key) config.api_key = config.api_key.slice(0, 8) + '***';
  res.json(config || {});
});

app.put('/api/accounts/:id/ai-config', (req, res) => {
  res.json(aiMediator.upsertConfig({ account_id: req.params.id, ...req.body }));
});

app.patch('/api/accounts/:id/ai-config/toggle', (req, res) => {
  res.json(aiMediator.toggleAI(req.params.id, req.body.is_active));
});

app.post('/api/threads/:id/ai/pause', (req, res) => {
  res.json(aiMediator.pauseForThread(req.params.id));
});

app.post('/api/threads/:id/ai/resume', (req, res) => {
  res.json(aiMediator.resumeForThread(req.params.id));
});

app.get('/api/ollama/health', async (req, res) => {
  const isOnline = await aiMediator.checkOllamaHealth();
  res.json({ online: isOnline });
});

// Danh sách thành viên nhóm đã quét từ panel "Thành viên trong đoạn chat".
app.get('/api/threads/:id/members', (req, res) => {
  if (!enterpriseAccess.canAccessThread(req.user, req.params.id)) return res.status(404).json({ error: 'Không tìm thấy hội thoại' });
  const members = db.prepare('SELECT name, avatar_url FROM group_members WHERE thread_id = ? ORDER BY name COLLATE NOCASE').all(String(req.params.id));
  res.json({ success: true, members });
});

// Nhờ extension quét panel thành viên của thread (chỉ quét được khi tab
// Messenger đang mở đúng thread đó; kết quả về qua SYNC_GROUP_MEMBERS_RESULT).
app.post('/api/threads/:id/sync-members', (req, res) => {
  if (!enterpriseAccess.canAccessThread(req.user, req.params.id)) return res.status(404).json({ error: 'Không tìm thấy hội thoại' });
  const thread = db.prepare('SELECT account_id, thread_url FROM threads WHERE id = ?').get(String(req.params.id));
  if (!thread?.account_id) return res.status(404).json({ error: 'Không tìm thấy hội thoại' });
  const extWs = extensionConnections.get(thread.account_id);
  if (!extWs || extWs.readyState !== WebSocket.OPEN) {
    return res.status(409).json({ error: 'Extension chưa kết nối cho tài khoản này' });
  }
  extWs.send(JSON.stringify({
    type: 'SYNC_GROUP_MEMBERS',
    data: { account_id: thread.account_id, thread_id: String(req.params.id), thread_url: String(thread.thread_url || '') }
  }));
  res.json({ ok: true });
});

// Messages REST API - With UI Guard Filter
app.get('/api/threads/:id/messages', async (req, res) => {
  if (!enterpriseAccess.canAccessThread(req.user, req.params.id)) return res.status(404).json({ error: 'Không tìm thấy hội thoại' });
  try {
    OutboundDomCorrelationService.collapseStoredMediaCompanions(db, req.params.id);
    OutboundDomCorrelationService.collapseStoredTemporaryIdUpgrades(db, req.params.id);
  } catch (error) {
    console.warn('[MESSAGE_READ_REPAIR] Skipped unsafe legacy collapse:', error.message);
  }
  // Return Facebook media URLs immediately and persist them in the background.
  // Waiting for every old video here blocked polling and outbound file staging.
  inboundMediaHydration.hydrateThread(req.params.id);
  // A failed outbound attempt is terminal. Remove it before reading so an old
  // pending row can never reappear as a retry bubble after app startup.
  // Trước khi xoá, phát lỗi cho UI bằng client_message_id gốc để bubble
  // "Đang gửi" còn treo trên màn hình được cập nhật thành thất bại (kèm lý
  // do) thay vì biến mất im lặng khi người dùng mở lại thread.
  const failedRows = db.prepare(`
    SELECT id, thread_id, client_message_id, delivery_error FROM messages
    WHERE thread_id = ? AND is_outgoing = 1 AND delivery_status = 'failed'
  `).all(req.params.id);
  for (const failedRow of failedRows) {
    io.emit('MESSAGE_SEND_FAILED', {
      thread_id: failedRow.thread_id,
      client_message_id: failedRow.client_message_id,
      success: false,
      status: 'failed',
      error: failedRow.delivery_error || 'Tin nhắn không gửi được.'
    });
  }
  deleteOutboundMessageRows({ threadId: req.params.id, failedOnly: true });

  // Cleanup stale pending/temporary rows that were already confirmed via DOM / FB mid
  cleanupStalePendingOutbound(req.params.id);
  // Chuẩn hóa thứ tự sequence_order theo dòng thời gian trước khi trả về
  ConversationRepository.normalizeMessageSequence(req.params.id, db);

  // `id` is the durable per-database receive sequence. is_outgoing identifies
  // the side (0 = customer, 1 = operator); timestamps are display-only.
  const msgs = db.prepare(`
    SELECT * FROM messages WHERE thread_id=?
    ORDER BY COALESCE(sequence_order, id) ASC, id ASC
  `).all(req.params.id);
  res.json(prepareMessagesForClient(msgs));
});

// Lightweight sync-hint endpoint: fb_message_id + timestamp_ms only, no
// content/media - used by page_content.js/content.js to re-seed their
// client-side timestamp-anchor map after a script restart (feature 014).
app.get('/api/threads/:id/message-timestamps', (req, res) => {
  if (!enterpriseAccess.canAccessThread(req.user, req.params.id)) return res.status(404).json({ error: 'Không tìm thấy hội thoại' });
  res.json(ConversationRepository.getMessageTimestamps(req.params.id));
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(clientDistPath, 'index.html'));
});

// ────────────────────────────────────────────────
const PORT = process.env.PORT || 5050;
function startServer() {
  // Dọn các tài khoản mồ côi (không thuộc user/company nào, không có hội thoại
  // và không có cookie đăng nhập Facebook) để tránh hiển thị hoặc khởi chạy Chrome rác.
  try {
    const candidateAccounts = db.prepare(`
      SELECT a.id, a.name, a.profile_dir, a.owner_user_id, a.company_id,
             (SELECT COUNT(*) FROM threads t WHERE t.account_id = a.id) AS thread_count
      FROM accounts a
    `).all();
    for (const acc of candidateAccounts) {
      const resolvedDir = processManager.resolveAccountProfileDir(acc.profile_dir, acc.id);
      const hasValidProfile = processManager.hasValidFacebookProfile(resolvedDir);
      const isUnowned = acc.owner_user_id == null && acc.company_id == null;
      const isIncompletePending = String(acc.profile_dir || '').includes('pending_')
        && /^FB Account \(/i.test(String(acc.name || ''));
      if (Number(acc.thread_count || 0) === 0 && ((!hasValidProfile && isUnowned) || !hasValidProfile || isIncompletePending)) {
        db.prepare('DELETE FROM inbox_sources WHERE owner_account_id = ?').run(String(acc.id));
        db.prepare('DELETE FROM accounts WHERE id = ?').run(String(acc.id));
        console.log(`[StartupCleanup] Đã xóa tài khoản mồ côi/chưa hoàn tất đăng nhập: ${acc.id}`);
      }
    }
  } catch (cleanupErr) {
    console.warn('[StartupCleanup] Lỗi khi dọn tài khoản mồ côi:', cleanupErr.message);
  }

  const allowedProfileDirs = db.prepare('SELECT id, profile_dir FROM accounts WHERE profile_dir IS NOT NULL').all()
    .map(({ id, profile_dir }) => processManager.resolveAccountProfileDir(profile_dir, id));
  processManager.stopOrphanedManagedChromeProfiles(allowedProfileDirs);
  sweepAbandonedPendingProfiles();

  const listenPromise = new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      console.log(`[Server] http://localhost:${PORT}`);
      console.log(`[Server] WebSocket ws://localhost:${PORT}`);
      resolve({ port: Number(PORT), pid: process.pid });
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(PORT, '0.0.0.0');
  });

  // Heal dữ liệu sai do build trước (2026-10-21): bump CURRENT_TIMESTAMP +
  // flip ma sau restart biến hội thoại cũ (14/10) thành "hoạt động hôm nay"
  // và treo cờ chưa đọc. Kéo last_activity về tin thật mới nhất (cho phép
  // lệch dưới 5 phút như alignThreadActivity), gỡ cờ chưa đọc của hội thoại
  // có tin cuối là TỪ MÁY GỬI hoặc từ TRƯỚC hôm nay. Idempotent — lần khởi
  // động sau gần như rỗng. Chạy TRƯỚC khi bật poller/watcher/sync.
  try {
    const healStartOfTodayMs = new Date().setHours(0, 0, 0, 0);
    const REAL_MSG_FILTER = "(m.fb_message_id IS NULL OR m.fb_message_id NOT LIKE 'sidebar_preview_%')";
    const clamped = db.prepare(`
      UPDATE threads
      SET last_activity = (
        SELECT strftime('%Y-%m-%d %H:%M:%S', MAX(COALESCE(m.timestamp_ms, 0)) / 1000.0, 'unixepoch')
        FROM messages m
        WHERE m.thread_id = threads.id AND ${REAL_MSG_FILTER}
      )
      WHERE EXISTS (
        SELECT COUNT(*) FROM messages m
        WHERE m.thread_id = threads.id AND ${REAL_MSG_FILTER}
        HAVING julianday(threads.last_activity) - 2440587.5 - MAX(COALESCE(m.timestamp_ms, 0)) / 86400000.0 > 5.0 / 1440.0
      )
    `).run().changes;
    const cleared = db.prepare(`
      UPDATE threads
      SET is_unread = 0, unread_manual = 0
      WHERE (COALESCE(is_unread, 0) = 1 OR COALESCE(unread_manual, 0) = 1)
        AND (
          SELECT CASE
            WHEN m.is_outgoing = 1 THEN 1
            WHEN COALESCE(m.timestamp_ms, 0) < ? THEN 1
            ELSE 0
          END
          FROM messages m
          WHERE m.thread_id = threads.id AND ${REAL_MSG_FILTER}
          ORDER BY m.timestamp_ms DESC, m.id DESC
          LIMIT 1
        ) = 1
    `).run(healStartOfTodayMs).changes;
    if (clamped || cleared) {
      console.log(`[UnreadHeal] Đã kéo ${clamped} last_activity lệch về mốc tin thật, gỡ cờ chưa đọc sai ${cleared} hội thoại`);
    }
  } catch (healErr) {
    console.warn('[UnreadHeal] Lỗi:', healErr.message);
  }

  // Bật poller đọc sự kiện webhook từ cầu nối hosting (webhook.php) cho Page API
  // 2.5s thay vì 5s — tin khách realtime về CRM trong ~3s sau khi webhook live
  pageApiService.startBridgePolling(io, db, 2500);
  // Tự động đồng bộ hội thoại page 3s/lần (fallback khi webhook chưa đăng ký:
  // page dán token ngoài không có webhook về CRM mình, watcher là đường chính).
  // 6s cũ cho độ trễ trung bình ~4s; 3s giảm còn ~1.5-2s. Đổi lại số call
  // Graph tăng gấp đôi — nếu Meta báo rate limit (watcher log "CHU KỲ LỖI")
  // thì trả về 6000. Page có webhook vẫn đi cầu nối 2.5s nhanh hơn.
  pageApiService.startPageConversationWatcher(io, db, 3000);
  // Re-subscribe webhook fields mọi page có token (thêm field mới như
  // messaging_referrals thì page cũ phải re-subscribe mới nhận event).
  pageApiService.resubscribeAllPages(db).catch(() => {});
  // Quét bù SĐT/email cho tin Page CŨ đã nằm trong data — chạy nền sau 15s cho
  // watcher/backfill ổn định trước; idempotent nên mỗi lần khởi động chỉ quét
  // phần còn thiếu (sau lần đầu gần như rỗng).
  setTimeout(() => {
    pageApiService.backfillHistoricalContactLeads(io, db).catch((err) => {
      console.error('[PageLeads] Quét bù lịch sử lỗi:', err.message);
    });
  }, 15000);
  // BỎ dọn page chưa có token lúc khởi động (2026-10-08): page được "Đồng bộ"
  // phát hiện mà chưa tạo token là trạng thái hợp lệ — xóa là mất page khỏi
  // popup sau mỗi lần tắt/mở app. App bị gỡ đã có removeAccountPages dọn sạch.

    // Dọn dẹp các tên rác hệ thống (ví dụ: "Tất cả tin nhắn", "Hộp thư đến", "Tin nhắn") đã lưu vào CSDL trước đây
  try {
    const dirtySystemNames = [
      'Tất cả tin nhắn', 'Tất cả', 'All messages', 'All',
      'Tin nhắn trực tiếp', 'Direct messages',
      'Tin nhắn', 'Messages',
      'Hộp thư đến', 'Hộp thư', 'Inbox',
      'Chưa đọc', 'Unread', 'Đã xong', 'Done',
      'Gắn dấu sao', 'Đã gắn dấu sao', 'Starred',
      'Spam', 'Thư rác', 'Đang', 'Facebook', 'Messenger', 'Meta'
    ];
    const placeholders = dirtySystemNames.map(() => '?').join(',');
    db.prepare(`
      UPDATE threads 
      SET contact_name = 'Khách hàng' 
      WHERE contact_name IN (${placeholders}) 
         OR contact_name LIKE 'Đang hoạt động%' 
         OR contact_name LIKE 'Hoạt động%'
    `).run(...dirtySystemNames);
    db.prepare(`
      UPDATE contacts 
      SET name = 'Khách hàng' 
      WHERE name IN (${placeholders}) 
         OR name LIKE 'Đang hoạt động%' 
         OR name LIKE 'Hoạt động%'
    `).run(...dirtySystemNames);

    // Dọn dẹp tin nhắn rác từ các nút menu Meta Business Suite & chuẩn hóa lại thứ tự tin nhắn
    db.prepare(`
      DELETE FROM messages
      WHERE (content IN ('Meta Business Suite', 'Liên kết', 'Chỉnh sửa', 'Trợ giúp', 'Tùy chọn khác', 'Cài đặt') OR content LIKE '%Meta Business Suite%')
        AND (timestamp_ms IS NULL OR timestamp_ms <= 0)
    `).run();

    // Dọn dẹp notice E2EE bị bắt nhầm thành tin nhắn của khách. Filter cũ thiếu
    // pattern tiếng Anh "Messages and calls are secured with end-to-end
    // encryption" - mỗi lần mở app, initial sweep mở từng hội thoại, notice
    // E2EE (không có mid ổn định nên dedup không chặn) bị insert thành tin mới:
    // is_unread=1 + unread_manual=1 sai hàng loạt, preview thành chữ bảo mật,
    // timestamp trùng giờ mở app (reproduce 2026-10-07). Xóa notice, gỡ cờ
    // chưa đọc cho thread không còn tin khách thật, dựng lại preview +
    // last_activity từ tin còn lại.
    const E2EE_NOTICE_PATTERNS = [
      /^messages and calls are secured with end-to-end encryption\.?$/i,
      /^messages and calls are end-to-end encrypted\.?$/i,
      /^personal chats are secured with end-to-end encryption\.?$/i,
      /^tin nhắn và cuộc gọi (?:đang )?được bảo mật.*$/i,
      /^bảo mật (?:bằng tính năng mã hóa|đầu cuối).*$/i,
    ];
    const noticeCandidates = db.prepare(`
      SELECT id, thread_id, content FROM messages
      WHERE is_outgoing = 0
        AND (
          content LIKE 'Messages and calls are secured with end-to-end encryption%'
          OR content LIKE 'Messages and calls are end-to-end encrypted%'
          OR content LIKE 'Personal chats are secured with end-to-end encryption%'
          OR content LIKE 'Tin nhắn và cuộc gọi %bảo mật%'
          OR content LIKE 'bảo mật %'
        )
    `).all();
    const deleteNotice = db.prepare('DELETE FROM messages WHERE id = ?');
    const noticeThreadIds = new Set();
    let deletedNoticeCount = 0;
    for (const row of noticeCandidates) {
      const noticeText = String(row.content || '').trim();
      if (!E2EE_NOTICE_PATTERNS.some((pattern) => pattern.test(noticeText))) continue;
      deleteNotice.run(row.id);
      noticeThreadIds.add(row.thread_id);
      deletedNoticeCount++;
    }
    const healTouchedThreads = (threadIdSet) => {
      for (const noticeThreadId of threadIdSet) {
        const hasRealIncoming = db.prepare(`
          SELECT 1 FROM messages
          WHERE thread_id = ? AND is_outgoing = 0
            AND fb_message_id NOT LIKE 'dom_%'
            AND fb_message_id NOT LIKE 'sidebar_preview_%'
          LIMIT 1
        `).get(noticeThreadId);
        if (!hasRealIncoming) {
          db.prepare('UPDATE threads SET is_unread = 0, unread_manual = 0 WHERE id = ?').run(noticeThreadId);
        }
        const remaining = db.prepare(`
          SELECT content, COALESCE(timestamp_ms, 0) AS ts FROM messages
          WHERE thread_id = ? AND fb_message_id NOT LIKE 'dom_%'
            AND fb_message_id NOT LIKE 'sidebar_preview_%'
          ORDER BY COALESCE(timestamp_ms, 0) DESC, id DESC LIMIT 1
        `).get(noticeThreadId);
        if (remaining) {
          db.prepare('UPDATE threads SET last_message = ?, last_activity = ? WHERE id = ?')
            .run(remaining.content, new Date(remaining.ts).toISOString(), noticeThreadId);
        } else {
          db.prepare('UPDATE threads SET last_message = NULL WHERE id = ?').run(noticeThreadId);
        }
      }
    };

    // (1) Notice E2EE bị bắt nhầm thành tin nhắn của khách.
    healTouchedThreads(noticeThreadIds);

    // (3) Thông báo handover AI agent của Meta (VI từ 2026-09-29 + EN 2026-10-22):
    // webhook echo đẩy về như tin Page gửi (outgoing) — guard WS server.js:2491
    // chỉ chặn đường extension, đường webhook/Graph lưu thẳng thành tin thật
    // (reproduce 2026-10-21 "You took over this chat from your AI agent." hiện
    // như bubble xanh trong CRM). Xóa row, dựng lại preview + last_activity
    // từ tin còn lại; notice là outgoing nên không cần gỡ cờ chưa đọc.
    const pageNoticeCandidates = db.prepare(`
      SELECT id, thread_id, content FROM messages
      WHERE content LIKE 'Tác nhân AI đã chuyển đoạn chat này cho bạn%'
         OR content LIKE 'You took over this chat from your AI agent%'
    `).all();
    const pageNoticeThreadIds = new Set();
    let deletedPageNoticeCount = 0;
    for (const row of pageNoticeCandidates) {
      if (!isKnownPageSystemNotice(row.content)) continue;
      deleteNotice.run(row.id);
      pageNoticeThreadIds.add(row.thread_id);
      deletedPageNoticeCount++;
    }
    healTouchedThreads(pageNoticeThreadIds);
    if (deletedPageNoticeCount > 0) {
      console.log(`[NoticeHeal] Đã xóa ${deletedPageNoticeCount} thông báo hệ thống Meta (AI agent handover) trong ${pageNoticeThreadIds.size} hội thoại`);
    }

    // (2) Bubble nhân đôi từ đợt hydrate khi mở thread: row dom_ (mất native
    // id) trùng nội dung với một row mid thật trong cùng thread là bản render
    // lại của tin cũ, không phải tin mới (reproduce 2026-10-07 "Khi nào bạn
    // muốn ăn" x2). Guard runtime chặn từ nay về sau, ở đây dọn row cũ.
    const dupDomRows = db.prepare(`
      SELECT m.id, m.thread_id FROM messages m
      WHERE m.is_outgoing = 0
        AND m.fb_message_id LIKE 'dom_%'
        AND (m.media_type IS NULL OR m.media_type = 'text')
        AND EXISTS (
          SELECT 1 FROM messages twin
          WHERE twin.thread_id = m.thread_id
            AND twin.is_outgoing = 0
            AND twin.id != m.id
            AND COALESCE(twin.content, '') = COALESCE(m.content, '')
            AND twin.fb_message_id NOT LIKE 'dom_%'
            AND twin.fb_message_id NOT LIKE 'sidebar_preview_%'
        )
    `).all();
    const deleteDupRow = db.prepare('DELETE FROM messages WHERE id = ?');
    const dupThreadIds = new Set();
    for (const row of dupDomRows) {
      deleteDupRow.run(row.id);
      dupThreadIds.add(row.thread_id);
    }
    healTouchedThreads(dupThreadIds);

    // (2b) Cặp nhân đôi preview ↔ tin thật: bong bóng provisional
    // (sidebar_preview_, giờ quan sát) chưa được claim vì operator click trễ
    // hoặc preview bị Messenger cắt ngắn, rồi history sync chèn thêm row thật
    // cùng nội dung. Heal (2) chỉ dọn cặp dom_ ↔ tin thật, không đụng preview.
    // Row thật (mid/dom) là bản chính thức - xóa preview mồ côi.
    const previewRows = db.prepare(`
      SELECT p.id, p.thread_id, p.content,
        (SELECT COUNT(*) FROM messages real
          WHERE real.thread_id = p.thread_id AND real.is_outgoing = 0
            AND real.id != p.id AND real.fb_message_id NOT LIKE 'sidebar_preview_%'
            AND COALESCE(real.content, '') != '') AS realIncomingCount
      FROM messages p
      WHERE p.is_outgoing = 0 AND p.fb_message_id LIKE 'sidebar_preview_%'
    `).all();
    const realIncomingByThread = new Map();
    const deleteOrphanPreview = db.prepare('DELETE FROM messages WHERE id = ?');
    const orphanPreviewThreadIds = new Set();
    for (const preview of previewRows) {
      if (!Number(preview.realIncomingCount)) continue;
      if (!realIncomingByThread.has(preview.thread_id)) {
        realIncomingByThread.set(preview.thread_id, db.prepare(`
          SELECT content FROM messages
          WHERE thread_id = ? AND is_outgoing = 0
            AND fb_message_id NOT LIKE 'sidebar_preview_%'
            AND COALESCE(content, '') != ''
        `).all(preview.thread_id));
      }
      const previewText = String(preview.content || '').trim();
      if (!previewText) continue;
      // Preview NHÓM dán "Tên: " vào trước nội dung tin thật ("Bảo Long:
      // Xmzmmz" ↔ tin thật "Xmzmmz") - khớp exact thất bại nên row provisional
      // ở lại thành bong bóng ma cạnh tin sạch (reproduce 2026-10-15 nhóm
      // Cfggh). Bóc tiền tố trước khi đối chiếu.
      const groupPrefixStripped = previewText.match(/^([^:\n]{1,80}):\s+(.+)$/s);
      const previewTextNoPrefix = groupPrefixStripped ? groupPrefixStripped[2].trim() : null;
      const truncated = previewText.replace(/(?:\u2026|\.{3})$/, '').trimEnd();
      const truncatedNoPrefix = previewTextNoPrefix
        ? previewTextNoPrefix.replace(/(?:\u2026|\.{3})$/, '').trimEnd()
        : null;
      const isPrefixTwin = truncated.length >= 24;
      const isPrefixTwinStripped = truncatedNoPrefix ? truncatedNoPrefix.length >= 24 : false;
      const matched = realIncomingByThread.get(preview.thread_id).some((row) => {
        const realText = String(row.content || '');
        return realText === previewText
          || (previewTextNoPrefix && realText === previewTextNoPrefix)
          || (isPrefixTwin && realText.startsWith(truncated))
          || (isPrefixTwinStripped && realText.startsWith(truncatedNoPrefix));
      });
      if (matched) {
        deleteOrphanPreview.run(preview.id);
        orphanPreviewThreadIds.add(preview.thread_id);
      }
    }
    healTouchedThreads(orphanPreviewThreadIds);

    // (2c) Phantom __bubble_N: bubble_idx chỉ là chỉ số VỊ TRÍ trong lần quét
    // DOM - đợt hydrate trễ/lá dir=auto tạm thời đánh lại chỉ số của CÙNG MỘT
    // bong bóng (mid.x <-> mid.x__bubble_1) thành hai id, UNIQUE(fb_message_id)
    // không thấy -> hai row trùng text (reproduce 2026-10-08 hội thoại "Yến").
    // Guard tracker phía extension chặn từ nay về sau; ở đây dọn row cũ.
    // Chỉ xoá row CÓ HẬU TỐ (row base không bao giờ bị đụng). Like-group THẬT
    // (FB gộp N like giống nhau vào 1 article) cũng trùng text+ts, nhưng được
    // forward theo thứ tự leaf: base trước, __bubble_1 ngay sau -> nếu row base
    // cùng nội dung nằm ngay trước (rowid chênh ≤ 4, chịu lẫn insert thread
    // khác) thì giữ. Mọi cặp phantom quan sát được đều vi phạm mẫu này.
    const bubbleRows = db.prepare(`
      SELECT id, thread_id, fb_message_id, content, is_outgoing, media_type, media_url,
        timestamp_ms FROM messages WHERE fb_message_id LIKE '%__bubble_%'
    `).all();
    const familyMembers = db.prepare(`
      SELECT id, fb_message_id, content, is_outgoing, media_type, media_url, timestamp_ms
      FROM messages WHERE thread_id = ? AND fb_message_id IN (${[...new Array(50)].map(() => '?').join(',')})
    `);
    const deletePhantomBubble = db.prepare('DELETE FROM messages WHERE id = ?');
    // (2c-bis) Phantom LẬT CHIỀU: __bubble_N là id tổng hợp của lá KHÔNG có
    // mid riêng trong article gốc - like-group thật cùng article nên cùng
    // người gửi, nên row __bubble_N Khác hướng với base cùng nội dung chỉ
    // có thể là quét lại sai nhãn (reproduce 2026-10-08: "nhắn gì đó"/"allo"
    // của operator thành tin khách, id ...7513148857660772091__bubble_1).
    // Base có thể bị rút gọn prefix (7513...__bubble_1 vs peer@msgr.7513...).
    const familyBaseStmt = db.prepare(`
      SELECT id, content, is_outgoing FROM messages
      WHERE thread_id = ? AND (fb_message_id = ? OR fb_message_id LIKE '%.' || ?)
      ORDER BY id DESC LIMIT 1
    `);
    const phantomThreadIds = new Set();
    for (const m of bubbleRows) {
      if ((m.media_type && m.media_type !== 'text') || m.media_url) continue;
      if (!/__bubble_\d+$/.test(String(m.fb_message_id || ''))) continue;
      const familyId = String(m.fb_message_id).replace(/__bubble_\d+$/, '');
      // (2c-ter) Otid thuần số + out=0: otid do client MÌNH sinh khi gửi,
      // tin khách luôn mang <uid>@msgr.N / mid.$. Không cần base cùng family
      // (base thật mang mid khác family nên 2c-bis không với tới).
      if (Number(m.is_outgoing) === 0 && /^\d{15,19}$/.test(familyId)) {
        deletePhantomBubble.run(m.id);
        phantomThreadIds.add(m.thread_id);
        continue;
      }
      const familyBase = familyId.length >= 12
        ? familyBaseStmt.get(m.thread_id, familyId, familyId)
        : null;
      if (familyBase
        && String(familyBase.content || '') === String(m.content || '')
        && Number(familyBase.is_outgoing) !== Number(m.is_outgoing)) {
        deletePhantomBubble.run(m.id);
        phantomThreadIds.add(m.thread_id);
        continue;
      }
      const members = familyMembers.all(m.thread_id, familyId, m.fb_message_id,
        ...[...new Array(48)].map(() => '?'));
      const sameBubble = (twin) => twin.id !== m.id
        && (!twin.media_type || twin.media_type === 'text') && !twin.media_url
        && String(twin.content || '') === String(m.content || '')
        && Number(twin.is_outgoing) === Number(m.is_outgoing)
        && Math.abs(Number(twin.timestamp_ms || 0) - Number(m.timestamp_ms || 0)) <= 2000;
      const isProtected = members.some((twin) => sameBubble(twin)
        && !/__bubble_\d+$/.test(String(twin.fb_message_id || ''))
        && twin.id < m.id && m.id - twin.id <= 4);
      if (isProtected) continue;
      if (!members.some(sameBubble)) continue;
      deletePhantomBubble.run(m.id);
      phantomThreadIds.add(m.thread_id);
    }
    healTouchedThreads(phantomThreadIds);

    // (3) Separator thời gian dạng tắt ("9w", "2d"...) bị bắt nhầm thành
    // bubble - chỉ tồn tại dưới id dom_ (separator không có data-message-id).
    const COMPACT_RELATIVE_RE = /^\d{1,2}\s?(?:s|sec|m|min|h|hr|d|w|mo|y)$/i;
    const sepCandidates = db.prepare(`
      SELECT id, thread_id, content FROM messages
      WHERE is_outgoing = 0 AND fb_message_id LIKE 'dom_%'
        AND (media_type IS NULL OR media_type = 'text')
        AND LENGTH(COALESCE(content, '')) <= 6
    `).all();
    const deleteSepRow = db.prepare('DELETE FROM messages WHERE id = ?');
    const sepThreadIds = new Set();
    for (const row of sepCandidates) {
      if (!COMPACT_RELATIVE_RE.test(String(row.content || '').trim())) continue;
      deleteSepRow.run(row.id);
      sepThreadIds.add(row.thread_id);
    }
    healTouchedThreads(sepThreadIds);

    // (4) Like/reaction emoji bị lưu thành mojibake: literal hỏng encoding
    // trong extractBubbleEmoji của các build trước trả về chuỗi latin1 thay
    // vì emoji (reproduce 2026-10-07: like 👍 của khách thành "Ã°..."). Chuỗi
    // trong DB bị mã hóa kép (cp1252 hai lớp: byte UTF-8 -> ký tự -> byte -> ký
    // tự) nên giải mã ngược tối đa 3 vòng qua bảng cp1252, chỉ nhận khi kết
    // quả là emoji thuần. VN text/'alo'/emoji thật không map được qua cp1252
    // (ký tự > U+00FF không có byte cp1252) nên không bao giờ bị đụng tới.
    const CP1252_HIGH = {
      0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85,
      0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A,
      0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92,
      0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
      0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C,
      0x017E: 0x9E, 0x0178: 0x9F
    };
    const cp1252Bytes = (str) => {
      const bytes = [];
      for (const ch of String(str)) {
        const cp = ch.codePointAt(0);
        if (cp < 0x100) bytes.push(cp);
        else if (CP1252_HIGH[cp] !== undefined) bytes.push(CP1252_HIGH[cp]);
        else return null;
      }
      return Buffer.from(bytes);
    };
    const isPureEmoji = (s) => /^[\p{Extended_Pictographic}\uFE0F\u200D\s]+$/u.test(s) && /\p{Extended_Pictographic}/u.test(s);
    const fixMojibakeEmoji = (content) => {
      let current = String(content || '').trim();
      if (!current || current.codePointAt(0) <= 127) return null;
      for (let round = 0; round < 3; round++) {
        const bytes = cp1252Bytes(current);
        if (!bytes) return null;
        const decoded = bytes.toString('utf8');
        if (isPureEmoji(decoded)) return decoded;
        if (decoded === current) return null;
        current = decoded;
      }
      return null;
    };
    const mojibakeCandidates = db.prepare(`
      SELECT id, thread_id, content FROM messages
      WHERE (media_type IS NULL OR media_type = 'text')
        AND LENGTH(content) <= 16
        AND unicode(substr(trim(content), 1, 1)) > 127
    `).all();
    const setMsgContent = db.prepare('UPDATE messages SET content = ? WHERE id = ?');
    const setThreadPreview = db.prepare('UPDATE threads SET last_message = ? WHERE id = ? AND last_message = ?');
    let fixedMojibakeCount = 0;
    for (const row of mojibakeCandidates) {
      const fixed = fixMojibakeEmoji(row.content);
      if (!fixed || fixed === row.content) continue;
      setMsgContent.run(fixed, row.id);
      setThreadPreview.run(fixed, row.thread_id, row.content);
      fixedMojibakeCount++;
    }
    // (4b) Like bị lưu nguyên nhãn trợ năng "Enter, Message sent 13:58 by
    // Khang: 👍" (bubble icon-only E2EE để label trong DOM text - cùng
    // reproduce 2026-10-07). Tách emoji cuối cùng làm nội dung.
    const A11Y_LABEL_LIKE_RE = /^(?:Enter,\s*)?(?:Message sent|Tin nhắn)\b[^\n]*?:\s*(\p{Extended_Pictographic}[\uFE0F\u200D]*)\s*$/u;
    const fixLabelLike = (content) => {
      const match = String(content || '').trim().match(A11Y_LABEL_LIKE_RE);
      return match ? match[1] : null;
    };
    const labelLikeCandidates = db.prepare(`
      SELECT id, thread_id, content FROM messages
      WHERE (media_type IS NULL OR media_type = 'text')
        AND (content LIKE 'Enter,%' OR content LIKE 'Nhập,%')
    `).all();
    for (const row of labelLikeCandidates) {
      const fixed = fixLabelLike(row.content);
      if (!fixed || fixed === row.content) continue;
      setMsgContent.run(fixed, row.id);
      setThreadPreview.run(fixed, row.thread_id, row.content);
      fixedMojibakeCount++;
    }

    // (4c) Header trích dẫn reply "Bạn đã trả lời {tên}" bị DOM nhặt thành tin
    // outgoing riêng kèm mid thật (bubble quote Messenger render trong row tin
    // reply - reproduce 2026-10-11: nhóm Bi-aaaaaaa). Metadata, không phải tin
    // operator -> xóa (FTS tự dọn qua trigger; mid được giải phóng để sweep sau
    // nhập lại tin reply thật). Tin thật "Bạn đã trả lời chưa?" được giữ nhờ
    // loại từ nối/câu hỏi ở đuôi. Regex đồng bộ SYSTEM_PATTERNS trong
    // src/server/utils/textFilter.js + src/extension/textFilter.js.
    const REPLY_HEADER_RES = [
      /^Bạn đã trả lời (?!(?:.*\s)?(?:chưa|rồi|xong|sao|đâu|gì|à|hả|nhỉ|nha|thôi|luôn|vậy|đấy|đó|nhé)\s*[?！?.!…]*$)[^?！?\n]{1,60}$/iu,
      /^You replied to (?!(?:.*\s)?(?:yet|already|right|now|ok|okay)\s*[?！?.!…]*$)[^?！?\n]{1,60}$/iu
    ];
    const replyHeaderCandidates = db.prepare(`
      SELECT id, thread_id, content FROM messages
      WHERE is_outgoing = 1
        AND (media_type IS NULL OR media_type = 'text')
        AND (content LIKE 'Bạn đã trả lời %' OR content LIKE 'You replied to %')
    `).all();
    const deleteReplyHeader = db.prepare('DELETE FROM messages WHERE id = ?');
    const previewNewest = db.prepare('SELECT content FROM messages WHERE thread_id = ? ORDER BY timestamp_ms DESC, id DESC LIMIT 1');
    let deletedReplyHeaderCount = 0;
    for (const row of replyHeaderCandidates) {
      const text = String(row.content || '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
      if (!REPLY_HEADER_RES.some((re) => re.test(text))) continue;
      deleteReplyHeader.run(row.id);
      const newest = previewNewest.get(row.thread_id);
      setThreadPreview.run(newest?.content || '[Tin nhắn]', row.thread_id, row.content);
      deletedReplyHeaderCount++;
    }

    // (4d) Nhãn tên người gửi hội thoại NHÓM bị nhặt thành tin riêng ("Tiến
    // Quang"/"Linh"/"Tèo" - reproduce 2026-10-11: nhóm Bi-aaaaaaa 29 row,
    // mỗi row chiếm một mid thật nên tin thật cùng mid bị UNIQUE chặn không
    // bao giờ vào lại DB). Xóa CHÍNH XÁC các cụm đã verify bằng dry-run:
    // tiêu chí chung kiểu "tên lặp >=3 lần" dry-run đã thấy nuốt cả tin thật
    // ("Đúng rồi", "Khg got nhé") nên chỉ nhắm thread + content cụ thể.
    // Mốc thời gian = trước ngày ship parser fix: phantom đều cũ hơn mốc,
    // tin thật sinh SAU mốc không bao giờ bị đụng -> heal tự triệt tiêu.
    const PHANTOM_LABEL_CUTOFF_MS = Date.parse('2026-10-11T00:00:00+07:00');
    const phantomLabelCandidates = db.prepare(`
      SELECT id, thread_id, content FROM messages
      WHERE is_outgoing = 0
        AND (timestamp_ms IS NULL OR timestamp_ms < ?)
        AND (
          (thread_id = '2211776809571916' AND content IN ('Tiến Quang', 'Linh', 'Tèo'))
          OR (thread_id = '100071663024971' AND content = 'Li Min Tài đã trả lời bạn')
        )
    `).all(PHANTOM_LABEL_CUTOFF_MS);
    let deletedPhantomLabelCount = 0;
    for (const row of phantomLabelCandidates) {
      deleteReplyHeader.run(row.id);
      const newest = previewNewest.get(row.thread_id);
      setThreadPreview.run(newest?.content || '[Tin nhắn]', row.thread_id, row.content);
      deletedPhantomLabelCount++;
    }

    // (4e) Sau khi parser history bốc member_name, mọi row incoming mà NỘI
    // DUNG == TÊN NGƯỜI GỬI là mảnh nhãn tên DOM (parser đã vá không bao giờ
    // emit cặp content==member_name nữa). So khớp JS-side để normalize
    // whitespace/case giống đúng skip phía extension.
    const memberNameEchoCandidates = db.prepare(`
      SELECT id, thread_id, content, sender_name FROM messages
      WHERE is_outgoing = 0
        AND sender_name IS NOT NULL AND TRIM(sender_name) != ''
        AND (media_type IS NULL OR media_type = 'text')
    `).all();
    let deletedMemberNameEchoCount = 0;
    const normWs = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    for (const row of memberNameEchoCandidates) {
      if (normWs(row.content) !== normWs(row.sender_name)) continue;
      deleteReplyHeader.run(row.id);
      const newest = previewNewest.get(row.thread_id);
      setThreadPreview.run(newest?.content || '[Tin nhắn]', row.thread_id, row.content);
      deletedMemberNameEchoCount++;
    }

    // (4f) Header reply bên thứ ba "X đã trả lời Y" / "X replied to Y" lọt qua
    // 2 parser DOM (content.js realtime + background.js history) ở pass
    // hydration thiếu khối quote (h3 biến div) -> row ma song song tin reply
    // thật kèm mid gốc, tái sinh sau mỗi lần dọn nếu chỉ dùng migration
    // (reproduce 2026-10-15 nhóm Cfggh). Chỉ đụng row extension ingest
    // (mid.$ / @msgr); row Graph watcher (m_...) như "X đã trả lời về một bài
    // viết" là event page inbox, giữ. Tin quảng cáo "X đã trả lời một quảng
    // cáo." là nội dung thật (isAdNotice), giữ. Regex đồng bộ
    // REPLY_HEADER_BUBBLE_RE trong content.js + background.js.
    const REPLY_HEADER_GHOST_RE = /^[^?！?\n]{1,48}\s(?:đã trả lời|replied to)\s(?!(?:.*\s)?(?:chưa|rồi|xong|sao|đâu|gì|à|hả|nhỉ|nha|nhé|thôi|luôn|vậy|đấy|đó|ạ|nhá|rùi|nè|được|yet|already|right|now|ok|okay)\s*[?！?.!…]*$)[^?！?\n]{1,60}$/iu;
    const headerGhostCandidates = db.prepare(`
      SELECT id, thread_id, content FROM messages
      WHERE (content LIKE '% đã trả lời %' OR content LIKE '% replied to %')
        AND (fb_message_id LIKE 'mid.$%' OR fb_message_id LIKE '%@msgr.%')
        AND (media_type IS NULL OR media_type = 'text')
    `).all();
    let deletedHeaderGhostCount = 0;
    const headerGhostThreadIds = new Set();
    for (const row of headerGhostCandidates) {
      const text = String(row.content || '').trim();
      if (/quảng cáo|replied to (?:an |your )?ad/i.test(text)) continue;
      if (/bài viết|story/i.test(text)) continue;
      if (!REPLY_HEADER_GHOST_RE.test(text)) continue;
      deleteReplyHeader.run(row.id);
      const newest = previewNewest.get(row.thread_id);
      setThreadPreview.run(newest?.content || '[Tin nhắn]', row.thread_id, row.content);
      headerGhostThreadIds.add(row.thread_id);
      deletedHeaderGhostCount++;
    }
    for (const ghostTid of headerGhostThreadIds) {
      io.emit('THREAD_MESSAGES_UPDATED', { thread_id: ghostTid, account_id: null });
    }

    // (4g) Row preview NHÓM ingest trước khi ingestion tách prefix còn giữ
    // content "Tên: nội dung" -> tách để bubble nhóm render tên thành viên
    // như tin thật. Guard: prefix phải giống tên người (chữ/khoảng trắng,
    // <=5 từ) + thread phải có >=2 sender incoming khác nhau (nhóm thật —
    // 1-1 có text "Lưu ý: xyz" không bị tách mất nội dung).
    const previewPrefixRows = db.prepare(`
      SELECT id, thread_id, content FROM messages
      WHERE fb_message_id LIKE 'sidebar_preview_%' AND content LIKE '%: %'
    `).all();
    const distinctIncomingSenders = db.prepare(`
      SELECT COUNT(DISTINCT sender_name) AS n FROM messages
      WHERE thread_id = ? AND is_outgoing = 0 AND sender_name IS NOT NULL AND TRIM(sender_name) != ''
    `);
    let fixedPreviewPrefixCount = 0;
    const previewPrefixThreadIds = new Set();
    for (const row of previewPrefixRows) {
      const m = String(row.content || '').match(/^([^:\n]{1,40}):\s+(.+)$/s);
      if (!m) continue;
      const prefixName = m[1].trim();
      const suffix = m[2].trim();
      if (prefixName.length < 2 || prefixName.split(/\s+/).length > 5) continue;
      if (!/^[\p{L}\p{M}][\p{L}\p{M}\s.'\-]*$/u.test(prefixName)) continue;
      if (!suffix || /^[^:\n]{1,40}:\s+/.test(suffix)) continue;
      if (Number(distinctIncomingSenders.get(row.thread_id).n) < 2) continue;
      db.prepare("UPDATE messages SET content = ?, sender_name = COALESCE(NULLIF(TRIM(sender_name), ''), ?) WHERE id = ?").run(suffix, prefixName, row.id);
      previewPrefixThreadIds.add(row.thread_id);
      fixedPreviewPrefixCount++;
    }
    for (const prefixTid of previewPrefixThreadIds) {
      io.emit('THREAD_MESSAGES_UPDATED', { thread_id: prefixTid, account_id: null });
    }

    // (4h) Backfill reply_to_id/reply_to_sender_name cho quote reply cũ: row
    // lưu trước khi có cột (hoặc tin gốc đổ vào SAU tin reply trong cùng đợt
    // sync) chưa có neo tin gốc -> UI không hiện tên và không click-lướt được.
    const replyTargetBackfillRows = db.prepare(`
      SELECT id, thread_id, reply_to_text, timestamp_ms FROM messages
      WHERE reply_to_text IS NOT NULL AND TRIM(reply_to_text) != ''
        AND reply_to_id IS NULL
    `).all();
    let backfilledReplyTargetCount = 0;
    for (const row of replyTargetBackfillRows) {
      if (storeReplyTargetForRow(row.id, row.thread_id, row.reply_to_text, row.timestamp_ms)) {
        backfilledReplyTargetCount++;
      }
    }
    if (backfilledReplyTargetCount > 0) {
      console.log(`[DB] 🧹 Nối quote reply tới tin gốc: ${backfilledReplyTargetCount} tin.`);
    }

    const totalJunk = deletedNoticeCount + dupThreadIds.size + sepThreadIds.size + fixedMojibakeCount + deletedReplyHeaderCount + deletedPhantomLabelCount + deletedMemberNameEchoCount + deletedHeaderGhostCount + fixedPreviewPrefixCount;
    if (totalJunk > 0) {
      console.log(`[DB] 🧹 Heal tin rác/nhân đôi: ${deletedNoticeCount} notice E2EE, ${dupThreadIds.size} bubble dom_ trùng mid thật, ${sepThreadIds.size} separator thời gian, ${fixedMojibakeCount} emoji mojibake, ${deletedReplyHeaderCount} header reply, ${deletedPhantomLabelCount} nhãn tên nhóm, ${deletedMemberNameEchoCount} mảnh tên==sender, ${deletedHeaderGhostCount} header reply ghost, ${fixedPreviewPrefixCount} preview dán prefix (${totalJunk} vị trí)`);
    }

    const activeThreads = db.prepare('SELECT DISTINCT thread_id FROM messages').all();
    for (const { thread_id } of activeThreads) {
      if (thread_id) ConversationRepository.normalizeMessageSequence(thread_id, db);
    }
  } catch (cleanErr) {
    console.warn('[DB] Lỗi dọn dẹp tên hệ thống / chuẩn hóa sequence:', cleanErr.message);
  }

  // Drains message_queue (Page-thread sends routed there by sendViaExtension,
  // feature 015) and dispatches SEND_QUEUED_MESSAGE to the right extension
  // connection. Was never wired up here before feature 015, so queued messages
  // had nothing to pop them.
  queueWorker.configure({
    database: db,
    getConnection: (accountId) => extensionConnections.get(accountId),
    campaignEnabled: () => CampaignService.getConfig().enabled,
    // Tin Page trong hàng đợi (campaign...) → hybrid 2 tầng: còn cửa sổ 24h
    // (tính từ tin cuối CỦA KHÁCH) thì Send API; quá 24h thì bắn lệnh DOM
    // Business Suite sang Chrome của nick quản lý Page.
    pageGraphSend: async (message) => {
      const threadRow = db.prepare(`
        SELECT t.id, t.account_id, t.thread_url, t.contact_name, s.id AS source_id,
               s.external_id AS page_id, s.owner_account_id AS owner_account_id, s.source_type
        FROM threads t LEFT JOIN inbox_sources s ON s.id = t.source_id WHERE t.id = ?
      `).get(message.thread_id);
      if (!threadRow || threadRow.source_type !== 'page_messenger' || !threadRow.source_id) {
        return { success: false, error: 'Thread Page không hợp lệ.', errorCode: 'PAGE_ROUTE_INVALID' };
      }
      const psid = String(message.thread_id).includes(':') ? String(message.thread_id).split(':').pop() : String(message.thread_id);
      const maxSeqRow = db.prepare('SELECT MAX(COALESCE(sequence_order, id)) AS max_seq FROM messages WHERE thread_id = ?').get(message.thread_id);
      const nextSeq = (Number.isFinite(Number(maxSeqRow?.max_seq)) && Number(maxSeqRow.max_seq) > 0) ? Number(maxSeqRow.max_seq) + 1 : 1;
      const clientMsgId = message.client_message_id || `queue_${message.id}`;
      const pendingFbId = `pending_${clientMsgId}`;
      const nowMs = Date.now();
      // insertCampaignDispatch (chiến dịch) đã tạo sẵn row pending với cùng
      // fb_message_id `pending_queue_<queueId>` — INSERT lại đâm UNIQUE
      // constraint failed: messages.fb_message_id (chiến dịch Page fail 100%
      // ngay attempt đầu, 2026-10-10). Tìm row sẵn có để tái sử dụng.
      const existingRow = db.prepare(
        'SELECT id FROM messages WHERE client_message_id = ? OR fb_message_id = ?'
      ).get(clientMsgId, pendingFbId);
      let rowId;
      if (existingRow) {
        rowId = existingRow.id;
        db.prepare(`
          UPDATE messages
          SET content = ?, delivery_status = 'pending', delivery_error = NULL,
              sequence_order = ?, timestamp_ms = ?
          WHERE id = ?
        `).run(message.content, nextSeq, nowMs, rowId);
      } else {
        const insert = db.prepare(`
          INSERT INTO messages (thread_id, fb_message_id, client_message_id, sender_id, content, is_outgoing, sender_role, delivery_status, sequence_order, timestamp_ms, timestamp_source, created_at)
          VALUES (?, ?, ?, 'SYSTEM', ?, 1, 'operator', 'pending', ?, ?, 'client_submit', ?)
        `).run(message.thread_id, pendingFbId, clientMsgId, message.content, nextSeq, nowMs, new Date(nowMs).toISOString());
        rowId = insert.lastInsertRowid;
      }
      db.prepare('UPDATE threads SET last_message = ?, last_activity = CURRENT_TIMESTAMP WHERE id = ?').run(message.content, message.thread_id);

      // Luồng DOM: bắn SEND_QUEUED_MESSAGE sang đúng Chrome của nick quản lý
      // Page. Kết quả thật do extension báo qua QUEUED_MESSAGE_RESULT — trả
      // dispatchedViaDom để QueueWorker giữ queue ở 'processing'.
      const dispatchViaDom = async () => {
        // Đánh dấu kênh dom NGAY khi quyết định đi DOM — kể cả admin offline
        // phía dưới thì báo cáo vẫn ghi đúng tin này định gửi qua Business Suite.
        db.prepare("UPDATE messages SET delivery_channel = 'dom' WHERE id = ?").run(rowId);
        if (!threadRow.owner_account_id) {
          return { success: false, error: 'Page chưa gắn nick quản lý (owner_account_id).', errorCode: 'PAGE_OWNER_UNKNOWN' };
        }
        const adminWs = extensionConnections.get(threadRow.owner_account_id);
        if (!adminWs || adminWs.readyState !== 1) {
          return {
            success: false,
            error: 'Chrome của nick quản lý Page chưa bật. Hãy mở Chrome, đăng nhập app rồi bấm "Thử lại".',
            errorCode: 'FAILED_ADMIN_OFFLINE'
          };
        }
        let resolvedCustomerUid = null;
        try {
          const contactRow = db.prepare('SELECT profile_url FROM contacts WHERE thread_id = ?').get(message.thread_id);
          resolvedCustomerUid = extractUid(contactRow?.profile_url);
          if (!resolvedCustomerUid && threadRow.contact_name) {
            const matchByName = db.prepare('SELECT profile_url FROM contacts WHERE name = ? AND profile_url IS NOT NULL LIMIT 1').get(threadRow.contact_name);
            resolvedCustomerUid = extractUid(matchByName?.profile_url);
          }
        } catch (_) {}

        const envelope = {
          type: 'SEND_QUEUED_MESSAGE',
          data: {
            contract_version: message.campaign_id ? 2 : 1,
            queue_id: message.id,
            outbound_attempt_id: message.outbound_attempt_id || null,
            thread_id: message.thread_id,
            recipient_thread_id: psid,
            thread_url: threadRow.thread_url || null,
            expected_contact_name: threadRow.contact_name || null,
            customer_uid: resolvedCustomerUid || null,
            account_id: threadRow.owner_account_id,
            content: message.content,
            source_type: 'page_messenger',
            page_id: threadRow.page_id,
            source_id: threadRow.source_id,
            campaign_id: message.campaign_id || null,
            campaign_recipient_id: message.campaign_recipient_id || null,
            campaign_attempt_id: message.campaign_attempt_id || null,
            idempotency_key: message.idempotency_key || null,
            dispatch_mode: 'business_suite_single_tab'
          }
        };
        try {
          adminWs.send(JSON.stringify(envelope));
        } catch (error) {
          return { success: false, error: 'Không gửi được lệnh cho Chrome admin.', errorCode: 'DOM_DISPATCH_FAILED' };
        }
        console.log(`[QueueWorker] Page DOM dispatch: queue=${message.id} page=${threadRow.page_id} psid=${psid} admin=${threadRow.owner_account_id}`);
        return { success: true, dispatchedViaDom: true };
      };

      // Quyết định kênh TẠI THỜI ĐIỂM XỬ LÝ TIN này — khách nhắn lại giữa
      // chừng thì cửa sổ 24h gia hạn, tin tự đi API.
      const window = pageApiService.classifyReplyWindow(message.thread_id);
      if (window.status === 'outside') {
        return await dispatchViaDom();
      }

      const result = await pageApiService.sendPageMessage(threadRow.source_id, psid, message.content);
      if (result.success) {
        db.prepare('UPDATE messages SET fb_message_id = ?, delivery_status = \'sent\', delivery_error = NULL WHERE id = ?')
          .run(result.messageId || pendingFbId, rowId);
        const sentRow = db.prepare('SELECT * FROM messages WHERE id = ?').get(rowId);
        io.emit('NEW_MESSAGE', { ...sentRow, thread_id: message.thread_id, account_id: threadRow.account_id });
        io.emit('THREAD_LIST_UPDATED', { thread_id: message.thread_id, account_id: threadRow.account_id });
        return { success: true };
      }
      // Meta xác nhận ngoài cửa sổ 24h (2018001) → chuyển luồng DOM.
      if (result.fallbackToDom) {
        return await dispatchViaDom();
      }
      db.prepare("UPDATE messages SET delivery_status = 'failed', delivery_error = ? WHERE id = ?")
        .run(String(result.error || 'SEND_FAILED'), rowId);
      return { success: false, error: result.error, errorCode: result.errorCode };
    },
    onQueueFail: (message, reason) => {
      try { CommentLeadsService.markQueueFailed(message.id, reason); } catch (_) { /* lead tracking best-effort */ }
      if (message.outbound_attempt_id) {
        const attempt = OutboundAttemptRepository.getById(message.outbound_attempt_id, db);
        const richMessage = attempt
          ? db.prepare('SELECT * FROM messages WHERE id = ?').get(attempt.message_id)
          : null;
        if (richMessage) {
          db.prepare(
            "UPDATE messages SET delivery_status = 'failed', delivery_error = ? WHERE id = ?"
          ).run(reason, richMessage.id);
          io.emit('MESSAGE_SEND_STATUS', {
            thread_id: richMessage.thread_id,
            client_message_id: richMessage.client_message_id,
            message_id: richMessage.id,
            attempt_id: message.outbound_attempt_id,
            status: 'failed',
            fb_message_id: null,
            confirmation_source: null,
            error: { code: reason, message: reason },
            updated_at: new Date().toISOString()
          });
        }
        return;
      }
      const clientMessageId = `queue_${message.id}`;
      db.prepare(`
        UPDATE messages SET delivery_status = 'failed', delivery_error = ?
        WHERE client_message_id = ?
      `).run(reason, clientMessageId);
      io.emit('MESSAGE_SEND_FAILED', { thread_id: message.thread_id, client_message_id: clientMessageId, success: false, status: 'failed', error: reason });
    }
  });
  const staleRichRecovery = queueWorker.recoverStaleRichDispatches();
  if (staleRichRecovery.dispatching || staleRichRecovery.awaiting_confirmation) {
    console.warn('[QueueWorker] Recovered stale rich-message sends:', staleRichRecovery);
  }
  campaignRunner.configure({
    enqueueMessage: enqueueCampaignMessage,
    emit: (campaign, recipient) => CampaignEventService.emit(io, campaign, recipient)
  });
  const recoverySummary = CampaignRecoveryService.reconcile({ database: db });
  console.log('[CampaignRecovery]', recoverySummary);
  queueWorker.start();
  CommentLeadsService.startReplyWatcher(io);
  if (CampaignService.getConfig().enabled) {
    setTimeout(() => campaignRunner.recover(), 1500);
  }

  // Tự kết nối lại mọi tài khoản Facebook khi mở lại app (yêu cầu 2026-09-29):
  // Chrome của account chết theo app nên trước đây phải bấm "Kết nối" thủ công.
  // Chạy cùng luồng với nút Kết nối: đăng ký ẩn nền sau khi extension kết nối,
  // Mặc định KHÔNG tự bật cửa sổ Chrome hàng loạt khi mở app (tránh hiện tượng
  // mở app lên bị bung các cửa sổ Chrome rác / chưa đăng nhập như bản cũ;
  // chuẩn CRM_FB_V1 chỉ mở Chrome khi user chủ động bấm "Kết nối").
  // Nếu cấu hình FB_CRM_AUTO_RECONNECT_ON_START=1 thì chỉ tự kết nối lại các
  // tài khoản đang ACTIVE, có chủ sở hữu rõ ràng và có profile chứa cookie hợp lệ.
  if (process.env.FB_CRM_AUTO_RECONNECT_ON_START === '1') {
    const autoReconnectTimer = setTimeout(() => {
      (async () => {
        const accounts = db.prepare(`
          SELECT id, profile_dir FROM accounts
          WHERE status = 'ACTIVE' AND owner_user_id IS NOT NULL AND profile_dir IS NOT NULL
        `).all();
        for (const acc of accounts) {
          const accountId = String(acc.id);
          const resolvedProfileDir = processManager.resolveAccountProfileDir(acc.profile_dir, accountId);
          if (!processManager.hasValidFacebookProfile(resolvedProfileDir)) {
            console.log(`[AUTO_RECONNECT] Bỏ qua account ${accountId} vì profile chưa có phiên đăng nhập hợp lệ.`);
            continue;
          }
          const requestedAt = Date.now();
          try {
            backgroundAfterConnectRequests.set(accountId, requestedAt);
            const forceReload = !processManager.wasLaunchedByThisRun(accountId);
            const started = await processManager.startAccountProcess(accountId, null, { forceExtensionReload: forceReload });
            if (!started) {
              backgroundAfterConnectRequests.delete(accountId);
              continue;
            }
            if (!KEEP_CONNECTED_FACEBOOK_CHROME_VISIBLE) {
              for (const delayMs of [6000, 20000, 60000]) {
                await new Promise((resolve) => setTimeout(resolve, delayMs));
                if (backgroundAfterConnectRequests.get(accountId) !== requestedAt) break;
                if (!extensionConnections.has(accountId)) continue;
                const hideResult = await processManager.hideAccountProcess(accountId);
                if (hideResult?.success) {
                  backgroundAfterConnectRequests.delete(accountId);
                  io.emit('ACCOUNT_DISPLAY_CHANGED', {
                    account_id: accountId,
                    chrome_display_mode: 'BACKGROUND',
                    is_chrome_running: true
                  });
                  break;
                }
              }
            }
            if (extensionConnections.has(accountId)) {
              console.log(`[AUTO_RECONNECT] Đã tự kết nối account ${accountId} khi khởi động.`);
            }
          } catch (err) {
            backgroundAfterConnectRequests.delete(accountId);
            console.warn(`[AUTO_RECONNECT] Lỗi tự kết nối account ${accountId}:`, err.message);
          }
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
      })();
    }, 4000);
    if (typeof autoReconnectTimer.unref === 'function') autoReconnectTimer.unref();
  }

  return listenPromise;
}

InitialMessageSweepService.configure({
  listThreads: (accountId) => db.prepare(`
    SELECT t.id, t.external_thread_id, t.thread_url, t.contact_name,
           t.is_unread, t.last_activity, t.last_message,
           CASE WHEN s.source_type = 'page_messenger' THEN s.external_id ELSE NULL END AS page_id,
           (SELECT COUNT(*) FROM messages m WHERE m.thread_id = t.id) AS message_count,
           (SELECT MAX(m.timestamp_ms) FROM messages m WHERE m.thread_id = t.id) AS last_msg_ts
    FROM threads t
    LEFT JOIN inbox_sources s ON s.id = t.source_id
    WHERE t.account_id = ? AND t.archived_at IS NULL
      AND COALESCE(t.sync_status, 'LOCAL') <> 'SYNCED'
    ORDER BY
      CASE WHEN COALESCE(t.is_unread, 0) = 1 THEN 0 ELSE 1 END ASC,
      CASE WHEN (SELECT COUNT(*) FROM messages m WHERE m.thread_id = t.id) = 0 THEN 0 ELSE 1 END ASC,
      t.last_activity DESC
  `).all(String(accountId)),
  // 2026-09-30 (Phase 1): bỏ qua sweep của thread không có gì mới - preview
  // sidebar (threads.last_message, cập nhật liên tục từ BS) trùng tin cuối đã
  // lưu. Tiết kiệm hàng trăm navigate cho thread cũ, máy 8GB hết bão CPU.
  shouldSkipSweep: (thread) => {
    try {
      const preview = String(thread?.last_message || '');
      if (!preview.trim()) return false;
      if (Number(thread?.is_unread) === 1) return false;
      // 2026-09-30 (Phase 2.3): thread lạnh - tin cuối cũ hơn 30 ngày mà
      // không unread -> defer (Tier 2 on-demand), ưu tiên thread đang hoạt
      // động. Cấu hình qua env FB_CRM_STALE_THREAD_DAYS.
      if (isStaleThreadLastActivity({
        lastMsgTs: thread?.last_msg_ts,
        staleDays: Number(process.env.FB_CRM_STALE_THREAD_DAYS || 30)
      })) {
        return true;
      }
      const last = db.prepare(`
        SELECT content FROM messages
        WHERE thread_id = ? AND content IS NOT NULL AND content <> ''
        ORDER BY timestamp_ms DESC, id DESC
        LIMIT 1`).get(String(thread?.id || ''));
      if (!last || !String(last.content || '').trim()) return false;
      return sidebarShouldSkipSweep({
        sidebarPreview: preview,
        storedContent: last.content,
        isUnread: thread.is_unread
      });
    } catch (_) { return false; }
  },
  enqueue: (job) => InboxSyncScheduler.enqueueThreadSync(job),
  isBusy: (laneKey, accountId) => InboxSyncScheduler.isLaneBusy(laneKey),
  isReady: (accountId) => {
    const connection = extensionConnections.get(String(accountId));
    return Boolean(connection && connection.readyState === WebSocket.OPEN);
  },
  emit: (progress) => io.emit('INITIAL_MESSAGE_SYNC_PROGRESS', progress)
});

// Phase 1 (ke hoach 2026-10-01): retry bi guard navigated_away chan thi
// re-queue ve DUOI hang doi quet thay vi huy mat trang - kho no initial_sweep
// tu roi dan khi operator ranh tay. Cap 3 lan/thread nam trong policy; thread
// da quet xong (loop terminator) thi bo qua. reason history_retry khong phai
// user-driven nen enqueueThreadSync tu xep cuoi hang doi lane.
HistorySyncRetryPolicy.configure({
  onNavigatedAwayRequeue: (accountId, threadId) => {
    try {
      const retryRow = db.prepare('SELECT thread_url, contact_name FROM threads WHERE id = ?').get(String(threadId));
      if (!retryRow) return;
      if (InboxSyncScheduler.isThreadHistoryCompleted(String(threadId), String(accountId))) return;
      const retrySource = ConversationRepository.getThreadSource(String(threadId));
      InboxSyncScheduler.enqueueThreadSync({
        account_id: String(accountId),
        thread_id: String(threadId),
        external_thread_id: String(threadId),
        thread_url: retryRow.thread_url || null,
        page_id: (retrySource && retrySource.sourceType === 'page_messenger') ? retrySource.pageId : null,
        contact_name: retryRow.contact_name || null,
        reason: 'history_retry',
        allow_navigation: true
      });
    } catch (requeueErr) {
      console.warn(`[HISTORY_SYNC_RETRY_REQUEUE_ERROR] thread=${threadId}:`, requeueErr.message);
    }
  }
});

// Phase C (ke hoach ws-socket-adoption 2026-10-01): watchdog kenh dispatch.
// Socket zombie thi ws.send van "thanh cong" nhung extension khong nhan - do
// so dispatch lien tiep khong co ket qua, vuot nguong thi COMMAND_PROBE;
// khong ACK trong 5s thi dong socket de extension tu dong ky lai.
const dispatchStallWatchdog = new DispatchStallWatchdog({
  stallLimit: Number(process.env.FB_CRM_DISPATCH_STALL_LIMIT || 20)
});
const pendingDispatchProbes = new Map(); // probe_id -> { account_id, timer }
function sendDispatchProbe(accountId, extWs) {
  const accId = String(accountId || '');
  if (!accId || !extWs || extWs.readyState !== WebSocket.OPEN) return;
  const probeId = `probe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const probeTimer = setTimeout(() => {
    pendingDispatchProbes.delete(probeId);
    dispatchStallWatchdog.probeTimedOut(accId);
    const suspectWs = extensionConnections.get(accId);
    if (suspectWs && suspectWs.readyState === WebSocket.OPEN) {
      const recentHeartbeat = Date.now() - Number(suspectWs.lastHeartbeatAt || 0) < 35000;
      if (recentHeartbeat || processManager.getStatus(accId) === 'RUNNING') {
        dispatchStallWatchdog.noteProbeAck(accId);
        return;
      }
      console.warn(`[WS] Dispatch channel suspect account=${accId} probe=${probeId} no ACK in 15s - closing socket to force re-register`);
      try { suspectWs.close(4000, 'DISPATCH_CHANNEL_STALL'); } catch (_) {}
    }
  }, 15000);
  if (typeof probeTimer.unref === 'function') probeTimer.unref();
  pendingDispatchProbes.set(probeId, { account_id: accId, timer: probeTimer });
  console.warn(`[WS] Dispatch stall account=${accId} - ${dispatchStallWatchdog.stallLimit} dispatches without result, probing socket ${probeId}`);
  extWs.send(JSON.stringify({ type: 'COMMAND_PROBE', data: { probe_id: probeId } }));
}

InboxSyncScheduler.configure({
  getConnection: (accountId) => extensionConnections.get(String(accountId)),
  dispatchThreadMessagesSync: ({ account_id, thread_id, external_thread_id, thread_url, page_id, contact_name, reason, allow_navigation, sync_mode, scroll_delta }) => {
    // TẮT lane sync DOM cho thread PAGE — lịch sử page lấy qua Graph API
    // (backfill) và realtime qua webhook. Mở tab Business Suite để quét DOM
    // là đường cũ đã ngừng — trước đây nó tự sinh 2 tab Meta Business Suite
    // trong Chrome của account (báo lỗi 2026-10-05).
    if (page_id) {
      syncDebug('SYNC_DISPATCH_SKIP_PAGE', { thread: String(thread_id || '').substring(0, 20), reason: reason || null });
      return false;
    }
    const extWs = extensionConnections.get(String(account_id));
    if (!extWs || extWs.readyState !== WebSocket.OPEN) {
      syncDebug('SYNC_DISPATCH_FAIL', { thread: String(thread_id || '').substring(0, 20), reason: reason || null, why: 'no_extension_ws' });
      return false;
    }
    const syncState = require('./services/HistorySyncManager').getSyncState(thread_id);
    const pageSource = ConversationRepository.getThreadSource(thread_id);
    const persisted = db.prepare('SELECT COUNT(*) AS count FROM messages WHERE thread_id = ?').get(thread_id);
    let mode = sync_mode || 'incremental';
    if (!sync_mode && (!syncState?.sync_cursor || Number(persisted?.count || 0) === 0)) mode = 'initial';
    else if (!sync_mode && (syncState.sync_status === 'PARTIAL' || syncState.sync_status === 'FAILED')) mode = 'deep_backfill';
    // Lưới an toàn định tuyến: row chưa bind source (source_id NULL) phải vẫn
    // được nhận diện là thread Page qua thread_url, nếu không sẽ bị điều hướng
    // sang tab Messenger cá nhân và tab Business Suite không bao giờ chuyển user.
    const threadUrlPageId = String(thread_url || '').match(/[?&](?:asset_id|mailbox_id)=(\d+)/)?.[1] || null;
    const resolvedPageId = pageSource?.sourceType === 'personal_messenger'
      ? null
      : (page_id || pageSource?.pageId || threadUrlPageId || null);
    const threadRow = db.prepare('SELECT contact_name FROM threads WHERE id = ?').get(thread_id);
    extWs.send(JSON.stringify({
      type: 'SYNC_THREAD_MESSAGES',
      data: {
        account_id,
        thread_id,
        external_thread_id: external_thread_id || thread_id,
        thread_url,
        page_id: resolvedPageId,
        mode,
        cursor: syncState?.sync_cursor || null,
        contact_name: contact_name || threadRow?.contact_name || null,
        reason,
        allow_navigation: allow_navigation === true,
        scroll_delta: Number(scroll_delta) || 0
      }
    }));
    syncDebug('SYNC_DISPATCH', { thread: String(thread_id || '').substring(0, 20), reason: reason || null, mode });
    // Phase C (2026-10-01): dem dispatch khong ket qua; cham nguong thi probe
    // socket (zombie thi ws.send van thanh cong nhung extension khong nhan).
    dispatchStallWatchdog.noteDispatch(String(account_id));
    if (dispatchStallWatchdog.shouldProbe(String(account_id)) && extensionConnections.get(String(account_id)) === extWs) {
      sendDispatchProbe(String(account_id), extWs);
    }
    return true;

    console.log(`[HISTORY_SYNC_DISABLED] Scheduler request ignored account=${account_id} thread=${thread_id}`);
    return false;
    /* Scheduler-based message history synchronization is intentionally disabled.
    const extWs = extensionConnections.get(String(account_id));
    if (!extWs || extWs.readyState !== WebSocket.OPEN) return false;
    const syncState = require('./services/HistorySyncManager').getSyncState(thread_id);
    const pageSource = ConversationRepository.getThreadSource(thread_id);
    const threadRow = db.prepare('SELECT contact_name FROM threads WHERE id = ?').get(thread_id);
    let mode = 'incremental';
    if (!syncState?.sync_cursor) mode = 'initial';
    else if (syncState.sync_status === 'PARTIAL' || syncState.sync_status === 'FAILED') mode = 'deep_backfill';
    extWs.send(JSON.stringify({
      type: 'SYNC_THREAD_MESSAGES',
      data: {
        account_id,
        thread_id,
        thread_url,
        page_id: page_id || pageSource?.pageId || null,
        mode,
        cursor: syncState?.sync_cursor || null,
        contact_name: contact_name || threadRow?.contact_name || null,
        reason,
        allow_navigation: allow_navigation === true
      }
    }));
    return true;
    */
  }
});

// Declared even though nothing currently assigns it: referencing an undeclared
// identifier here threw a ReferenceError that aborted stopManagedProcesses()
// before stopAllAccountProcesses() could run (Chrome outlived app quit).
let extensionHealthMonitor = null;
function stopManagedProcesses() {
  if (extensionHealthMonitor) {
    clearInterval(extensionHealthMonitor);
    extensionHealthMonitor = null;
  }
  return processManager.stopAllAccountProcesses();
}

module.exports = { app, server, startServer, stopManagedProcesses, extensionConnections, io };
