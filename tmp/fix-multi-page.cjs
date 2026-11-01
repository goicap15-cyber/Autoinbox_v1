const fs = require('fs');
const P = 'src/server/services/PageApiService.js';
let src = fs.readFileSync(P, 'utf8');
const NL = src.includes('\r
') ? '\r
' : '
';

// ── 1) findAccountForPage: với hệ nhiều page / nhiều account, tra page thuộc
// app của account nào (page_api_config.apps[].pages) để gắn owner đúng người.
if (!src.includes('function findAccountForPage')) {
  const helper = [
    '// Đa page / đa account: tra pageId thuộc app của account nào (page_api_config)',
    'function findAccountForPage(pageId, database = getDb()) {',
    "  const rows = database.prepare(\"SELECT key, value FROM page_api_config WHERE key LIKE 'account:%'\").all();",
    '  for (const r of rows) {',
    '    try {',
    '      const j = JSON.parse(r.value);',
    '      for (const app of (j.apps || [])) {',
    "        if ((app.pages || []).some((p) => String(p.pageId) === String(pageId))) {",
    "          return r.key.slice('account:'.length);",
    '        }',
    '      }',
    '    } catch (_) {}',
    '  }',
  "    return null;",
    '}',
    '',
  ].join(NL);
  const anchor = 'function handleWebhookBody(body, io, database = getDb()) {';
  if (!src.includes(anchor)) { console.error('handleWebhookBody anchor not found'); process.exit(1); }
  src = src.replace(anchor, helper + NL + anchor);
}

// ── 2) handleWebhookBody: owner resolution theo thứ tự: source đã có owner →
// config tra page → duy nhất 1 account ACTIVE. Không còn rơi vào pageId làm FK.
const OLD_OWNER = [
  '    if (source && !source.owner_account_id) {',
  "      const activeAccounts = database.prepare(\"SELECT id FROM accounts WHERE status = 'ACTIVE' OR status IS NULL\").all();",
  '      if (activeAccounts.length === 1) {',
  "        database.prepare('UPDATE inbox_sources SET owner_account_id = ? WHERE id = ? AND owner_account_id IS NULL')",
  "          .run(String(activeAccounts[0].id), source.id);",
  '        source = InboxSourceService.getSourceByExternalId('page_messenger', pageId, database);',
  "        console.log(`[PageApi] 🔗 Tự gắn owner ${activeAccounts[0].id} cho page ${pageId}`);",
  '      }',
  '    }',
].join(NL);
const NEW_OWNER = [
  '    if (source && !source.owner_account_id) {',
  "      const resolved = findAccountForPage(pageId, database)",
  "        || (() => { const a = database.prepare(\"SELECT id FROM accounts WHERE status = 'ACTIVE' OR status IS NULL\").all(); return a.length === 1 ? String(a[0].id) : null; })();",
  '      if (resolved) {',
  "        database.prepare('UPDATE inbox_sources SET owner_account_id = ? WHERE id = ? AND owner_account_id IS NULL')",
  '          .run(String(resolved), source.id);',
  "        console.log(`[PageApi] 🔗 Tự gắn owner ${resolved} cho page ${pageId}`);",
  '      }',
  '    }',
].join(NL);
if (!src.includes(OLD_OWNER)) { console.error('owner block not found'); process.exit(1); }
src = src.replace(OLD_OWNER, NEW_OWNER);

// ── 3) processMessagingEvent: nhận ECHO + chống trùng thread đa page/đa account
const START = 'function processMessagingEvent(event, source, io, database) {';
const END = '// ── Poller cầu nối hosting (webhook.php) ──';
const sIdx = src.indexOf(START);
const eIdx = src.indexOf(END);
if (sIdx < 0 || eIdx < 0 || eIdx < sIdx) { console.error('processMessagingEvent markers not found', { sIdx, eIdx }); process.exit(1); }

const NEWFN = [
  'function processMessagingEvent(event, source, io, database) {',
  '  const message = event.message;',
  '  if (!message) return null;',
  '  const pageId = String(source.external_id);',
  "  const senderPsid = String(event.sender?.id || 'unknown');",
  '  const isEcho = Boolean(message.is_echo);',
  '  const isOutgoing = isEcho || senderPsid === pageId;',
  "  const contactPsid = isOutgoing ? String(event.recipient?.id || '') : senderPsid;",
  '  if (!contactPsid) return null;',
  "  const text = message.text || '';",
  '  const ts = Number(event.timestamp || Date.now());',
  '',
  '  // Đa page / đa account: cùng một khách có thể nhắn NHIỀU page (thậm chí',
  '  // qua account khác) — thread bare psid đã tồn tại ở nguồn KHÁC thì buộc',
  '  // namespacing page:<pageId>:<psid> ngay từ đầu, tránh INSERT trùng khóa.',
  "  let threadId = contactPsid;",
  '  const clash = database.prepare(',
  "    'SELECT id, source_id, account_id FROM threads WHERE id = ? OR COALESCE(external_thread_id, \'\') = ?'",
  '  ).get(contactPsid, contactPsid);',
  "  if (clash && String(clash.source_id || '') !== String(source.id)) {",
  '    threadId = `page:${pageId}:${contactPsid}`;',
  '  }',
  '',
  '  const thread = ConversationRepository.upsertThread({',
  '    id: threadId,',
  '    account_id: source.owner_account_id || pageId,',
  '    source_id: source.id,',
  '    external_thread_id: contactPsid,',
  '    contact_name: null,',
  "    last_message: (text || '[Đính kèm]').substring(0, 200),",
  '    is_unread: isOutgoing ? 0 : 1,',
  '  }, database);',
  '  if (!thread) return null;',
  '  if (!thread.source_id) {',
  "    database.prepare('UPDATE threads SET source_id = ? WHERE id = ?').run(source.id, thread.id);",
  '  }',
  '  // Thread của source thuộc về chủ hiện hành — re-point nếu trước đây bị bind',
  '  // vào account khác (account test cũ), ngược lại tin đổ vào account chết và',
  '  // inbox của account đang dùng không thấy gì.',
  '  database.prepare(',
  "    'UPDATE threads SET account_id = ? WHERE id = ? AND (account_id IS NULL OR account_id != ?)'",
  '  ).run(String(source.owner_account_id || pageId), thread.id, String(source.owner_account_id || pageId));',
  '',
  '  // ECHO = page gửi tin TRỰC TIẾP từ Messenger (không qua CRM) — phải ghi lại,',
  '  // không bỏ qua. Tin gửi TỪ CRM đã có row pending: đối soát theo nội dung',
  '  // ±5 phút rồi gắn mid thật; không khớp row nào thì ghi tin mới.',
  '  if (isEcho) {',
  '    const existing = database.prepare(`',
  "      SELECT id, fb_message_id, delivery_status FROM messages WHERE thread_id = ? AND is_outgoing = 1 AND content = ?",
  '        AND ABS(COALESCE(timestamp_ms, 0) - ?) <= 300000',
  "      ORDER BY (delivery_status = 'pending') DESC, id DESC LIMIT 1",
  '    `).get(thread.id, text, ts);',
  '    if (existing) {',
  "      if (String(existing.fb_message_id || '').startsWith('pending_') || existing.delivery_status !== 'sent') {",
  '        database.prepare(`',
  "          UPDATE messages SET fb_message_id = ?, delivery_status = 'sent', delivery_error = NULL WHERE id = ?",
  '        `).run(message.mid, existing.id);',
  '        const row = database.prepare(\'SELECT * FROM messages WHERE id = ?\').get(existing.id);',
  '        if (io) io.emit(\'NEW_MESSAGE\', { ...row, thread_id: thread.id, account_id: thread.account_id, source_id: source.id, source_type: \'page_messenger\' });',
  '      }',
  '      return null;',
  '    }',
  '  }',
  '',
  '  const insertId = insertGraphMessage(thread.id, source, {',
  '    id: message.mid,',
  '    message: text,',
  '    from: { id: senderPsid },',
  '    created_time: new Date(ts).toISOString(),',
  "    attachments: message.attachments ? { data: message.attachments.map((a) => ({",
  "      mime_type: a.type === 'image' ? 'image/*' : a.type === 'video' ? 'video/*' : a.type === 'audio' ? 'audio/*' : 'application/octet-stream',",
  '      image_url: a.payload?.url || null,',
  '      video_url: a.payload?.url || null,',
  '      audio_url: a.payload?.url || null,',
  '      file_url: a.payload?.url || null,',
  '    })) } : undefined,',
  "  }, database, { senderId: senderPsid });",
  '',
  '  if (insertId == null) return null; // trùng mid — đã có',
  '',
  '  const savedRow = database.prepare(\'SELECT * FROM messages WHERE id = ?\').get(insertId);',
  '  const messageData = {',
  '    ...savedRow,',
  '    thread_id: thread.id,',
  '    account_id: thread.account_id,',
  '    source_id: source.id,',
  "    source_type: 'page_messenger',",
  '    source_name: source.display_name,',
  '    page_id: pageId,',
  '  };',
  '  console.log(`[PageApi] 💬 Tin Page mới: mid=${message.mid} thread=${thread.id} page=${pageId}${isEcho ? \' (echo)\' : \'\'}`);',
  '  if (io) {',
  "    io.emit('NEW_MESSAGE', messageData);",
  "    io.emit('THREAD_LIST_UPDATED', { thread_id: thread.id, account_id: thread.account_id });",
  '  }',
  '  return messageData;',
  '}',
  '',
].join(NL);

src = src.slice(0, sIdx) + NEWFN + NL + src.slice(eIdx);
fs.writeFileSync(P, src);
console.log('processMessagingEvent rewritten (echo + multi-page/multi-account)');
