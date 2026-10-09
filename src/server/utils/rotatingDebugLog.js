'use strict';

const fs = require('fs');

const counters = new Map();

// Ghi 1 dòng vào file debug, tự đổi tên file cũ thành `.1` khi vượt ngưỡng —
// chặn log debug phình vô hạn (composer-debug.log từng lên 815MB) và giảm áp
// lực ghi đồng bộ lên event loop. appendFileSync mở/đóng file mỗi lần nên
// rename giữa 2 lần ghi là an toàn.
function appendRotating(filePath, line, maxBytes = 50 * 1024 * 1024) {
  try {
    const key = String(filePath);
    if (!counters.has(key)) {
      try {
        counters.set(key, fs.statSync(key).size);
      } catch (_) {
        counters.set(key, 0);
      }
    }
    const next = counters.get(key) + Buffer.byteLength(line);
    if (next > maxBytes) {
      try {
        if (fs.existsSync(key + '.1')) fs.rmSync(key + '.1');
        if (fs.existsSync(key)) fs.renameSync(key, key + '.1');
      } catch (_) {}
      counters.set(key, Buffer.byteLength(line));
    } else {
      counters.set(key, next);
    }
    fs.appendFileSync(key, line);
  } catch (_) {}
}

module.exports = { appendRotating };
