// @ts-nocheck
import { Component, type ErrorInfo, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import type { SelectHTMLAttributes } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  CalendarDays,
  ChevronLeft,
  ChevronDown,
  ClipboardCheck,
  Search,
  UserCheck,
  Users,
} from 'lucide-react';

import { Alert } from '@components/Alert';
import { LoadingSpinner } from '@components/LoadingSpinner';
import { apiService } from '@services/api';
import { useAuthStore } from '@store/auth';
import type {
  Batch,
  AttendanceHoliday,
  AttendanceLeave,
  AttendanceLeaveStatus,
  AttendanceLeaveType,
  AttendanceNotification,
  AttendanceOverview,
  AttendanceReportResponse,
  AttendanceStaff,
  AttendanceSubject,
  AttendanceStudent,
  StaffAttendanceMarkingResponse,
  StaffAttendanceMarkingRow,
  StaffAttendanceRecord,
  StaffAttendanceStatus,
  StaffDashboard,
  StudentAttendanceMarkingResponse,
  StudentAttendanceMarkingRow,
  StudentAttendanceRecord,
  StudentAttendanceStatus,
  TeacherAttendanceContext,
} from '@types';

type TabKey = 'overview' | 'student' | 'staff' | 'leaves' | 'reports';

const tabs: Array<{ key: TabKey; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'student', label: 'Student Attendance' },
  { key: 'staff', label: 'Staff Attendance' },
  { key: 'leaves', label: 'Leave Management' },
  { key: 'reports', label: 'Reports' },
];

const sectionClass = 'rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-[0_16px_40px_rgba(15,23,42,0.06)]';
const inputClass =
  'w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-900 focus:ring-4 focus:ring-slate-200/70';
const statusButtonBase = 'rounded-full px-3 py-1.5 text-xs font-semibold transition';
const deleteButtonClass = 'rounded-full bg-rose-100 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-200';
const studentRecordDeleteButtonClass =
  'inline-flex w-fit items-center justify-center rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold leading-none text-rose-700 transition hover:border-rose-300 hover:bg-rose-100';
const studentRecordStatusBaseClass =
  'inline-flex w-fit items-center justify-center rounded-full border px-3 py-1 text-xs font-semibold leading-none';
const deleteAllButtonClass = 'rounded-full bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700';

const initialHolidayForm = { title: '', holiday_date: '', description: '' };
const initialLeaveForm = {
  staff_member_id: '',
  leave_type: 'casual' as AttendanceLeaveType,
  from_date: '',
  to_date: '',
  reason: '',
};

const toArray = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

const normalizeDepartmentKey = (value?: string | null) => String(value || '').trim().toLowerCase();
const parseCommaSeparatedValues = (value?: string) =>
  String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const getUniqueDepartmentOptions = (values: Array<string | null | undefined>) =>
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

const buildAttendanceBatches = (students: AttendanceStudent[], schoolId: number = 1): Batch[] => {
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

const normalizeOverview = (value: unknown): AttendanceOverview | null => {
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

const buildStaffDashboardFromRecords = (records: StaffAttendanceRecord[]): StaffDashboard => {
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

const normalizeStaffDashboard = (value: unknown, fallbackRecords: StaffAttendanceRecord[] = []): StaffDashboard => {
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

function formatDate(value?: string) {
  if (!value) return 'N/A';
  const parsed = parseCalendarDate(value);
  return parsed ? parsed.toLocaleDateString() : 'N/A';
}

function isTeachingStaffMember(member?: { designation?: string | null }) {
  return String(member?.designation || '').trim().toLowerCase() === 'teacher';
}

function staffCalendarShadeClass(status: string | null) {
  if (status === 'present') return 'border-emerald-200 bg-emerald-100 text-emerald-900';
  if (status === 'absent') return 'border-rose-200 bg-rose-100 text-rose-900';
  if (status === 'late') return 'border-amber-200 bg-amber-100 text-amber-900';
  if (status === 'half_day') return 'border-orange-200 bg-orange-100 text-orange-900';
  if (status === 'leave') return 'border-sky-200 bg-sky-100 text-sky-900';
  return 'border-slate-200 bg-white text-slate-500';
}

function isDateWithinRange(targetDate: string, fromDate?: string, toDate?: string) {
  const targetKey = toDateKey(targetDate);
  const fromKey = toDateKey(fromDate);
  const toKey = toDateKey(toDate);
  if (!targetKey || !fromKey || !toKey) return false;
  return targetKey >= fromKey && targetKey <= toKey;
}

function parseCalendarDate(value?: string) {
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

function toDateKey(value?: string) {
  const parsed = parseCalendarDate(value);
  if (!parsed) return '';
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateToKeyFromDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getMonthRange(value?: string) {
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

function formatCalendarMonthLabel(value?: string) {
  const baseDate = parseCalendarDate(value) || new Date();
  return baseDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function toMonthInputValue(value?: string) {
  const baseDate = parseCalendarDate(value) || new Date();
  const year = baseDate.getFullYear();
  const month = String(baseDate.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function shiftMonthValue(value: string | undefined, delta: number) {
  const baseDate = parseCalendarDate(value) || new Date();
  const targetDate = new Date(baseDate.getFullYear(), baseDate.getMonth() + delta, 1);
  return dateToKeyFromDate(targetDate);
}

function applyMonthInputValue(currentValue: string | undefined, monthValue: string) {
  if (!monthValue) return currentValue || dateToKeyFromDate(new Date());
  const [yearRaw, monthRaw] = monthValue.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return currentValue || dateToKeyFromDate(new Date());
  }

  return dateToKeyFromDate(new Date(year, month - 1, 1));
}

function splitBatchLabel(value?: string) {
  const normalized = (value || '').trim();
  if (!normalized) {
    return { className: '', section: '' };
  }

  if (normalized.includes('|')) {
    const [classNameRaw, sectionRaw] = normalized.split('|', 1 + 1);
    return {
      className: (classNameRaw || '').trim(),
      section: (sectionRaw || '').trim() || 'A',
    };
  }

  if (normalized.includes('-')) {
    const [classNameRaw, sectionRaw] = normalized.split('-', 1 + 1);
    return {
      className: (classNameRaw || '').trim(),
      section: (sectionRaw || '').trim() || 'A',
    };
  }

  const spacedMatch = normalized.match(/^(.*\S)\s+([A-Za-z])$/);
  if (spacedMatch) {
    return {
      className: spacedMatch[1].trim(),
      section: spacedMatch[2].trim().toUpperCase() || 'A',
    };
  }

  return { className: normalized, section: 'A' };
}

function normalizeBatchComparisonKey(value?: string) {
  const normalized = (value || '').trim();
  if (!normalized) return '';

  if (normalized.includes('|')) {
    const [classNameRaw, sectionRaw] = normalized.split('|', 2);
    return `${(classNameRaw || '').trim().toLowerCase()}|${(sectionRaw || '').trim().toLowerCase()}`;
  }

  if (normalized.includes('-')) {
    const [classNameRaw, sectionRaw] = normalized.split('-', 2);
    return `${(classNameRaw || '').trim().toLowerCase()}|${(sectionRaw || '').trim().toLowerCase()}`;
  }

  const spacedMatch = normalized.match(/^(.*\S)\s+([A-Za-z0-9]+)$/);
  if (spacedMatch) {
    return `${spacedMatch[1].trim().toLowerCase()}|${spacedMatch[2].trim().toLowerCase()}`;
  }

  return normalized.toLowerCase();
}

function summarizeStudentDayRecords(records: StudentAttendanceRecord[]) {
  const grouped = new Map<
    string,
    {
      batch_name: string;
      student_id: number;
      status: StudentAttendanceStatus;
    }
  >();

  for (const record of records) {
    const batchName = `${record.class_name} | ${record.section}`;
    const key = `${batchName}::${record.student_id}`;
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, {
        batch_name: batchName,
        student_id: record.student_id,
        status: record.status === 'late' ? 'present' : record.status,
      });
      continue;
    }

    if (record.status === 'absent') {
      current.status = 'absent';
      continue;
    }

    if (current.status !== 'absent') {
      current.status = 'present';
    }
  }

  return Array.from(grouped.values());
}

function studentStatusClass(status: StudentAttendanceStatus) {
  if (status === 'present') return 'bg-emerald-100 text-emerald-700';
  if (status === 'absent') return 'bg-rose-100 text-rose-700';
  return 'bg-amber-100 text-amber-700';
}

function studentRecordStatusClass(status: StudentAttendanceStatus) {
  if (status === 'present') return `${studentRecordStatusBaseClass} border-emerald-200 bg-emerald-50 text-emerald-700`;
  if (status === 'absent') return `${studentRecordStatusBaseClass} border-rose-200 bg-rose-50 text-rose-700`;
  return `${studentRecordStatusBaseClass} border-amber-200 bg-amber-50 text-amber-700`;
}

function studentCalendarShadeClass(status: StudentAttendanceStatus | null) {
  if (status === 'present') return 'border-emerald-300 bg-emerald-200 text-emerald-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.4)]';
  if (status === 'absent') return 'border-rose-300 bg-rose-200 text-rose-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.4)]';
  return 'border-slate-200 bg-slate-50 text-slate-500';
}

function staffStatusClass(status: StaffAttendanceStatus) {
  if (status === 'present') return 'bg-emerald-100 text-emerald-700';
  if (status === 'absent') return 'bg-rose-100 text-rose-700';
  if (status === 'late') return 'bg-amber-100 text-amber-700';
  return 'bg-orange-100 text-orange-700';
}

function downloadBlob(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.URL.revokeObjectURL(url);
}

function getCurrentTimeHHMM() {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function AttendanceManagementContent() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((state) => state.user);
  const isTeacherSelfView = user?.role === 'teacher' && user?.user_type === 'teaching';
  const permissionList = user?.permissions || [];
  const hasExactPermission = (permission: string) => user?.role === 'admin' || permissionList.includes(permission);
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [loading, setLoading] = useState(true);
  const [tabLoading, setTabLoading] = useState(false);
  const [alert, setAlert] = useState<{ type: 'success' | 'error' | 'warning' | 'info'; message: string } | null>(null);

  const [overview, setOverview] = useState<AttendanceOverview | null>(null);
  const [managedBatches, setManagedBatches] = useState<Batch[]>([]);
  const [students, setStudents] = useState<AttendanceStudent[]>([]);
  const [staffMembers, setStaffMembers] = useState<AttendanceStaff[]>([]);
  const [subjects, setSubjects] = useState<AttendanceSubject[]>([]);
  const [notifications, setNotifications] = useState<AttendanceNotification[]>([]);
  const [holidays, setHolidays] = useState<AttendanceHoliday[]>([]);
  const [studentMarking, setStudentMarking] = useState<StudentAttendanceMarkingResponse | null>(null);
  const [studentRecords, setStudentRecords] = useState<StudentAttendanceRecord[]>([]);
  const [studentCalendarRecords, setStudentCalendarRecords] = useState<StudentAttendanceRecord[]>([]);
  const [studentCalendarUsingMonthFallback, setStudentCalendarUsingMonthFallback] = useState(false);
  const [filteredStudentRecords, setFilteredStudentRecords] = useState<StudentAttendanceRecord[]>([]);
  const [todayStudentRecords, setTodayStudentRecords] = useState<StudentAttendanceRecord[]>([]);
  const [staffMarking, setStaffMarking] = useState<StaffAttendanceMarkingResponse | null>(null);
  const [staffRecords, setStaffRecords] = useState<StaffAttendanceRecord[]>([]);
  const [staffCalendarRecords, setStaffCalendarRecords] = useState<StaffAttendanceRecord[]>([]);
  const [staffApprovedLeaves, setStaffApprovedLeaves] = useState<AttendanceLeave[]>([]);
  const [staffDashboard, setStaffDashboard] = useState<StaffDashboard | null>(null);
  const [leaves, setLeaves] = useState<AttendanceLeave[]>([]);
  const [reportData, setReportData] = useState<AttendanceReportResponse | null>(null);
  const [teacherAttendanceContext, setTeacherAttendanceContext] = useState<TeacherAttendanceContext | null>(null);
  const [batchAttendanceContext, setBatchAttendanceContext] = useState<TeacherAttendanceContext | null>(null);

  const [holidayForm, setHolidayForm] = useState(initialHolidayForm);
  const [leaveForm, setLeaveForm] = useState(initialLeaveForm);

  const [studentFilters, setStudentFilters] = useState({
    date: new Date().toISOString().slice(0, 10),
    dashboard_date: new Date().toISOString().slice(0, 10),
    batch_name: '',
    record_batch_name: '',
    subject_id: '',
    search: '',
    recordStudentName: '',
    date_from: '',
    date_to: '',
  });

  const [staffFilters, setStaffFilters] = useState({
    date: new Date().toISOString().slice(0, 10),
    staffType: 'all' as 'all' | 'teaching' | 'non_teaching',
    department: '',
    dashboardDepartment: '',
    recordDepartment: '',
    search: '',
    dashboardDate: '',
    recordStaffName: '',
    recordDate: '',
  });

  const [reportFilters, setReportFilters] = useState({
    report_type: 'student_summary' as 'student_summary' | 'staff_summary' | 'leave_summary',
    batch_names: '',
    department: '',
    date_from: '',
    date_to: '',
  });
  const [reportBatchPicker, setReportBatchPicker] = useState('');

  useEffect(() => {
    if (!alert || alert.type !== 'success') return;
    const timer = window.setTimeout(() => setAlert(null), 2800);
    return () => window.clearTimeout(timer);
  }, [alert]);

  const [loadedTabs, setLoadedTabs] = useState<Record<TabKey, boolean>>({
    overview: false,
    student: false,
    staff: false,
    leaves: false,
    reports: false,
  });
  const [tabAutoLoadDone, setTabAutoLoadDone] = useState<Record<TabKey, boolean>>({
    overview: false,
    student: false,
    staff: false,
    leaves: false,
    reports: false,
  });

  const getApiErrorMessage = (error: any, fallback: string) =>
    error?.response?.data?.detail || error?.message || fallback;

  const upsertAttendanceSubject = (context: TeacherAttendanceContext | null | undefined) => {
    if (!context?.subject_id || !context.class_name || !context.section || !context.subject) return;
    setSubjects((current) => {
      const exists = current.some((item) => item.id === context.subject_id);
      if (exists) {
        return current.map((item) =>
          item.id === context.subject_id
            ? {
                ...item,
                name: context.subject || item.name,
                class_name: context.class_name || item.class_name,
                section: context.section || item.section,
              }
            : item
        );
      }
      return [
        ...current,
        {
          id: context.subject_id,
          name: context.subject,
          class_name: context.class_name,
          section: context.section,
          is_active: true,
        },
      ];
    });
  };

  const visibleAttendanceContext =
    (user?.role === 'teacher' && teacherAttendanceContext?.class_name ? teacherAttendanceContext : null) ||
    batchAttendanceContext;
  const hasAttendanceRootAccess = hasExactPermission('attendance');
  const canViewOverviewTab = hasAttendanceRootAccess || hasExactPermission('attendance.overview');
  const canViewStudentTab = hasAttendanceRootAccess || hasExactPermission('attendance.student');
  const canViewStaffTab = hasAttendanceRootAccess || hasExactPermission('attendance.staff');
  const canViewLeavesTab = hasAttendanceRootAccess || hasExactPermission('attendance.leaves');
  const canViewReportsTab = hasAttendanceRootAccess || hasExactPermission('attendance.reports');
  const visibleTabs = useMemo(
    () =>
      tabs.filter((tab) => {
        if (isTeacherSelfView && (tab.key === 'overview' || tab.key === 'reports')) return false;
        if (tab.key === 'overview') return canViewOverviewTab;
        if (tab.key === 'student') return canViewStudentTab;
        if (tab.key === 'staff') return canViewStaffTab;
        if (tab.key === 'leaves') return canViewLeavesTab;
        if (tab.key === 'reports') return canViewReportsTab;
        return true;
      }),
    [canViewLeavesTab, canViewOverviewTab, canViewReportsTab, canViewStaffTab, canViewStudentTab, isTeacherSelfView]
  );

  const hydrateDefaults = (
    overviewData: AttendanceOverview,
    studentsData: AttendanceStudent[],
    batchesData: Batch[]
  ) => {
    const firstBatch = batchesData[0]?.name || (studentsData[0] ? `${studentsData[0].class_name} | ${studentsData[0].section}` : '');
    if (!studentFilters.batch_name && firstBatch) {
      setStudentFilters((current) => ({
        ...current,
        batch_name: current.batch_name || firstBatch,
      }));
    }
  };
  const attendanceStudentsRefreshCooldownMs = 60_000;
  const lastManagedBatchRefreshAtRef = useRef(0);
  const managedBatchRefreshInFlightRef = useRef<Promise<void> | null>(null);

  const loadOverviewData = async (initial = false) => {
    try {
      initial ? setLoading(true) : setTabLoading(true);
      let normalizedOverview: AttendanceOverview | null = null;
      try {
        const overviewRes = await apiService.getAttendanceOverview();
        normalizedOverview = normalizeOverview(overviewRes.data);
      } catch (error) {
        const fallbackRes = await apiService.getIntegratedAttendanceOverview(1);
        normalizedOverview = normalizeOverview(fallbackRes.data);
      }
      setOverview(normalizedOverview);
      if (normalizedOverview) {
        setNotifications(normalizedOverview.notifications);
        setHolidays(normalizedOverview.holidays);
      }
      setLoadedTabs((current) => ({ ...current, overview: true }));
    } catch (error: any) {
      console.error('Failed to load attendance module', error);
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'Attendance module load nahi ho paaya.') });
    } finally {
      initial ? setLoading(false) : setTabLoading(false);
    }
  };

  useEffect(() => {
    loadOverviewData(true);
  }, []);

  useEffect(() => {
    const hashValue = location.hash.replace('#', '').trim();
    if (!hashValue) return;
    const nextTab = visibleTabs.find((tab) => tab.key === hashValue);
    if (nextTab) {
      setActiveTab(nextTab.key);
    }
  }, [location.hash, visibleTabs]);

  useEffect(() => {
    if (visibleTabs.some((tab) => tab.key === activeTab)) return;
    if (visibleTabs[0]?.key) {
      setActiveTab(visibleTabs[0].key);
    }
  }, [activeTab, visibleTabs]);

  useEffect(() => {
    if (!isTeacherSelfView || leaveForm.staff_member_id || !staffMembers.length) return;
    setLeaveForm((current) => ({ ...current, staff_member_id: String(staffMembers[0].id) }));
  }, [isTeacherSelfView, leaveForm.staff_member_id, staffMembers]);

  const loadStudentTab = async () => {
    try {
      setTabLoading(true);
      const [studentsRes, subjectsRes, recordsRes] = await Promise.all([
        apiService.listAttendanceStudents({ school_id: 1, limit: 500 }).catch(() =>
          apiService.listIntegratedStudents({ school_id: 1, limit: 500 })
        ),
        apiService.listAttendanceSubjects().catch(() => ({ data: [] })),
        apiService.listStudentAttendanceRecords({ school_id: 1, limit: 100 }).catch(() => ({ data: [] })),
      ]);
      const nextStudents = toArray<AttendanceStudent>(studentsRes.data);
      const normalizedBatches = buildAttendanceBatches(nextStudents, 1);
      setManagedBatches(normalizedBatches);
      setStudents(nextStudents);
      setSubjects(toArray<AttendanceSubject>(subjectsRes.data));
      setStudentRecords(toArray<StudentAttendanceRecord>(recordsRes.data));
      void loadTodayStudentDashboard(studentFilters.dashboard_date);
      if (overview) {
        hydrateDefaults(
          overview,
          nextStudents,
          normalizedBatches
        );
      }
      setLoadedTabs((current) => ({ ...current, student: true }));
    } catch (error: any) {
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'Student attendance load nahi hua.') });
    } finally {
      setTabLoading(false);
    }
  };

  const loadManagedBatches = async (options?: { force?: boolean }) => {
    const force = options?.force === true;
    const now = Date.now();
    if (!force && now - lastManagedBatchRefreshAtRef.current < attendanceStudentsRefreshCooldownMs) {
      return;
    }
    if (managedBatchRefreshInFlightRef.current) {
      return managedBatchRefreshInFlightRef.current;
    }

    const refreshPromise = (async () => {
      lastManagedBatchRefreshAtRef.current = Date.now();
      try {
        const response = await apiService.listAttendanceStudents({ school_id: 1, limit: 500 }).catch(() =>
          apiService.listIntegratedStudents({ school_id: 1, limit: 500 })
        );
        const nextStudents = toArray<AttendanceStudent>(response.data);
        setStudents(nextStudents);
        const normalizedBatches = buildAttendanceBatches(nextStudents, 1);
        setManagedBatches(normalizedBatches);
        setStudentFilters((current) => ({
          ...current,
          batch_name:
            current.batch_name && normalizedBatches.some((item) => item.name === current.batch_name)
              ? current.batch_name
              : normalizedBatches[0]?.name || '',
          record_batch_name:
            current.record_batch_name && normalizedBatches.some((item) => item.name === current.record_batch_name)
              ? current.record_batch_name
              : '',
        }));
      } catch {
        // Keep current batch options if refresh fails.
      } finally {
        managedBatchRefreshInFlightRef.current = null;
      }
    })();

    managedBatchRefreshInFlightRef.current = refreshPromise;
    return refreshPromise;
  };

  const loadStaffTab = async () => {
    try {
      setTabLoading(true);
      const [staffRes, recordsRes, dashboardRes, approvedLeavesRes] = await Promise.all([
        apiService.listAttendanceStaff({ school_id: 1, limit: 500 }).catch(() =>
          apiService.listIntegratedStaff({ school_id: 1, limit: 500 })
        ),
        apiService.listStaffAttendanceRecords({ school_id: 1, limit: 200 }).catch(() => ({ data: [] })),
        apiService.getStaffAttendanceDashboard({ school_id: 1 }).catch(() => ({ data: null })),
        apiService.listAttendanceLeaves({ school_id: 1, status: 'approved' }).catch(() => ({ data: [] })),
      ]);
      setStaffMembers(toArray<AttendanceStaff>(staffRes.data));
      setStaffApprovedLeaves(toArray<AttendanceLeave>(approvedLeavesRes.data));
      const nextRecords = toArray<StaffAttendanceRecord>(recordsRes.data);
      setStaffRecords(nextRecords);
      setStaffDashboard(normalizeStaffDashboard(dashboardRes.data, nextRecords));
      if (staffFilters.department) {
        void loadStaffMarking();
      }
      setLoadedTabs((current) => ({ ...current, staff: true }));
    } catch (error: any) {
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'Staff attendance load nahi hua.') });
    } finally {
      setTabLoading(false);
    }
  };

  const refreshApprovedStaffLeaves = async () => {
    try {
      const response = await apiService.listAttendanceLeaves({ school_id: 1, status: 'approved' });
      setStaffApprovedLeaves(toArray<AttendanceLeave>(response.data));
    } catch {
      // Keep existing approved leave data if refresh fails.
    }
  };

  const refreshStaffLeaveViews = async () => {
    await refreshApprovedStaffLeaves();

    if (loadedTabs.staff) {
      await loadStaffCalendarRecords();
      if (staffFilters.department) {
        await loadStaffMarking();
      }
    }
  };

  const loadLeavesTab = async () => {
    try {
      setTabLoading(true);
      const [leavesRes, staffRes] = await Promise.all([
        apiService.listAttendanceLeaves({ school_id: 1 }),
        staffMembers.length ? Promise.resolve({ data: staffMembers }) : apiService.listAttendanceStaff({ school_id: 1, limit: 500 }),
      ]);
      setLeaves(toArray<AttendanceLeave>(leavesRes.data));
      setStaffMembers(toArray<AttendanceStaff>(staffRes.data));
      setLoadedTabs((current) => ({ ...current, leaves: true }));
    } catch (error: any) {
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'Leave module load nahi hua.') });
    } finally {
      setTabLoading(false);
    }
  };

  useEffect(() => {
    if (tabLoading || loadedTabs[activeTab] || tabAutoLoadDone[activeTab]) return;
    setTabAutoLoadDone((current) => ({ ...current, [activeTab]: true }));
    if (activeTab === 'student') {
      void loadStudentTab();
      return;
    }
    if (activeTab === 'staff') {
      void loadStaffTab();
      return;
    }
    if (activeTab === 'leaves') {
      void loadLeavesTab();
      return;
    }
    if (activeTab === 'reports') {
      setLoadedTabs((current) => ({ ...current, [activeTab]: true }));
    }
  }, [activeTab, loading, loadedTabs, tabLoading, tabAutoLoadDone]);

  useEffect(() => {
    if (studentFilters.batch_name) {
      loadStudentMarking();
    }
  }, [studentFilters.batch_name, studentFilters.date, studentFilters.subject_id]);

  useEffect(() => {
    if (activeTab !== 'student' || !loadedTabs.student) return;
    loadTodayStudentDashboard(studentFilters.dashboard_date);
  }, [studentFilters.dashboard_date, activeTab, loadedTabs.student]);

  useEffect(() => {
    if (activeTab !== 'student' || !loadedTabs.student || user?.role !== 'teacher' || !canViewStudentTab) return;
    void loadTeacherAttendanceContext();
  }, [activeTab, loadedTabs.student, user?.role, studentFilters.date, canViewStudentTab]);

  useEffect(() => {
    if (activeTab !== 'student' || !loadedTabs.student) return;

    void loadManagedBatches({ force: false });

    const handleFocus = () => {
      if (document.visibilityState === 'hidden') return;
      void loadManagedBatches({ force: false });
    };

    window.addEventListener('focus', handleFocus);
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      void loadManagedBatches({ force: false });
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [activeTab, loadedTabs.student]);

  useEffect(() => {
    if (activeTab !== 'overview' || !loadedTabs.overview) return;

    const refreshOverview = () => {
      if (document.visibilityState === 'hidden') return;
      void loadOverviewData();
    };

    const intervalId = window.setInterval(refreshOverview, 15000);
    window.addEventListener('focus', refreshOverview);
    document.addEventListener('visibilitychange', refreshOverview);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', refreshOverview);
      document.removeEventListener('visibilitychange', refreshOverview);
    };
  }, [activeTab, loadedTabs.overview]);

  useEffect(() => {
    if (staffFilters.department) {
      loadStaffMarking();
    }
  }, [staffFilters.department, staffFilters.date]);

  useEffect(() => {
    if (activeTab !== 'staff' || !loadedTabs.staff) return;
    void loadStaffRecords();
  }, [
    activeTab,
    loadedTabs.staff,
    staffFilters.recordDepartment,
    staffFilters.recordStaffName,
    staffFilters.recordDate,
    staffFilters.dashboardDepartment,
    staffFilters.dashboardDate,
  ]);

  useEffect(() => {
    if (activeTab !== 'staff' || !loadedTabs.staff) return;
    void loadStaffCalendarRecords();
  }, [
    activeTab,
    loadedTabs.staff,
    staffFilters.department,
    staffFilters.date,
  ]);

  useEffect(() => {
    if (activeTab !== 'reports') return;
    if (managedBatches.length) return;
    void loadManagedBatches({ force: false });
  }, [activeTab, managedBatches.length]);

  const batchOptions = useMemo(
    () => managedBatches.map((item) => item.name).filter(Boolean),
    [managedBatches]
  );
  const selectedReportBatchNames = useMemo(
    () => parseCommaSeparatedValues(reportFilters.batch_names),
    [reportFilters.batch_names]
  );

  const toggleReportBatchName = (batchName: string) => {
    const currentSelections = parseCommaSeparatedValues(reportFilters.batch_names);
    const nextSelections = currentSelections.includes(batchName)
      ? currentSelections.filter((item) => item !== batchName)
      : [...currentSelections, batchName];
    setReportFilters((current) => ({
      ...current,
      batch_names: nextSelections.join(', '),
    }));
  };

  const addReportBatchName = (batchName: string) => {
    if (!batchName) return;
    const currentSelections = parseCommaSeparatedValues(reportFilters.batch_names);
    if (currentSelections.includes(batchName)) {
      setReportBatchPicker('');
      return;
    }
    setReportFilters((current) => ({
      ...current,
      batch_names: [...currentSelections, batchName].join(', '),
    }));
    setReportBatchPicker('');
  };

  const selectedBatchParts = useMemo(() => {
    return splitBatchLabel(studentFilters.batch_name);
  }, [studentFilters.batch_name]);

  const recordBatchParts = useMemo(() => {
    return splitBatchLabel(studentFilters.record_batch_name);
  }, [studentFilters.record_batch_name]);

  const calendarBatchParts = useMemo(
    () => selectedBatchParts,
    [selectedBatchParts]
  );

  const calendarBatchLabel = (studentFilters.batch_name || '').trim();
  const normalizedCalendarBatchKey = normalizeBatchComparisonKey(calendarBatchLabel);

  const batchSubjectOptions = useMemo(
    () => {
      const matchingSubjects = subjects
        .filter(
        (item) =>
          item.class_name === selectedBatchParts.className &&
          item.section === selectedBatchParts.section
        )
        .sort((a, b) => a.name.localeCompare(b.name));

      const specificSubjects = matchingSubjects.filter(
        (item) => item.name.trim().toLowerCase() !== 'general attendance'
      );

      return specificSubjects.length ? specificSubjects : matchingSubjects;
    },
    [subjects, selectedBatchParts.className, selectedBatchParts.section]
  );

  const selectedBatchSubject = useMemo(
    () =>
      batchSubjectOptions.find((item) => String(item.id) === studentFilters.subject_id) ||
      batchSubjectOptions[0] ||
      null,
    [batchSubjectOptions, studentFilters.subject_id]
  );

  useEffect(() => {
    if (activeTab !== 'student' || !loadedTabs.student) return;
    void loadBatchAttendanceContext();
  }, [activeTab, loadedTabs.student, selectedBatchParts.className, selectedBatchParts.section, studentFilters.date]);

  useEffect(() => {
    if (activeTab !== 'student' || !loadedTabs.student) return;
    void loadStudentRecords();
  }, [
    activeTab,
    loadedTabs.student,
    recordBatchParts.className,
    recordBatchParts.section,
    studentFilters.recordStudentName,
  ]);

  useEffect(() => {
    const dateFromKey = studentFilters.date_from || '';
    const dateToKey = studentFilters.date_to || '';
    const nextRecords = studentRecords.filter((record) => {
      const recordDateKey = toDateKey(record.date);
      if (!recordDateKey) return false;
      if (dateFromKey && recordDateKey < dateFromKey) return false;
      if (dateToKey && recordDateKey > dateToKey) return false;
      return true;
    });
    setFilteredStudentRecords(nextRecords);
  }, [studentRecords, studentFilters.date_from, studentFilters.date_to]);

  useEffect(() => {
    if (activeTab !== 'student' || !loadedTabs.student) return;
    if (!calendarBatchParts.className || !calendarBatchParts.section) {
      setStudentCalendarRecords([]);
      return;
    }
    void loadStudentCalendarRecords();
  }, [
    activeTab,
    loadedTabs.student,
    calendarBatchParts.className,
    calendarBatchParts.section,
    studentFilters.dashboard_date,
  ]);

  const studentBatchSummary = useMemo(() => {
    const rows = studentRecords.filter((record) => {
      if (!selectedBatchParts.className || !selectedBatchParts.section) return false;
      return (
        record.class_name === selectedBatchParts.className &&
        record.section === selectedBatchParts.section
      );
    });
    const present = rows.filter((record) => record.status === 'present').length;
    const absent = rows.filter((record) => record.status === 'absent').length;
    const late = rows.filter((record) => record.status === 'late').length;
    return { present, absent, late, total: rows.length };
  }, [studentRecords, selectedBatchParts.className, selectedBatchParts.section]);

  const selectedBatchStudentCount = useMemo(
    () =>
      students.filter(
        (student) =>
          student.class_name === recordBatchParts.className &&
          student.section === recordBatchParts.section
      ).length,
    [students, recordBatchParts.className, recordBatchParts.section]
  );

  useEffect(() => {
    if (!selectedBatchParts.className || !selectedBatchParts.section) return;

    const selectedExists = batchSubjectOptions.some((item) => String(item.id) === studentFilters.subject_id);
    const nextSubjectId = selectedExists
      ? studentFilters.subject_id
      : batchSubjectOptions[0]
        ? String(batchSubjectOptions[0].id)
        : '';

    if (nextSubjectId !== studentFilters.subject_id) {
      setStudentFilters((current) => ({
        ...current,
        subject_id: nextSubjectId,
      }));
    }
  }, [batchSubjectOptions, selectedBatchParts.className, selectedBatchParts.section, studentFilters.subject_id]);

  const todayBatchWiseSummary = useMemo(() => {
    const grouped = new Map<
      string,
      { batch_name: string; present: number; absent: number; late: number; total: number }
    >();
    for (const record of summarizeStudentDayRecords(todayStudentRecords)) {
      const key = record.batch_name;
      const current = grouped.get(key) || {
        batch_name: key,
        present: 0,
        absent: 0,
        late: 0,
        total: 0,
      };
      if (record.status === 'present') current.present += 1;
      if (record.status === 'absent') current.absent += 1;
      current.total += 1;
      grouped.set(key, current);
    }
    return Array.from(grouped.values()).sort((a, b) => a.batch_name.localeCompare(b.batch_name));
  }, [todayStudentRecords]);

  const todayOverallSummary = useMemo(() => {
    const normalizedRecords = summarizeStudentDayRecords(todayStudentRecords);
    const present = normalizedRecords.filter((record) => record.status === 'present').length;
    const absent = normalizedRecords.filter((record) => record.status === 'absent').length;
    return { present, absent, late: 0, total: normalizedRecords.length };
  }, [todayStudentRecords]);

  const calendarSourceRecords = useMemo(() => {
    if (studentCalendarUsingMonthFallback) {
      return studentCalendarRecords;
    }

    const matchedCalendarRecords = studentCalendarRecords.filter((record) => {
      if (!normalizedCalendarBatchKey) return true;
      return normalizeBatchComparisonKey(`${record.class_name} | ${record.section}`) === normalizedCalendarBatchKey;
    });

    return matchedCalendarRecords;
  }, [
    studentCalendarRecords,
    studentCalendarUsingMonthFallback,
    normalizedCalendarBatchKey,
  ]);

  const studentCalendar = useMemo(() => {
    const selectedMonthDate = parseCalendarDate(studentFilters.dashboard_date) || new Date();
    const currentYear = selectedMonthDate.getFullYear();
    const currentMonth = selectedMonthDate.getMonth();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const mapByDay = new Map<
      number,
      { status: StudentAttendanceStatus; present: number; absent: number; late: number; total: number }
    >();
    calendarSourceRecords.forEach((record) => {
      const dt = parseCalendarDate(record.date);
      if (!dt) return;
      if (dt.getFullYear() === currentYear && dt.getMonth() === currentMonth) {
        const day = dt.getDate();
        const current = mapByDay.get(day) || {
          status: record.status,
          present: 0,
          absent: 0,
          late: 0,
          total: 0,
        };
        if (record.status === 'present' || record.status === 'late') current.present += 1;
        if (record.status === 'absent') current.absent += 1;
        if (record.status === 'late') current.late += 1;
        current.total += 1;
        if (current.absent > 0) current.status = 'absent';
        else current.status = 'present';
        mapByDay.set(day, current);
      }
    });
    return Array.from({ length: daysInMonth }, (_, idx) => {
      const day = idx + 1;
      const summary = mapByDay.get(day);
      return {
        id: day,
        day,
        status: summary?.status || '',
        total: summary?.total || 0,
        present: summary?.present || 0,
        absent: summary?.absent || 0,
        late: summary?.late || 0,
      };
    });
  }, [calendarSourceRecords, studentFilters.dashboard_date]);

  const studentCalendarMarkedDates = useMemo(() => {
    const selectedMonthDate = parseCalendarDate(studentFilters.dashboard_date) || new Date();
    const currentYear = selectedMonthDate.getFullYear();
    const currentMonth = selectedMonthDate.getMonth();
    const uniqueDates = new Map<string, string>();

    calendarSourceRecords.forEach((record) => {
      const dt = parseCalendarDate(record.date);
      if (!dt) return;
      if (dt.getFullYear() !== currentYear || dt.getMonth() !== currentMonth) return;
      const key = toDateKey(record.date);
      if (!key) return;
      uniqueDates.set(
        key,
        dt.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
      );
    });

    return Array.from(uniqueDates.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, label]) => label);
  }, [calendarSourceRecords, studentFilters.dashboard_date]);
  const studentCalendarMonthLabel = formatCalendarMonthLabel(studentFilters.dashboard_date);
  const studentCalendarMonthInputValue = toMonthInputValue(studentFilters.dashboard_date);

  const todayLabel = studentFilters.dashboard_date
    ? new Date(studentFilters.dashboard_date).toLocaleDateString()
    : 'Selected Date';

  const departmentOptions = useMemo(() => {
    const staffDepartmentOptions = getUniqueDepartmentOptions(
      staffMembers.map((member) => member.department)
    );
    if (staffDepartmentOptions.length) {
      return staffDepartmentOptions;
    }
    return getUniqueDepartmentOptions(toArray<string>(overview?.department_options));
  }, [overview?.department_options, staffMembers]);
  const departmentSummary = toArray<{ department: string; present: number; absent: number; late: number; half_day: number }>(
    (staffDashboard as any)?.department_summary
  );
  const staffDepartmentWiseSummary = useMemo(
    () =>
      departmentSummary.map((summary) => ({
        ...summary,
        total:
          Number(summary.present || 0) +
          Number(summary.absent || 0) +
          Number(summary.late || 0) +
          Number(summary.half_day || 0),
      })),
    [departmentSummary]
  );

  const staffCalendar = useMemo(() => {
    const selectedMonthDate = parseCalendarDate(staffFilters.date) || new Date();
    const currentYear = selectedMonthDate.getFullYear();
    const currentMonth = selectedMonthDate.getMonth();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const mapByDay = new Map<
      number,
      { status: string; present: number; absent: number; late: number; half_day: number; leave: number; total: number }
    >();

    const staffDepartmentMap = new Map(
      staffMembers.map((member) => [member.id, String(member.department || '').trim()])
    );
    const selectedDepartmentKey = normalizeDepartmentKey(staffFilters.department);

    const approvedLeavesSet = new Set<string>();

    staffApprovedLeaves.forEach((leave) => {
      if (leave.status !== 'approved') return;
      if (selectedDepartmentKey) {
        const leaveDepartment = staffDepartmentMap.get(leave.staff_member_id) || '';
        if (normalizeDepartmentKey(leaveDepartment) !== selectedDepartmentKey) return;
      }
      const fromDate = parseCalendarDate(leave.from_date);
      const toDate = parseCalendarDate(leave.to_date);
      if (!fromDate || !toDate) return;
      for (let dayCursor = new Date(fromDate); dayCursor <= toDate; dayCursor.setDate(dayCursor.getDate() + 1)) {
        if (dayCursor.getFullYear() !== currentYear || dayCursor.getMonth() !== currentMonth) continue;
        const key = `${leave.staff_member_id}-${dateToKeyFromDate(dayCursor)}`;
        approvedLeavesSet.add(key);
        const day = dayCursor.getDate();
        const current = mapByDay.get(day) || {
          status: 'leave',
          present: 0,
          absent: 0,
          late: 0,
          half_day: 0,
          leave: 0,
          total: 0,
        };
        current.leave += 1;
        current.total += 1;
        if (current.absent === 0 && current.present === 0 && current.late === 0 && current.half_day === 0) {
          current.status = 'leave';
        }
        mapByDay.set(day, current);
      }
    });

    staffCalendarRecords.forEach((record) => {
      const dt = parseCalendarDate(record.date);
      if (!dt) return;
      if (dt.getFullYear() !== currentYear || dt.getMonth() !== currentMonth) return;
      
      const key = `${record.staff_member_id}-${dateToKeyFromDate(dt)}`;
      if (approvedLeavesSet.has(key)) return;

      const day = dt.getDate();
      const current = mapByDay.get(day) || {
        status: record.status,
        present: 0,
        absent: 0,
        late: 0,
        half_day: 0,
        leave: 0,
        total: 0,
      };

      if (record.status === 'present') current.present += 1;
      if (record.status === 'absent') current.absent += 1;
      if (record.status === 'late') current.late += 1;
      if (record.status === 'half_day') current.half_day += 1;
      current.total += 1;
      
      mapByDay.set(day, current);
    });

    for (const current of mapByDay.values()) {
      if (current.absent > 0) current.status = 'absent';
      else if (current.late > 0) current.status = 'late';
      else if (current.half_day > 0) current.status = 'half_day';
      else if (current.present > 0) current.status = 'present';
      else if (current.leave > 0) current.status = 'leave';
      else current.status = null;
    }

    return Array.from({ length: daysInMonth }, (_, idx) => {
      const day = idx + 1;
      const summary = mapByDay.get(day);
      return {
        id: day,
        day,
        status: summary?.status || null,
        total: summary?.total || 0,
        present: summary?.present || 0,
        absent: summary?.absent || 0,
        late: summary?.late || 0,
        half_day: summary?.half_day || 0,
        leave: summary?.leave || 0,
      };
    });
  }, [staffApprovedLeaves, staffCalendarRecords, staffFilters.department, staffFilters.date, staffMembers]);

  const staffCalendarMarkedDates = useMemo(() => {
    const selectedMonthDate = parseCalendarDate(staffFilters.date) || new Date();
    const currentYear = selectedMonthDate.getFullYear();
    const currentMonth = selectedMonthDate.getMonth();
    const uniqueDates = new Map<string, string>();

    staffCalendarRecords.forEach((record) => {
      const dt = parseCalendarDate(record.date);
      if (!dt) return;
      if (dt.getFullYear() !== currentYear || dt.getMonth() !== currentMonth) return;
      const key = toDateKey(record.date);
      if (!key) return;
      uniqueDates.set(
        key,
        dt.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
      );
    });

    const staffDepartmentMap = new Map(
      staffMembers.map((member) => [member.id, String(member.department || '').trim()])
    );
    const selectedDepartmentKey = normalizeDepartmentKey(staffFilters.department);
    staffApprovedLeaves.forEach((leave) => {
      if (leave.status !== 'approved') return;
      if (selectedDepartmentKey) {
        const leaveDepartment = staffDepartmentMap.get(leave.staff_member_id) || '';
        if (normalizeDepartmentKey(leaveDepartment) !== selectedDepartmentKey) return;
      }
      const fromDate = parseCalendarDate(leave.from_date);
      const toDate = parseCalendarDate(leave.to_date);
      if (!fromDate || !toDate) return;
      for (let dayCursor = new Date(fromDate); dayCursor <= toDate; dayCursor.setDate(dayCursor.getDate() + 1)) {
        if (dayCursor.getFullYear() !== currentYear || dayCursor.getMonth() !== currentMonth) continue;
        const key = dateToKeyFromDate(dayCursor);
        uniqueDates.set(
          key,
          new Date(dayCursor).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
        );
      }
    });

    return Array.from(uniqueDates.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, label]) => label);
  }, [staffApprovedLeaves, staffCalendarRecords, staffFilters.department, staffFilters.date, staffMembers]);
  const staffCalendarMonthLabel = formatCalendarMonthLabel(staffFilters.date);
  const staffCalendarMonthInputValue = toMonthInputValue(staffFilters.date);

  const staffMonthlyApprovedLeaves = useMemo(() => {
    const selectedMonthDate = parseCalendarDate(staffFilters.date) || new Date();
    const currentYear = selectedMonthDate.getFullYear();
    const currentMonth = selectedMonthDate.getMonth();
    const selectedDepartmentKey = normalizeDepartmentKey(staffFilters.department);
    const staffDepartmentMap = new Map(
      staffMembers.map((member) => [member.id, String(member.department || '').trim()])
    );

    return staffApprovedLeaves.filter((leave) => {
      if (leave.status !== 'approved') return false;
      if (selectedDepartmentKey) {
        const leaveDepartment = staffDepartmentMap.get(leave.staff_member_id) || '';
        if (normalizeDepartmentKey(leaveDepartment) !== selectedDepartmentKey) return false;
      }
      const fromDate = parseCalendarDate(leave.from_date);
      const toDate = parseCalendarDate(leave.to_date);
      if (!fromDate || !toDate) return false;

      return (
        (fromDate.getFullYear() === currentYear && fromDate.getMonth() === currentMonth) ||
        (toDate.getFullYear() === currentYear && toDate.getMonth() === currentMonth) ||
        (fromDate < new Date(currentYear, currentMonth, 1) &&
          toDate > new Date(currentYear, currentMonth + 1, 0))
      );
    });
  }, [staffApprovedLeaves, staffFilters.date, staffFilters.department, staffMembers]);

  const staffMonthlyApprovedLeaveSummary = useMemo(() => {
    const selectedMonthDate = parseCalendarDate(staffFilters.date) || new Date();
    const monthStart = new Date(selectedMonthDate.getFullYear(), selectedMonthDate.getMonth(), 1);
    const monthEnd = new Date(selectedMonthDate.getFullYear(), selectedMonthDate.getMonth() + 1, 0);

    return staffMonthlyApprovedLeaves.map((leave) => {
      const fromDate = parseCalendarDate(leave.from_date);
      const toDate = parseCalendarDate(leave.to_date);

      if (!fromDate || !toDate) {
        return {
          ...leave,
          leaveDaysInMonth: 0,
        };
      }

      const effectiveStart = fromDate > monthStart ? fromDate : monthStart;
      const effectiveEnd = toDate < monthEnd ? toDate : monthEnd;
      const millisPerDay = 24 * 60 * 60 * 1000;
      const leaveDaysInMonth =
        effectiveEnd >= effectiveStart
          ? Math.floor((effectiveEnd.getTime() - effectiveStart.getTime()) / millisPerDay) + 1
          : 0;

      return {
        ...leave,
        leaveDaysInMonth,
      };
    });
  }, [staffMonthlyApprovedLeaves, staffFilters.date]);

  const markStaffDepartmentOptions = useMemo(() => {
    const filteredStaff = staffMembers.filter((member) => {
      if (staffFilters.staffType === 'teaching') return isTeachingStaffMember(member);
      if (staffFilters.staffType === 'non_teaching') return !isTeachingStaffMember(member);
      return true;
    });

    const filteredDepartments = getUniqueDepartmentOptions(
      filteredStaff.map((member) => member.department)
    );

    return filteredDepartments.length ? filteredDepartments : departmentOptions;
  }, [departmentOptions, staffFilters.staffType, staffMembers]);

  useEffect(() => {
    if (!departmentOptions.length) return;
    setStaffFilters((current) => {
      if (!current.department) {
        return current;
      }
      if (departmentOptions.includes(current.department)) {
        return current;
      }
      return {
        ...current,
        department: '',
      };
    });
  }, [departmentOptions]);

  useEffect(() => {
    if (!markStaffDepartmentOptions.length) return;
    setStaffFilters((current) => {
      if (!current.department) {
        return current;
      }
      if (markStaffDepartmentOptions.includes(current.department)) {
        return current;
      }
      return {
        ...current,
        department: '',
      };
    });
  }, [markStaffDepartmentOptions]);

  const loadStudentMarking = async () => {
    if (!selectedBatchParts.className || !selectedBatchParts.section) return;
    const subjectId = selectedBatchSubject?.id || (batchSubjectOptions[0] ? batchSubjectOptions[0].id : undefined);
    if (!subjectId) {
      setStudentMarking(null);
      return;
    }
    try {
      const response = await apiService.getStudentAttendanceMarking({
        date: studentFilters.date,
        class_name: selectedBatchParts.className,
        section: selectedBatchParts.section,
        subject_id: subjectId,
        search: studentFilters.search || undefined,
        school_id: 1,
      });
      const payload = response.data;
      if (!payload || typeof payload !== 'object') {
        setStudentMarking(null);
        return;
      }
      setStudentMarking({
        ...(payload as StudentAttendanceMarkingResponse),
        students: toArray<StudentAttendanceMarkingRow>(
          (payload as StudentAttendanceMarkingResponse).students
        ),
      });
    } catch (error: any) {
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'Student marking load nahi hua.') });
    }
  };

  const loadTeacherAttendanceContext = async () => {
    if (user?.role !== 'teacher') return;
    try {
      const response = await apiService.getTeacherAttendanceContext({
        target_date: studentFilters.date,
        current_time: getCurrentTimeHHMM(),
        school_id: 1,
      });
      const context = response.data;
      setTeacherAttendanceContext(context);
      upsertAttendanceSubject(context);
      if (!context.class_name || !context.section) {
        setAlert({ type: 'warning', message: 'Aaj ke liye teacher ki timetable class abhi match nahi hui.' });
        return;
      }
      setStudentFilters((current) => ({
        ...current,
        batch_name: `${context.class_name} | ${context.section}`,
        subject_id: context.subject_id ? String(context.subject_id) : current.subject_id,
      }));
    } catch (error: any) {
      setTeacherAttendanceContext(null);
      setAlert({ type: 'warning', message: getApiErrorMessage(error, 'Teacher timetable se class auto-load nahi hui.') });
    }
  };

  const loadBatchAttendanceContext = async () => {
    if (!selectedBatchParts.className || !selectedBatchParts.section) {
      setBatchAttendanceContext(null);
      return;
    }
    try {
      const response = await apiService.getBatchAttendanceContext({
        class_name: selectedBatchParts.className,
        section: selectedBatchParts.section,
        target_date: studentFilters.date,
        current_time: getCurrentTimeHHMM(),
        school_id: 1,
      });
      const context = response.data;
      setBatchAttendanceContext(context);
      upsertAttendanceSubject(context);
      if (context.subject_id) {
        setStudentFilters((current) => ({
          ...current,
          subject_id: String(context.subject_id),
        }));
      }
    } catch {
      setBatchAttendanceContext(null);
    }
  };

  const loadStudentRecords = async () => {
    try {
      const response = await apiService.listStudentAttendanceRecords({
        school_id: 1,
        class_name: recordBatchParts.className || undefined,
        section: recordBatchParts.section || undefined,
        student_name: studentFilters.recordStudentName || undefined,
        limit: 500,
      });
      setStudentRecords(toArray<StudentAttendanceRecord>(response.data));
    } catch (error: any) {
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'Student records load nahi hue.') });
    }
  };

  const loadStudentCalendarRecords = async () => {
    if (!calendarBatchParts.className || !calendarBatchParts.section) {
      setStudentCalendarRecords([]);
      setStudentCalendarUsingMonthFallback(false);
      return;
    }
    try {
      const monthRange = getMonthRange(studentFilters.dashboard_date);
      const response = await apiService.listStudentAttendanceRecords({
        school_id: 1,
        class_name: calendarBatchParts.className,
        section: calendarBatchParts.section,
        date_from: monthRange.from || undefined,
        date_to: monthRange.to || undefined,
        limit: 500,
      });
      const exactMatchRecords = toArray<StudentAttendanceRecord>(response.data);
      if (exactMatchRecords.length) {
        setStudentCalendarUsingMonthFallback(false);
        setStudentCalendarRecords(exactMatchRecords);
        return;
      }

      const fallbackRows: StudentAttendanceRecord[] = [];
      let skip = 0;
      while (true) {
        const fallbackResponse = await apiService.listStudentAttendanceRecords({
          school_id: 1,
          date_from: monthRange.from || undefined,
          date_to: monthRange.to || undefined,
          skip,
          limit: 500,
        });
        const chunk = toArray<StudentAttendanceRecord>(fallbackResponse.data);
        if (!chunk.length) break;
        fallbackRows.push(...chunk);
        if (chunk.length < 500) break;
        skip += 500;
      }

      const normalizedBatchKey = normalizeBatchComparisonKey(calendarBatchLabel);
      const matchedFallbackRows = fallbackRows.filter((record) => {
        if (!normalizedBatchKey) return true;
        return normalizeBatchComparisonKey(`${record.class_name} | ${record.section}`) === normalizedBatchKey;
      });
      const useMonthFallback = matchedFallbackRows.length === 0 && fallbackRows.length > 0;
      setStudentCalendarUsingMonthFallback(useMonthFallback);
      setStudentCalendarRecords(useMonthFallback ? fallbackRows : matchedFallbackRows);
    } catch (error: any) {
      setStudentCalendarRecords([]);
      setStudentCalendarUsingMonthFallback(false);
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'Calendar dates load nahi hui.') });
    }
  };

  const loadTodayStudentDashboard = async (targetDate: string = studentFilters.dashboard_date) => {
    try {
      const rows: StudentAttendanceRecord[] = [];
      let skip = 0;
      while (true) {
        const response = await apiService.listStudentAttendanceRecords({
          school_id: 1,
          date_from: targetDate,
          date_to: targetDate,
          skip,
          limit: 500,
        });
        const chunk = toArray<StudentAttendanceRecord>(response.data);
        rows.push(...chunk);
        if (chunk.length < 500) break;
        skip += 500;
      }
      setTodayStudentRecords(rows);
    } catch (error: any) {
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'Aaj ka batch dashboard load nahi hua.') });
    }
  };

  const loadStaffMarking = async () => {
    if (!staffFilters.department) return;
    try {
      const response = await apiService.getStaffAttendanceMarking({
        date: staffFilters.date,
        department: staffFilters.department,
        search: staffFilters.search || undefined,
        school_id: 1,
      });
      const payload = response.data;
      if (!payload || typeof payload !== 'object') {
        setStaffMarking(null);
        return;
      }
      setStaffMarking({
        ...(payload as StaffAttendanceMarkingResponse),
        staff: toArray<StaffAttendanceMarkingRow>(
          (payload as StaffAttendanceMarkingResponse).staff
        ),
      });
    } catch (error: any) {
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'Staff marking load nahi hua.') });
    }
  };

  const loadStaffRecords = async () => {
    try {
      const dashboardPromise = staffFilters.dashboardDate
        ? apiService.getStaffAttendanceDashboard({
            school_id: 1,
            department: staffFilters.dashboardDepartment || undefined,
            date_from: staffFilters.dashboardDate || undefined,
            date_to: staffFilters.dashboardDate || undefined,
          })
        : Promise.resolve({ data: null });
      const [recordsRes, dashboardRes] = await Promise.all([
        apiService.listStaffAttendanceRecords({
          school_id: 1,
          department: staffFilters.recordDepartment || undefined,
          staff_name: staffFilters.recordStaffName || undefined,
          date_from: staffFilters.recordDate || undefined,
          date_to: staffFilters.recordDate || undefined,
          limit: 300,
        }),
        dashboardPromise,
      ]);
      const nextRecords = toArray<StaffAttendanceRecord>(recordsRes.data);
      setStaffRecords(nextRecords);
      setStaffDashboard(staffFilters.dashboardDate ? normalizeStaffDashboard(dashboardRes.data, nextRecords) : null);
    } catch (error: any) {
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'Staff records load nahi hue.') });
    }
  };

  const loadStaffCalendarRecords = async () => {
    try {
      const monthRange = getMonthRange(staffFilters.date);
      const response = await apiService.listStaffAttendanceRecords({
        school_id: 1,
        department: staffFilters.department || undefined,
        date_from: monthRange.from || undefined,
        date_to: monthRange.to || undefined,
        limit: 500,
      });
      setStaffCalendarRecords(toArray<StaffAttendanceRecord>(response.data));
    } catch {
      setStaffCalendarRecords([]);
    }
  };

  const handleSaveStudentAttendance = async () => {
    if (!studentMarking) return;
    try {
      await apiService.saveStudentAttendance({
        date: studentFilters.date,
        subject_id: studentMarking.subject_id,
        marked_by: visibleAttendanceContext?.teacher_name || user?.full_name || 'Attendance Department',
        entries: studentMarking.students.map((item) => ({
          student_id: item.student_id,
          status: item.status,
          absence_reason: item.status === 'absent' ? item.absence_reason : undefined,
        })),
      });
      setAlert({ type: 'success', message: 'Student attendance save ho gayi.' });
      await Promise.all([
        loadStudentRecords(),
        loadStudentCalendarRecords(),
        loadTodayStudentDashboard(studentFilters.dashboard_date),
        loadOverviewData(),
      ]);
    } catch (error: any) {
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'Student attendance save nahi hui.') });
    }
  };

  const handleSaveStaffAttendance = async () => {
    if (!staffMarking) return;
    try {
      await apiService.saveStaffAttendance({
        date: staffFilters.date,
        marked_by: 'HR Admin',
        entries: staffMarking.staff.map((item) => ({
          staff_member_id: item.staff_member_id,
          status: item.status,
          check_in: item.check_in,
          check_out: item.check_out,
        })),
      });
      setAlert({ type: 'success', message: 'Staff attendance save ho gayi.' });
      await Promise.all([
        loadStaffRecords(),
        loadStaffCalendarRecords(),
        loadOverviewData(),
      ]);
    } catch (error: any) {
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'Staff attendance save nahi hui.') });
    }
  };

  const handleCreateHoliday = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      await apiService.createAttendanceHoliday({
        ...holidayForm,
        holiday_date: holidayForm.holiday_date,
        description: holidayForm.description || undefined,
      });
      setHolidayForm(initialHolidayForm);
      setAlert({ type: 'success', message: 'Holiday add ho gayi.' });
      await loadOverviewData();
    } catch (error: any) {
      setAlert({ type: 'error', message: error?.response?.data?.detail || 'Holiday add nahi hui.' });
    }
  };

  const handleCreateLeave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      await apiService.createAttendanceLeave({
        staff_member_id: Number(leaveForm.staff_member_id),
        leave_type: leaveForm.leave_type,
        from_date: leaveForm.from_date,
        to_date: leaveForm.to_date,
        reason: leaveForm.reason || undefined,
      });
      setLeaveForm(initialLeaveForm);
      setAlert({ type: 'success', message: 'Leave application submit ho gayi.' });
      const response = await apiService.listAttendanceLeaves({ school_id: 1 });
      setLeaves(toArray<AttendanceLeave>(response.data));
      await refreshStaffLeaveViews();
      await loadOverviewData();
    } catch (error: any) {
      setAlert({ type: 'error', message: error?.response?.data?.detail || 'Leave apply nahi hui.' });
    }
  };

  const handleLeaveDecision = async (leaveId: number, nextStatus: AttendanceLeaveStatus) => {
    try {
      await apiService.decideAttendanceLeave(leaveId, {
        status: nextStatus === 'approved' ? 'approved' : 'rejected',
        approved_by: 'HR Admin',
      });
      setAlert({ type: 'success', message: `Leave ${nextStatus} ho gayi.` });
      const response = await apiService.listAttendanceLeaves({ school_id: 1 });
      setLeaves(toArray<AttendanceLeave>(response.data));
      await refreshStaffLeaveViews();
      await loadOverviewData();
    } catch (error: any) {
      setAlert({ type: 'error', message: error?.response?.data?.detail || 'Leave decision save nahi hua.' });
    }
  };

  const handleDeleteNotification = async (notificationId: number) => {
    if (!window.confirm('Delete this notification?')) return;
    try {
      await apiService.deleteAttendanceNotification(notificationId);
      setAlert({ type: 'success', message: 'Notification delete ho gayi.' });
      await loadOverviewData();
    } catch (error: any) {
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'Notification delete nahi hui.') });
    }
  };

  const handleDeleteHoliday = async (holidayId: number) => {
    if (!window.confirm('Delete this holiday?')) return;
    try {
      await apiService.deleteAttendanceHoliday(holidayId);
      setAlert({ type: 'success', message: 'Holiday delete ho gayi.' });
      await loadOverviewData();
    } catch (error: any) {
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'Holiday delete nahi hui.') });
    }
  };

  const handleDeleteStudentRecord = async (recordId: number) => {
    if (!window.confirm('Delete this student attendance record?')) return;
    try {
      await apiService.deleteStudentAttendanceRecord(recordId);
      setAlert({ type: 'success', message: 'Student attendance record delete ho gaya.' });
      await Promise.all([
        loadStudentTab(),
        loadOverviewData(),
      ]);
    } catch (error: any) {
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'Student attendance record delete nahi hua.') });
    }
  };

  const handleDeleteStaffRecord = async (recordId: number) => {
    if (!window.confirm('Delete this staff attendance record?')) return;
    try {
      await apiService.deleteStaffAttendanceRecord(recordId);
      setAlert({ type: 'success', message: 'Staff attendance record delete ho gaya.' });
      await loadStaffRecords();
      await loadOverviewData();
    } catch (error: any) {
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'Staff attendance record delete nahi hua.') });
    }
  };

  const handleDeleteLeave = async (leaveId: number) => {
    if (!window.confirm('Delete this leave request?')) return;
    try {
      await apiService.deleteAttendanceLeave(leaveId);
      setAlert({ type: 'success', message: 'Leave request delete ho gayi.' });
      const response = await apiService.listAttendanceLeaves({ school_id: 1 });
      setLeaves(toArray<AttendanceLeave>(response.data));
      await refreshStaffLeaveViews();
      await loadOverviewData();
    } catch (error: any) {
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'Leave request delete nahi hui.') });
    }
  };

  const handleDeleteAllNotifications = async () => {
    if (!window.confirm('Delete all attendance notifications?')) return;
    try {
      await apiService.deleteAllAttendanceNotifications();
      setAlert({ type: 'success', message: 'All notifications delete ho gayi.' });
      await loadOverviewData();
    } catch (error: any) {
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'All notifications delete nahi hui.') });
    }
  };

  const handleDeleteAllHolidays = async () => {
    if (!window.confirm('Delete all holidays?')) return;
    try {
      await apiService.deleteAllAttendanceHolidays();
      setAlert({ type: 'success', message: 'All holidays delete ho gayi.' });
      await loadOverviewData();
    } catch (error: any) {
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'All holidays delete nahi hui.') });
    }
  };

  const handleDeleteAllStudentRecords = async () => {
    if (!window.confirm('Current filters ke hisaab se saare student attendance records delete karne hain?')) return;
    const [class_name, section] = studentFilters.record_batch_name.includes('|')
      ? studentFilters.record_batch_name.split('|').map((item) => item.trim())
      : ['', ''];
    try {
      await apiService.deleteAllStudentAttendanceRecords({
        school_id: 1,
        class_name: class_name || undefined,
        section: section || undefined,
        student_name: studentFilters.recordStudentName || undefined,
        date_from: studentFilters.date_from || undefined,
        date_to: studentFilters.date_to || undefined,
      });
      setAlert({ type: 'success', message: 'Filtered student attendance records delete ho gaye.' });
      await Promise.all([
        loadStudentTab(),
        loadOverviewData(),
      ]);
    } catch (error: any) {
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'Student attendance records delete nahi hue.') });
    }
  };

  const handleDeleteAllStaffRecords = async () => {
    if (!window.confirm('Current filters ke hisaab se saare staff attendance records delete karne hain?')) return;
    try {
      await apiService.deleteAllStaffAttendanceRecords({
        school_id: 1,
        department: staffFilters.recordDepartment || undefined,
        staff_name: staffFilters.recordStaffName || undefined,
        date_from: staffFilters.recordDate || undefined,
        date_to: staffFilters.recordDate || undefined,
      });
      setAlert({ type: 'success', message: 'Filtered staff attendance records delete ho gaye.' });
      await loadStaffRecords();
      await loadOverviewData();
    } catch (error: any) {
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'Staff attendance records delete nahi hue.') });
    }
  };

  const handleDeleteAllLeaves = async () => {
    if (!window.confirm('Delete all leave requests?')) return;
    try {
      await apiService.deleteAllAttendanceLeaves({ school_id: 1 });
      setAlert({ type: 'success', message: 'All leave requests delete ho gayi.' });
      const response = await apiService.listAttendanceLeaves({ school_id: 1 });
      setLeaves(toArray<AttendanceLeave>(response.data));
      await refreshStaffLeaveViews();
      await loadOverviewData();
    } catch (error: any) {
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'All leave requests delete nahi hui.') });
    }
  };

  const handleRunReport = async () => {
    try {
      const response = await apiService.getAttendanceReportData({
        report_type: reportFilters.report_type,
        school_id: 1,
        batch_names: reportFilters.batch_names || undefined,
        department: reportFilters.department || undefined,
        date_from: reportFilters.date_from || undefined,
        date_to: reportFilters.date_to || undefined,
      });
      const report = response.data;
      if (!report || typeof report !== 'object') {
        setReportData(null);
        return;
      }
      setReportData({
        ...(report as AttendanceReportResponse),
        rows: toArray((report as AttendanceReportResponse).rows),
      });
    } catch (error: any) {
      setAlert({ type: 'error', message: error?.response?.data?.detail || 'Report load nahi hua.' });
    }
  };

  const handleExportReport = async (format: 'excel' | 'pdf') => {
    try {
      const response = await apiService.exportAttendanceReport({
        report_type: reportFilters.report_type,
        export_format: format,
        school_id: 1,
        batch_names: reportFilters.batch_names || undefined,
        department: reportFilters.department || undefined,
        date_from: reportFilters.date_from || undefined,
        date_to: reportFilters.date_to || undefined,
      });
      downloadBlob(response.data, `attendance-${reportFilters.report_type}.${format === 'excel' ? 'xlsx' : 'pdf'}`);
    } catch (error: any) {
      setAlert({ type: 'error', message: error?.response?.data?.detail || 'Report export nahi hua.' });
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50">
      <main className="mx-auto max-w-[1550px] p-3 sm:p-4 md:p-6 xl:p-8">
        <section className="rounded-[2rem] bg-white p-4 shadow-xl sm:p-6 lg:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.2em] text-indigo-600">Admin Office</p>
              <h1 className="mt-3 text-4xl font-bold text-slate-900">
                {isTeacherSelfView ? 'Teacher Attendance Workspace' : 'Attendance Management System'}
              </h1>
              <p className="mt-4 max-w-3xl text-slate-600">
                {isTeacherSelfView
                  ? 'Aapki class attendance, aapki attendance history, aur aapki leave requests yahin dikhenge.'
                  : 'Student Attendance, Staff Attendance, Leave Management, Notifications, and Reports from one Admin Office workspace.'}
              </p>
            </div>
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
              <HeroMetric label="Students" value={`${overview?.student_count || 0}`} />
              <HeroMetric label="Staff" value={`${overview?.staff_count || 0}`} />
            </div>
          </div>
          <div className="mt-6 flex gap-2 overflow-x-auto rounded-[1.5rem] bg-slate-50 p-2">
            {visibleTabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`shrink-0 rounded-full px-4 py-2.5 text-sm font-medium transition ${
                  activeTab === tab.key
                    ? 'bg-indigo-600 text-white shadow-md'
                    : 'text-slate-600 hover:bg-white hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </section>

        {alert ? (
          <div className="mt-6">
            <Alert message={alert.message} type={alert.type} onClose={() => setAlert(null)} />
          </div>
        ) : null}

        {loading ? (
          <div className="mt-6">
            <LoadingSpinner message="Attendance Management module load ho raha hai..." />
          </div>
        ) : null}

        {tabLoading ? (
          <div className="mt-6">
            <LoadingSpinner message="Attendance tab load ho raha hai..." />
          </div>
        ) : null}

        {!isTeacherSelfView && activeTab === 'overview' ? (
          <div className="mt-6 grid gap-6">
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Notifications" value={`${notifications.length}`} icon={Bell} tone="indigo" />
              <StatCard label="Pending Leaves" value={`${leaves.filter((item) => item.status === 'pending').length}`} icon={ClipboardCheck} tone="amber" />
              <StatCard label="Departments" value={`${overview?.department_options?.length || 0}`} icon={UserCheck} tone="emerald" />
              <StatCard label="Holidays" value={`${holidays.length}`} icon={CalendarDays} tone="rose" />
            </section>

            <section className="grid gap-6 xl:grid-cols-2">
              <div className={sectionClass}>
                <h2 className="text-2xl font-bold text-slate-900">Student Overview</h2>
                <div className="mt-6 grid gap-4 md:grid-cols-3">
                  <SmallMetricCard label="Total Students" value={`${overview?.student_count || 0}`} tone="indigo" />
                  <SmallMetricCard label="Present" value={`${studentBatchSummary.present}`} tone="emerald" />
                  <SmallMetricCard label="Absent" value={`${studentBatchSummary.absent}`} tone="rose" />
                </div>
              </div>
              <div className={sectionClass}>
                <h2 className="text-2xl font-bold text-slate-900">Staff Overview</h2>
                <div className="mt-6 grid gap-4 md:grid-cols-3">
                  <SmallMetricCard label="Total Staff" value={`${overview?.staff_count || 0}`} tone="indigo" />
                  <SmallMetricCard label="Present" value={`${staffDashboard?.present_count || 0}`} tone="emerald" />
                  <SmallMetricCard label="Absent" value={`${staffDashboard?.absent_count || 0}`} tone="rose" />
                </div>
              </div>
            </section>

            <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
              <div className={sectionClass}>
                <div className="flex items-center justify-between gap-4">
                  <h2 className="text-2xl font-bold text-slate-900">Recent Notifications</h2>
                  <button type="button" onClick={handleDeleteAllNotifications} className={deleteAllButtonClass}>
                    Delete All
                  </button>
                </div>
                <div className="mt-6 space-y-3">
                  {notifications.map((item) => (
                    <div key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{item.message}</p>
                          <p className="mt-1 text-sm text-slate-500">{item.notification_type}</p>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <span className="text-xs text-slate-400">{formatDate(item.created_at)}</span>
                          <button type="button" onClick={() => handleDeleteNotification(item.id)} className={deleteButtonClass}>
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className={sectionClass}>
                <div className="flex items-center justify-between gap-4">
                  <h2 className="text-2xl font-bold text-slate-900">Holiday Calendar</h2>
                  <button type="button" onClick={handleDeleteAllHolidays} className={deleteAllButtonClass}>
                    Delete All
                  </button>
                </div>
                <div className="mt-6 space-y-3">
                  {holidays.map((holiday) => (
                    <div key={holiday.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{holiday.title}</p>
                          <p className="mt-1 text-sm text-slate-500">{formatDate(holiday.holiday_date)}</p>
                          <p className="mt-2 text-sm text-slate-600">{holiday.description || 'No description'}</p>
                        </div>
                        <button type="button" onClick={() => handleDeleteHoliday(holiday.id)} className={deleteButtonClass}>
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>
        ) : null}

        {activeTab === 'student' ? (
          <div className="mt-6 grid gap-6">
            <section className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
              <div className={`${sectionClass} min-w-0`}>
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-bold text-slate-900">Mark Student Attendance</h2>
                    <p className="mt-2 text-sm text-slate-500">
                      {user?.role === 'teacher'
                        ? 'Teacher timetable ke hisaab se class aur subject auto-load honge.'
                        : 'Date aur batch select karke attendance mark karein.'}
                    </p>
                    {visibleAttendanceContext?.class_name ? (
                      <p className="mt-2 text-sm text-indigo-600">
                        {visibleAttendanceContext.teacher_name ? `${visibleAttendanceContext.teacher_name}: ` : ''}
                        {visibleAttendanceContext.class_name} | {visibleAttendanceContext.section}
                        {visibleAttendanceContext.subject ? ` | ${visibleAttendanceContext.subject}` : ''}
                        {visibleAttendanceContext.start_time && visibleAttendanceContext.end_time
                          ? ` | ${visibleAttendanceContext.start_time} - ${visibleAttendanceContext.end_time}`
                          : ''}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    {user?.role === 'teacher' ? (
                      <button
                        type="button"
                        onClick={() => void loadTeacherAttendanceContext()}
                        className="rounded-full border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-100"
                      >
                        Auto Load My Class
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() =>
                        setStudentMarking((current) =>
                          current
                            ? {
                                ...current,
                                students: current.students.map((student) => ({
                                  ...student,
                                  status: 'present',
                                  absence_reason: undefined,
                                })),
                              }
                            : current
                        )
                      }
                      className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
                    >
                      Mark All Present
                    </button>
                  </div>
                </div>

                <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Date</p>
                    <input type="date" value={studentFilters.date} onChange={(e) => setStudentFilters({ ...studentFilters, date: e.target.value })} className={inputClass} />
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Batch</p>
                    <SelectField value={studentFilters.batch_name} onChange={(e) => setStudentFilters({ ...studentFilters, batch_name: e.target.value })}>
                      <option value="">Batch</option>
                      {batchOptions.map((item) => (
                        <option key={item} value={item}>{item}</option>
                      ))}
                    </SelectField>
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Subject</p>
                    <SelectField
                      value={studentFilters.subject_id}
                      onChange={(e) => setStudentFilters({ ...studentFilters, subject_id: e.target.value })}
                      disabled={!studentFilters.batch_name || !batchSubjectOptions.length}
                    >
                      <option value="">
                        {!studentFilters.batch_name
                          ? 'Select batch first'
                          : batchSubjectOptions.length
                            ? 'Select subject'
                            : 'No subject available'}
                      </option>
                      {batchSubjectOptions.map((item) => (
                        <option key={item.id} value={String(item.id)}>
                          {item.name}
                        </option>
                      ))}
                    </SelectField>
                  </div>
                </div>

                <div className="mt-4 flex gap-3">
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      value={studentFilters.search}
                      onChange={(e) => setStudentFilters({ ...studentFilters, search: e.target.value })}
                      className="w-full rounded-2xl border border-slate-300 bg-white py-3 pl-11 pr-4 text-sm text-slate-900 outline-none focus:border-slate-900 focus:ring-4 focus:ring-slate-200/70"
                      placeholder="Search student by name"
                    />
                  </div>
                  <button onClick={loadStudentMarking} className="rounded-full bg-indigo-600 px-5 py-3 text-sm font-semibold text-white hover:bg-indigo-700">
                    Load
                  </button>
                </div>

                <div className="mt-6 max-h-[26rem] overflow-auto rounded-[1.5rem] border border-slate-200">
                  <div className="grid min-w-[46rem] grid-cols-[0.8fr_1.3fr_1.7fr] gap-4 bg-slate-50 px-4 py-3 text-xs uppercase tracking-[0.22em] text-slate-500">
                    <span>Roll No</span>
                    <span>Student Name</span>
                    <span>Attendance Status / Remark</span>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {studentMarking?.students?.length ? studentMarking.students.map((student) => (
                      <div key={student.student_id} className="grid min-w-[46rem] grid-cols-[0.8fr_1.3fr_1.7fr] gap-4 px-4 py-4 text-sm text-slate-700">
                        <span>{student.roll_no}</span>
                        <span>{student.student_name}</span>
                        <div className="space-y-2">
                          <div className="flex flex-wrap gap-2">
                            {(['present', 'absent'] as StudentAttendanceStatus[]).map((status) => (
                              <button
                                key={status}
                                type="button"
                                onClick={() =>
                                  setStudentMarking((current) =>
                                    current
                                      ? {
                                          ...current,
                                          students: current.students.map((row) =>
                                            row.student_id === student.student_id
                                              ? {
                                                  ...row,
                                                  status,
                                                  absence_reason: status === 'absent' ? row.absence_reason || '' : undefined,
                                                }
                                              : row
                                          ),
                                        }
                                      : current
                                  )
                                }
                                className={`${statusButtonBase} ${
                                  student.status === status ? studentStatusClass(status) : 'bg-slate-100 text-slate-600'
                                }`}
                              >
                                {status}
                              </button>
                            ))}
                          </div>
                          {student.status === 'absent' ? (
                            <input
                              value={student.absence_reason || ''}
                              onChange={(e) =>
                                setStudentMarking((current) =>
                                  current
                                    ? {
                                        ...current,
                                        students: current.students.map((row) =>
                                          row.student_id === student.student_id
                                            ? { ...row, absence_reason: e.target.value }
                                            : row
                                        ),
                                      }
                                    : current
                                )
                              }
                              className="w-full rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-slate-700 outline-none focus:border-amber-400"
                              placeholder="Absent reason / remark"
                            />
                          ) : null}
                        </div>
                      </div>
                    )) : (
                      <div className="px-4 py-8 text-center text-sm text-slate-500">
                        Student attendance data load nahi hua. Batch select karke `Load` dabayein.
                      </div>
                    )}
                  </div>
                </div>

                <button onClick={handleSaveStudentAttendance} className="mt-6 rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800">
                  Save Attendance
                </button>
              </div>

              <div className="grid min-w-0 gap-6">
                <div className={`${sectionClass} min-w-0`}>
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <h2 className="text-2xl font-bold text-slate-900">Student Records</h2>
                      <p className="mt-2 text-sm text-slate-500">Batch-wise records with total students count.</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button onClick={loadStudentRecords} className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
                        Apply Filters
                      </button>
                      <button type="button" onClick={handleDeleteAllStudentRecords} className={deleteAllButtonClass}>
                        Delete All
                      </button>
                    </div>
                  </div>
                  <p className="mt-4 text-sm text-slate-600">Selected batch total students: <span className="font-semibold text-slate-900">{selectedBatchStudentCount}</span></p>
                  <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <SelectField value={studentFilters.record_batch_name} onChange={(e) => setStudentFilters({ ...studentFilters, record_batch_name: e.target.value })}>
                      <option value="">All Batches</option>
                      {batchOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                    </SelectField>
                    <input value={studentFilters.recordStudentName} onChange={(e) => setStudentFilters({ ...studentFilters, recordStudentName: e.target.value })} className={inputClass} placeholder="Student name" />
                    <input type="date" value={studentFilters.date_from} onChange={(e) => setStudentFilters({ ...studentFilters, date_from: e.target.value })} className={inputClass} />
                    <input type="date" value={studentFilters.date_to} onChange={(e) => setStudentFilters({ ...studentFilters, date_to: e.target.value })} className={inputClass} />
                  </div>
                  <div className="mt-6 max-h-72 overflow-auto rounded-[1.5rem] border border-slate-200">
                    <div className="grid min-w-[52rem] grid-cols-[1.2fr_1fr_1fr_0.8fr_0.7fr] gap-4 bg-slate-50 px-4 py-3 text-xs uppercase tracking-[0.22em] text-slate-500">
                      <span>Student</span>
                      <span>Batch</span>
                      <span>Date / Class</span>
                      <span>Status</span>
                      <span>Action</span>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {filteredStudentRecords.map((record) => (
                        <div key={record.id} className="grid min-w-[52rem] grid-cols-[1.2fr_1fr_1fr_0.8fr_0.7fr] gap-4 px-4 py-3 text-sm text-slate-700">
                          <div>
                            <p>{record.student_name}</p>
                            {record.subject_name ? <p className="mt-1 text-xs text-slate-500">Subject: {record.subject_name}</p> : null}
                            {record.marked_by ? <p className="mt-1 text-xs text-slate-500">Teacher: {record.marked_by}</p> : null}
                            {record.absence_reason ? <p className="mt-1 text-xs text-amber-700">Remark: {record.absence_reason}</p> : null}
                          </div>
                          <span>{record.class_name} | {record.section}</span>
                          <div>
                            <p>{formatDate(record.date)}</p>
                            <p className="mt-1 text-xs text-slate-500">{record.class_name} | {record.section}</p>
                          </div>
                          <span className={studentRecordStatusClass(record.status)}>{record.status}</span>
                          <button type="button" onClick={() => handleDeleteStudentRecord(record.id)} className={studentRecordDeleteButtonClass}>
                            Delete
                          </button>
                        </div>
                      ))}
                      {!filteredStudentRecords.length ? (
                        <div className="px-4 py-5 text-sm text-slate-500">Selected filters ke hisaab se koi student record nahi mila.</div>
                      ) : null}
                    </div>
                  </div>
                </div>

                <div className={`${sectionClass} min-w-0`}>
                  <div>
                    <h2 className="text-2xl font-bold text-slate-900">Student Dashboard</h2>
                    <p className="mt-2 text-sm text-slate-500">Selected date ({todayLabel}) ke saare batches ka present/absent summary.</p>
                    <p className="mt-2 text-sm text-slate-600">
                      Calendar source:
                      <span className="font-semibold text-slate-900">
                        {' '}
                        {calendarBatchLabel
                          ? `Attendance Batch - ${calendarBatchLabel}`
                          : 'Mark Student Attendance se batch select karein'}
                      </span>
                    </p>
                    <p className="mt-2 text-sm text-slate-600">
                      Marked Dates:
                      <span className="font-semibold text-slate-900">
                        {' '}
                        {studentCalendarMarkedDates.length
                          ? studentCalendarMarkedDates.join(', ')
                          : 'No marked dates in selected month'}
                      </span>
                    </p>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <input
                      type="date"
                      value={studentFilters.dashboard_date}
                      onChange={(e) => setStudentFilters({ ...studentFilters, dashboard_date: e.target.value })}
                      className={`${inputClass} max-w-xs`}
                    />
                    <button
                      type="button"
                      onClick={() => loadTodayStudentDashboard(studentFilters.dashboard_date)}
                      className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                    >
                      Load Date
                    </button>
                  </div>
                  <div className="mt-6 grid gap-4 md:grid-cols-4">
                    <SmallMetricCard label="Present" value={`${todayOverallSummary.present}`} tone="emerald" />
                    <SmallMetricCard label="Absent" value={`${todayOverallSummary.absent}`} tone="rose" />
                    <SmallMetricCard label="Late" value={`${todayOverallSummary.late}`} tone="amber" />
                    <SmallMetricCard label="Total" value={`${todayOverallSummary.total}`} tone="indigo" />
                  </div>
                  <div className="mt-6 max-h-56 overflow-auto rounded-[1.5rem] border border-slate-200">
                    <div className="grid grid-cols-[1.2fr_0.6fr_0.6fr_0.6fr_0.6fr] gap-4 bg-slate-50 px-4 py-3 text-xs uppercase tracking-[0.22em] text-slate-500">
                      <span>Batch</span>
                      <span>Present</span>
                      <span>Absent</span>
                      <span>Late</span>
                      <span>Total</span>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {todayBatchWiseSummary.map((item) => (
                        <div key={item.batch_name} className="grid grid-cols-[1.2fr_0.6fr_0.6fr_0.6fr_0.6fr] gap-4 px-4 py-3 text-sm text-slate-700">
                          <span>{item.batch_name}</span>
                          <span>{item.present}</span>
                          <span>{item.absent}</span>
                          <span>{item.late}</span>
                          <span>{item.total}</span>
                        </div>
                      ))}
                      {!todayBatchWiseSummary.length ? (
                        <div className="px-4 py-5 text-sm text-slate-500">Selected date ke liye attendance data available nahi hai.</div>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-6">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-semibold text-slate-900">Calendar View</h3>
                        <p className="mt-1 text-sm font-medium text-slate-600">{studentCalendarMonthLabel}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        <input
                          type="month"
                          value={studentCalendarMonthInputValue}
                          onChange={(e) =>
                            setStudentFilters((current) => ({
                              ...current,
                              dashboard_date: applyMonthInputValue(current.dashboard_date, e.target.value),
                            }))
                          }
                          className={`${inputClass} min-w-[10rem]`}
                        />
                        <div className="inline-flex overflow-hidden rounded-full border border-slate-300 bg-white">
                          <button
                            type="button"
                            onClick={() =>
                              setStudentFilters((current) => ({
                                ...current,
                                dashboard_date: shiftMonthValue(current.dashboard_date, -1),
                              }))
                            }
                            className="px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                          >
                            Previous
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setStudentFilters((current) => ({
                                ...current,
                                dashboard_date: shiftMonthValue(current.dashboard_date, 1),
                              }))
                            }
                            className="border-l border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                          >
                            Next
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      <span className="rounded-full border border-emerald-200 bg-emerald-100 px-3 py-1 text-emerald-800">Present shade</span>
                      <span className="rounded-full border border-rose-200 bg-rose-100 px-3 py-1 text-rose-800">Absent shade</span>
                    </div>
                    {calendarBatchLabel ? (
                      <div className="mt-4 grid grid-cols-7 gap-2">
                        {studentCalendar.map((record) => (
                          <div
                            key={record.id}
                            className={`rounded-2xl border p-3 text-center text-xs transition ${studentCalendarShadeClass(record.status)}`}
                          >
                            <p className="text-sm font-semibold">{record.day}</p>
                            <p className="mt-1 capitalize">{record.status || 'N/A'}</p>
                            {record.total ? (
                              <p className="mt-1 text-[11px] opacity-80">
                                {record.present}P / {record.absent}A
                              </p>
                            ) : (
                              <p className="mt-1 text-[11px] opacity-70">No entry</p>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                        Calendar dekhne ke liye Mark Student Attendance me batch select karein.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </section>
          </div>
        ) : null}

        {activeTab === 'staff' ? (
          <div className="mt-6 grid gap-6">
            <section className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
              {!isTeacherSelfView ? (
              <div className={`${sectionClass} min-w-0`}>
                <div>
                  <h2 className="text-2xl font-bold text-slate-900">Mark Staff Attendance</h2>
                  <p className="mt-2 text-sm text-slate-500">HR / Admin controlled daily attendance.</p>
                </div>
                <div className="mt-6 grid gap-4 md:grid-cols-4">
                  <input type="date" value={staffFilters.date} onChange={(e) => setStaffFilters({ ...staffFilters, date: e.target.value })} className={inputClass} />
                  <SelectField
                    value={staffFilters.staffType}
                    onChange={(e) =>
                      setStaffFilters({
                        ...staffFilters,
                        staffType: e.target.value as 'all' | 'teaching' | 'non_teaching',
                        department: '',
                      })
                    }
                  >
                    <option value="all">All Staff</option>
                    <option value="teaching">Teaching</option>
                    <option value="non_teaching">Non-Teaching</option>
                  </SelectField>
                  <SelectField value={staffFilters.department} onChange={(e) => setStaffFilters({ ...staffFilters, department: e.target.value })}>
                    <option value="">Department</option>
                    {markStaffDepartmentOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                  </SelectField>
                  <input value={staffFilters.search} onChange={(e) => setStaffFilters({ ...staffFilters, search: e.target.value })} className={inputClass} placeholder="Search staff" />
                </div>
                <button onClick={loadStaffMarking} className="mt-4 rounded-full bg-indigo-600 px-5 py-3 text-sm font-semibold text-white hover:bg-indigo-700">
                  Load Staff
                </button>

                  <div className="mt-6 max-h-[26rem] overflow-auto rounded-[1.5rem] border border-slate-200">
                  <div className="grid min-w-[58rem] grid-cols-[0.9fr_1.2fr_1fr_1.1fr_0.8fr_0.8fr] gap-4 bg-slate-50 px-4 py-3 text-xs uppercase tracking-[0.22em] text-slate-500">
                    <span>Staff ID</span>
                    <span>Name</span>
                    <span>Department</span>
                    <span>Status</span>
                    <span>Check-In</span>
                    <span>Check-Out</span>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {staffMarking?.staff?.length ? staffMarking.staff.map((member) => (
                      <div key={member.staff_member_id} className="grid min-w-[58rem] grid-cols-[0.9fr_1.2fr_1fr_1.1fr_0.8fr_0.8fr] gap-4 px-4 py-4 text-sm text-slate-700">
                        <span>{member.staff_id}</span>
                        <span>{member.staff_name}</span>
                        <div>
                          <p>{member.department || 'N/A'}</p>
                          <p className="text-xs text-slate-500">{member.designation || 'Staff'}</p>
                          {member.is_on_approved_leave ? (
                            <p className="mt-1 text-xs font-medium text-sky-700">
                              Approved leave{member.leave_type ? `: ${String(member.leave_type).replace('_', ' ')}` : ''}
                              {member.leave_reason ? ` | ${member.leave_reason}` : ''}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {(['present', 'absent', 'late', 'half_day'] as StaffAttendanceStatus[]).map((status) => (
                            <button
                              key={status}
                              type="button"
                              onClick={() =>
                                setStaffMarking((current) =>
                                  current
                                    ? {
                                        ...current,
                                        staff: current.staff.map((row) =>
                                          row.staff_member_id === member.staff_member_id ? { ...row, status } : row
                                        ),
                                      }
                                    : current
                                )
                              }
                              className={`${statusButtonBase} ${
                                member.status === status ? staffStatusClass(status) : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {status}
                            </button>
                          ))}
                        </div>
                        <input
                          value={member.check_in || ''}
                          onChange={(e) =>
                            setStaffMarking((current) =>
                              current
                                ? {
                                    ...current,
                                    staff: current.staff.map((row) =>
                                      row.staff_member_id === member.staff_member_id ? { ...row, check_in: e.target.value } : row
                                    ),
                                  }
                                : current
                            )
                          }
                          className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                        />
                        <input
                          value={member.check_out || ''}
                          onChange={(e) =>
                            setStaffMarking((current) =>
                              current
                                ? {
                                    ...current,
                                    staff: current.staff.map((row) =>
                                      row.staff_member_id === member.staff_member_id ? { ...row, check_out: e.target.value } : row
                                    ),
                                  }
                                : current
                            )
                          }
                          className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                        />
                      </div>
                    )) : (
                      <div className="px-4 py-8 text-center text-sm text-slate-500">
                        Staff attendance data load nahi hua. Department select karke `Load Staff` dabayein.
                      </div>
                    )}
                  </div>
                </div>

                <button onClick={handleSaveStaffAttendance} className="mt-6 rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800">
                  Save Attendance
                </button>

                <div className="mt-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold text-slate-900">Calendar View</h3>
                      <p className="mt-1 text-sm font-medium text-slate-600">{staffCalendarMonthLabel}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <input
                        type="month"
                        value={staffCalendarMonthInputValue}
                        onChange={(e) =>
                          setStaffFilters((current) => ({
                            ...current,
                            date: applyMonthInputValue(current.date, e.target.value),
                          }))
                        }
                        className={`${inputClass} min-w-[10rem]`}
                      />
                      <div className="inline-flex overflow-hidden rounded-full border border-slate-300 bg-white">
                        <button
                          type="button"
                          onClick={() =>
                            setStaffFilters((current) => ({
                              ...current,
                              date: shiftMonthValue(current.date, -1),
                            }))
                          }
                          className="px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                        >
                          Previous
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setStaffFilters((current) => ({
                              ...current,
                              date: shiftMonthValue(current.date, 1),
                            }))
                          }
                          className="border-l border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  </div>
                  <p className="mt-2 text-sm text-slate-500">
                    {staffFilters.department
                      ? `Selected department: ${staffFilters.department}`
                      : 'Showing approved leaves and attendance for all departments'}
                  </p>
                  <p className="mt-2 text-sm text-slate-600">
                    Marked Dates:
                    <span className="font-semibold text-slate-900">
                      {' '}
                      {staffCalendarMarkedDates.length
                        ? staffCalendarMarkedDates.join(', ')
                        : 'No marked dates in selected month'}
                    </span>
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full border border-emerald-200 bg-emerald-100 px-3 py-1 text-emerald-800">Present shade</span>
                    <span className="rounded-full border border-rose-200 bg-rose-100 px-3 py-1 text-rose-800">Absent shade</span>
                    <span className="rounded-full border border-amber-200 bg-amber-100 px-3 py-1 text-amber-800">Late shade</span>
                    <span className="rounded-full border border-orange-200 bg-orange-100 px-3 py-1 text-orange-800">Half day shade</span>
                    <span className="rounded-full border border-sky-200 bg-sky-100 px-3 py-1 text-sky-800">Approved leave</span>
                  </div>
                  <div className="mt-4 grid grid-cols-7 gap-2">
                    {staffCalendar.map((record) => (
                      <div
                        key={record.id}
                        className={`rounded-2xl border p-3 text-center text-xs transition ${staffCalendarShadeClass(record.status)}`}
                      >
                        <p className="text-sm font-semibold">{record.day}</p>
                        <p className="mt-1 capitalize">{record.status || 'N/A'}</p>
                        {record.total ? (
                          <p className="mt-1 text-[11px] opacity-80">
                            {record.present}P / {record.absent}A{record.leave ? ` / ${record.leave}L` : ''}
                          </p>
                        ) : (
                          <p className="mt-1 text-[11px] opacity-70">No entry</p>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-sm font-semibold text-slate-900">
                      Approved Leaves In Selected Month ({staffMonthlyApprovedLeaves.length})
                    </p>
                    <div className="mt-3 space-y-2 text-sm text-slate-600">
                      {staffMonthlyApprovedLeaveSummary.length ? (
                        staffMonthlyApprovedLeaveSummary.map((leave) => (
                          <p key={leave.id}>
                            {leave.staff_name || `Staff #${leave.staff_member_id}`}: {formatDate(leave.from_date)} to {formatDate(leave.to_date)} ({leave.leaveDaysInMonth} day{leave.leaveDaysInMonth === 1 ? '' : 's'})
                          </p>
                        ))
                      ) : (
                        <p>No approved leave matches the current month and department filter.</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              ) : null}

              <div className="grid min-w-0 gap-6">
                <div className={`${sectionClass} min-w-0`}>
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <h2 className="text-2xl font-bold text-slate-900">{isTeacherSelfView ? 'My Attendance Summary' : 'Staff Dashboard'}</h2>
                      <p className="mt-2 text-sm text-slate-500">
                        {isTeacherSelfView ? 'Sirf aapki attendance summary aur records dikh rahe hain.' : 'Department-wise attendance summary.'}
                      </p>
                    </div>
                    <button onClick={loadStaffRecords} className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
                      Refresh Records
                    </button>
                  </div>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <input
                      type="date"
                      value={staffFilters.dashboardDate}
                      onChange={(e) => setStaffFilters({ ...staffFilters, dashboardDate: e.target.value })}
                      className={inputClass}
                    />
                    {!isTeacherSelfView ? (
                      <SelectField
                        value={staffFilters.dashboardDepartment}
                        onChange={(e) => setStaffFilters({ ...staffFilters, dashboardDepartment: e.target.value })}
                      >
                        <option value="">All Departments</option>
                        {departmentOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                      </SelectField>
                    ) : <div />}
                  </div>
                  {staffFilters.dashboardDate ? (
                    <>
                      <div className="mt-6 grid gap-4 md:grid-cols-5">
                        <SmallMetricCard label="Present" value={`${staffDashboard?.present_count || 0}`} tone="emerald" />
                        <SmallMetricCard label="Absent" value={`${staffDashboard?.absent_count || 0}`} tone="rose" />
                        <SmallMetricCard label="Late" value={`${staffDashboard?.late_count || 0}`} tone="amber" />
                        <SmallMetricCard label="Half Day" value={`${staffDashboard?.half_day_count || 0}`} tone="orange" />
                        <SmallMetricCard label="Monthly %" value={`${staffDashboard?.monthly_attendance_percentage || 0}%`} tone="indigo" />
                      </div>
                      <div className="mt-6 overflow-auto rounded-[1.5rem] border border-slate-200">
                        <div className="grid min-w-[52rem] grid-cols-[1.2fr_0.6fr_0.6fr_0.6fr_0.7fr_0.6fr] gap-4 bg-slate-50 px-4 py-3 text-xs uppercase tracking-[0.22em] text-slate-500">
                          <span>Department</span>
                          <span>Present</span>
                          <span>Absent</span>
                          <span>Late</span>
                          <span>Half Day</span>
                          <span>Total</span>
                        </div>
                        <div className="divide-y divide-slate-100">
                          {staffDepartmentWiseSummary.map((summary) => (
                            <div
                              key={summary.department}
                              className="grid min-w-[52rem] grid-cols-[1.2fr_0.6fr_0.6fr_0.6fr_0.7fr_0.6fr] gap-4 px-4 py-3 text-sm text-slate-700"
                            >
                              <span className="font-medium text-slate-900">{String(summary.department)}</span>
                              <span>{String(summary.present)}</span>
                              <span>{String(summary.absent)}</span>
                              <span>{String(summary.late)}</span>
                              <span>{String(summary.half_day)}</span>
                              <span>{String(summary.total)}</span>
                            </div>
                          ))}
                          {!staffDepartmentWiseSummary.length ? (
                            <div className="px-4 py-5 text-sm text-slate-500">
                              Selected filters ke liye abhi department-wise staff attendance summary available nahi hai.
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                      Staff Dashboard data dekhne ke liye pehle date select karein.
                    </div>
                  )}
                </div>

                <div className={`${sectionClass} min-w-0`}>
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <h2 className="text-2xl font-bold text-slate-900">{isTeacherSelfView ? 'My Attendance Records' : 'Staff Records'}</h2>
                    {!isTeacherSelfView ? (
                      <button type="button" onClick={handleDeleteAllStaffRecords} className={deleteAllButtonClass}>
                        Delete All
                      </button>
                    ) : null}
                  </div>
                  <div className="mt-6 grid gap-4 md:grid-cols-3">
                    <input value={staffFilters.recordStaffName} onChange={(e) => setStaffFilters({ ...staffFilters, recordStaffName: e.target.value })} className={inputClass} placeholder={isTeacherSelfView ? 'My name' : 'Staff name'} />
                    {!isTeacherSelfView ? (
                      <SelectField value={staffFilters.recordDepartment} onChange={(e) => setStaffFilters({ ...staffFilters, recordDepartment: e.target.value })}>
                        <option value="">Department</option>
                        {departmentOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                      </SelectField>
                    ) : <div />}
                    <input type="date" value={staffFilters.recordDate} onChange={(e) => setStaffFilters({ ...staffFilters, recordDate: e.target.value })} className={inputClass} />
                  </div>
                  <div className="mt-4 max-h-72 overflow-auto rounded-[1.5rem] border border-slate-200">
                    <div className="grid min-w-[46rem] grid-cols-[1fr_1fr_0.9fr_0.9fr_0.7fr] gap-4 bg-slate-50 px-4 py-3 text-xs uppercase tracking-[0.22em] text-slate-500">
                      <span>Staff</span>
                      <span>Department</span>
                      <span>Date</span>
                      <span>Status</span>
                      <span>Action</span>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {staffRecords.map((record) => (
                        <div key={record.id} className="grid min-w-[46rem] grid-cols-[1fr_1fr_0.9fr_0.9fr_0.7fr] gap-4 px-4 py-3 text-sm text-slate-700">
                          <span>{record.staff_name}</span>
                          <span>{record.department}</span>
                          <span>{formatDate(record.date)}</span>
                          <span className={`inline-flex max-w-max rounded-full px-3 py-1 text-xs ${staffStatusClass(record.status)}`}>{record.status}</span>
                          {!isTeacherSelfView ? (
                            <button type="button" onClick={() => handleDeleteStaffRecord(record.id)} className={deleteButtonClass}>
                              Delete
                            </button>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                  {!isTeacherSelfView ? (
                  <div className="mt-6 grid gap-4">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <h3 className="text-lg font-semibold text-slate-900">Holiday Calendar</h3>
                      <button type="button" onClick={handleDeleteAllHolidays} className={deleteAllButtonClass}>
                        Delete All
                      </button>
                    </div>
                    <form onSubmit={handleCreateHoliday} className="grid gap-3 md:grid-cols-3">
                      <input value={holidayForm.title} onChange={(e) => setHolidayForm({ ...holidayForm, title: e.target.value })} className={inputClass} placeholder="Holiday title" />
                      <input type="date" value={holidayForm.holiday_date} onChange={(e) => setHolidayForm({ ...holidayForm, holiday_date: e.target.value })} className={inputClass} />
                      <input value={holidayForm.description} onChange={(e) => setHolidayForm({ ...holidayForm, description: e.target.value })} className={inputClass} placeholder="Description" />
                      <button className="rounded-full bg-indigo-600 px-5 py-3 text-sm font-semibold text-white hover:bg-indigo-700 md:col-span-3">
                        Add Holiday
                      </button>
                    </form>
                    <div className="max-h-56 overflow-auto rounded-2xl border border-slate-200 bg-slate-50 p-3">
                      <div className="space-y-2">
                        {holidays.map((item) => (
                          <div key={item.id} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="font-semibold text-slate-900">{item.title}</p>
                                <p className="text-xs text-slate-500">{formatDate(item.holiday_date)}</p>
                                <p className="text-xs text-slate-600">{item.description || 'No description'}</p>
                              </div>
                              <button type="button" onClick={() => handleDeleteHoliday(item.id)} className={deleteButtonClass}>
                                Delete
                              </button>
                            </div>
                          </div>
                        ))}
                        {!holidays.length ? <p className="text-sm text-slate-500">No holidays added yet.</p> : null}
                      </div>
                    </div>
                  </div>
                  ) : null}
                </div>
              </div>
            </section>
          </div>
        ) : null}

        {activeTab === 'leaves' ? (
          <div className="mt-6 grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
            <section className={sectionClass}>
              <h2 className="text-2xl font-bold text-slate-900">Leave Application</h2>
              <form onSubmit={handleCreateLeave} className="mt-6 grid gap-4">
                {isTeacherSelfView ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                    Applying leave for: <span className="font-semibold text-slate-900">{staffMembers[0]?.name || user?.full_name || 'Teacher'}</span>
                  </div>
                ) : (
                  <SelectField value={leaveForm.staff_member_id} onChange={(e) => setLeaveForm({ ...leaveForm, staff_member_id: e.target.value })}>
                    <option value="">Staff Member</option>
                    {staffMembers.map((member) => (
                      <option key={member.id} value={member.id}>{member.name}</option>
                    ))}
                  </SelectField>
                )}
                <SelectField value={leaveForm.leave_type} onChange={(e) => setLeaveForm({ ...leaveForm, leave_type: e.target.value as AttendanceLeaveType })}>
                  <option value="casual">Casual Leave</option>
                  <option value="sick">Sick Leave</option>
                  <option value="paid">Paid Leave</option>
                  <option value="emergency">Emergency Leave</option>
                </SelectField>
                <div className="grid gap-4 md:grid-cols-2">
                  <input type="date" value={leaveForm.from_date} onChange={(e) => setLeaveForm({ ...leaveForm, from_date: e.target.value })} className={inputClass} />
                  <input type="date" value={leaveForm.to_date} onChange={(e) => setLeaveForm({ ...leaveForm, to_date: e.target.value })} className={inputClass} />
                </div>
                <textarea value={leaveForm.reason} onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })} className={`${inputClass} min-h-28`} placeholder="Reason" />
                <button className="rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800">
                  Apply Leave
                </button>
              </form>
            </section>

            <section className={sectionClass}>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-slate-900">Leave History Log</h2>
                  <p className="mt-2 text-sm text-slate-500">
                    {isTeacherSelfView ? 'Sirf aapki leave requests yahan dikhengi.' : 'Approve or reject leave requests.'}
                  </p>
                </div>
                {!isTeacherSelfView ? (
                  <button type="button" onClick={handleDeleteAllLeaves} className={deleteAllButtonClass}>
                    Delete All
                  </button>
                ) : null}
              </div>
              <div className="mt-6 max-h-[34rem] space-y-3 overflow-auto pr-1">
                {leaves.map((leave) => (
                  <div key={leave.id} className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{leave.staff_name}</p>
                        <p className="mt-1 text-sm text-slate-500">{leave.leave_type.replace('_', ' ')}</p>
                        <p className="mt-2 text-sm text-slate-600">
                          {formatDate(leave.from_date)} to {formatDate(leave.to_date)}
                        </p>
                        <p className="mt-2 text-sm text-slate-600">{leave.reason || 'No reason provided'}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          leave.status === 'approved'
                            ? 'bg-emerald-100 text-emerald-700'
                            : leave.status === 'rejected'
                              ? 'bg-rose-100 text-rose-700'
                              : 'bg-amber-100 text-amber-700'
                        }`}>
                          {leave.status}
                        </span>
                        {!isTeacherSelfView && leave.status === 'pending' ? (
                          <>
                            <button onClick={() => handleLeaveDecision(leave.id, 'approved')} className="rounded-full bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700">
                              Approve
                            </button>
                            <button onClick={() => handleLeaveDecision(leave.id, 'rejected')} className="rounded-full bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700">
                              Reject
                            </button>
                          </>
                        ) : null}
                        <button type="button" onClick={() => handleDeleteLeave(leave.id)} className={deleteButtonClass}>
                          {isTeacherSelfView ? 'Withdraw' : 'Delete'}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        ) : null}

        {!isTeacherSelfView && activeTab === 'reports' ? (
          <div className="mt-6 grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
            <section className={sectionClass}>
              <h2 className="text-2xl font-bold text-slate-900">Attendance Reports</h2>
              <div className="mt-6 grid gap-4">
                <SelectField value={reportFilters.report_type} onChange={(e) => setReportFilters({ ...reportFilters, report_type: e.target.value as typeof reportFilters.report_type })}>
                  <option value="student_summary">Student Summary</option>
                  <option value="staff_summary">Staff Summary</option>
                  <option value="leave_summary">Leave Summary</option>
                </SelectField>
                {reportFilters.report_type === 'student_summary' ? (
                  <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-slate-900">Select Batches</p>
                      {selectedReportBatchNames.length ? (
                        <button
                          type="button"
                          onClick={() => setReportFilters({ ...reportFilters, batch_names: '' })}
                          className="text-xs font-semibold text-indigo-600 hover:text-indigo-700"
                        >
                          Clear
                        </button>
                      ) : null}
                    </div>
                    <p className="mt-2 text-xs text-slate-500">
                      {selectedReportBatchNames.length
                        ? `${selectedReportBatchNames.length} batch selected`
                        : 'Agar koi batch select nahi karte, to report all batches ke liye chalegi.'}
                    </p>
                    <div className="mt-3">
                      <SelectField
                        value={reportBatchPicker}
                        onChange={(e) => {
                          const value = e.target.value;
                          setReportBatchPicker(value);
                          addReportBatchName(value);
                        }}
                      >
                        <option value="">Choose batch</option>
                        {batchOptions.map((batchName) => (
                          <option
                            key={batchName}
                            value={batchName}
                            disabled={selectedReportBatchNames.includes(batchName)}
                          >
                            {batchName}
                          </option>
                        ))}
                      </SelectField>
                    </div>
                    <div className="mt-3 flex max-h-40 flex-wrap gap-2 overflow-auto pr-1">
                      {selectedReportBatchNames.length ? (
                        selectedReportBatchNames.map((batchName) => (
                          <button
                            key={batchName}
                            type="button"
                            onClick={() => toggleReportBatchName(batchName)}
                            className="rounded-full border border-indigo-200 bg-white px-3 py-2 text-xs font-semibold text-indigo-700 transition hover:border-rose-200 hover:text-rose-700"
                          >
                            {batchName} x
                          </button>
                        ))
                      ) : batchOptions.length ? null : (
                        <p className="text-sm text-slate-500">Batch list load ho rahi hai ya abhi available nahi hai.</p>
                      )}
                    </div>
                  </div>
                ) : null}
                <div className="grid gap-4 md:grid-cols-2">
                  {reportFilters.report_type !== 'student_summary' ? (
                    <SelectField value={reportFilters.department} onChange={(e) => setReportFilters({ ...reportFilters, department: e.target.value })}>
                      <option value="">Department</option>
                      {departmentOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                    </SelectField>
                  ) : (
                    <div />
                  )}
                  <div className="grid gap-4 md:grid-cols-2">
                    <input type="date" value={reportFilters.date_from} onChange={(e) => setReportFilters({ ...reportFilters, date_from: e.target.value })} className={inputClass} />
                    <input type="date" value={reportFilters.date_to} onChange={(e) => setReportFilters({ ...reportFilters, date_to: e.target.value })} className={inputClass} />
                  </div>
                </div>
                <div className="flex flex-wrap gap-3">
                  <button onClick={handleRunReport} className="rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800">
                    Run Report
                  </button>
                  <button onClick={() => handleExportReport('excel')} className="rounded-full bg-emerald-600 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-700">
                    Export Excel
                  </button>
                  <button onClick={() => handleExportReport('pdf')} className="rounded-full bg-rose-600 px-5 py-3 text-sm font-semibold text-white hover:bg-rose-700">
                    Export PDF
                  </button>
                </div>
              </div>
            </section>

            <section className={sectionClass}>
              <h2 className="text-2xl font-bold text-slate-900">Report Preview</h2>
              <p className="mt-2 text-sm text-slate-500">
                {reportData ? `${reportData.total_records} records loaded.` : 'Run a report to preview data.'}
              </p>
              <div className="mt-6 max-h-[34rem] overflow-auto rounded-[1.5rem] border border-slate-200">
                {reportData && reportData.rows.length ? (
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-left text-slate-500">
                        {Object.keys(reportData.rows[0].values).map((column) => (
                          <th key={column} className="px-4 py-3 capitalize">{column.replace(/_/g, ' ')}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {reportData.rows.map((row, index) => (
                        <tr key={index} className="border-t border-slate-100 text-slate-700">
                          {Object.keys(reportData.rows[0].values).map((column) => (
                            <td key={column} className="px-4 py-3">{String(row.values[column] ?? '')}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="p-6 text-sm text-slate-500">No report data available.</div>
                )}
              </div>
            </section>
          </div>
        ) : null}
      </main>
    </div>
  );
}

function SelectField({
  children,
  className = '',
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-sky-200 bg-sky-50 shadow-sm">
      <select
        {...props}
        className={`w-full cursor-pointer appearance-none bg-transparent px-4 py-3 pr-16 text-sm font-medium text-slate-900 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-4 focus:ring-slate-200/70 ${className}`.trim()}
        style={{
          backgroundImage: 'none',
        }}
      >
        {children}
      </select>
      <div className="pointer-events-none absolute inset-y-0 right-0 flex w-12 items-center justify-center border-l border-sky-200 bg-white/80 text-sky-700">
        <ChevronDown className="h-4 w-4" />
      </div>
    </div>
  );
}

function HeroMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl bg-slate-50 p-4 text-center">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  icon: typeof Users;
  tone: 'indigo' | 'amber' | 'emerald' | 'rose';
}) {
  const colors = {
    indigo: 'bg-indigo-100 text-indigo-600',
    amber: 'bg-amber-100 text-amber-700',
    emerald: 'bg-emerald-100 text-emerald-700',
    rose: 'bg-rose-100 text-rose-700',
  };

  return (
    <div className="rounded-[1.75rem] bg-white p-5 shadow-sm">
      <div className="flex items-center gap-4">
        <div className={`rounded-2xl p-3 ${colors[tone]}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm text-slate-500">{label}</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
        </div>
      </div>
    </div>
  );
}

function SmallMetricCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'emerald' | 'rose' | 'amber' | 'orange' | 'indigo';
}) {
  const colors = {
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    rose: 'bg-rose-50 border-rose-200 text-rose-700',
    amber: 'bg-amber-50 border-amber-200 text-amber-700',
    orange: 'bg-orange-50 border-orange-200 text-orange-700',
    indigo: 'bg-indigo-50 border-indigo-200 text-indigo-700',
  };

  return (
    <div className={`rounded-2xl border p-4 ${colors[tone]}`}>
      <p className="text-xs uppercase tracking-[0.2em]">{label}</p>
      <p className="mt-2 text-2xl font-bold">{value}</p>
    </div>
  );
}

type AttendanceBoundaryState = {
  hasError: boolean;
  message: string;
};

class AttendanceErrorBoundary extends Component<{ children: ReactNode }, AttendanceBoundaryState> {
  state: AttendanceBoundaryState = {
    hasError: false,
    message: '',
  };

  static getDerivedStateFromError(error: Error): AttendanceBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'Attendance module render error',
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Attendance module crashed', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 p-6">
          <div className="mx-auto max-w-3xl rounded-3xl border border-rose-200 bg-white p-8 shadow-sm">
            <h2 className="text-2xl font-bold text-slate-900">Attendance module recover mode</h2>
            <p className="mt-3 text-sm text-slate-600">
              Page render error aaya tha, isliye white screen ke bajay safe fallback dikhaya gaya hai.
            </p>
            <p className="mt-3 text-sm text-rose-600">{this.state.message}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-5 rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Reload Attendance
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function AttendanceManagement() {
  return (
    <AttendanceErrorBoundary>
      <AttendanceManagementContent />
    </AttendanceErrorBoundary>
  );
}
