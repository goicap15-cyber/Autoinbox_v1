import React, { useState, useEffect } from 'react';
import { X, RefreshCw, DownloadCloud, CheckCircle2, Sparkles } from 'lucide-react';

export default function AppUpdateModal({
  isOpen,
  onClose,
  updateStatus,
  onStatusChange,
}) {
  const [loadingCheck, setLoadingCheck] = useState(false);
  const [loadingApply, setLoadingApply] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    fetch('/api/app-update/status')
      .then((r) => r.json())
      .then((data) => {
        if (data?.status) onStatusChange?.(data.status);
      })
      .catch(() => {});
  }, [isOpen]);

  if (!isOpen) return null;

  const state = updateStatus?.state || 'idle';
  const currentVersion = updateStatus?.currentVersion || '1.0.0';
  const latestVersion = updateStatus?.latestVersion || currentVersion;
  const updateAvailable = Boolean(updateStatus?.updateAvailable);
  const isBusy = ['checking', 'downloading', 'applying', 'restarting'].includes(state) || loadingCheck || loadingApply;

  const handleCheckUpdate = async () => {
    setLoadingCheck(true);
    try {
      const res = await fetch('/api/app-update/check', { method: 'POST' });
      const data = await res.json();
      if (data?.status) onStatusChange?.(data.status);
    } catch (_) {
    } finally {
      setLoadingCheck(false);
    }
  };

  const handleApplyUpdate = async () => {
    setLoadingApply(true);
    try {
      const res = await fetch('/api/app-update/apply', { method: 'POST' });
      const data = await res.json();
      if (data?.status) onStatusChange?.(data.status);
    } catch (_) {
      setLoadingApply(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-2.5">
            <div className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500/15 text-blue-400">
              <DownloadCloud size={20} />
              {updateAvailable && (
                <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500" />
                </span>
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">Cập nhật ứng dụng</h3>
                {updateAvailable && (
                  <span className="inline-flex items-center rounded-full bg-blue-500/15 border border-blue-500/30 px-2 py-0.5 text-[10px] font-bold text-blue-400">
                    BẢN MỚI
                  </span>
                )}
              </div>
              <p className="text-xs text-[var(--color-text-secondary)]">
                Phiên bản đang chạy: <strong className="text-[var(--color-text-primary)]">v{currentVersion}</strong>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] cursor-pointer"
            aria-label="Đóng"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className={`rounded-xl border p-4 space-y-2.5 ${updateAvailable ? 'border-blue-500/35 bg-blue-500/5' : 'border-[var(--color-border)] bg-[var(--color-bg-secondary)]'}`}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[var(--color-text-secondary)]">Trạng thái phiên bản</span>
              {updateAvailable ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-blue-600 px-2.5 py-0.5 text-xs font-semibold text-white shadow-xs">
                  <Sparkles size={12} /> Có bản mới v{latestVersion}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium text-emerald-500">
                  <CheckCircle2 size={12} /> Đã mới nhất (v{currentVersion})
                </span>
              )}
            </div>

            <p className="text-xs leading-relaxed text-[var(--color-text-primary)]">
              {updateStatus?.message || `Bạn đang sử dụng phiên bản v${currentVersion}. Bấm "Kiểm tra cập nhật" để kiểm tra bản mới nhất.`}
            </p>

            {updateStatus?.notes && updateAvailable && (
              <div className="mt-2 rounded-lg bg-black/10 p-2.5 text-xs text-[var(--color-text-secondary)] whitespace-pre-wrap">
                <strong className="block mb-1 text-[var(--color-text-primary)]">Nội dung bản cập nhật:</strong>
                {updateStatus.notes}
              </div>
            )}

            {['downloading', 'applying', 'restarting'].includes(state) && (
              <div className="pt-2 space-y-1.5">
                <div className="h-2 w-full rounded-full bg-black/20 overflow-hidden">
                  <div
                    className="h-full bg-blue-500 transition-all duration-300"
                    style={{ width: `${Math.max(8, Number(updateStatus?.progress) || 15)}%` }}
                  />
                </div>
                <div className="flex justify-between text-[11px] text-[var(--color-text-secondary)]">
                  <span>{state === 'restarting' ? 'Đang áp dụng giao diện mới...' : 'Đang tải bản cập nhật...'}</span>
                  <span>{Number(updateStatus?.progress) || 0}%</span>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              disabled={isBusy}
              onClick={handleCheckUpdate}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-4 py-2.5 text-xs font-semibold hover:bg-[var(--color-bg-hover)] disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw size={15} className={state === 'checking' || loadingCheck ? 'animate-spin' : ''} />
              Kiểm tra cập nhật
            </button>

            <button
              type="button"
              disabled={isBusy || !updateAvailable}
              onClick={handleApplyUpdate}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-40 cursor-pointer shadow-md"
            >
              <DownloadCloud size={15} />
              {updateAvailable ? `Cập nhật ngay (v${latestVersion})` : 'Đã ở bản mới nhất'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
