import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, ScanSearch, RefreshCw, Send, MessageSquareDot, AlertCircle, CheckCircle2 } from 'lucide-react';

const STATUS_META = {
  new: { label: 'Chờ đưa vào', cls: 'bg-slate-700/60 text-slate-300' },
  queued: { label: 'Đang chờ gửi', cls: 'bg-amber-500/20 text-amber-300' },
  sent: { label: 'Đã gửi', cls: 'bg-sky-500/20 text-sky-300' },
  failed: { label: 'Lỗi gửi', cls: 'bg-red-500/20 text-red-300' },
  replied: { label: 'Đã trả lời', cls: 'bg-emerald-500/20 text-emerald-300' }
};

function StatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.new;
  return <span className={'inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ' + meta.cls}>{meta.label}</span>;
}

function formatDbTime(value) {
  if (!value) return '';
  const iso = String(value).includes('T') ? String(value) : String(value).replace(' ', 'T') + 'Z';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
}

export default function CommentLeadsModal({ socket, accounts = [], onClose, onSelectThread }) {
  const [config, setConfig] = useState(null);
  const [data, setData] = useState({ posts: [], leads: [] });
  const [postUrl, setPostUrl] = useState('');
  const [accountId, setAccountId] = useState('');
  const [content, setContent] = useState('Chào {ten}! Mình thấy bạn vừa bình luận bên bài viết của shop. Bạn đang quan tâm sản phẩm nào ạ?');
  const [scanState, setScanState] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [enqueuing, setEnqueuing] = useState(false);
  const pollTimerRef = useRef(null);
  const refreshTimerRef = useRef(null);
  const pollStopRef = useRef(false);

  const loadLeads = useCallback(async () => {
    try {
      const res = await fetch('/api/comment-leads');
      const json = await res.json();
      if (json.success) {
        setData({ posts: json.posts || [], leads: json.leads || [] });
        if ((json.posts || []).length) {
          setPostUrl((current) => current || json.posts[0].post_url);
        }
      }
    } catch (_) { /* poll best-effort */ }
  }, []);

  useEffect(() => {
    fetch('/api/comment-leads/config').then((r) => r.json()).then((json) => setConfig(json)).catch(() => setConfig({ success: false }));
    loadLeads();
    refreshTimerRef.current = setInterval(loadLeads, 20000);
    return () => {
      clearInterval(refreshTimerRef.current);
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      pollStopRef.current = true;
    };
  }, [loadLeads]);

  useEffect(() => {
    if (!socket) return undefined;
    const handler = () => {
      setNotice({ kind: 'ok', text: 'Có khách vừa trả lời tin nhắn chờ!' });
      loadLeads();
    };
    socket.on('COMMENT_LEAD_REPLIED', handler);
    return () => socket.off('COMMENT_LEAD_REPLIED', handler);
  }, [socket, loadLeads]);

  const autoEnqueue = useCallback(async (url) => {
    try {
      const res = await fetch('/api/comment-leads/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ post_url: url || undefined, account_id: accountId || undefined, content: content.trim() || undefined })
      });
      const json = await res.json();
      if (!json.success) {
        setNotice({ kind: 'err', text: json.error || 'Không đưa được khách vào hàng chờ.' });
      } else if (json.queued > 0) {
        setNotice({ kind: 'ok', text: `Đã đưa ${json.queued} khách vào hàng chờ, hàng đợi tự gửi dần.` });
      } else {
        setNotice({ kind: 'ok', text: 'Quét xong — không có khách mới nào chưa được đưa vào hàng chờ.' });
      }
      loadLeads();
    } catch (err) {
      setNotice({ kind: 'err', text: err.message });
    }
  }, [accountId, content, loadLeads]);

  const startPolling = useCallback((url) => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    pollStopRef.current = false;
    let ticks = 0;
    pollTimerRef.current = setInterval(async () => {
      if (pollStopRef.current) return;
      ticks += 1;
      if (ticks > 75) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
        setScanState({ kind: 'err', text: 'Quét quá lâu (hơn 10 phút). Thử bấm Quét lại sau.' });
        setBusy(false);
        return;
      }
      try {
        const res = await fetch('/api/comment-leads/fetch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ post_url: url })
        });
        const json = await res.json();
        if (!json.success) {
          clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
          setScanState({ kind: 'err', text: json.error || 'Lấy kết quả quét thất bại.' });
          setBusy(false);
          return;
        }
        if (json.state === 'idle') {
          clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
          setBusy(false);
          if (Number(json.total) > 0) {
            setScanState({ kind: 'ok', text: json.message || 'Quét xong.' });
            await autoEnqueue(url);
          } else {
            // API đôi khi báo idle sớm khi máy quét chưa kịp ghi kết quả — hỏi lại đúng 1 lần
            setScanState({ kind: 'busy', text: 'Chưa thấy bình luận nào, hỏi lại sau 15s…' });
            await new Promise((resolve) => setTimeout(resolve, 15000));
            try {
              const again = await fetch('/api/comment-leads/fetch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ post_url: url })
              });
              const againJson = await again.json();
              if (againJson.success && againJson.state === 'idle' && Number(againJson.total) > 0) {
                setScanState({ kind: 'ok', text: againJson.message || 'Quét xong.' });
                await autoEnqueue(url);
              } else {
                setScanState({ kind: 'err', text: 'API không trả về bình luận nào cho bài này (bài reel/video đôi khi không quét được user).' });
                setNotice({ kind: 'err', text: 'Không lấy được user từ API — thử quét lại hoặc dán link bài chuẩn (trạng thái bài viết).' });
              }
            } catch (_) {
              setNotice({ kind: 'err', text: 'Không hỏi lại được kết quả quét.' });
            }
          }
          loadLeads();
        } else if (json.state === 'error') {
          clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
          setScanState({ kind: 'err', text: json.message || 'Bài quét lỗi — cần quét lại.' });
          setBusy(false);
        } else {
          setScanState({ kind: 'busy', text: json.message || 'Đang quét bình luận…' });
        }
      } catch (_) { /* giữ vòng poll, lần sau thử lại */ }
    }, 8000);
  }, [autoEnqueue, loadLeads]);

  const handleScan = async () => {
    if (!postUrl.trim() || busy) return;
    setBusy(true);
    setNotice(null);
    setScanState({ kind: 'busy', text: 'Đang gửi yêu cầu quét…' });
    const url = postUrl.trim();
    try {
      const res = await fetch('/api/comment-leads/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ post_url: url })
      });
      const json = await res.json();
      if (!json.success) {
        setScanState({ kind: 'err', text: json.error || 'Quét thất bại.' });
        setBusy(false);
        return;
      }
      setScanState({ kind: 'busy', text: json.message || 'Đã tiếp nhận yêu cầu quét.' });
      startPolling(url);
    } catch (err) {
      setScanState({ kind: 'err', text: err.message });
      setBusy(false);
    }
  };

  const handleEnqueue = async () => {
    if (enqueuing) return;
    setEnqueuing(true);
    setNotice(null);
    await autoEnqueue(postUrl.trim() || undefined);
    setEnqueuing(false);
  };

  const selectedPost = (data.posts || []).find((p) => p.post_url === postUrl.trim()) || null;
  // Khách đã nhắn tin rồi (sent/replied) ẩn khỏi danh sách — row còn trong DB
  // để chống quét lại bị nhắn trùng; hội thoại của họ nằm trong CRM.
  const visibleLeads = (data.leads || []).filter((lead) => lead.status !== 'sent' && lead.status !== 'replied');

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-3xl bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <MessageSquareDot size={18} className="text-slate-300" />
            <h3 className="text-xs font-semibold text-slate-100 uppercase tracking-wider">Khách bình luận bài viết → Tin nhắn chờ</h3>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 p-1"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
          {config && config.success && !config.configured && (
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-200 flex items-start gap-2">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span>Chưa cấu hình API key Viet Seeding. Vào <b>Quản lý tài khoản → Nhập từ Viet Seeding</b> để lưu key rồi quay lại.</span>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Link bài viết</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={postUrl}
                onChange={(e) => setPostUrl(e.target.value)}
                placeholder="https://www.facebook.com/.../posts/..."
                className="flex-1 min-w-0 px-3 py-2 bg-slate-950 border border-slate-700/60 rounded-lg text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-slate-500"
              />
              <button
                type="button"
                onClick={handleScan}
                disabled={busy || !postUrl.trim()}
                className="px-3 py-2 rounded-lg text-xs font-bold bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] text-[var(--color-text-on-accent)] disabled:opacity-40 flex items-center gap-1.5 shrink-0 transition-colors"
              >
                {busy ? <RefreshCw size={13} className="animate-spin" /> : <ScanSearch size={13} />}
                <span>{busy ? 'Đang quét…' : 'Quét bình luận'}</span>
              </button>
            </div>
            {scanState && (
              <p className={'text-[11px] flex items-center gap-1.5 ' + (scanState.kind === 'ok' ? 'text-emerald-300' : scanState.kind === 'err' ? 'text-red-300' : 'text-sky-300')}>
                {scanState.kind === 'ok' ? <CheckCircle2 size={12} /> : scanState.kind === 'err' ? <AlertCircle size={12} /> : <RefreshCw size={12} className="animate-spin" />}
                {scanState.text}
              </p>
            )}
            {selectedPost && (
              <p className="text-[11px] text-slate-500">
                Bài này: {selectedPost.total} khách — mới {selectedPost.total_new}, chờ gửi {selectedPost.total_queued}, đã gửi {selectedPost.total_sent}, lỗi {selectedPost.total_failed}, đã trả lời {selectedPost.total_replied}
              </p>
            )}
            <p className="text-[10px] text-slate-600">Quét xong tự đẩy khách chưa có tin vào hàng chờ với nội dung bên dưới, tự gửi 24/7 khi Chrome của tài khoản đang chạy.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Tài khoản gửi</label>
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700/60 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-slate-500"
              >
                <option value="">— Tự chọn tài khoản đang chạy —</option>
                {(accounts || []).filter((a) => a && a.id).map((a) => (
                  <option key={a.id} value={a.id}>{a.name || a.id}{a.is_extension_connected ? '' : ' (Chrome chưa chạy)'}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Nội dung tin nhắn</label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={3}
                placeholder="Dùng {ten} để tự điền tên khách bình luận"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700/60 rounded-lg text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-slate-500 resize-none"
              />
              <p className="text-[10px] text-slate-600">Dùng {'{ten}'} để chèn tên khách vào tin.</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleEnqueue}
              disabled={enqueuing}
              className="flex-1 px-3 py-2 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-40 flex items-center justify-center gap-1.5 transition-colors"
            >
              {enqueuing ? <RefreshCw size={13} className="animate-spin" /> : <Send size={13} />}
              <span>Đưa khách mới vào hàng chờ</span>
            </button>
          </div>

          {notice && (
            <p className={'text-[11px] flex items-center gap-1.5 ' + (notice.kind === 'ok' ? 'text-emerald-300' : 'text-red-300')}>
              {notice.kind === 'ok' ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
              {notice.text}
            </p>
          )}

          <div className="border-t border-slate-800 pt-3">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Danh sách khách ({visibleLeads.length})</h4>
              <button type="button" onClick={loadLeads} className="text-[11px] text-slate-500 hover:text-slate-300 flex items-center gap-1"><RefreshCw size={11} /> Làm mới</button>
            </div>
            {data.leads.length > 0 && visibleLeads.length === 0 ? (
              <p className="text-[11px] text-slate-600 py-4 text-center">Tất cả khách đã được nhắn tin — hội thoại nằm trong CRM.</p>
            ) : visibleLeads.length === 0 ? (
              <p className="text-[11px] text-slate-600 py-4 text-center">Chưa có khách nào. Dán link bài viết rồi bấm Quét bình luận.</p>
            ) : (
              <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-800 divide-y divide-slate-800/70">
                {visibleLeads.map((lead) => (
                  <div key={lead.id} className="px-3 py-2 flex items-center gap-3 hover:bg-slate-800/40">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-slate-200 truncate">{lead.author_name || lead.author_uid}</p>
                      <p className="text-[10px] text-slate-500 truncate">UID {lead.author_uid} · {formatDbTime(lead.sent_at || lead.queued_at || lead.created_at)}</p>
                    </div>
                    {lead.thread_id && onSelectThread && (
                      <button type="button" onClick={() => onSelectThread(lead.thread_id)} className="text-[10px] text-sky-400 hover:text-sky-300 shrink-0">Mở hội thoại</button>
                    )}
                    {lead.error && <span className="text-[10px] text-red-400 truncate max-w-[180px]" title={lead.error}>{lead.error}</span>}
                    <StatusBadge status={lead.status} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
