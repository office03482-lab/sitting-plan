import type { StudentAttendanceStatus, StaffAttendanceStatus } from '@types';

export const studentRecordStatusBaseClass =
  'inline-flex w-fit items-center justify-center rounded-full border px-3 py-1 text-xs font-semibold leading-none';

export const inputClass =
  'w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-900 focus:ring-4 focus:ring-slate-200/70';

export const sectionClass = 'rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-[0_16px_40px_rgba(15,23,42,0.06)]';

export const statusButtonBase = 'rounded-full px-3 py-1.5 text-xs font-semibold transition';

export const deleteButtonClass = 'rounded-full bg-rose-100 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-200';

export const studentRecordDeleteButtonClass =
  'inline-flex w-fit items-center justify-center rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold leading-none text-rose-700 transition hover:border-rose-300 hover:bg-rose-100';

export const deleteAllButtonClass = 'rounded-full bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700';

export function studentStatusClass(status: StudentAttendanceStatus) {
  if (status === 'present') return 'bg-emerald-100 text-emerald-700';
  if (status === 'absent') return 'bg-rose-100 text-rose-700';
  return 'bg-amber-100 text-amber-700';
}

export function studentRecordStatusClass(status: StudentAttendanceStatus) {
  if (status === 'present') return `${studentRecordStatusBaseClass} border-emerald-200 bg-emerald-50 text-emerald-700`;
  if (status === 'absent') return `${studentRecordStatusBaseClass} border-rose-200 bg-rose-50 text-rose-700`;
  return `${studentRecordStatusBaseClass} border-amber-200 bg-amber-50 text-amber-700`;
}

export function studentCalendarShadeClass(status: StudentAttendanceStatus | null) {
  if (status === 'present') return 'border-emerald-300 bg-emerald-200 text-emerald-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.4)]';
  if (status === 'absent') return 'border-rose-300 bg-rose-200 text-rose-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.4)]';
  return 'border-slate-200 bg-slate-50 text-slate-500';
}

export function staffStatusClass(status: StaffAttendanceStatus) {
  if (status === 'present') return 'bg-emerald-100 text-emerald-700';
  if (status === 'absent') return 'bg-rose-100 text-rose-700';
  if (status === 'late') return 'bg-amber-100 text-amber-700';
  return 'bg-orange-100 text-orange-700';
}

export function staffCalendarShadeClass(status: string | null) {
  if (status === 'present') return 'border-emerald-200 bg-emerald-100 text-emerald-900';
  if (status === 'absent') return 'border-rose-200 bg-rose-100 text-rose-900';
  if (status === 'late') return 'border-amber-200 bg-amber-100 text-amber-900';
  if (status === 'half_day') return 'border-orange-200 bg-orange-100 text-orange-900';
  if (status === 'leave') return 'border-sky-200 bg-sky-100 text-sky-900';
  return 'border-slate-200 bg-white text-slate-500';
}
