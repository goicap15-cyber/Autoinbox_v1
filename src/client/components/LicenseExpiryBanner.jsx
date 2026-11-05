import React from 'react';

export const LICENSE_EXPIRY_WARN_DAYS = 5;

// Trả số ngày còn lại (làm tròn lên) hoặc null nếu expiresAt không parse được.
// daysLeft <= 0 nghĩa là đã qua hạn — banner không lo trường hợp này (LicenseLockScreen lo).
export function computeLicenseDaysLeft(expiresAt, now = Date.now()) {
  if (!expiresAt) return null;
  const expiresAtMs = new Date(expiresAt).getTime();
  if (!Number.isFinite(expiresAtMs)) return null;
  return Math.ceil((expiresAtMs - now) / 86400000);
}

export function formatLicenseExpiryDate(expiresAt) {
  if (!expiresAt) return null;
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function LicenseExpiryBanner({ daysLeft, expiresAtLabel, onOpenPayment, onDismiss }) {
  if (!Number.isFinite(daysLeft) || daysLeft < 1 || daysLeft > LICENSE_EXPIRY_WARN_DAYS) return null;

  const message = daysLeft === 1
    ? `BẢN QUYỀN HẾT HẠN VÀO NGÀY MAI (${expiresAtLabel}) — GIA HẠN NGAY ĐỂ KHÔNG BỊ KHÓA`
    : `BẢN QUYỀN CÒN ${daysLeft} NGÀY — HẾT HẠN ${expiresAtLabel} • VÀO MỤC "MUA LICENSE" ĐỂ GIA HẠN`;
  const decorated = `⚠️ ${message} ⚠️`;

  return (
    <React.Fragment>
      <style>{`
        @keyframes license-expiry-marquee {
          0% { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .license-expiry-banner {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          height: 28px;
          z-index: 40;
          background: #DC2626;
          color: #FFFFFF;
          overflow: hidden;
          cursor: pointer;
          display: flex;
          align-items: center;
          user-select: none;
        }
        .license-expiry-banner:hover .license-expiry-marquee-track {
          animation-play-state: paused;
        }
        .license-expiry-marquee-track {
          display: inline-flex;
          white-space: nowrap;
          animation: license-expiry-marquee 18s linear infinite;
          will-change: transform;
        }
        .license-expiry-marquee-track span {
          padding-right: 80px;
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.3px;
        }
        .license-expiry-banner-close {
          position: absolute;
          right: 0;
          top: 0;
          height: 100%;
          width: 26px;
          border: none;
          background: rgba(0, 0, 0, 0.18);
          color: #FFFFFF;
          font-size: 15px;
          line-height: 1;
          cursor: pointer;
          padding: 0;
        }
        .license-expiry-banner-close:hover {
          background: rgba(0, 0, 0, 0.38);
        }
        @media (prefers-reduced-motion: reduce) {
          .license-expiry-marquee-track {
            animation: none;
          }
        }
      `}</style>
      <div
        className="license-expiry-banner"
        role="alert"
        title="Bấm để mở Mua License"
        onClick={onOpenPayment}
      >
        <div className="license-expiry-marquee-track">
          <span>{decorated}</span>
          <span>{decorated}</span>
        </div>
        <button
          type="button"
          className="license-expiry-banner-close"
          aria-label="Tạm ẩn cảnh báo hết hạn license"
          onClick={(event) => { event.stopPropagation(); onDismiss(); }}
        >
          ×
        </button>
      </div>
    </React.Fragment>
  );
}
