import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Facebook,
  ListChecks,
  MessageSquare,
  RotateCcw,
  Search,
  SkipForward,
  User,
  XCircle
} from 'lucide-react';

const statusMeta = {
  pending: { label: 'Chờ gửi', icon: Clock3, className: 'border-amber-200 bg-amber-50 text-amber-600' },
  processing: { label: 'Đang gửi', icon: Clock3, className: 'border-blue-200 bg-blue-50 text-blue-600' },
  sent: { label: 'Đã gửi', icon: CheckCircle2, className: 'border-emerald-200 bg-emerald-50 text-emerald-600' },
  failed: { label: 'Thất bại', icon: XCircle, className: 'border-red-200 bg-red-50 text-red-600' },
  skipped: { label: 'Bỏ qua', icon: SkipForward, className: 'border-orange-200 bg-orange-50 text-orange-600' },
  cancelled: { label: 'Đã hủy', icon: XCircle, className: 'border-slate-200 bg-slate-100 text-slate-500' }
};

const avatarStyles = [
  'from-orange-300 to-rose-400',
  'from-blue-400 to-indigo-500',
  'from-emerald-400 to-teal-500',
  'from-fuchsia-400 to-purple-500',
  'from-amber-300 to-orange-500'
];

function getInitials(value = '') {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts.at(-1)[0]).toUpperCase();
}

function avatarStyle(value = '') {
  const score = [...value].reduce((total, character) => total + character.charCodeAt(0), 0);
  return avatarStyles[score % avatarStyles.length];
}

export default function CampaignRecipientTable({ campaign, onRetry, busyRecipientId = null }) {
  const [statusFilter, setStatusFilter] = useState('all');
  const [query, setQuery] = useState('');

  const recipients = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return (campaign?.recipients || []).filter((recipient) => {
      if (statusFilter !== 'all' && recipient.status !== statusFilter) return false;
      if (!normalized) return true;
      return [
        recipient.contact_name,
        recipient.thread_id,
        recipient.source_name,
        recipient.last_error,
        recipient.eligibility_reason
      ].filter(Boolean).join(' ').toLowerCase().includes(normalized);
    });
  }, [campaign, query, statusFilter]);

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm" aria-labelledby="campaign-recipients-title">
      <header className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <h3 id="campaign-recipients-title" className="flex flex-wrap items-center gap-2 text-sm font-bold text-slate-700">
          <ListChecks className="h-4 w-4 text-emerald-500" />
          Kết quả theo người nhận
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-400">{recipients.length} / {campaign?.recipients?.length || 0} dòng</span>
        </h3>

        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="relative">
            <span className="sr-only">Tìm người nhận</span>
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm người nhận..." className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-xs text-slate-700 outline-none transition-colors placeholder:text-slate-300 focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-100 sm:w-48" />
          </label>
          <label className="relative">
            <span className="sr-only">Lọc trạng thái</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-9 w-full appearance-none rounded-lg border border-slate-200 bg-slate-50 pl-3 pr-8 text-xs font-medium text-slate-600 outline-none transition-colors focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-100 sm:w-auto">
              <option value="all">Tất cả trạng thái</option>
              {Object.entries(statusMeta).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}
            </select>
            <ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          </label>
        </div>
      </header>

      <div className="max-h-[430px] overflow-auto">
        <table className="w-full min-w-[940px] border-collapse text-left text-xs">
          <thead className="sticky top-0 z-[1] bg-slate-50 text-slate-400">
            <tr>
              <th className="px-4 py-2.5 font-medium">#</th>
              <th className="px-4 py-2.5 font-medium">Người nhận</th>
              <th className="px-4 py-2.5 font-medium">Route snapshot</th>
              <th className="px-4 py-2.5 font-medium">Trạng thái</th>
              <th className="px-4 py-2.5 text-center font-medium">Attempt</th>
              <th className="px-4 py-2.5 font-medium">Kết quả</th>
              <th className="px-4 py-2.5 font-medium">Kênh gửi</th>
              <th className="px-3 py-2.5 text-right font-medium">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {recipients.map((recipient) => {
              const meta = statusMeta[recipient.status] || statusMeta.pending;
              const Icon = meta.icon;
              const contactName = recipient.contact_name || recipient.thread_id || 'Không rõ';
              return (
                <tr key={recipient.id} className="transition-colors hover:bg-blue-50/40">
                  <td className="px-4 py-3 font-mono text-slate-400">
                    {recipient.execution_order ? '#' + recipient.execution_order : '—'}
                    {recipient.selection_order && <span className="ml-1 text-slate-300">/ {recipient.selection_order}</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className={'flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-[11px] font-bold text-white shadow-sm ' + avatarStyle(contactName)}>{getInitials(contactName)}</div>
                      <div className="min-w-0">
                        <p className="max-w-48 truncate font-semibold text-slate-700">{contactName}</p>
                        <p className="max-w-48 truncate text-[11px] text-slate-400">{recipient.thread_id}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {(recipient.source_type_snapshot || recipient.source_type) === 'personal_messenger' ? (
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-indigo-100 text-indigo-600" title="Messenger cá nhân">
                          <User size={12} />
                        </span>
                      ) : (
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-blue-100 text-blue-600" title="Facebook Page">
                          <Facebook size={12} />
                        </span>
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="max-w-40 truncate font-medium text-slate-700">{recipient.source_name || recipient.source_display_name_snapshot || recipient.source_id || 'Không có nguồn'}</p>
                          {(recipient.source_type_snapshot || recipient.source_type) === 'personal_messenger' ? (
                            <span className="rounded bg-indigo-50 px-1 py-0.2 text-[9px] font-semibold text-indigo-600">Cá nhân</span>
                          ) : (
                            <span className="rounded bg-blue-50 px-1 py-0.2 text-[9px] font-semibold text-blue-600">Page</span>
                          )}
                        </div>
                        <p className="max-w-44 truncate text-[11px] text-slate-400">{recipient.account_id || 'Không có account'}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-semibold ' + meta.className}><Icon size={13} /> {meta.label}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 font-bold text-slate-600">{recipient.attempt_count || 0}</span>
                  </td>
                  <td className="max-w-60 px-4 py-3">
                    {recipient.last_error || recipient.eligibility_reason ? (
                      <span className={'flex items-start gap-1.5 ' + (recipient.status === 'skipped' ? 'text-orange-500' : recipient.status === 'failed' ? 'text-red-500' : 'text-slate-500')} title={recipient.last_error || recipient.eligibility_reason}>
                        <AlertCircle size={13} className="mt-0.5 shrink-0" />
                        <span className="line-clamp-2">{recipient.last_error || recipient.eligibility_reason}</span>
                      </span>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    {recipient.delivery_channel === 'dom' ? (
                      <span className="inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-600">DOM Business Suite</span>
                    ) : recipient.delivery_channel === 'graph' ? (
                      <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-600">Graph API</span>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-3 text-right">
                    {recipient.status === 'failed' ? (
                      <button type="button" onClick={() => onRetry(recipient.id)} disabled={busyRecipientId === recipient.id} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 font-semibold text-slate-600 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600 disabled:opacity-45">
                        <RotateCcw size={13} /> {busyRecipientId === recipient.id ? 'Đang retry' : 'Retry'}
                      </button>
                    ) : <ChevronRight size={16} className="ml-auto text-slate-300" aria-hidden="true" />}
                  </td>
                </tr>
              );
            })}
            {recipients.length === 0 && (
              <tr>
                <td colSpan="8" className="px-4 py-10 text-center text-slate-400">Không có người nhận phù hợp bộ lọc.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
