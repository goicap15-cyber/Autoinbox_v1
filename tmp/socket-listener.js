const { io } = require('C:/Users/Admin/Downloads/Duan/CRM_FB1/node_modules/socket.io-client');
const fs = require('fs');
const out = fs.createWriteStream('/tmp/socket-listener.log', { flags: 'a' });
const log = (...a) => { const line = `[${new Date().toISOString()}] ${a.join(' ')}`; console.log(line); out.write(line + '\n'); };

const WATCH = ['NEW_MESSAGE', 'THREAD_MESSAGES_UPDATED', 'THREAD_MESSAGES_SYNCED', 'THREADS_SYNCED',
  'THREAD_UNREAD_CHANGED', 'MESSAGE_SENT', 'THREAD_SEEN', 'THREAD_HISTORY_COMPLETED',
  'THREAD_LIST_UPDATED', 'INBOX_SOURCE_UPDATED', 'EXTENSION_CONNECTION_CHANGED', 'BULK_HISTORY_SYNC_PROGRESS',
  'CAMPAIGN_RESPONSE_UPDATED', 'PHONE_CAPTURED'];

const cookie = process.env.CRM_COOKIE || '';
const socket = io('http://127.0.0.1:5050', {
  transports: ['websocket', 'polling'],
  extraHeaders: cookie ? { Cookie: cookie } : {}
});
socket.on('connect', () => log('CONNECTED id=' + socket.id));
socket.on('disconnect', (r) => log('DISCONNECTED', r));
socket.on('connect_error', (e) => log('CONNECT_ERROR', e.message));

for (const ev of WATCH) {
  socket.on(ev, (payload) => {
    try {
      let summary;
      if (ev === 'THREAD_MESSAGES_UPDATED') {
        const msgs = payload?.messages || [];
        const types = {};
        for (const m of msgs) types[m.media_type || 'text'] = (types[m.media_type || 'text'] || 0) + 1;
        const incoming = msgs.filter(m => !m.is_outgoing).length;
        summary = `thread=${payload.thread_id} count=${msgs.length} incoming=${incoming} types=${JSON.stringify(types)} authoritative=${payload.authoritative} sync_status=${payload.sync_status || ''} sync_error=${payload.sync_error || ''}`;
      } else if (ev === 'NEW_MESSAGE') {
        summary = `thread=${payload.thread_id} fb_id=${payload.fb_message_id} out=${payload.is_outgoing} type=${payload.media_type} content="${String(payload.content || '').slice(0, 50)}"`;
      } else if (ev === 'THREADS_SYNCED') {
        summary = `count=${payload?.threads?.length ?? payload?.length ?? '?'}`;
      } else if (ev === 'THREAD_SEEN') {
        summary = `thread=${payload.thread_id} last_seen=${payload.last_seen_message_id}`;
      } else {
        summary = JSON.stringify(payload).slice(0, 300);
      }
      log('EVENT', ev, '|', summary);
    } catch (e) { log('EVENT', ev, '| parse-error', e.message); }
  });
}
log('listener started');
