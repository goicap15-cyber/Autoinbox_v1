function processMessagingEvent(event, source, io, database) {
  const message = event.message;
  if (!message) return null;
  const pageId = String(source.external_id);
  const senderPsid = String(event.sender?.id || 'unknown');
  const isEcho = Boolean(message.is_echo);
  const isOutgoing = isEcho || senderPsid === pageId;
  const contactPsid = isOutgoing ? String(event.recipient?.id || '') : senderPsid;
  if (!contactPsid) return null;
  const text = message.text || '';
  const ts = Number(event.timestamp || Date.now());

  // Đa page / đa account: cùng một khách có thể nhắn NHIỀU page (thậm chí
  // qua account khác) — thread bare psid đã tồn tại ở nguồn KHÁC thì buộc
  // namespacing page:<pageId>:<psid> ngay từ đầu, tránh INSERT trùng khóa.
  let threadId = contactPsid;
  const clash = database.prepare(
    "SELECT id, source_id, account_id FROM threads WHERE id = ? OR COALESCE(external_thread_id, '') = ?"
  ).get(contactPsid, contactPsid);
  if (clash && String(clash.source_id || '') !== String(source.id)) {
    threadId = 'page:' + pageId + ':' + contactPsid;
  }

  const thread = ConversationRepository.upsertThread({
    id: threadId,
    account_id: source.owner_account_id || pageId,
    source_id: source.id,
    external_thread_id: contactPsid,
    contact_name: null,
    last_message: (text || '[Đính kèm]').substring(0, 200),
    is_unread: isOutgoing ? 0 : 1,
  }, database);
  if (!thread) return null;
  if (!thread.source_id) {
    database.prepare('UPDATE threads SET source_id = ? WHERE id = ?').run(source.id, thread.id);
  }
  // Thread của source thuộc về chủ hiện hành — re-point nếu trước đây bị bind
  // vào account khác (account test cũ), ngược lại tin đổ vào account chết và
  // inbox của account đang dùng không thấy gì.
  database.prepare(
    'UPDATE threads SET account_id = ? WHERE id = ? AND (account_id IS NULL OR account_id != ?)'
  ).run(String(source.owner_account_id || pageId), thread.id, String(source.owner_account_id || pageId));

  // ECHO = page gửi tin TRỰC TIẾP từ Messenger (không qua CRM) — phải ghi lại,
  // không bỏ qua. Tin gửi TỪ CRM đã có row pending: đối soát theo nội dung
  // ±5 phút rồi gắn mid thật; không khớp row nào thì ghi tin mới.
  if (isEcho) {
    const existing = database.prepare(`
      SELECT id, fb_message_id, delivery_status FROM messages WHERE thread_id = ? AND is_outgoing = 1 AND content = ?
        AND ABS(COALESCE(timestamp_ms, 0) - ?) <= 300000
      ORDER BY (delivery_status = 'pending') DESC, id DESC LIMIT 1
    `).get(thread.id, text, ts);
    if (existing) {
      if (String(existing.fb_message_id || '').startsWith('pending_') || existing.delivery_status !== 'sent') {
        database.prepare(`
          UPDATE messages SET fb_message_id = ?, delivery_status = 'sent', delivery_error = NULL WHERE id = ?
        `).run(message.mid, existing.id);
        const row = database.prepare('SELECT * FROM messages WHERE id = ?').get(existing.id);
        if (io) io.emit('NEW_MESSAGE', { ...row, thread_id: thread.id, account_id: thread.account_id, source_id: source.id, source_type: 'page_messenger' });
      }
      return null;
    }
  }

  const insertId = insertGraphMessage(thread.id, source, {
    id: message.mid,
    message: text,
    from: { id: senderPsid },
    created_time: new Date(ts).toISOString(),
    attachments: message.attachments ? { data: message.attachments.map((a) => ({
      mime_type: a.type === 'image' ? 'image/*' : a.type === 'video' ? 'video/*' : a.type === 'audio' ? 'audio/*' : 'application/octet-stream',
      image_url: a.payload?.url || null,
      video_url: a.payload?.url || null,
      audio_url: a.payload?.url || null,
      file_url: a.payload?.url || null,
    })) } : undefined,
  }, database, { senderId: senderPsid });

  if (insertId == null) return null; // trùng mid — đã có

  const savedRow = database.prepare('SELECT * FROM messages WHERE id = ?').get(insertId);
  const messageData = {
    ...savedRow,
    thread_id: thread.id,
    account_id: thread.account_id,
    source_id: source.id,
    source_type: 'page_messenger',
    source_name: source.display_name,
    page_id: pageId,
  };
  console.log('[PageApi] 💬 Tin Page mới: mid=' + message.mid + ' thread=' + thread.id + ' page=' + pageId + (isEcho ? ' (echo)' : ''));
  if (io) {
    io.emit('NEW_MESSAGE', messageData);
    io.emit('THREAD_LIST_UPDATED', { thread_id: thread.id, account_id: thread.account_id });
  }
  return messageData;
}

