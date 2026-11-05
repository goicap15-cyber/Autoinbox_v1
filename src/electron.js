const { app, BrowserWindow, dialog, ipcMain, session } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const net = require('net');
const crypto = require('crypto');
const Module = require('module');

// Cho phép gói hot-update nằm ngoài app.asar nạp trực tiếp node_modules bên trong app.asar
const asarNodeModules = path.join(__dirname, '../node_modules');
const origNodeModulePaths = Module._nodeModulePaths;
Module._nodeModulePaths = function (from) {
  const paths = origNodeModulePaths.call(this, from);
  if (!paths.includes(asarNodeModules)) paths.push(asarNodeModules);
  return paths;
};

const instanceToken = crypto.randomUUID();
process.env.CRM_INSTANCE_TOKEN = instanceToken;
// Hybrid single-instance guard: lock chặn mở app lần 2 (máy khách bấm icon
// nhiều lần → EADDRINUSE :5050 vòng lặp 2026-10-09), nhưng sau khi kill cứng
// mutex cũ có thể sống sót chặn oan bản mới (lý do code cũ bỏ lock). Nên khi
// không lấy được lock thì probe cổng 5050: còn instance sống thì thoát im
// lặng (bản đầu nhận 'second-instance' và focus window), port trống thì coi
// mutex là rác và chạy tiếp - port binding vẫn là chủ quyền cuối cùng.
const hasSingleInstanceLock = app.requestSingleInstanceLock();

let mainWindow = null;
let backendRuntime = null;
let cleanupStarted = false;
let startupError = null;
let backendReady = false;
let openExternalWarned = false;

function isBackendPortBusy(port, timeoutMs = 5000) {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const attempt = () => {
      const socket = new net.Socket();
      const done = (busy) => {
        socket.removeAllListeners();
        socket.destroy();
        if (busy || Date.now() - startedAt >= timeoutMs) resolve(busy);
        else setTimeout(attempt, 400);
      };
      socket.once('connect', () => done(true));
      socket.once('error', () => done(false));
      socket.setTimeout(1200, () => done(false));
      socket.connect(port, '127.0.0.1');
    };
    attempt();
  });
}

function appendDesktopLog(message) {
  try {
    const logDir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(
      path.join(logDir, 'desktop.log'),
      `${new Date().toISOString()} ${message}\n`,
      'utf8'
    );
  } catch (_) { /* Logging must never prevent the app from starting. */ }
}

function waitForBackend(url, expectedInstanceToken, timeoutMs = 45000) {
  if (startupError) return Promise.reject(startupError);
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const probe = () => {
      const request = http.get(url, (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { body += chunk; });
        response.on('end', () => {
          try {
            const health = JSON.parse(body);
            if (response.statusCode === 200 && health.instance_token === expectedInstanceToken) return resolve();
          } catch (_) {}
          retry();
        });
      });
      request.setTimeout(1500, () => request.destroy());
      request.on('error', retry);
    };
    const retry = () => {
      if (Date.now() - startedAt >= timeoutMs) {
        reject(startupError || new Error(`Backend did not become ready within ${timeoutMs}ms`));
        return;
      }
      setTimeout(probe, 300);
    };
    probe();
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1000,
    minHeight: 650,
    title: 'FB Messenger CRM',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Set standard Chrome User-Agent for popup windows (Google OAuth GIS)
  mainWindow.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
    callback({ cancel: false, requestHeaders: details.requestHeaders });
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Mọi liên kết http/https (link Facebook share, Spotify...) mở bằng
    // trình duyệt hệ thống của người dùng - nơi họ đã đăng nhập Facebook,
    // cần cho các link share/v/... Yêu cầu 2026-09-18: link trong chat phải
    // bấm được. Chặn popup nội bộ trong cửa sổ CRM.
    if (/^https?:\/\//i.test(url)) {
      require('electron').shell.openExternal(url).catch((err) => {
        // shell.openExternal trả Promise - máy khách thiếu/hỏng default browser
        // (0x800401F5) không được thành unhandledRejection spam log.
        appendDesktopLog(`[openExternal] Không mở được ${url}: ${err?.message || err}`);
        if (!openExternalWarned) {
          openExternalWarned = true;
          dialog.showMessageBox({
            type: 'warning',
            title: 'Không mở được liên kết',
            message: 'Windows không tìm thấy trình duyệt để mở link này.',
            detail: 'Hãy cài Chrome/Edge và đặt làm trình duyệt mặc định (Cài đặt > Ứng dụng > Ứng dụng mặc định) rồi thử lại.'
          });
        }
      });
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.webContents.on('did-fail-load', (_event, code, description, validatedURL, isMainFrame) => {
    if (isMainFrame) appendDesktopLog(`[renderer] did-fail-load code=${code} url=${validatedURL} ${description}`);
  });

  try {
    await waitForBackend('http://127.0.0.1:5050/api/health', instanceToken);
    appendDesktopLog('[startup] Backend ready; loading CRM UI.');
    await mainWindow.loadURL('http://127.0.0.1:5050?desktop=1');
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
  } catch (err) {
    const message = err?.stack || err?.message || String(err);
    appendDesktopLog(`[startup] Failed: ${message}`);
    if (/EADDRINUSE/i.test(message)) {
      dialog.showErrorBox(
        'FB Messenger CRM đã đang chạy',
        'Đã có một cửa sổ CRM khác đang mở (cổng 5050 bận).\nHãy dùng cửa sổ đang chạy, hoặc đóng hẳn app (Task Manager → FB Messenger CRM) rồi mở lại.'
      );
    } else {
      dialog.showErrorBox(
        'Không thể khởi động FB Messenger CRM',
        `Backend không khởi động được.\n\n${err?.message || err}\n\nLog: ${path.join(app.getPath('userData'), 'logs', 'desktop.log')}`
      );
    }
    app.quit();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC: clear all session cookies then reload → proper logout in Electron
ipcMain.handle('crm-logout', async () => {
  try {
    const ses = session.defaultSession;
    await ses.clearStorageData({ storages: ['cookies'] });
  } catch (_) { /* ignore */ }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.reload();
  }
});

app.on('second-instance', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) {
    const portBusy = await isBackendPortBusy(5050);
    if (portBusy) {
      appendDesktopLog('[startup] CRM đã chạy sẵn (cổng 5050 bận) - thoát bản vừa mở.');
      app.quit();
      return;
    }
    appendDesktopLog('[startup] Lock singleton bị giữ bởi tiến trình đã chết - cổng 5050 trống, chạy tiếp.');
  }
  app.userAgentFallback = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 FB-CRM-Desktop';
  appendDesktopLog(`[startup] app=${app.getVersion()} packaged=${app.isPackaged} resources=${process.resourcesPath}`);
  // Start Backend Express/WebSocket Server (ưu tiên bản hot-update nếu đã tải về)
  try {
    const hotUpdateServer = process.resourcesPath
      ? path.join(process.resourcesPath, 'hot-update', 'dist', 'server', 'index.js')
      : '';
    const distServer = path.join(__dirname, '../dist/server/index.js');
    const srcServer = path.join(__dirname, 'server/index.js');

    if (hotUpdateServer && fs.existsSync(hotUpdateServer)) {
      console.log('[Electron] Loading hot-updated server from resources/hot-update/dist/server/index.js');
      appendDesktopLog(`[startup] Loading hot-update server: ${hotUpdateServer}`);
      backendRuntime = require(hotUpdateServer);
    } else if (fs.existsSync(distServer)) {
      console.log('[Electron] Loading compiled server from dist/server/index.js');
      backendRuntime = require(distServer);
    } else if (fs.existsSync(srcServer)) {
      console.log('[Electron] Loading server from src/server/index.js');
      backendRuntime = require(srcServer);
    }
  } catch (err) {
    startupError = err;
    appendDesktopLog(`[backend] ${err?.stack || err?.message || err}`);
    console.error('[Electron] Error starting backend server:', err.message);
  }

  if (!startupError && backendRuntime?.startupPromise) {
    try {
      await backendRuntime.startupPromise;
      backendReady = true;
    } catch (err) {
      startupError = err;
      appendDesktopLog(`[backend-listen] ${err?.stack || err?.message || err}`);
    }
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

process.on('uncaughtException', (err) => {
  startupError = err;
  appendDesktopLog(`[uncaughtException] ${err?.stack || err}`);
});

process.on('unhandledRejection', (reason) => {
  const detail = reason instanceof Error ? (reason.stack || reason) : String(reason);
  appendDesktopLog(`[unhandledRejection] ${detail}`);
  // Chỉ gán khi backend chưa ready - rejection runtime muộn (vd openExternal
  // fail) không được poison waitForBackend làm chết app oan giữa chừng.
  if (!backendReady) startupError = reason instanceof Error ? reason : new Error(String(reason));
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (cleanupStarted) return;
  cleanupStarted = true;
  try {
    backendRuntime?.stopManagedProcesses?.();
  } catch (err) {
    console.error('[Electron] Error stopping managed Chrome processes:', err.message);
  }
});
