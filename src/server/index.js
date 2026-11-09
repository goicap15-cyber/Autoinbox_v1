const serverRuntime = require('./server');

// Lưới sống sót cho lỗi rác từ nội bộ Node: assert(!this.paused) của undici
// (nodejs/node#51790) ném từ handler socket TLS khi AbortSignal.timeout đụng
// socket-end — không đi qua try/catch/Promise nào của app, từng giết cả
// process lúc mới mở (2026-11-05, log user cung cấp). Log rồi sống tiếp,
// trùng hành vi lưới của electron.js — guard để không đăng ký đôi bên Electron.
if (process.listenerCount('uncaughtException') === 0) {
  process.on('uncaughtException', (err) => {
    console.error(`[uncaughtException] ${new Date().toISOString()} ${err?.stack || err}`);
  });
}
if (process.listenerCount('unhandledRejection') === 0) {
  process.on('unhandledRejection', (reason) => {
    console.error(`[unhandledRejection] ${new Date().toISOString()} ${reason instanceof Error ? (reason.stack || reason) : reason}`);
  });
}

console.log('=== KHOI DONG HE THONG AUTOCHATBOT FB CRM BACKEND ===');
const startupPromise = serverRuntime.startServer();

module.exports = { ...serverRuntime, startupPromise };
