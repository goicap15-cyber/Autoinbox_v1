import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  X, RefreshCw, Check, Search, Layers, AlertCircle, CheckCircle2,
  Rocket, KeyRound, Database, Lock, Send, Trash2, Copy, ClipboardPaste, FolderSync
} from 'lucide-react';
import ConfirmModal from './ConfirmModal';

// Modal Fanpage — chạy bằng Messenger Platform chính thức của Meta:
// "Tạo app & Webhook" (tự động hóa trên developers.facebook.com) → page token →
// nhận/gửi tin nhắn qua Graph API + cầu nối webhook.php trên hosting.
// Đường cũ (quét/mở tab Business Suite qua extension) đã ngừng sử dụng.
export default function PageSelectorModal({ account, onClose, onSourcesChanged, socket }) {
  const accountId = String(account?.id || '');
  const [pages, setPages] = useState([]);
  const [app, setApp] = useState(null);
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Cấu hình cầu nối hosting + verify token
  const [bridgeUrl, setBridgeUrl] = useState('');
  const [verifyToken, setVerifyToken] = useState('');
  const [savingBridge, setSavingBridge] = useState(false);

  // Trạng thái job tự động hóa
  const [job, setJob] = useState(null); // {sync_id, status, message, error, kind}
  const [busy, setBusy] = useState(false);
  const [needsBackendRestart, setNeedsBackendRestart] = useState(false);

  // Popup mật khẩu (Facebook re-auth) + popup đăng ký developer
  const [pwd, setPwd] = useState('');
  const [regInfo, setRegInfo] = useState({ country: 'Việt Nam', phone: '' });
  const [regCode, setRegCode] = useState('');
  const [needEmail, setNeedEmail] = useState('');

  // Popup khai báo Tên ứng dụng + Email liên hệ trước khi tạo
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createName, setCreateName] = useState('CRM Page');
  const [createEmail, setCreateEmail] = useState('');

  // Popup chọn app trước khi đồng bộ page — bấm Đồng ý mới chạy với app đã chọn
  const [showAppPicker, setShowAppPicker] = useState(false);
  const [pickerAppId, setPickerAppId] = useState('');

  // Xóa app Facebook (kèm dọn token page của account) — lưu cả OBJECT app đang
  // chọn xóa vì giờ popup liệt kê ĐỦ các app, không chỉ app mới nhất
  const [appToDelete, setAppToDelete] = useState(null);
  const [deletingApp, setDeletingApp] = useState(false);

  // Token tools: copy token từng page + dán token NGOÀI để nhận diện & đồng bộ
  const [copiedPageId, setCopiedPageId] = useState('');
  const [importText, setImportText] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState(null);

  const jobRef = useRef(null);
  jobRef.current = job;

  const loadPages = async () => {
    if (!accountId) return;
    try {
      const res = await fetch(`/api/page-api/accounts/${encodeURIComponent(accountId)}/pages`);
      const data = await res.json();
      if (res.ok && data.success) {
        setPages(data.pages || []);
        setApp(data.app || null);
        setApps(data.apps || (data.app ? [data.app] : []));
        const pre = new Set();
        (data.pages || []).forEach((p) => { if (p.has_token) pre.add(String(p.page_id)); });
        setSelectedIds(pre);
      } else {
        setErrorMsg(data.error || 'Không thể tải danh sách Fanpage');
      }
    } catch (err) {
      setErrorMsg(err.message || 'Lỗi kết nối khi tải danh sách Fanpage');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyPageToken = async (page) => {
    try {
      await navigator.clipboard.writeText(String(page.token || ''));
      setCopiedPageId(String(page.page_id));
      setTimeout(() => setCopiedPageId((cur) => (cur === String(page.page_id) ? '' : cur)), 1600);
    } catch (_) {}
  };

  const handleImportTokens = async () => {
    const text = importText.trim();
    if (!text || importing) return;
    setImporting(true);
    setImportResults(null);
    try {
      const res = await fetch('/api/page-api/import-tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokens: text, account_id: accountId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.error || `HTTP ${res.status}`);
      setImportResults(data.results || []);
      await loadPages();
      if (onSourcesChanged) onSourcesChanged();
    } catch (e) {
      setImportResults([{ token: '', status: 'error', error: e.message }]);
    } finally {
      setImporting(false);
    }
  };

  const loadConfig = async () => {
    try {
      const res = await fetch('/api/page-api/config');
      const data = await res.json();
      if (res.ok && data.success) {
        setBridgeUrl(data.bridge_url || '');
        setVerifyToken(data.verify_token || '');
      }
    } catch (_) { /* im lặng — hiển thị rỗng */ }
  };

  const pollStatus = async () => {
    try {
      const curSyncId = jobRef.current?.sync_id || '';
      const qs = curSyncId ? `?sync_id=${encodeURIComponent(curSyncId)}` : '';
      const res = await fetch(`/api/page-api/sync-status${qs}`);
      const data = await res.json();
      if (res.ok && data.success) {
        const j = data.job;
        if (!j) { setJob(null); return null; }
        if (j.account_id && String(j.account_id) !== accountId) { return null; }
        setJob(j);
        if (['success', 'error'].includes(j.status)) {
          loadPages();
          onSourcesChanged?.();
          if (j.status === 'success') setSuccessMsg(j.message || 'Hoàn tất.');
          if (j.status === 'error') setErrorMsg(j.error || j.message || 'Lỗi không rõ.');
          setTimeout(() => setJob(null), 4000);
        }
        return j;
      }
    } catch (_) {}
    return null;
  };

  useEffect(() => {
    loadPages();
    loadConfig();
    fetch('/api/health')
      .then((r) => r.json())
      .then((d) => {
        const rv = String(d?.runtime_version || '').trim();
        if (!rv) {
          setNeedsBackendRestart(true);
          return;
        }
        const parts = rv.split('.').map((n) => parseInt(n, 10) || 0);
        const target = [1, 0, 29];
        for (let i = 0; i < 3; i++) {
          if ((parts[i] || 0) > target[i]) { setNeedsBackendRestart(false); return; }
          if ((parts[i] || 0) < target[i]) { setNeedsBackendRestart(true); return; }
        }
        setNeedsBackendRestart(false);
      })
      .catch(() => {});
  }, [accountId]);

  // Realtime: trạng thái job từ socket.io + fallback poll khi job đang chạy
  useEffect(() => {
    if (!socket) return;
    const onStatus = (data) => {
      if (!data || (data.account_id && String(data.account_id) !== accountId)) return;
      setJob(data);
      if (['success', 'error'].includes(data.status)) {
        loadPages();
        onSourcesChanged?.();
        if (data.status === 'success') setSuccessMsg(data.message || 'Hoàn tất.');
        if (data.status === 'error') setErrorMsg(data.error || data.message || 'Lỗi không rõ.');
        setTimeout(() => setJob(null), 4000);
      }
    };
    socket.on('PAGE_API_SETUP_STATUS', onStatus);
    return () => socket.off('PAGE_API_SETUP_STATUS', onStatus);
  }, [socket, accountId]);

  useEffect(() => {
    if (!job || ['success', 'error'].includes(job.status)) return;
    const t = setInterval(pollStatus, 3000);
    return () => clearInterval(t);
  }, [job?.sync_id, job?.status]);

  // Thông báo thành công tự tắt sau 8s (yêu cầu 2026-10-08: hiện xong đừng
  // đứng mãi trong modal) — muốn tắt sớm thì bấm dấu X trên banner.
  useEffect(() => {
    if (!successMsg) return;
    const t = setTimeout(() => setSuccessMsg(''), 8000);
    return () => clearTimeout(t);
  }, [successMsg]);

  // Bấm "Tạo app & Webhook" → mở popup khai báo tên + email
  const handleCreateApp = () => {
    setErrorMsg(''); setSuccessMsg('');
    setShowCreateForm(true);
  };

  // Trong popup: bấm "Bắt đầu tạo" → gọi backend chạy tự động hóa
  const submitCreateApp = async () => {
    const appName = createName.trim();
    if (!appName) { setErrorMsg('Nhập Tên ứng dụng trước.'); return; }
    setErrorMsg('');
    setBusy(true);
    try {
      const res = await fetch(`/api/page-api/accounts/${encodeURIComponent(accountId)}/create-app`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appName, email: createEmail.trim() })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Không thể bắt đầu tạo app');
      setShowCreateForm(false);
      setJob({ sync_id: data.sync_id, status: 'starting', message: 'Đang mở Chrome tự động hóa…' });
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setBusy(false);
    }
  };

  // "Đồng bộ" — mở popup chọn app muốn dùng để đồng bộ page (mặc định chọn sẵn
  // app đang dùng). Chốt chọn rồi mới gọi backend quét page trong ĐÚNG app đó.
  const handleSyncPages = () => {
    setErrorMsg(''); setSuccessMsg('');
    setPickerAppId(app?.app_id ? String(app.app_id) : '');
    setShowAppPicker(true);
  };

  const confirmSyncPages = async () => {
    if (!pickerAppId) { setErrorMsg('Hãy chọn một app trước.'); return; }
    setErrorMsg(''); setSuccessMsg('');
    setBusy(true);
    try {
      const res = await fetch(`/api/page-api/accounts/${encodeURIComponent(accountId)}/sync-pages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: pickerAppId })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Không thể bắt đầu đồng bộ page');
      setShowAppPicker(false);
      setJob({ sync_id: data.sync_id, kind: 'sync-pages', status: 'starting', message: 'Đang mở Chrome quét danh sách page…' });
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setBusy(false);
    }
  };

  // "Đồng bộ app": mở developers.facebook.com/apps/ quét MỌI app của tài khoản
  // (kể cả app tạo ngoài CRM) → gộp vào box "App đã tạo" của modal
  const handleSyncApps = async () => {
    setErrorMsg(''); setSuccessMsg('');
    setBusy(true);
    try {
      const res = await fetch(`/api/page-api/accounts/${encodeURIComponent(accountId)}/sync-apps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Không thể bắt đầu đồng bộ app');
      setJob({ sync_id: data.sync_id, kind: 'sync-apps', status: 'starting', message: 'Đang mở Chrome quét danh sách app…' });
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Bấm "Lấy token & Đăng ký" cho app hiện có (chọn page nào thì xử lý page đó, không chọn = tất cả)
  const handlePageSetup = async () => {
    setErrorMsg(''); setSuccessMsg('');
    setBusy(true);
    try {
      const res = await fetch(`/api/page-api/accounts/${encodeURIComponent(accountId)}/page-setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: app?.app_id, pageIds: Array.from(selectedIds) })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Không thể bắt đầu lấy token');
      setJob({ sync_id: data.sync_id, status: 'starting', message: 'Đang mở Chrome tự động hóa…' });
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Lấy hội thoại cũ về CRM (bằng page token, qua Graph API)
  const handleBackfill = async () => {
    setErrorMsg(''); setSuccessMsg('');
    setBusy(true);
    try {
      const res = await fetch(`/api/page-api/accounts/${encodeURIComponent(accountId)}/backfill`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Backfill thất bại');
      const okCount = (data.results || []).filter((r) => r.ok).length;
      setSuccessMsg(`Đã đồng bộ hội thoại cho ${okCount}/${(data.results || []).length} page.`);
      onSourcesChanged?.();
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Xóa app Facebook qua Chrome tự động hóa (menu ⋯ → Gỡ ứng dụng)
  const handleDeleteApp = async () => {
    setErrorMsg(''); setSuccessMsg('');
    setDeletingApp(true);
    try {
      const res = await fetch(`/api/page-api/accounts/${encodeURIComponent(accountId)}/delete-app`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: appToDelete?.app_id || app?.app_id })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Không thể bắt đầu xóa app');
      setAppToDelete(null);
      setJob({ sync_id: data.sync_id, status: 'starting', message: 'Đang mở Chrome để gỡ ứng dụng…' });
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setDeletingApp(false);
    }
  };

  const handleSaveBridge = async () => {
    setErrorMsg(''); setSuccessMsg('');
    setSavingBridge(true);
    try {
      const res = await fetch('/api/page-api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bridge_url: bridgeUrl })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Không lưu được URL');
      setBridgeUrl(data.bridge_url || '');
      setSuccessMsg('Đã lưu URL cầu nối hosting.');
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setSavingBridge(false);
    }
  };

  const submitPassword = async () => {
    if (!job?.sync_id || !pwd) return;
    await fetch('/api/page-api/submit-password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sync_id: job.sync_id, password: pwd })
    });
    setPwd('');
  };

  const submitRegister = async (type, value) => {
    if (!job?.sync_id) return;
    await fetch('/api/page-api/register-input', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sync_id: job.sync_id, type, value })
    });
  };

  const resendSms = async () => {
    if (!job?.sync_id) return;
    await fetch('/api/page-api/resend-sms', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sync_id: job.sync_id })
    });
  };

  const cancelJob = async () => {
    if (!job?.sync_id) return;
    await fetch('/api/page-api/sync-cancel', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sync_id: job.sync_id })
    });
    setJob(null);
  };

  // Toggle chọn 1 page
  const handleToggleSelect = (pageId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(pageId)) next.delete(pageId); else next.add(pageId);
      return next;
    });
  };

  const filteredPages = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return pages;
    return pages.filter((p) =>
      String(p.name || '').toLowerCase().includes(q) ||
      String(p.page_id || '').toLowerCase().includes(q)
    );
  }, [pages, searchQuery]);

  const allFilteredSelected = useMemo(() => {
    if (filteredPages.length === 0) return false;
    return filteredPages.every((p) => selectedIds.has(String(p.page_id)));
  }, [filteredPages, selectedIds]);

  const handleToggleSelectAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) filteredPages.forEach((p) => next.delete(String(p.page_id)));
      else filteredPages.forEach((p) => next.add(String(p.page_id)));
      return next;
    });
  };

  // Click nền đen ngoài modal: chỉ cho đóng khi KHÔNG có popup/job đang chạy
  // (trước đây bấm nhầm là tắt mất popup tạo app giữa chừng — báo lỗi 2026-10-05)
  const handleBackdrop = () => {
    if (jobRunning || showCreateForm || showAppPicker || busy) return;
    onClose();
  };

  // App được chọn để đồng bộ page lần gần nhất (lastPageSyncAt mới nhất) —
  // vẽ viền nhận biết trong box "App đã tạo"
  const pageSyncAppId = useMemo(() => {
    let best = null;
    let bestT = '';
    for (const a of apps) {
      const t = String(a.last_page_sync_at || '');
      if (t && t > bestT) { bestT = t; best = String(a.app_id); }
    }
    return best;
  }, [apps]);

  const jobRunning = job && !['success', 'error'].includes(job.status);
  const tokenedCount = pages.filter((p) => p.has_token).length;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4 backdrop-blur-sm" onClick={handleBackdrop}>
      <div
        className="w-full max-w-3xl bg-[var(--color-bg-panel,#0f1b2b)] border border-[var(--color-border,#284057)] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh] animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border,#284057)] bg-[var(--color-bg-surface,#132235)]">
          <div className="flex items-center gap-3 min-w-0">
            <div className="relative w-9 h-9 shrink-0 overflow-hidden rounded-full bg-[var(--color-bg-elevated,#172b42)] border border-[var(--color-border,#284057)] flex items-center justify-center text-xs font-bold text-[var(--color-text-primary,#f8fafc)]">
              {(account?.name || 'F').charAt(0).toUpperCase()}
              {account?.avatar_url && (
                <img src={account.avatar_url} alt="" className="absolute inset-0 h-full w-full object-cover"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }} />
              )}
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-[var(--color-text-primary,#f8fafc)] truncate">
                Fanpage của {account?.name || 'tài khoản Facebook'}
              </h3>
              <p className="text-[11px] text-[var(--color-text-muted,#7f95aa)] truncate mt-0.5">
                Kết nối qua Messenger Platform — app & webhook tự tạo, tin nhắn chạy API chính thức
              </p>
            </div>
          </div>
          <button onClick={onClose}
            className="text-[var(--color-text-muted,#7f95aa)] hover:text-[var(--color-text-primary,#f8fafc)] p-1.5 rounded-lg hover:bg-[var(--color-bg-elevated,#172b42)] transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Cấu hình cầu nối hosting */}
        <div className="px-5 py-3 border-b border-[var(--color-border,#284057)] bg-[var(--color-bg-panel,#0f1b2b)] space-y-2">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={bridgeUrl}
              onChange={(e) => setBridgeUrl(e.target.value)}
              placeholder="https://ten-mien-cua-ban/webhook.php"
              className="flex-1 bg-[var(--color-bg-surface,#132235)] border border-[var(--color-border,#284057)] rounded-xl px-3 py-1.5 text-xs text-[var(--color-text-primary,#f8fafc)] placeholder:text-[var(--color-text-muted,#7f95aa)] focus:outline-none focus:border-[var(--color-accent,#0ea5e9)] transition-colors font-mono"
            />
            <button type="button" onClick={handleSaveBridge} disabled={savingBridge}
              className="px-3 py-1.5 bg-[var(--color-bg-surface,#132235)] hover:bg-[var(--color-bg-elevated,#172b42)] disabled:opacity-50 text-xs font-medium text-[var(--color-text-primary,#f8fafc)] border border-[var(--color-border,#284057)] rounded-xl transition-colors shrink-0">
              {savingBridge ? 'Đang lưu…' : 'Lưu URL'}
            </button>
          </div>
          {verifyToken && (
            <div className="flex items-center gap-2 text-[10px] text-[var(--color-text-muted,#7f95aa)]">
              <Lock size={11} className="shrink-0" />
              <span className="font-mono truncate" title="Verify token khai báo cùng URL webhook trên Facebook">
                Verify token: {verifyToken}
              </span>
            </div>
          )}
        </div>

        {/* Thanh hành động */}
        <div className="px-5 py-3 border-b border-[var(--color-border,#284057)] bg-[var(--color-bg-panel,#0f1b2b)] flex items-center justify-between gap-2">
          <div className="relative flex-1 min-w-0">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted,#7f95aa)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Tìm theo tên Page hoặc ID..."
              className="w-full bg-[var(--color-bg-surface,#132235)] border border-[var(--color-border,#284057)] rounded-xl pl-8 pr-3 py-1.5 text-xs text-[var(--color-text-primary,#f8fafc)] placeholder:text-[var(--color-text-muted,#7f95aa)] focus:outline-none focus:border-[var(--color-accent,#0ea5e9)] transition-colors"
            />
          </div>

          <button type="button" onClick={handleCreateApp} disabled={busy || jobRunning || !bridgeUrl}
            className="px-3 py-1.5 bg-[var(--color-accent,#0ea5e9)] hover:bg-[var(--color-accent-hover,#38bdf8)] disabled:opacity-50 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 transition-all shrink-0 shadow-md"
            title={bridgeUrl ? 'Tự tạo app Facebook + đăng ký webhook + kết nối page' : 'Hãy lưu URL cầu nối hosting trước'}>
            <Rocket size={13} className={jobRunning ? 'animate-pulse' : ''} />
            <span>Tạo app &amp; Webhook</span>
          </button>

          {app?.app_id && (
            <button type="button" onClick={handlePageSetup} disabled={busy || jobRunning}
              className="px-3 py-1.5 bg-[var(--color-bg-surface,#132235)] hover:bg-[var(--color-bg-elevated,#172b42)] disabled:opacity-50 text-xs font-medium text-[var(--color-text-primary,#f8fafc)] border border-[var(--color-border,#284057)] rounded-xl flex items-center gap-1.5 transition-colors shrink-0"
              title="Cấu hình lại webhook + đăng ký field + lấy Page Access Token cho các page đã chọn">
              <KeyRound size={13} />
              <span>Lấy token</span>
            </button>
          )}

          <button type="button" onClick={handleSyncPages} disabled={busy || jobRunning}
            className="px-3 py-1.5 bg-[var(--color-bg-surface,#132235)] hover:bg-[var(--color-bg-elevated,#172b42)] disabled:opacity-50 text-xs font-medium text-[var(--color-text-primary,#f8fafc)] border border-[var(--color-border,#284057)] rounded-xl flex items-center gap-1.5 transition-colors shrink-0"
            title="Quét danh sách Fanpage của tài khoản (cuộn tải hết danh sách) — chỉ THÊM page mới, bỏ qua page đã có">
            <RefreshCw size={13} className={jobRunning && job?.kind === 'sync-pages' ? 'animate-spin' : ''} />
            <span>Đồng bộ</span>
          </button>

          <button type="button" onClick={handleSyncApps} disabled={busy || jobRunning}
            className="px-3 py-1.5 bg-[var(--color-bg-surface,#132235)] hover:bg-[var(--color-bg-elevated,#172b42)] disabled:opacity-50 text-xs font-medium text-[var(--color-text-primary,#f8fafc)] border border-[var(--color-border,#284057)] rounded-xl flex items-center gap-1.5 transition-colors shrink-0"
            title="Mở developers.facebook.com/apps/ và quét MỌI ứng dụng của tài khoản vào danh sách (kể cả app tạo ngoài CRM)">
            <FolderSync size={13} className={jobRunning && job?.kind === 'sync-apps' ? 'animate-spin' : ''} />
            <span>Đồng bộ app</span>
          </button>
        </div>

        {needsBackendRestart && (
          <div className="mx-5 mt-3 p-3 bg-amber-500/15 border border-amber-500/40 rounded-xl text-xs text-amber-200 flex items-start gap-2">
            <AlertCircle size={15} className="text-amber-400 shrink-0 mt-0.5" />
            <span>
              <strong>Cần khởi động lại phần mềm 1 lần:</strong> Bản cập nhật mới đã tải xong nhưng nhân hệ thống cũ vẫn đang chạy. Vui lòng <strong>đóng hẳn FB Messenger CRM rồi mở lại</strong> để mở Chrome tạo App &amp; Webhook bình thường.
            </span>
          </div>
        )}

        {/* Trạng thái job đang chạy */}
        {jobRunning && (
          <div className="mx-5 mt-3 p-2.5 bg-[var(--color-accent,#0ea5e9)]/10 border border-[var(--color-accent,#0ea5e9)]/30 rounded-xl text-xs text-[var(--color-text-secondary,#cbd5e1)] flex items-center gap-2">
            <RefreshCw size={14} className="animate-spin text-[var(--color-accent,#0ea5e9)] shrink-0" />
            <span className="flex-1 min-w-0">
              <strong className="text-[var(--color-text-primary,#f8fafc)]">Đang chạy:</strong>{' '}
              {job.message || job.status}
            </span>
            <button type="button" onClick={cancelJob} className="text-[10px] px-2 py-1 rounded-lg bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors shrink-0">
              Hủy
            </button>
          </div>
        )}

        {/* Popup khai báo Tên ứng dụng + Email liên hệ */}
        {showCreateForm && !jobRunning && (
          <div className="mx-5 mt-3 p-3 bg-[var(--color-accent,#0ea5e9)]/10 border border-[var(--color-accent,#0ea5e9)]/30 rounded-xl space-y-2">
            <p className="text-xs font-semibold text-[var(--color-text-primary,#f8fafc)]">Thông tin ứng dụng sẽ tạo</p>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-[var(--color-text-muted,#7f95aa)] w-24 shrink-0">Tên ứng dụng *</span>
                <input
                  type="text"
                  value={createName}
                  maxLength={30}
                  onChange={(e) => setCreateName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && createName.trim()) submitCreateApp(); }}
                  placeholder="VD: CRM Kinh doanh"
                  autoFocus
                  className="flex-1 bg-[var(--color-bg-surface,#132235)] border border-[var(--color-border,#284057)] rounded-xl px-3 py-1.5 text-xs text-[var(--color-text-primary,#f8fafc)] focus:outline-none focus:border-[var(--color-accent,#0ea5e9)]"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-[var(--color-text-muted,#7f95aa)] w-24 shrink-0">Email liên hệ</span>
                <input
                  type="email"
                  value={createEmail}
                  onChange={(e) => setCreateEmail(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && createName.trim()) submitCreateApp(); }}
                  placeholder="Để trống = dùng email của tài khoản Facebook"
                  className="flex-1 bg-[var(--color-bg-surface,#132235)] border border-[var(--color-border,#284057)] rounded-xl px-3 py-1.5 text-xs text-[var(--color-text-primary,#f8fafc)] focus:outline-none focus:border-[var(--color-accent,#0ea5e9)]"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button type="button" onClick={() => setShowCreateForm(false)}
                className="px-3 py-1.5 bg-[var(--color-bg-surface,#132235)] border border-[var(--color-border,#284057)] text-xs font-medium text-[var(--color-text-secondary,#cbd5e1)] rounded-xl">
                Hủy
              </button>
              <button type="button" onClick={submitCreateApp} disabled={busy || !createName.trim()}
                className="px-3 py-1.5 bg-[var(--color-accent,#0ea5e9)] hover:bg-[var(--color-accent-hover,#38bdf8)] disabled:opacity-50 text-white text-xs font-bold rounded-xl flex items-center gap-1.5">
                <Rocket size={12} /> Bắt đầu tạo
              </button>
            </div>
          </div>
        )}

        {/* Popup chọn app để đồng bộ page — chọn xong bấm Đồng ý mới chạy */}
        {showAppPicker && !jobRunning && (
          <div className="mx-5 mt-3 p-3 bg-[var(--color-accent,#0ea5e9)]/10 border border-[var(--color-accent,#0ea5e9)]/30 rounded-xl space-y-2">
            <p className="text-xs font-semibold text-[var(--color-text-primary,#f8fafc)]">Chọn app để đồng bộ page</p>
            <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
              {apps.length === 0 ? (
                <p className="text-[11px] text-[var(--color-text-muted,#7f95aa)]">
                  Chưa có app nào. Hãy bấm "Tạo app &amp; Webhook" hoặc "Đồng bộ app" trước.
                </p>
              ) : apps.map((a) => {
                const picked = String(a.app_id) === pickerAppId;
                return (
                  <div key={a.app_id} onClick={() => setPickerAppId(String(a.app_id))}
                    className={`px-2.5 py-2 rounded-xl border cursor-pointer flex items-center gap-2 transition-all select-none ${
                      picked
                        ? 'bg-[var(--color-accent-subtle,rgba(14,165,233,0.12))] border-[var(--color-accent,#0ea5e9)]'
                        : 'bg-[var(--color-bg-surface,#132235)] border-[var(--color-border,#284057)] hover:border-[var(--color-border,#284057)]'
                    }`}>
                    <div className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${picked ? 'border-[var(--color-accent,#0ea5e9)] bg-[var(--color-accent,#0ea5e9)]' : 'border-[var(--color-border,#284057)]'}`}>
                      {picked && <Check size={10} strokeWidth={3} className="text-white" />}
                    </div>
                    <span className="text-[11px] truncate min-w-0">
                      <strong className="text-[var(--color-text-primary,#f8fafc)]">{a.name || 'CRM'}</strong>
                      {' '}• App ID <span className="font-mono">{a.app_id}</span>
                      {a.mode ? ` • ${a.mode}` : ''}
                      {a.source === 'scan' ? ' • Quét từ FB' : ''}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button type="button" onClick={() => setShowAppPicker(false)}
                className="px-3 py-1.5 bg-[var(--color-bg-surface,#132235)] border border-[var(--color-border,#284057)] text-xs font-medium text-[var(--color-text-secondary,#cbd5e1)] rounded-xl">
                Không
              </button>
              <button type="button" onClick={confirmSyncPages} disabled={busy || !pickerAppId || apps.length === 0}
                className="px-3 py-1.5 bg-[var(--color-accent,#0ea5e9)] hover:bg-[var(--color-accent-hover,#38bdf8)] disabled:opacity-50 text-white text-xs font-bold rounded-xl flex items-center gap-1.5">
                <RefreshCw size={12} /> Đồng ý
              </button>
            </div>
          </div>
        )}

        {/* Popup mật khẩu — Facebook yêu cầu xác nhận lại */}
        {jobRunning && job.status === 'need_password' && (
          <div className="mx-5 mt-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl space-y-2">
            <p className="text-xs text-amber-300 font-medium">Facebook yêu cầu mật khẩu để xác nhận. Mật khẩu không được lưu lại.</p>
            <div className="flex items-center gap-2">
              <input
                type="password"
                value={pwd}
                onChange={(e) => setPwd(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submitPassword(); }}
                placeholder="Nhập mật khẩu Facebook…"
                autoFocus
                className="flex-1 bg-[var(--color-bg-surface,#132235)] border border-[var(--color-border,#284057)] rounded-xl px-3 py-1.5 text-xs text-[var(--color-text-primary,#f8fafc)] focus:outline-none focus:border-amber-400"
              />
              <button type="button" onClick={submitPassword} disabled={!pwd}
                className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black text-xs font-bold rounded-xl flex items-center gap-1">
                <Send size={12} /> Gửi mật khẩu
              </button>
            </div>
          </div>
        )}

        {/* Popup email liên hệ — form Facebook không có email sẵn */}
        {jobRunning && job.status === 'need_email' && (
          <div className="mx-5 mt-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl space-y-2">
            <p className="text-xs text-amber-300 font-medium">Facebook cần Email liên hệ — nhập email:</p>
            <div className="flex items-center gap-2">
              <input
                type="email"
                value={needEmail}
                onChange={(e) => setNeedEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && needEmail.trim()) {
                    submitRegister('email', needEmail.trim());
                    setNeedEmail('');
                  }
                }}
                placeholder="email@cuaban.com"
                autoFocus
                className="flex-1 bg-[var(--color-bg-surface,#132235)] border border-[var(--color-border,#284057)] rounded-xl px-3 py-1.5 text-xs text-[var(--color-text-primary,#f8fafc)] focus:outline-none focus:border-amber-400"
              />
              <button type="button" onClick={() => { submitRegister('email', needEmail.trim()); setNeedEmail(''); }}
                disabled={!needEmail.trim()}
                className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black text-xs font-bold rounded-xl">
                Gửi
              </button>
            </div>
          </div>
        )}

        {/* Popup tự đăng ký Webhooks thất bại — nhờ user làm trong Chrome */}
        {jobRunning && job.status === 'webhooks_manual' && (
          <div className="mx-5 mt-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl space-y-2">
            <p className="text-xs text-amber-300 font-medium">{job.message || 'Hãy đăng ký đối tượng Page trong mục Webhooks trên Chrome.'}</p>
            <button type="button" onClick={() => submitRegister('webhooksDone', 'done')}
              className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold rounded-xl">Xong</button>
          </div>
        )}

        {/* Popup tự tick webhook thất bại — nhờ user tick trong Chrome */}
        {jobRunning && job.status === 'subscribe_manual' && (
          <div className="mx-5 mt-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl space-y-2">
            <p className="text-xs text-amber-300 font-medium">{job.message || 'Hãy tick các trường webhook trong Chrome rồi bấm Xong.'}</p>
            <button type="button" onClick={() => submitRegister('subscribeDone', 'done')}
              className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold rounded-xl">Xong</button>
          </div>
        )}

        {/* Popup quốc gia + SĐT — xác minh tài khoản developer */}
        {jobRunning && job.status === 'register_info' && (
          <div className="mx-5 mt-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl space-y-2">
            <p className="text-xs text-amber-300 font-medium">Cần xác minh tài khoản — chọn quốc gia và nhập số điện thoại:</p>
            <div className="flex items-center gap-2">
              <input type="text" value={regInfo.country} onChange={(e) => setRegInfo((s) => ({ ...s, country: e.target.value }))}
                placeholder="Quốc gia (VD: Việt Nam)"
                className="w-36 bg-[var(--color-bg-surface,#132235)] border border-[var(--color-border,#284057)] rounded-xl px-3 py-1.5 text-xs text-[var(--color-text-primary,#f8fafc)] focus:outline-none focus:border-amber-400" />
              <input type="tel" value={regInfo.phone} onChange={(e) => setRegInfo((s) => ({ ...s, phone: e.target.value }))}
                placeholder="Số điện thoại" autoFocus
                className="flex-1 bg-[var(--color-bg-surface,#132235)] border border-[var(--color-border,#284057)] rounded-xl px-3 py-1.5 text-xs text-[var(--color-text-primary,#f8fafc)] focus:outline-none focus:border-amber-400" />
              <button type="button" onClick={() => submitRegister('info', regInfo)} disabled={!regInfo.phone}
                className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black text-xs font-bold rounded-xl">
                Gửi
              </button>
            </div>
          </div>
        )}

        {/* Popup OTP */}
        {jobRunning && job.status === 'register_code' && (
          <div className="mx-5 mt-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl space-y-2">
            <p className="text-xs text-amber-300 font-medium">Facebook đã gửi mã OTP — nhập mã:</p>
            <div className="flex items-center gap-2">
              <input type="text" value={regCode} onChange={(e) => setRegCode(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && regCode) submitRegister('code', regCode); }}
                placeholder="Mã OTP" autoFocus
                className="flex-1 bg-[var(--color-bg-surface,#132235)] border border-[var(--color-border,#284057)] rounded-xl px-3 py-1.5 text-xs text-[var(--color-text-primary,#f8fafc)] focus:outline-none focus:border-amber-400" />
              <button type="button" onClick={() => submitRegister('code', regCode)} disabled={!regCode}
                className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black text-xs font-bold rounded-xl">Gửi</button>
              <button type="button" onClick={resendSms}
                className="px-3 py-1.5 bg-[var(--color-bg-surface,#132235)] border border-[var(--color-border,#284057)] text-xs font-medium text-[var(--color-text-secondary,#cbd5e1)] rounded-xl">
                Gửi lại SMS
              </button>
            </div>
          </div>
        )}

        {/* Popup Accounts Center */}
        {jobRunning && job.status === 'register_ac' && (
          <div className="mx-5 mt-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl space-y-2">
            <p className="text-xs text-amber-300 font-medium">{job.message || 'Facebook yêu cầu thêm SĐT qua Accounts Center.'}</p>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => submitRegister('ac', 'agree')}
                className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold rounded-xl">Đồng ý</button>
              <button type="button" onClick={() => submitRegister('ac', 'cancel')}
                className="px-3 py-1.5 bg-[var(--color-bg-surface,#132235)] border border-[var(--color-border,#284057)] text-xs font-medium text-[var(--color-text-secondary,#cbd5e1)] rounded-xl">Hủy</button>
            </div>
          </div>
        )}
        {jobRunning && job.status === 'register_ac_wait' && (
          <div className="mx-5 mt-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-center gap-2">
            <p className="text-xs text-amber-300 flex-1">{job.message || 'Hãy thêm số điện thoại trong cửa sổ Accounts Center.'}</p>
            <button type="button" onClick={() => submitRegister('acDone', 'done')}
              className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold rounded-xl">Hoàn tất</button>
          </div>
        )}

        {/* Thông báo lỗi / thành công */}
        {errorMsg && (
          <div className="mx-5 mt-3 p-2.5 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-400 flex items-center gap-2">
            <AlertCircle size={15} className="shrink-0" />
            <span className="flex-1 min-w-0">{errorMsg}</span>
            <button onClick={() => setErrorMsg('')} title="Tắt thông báo"
              className="shrink-0 p-1 rounded-lg text-red-400/70 hover:text-red-300 hover:bg-red-500/10 transition-colors">
              <X size={14} />
            </button>
          </div>
        )}
        {successMsg && (
          <div className="mx-5 mt-3 p-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-xs text-emerald-400 flex items-center gap-2">
            <CheckCircle2 size={15} className="shrink-0" />
            <span className="flex-1 min-w-0">{successMsg}</span>
            <button onClick={() => setSuccessMsg('')} title="Tắt thông báo"
              className="shrink-0 p-1 rounded-lg text-emerald-400/70 hover:text-emerald-300 hover:bg-emerald-500/10 transition-colors">
              <X size={14} />
            </button>
          </div>
        )}

        {/* Các app đã tạo — liệt kê ĐỦ, box có scroll riêng nên app dưới cùng luôn xem được */}
        {apps.length > 0 && (
          <div className="mx-5 mt-3 p-2.5 bg-[var(--color-bg-surface,#132235)] border border-[var(--color-border,#284057)] rounded-xl text-[11px] text-[var(--color-text-muted,#7f95aa)]">
            <div className="flex items-center gap-2 mb-1.5">
              <Database size={13} className="shrink-0 text-[var(--color-accent,#0ea5e9)]" />
              <span className="font-semibold text-[var(--color-text-secondary,#cbd5e1)]">
                App đã tạo ({apps.length}) — app đầu là app đang dùng, viền xanh = app vừa dùng đồng bộ page
              </span>
            </div>
            <div className="space-y-1.5 max-h-32 overflow-y-auto pr-1">
              {apps.map((a, i) => (
                <div key={a.app_id || i}
                  className={`flex items-center gap-2 min-w-0 rounded-lg px-1.5 -mx-1.5 transition-all ${
                    String(a.app_id) === pageSyncAppId ? 'ring-1 ring-emerald-400/70 bg-emerald-500/10' : ''
                  }`}>
                  <span className="shrink-0 w-4 text-center font-mono text-[10px] opacity-70">{i + 1}</span>
                  <span className="truncate flex-1 min-w-0">
                    <strong className="text-[var(--color-text-primary,#f8fafc)]">{a.name || 'CRM'}</strong>
                    {' '}• App ID <span className="font-mono">{a.app_id}</span>
                    {a.mode ? ` • ${a.mode}` : ''}
                    {a.status === 'error' ? ' • Lần tạo cuối lỗi' : ''}
                    {a.source === 'scan' ? ' • Quét từ FB' : ''}
                  </span>
                  {String(a.app_id) === pageSyncAppId && (
                    <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded-full font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      Đang dùng đồng bộ
                    </span>
                  )}
                  <button type="button" onClick={() => setAppToDelete(a)} disabled={jobRunning}
                    className="shrink-0 p-1.5 rounded-lg text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/30 transition-colors disabled:opacity-40"
                    title={`Xóa app "${a.name || a.app_id}" trên Facebook (Chrome tự động hóa) và dọn token page trong CRM`}>
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Danh sách page */}
        <div className="px-5 py-2.5 bg-[var(--color-bg-panel,#0f1b2b)]/50 border-b border-[var(--color-border,#284057)] flex items-center justify-between text-xs text-[var(--color-text-muted,#7f95aa)] mt-2">
          <button type="button" onClick={handleToggleSelectAll} disabled={filteredPages.length === 0}
            className="flex items-center gap-2 hover:text-[var(--color-text-primary,#f8fafc)] transition-colors disabled:opacity-40">
            <Check size={15} className={allFilteredSelected ? 'text-[var(--color-accent,#0ea5e9)]' : 'opacity-30'} />
            <span className="font-semibold">{allFilteredSelected ? 'Bỏ chọn tất cả' : 'Chọn tất cả'}</span>
          </button>
          <span className="font-mono">
            <strong className="text-[var(--color-accent,#0ea5e9)] font-semibold">{tokenedCount}</strong>/{pages.length} trang có token
          </span>
        </div>

        <div className="p-5 overflow-y-auto space-y-2 flex-1 max-h-[42vh]">
          {loading ? (
            <div className="py-12 text-center text-xs text-[var(--color-text-muted,#7f95aa)] flex flex-col items-center justify-center gap-3">
              <RefreshCw size={20} className="animate-spin text-[var(--color-accent,#0ea5e9)]" />
              <span>Đang tải danh sách Fanpage…</span>
            </div>
          ) : filteredPages.length === 0 ? (
            <div className="py-12 text-center text-xs text-[var(--color-text-muted,#7f95aa)] flex flex-col items-center justify-center gap-2">
              <Layers size={28} className="opacity-30 mb-1" />
              <p className="font-medium text-[var(--color-text-secondary,#cbd5e1)]">
                {searchQuery ? 'Không tìm thấy Fanpage nào khớp.' : 'Chưa có Fanpage nào được kết nối.'}
              </p>
              {!searchQuery && (
                <p className="max-w-xs text-[11px] opacity-75">
                  Lưu URL cầu nối hosting rồi bấm <strong>"Tạo app &amp; Webhook"</strong> — hệ thống tự tạo app,
                  tự đăng ký webhook và quét các Fanpage tài khoản đang quản lý.
                </p>
              )}
            </div>
          ) : (
            filteredPages.map((p) => (
              <div key={p.page_id} onClick={() => handleToggleSelect(String(p.page_id))}
                className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center gap-3.5 select-none ${
                  selectedIds.has(String(p.page_id))
                    ? 'bg-[var(--color-accent-subtle,rgba(14,165,233,0.1))] border-[var(--color-accent,#0ea5e9)]/50 shadow-sm'
                    : 'bg-[var(--color-bg-surface,#132235)] border-[var(--color-border,#284057)] hover:border-[var(--color-border,#284057)]/80'
                }`}>
                <div className="shrink-0">
                  {selectedIds.has(String(p.page_id)) ? (
                    <div className="w-5 h-5 rounded-md bg-[var(--color-accent,#0ea5e9)] text-white flex items-center justify-center">
                      <Check size={14} strokeWidth={3} />
                    </div>
                  ) : (
                    <div className="w-5 h-5 rounded-md border border-[var(--color-border,#284057)] bg-[var(--color-bg-elevated,#172b42)]" />
                  )}
                </div>

                <div className="relative w-10 h-10 shrink-0 overflow-hidden rounded-full bg-[var(--color-bg-elevated,#172b42)] border border-[var(--color-border,#284057)] flex items-center justify-center text-xs font-bold text-[var(--color-text-primary,#f8fafc)]">
                  {(p.name || 'P').charAt(0).toUpperCase()}
                  {p.avatar_url && (
                    <img src={p.avatar_url} alt="" className="absolute inset-0 h-full w-full object-cover"
                      onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <span className="text-xs font-bold text-[var(--color-text-primary,#f8fafc)] truncate block">{p.name}</span>
                  <div className="flex items-center flex-wrap gap-x-2.5 gap-y-1 mt-1 text-[10px] text-[var(--color-text-muted,#7f95aa)]">
                    <span className="font-mono">ID: {p.page_id}</span>
                    {p.token && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleCopyPageToken(p); }}
                        title="Copy token của page này"
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md font-semibold border transition-colors ${
                          copiedPageId === String(p.page_id)
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                            : 'bg-[var(--color-accent-subtle,rgba(14,165,233,0.1))] text-[var(--color-accent,#0ea5e9)] border-[var(--color-accent,#0ea5e9)]/25 hover:opacity-80'
                        }`}
                      >
                        {copiedPageId === String(p.page_id) ? <Check size={10} strokeWidth={3} /> : <Copy size={10} />}
                        {copiedPageId === String(p.page_id) ? 'Đã copy token' : 'Copy token'}
                      </button>
                    )}
                  </div>
                </div>

                <div className="shrink-0">
                  {p.has_token ? (
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      Đang hoạt động
                    </span>
                  ) : (
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-slate-500/10 text-slate-400 border border-slate-500/20">
                      Chưa có token
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Nhập token từ ngoài — tool nhận diện page & kéo toàn bộ hội thoại */}
        <div className="px-5 py-4 border-t border-[var(--color-border,#284057)] bg-[var(--color-bg-panel,#0f1b2b)]/40">
          <div className="flex items-center gap-2 text-xs font-bold text-[var(--color-text-primary,#f8fafc)] mb-1">
            <ClipboardPaste size={13} className="text-[var(--color-accent,#0ea5e9)]" />
            Nhập token Page (tool)
          </div>
          <p className="text-[10px] text-[var(--color-text-muted,#7f95aa)] mb-2 leading-relaxed">
            Dán token, mỗi dòng một token (chấp nhận cả <strong>user token</strong> — tool tự nhận diện và kéo tất cả page).
            Page chưa có trong CRM vẫn đồng bộ được: tự nhận diện page, kéo toàn bộ hội thoại cũ và tự bắt tin mới.
          </p>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            rows={3}
            placeholder={'EAABsbCD… (mỗi dòng một token)'}
            className="w-full px-3 py-2 rounded-xl bg-[var(--color-bg-elevated,#172b42)] border border-[var(--color-border,#284057)] text-[11px] font-mono text-[var(--color-text-primary,#f8fafc)] placeholder-[var(--color-text-muted,#7f95aa)]/60 focus:outline-none focus:border-[var(--color-accent,#0ea5e9)]/60 resize-y"
          />
          <div className="flex items-center gap-3 mt-2">
            <button
              type="button"
              onClick={handleImportTokens}
              disabled={importing || !importText.trim()}
              className="px-4 py-2 bg-[var(--color-accent,#0ea5e9)] hover:bg-[var(--color-accent-hover,#38bdf8)] disabled:opacity-40 text-white rounded-xl text-xs font-bold flex items-center gap-2 transition-all shadow-md"
            >
              <RefreshCw size={13} className={importing ? 'animate-spin' : ''} />
              {importing ? 'Đang nhận diện & đồng bộ…' : 'Nhập token & đồng bộ hội thoại'}
            </button>
            {importResults && (
              <button type="button" onClick={() => setImportResults(null)} className="text-[10px] text-[var(--color-text-muted,#7f95aa)] hover:text-[var(--color-text-secondary,#cbd5e1)] underline">
                Ẩn kết quả
              </button>
            )}
          </div>
          {importResults && (
            <div className="mt-2 space-y-1 max-h-32 overflow-y-auto">
              {importResults.map((r, i) => (
                <div key={i} className={`text-[11px] flex items-start gap-1.5 ${r.status === 'error' ? 'text-[var(--color-danger,#f87171)]' : 'text-emerald-400'}`}>
                  <span>{r.status === 'error' ? '❌' : '✅'}</span>
                  <span className="min-w-0">
                    <span className="font-mono">{r.token || '(trống)'}</span>
                    {r.type === 'User' && ' — user token'}
                    {r.pageName ? ` — ${r.pageName}` : ''}
                    {r.pages ? ` — ${r.pages.length} page: ${r.pages.join(', ')}` : ''}
                    {r.error ? ` — ${r.error}` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-[var(--color-border,#284057)] bg-[var(--color-bg-surface,#132235)] flex items-center justify-between gap-3">
          <button type="button" onClick={onClose} disabled={busy}
            className="px-4 py-2 bg-[var(--color-bg-elevated,#172b42)] hover:bg-[var(--color-bg-panel,#0f1b2b)] text-[var(--color-text-secondary,#cbd5e1)] rounded-xl text-xs font-semibold transition-colors border border-[var(--color-border,#284057)]">
            Đóng
          </button>

          <button type="button" onClick={handleBackfill}
            disabled={busy || jobRunning || tokenedCount === 0}
            className="px-4 py-2 bg-[var(--color-accent,#0ea5e9)] hover:bg-[var(--color-accent-hover,#38bdf8)] disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-2 transition-all shadow-md active:scale-98"
            title="Đăng ký webhook cho page (để nhận tin khách) + đồng bộ hội thoại gần đây về CRM">
            <RefreshCw size={14} className={busy ? 'animate-spin' : ''} />
            <span>Lấy hội thoại</span>
          </button>
        </div>
      </div>

      <ConfirmModal
        isOpen={!!appToDelete}
        title="Xóa ứng dụng Facebook"
        message={
          `Chrome sẽ tự động mở developers.facebook.com và gỡ app "${appToDelete?.name || ''}" (App ID: ${appToDelete?.app_id}).\n\n` +
          '• Danh sách Fanpage và hội thoại của các page thuộc account này sẽ bị xóa khỏi CRM.\n' +
          '• Muốn dùng lại, hãy tạo app mới rồi bấm "Đồng bộ" + "Lấy token".'
        }
        confirmText="Xóa app"
        cancelText="Hủy"
        variant="danger"
        isLoading={deletingApp}
        onConfirm={handleDeleteApp}
        onClose={() => !deletingApp && setAppToDelete(null)}
      />
    </div>
  );
}
