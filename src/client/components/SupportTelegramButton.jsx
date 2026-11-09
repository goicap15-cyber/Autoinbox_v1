import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const SUPPORT_HOTLINE = '+84976347697';
const QR_URL = '/images/telegram-support-qr.png';

export default function SupportTelegramButton() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return createPortal(
    <React.Fragment>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Hỗ trợ khách hàng qua Telegram"
        title="Hỗ trợ khách hàng qua Telegram"
        className="fixed bottom-4 right-4 z-[80] flex h-9 w-9 items-center justify-center rounded-full bg-[#229ED9] text-white shadow-md transition-colors hover:bg-[#1e8fc5]"
      >
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="h-5 w-5">
          <path d="M9.04 15.31l-.38 5.32c.54 0 .78-.23 1.06-.5l2.55-2.44 5.28 3.87c.97.53 1.66.25 1.92-.89L22.9 4.02c.31-1.42-.51-1.98-1.45-1.63L2.7 9.62c-1.39.54-1.37 1.32-.24 1.67l4.69 1.46L18.2 6.18c.51-.34.98-.15.6.19L9.04 15.31z" />
        </svg>
      </button>
      {open && (
        <React.Fragment>
          <div className="fixed inset-0 z-[9990]" onClick={() => setOpen(false)} aria-hidden="true" />
          <div
            role="dialog"
            aria-label="Hỗ trợ qua Telegram"
            className="fixed bottom-16 right-4 z-[9995] w-64 rounded-2xl border border-black/10 bg-white p-4 shadow-2xl dark:border-white/10 dark:bg-slate-900"
          >
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">Hỗ trợ AdsupCRM</p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Đóng"
                className="rounded-full px-1.5 text-lg leading-6 text-slate-400 hover:bg-black/5 hover:text-slate-600 dark:hover:bg-white/10 dark:hover:text-slate-200"
              >
                ×
              </button>
            </div>
            <img
              src={QR_URL}
              alt={'Mã QR Telegram hỗ trợ ' + SUPPORT_HOTLINE}
              className="aspect-[4/5] w-full rounded-xl border border-black/5 object-cover dark:border-white/10"
            />
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Mở app Telegram và quét mã để được hỗ trợ</p>
            <p className="mt-0.5 text-sm font-semibold tracking-wide text-slate-800 dark:text-slate-100">{SUPPORT_HOTLINE}</p>
          </div>
        </React.Fragment>
      )}
    </React.Fragment>,
    document.body
  );
}
