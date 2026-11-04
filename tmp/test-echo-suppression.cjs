// Kiểm tra fix echo-suppression nuốt tin khách (reproduce 2026-10-07):
// operator gửi "alo" -> history sync batch chứa tin khách "Alo" (mid thật)
// phải được LƯU, còn bản dom_ tổng hợp (echo mislabel) phải bị skip.
const { getTestDatabase } = require('../tests/helpers/testDatabase');
const ConversationRepository = require('../src/server/repositories/ConversationRepository');

const db = getTestDatabase();
db.prepare("INSERT INTO accounts (id, name, profile_dir, status) VALUES ('acc1', 'Tester', 'profile_acc1', 'ACTIVE')").run();
db.prepare("INSERT INTO threads (id, account_id) VALUES ('t1', 'acc1')").run();
// Operator đã gửi "alo" (row outgoing thật)
db.prepare("INSERT INTO messages (thread_id, fb_message_id, sender_id, content, is_outgoing, media_type, timestamp_ms, timestamp_source, created_at) VALUES ('t1', 'mid_op_out_1', 'OP', 'alo', 1, 'text', 1759800000000, 'facebook_label', '2025-10-07T00:00:00.000Z')").run();

const mk = (over) => Object.assign({
  fb_message_id: 'mid_customer_1',
  content: 'Alo',
  is_outgoing: false,
  media_type: 'text',
  timestamp_ms: 1759803000000,
  timestamp_source: 'facebook_label',
  source: 'dom_history_sync',
  created_at: '2025-10-07T00:50:00.000Z'
}, over);

let failed = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} (got: ${JSON.stringify(actual)}, want: ${JSON.stringify(expected)})`);
}

// 1) Tin khách "Alo" với MID THẬT trong history batch -> phải được lưu
const r1 = ConversationRepository.saveMessagesTransaction('t1', [mk()], db);
const stored1 = db.prepare("SELECT * FROM messages WHERE fb_message_id = 'mid_customer_1'").get();
check('tin khách mid thật được lưu', Boolean(stored1), true);
check('lưu đúng chiều incoming', stored1 ? stored1.is_outgoing : -1, 0);
check('không bị skip', r1.skippedCount, 0);

// 2) Bản echo mislabel DOM_ tổng hợp trùng text tin operator -> bị skip
const r2 = ConversationRepository.saveMessagesTransaction('t1', [mk({ fb_message_id: 'dom_t1_hash_99_0', content: 'alo' })], db);
check('echo dom_ tổng hợp bị skip', r2.skippedCount, 1);

// 2b) MIỄN TRỪ emoji: operator từng gửi 👍 thì like 👍 dom_ của khách vẫn lưu
db.prepare("INSERT INTO messages (thread_id, fb_message_id, sender_id, content, is_outgoing, media_type, timestamp_ms, timestamp_source, created_at) VALUES ('t1', 'mid_op_like_1', 'OP', '\u{1F44D}', 1, 'text', 1759800500000, 'facebook_label', '2025-10-07T00:08:00.000Z')").run();
const r2b = ConversationRepository.saveMessagesTransaction('t1', [mk({ fb_message_id: 'dom_t1_like_1', content: '\u{1F44D}' })], db);
const storedLike = db.prepare("SELECT * FROM messages WHERE fb_message_id = 'dom_t1_like_1'").get();
check('like 👍 dom_ không bị skip (miễn trừ emoji)', r2b.skippedCount, 0);
check('like 👍 dom_ được lưu', Boolean(storedLike), true);

// 3) Gửi lại đúng mid đó lần nữa -> không tạo row thứ 2 (upsert theo mid)
ConversationRepository.saveMessagesTransaction('t1', [mk()], db);
const count1 = db.prepare("SELECT COUNT(*) c FROM messages WHERE content = 'Alo' AND is_outgoing = 0").get().c;
check('re-observed mid không nhân đôi', count1, 1);

// 4) Tin khách text KHÁC bất kỳ -> vẫn lưu bình thường (mid thật)
const r4 = ConversationRepository.saveMessagesTransaction('t1', [mk({ fb_message_id: 'mid_customer_2', content: 'alo ạ' })], db);
const stored4 = db.prepare("SELECT * FROM messages WHERE fb_message_id = 'mid_customer_2'").get();
check('tin khách khác text vẫn lưu', Boolean(stored4), true);
check('không skip tin khác', r4.skippedCount, 0);

console.log(failed === 0 ? '=> ALL PASS' : `=> ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
