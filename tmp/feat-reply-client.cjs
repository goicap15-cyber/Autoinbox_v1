const fs = require('fs');
const NL = '\r\n';
const n = (s) => s.replace(/\n/g, NL);

function patch(file, name, from, to) {
  let src = fs.readFileSync(file, 'utf8');
  const f = n(from);
  const t = n(to);
  const count = src.split(f).length - 1;
  if (count !== 1) {
    console.log(`MISS/DUP ${name}: ${count} occurrences`);
    process.exit(1);
  }
  src = src.replace(f, t);
  fs.writeFileSync(file, src);
  console.log('OK', name);
}

const BUBBLE = 'C:/Users/Admin/Downloads/Duan/CRM_FB1/src/client/components/MessageBubble.jsx';
const LIST = 'C:/Users/Admin/Downloads/Duan/CRM_FB1/src/client/components/MessageList.jsx';
const APP = 'C:/Users/Admin/Downloads/Duan/CRM_FB1/src/client/App.jsx';

// ---- MessageBubble.jsx ----
patch(BUBBLE, 'bubble import Reply',
`import { AlertTriangle, Check, CheckCheck, RefreshCw, Loader2, Phone, Video, PhoneMissed, PhoneCall, PhoneIncoming } from 'lucide-react';`,
`import { AlertTriangle, Check, CheckCheck, RefreshCw, Loader2, Phone, Video, PhoneMissed, PhoneCall, PhoneIncoming, Reply } from 'lucide-react';`);

patch(BUBBLE, 'bubble signature onReply',
`export default function MessageBubble({ msg, activeThread, onRetry, isLastSeenByCustomer = false }) {`,
`export default function MessageBubble({ msg, activeThread, onRetry, onReply, isLastSeenByCustomer = false }) {`);

patch(BUBBLE, 'bubble reply button in meta row',
`          {isOutgoing && <span className="font-medium">{senderName}</span>}`,
`          {onReply && status !== 'sending' && status !== 'pending' && status !== 'failed' && (
            <button
              type="button"
              onClick={(event) => { event.stopPropagation(); onReply(msg); }}
              className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[11px] font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-bg-panel)] hover:text-[var(--color-text-primary)]"
              title="Trả lời tin nhắn này"
            >
              <Reply size={12} />
              Trả lời
            </button>
          )}
          {isOutgoing && <span className="font-medium">{senderName}</span>}`);

// ---- MessageList.jsx ----
patch(LIST, 'list signature',
`export default function MessageList({ messages = [], activeThread, onSyncThread, onRetryMessage, onViewportScroll, historySyncing = false, jumpToDate = null }) {`,
`export default function MessageList({ messages = [], activeThread, onSyncThread, onRetryMessage, onReplyMessage, onViewportScroll, historySyncing = false, jumpToDate = null }) {`);

patch(LIST, 'list pass onReply',
`                    <MessageBubble msg={msg} activeThread={activeThread} onRetry={onRetryMessage} />`,
`                    <MessageBubble msg={msg} activeThread={activeThread} onRetry={onRetryMessage} onReply={onReplyMessage} />`);

// ---- App.jsx ----
patch(APP, 'app import X',
`import { MessageSquare } from 'lucide-react';`,
`import { MessageSquare, X } from 'lucide-react';`);

patch(APP, 'app reply state + handler',
`  const requestThreadMessageSync = useCallback((threadId, direction = 'initial', scrollDelta = 0) => {`,
`  // Tra loi 1 tin cu the kieu Messenger: bubble -> state nay -> composer.
  const [replyTo, setReplyTo] = useState(null);
  useEffect(() => { setReplyTo(null); }, [activeThreadId]);

  const handleStartReply = (msg) => {
    if (!msg) return;
    const isOut = msg.is_outgoing === true || msg.is_outgoing === 1 || String(msg.is_outgoing || '').toLowerCase() === 'true' || String(msg.is_outgoing || '') === '1' || msg.from === 'me' || msg.sender_type === 'staff' || msg.sender_type === 'ai';
    const rawFbId = String(msg.fb_message_id || '');
    const contactName = msg.sender_name || (threads || []).find((t) => String(t.id) === String(activeThreadId || ''))?.contact_name || 'Khách';
    setReplyTo({
      threadId: String(activeThreadId || ''),
      fb_message_id: rawFbId && !/^(pending_|retry_|call_)/.test(rawFbId) ? rawFbId : null,
      snippet: String(msg.content || '').slice(0, 300),
      media_type: String(msg.media_type || msg.attachment?.media_type || 'text'),
      sender_label: isOut ? 'Bạn' : contactName
    });
  };

  const requestThreadMessageSync = useCallback((threadId, direction = 'initial', scrollDelta = 0) => {`);

patch(APP, 'app socket emit reply_to',
`    if (socket) {
      socket.emit('SEND_MESSAGE', {
        // Plain text uses the low-latency direct Messenger path. Rich-message
        // queueing is reserved for attachments, which need integrity tracking.
        contract_version: payload.attachment_id || payload.attachment ? 2 : 1,
        thread_id: threadIdStr,
        client_message_id: payload.client_message_id,
        content: outboundContent,
        attachment_id: payload.attachment_id
      });
      return;
    }`,
`    if (socket) {
      // Tra loi 1 tin cu the: chi duong text thuan (attachment di queue rieng,
      // chua ho tro quote). Retry khong mang reply de tranh quote sot luot truoc.
      const replyInfo = (!(legacyClientMessageId || '').startsWith('retry_') && replyTo
        && String(replyTo.threadId) === threadIdStr
        && !hasAttachment
        && (replyTo.fb_message_id || replyTo.snippet)) ? {
        fb_message_id: replyTo.fb_message_id || null,
        snippet: replyTo.snippet || '',
        media_type: replyTo.media_type || 'text',
        sender_label: replyTo.sender_label || ''
      } : null;
      socket.emit('SEND_MESSAGE', {
        // Plain text uses the low-latency direct Messenger path. Rich-message
        // queueing is reserved for attachments, which need integrity tracking.
        contract_version: payload.attachment_id || payload.attachment ? 2 : 1,
        thread_id: threadIdStr,
        client_message_id: payload.client_message_id,
        content: outboundContent,
        attachment_id: payload.attachment_id,
        reply_to: replyInfo
      });
      setReplyTo(null);
      return;
    }`);

patch(APP, 'app MessageList onReplyMessage',
`              onRetryMessage={handleRetryMessage}`,
`              onRetryMessage={handleRetryMessage}
              onReplyMessage={handleStartReply}`);

patch(APP, 'app reply bar above composer',
`            {['MESSAGE_REQUEST_SPAM', 'MESSAGE_REQUEST_POSSIBLE'].includes(selectedThread.inbox_folder) ? (`,
`            {replyTo && (
              <div className="flex items-center gap-2 border-t border-[var(--color-border)] bg-[var(--color-bg-panel)] px-3 py-1.5 text-xs">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-[var(--color-text-primary)]">Đang trả lời {replyTo.sender_label}</div>
                  <div className="truncate text-[var(--color-text-muted)]">
                    {replyTo.media_type === 'image' ? 'Hình ảnh'
                      : replyTo.media_type === 'video' ? 'Video'
                      : replyTo.media_type === 'file' || replyTo.media_type === 'audio' ? 'Tệp đính kèm'
                      : (replyTo.snippet || 'Tin nhắn')}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setReplyTo(null)}
                  className="rounded p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
                  aria-label="Bỏ trả lời"
                >
                  <X size={14} />
                </button>
              </div>
            )}
            {['MESSAGE_REQUEST_SPAM', 'MESSAGE_REQUEST_POSSIBLE'].includes(selectedThread.inbox_folder) ? (`);

console.log('ALL CLIENT PATCHES DONE');
