import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';

const WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

const toKey = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const fromKey = (key) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key || '')) return null;
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatDay = (key) => {
  const date = fromKey(key);
  if (!date) return '';
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`;
};

// Lịch range tự vẽ: click 1 = Từ, click 2 = Đến (nhỏ hơn thì tự đảo), hover
// xem trước khoảng. Đóng giữa chừng thì bỏ lựa chọn, giữ nguyên filter cũ.
export default function DateRangePicker({ value = null, onChange }) {
  const [open, setOpen] = useState(false);
  const [pendingFrom, setPendingFrom] = useState(null);
  const [hoverKey, setHoverKey] = useState(null);
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth());
  const triggerRef = useRef(null);
  const popupRef = useRef(null);

  const propFrom = value?.from || '';
  const propTo = value?.to || '';
  const selecting = pendingFrom !== null;
  const from = selecting ? pendingFrom : propFrom;
  const to = selecting ? '' : propTo;
  const hasRange = Boolean(propFrom || propTo);
  const todayKey = toKey(new Date());

  const cells = useMemo(() => {
    const lead = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const list = [];
    for (let i = 0; i < lead; i += 1) list.push(null);
    for (let day = 1; day <= daysInMonth; day += 1) {
      list.push({ day, key: toKey(new Date(viewYear, viewMonth, day)) });
    }
    return list;
  }, [viewYear, viewMonth]);

  const dismiss = () => {
    setOpen(false);
    setPendingFrom(null);
    setHoverKey(null);
  };

  const toggleOpen = () => {
    if (open) {
      dismiss();
      return;
    }
    const base = fromKey(propFrom || propTo) || new Date();
    setViewYear(base.getFullYear());
    setViewMonth(base.getMonth());
    setHoverKey(null);
    setOpen(true);
  };

  const handleDayClick = (key) => {
    if (!selecting) {
      setPendingFrom(key);
      setHoverKey(null);
      return;
    }
    const pickedFrom = pendingFrom;
    dismiss();
    onChange?.(key < pickedFrom ? { from: key, to: pickedFrom } : { from: pickedFrom, to: key });
  };

  const clearRange = () => {
    dismiss();
    onChange?.({ from: '', to: '' });
  };

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event) => {
      const target = event.target;
      if (popupRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      dismiss();
    };
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      dismiss();
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const previewEnd = selecting ? (hoverKey || null) : to;
  const lo = from && previewEnd ? (from < previewEnd ? from : previewEnd) : null;
  const hi = from && previewEnd ? (from < previewEnd ? previewEnd : from) : null;

  const navMonth = (delta) => {
    let month = viewMonth + delta;
    let year = viewYear;
    if (month < 0) { month = 11; year -= 1; }
    if (month > 11) { month = 0; year += 1; }
    setViewMonth(month);
    setViewYear(year);
  };

  const sortedFrom = propFrom && propTo ? (propFrom <= propTo ? propFrom : propTo) : propFrom;
  const sortedTo = propFrom && propTo ? (propFrom <= propTo ? propTo : propFrom) : propTo;
  const label = hasRange
    ? (sortedTo ? `${formatDay(sortedFrom)} – ${formatDay(sortedTo)}` : formatDay(sortedFrom))
    : 'Khoảng ngày';

  const dayClass = (key) => {
    if (key === lo || key === hi) {
      return 'flex h-8 cursor-pointer items-center justify-center rounded-full bg-[var(--color-accent)] text-xs font-bold text-[var(--color-text-on-accent)] transition-colors';
    }
    if (lo && hi && key > lo && key < hi) {
      return 'flex h-8 cursor-pointer items-center justify-center rounded-full bg-[var(--color-accent-subtle)] text-xs font-semibold text-[var(--color-accent)] transition-colors';
    }
    if (key === todayKey) {
      return 'flex h-8 cursor-pointer items-center justify-center rounded-full text-xs font-semibold text-[var(--color-accent)] ring-1 ring-inset ring-[var(--color-accent)]/40 transition-colors hover:bg-[var(--color-bg-hover)]';
    }
    return 'flex h-8 cursor-pointer items-center justify-center rounded-full text-xs text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-bg-hover)]';
  };

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <div className="relative">
        <button
          ref={triggerRef}
          type="button"
          onClick={toggleOpen}
          aria-haspopup="dialog"
          aria-expanded={open}
          title="Lọc hội thoại theo khoảng ngày"
          className={`h-8.5 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors ${
            hasRange
              ? 'border-[var(--color-accent)]/40 bg-[var(--color-accent-subtle)] text-[var(--color-accent)]'
              : 'border-transparent text-[var(--color-text-muted)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]'
          }`}
        >
          <CalendarDays size={13} strokeWidth={1.75} />
          <span className="tabular-nums">{label}</span>
        </button>
        {open && (
          <div
            ref={popupRef}
            role="dialog"
            aria-label="Chọn khoảng ngày"
            className="absolute right-0 top-full z-50 mt-1.5 w-[272px] rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-panel)] p-3 shadow-xl"
          >
            <div className="mb-2 flex items-center justify-between">
              <button
                type="button"
                onClick={() => navMonth(-1)}
                aria-label="Tháng trước"
                className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
              >
                <ChevronLeft size={14} strokeWidth={1.75} />
              </button>
              <span className="text-xs font-semibold tabular-nums text-[var(--color-text-primary)]">
                Tháng {viewMonth + 1}/{viewYear}
              </span>
              <button
                type="button"
                onClick={() => navMonth(1)}
                aria-label="Tháng sau"
                className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
              >
                <ChevronRight size={14} strokeWidth={1.75} />
              </button>
            </div>
            <div className="mb-1 grid grid-cols-7">
              {WEEKDAYS.map((weekday) => (
                <span key={weekday} className="flex h-6 items-center justify-center text-[10px] font-semibold text-[var(--color-text-muted)]">
                  {weekday}
                </span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-y-0.5">
              {cells.map((cell, index) => (cell ? (
                <button
                  key={cell.key}
                  type="button"
                  onClick={() => handleDayClick(cell.key)}
                  onMouseEnter={() => setHoverKey(cell.key)}
                  className={dayClass(cell.key)}
                >
                  {cell.day}
                </button>
              ) : (
                <span key={`blank-${index}`} />
              )))}
            </div>
            <div className="mt-2 flex items-center justify-center border-t border-[var(--color-border)] pt-2 text-[10px] text-[var(--color-text-muted)]">
              {selecting ? 'Chọn ngày kết thúc' : 'Chọn ngày bắt đầu'}
            </div>
          </div>
        )}
      </div>
      {hasRange && (
        <button
          type="button"
          onClick={clearRange}
          title="Xóa bộ lọc ngày"
          aria-label="Xóa bộ lọc ngày"
          className="h-8.5 inline-flex cursor-pointer items-center rounded-lg px-2 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)]"
        >
          <X size={13} strokeWidth={1.75} />
        </button>
      )}
    </div>
  );
}
