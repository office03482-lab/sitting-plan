import type { AttendanceOverview, AttendanceSubject, AttendanceNotification, AttendanceHoliday, StaffAttendanceRecord, StaffDashboard } from '@types';
import { toArray } from './commonUtils';

export interface StudentAttendanceDashboardSummary {
  total_count: number;
  present_count: number;
  absent_count: number;
  late_count: number;
  class_summary: Array<Record<string, unknown>>;
  batch_summary: Array<Record<string, unknown>>;
  date_summary: Array<Record<string, unknown>>;
}

export const emptyStudentDashboardSummary: StudentAttendanceDashboardSummary = {
  total_count: 0,
  present_count: 0,
  absent_count: 0,
  late_count: 0,
  class_summary: [],
  batch_summary: [],
  date_summary: [],
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

export const normalizeStaffDashboard = (value: unknown, fallbackRecords: StaffAttendanceRecord[] = []): StaffDashboard => {
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
