// @ts-nocheck
import type {
  AttendanceHoliday,
  AttendanceNotification,
  AttendanceOverview,
  AttendanceStaff,
  AttendanceSubject,
  AttendanceStudent,
  Batch,
  StaffAttendanceRecord,
  StaffAttendanceStatus,
  StaffDashboard,
  StudentAttendanceRecord,
  StudentAttendanceStatus,
} from '@types';

export type TabKey = 'overview' | 'student' | 'staff' | 'leaves' | 'reports';

export const tabs: Array<{ key: TabKey; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'student', label: 'Student Attendance' },
  { key: 'staff', label: 'Staff Attendance' },
  { key: 'leaves', label: 'Leave Management' },
  { key: 'reports', label: 'Reports' },
];

export const sectionClass =
  'rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-[0_16px_40px_rgba(15,23,42,0.06)]';
export const inputClass =
  'w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-900 focus:ring-4 focus:ring-slate-200/70';
export const statusButtonBase = 'rounded-full px-3 py-1.5 text-xs font-semibold transition';
export const deleteButtonClass =
  'rounded-full bg-rose-100 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-200';
export const studentRecordDeleteButtonClass =
  'inline-flex w-fit items-center justify-center rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold leading-none text-rose-700 transition hover:border-rose-300 hover:bg-rose-100';
export const studentRecordStatusBaseClass =
  'inline-flex w-fit items-center justify-center rounded-full border px-3 py-1 text-xs font-semibold leading-none';
export const deleteAllButtonClass =
  'rounded-full bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700';

export const initialHolidayForm = { title: '', holiday_date: '', description: '' };
export const initialLeaveForm = {
  staff_member_id: '',
  leave_type: 'casual',
  from_date: '',
  to_date: '',
  reason: '',
};

export const toArray = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

export const normalizeDepartmentKey = (value?: string | null) => String(value || '').trim().toLowerCase();
export const parseCommaSeparatedValues = (value?: string) =>
  String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

export const getUniqueDepartmentOptions = (values: Array<string | null | undefined>) =>
  Array.from(
    values.reduce((map, item) => {
      const cleaned = String(item || '').trim();
      if (!cleaned) return map;
      const key = normalizeDepartmentKey(cleaned);
      if (!map.has(key)) {
        map.set(key, cleaned);
      }
      return map;
    }, new Map<string, string>()).values()
  ).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));

export const buildAttendanceBatches = (students: AttendanceStudent[], schoolId: number = 1): Batch[] => {
  const grouped = new Map<string, number>();
  students.forEach((student) => {
    const className = String(student.class_name || '').trim();
    const section = String(student.section || '').trim();
    if (!className || !section) return;
    const key = `${className} | ${section}`;
    grouped.set(key, (grouped.get(key) || 0) + 1);
  });

  return Array.from(grouped.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, studentCount], index) => ({
      id: index + 1,
      name,
      school_id: schoolId,
      is_active: true,
      created_at: '',
      updated_at: '',
      student_count: studentCount,
    }));
};

export const normalizeOverview = (value: unknown): AttendanceOverview | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<AttendanceOverview>;
  return {
    student_count: Number(raw.student_count ?? 0),
    staff_count: Number(raw.staff_count ?? 0),
    class_options: toArray<string>(raw.class_options),
    section_options: toArray<string>(raw.section_options),
    subject_options: toArray<AttendanceSubject>(raw.subject_options),
    department_options: toArray<string>(raw.department_options),
    notifications: toArray<AttendanceNotification>(raw.notifications),
    holidays: toArray<AttendanceHoliday>(raw.holidays),
    settings: raw.settings || {
      minimum_attendance_threshold: 75,
      working_hours_start: '09:00',
      working_hours_end: '17:00',
      updated_at: new Date().toISOString(),
    },
  };
};

export const buildStaffDashboardFromRecords = (records: StaffAttendanceRecord[]): StaffDashboard => {
  const present_count = records.filter((item) => item.status === 'present').length;
  const absent_count = records.filter((item) => item.status === 'absent').length;
  const late_count = records.filter((item) => item.status === 'late').length;
  const half_day_count = records.filter((item) => item.status === 'half_day').length;
  const total = records.length || 1;
  const grouped = new Map<string, { department: string; present: number; absent: number; late: number; half_day: number }>();

  records.forEach((item) => {
    const department = String(item.department || '').trim();
    if (!department) return;
    const current = grouped.get(department) || {
      department,
      present: 0,
      absent: 0,
      late: 0,
      half_day: 0,
    };
    if (item.status === 'present') current.present += 1;
    if (item.status === 'absent') current.absent += 1;
    if (item.status === 'late') current.late += 1;
    if (item.status === 'half_day') current.half_day += 1;
    grouped.set(department, current);
  });

  return {
    present_count,
    absent_count,
    late_count,
    half_day_count,
    monthly_attendance_percentage: Number(
      (((present_count + late_count + half_day_count * 0.5) / total) * 100).toFixed(2)
    ),
    department_summary: Array.from(grouped.values()).sort((a, b) => a.department.localeCompare(b.department)),
  } as StaffDashboard;
};

export const normalizeStaffDashboard = (
  value: unknown,
  fallbackRecords: StaffAttendanceRecord[] = []
): StaffDashboard => {
  if (!value || typeof value !== 'object') {
    return buildStaffDashboardFromRecords(fallbackRecords);
  }
  const raw = value as Record<string, unknown>;
  const hasNewShape =
    'present_count' in raw ||
    'absent_count' in raw ||
    'late_count' in raw ||
    'half_day_count' in raw ||
    'monthly_attendance_percentage' in raw;
  if (!hasNewShape) {
    return buildStaffDashboardFromRecords(fallbackRecords);
  }
  return {
    present_count: Number(raw.present_count ?? 0),
    absent_count: Number(raw.absent_count ?? 0),
    late_count: Number(raw.late_count ?? 0),
    half_day_count: Number(raw.half_day_count ?? 0),
    monthly_attendance_percentage: Number(raw.monthly_attendance_percentage ?? 0),
    department_summary: toArray(raw.department_summary),
  } as StaffDashboard;
};

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

export function formatDate(value?: string) {
  if (!value) return 'N/A';
  const parsed = parseCalendarDate(value);
  return parsed ? parsed.toLocaleDateString() : 'N/A';
}

export function isTeachingStaffMember(member?: { designation?: string | null }) {
  return String(member?.designation || '').trim().toLowerCase() === 'teacher';
}

export function staffCalendarShadeClass(status: string | null) {
  if (status === 'present') return 'border-emerald-200 bg-emerald-100 text-emerald-900';
  if (status === 'absent') return 'border-rose-200 bg-rose-100 text-rose-900';
  if (status === 'late') return 'border-amber-200 bg-amber-100 text-amber-900';
  if (status === 'half_day') return 'border-orange-200 bg-orange-100 text-orange-900';
  if (status === 'leave') return 'border-sky-200 bg-sky-100 text-sky-900';
  return 'border-slate-200 bg-white text-slate-500';
}

export function isDateWithinRange(targetDate: string, fromDate?: string, toDate?: string) {
  const targetKey = toDateKey(targetDate);
  const fromKey = toDateKey(fromDate);
  const toKey = toDateKey(toDate);
  if (!targetKey || !fromKey || !toKey) return false;
  return targetKey >= fromKey && targetKey <= toKey;
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
  const parsed = parseCalendarDate(value);
  if (!parsed) return null;
  const start = new Date(parsed.getFullYear(), parsed.getMonth(), 1);
  const end = new Date(parsed.getFullYear(), parsed.getMonth() + 1, 0);
  return { start, end };
}

export function formatCalendarMonthLabel(value?: string) {
  const parsed = parseCalendarDate(value);
  return parsed ? parsed.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : 'Unknown month';
}

export function toMonthInputValue(value?: string) {
  const parsed = parseCalendarDate(value);
  if (!parsed) return '';
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}`;
}

export function shiftMonthValue(value: string | undefined, delta: number) {
  const parsed = parseCalendarDate(value);
  const source = parsed || new Date();
  return dateToKeyFromDate(new Date(source.getFullYear(), source.getMonth() + delta, source.getDate()));
}

export function applyMonthInputValue(currentValue: string | undefined, monthValue: string) {
  if (!monthValue) return currentValue || '';
  const [year, month] = monthValue.split('-').map(Number);
  if (!year || !month) return currentValue || '';
  const current = parseCalendarDate(currentValue) || new Date();
  const safeDay = Math.min(current.getDate(), new Date(year, month, 0).getDate());
  return dateToKeyFromDate(new Date(year, month - 1, safeDay));
}

export function splitBatchLabel(value?: string) {
  if (!value || !value.includes('|')) {
    return { className: '', section: '' };
  }
  const [className, section] = value.split('|').map((item) => item.trim());
  return { className, section };
}

export function normalizeBatchComparisonKey(value?: string) {
  const { className, section } = splitBatchLabel(value);
  return `${className.toLowerCase()}|${section.toLowerCase()}`;
}

export function summarizeStudentDayRecords(records: StudentAttendanceRecord[]) {
  return records.reduce(
    (summary, record) => {
      summary.total += 1;
      if (record.status === 'present') summary.present += 1;
      if (record.status === 'absent') summary.absent += 1;
      if (record.status === 'late') summary.late += 1;
      return summary;
    },
    { present: 0, absent: 0, late: 0, total: 0 }
  );
}

export function studentStatusClass(status: StudentAttendanceStatus) {
  if (status === 'present') return 'bg-emerald-600 text-white';
  if (status === 'absent') return 'bg-rose-600 text-white';
  return 'bg-slate-100 text-slate-600';
}

export function studentRecordStatusClass(status: StudentAttendanceStatus) {
  if (status === 'present') return `${studentRecordStatusBaseClass} border-emerald-200 bg-emerald-50 text-emerald-700`;
  if (status === 'absent') return `${studentRecordStatusBaseClass} border-rose-200 bg-rose-50 text-rose-700`;
  return `${studentRecordStatusBaseClass} border-amber-200 bg-amber-50 text-amber-700`;
}

export function studentCalendarShadeClass(status: StudentAttendanceStatus | null) {
  if (status === 'present') return 'border-emerald-200 bg-emerald-100 text-emerald-900';
  if (status === 'absent') return 'border-rose-200 bg-rose-100 text-rose-900';
  if (status === 'late') return 'border-amber-200 bg-amber-100 text-amber-900';
  return 'border-slate-200 bg-white text-slate-500';
}

export function staffStatusClass(status: StaffAttendanceStatus) {
  if (status === 'present') return 'bg-emerald-600 text-white';
  if (status === 'absent') return 'bg-rose-600 text-white';
  if (status === 'late') return 'bg-amber-500 text-white';
  return 'bg-orange-500 text-white';
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
}

export function getCurrentTimeHHMM() {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}
