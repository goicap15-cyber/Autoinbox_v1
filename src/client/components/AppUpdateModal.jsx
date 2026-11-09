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
  const isUpdating = ['downloading', 'applying', 'restarting'].includes(state) || loadingApply;
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
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 backdrop-blur-[2px] p-4"
      onClick={onClose}
    >
      <div
        style={{ height: 'auto' }}
        className="relative w-[360px] max-w-[92vw] rounded-3xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-6 text-[var(--color-text-primary)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 rounded-xl p-1.5 text-[var(--color-text-tertiary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] cursor-pointer transition-colors"
          aria-label="Đóng"
        >
          <X size={18} />
        </button>

        <div className="flex flex-col items-center text-center">
          <div className="relative mb-3.5 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-500/12 border border-blue-500/25 text-blue-500">
            <DownloadCloud size={28} strokeWidth={1.8} />
            {updateAvailable && (
              <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
                <span className="relative inline-flex h-3.5 w-3.5 rounded-full bg-rose-500 ring-2 ring-[var(--color-bg-elevated)]" />
              </span>
            )}
          </div>

          <div className="flex items-center justify-center gap-2">
            <h3 className="text-base font-bold text-[var(--color-text-primary)]">
              {updateAvailable ? 'Có bản cập nhật mới!' : 'Cập nhật ứng dụng'}
            </h3>
          </div>

          <div className="mt-1.5 flex items-center justify-center gap-2 text-xs text-[var(--color-text-secondary)]">
            <span>Đang chạy: <strong className="text-[var(--color-text-primary)]">v{currentVersion}</strong></span>
            {updateAvailable ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-600 px-2.5 py-0.5 text-[11px] font-semibold text-white">
                <Sparkles size={11} /> Mới v{latestVersion}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-500">
                <CheckCircle2 size={11} /> Mới nhất
              </span>
            )}
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-3.5 text-center">
          <p className="text-xs leading-relaxed text-[var(--color-text-secondary)] line-clamp-4">
            {updateAvailable && updateStatus?.notes
              ? updateStatus.notes
              : (updateStatus?.message || `Bạn đang sử dụng phiên bản v${currentVersion}.`)}
          </p>

          {isUpdating && (
            <div className="mt-3 space-y-1.5 text-left">
              <div className="h-2 w-full rounded-full bg-black/15 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-600 to-indigo-600 transition-all duration-300"
                  style={{ width: `${Math.max(10, Number(updateStatus?.progress) || 20)}%` }}
                />
              </div>
              <div className="flex justify-between text-[11px] text-[var(--color-text-secondary)]">
                <span>{state === 'restarting' ? 'Đang làm mới giao diện...' : 'Đang tải bản cập nhật...'}</span>
                <span>{Number(updateStatus?.progress) || 0}%</span>
              </div>
            </div>
          )}
        </div>

        <div className="mt-5 flex flex-col gap-2">
          {updateAvailable ? (
            <button
              type="button"
              disabled={isBusy}
              onClick={handleApplyUpdate}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 py-2.5 px-4 text-xs font-semibold text-white shadow-md disabled:opacity-50 cursor-pointer transition-all"
            >
              <DownloadCloud size={16} />
              {isUpdating ? 'Đang cập nhật...' : `Cập nhật ngay (v${latestVersion})`}
            </button>
          ) : (
            <button
              type="button"
              disabled={isBusy}
              onClick={handleCheckUpdate}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 py-2.5 px-4 text-xs font-semibold text-white shadow-md disabled:opacity-50 cursor-pointer transition-all"
            >
              <RefreshCw size={15} className={state === 'checking' || loadingCheck ? 'animate-spin' : ''} />
              Kiểm tra bản cập nhật mới
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            className="w-full inline-flex items-center justify-center rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] hover:bg-[var(--color-bg-hover)] py-2 px-4 text-xs font-medium text-[var(--color-text-secondary)] cursor-pointer transition-all"
          >
            {updateAvailable ? 'Để sau' : 'Đóng'}
          </button>
        </div>
      </div>
    </div>
  );
}
