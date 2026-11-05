import React, { useEffect, useMemo, useState } from 'react';
import { X, Phone, Power, ShieldCheck, Save, Info, CheckCircle2 } from 'lucide-react';

export default function PhoneAutomationSettingsModal({ leadStatuses = [], onClose }) {
  const [settings, setSettings] = useState(null);
  const [enabled, setEnabled] = useState(false);
  const [statusId, setStatusId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const selectedStatus = useMemo(() => leadStatuses.find((status) => String(status.id) === String(statusId)) || null, [leadStatuses, statusId]);

  useEffect(() => {
    let active = true;
    fetch('/api/settings/phone-automation')
      .then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(payload?.error || 'Không tải được cài đặt.'); return payload; })
      .then((payload) => {
        if (!active) return;
        setSettings(payload);
        setEnabled(Boolean(payload.enabled));
        setStatusId(payload.status_id == null ? '' : String(payload.status_id));
      })
      .catch((loadError) => active && setError(loadError.message));
    return () => { active = false; };
  }, []);

  const save = async () => {
    setError('');
    setSaved(false);
    if (enabled && !statusId) { setError('Hãy chọn trạng thái đích trước khi bật tự động hóa.'); return; }
    setSaving(true);
    try {
      const response = await fetch('/api/settings/phone-automation', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled, status_id: statusId || null })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || 'Không thể lưu cài đặt.');
      setSettings(payload);
      setEnabled(Boolean(payload.enabled));
      setStatusId(payload.status_id == null ? '' : String(payload.status_id));
      setSaved(true);
      window.setTimeout(onClose, 700);
    } catch (saveError) { setError(saveError.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-slate-950/35 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="phone-automation-title">
        <header className="flex items-start justify-between border-b border-slate-100 bg-gradient-to-r from-violet-600 to-indigo-600 px-5 py-4 text-white">
          <div className="flex gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15"><Phone size={20} /></span>
            <div><h2 id="phone-automation-title" className="text-base font-bold">Tự động hoá số điện thoại</h2><p className="mt-0.5 text-xs text-violet-100">Áp dụng cho mọi tin nhắn khách gửi vào CRM</p></div>
          </div>
          <button type="button" onClick={onClose} aria-label="Đóng" className="rounded-lg p-1.5 text-white/75 transition hover:bg-white/10 hover:text-white"><X size={18} /></button>
        </header>

        <div className="space-y-4 p-5">
          <div className="rounded-xl border border-violet-100 bg-violet-50 p-4">
            <div className="flex items-center justify-between gap-3">
              <div><p className="flex items-center gap-2 text-sm font-bold text-violet-950"><Power size={16} className={enabled ? 'text-emerald-600' : 'text-slate-400'} /> Tự đổi trạng thái khi có số</p><p className="mt-1 text-xs leading-relaxed text-violet-800/75">Nhận số Việt Nam và số di động quốc tế (+81, +82, +1...) từ tin nhắn đến. Không nhận nhầm số nhân viên/CRM gửi ra.</p></div>
              <button type="button" onClick={() => { setSaved(false); setEnabled((value) => !value); }} role="switch" aria-checked={enabled} aria-label="Bật tự động hoá số điện thoại" className={'relative h-7 w-12 shrink-0 rounded-full transition-colors ' + (enabled ? 'bg-emerald-500' : 'bg-slate-300')}><span className={'absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ' + (enabled ? 'translate-x-5' : 'translate-x-0')} /></button>
            </div>
          </div>

          <label className="block">
            <span className="mb-1.5 block text-sm font-semibold text-slate-700">Đổi trạng thái thành</span>
            <select value={statusId} disabled={!enabled || !settings} onChange={(event) => { setSaved(false); setStatusId(event.target.value); }} className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-700 outline-none transition focus:border-violet-400 focus:bg-white focus:ring-2 focus:ring-violet-100 disabled:cursor-not-allowed disabled:opacity-55">
              <option value="">Chọn trạng thái khách đã để số</option>
              {leadStatuses.map((status) => <option key={status.id} value={status.id}>{status.name}</option>)}
            </select>
          </label>

          <div className="flex gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-600"><ShieldCheck size={16} className="mt-0.5 shrink-0 text-emerald-600" /><p><strong>Ưu tiên rõ ràng:</strong> Campaign có trạng thái đích riêng sẽ ưu tiên trạng thái đó. Nếu campaign không chọn trạng thái, quy tắc này vẫn áp dụng cho khách nhắn số.</p></div>
          {enabled && selectedStatus && <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: selectedStatus.color }} /><span>{saved ? 'Đã bật' : 'Sẽ bật sau khi lưu'}: khách gửi số sẽ thành <strong>{selectedStatus.name}</strong>.</span></div>}
          {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{error}</p>}
          {saved && <p role="status" className="flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700"><CheckCircle2 size={15} /> Đã lưu cài đặt. Đang đóng…</p>}
        </div>

        <footer className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-5 py-3"><span className="flex items-center gap-1.5 text-xs text-slate-500"><Info size={14} /> {saved ? 'Cài đặt đã được lưu thành công.' : enabled ? 'Quy tắc đang sẵn sàng để lưu.' : 'Tắt: CRM chỉ lưu số, không tự đổi trạng thái.'}</span><div className="flex gap-2"><button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-200">Đóng</button><button type="button" onClick={save} disabled={saving || saved || !settings} className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3.5 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50">{saved ? <CheckCircle2 size={15} /> : <Save size={15} />} {saving ? 'Đang lưu' : saved ? 'Đã lưu' : 'Lưu cài đặt'}</button></div></footer>
      </section>
    </div>
  );
}
