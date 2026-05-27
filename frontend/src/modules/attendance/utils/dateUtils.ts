export function parseCalendarDate(value?: string) {
  if (!value) return null;
  const normalized = value.trim();
  if (!normalized) return null;

  const datePart = normalized.includes('T') ? normalized.slice(0, 10) : normalized;
  const parts = datePart.split('-').map((item) => Number(item));
  if (parts.length === 3 && parts.every((item) => Number.isFinite(item))) {
    const [year, month, day] = parts;
    return new Date(year, month - 1, day);
  }

  const fallback = new Date(normalized);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

export function toDateKey(value?: string) {
  const parsed = parseCalendarDate(value);
  if (!parsed) return '';
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function dateToKeyFromDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getMonthRange(value?: string) {
  const baseDate = parseCalendarDate(value) || new Date();
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  return {
    from: dateToKeyFromDate(firstDay),
    to: dateToKeyFromDate(lastDay),
  };
}

export function formatCalendarMonthLabel(value?: string) {
  const baseDate = parseCalendarDate(value) || new Date();
  return baseDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export function toMonthInputValue(value?: string) {
  const baseDate = parseCalendarDate(value) || new Date();
  const year = baseDate.getFullYear();
  const month = String(baseDate.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function shiftMonthValue(value: string | undefined, delta: number) {
  const baseDate = parseCalendarDate(value) || new Date();
  const targetDate = new Date(baseDate.getFullYear(), baseDate.getMonth() + delta, 1);
  return dateToKeyFromDate(targetDate);
}

export function applyMonthInputValue(currentValue: string | undefined, monthValue: string) {
  if (!monthValue) return currentValue || dateToKeyFromDate(new Date());
  const [yearRaw, monthRaw] = monthValue.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return currentValue || dateToKeyFromDate(new Date());
  }

  return dateToKeyFromDate(new Date(year, month - 1, 1));
}

export function formatDate(value?: string) {
  if (!value) return 'N/A';
  const parsed = parseCalendarDate(value);
  return parsed ? parsed.toLocaleDateString() : 'N/A';
}

export function isDateWithinRange(targetDate: string, fromDate?: string, toDate?: string) {
  const targetKey = toDateKey(targetDate);
  const fromKey = toDateKey(fromDate);
  const toKey = toDateKey(toDate);
  if (!targetKey || !fromKey || !toKey) return false;
  return targetKey >= fromKey && targetKey <= toKey;
}

export function getCurrentTimeHHMM() {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}
