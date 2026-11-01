const { io } = require('socket.io-client');
const socket = io('http://127.0.0.1:5050', {
  transports: ['websocket'],
  extraHeaders: { Cookie: 'crm_session=LXkAInlZg7SaW0w2PreU7MzLVXlaYE_F45hKinhmD6M' }
});
const THREADS = ['100010068667322'];
socket.on('connect', () => {
  console.log('connected', socket.id);
  for (const tid of THREADS) {
    socket.emit('REQUEST_SYNC_THREAD_MESSAGES', { thread_id: tid, direction: 'initial', scroll_delta: 0 });
    console.log('emitted for', tid);
  }
  setTimeout(() => { console.log('done'); process.exit(0); }, 8000);
});
socket.on('connect_error', (e) => { console.error('connect_error', e.message); process.exit(1); });
setTimeout(() => { console.error('timeout'); process.exit(1); }, 12000);
