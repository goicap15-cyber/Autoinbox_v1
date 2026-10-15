/**
 * AutoReplyEngine.js
 * Tự động trả lời theo từ khóa kích hoạt (trigger keyword).
 * - Nhiều cụm từ khóa cho mỗi quy tắc; khi cùng khớp, cụm DÀI hơn thắng
 *   ("giá sản phẩm A" > "giá") để phân biệt sản phẩm/chủ đề.
 * - Hai tầng bật/tắt: toàn quy tắc (auto_replies.is_active) + từng cụm
 *   (auto_reply_keywords.is_active).
 * - Mỗi quy tắc chỉ trả lời 1 lần cho 1 khách (auto_reply_fired), đánh dấu
 *   chỉ khi gửi thành công.
 * - Biến cá nhân hóa: {ten_khach_hang}, {account_name}, {keyword}
 */
let db = require('../database/db');

// Chỉ dùng trong unit test: bơm DB tạm có schema giống hệt DB thật.
function _setDbForTests(testDb) { db = testDb; }

class AutoReplyEngine {
  /**
   * Kiểm tra và gửi auto-reply nếu nội dung tin nhắn khớp từ khóa.
   * @param {object} msg - Tin nhắn vừa nhận được
   * @param {function} sendFn - Hàm gửi tin nhắn: sendFn(thread_id, text)
   * @returns {boolean} true nếu đã tự động trả lời
   */
  async processIncoming(msg, sendFn) {
    if (msg.is_outgoing) return false;
    if (!msg.content) return false;

    const thread = db.prepare('SELECT * FROM threads WHERE id = ?').get(msg.thread_id);
    if (!thread) return false;

    const now = new Date();
    if (thread.ai_paused_until && new Date(thread.ai_paused_until) > now) {
      console.log(`[AutoReply] Thread ${msg.thread_id} - AI tạm dừng đến ${thread.ai_paused_until}`);
      return false;
    }

    // Lấy tất cả auto-replies đang active cho tài khoản này
    const rules = db.prepare(`
      SELECT * FROM auto_replies
      WHERE account_id = ? AND is_active = 1
    `).all(thread.account_id);

    const lowerContent = msg.content.toLowerCase().trim();
    if (!lowerContent) return false;

    // Gom MỌI cụm khớp của mọi quy tắc rồi chọn cụm DÀI nhất toàn cục —
    // không để quy tắc tạo trước che quy tắc cụ thể hơn ("giá" phải thua
    // "giá sản phẩm A" kể cả khi quy tắc "giá" nằm trước trong danh sách).
    const candidates = [];
    for (const rule of rules) {
      const keywords = db.prepare(`
        SELECT * FROM auto_reply_keywords
        WHERE auto_reply_id = ? AND is_active = 1
      `).all(rule.id);

      for (const kw of keywords) {
        const needle = String(kw.keyword || '').toLowerCase().trim();
        if (!needle) continue;
        if (!lowerContent.includes(needle)) continue;
        candidates.push({ rule, kw, needle });
      }
    }
    if (candidates.length === 0) return false;

    // Cụm dài nhất thắng; cùng độ dài thì quy tắc cũ hơn (id nhỏ hơn) thắng.
    candidates.sort((a, b) => b.needle.length - a.needle.length || a.rule.id - b.rule.id);

    for (const { rule, kw, needle } of candidates) {
      // Chỉ trả lời 1 lần cho 1 khách với mỗi quy tắc — quy tắc đã trả lời
      // rồi thì thử quy tắc khớp dài kế tiếp.
      const fired = db.prepare(
        'SELECT id FROM auto_reply_fired WHERE auto_reply_id = ? AND thread_id = ?'
      ).get(rule.id, msg.thread_id);
      if (fired) continue;

      // Cá nhân hóa template
      const response = this._interpolate(rule.response_template, {
        ten_khach_hang: thread.contact_name || 'bạn',
        account_name: this._accountName(thread.account_id),
        keyword: kw.keyword
      });

      // Đánh dấu "đã trả lời" CHỈ KHI gửi thành công: ném lỗi thì không ghi
      // nhật ký, tin nhắn kế tiếp của khách sẽ được thử lại.
      await sendFn(msg.thread_id, response);
      db.prepare(
        'INSERT OR IGNORE INTO auto_reply_fired (auto_reply_id, thread_id) VALUES (?, ?)'
      ).run(rule.id, msg.thread_id);

      console.log(`[AutoReply] Matched keyword "${kw.keyword}" → gửi tự động cho thread ${msg.thread_id}`);
      return true;
    }

    return false;
  }

  _accountName(account_id) {
    const acc = db.prepare('SELECT name FROM accounts WHERE id = ?').get(account_id);
    return (acc && acc.name) || account_id;
  }

  /**
   * Thay thế các biến trong template: {ten_khach_hang} → tên thật
   */
  _interpolate(template, vars) {
    return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] || `{${key}}`);
  }

  // ── CRUD Quản lý quy tắc Auto Reply ──

  /**
   * Tách chuỗi nhập thành danh sách cụm từ: cắt theo dấu phẩy, bỏ khoảng
   * trắng thừa, bỏ trùng (không phân biệt hoa thường) — "giá, báo giá"
   * thành ["giá", "báo giá"] thay vì 1 cụm nguyên chuỗi.
   */
  _splitKeywords(rawList) {
    const seen = new Set();
    const list = [];
    for (const raw of rawList) {
      for (const part of String(raw || '').split(',')) {
        const k = part.trim();
        if (!k) continue;
        const lower = k.toLowerCase();
        if (seen.has(lower)) continue;
        seen.add(lower);
        list.push(k);
      }
    }
    return list;
  }

  /** Tạo quy tắc mới (kèm danh sách cụm từ khóa) */
  createRule({ account_id, keywords = [], trigger_keyword = null, response_template, created_by_staff_id = null }) {
    // Client mới gửi mảng keywords; client cũ gửi trigger_keyword đơn lẻ.
    const rawList = Array.isArray(keywords) ? [...keywords] : [];
    if (rawList.length === 0 && trigger_keyword) rawList.push(trigger_keyword);
    const list = this._splitKeywords(rawList);

    if (list.length === 0) return { success: false, error: 'Cần ít nhất 1 cụm từ khóa' };
    if (!String(response_template || '').trim()) return { success: false, error: 'Nội dung phản hồi không được để trống' };
    // FK account_id → accounts(id): kiểm tra trước để trả lỗi rõ ràng thay vì
    // để SQLite ném FOREIGN KEY constraint (modal từng gửi ID mặc định giả
    // '100088912345678' → 500 im lặng, không rule nào được tạo).
    const acc = db.prepare('SELECT id FROM accounts WHERE id = ?').get(account_id);
    if (!acc) return { success: false, error: 'Tài khoản không tồn tại hoặc đã bị xóa' };

    // trigger_keyword NOT NULL — giữ cụm đầu tiên cho tương thích client cũ.
    const info = db.prepare(`
      INSERT INTO auto_replies (account_id, trigger_keyword, response_template, created_by_staff_id)
      VALUES (?, ?, ?, ?)
    `).run(account_id, list[0] || '', response_template, created_by_staff_id);

    const insertKw = db.prepare(
      'INSERT OR IGNORE INTO auto_reply_keywords (auto_reply_id, keyword) VALUES (?, ?)'
    );
    for (const kw of list) insertKw.run(info.lastInsertRowid, kw);

    return { id: info.lastInsertRowid, success: true };
  }

  /** Lấy tất cả quy tắc của một tài khoản (kèm từng cụm từ khóa) */
  getRules(account_id) {
    const rules = db.prepare('SELECT * FROM auto_replies WHERE account_id = ? ORDER BY id DESC').all(account_id);
    const keywordStmt = db.prepare(
      'SELECT id, keyword, is_active FROM auto_reply_keywords WHERE auto_reply_id = ? ORDER BY id ASC'
    );
    for (const rule of rules) {
      rule.keywords = keywordStmt.all(rule.id);
    }
    return rules;
  }

  /** Cập nhật trạng thái kích hoạt toàn quy tắc */
  toggleRule(id, is_active) {
    db.prepare('UPDATE auto_replies SET is_active = ? WHERE id = ?').run(is_active ? 1 : 0, id);
    return { success: true };
  }

  /** Xóa quy tắc (CASCADE xóa luôn từ khóa + nhật ký đã trả lời) */
  deleteRule(id) {
    db.prepare('DELETE FROM auto_replies WHERE id = ?').run(id);
    return { success: true };
  }

  // ── CRUD từng cụm từ khóa ──

  /** Thêm cụm từ khóa vào quy tắc (nhận cả chuỗi nhiều cụm cách nhau bởi dấu phẩy) */
  addKeyword(auto_reply_id, keyword) {
    const rule = db.prepare('SELECT id FROM auto_replies WHERE id = ?').get(auto_reply_id);
    if (!rule) return { success: false, error: 'Quy tắc không tồn tại' };
    let list = this._splitKeywords([keyword]);
    if (list.length === 0) return { success: false, error: 'Cụm từ khóa không được để trống' };

    // Bỏ qua cụm đã tồn tại trong quy tắc (không phân biệt hoa thường) để
    // tránh chip trùng lặp kiểu "giá" vs "GIÁ".
    const existingLower = new Set(
      db.prepare('SELECT keyword FROM auto_reply_keywords WHERE auto_reply_id = ?')
        .all(auto_reply_id)
        .map((r) => String(r.keyword).toLowerCase())
    );
    list = list.filter((k) => !existingLower.has(k.toLowerCase()));

    const insertStmt = db.prepare(
      'INSERT OR IGNORE INTO auto_reply_keywords (auto_reply_id, keyword) VALUES (?, ?)'
    );
    const selectStmt = db.prepare(
      'SELECT id, keyword, is_active FROM auto_reply_keywords WHERE auto_reply_id = ? AND keyword = ?'
    );
    const rows = [];
    for (const k of list) {
      insertStmt.run(auto_reply_id, k);
      const row = selectStmt.get(auto_reply_id, k);
      if (row) rows.push(row);
    }
    return { success: true, keywords: rows };
  }

  /** Bật/tắt một cụm từ khóa (tắt cục bộ, các cụm khác vẫn chạy) */
  toggleKeyword(id, is_active) {
    db.prepare('UPDATE auto_reply_keywords SET is_active = ? WHERE id = ?').run(is_active ? 1 : 0, id);
    return { success: true };
  }

  /** Xóa cụm từ khóa khỏi quy tắc */
  deleteKeyword(id) {
    db.prepare('DELETE FROM auto_reply_keywords WHERE id = ?').run(id);
    return { success: true };
  }
}

module.exports = new AutoReplyEngine();
module.exports._setDbForTests = _setDbForTests;
