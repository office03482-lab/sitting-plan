// @ts-nocheck
import { Component, type ErrorInfo, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { apiService, isRequestCanceled } from '@services/api';
import { useAuthStore } from '@store/auth';
import { useAuth } from '@/contexts/AuthProvider';
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
  Student,
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
const attendanceStudentListPageSize = 200;
const attendanceStudentBatchFallbackPageSize = 10000;
const attendanceStudentRecordPageSize = 100;
const attendanceStudentDashboardPageSize = 200;
const attendanceUiDebounceMs = 350;

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
      category: 'batch',
      school_id: schoolId,
      is_active: true,
      created_at: '',
      updated_at: '',
      student_count: studentCount,
    }));
};

const normalizeStudentToAttendanceStudent = (student: Student): AttendanceStudent => ({
  id: String(student.id ?? '').trim(),
  name: String(student.name || '').trim(),
  class_name: String(student.class_name || '').trim(),
  section: String(student.section || '').trim(),
  batch_name: String(student.batch || '').trim() || undefined,
  roll_no: String(student.roll_number || '').trim(),
  parent_contact: String(student.phone || student.reference_number || '').trim() || undefined,
});

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
      section: (sectionRaw || '').trim(),
    };
  }

  const hyphenMatch = normalized.match(/^(.*\S)\s*-\s*([A-Za-z0-9]{1,3})$/);
  if (hyphenMatch) {
    return {
      className: hyphenMatch[1].trim(),
      section: hyphenMatch[2].trim(),
    };
  }
  const spacedMatch = normalized.match(/^(.*\S)\s+([A-Za-z0-9]{1,3})$/);
  if (spacedMatch) {
    return {
      className: spacedMatch[1].trim(),
      section: spacedMatch[2].trim(),
    };
  }
  return { className: '', section: '' };
}

function normalizeClassNameKey(value?: string) {
  const normalized = String(value || '').trim().replace(/\s+/g, ' ');
  if (!normalized) return '';
  const tokens = normalized.split(' ');
  const firstNumericIndex = tokens.findIndex((token) => /\d/.test(token));
  const relevantTokens = firstNumericIndex >= 0 ? tokens.slice(firstNumericIndex) : tokens;
  return relevantTokens
    .join(' ')
    .replace(/\b(\d+)(st|nd|rd|th)\b/gi, '$1')
    .trim()
    .toLowerCase();
}

function normalizeBatchComparisonKey(value?: string) {
  const normalized = (value || '').trim();
  if (!normalized) return '';

  if (normalized.includes('|')) {
    const [classNameRaw, sectionRaw] = normalized.split('|', 2);
    return `${normalizeClassNameKey(classNameRaw)}|${(sectionRaw || '').trim().toLowerCase()}`;
  }

  const hyphenMatch = normalized.match(/^(.*\S)\s*-\s*([A-Za-z0-9]{1,3})$/);
  if (hyphenMatch) {
    return `${normalizeClassNameKey(hyphenMatch[1])}|${hyphenMatch[2].trim().toLowerCase()}`;
  }

  const spacedMatch = normalized.match(/^(.*\S)\s+([A-Za-z0-9]{1,3})$/);
  if (spacedMatch) {
    return `${normalizeClassNameKey(spacedMatch[1])}|${spacedMatch[2].trim().toLowerCase()}`;
  }

  return normalizeClassNameKey(normalized);
}

function getManagedAttendanceCategory(batch?: Batch | null) {
  return String(batch?.category || 'batch').trim().toLowerCase() === 'class' ? 'class' : 'batch';
}

function getAttendanceStudentBatchName(student: AttendanceStudent) {
  return String((student as AttendanceStudent & { batch_name?: string; batch?: string }).batch_name
    || (student as AttendanceStudent & { batch?: string }).batch
    || '')
    .trim();
}

function normalizeSubjectId(value?: string | number | null) {
  return String(value ?? '').trim();
}

function pickPreferredSubjectId(...values: Array<string | number | null | undefined>) {
  for (const value of values) {
    const normalized = normalizeSubjectId(value);
    if (normalized) {
      return normalized;
    }
  }
  return '';
}

function subjectMatchesBatchSelection(
  subject: AttendanceSubject,
  selectedBatchLabel?: string,
  className?: string,
  section?: string,
) {
  const selectedKey = normalizeBatchComparisonKey(selectedBatchLabel);
  const subjectBatchKey = normalizeBatchComparisonKey(String(subject.batch_name || '').trim());
  if (selectedKey && subjectBatchKey && selectedKey === subjectBatchKey) {
    return true;
  }

  const subjectClass = String(subject.class_name || '').trim().toLowerCase();
  const subjectSection = String(subject.section || '').trim().toLowerCase();
  const wantedClass = String(className || '').trim().toLowerCase();
  const wantedSection = String(section || '').trim().toLowerCase();
  return Boolean(subjectClass && subjectSection && subjectClass === wantedClass && subjectSection === wantedSection);
}

function studentMatchesBatchSelection(student: AttendanceStudent, selectedBatchLabel?: string) {
  const selectedKey = normalizeBatchComparisonKey(selectedBatchLabel);
  if (!selectedKey) return false;

  const candidateKeys = new Set<string>();
  const className = String(student.class_name || '').trim();
  const section = String(student.section || '').trim();
  const batchName = getAttendanceStudentBatchName(student);

  if (batchName) {
    candidateKeys.add(normalizeBatchComparisonKey(batchName));
    candidateKeys.add(batchName.toLowerCase());
  }
  if (className && section) {
    candidateKeys.add(normalizeBatchComparisonKey(`${className} | ${section}`));
  }
  if (className) {
    candidateKeys.add(className.toLowerCase());
  }

  return candidateKeys.has(selectedKey) || candidateKeys.has(String(selectedBatchLabel || '').trim().toLowerCase());
}

function inferBatchPartsFromStudents(selectedBatchLabel: string, students: AttendanceStudent[]) {
  const matchingStudents = students.filter((student) => studentMatchesBatchSelection(student, selectedBatchLabel));
  const uniquePairs = Array.from(
    new Set(
      matchingStudents
        .map((student) => {
          const className = String(student.class_name || '').trim();
          const section = String(student.section || '').trim();
          if (!className || !section) return '';
          return `${className}|||${section}`;
        })
        .filter(Boolean)
    )
  );

  if (uniquePairs.length >= 1) {
    const [className, section] = uniquePairs[0].split('|||');
    return { className, section };
  }

  return { className: '', section: '' };
}

function inferClassPartsFromStudents(selectedClassLabel: string, students: AttendanceStudent[]) {
  const normalizedClassKey = normalizeClassNameKey(selectedClassLabel);
  if (!normalizedClassKey) {
    return { className: '', section: '' };
  }

  const matchingStudents = students.filter(
    (student) => normalizeClassNameKey(String(student.class_name || '').trim()) === normalizedClassKey
  );
  if (!matchingStudents.length) {
    return { className: selectedClassLabel.trim(), section: '' };
  }

  return {
    className: String(matchingStudents[0]?.class_name || selectedClassLabel).trim(),
    section: String(matchingStudents[0]?.section || '').trim(),
  };
}

function inferAttendanceSelectionParts(
  selectedLabel: string,
  scope: 'batch' | 'class',
  students: AttendanceStudent[]
) {
  if (scope === 'class') {
    return inferClassPartsFromStudents(selectedLabel, students);
  }

  const parsed = splitBatchLabel(selectedLabel);
  if (parsed.className && parsed.section) {
    return parsed;
  }
  return inferBatchPartsFromStudents(selectedLabel, students);
}

function matchManagedAttendanceLabel(
  managedItems: Batch[],
  scope: 'batch' | 'class',
  className?: string,
  section?: string
) {
  const normalizedClassKey = normalizeClassNameKey(className);
  const normalizedBatchKey = normalizeBatchComparisonKey(
    className && section ? `${className} | ${section}` : className || ''
  );

  const filteredItems = managedItems.filter((item) => getManagedAttendanceCategory(item) === scope);
  if (scope === 'batch' && normalizedBatchKey) {
    const exactBatch = filteredItems.find(
      (item) => normalizeBatchComparisonKey(String(item.name || '').trim()) === normalizedBatchKey
    );
    if (exactBatch?.name) {
      return String(exactBatch.name).trim();
    }
  }

  if (normalizedClassKey) {
    const classMatch = filteredItems.find(
      (item) => normalizeClassNameKey(String(item.name || '').trim()) === normalizedClassKey
    );
    if (classMatch?.name) {
      return String(classMatch.name).trim();
    }
  }

  return '';
}

function resolveManagedBatchSelection(
  managedItems: Batch[],
  selectedLabel: string,
  scope: 'batch' | 'class'
) {
  const normalizedLabel = String(selectedLabel || '').trim();
  if (!normalizedLabel) return null;

  const scopedItems = managedItems.filter((item) => getManagedAttendanceCategory(item) === scope);
  if (scope === 'batch') {
    const batchKey = normalizeBatchComparisonKey(normalizedLabel);
    return (
      scopedItems.find((item) => normalizeBatchComparisonKey(String(item.name || '').trim()) === batchKey) ||
      null
    );
  }

  const classKey = normalizeClassNameKey(normalizedLabel);
  return (
    scopedItems.find(
      (item) =>
        normalizeClassNameKey(String(item.class_name || item.name || '').trim()) === classKey
        || normalizeClassNameKey(String(item.name || '').trim()) === classKey
    ) || null
  );
}

function resolveManagedAttendanceStudentCount(
  managedItems: Batch[],
  selectedLabel: string,
  scope: 'batch' | 'class'
) {
  const selectedItem = resolveManagedBatchSelection(managedItems, selectedLabel, scope);
  const directCount = Number(selectedItem?.student_count ?? 0);
  if (directCount > 0) {
    return directCount;
  }

  if (scope === 'class') {
    const classKey = normalizeClassNameKey(
      String(selectedItem?.class_name || selectedItem?.name || selectedLabel || '').trim()
    );
    if (!classKey) return 0;

    const summedBatchCount = managedItems
      .filter((item) => getManagedAttendanceCategory(item) === 'batch')
      .filter(
        (item) =>
          normalizeClassNameKey(String(item.class_name || '').trim()) === classKey
      )
      .reduce((total, item) => total + Number(item.student_count ?? 0), 0);

    return summedBatchCount;
  }

  return 0;
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

function getAttendanceRecordBatchLabel(
  managedItems: Batch[],
  className?: string,
  section?: string
) {
  return (
    matchManagedAttendanceLabel(managedItems, 'batch', className, section) ||
    [String(className || '').trim(), String(section || '').trim()].filter(Boolean).join(' | ')
  );
}

function shouldDisplayAttendanceSubject(subjectName?: string | null) {
  const normalized = String(subjectName || '').trim();
  return Boolean(normalized);
}

function shouldDisplayAttendanceTeacher(teacherName?: string | null) {
  const normalized = String(teacherName || '').trim().toLowerCase();
  return Boolean(normalized && normalized !== 'system' && normalized !== 'attendance department');
}

function recordMatchesSelectionScope(
  record: Pick<StudentAttendanceRecord, 'class_name' | 'section'>,
  scope: 'batch' | 'class',
  className?: string,
  section?: string
) {
  if (!className) return false;
  if (scope === 'class') {
    return normalizeClassNameKey(record.class_name) === normalizeClassNameKey(className);
  }
  if (!section) return false;
  return normalizeBatchComparisonKey(`${record.class_name} | ${record.section}`) === normalizeBatchComparisonKey(`${className} | ${section}`);
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
  const { authReady, sessionReady, initialized: authInitialized, loading: authLoading, session } = useAuth();
  const isTeacherSelfView = user?.role === 'teacher' && user?.user_type === 'teaching';
  const permissionList = user?.permissions || [];
  const hasExactPermission = (permission: string) => user?.role === 'admin' || permissionList.includes(permission);
  const initialHashTab = location.hash.replace('#', '').trim();
  const [activeTab, setActiveTab] = useState<TabKey>(
    tabs.some((tab) => tab.key === initialHashTab) ? (initialHashTab as TabKey) : 'overview'
  );
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
  const [batchAttendanceOptions, setBatchAttendanceOptions] = useState<TeacherAttendanceContext[]>([]);
  const [selectedBatchAttendanceEntryId, setSelectedBatchAttendanceEntryId] = useState('');
  const [batchAttendanceOptionsLoading, setBatchAttendanceOptionsLoading] = useState(false);
  const [holidayForm, setHolidayForm] = useState(initialHolidayForm);
  const [leaveForm, setLeaveForm] = useState(initialLeaveForm);

  const [studentFilters, setStudentFilters] = useState({
    date: new Date().toISOString().slice(0, 10),
    dashboard_date: new Date().toISOString().slice(0, 10),
    attendance_scope: 'batch' as 'batch' | 'class',
    batch_name: '',
    record_scope: 'batch' as 'batch' | 'class',
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
  const authIdentityFingerprintRef = useRef('');

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
    isRequestCanceled(error) ? '' : error?.response?.data?.detail || error?.message || fallback;

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

  const visibleAttendanceContext = useMemo(() => {
    if (batchAttendanceContext && (batchAttendanceContext.subject || batchAttendanceContext.teacher_name)) {
      return batchAttendanceContext;
    }
    if (teacherAttendanceContext && (teacherAttendanceContext.subject || teacherAttendanceContext.teacher_name)) {
      return teacherAttendanceContext;
    }
    return null;
  }, [batchAttendanceContext, teacherAttendanceContext]);

  const getAttendanceContextOptionValue = useCallback(
    (context: TeacherAttendanceContext | null | undefined) =>
      String(
        context?.timetable_entry_id
        || `${context?.start_time || ''}|${context?.end_time || ''}|${context?.teacher_id || ''}|${context?.subject_id || ''}`
      ),
    []
  );

  const formatAttendanceContextOptionLabel = useCallback((context: TeacherAttendanceContext) => {
    const parts = [];
    const timeLabel = [context.start_time, context.end_time].filter(Boolean).join(' - ');
    if (timeLabel) parts.push(timeLabel);
    if (shouldDisplayAttendanceTeacher(context.teacher_name)) parts.push(context.teacher_name);
    if (shouldDisplayAttendanceSubject(context.subject)) parts.push(context.subject || '');
    return parts.filter(Boolean).join(' | ') || 'Scheduled Class';
  }, []);

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
    const batchItems = batchesData.filter((item) => getManagedAttendanceCategory(item) === 'batch');
    const classItems = batchesData.filter((item) => getManagedAttendanceCategory(item) === 'class');
    const firstBatch = String(batchItems[0]?.name || '').trim();
    const firstClass = String(classItems[0]?.name || '').trim();
    setStudentFilters((current) => ({
      ...current,
      attendance_scope:
        current.attendance_scope === 'class' && firstClass
          ? 'class'
          : firstBatch
            ? 'batch'
            : firstClass
              ? 'class'
              : current.attendance_scope,
      batch_name:
        current.batch_name && batchesData.some((item) => item.name === current.batch_name)
          ? current.batch_name
          : current.attendance_scope === 'class'
            ? firstClass || firstBatch
            : firstBatch || firstClass,
      record_scope:
        current.record_scope === 'class' && firstClass
          ? 'class'
          : firstBatch
            ? 'batch'
            : firstClass
              ? 'class'
              : current.record_scope,
      record_batch_name:
        current.record_batch_name && batchesData.some((item) => item.name === current.record_batch_name)
          ? current.record_batch_name
          : current.record_scope === 'class'
            ? current.record_batch_name || firstClass || firstBatch
            : current.record_batch_name || firstBatch || firstClass,
    }));
  };
  const attendanceStudentsRefreshCooldownMs = 60_000;
  const lastManagedBatchRefreshAtRef = useRef(0);
  const managedBatchRefreshInFlightRef = useRef<Promise<void> | null>(null);
  const lastOverviewRefreshAtRef = useRef(0);
  const overviewRefreshInFlightRef = useRef<Promise<void> | null>(null);
  const studentTabLoadInFlightRef = useRef<Promise<void> | null>(null);
  const batchStudentFallbackRequestKeyRef = useRef('');
  const batchStudentFallbackPromiseRef = useRef<Promise<void> | null>(null);
  const staffTabLoadInFlightRef = useRef<Promise<void> | null>(null);
  const overviewPendingRefreshRef = useRef(false);
  const teacherContextRequestKeyRef = useRef('');
  const batchContextRequestKeyRef = useRef('');
  const studentRecordsRequestKeyRef = useRef('');
  const studentCalendarRequestKeyRef = useRef('');
  const todayDashboardRequestKeyRef = useRef('');
  const batchContextRequestPromiseRef = useRef<Promise<void> | null>(null);
  const studentRecordsRequestPromiseRef = useRef<Promise<void> | null>(null);
  const studentCalendarRequestPromiseRef = useRef<Promise<void> | null>(null);
  const todayDashboardRequestPromiseRef = useRef<Promise<void> | null>(null);
  const studentPrimaryHydrationKeyRef = useRef('');
  const studentPrimaryHydrationPromiseRef = useRef<Promise<void> | null>(null);
  const studentSecondaryHydrationKeyRef = useRef('');
  const studentSecondaryHydrationPromiseRef = useRef<Promise<void> | null>(null);
  const [studentPrimaryHydrationReadyKey, setStudentPrimaryHydrationReadyKey] = useState('');
  const studentRecordsCacheRef = useRef(
    new Map<string, { timestamp: number; data: StudentAttendanceRecord[] }>()
  );
  const staffRecordsRequestKeyRef = useRef('');
  const isOverviewTabVisible = activeTab === 'overview' && canViewOverviewTab && !isTeacherSelfView;
  const isStudentTabVisible = activeTab === 'student' && loadedTabs.student;
  const isStaffTabVisible = activeTab === 'staff' && loadedTabs.staff;
  const canRunAttendanceRequests = authReady && sessionReady && !!session;
  const currentSchoolId = user?.school_id || 1;
  const attendanceSecondaryHydrationDelayMs = 40;
  const studentRecordCacheTtlMs = 45_000;

  const debugAttendanceLoader = (source: string, details?: Record<string, unknown>) => {
    console.debug('[attendance-loader]', source, {
      activeTab,
      authReady,
      sessionReady,
      authInitialized,
      authLoading,
      ...details,
    });
  };

  const readStudentRecordCache = (requestKey: string) => {
    const cached = studentRecordsCacheRef.current.get(requestKey);
    if (!cached) return null;
    if (Date.now() - cached.timestamp > studentRecordCacheTtlMs) {
      studentRecordsCacheRef.current.delete(requestKey);
      return null;
    }
    return cached.data;
  };

  const writeStudentRecordCache = (requestKey: string, data: StudentAttendanceRecord[]) => {
    studentRecordsCacheRef.current.set(requestKey, {
      timestamp: Date.now(),
      data,
    });
  };

  const clearStudentRecordCaches = () => {
    studentRecordsCacheRef.current.clear();
    studentRecordsRequestKeyRef.current = '';
    studentRecordsRequestPromiseRef.current = null;
    studentCalendarRequestKeyRef.current = '';
    studentCalendarRequestPromiseRef.current = null;
    todayDashboardRequestKeyRef.current = '';
    todayDashboardRequestPromiseRef.current = null;
  };

  useEffect(() => {
    const nextFingerprint = `${user?.id || 'anon'}:${user?.school_id || ''}:${user?.role || ''}:${user?.role_key || ''}`;
    if (authIdentityFingerprintRef.current === nextFingerprint) {
      return;
    }
    authIdentityFingerprintRef.current = nextFingerprint;
    debugAttendanceLoader('auth.identity.changed', {
      userId: user?.id || null,
      schoolId: user?.school_id || null,
      role: user?.role || null,
      roleKey: user?.role_key || null,
      origin: 'auth-store',
    });
  }, [user?.id, user?.school_id, user?.role, user?.role_key]);

  const loadOverviewData = async (options?: { initial?: boolean; force?: boolean }) => {
    const initial = options?.initial === true;
    const force = options?.force === true;
    if (!canRunAttendanceRequests) {
      debugAttendanceLoader('loadOverviewData.skipped.auth_not_ready', { initial, force });
      return;
    }
    if (!initial && !isOverviewTabVisible) {
      debugAttendanceLoader('loadOverviewData.skipped.hidden_tab', { initial, force });
      overviewPendingRefreshRef.current = true;
      return;
    }
    if (overviewRefreshInFlightRef.current) {
      debugAttendanceLoader('loadOverviewData.reused_inflight', { initial, force });
      return overviewRefreshInFlightRef.current;
    }
    const refreshPromise = (async () => {
      const now = Date.now();
      if (!initial && !force && now - lastOverviewRefreshAtRef.current < 60_000) {
        debugAttendanceLoader('loadOverviewData.skipped.cooldown', { initial, force });
        return;
      }
      try {
        debugAttendanceLoader('loadOverviewData.start', { initial, force });
        initial ? setLoading(true) : setTabLoading(true);
        let normalizedOverview: AttendanceOverview | null = null;
        const overviewRes = await apiService.getAttendanceOverview();
        normalizedOverview = normalizeOverview(overviewRes.data);
        setOverview(normalizedOverview);
        if (normalizedOverview) {
          setNotifications(normalizedOverview.notifications);
          setHolidays(normalizedOverview.holidays);
        }
        lastOverviewRefreshAtRef.current = Date.now();
        overviewPendingRefreshRef.current = false;
        setLoadedTabs((current) => ({ ...current, overview: true }));
      } catch (error: any) {
        console.error('Failed to load attendance module', error);
        setAlert({ type: 'error', message: getApiErrorMessage(error, 'Attendance module load nahi ho paaya.') });
      } finally {
        debugAttendanceLoader('loadOverviewData.end', { initial, force });
        initial ? setLoading(false) : setTabLoading(false);
      }
    })().finally(() => {
      overviewRefreshInFlightRef.current = null;
    });
    overviewRefreshInFlightRef.current = refreshPromise;
    return refreshPromise;
  };

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
    if (!canRunAttendanceRequests) {
      debugAttendanceLoader('loadStudentTab.skipped.auth_not_ready');
      return;
    }
    if (studentTabLoadInFlightRef.current) {
      debugAttendanceLoader('loadStudentTab.reused_inflight');
      return studentTabLoadInFlightRef.current;
    }
    const loadPromise = (async () => {
      try {
        debugAttendanceLoader('loadStudentTab.start');
        setTabLoading(true);
        const studentsRes = await apiService.listAttendanceStudents({ school_id: currentSchoolId, limit: attendanceStudentListPageSize });
        const batchesRes = await apiService
          .listBatches(currentSchoolId, true)
          .catch(() => ({ data: [] as Batch[] }));
        const subjectsRes =
          subjects.length || toArray<AttendanceSubject>(overview?.subject_options).length
            ? ({ data: subjects.length ? subjects : toArray<AttendanceSubject>(overview?.subject_options) } as { data: AttendanceSubject[] })
            : await apiService.listAttendanceSubjects(currentSchoolId).catch(() => ({ data: [] }));
        let nextStudents = toArray<AttendanceStudent>(studentsRes.data);
        if (!nextStudents.length) {
          debugAttendanceLoader('loadStudentTab.empty_attendance_students_fallback', {
            schoolId: currentSchoolId,
          });
          const genericStudentsRes = await apiService.listStudents(
            1,
            0,
            attendanceStudentListPageSize,
          ).catch(() => ({ data: [] as Student[] }));
          nextStudents = toArray<Student>(genericStudentsRes.data)
            .map(normalizeStudentToAttendanceStudent)
            .filter((student) => student.name && student.class_name && student.section);
        }
        let normalizedBatches = toArray<Batch>(batchesRes.data)
          .filter((item) => String(item.name || '').trim())
          .sort((left, right) =>
            String(left.name || '').localeCompare(String(right.name || ''), undefined, { sensitivity: 'base' })
          );
        if (!normalizedBatches.length) {
          normalizedBatches = buildAttendanceBatches(nextStudents, Number(currentSchoolId) || 1);
        }
        setManagedBatches(normalizedBatches);
        setStudents(nextStudents);
        setSubjects(toArray<AttendanceSubject>(subjectsRes.data));
        hydrateDefaults(overview || normalizeOverview({}), nextStudents, normalizedBatches);
        setLoadedTabs((current) => ({ ...current, student: true }));
      } catch (error: any) {
        if (isRequestCanceled(error)) {
          debugAttendanceLoader('loadStudentTab.canceled');
          return;
        }
        setAlert({ type: 'error', message: getApiErrorMessage(error, 'Student attendance load nahi hua.') });
      } finally {
        debugAttendanceLoader('loadStudentTab.end');
        setLoading(false);
        setTabLoading(false);
      }
    })().finally(() => {
      studentTabLoadInFlightRef.current = null;
    });
    studentTabLoadInFlightRef.current = loadPromise;
    return loadPromise;
  };

  const loadManagedBatches = async (options?: { force?: boolean }) => {
    const force = options?.force === true;
    if (!canRunAttendanceRequests) {
      debugAttendanceLoader('loadManagedBatches.skipped.auth_not_ready', { force });
      return;
    }
    const now = Date.now();
    if (!force && now - lastManagedBatchRefreshAtRef.current < attendanceStudentsRefreshCooldownMs) {
      debugAttendanceLoader('loadManagedBatches.skipped.cooldown', { force });
      return;
    }
    if (managedBatchRefreshInFlightRef.current) {
      debugAttendanceLoader('loadManagedBatches.reused_inflight', { force });
      return managedBatchRefreshInFlightRef.current;
    }

      const refreshPromise = (async () => {
        lastManagedBatchRefreshAtRef.current = Date.now();
        try {
          debugAttendanceLoader('loadManagedBatches.start', { force });
          if (students.length) {
            const normalizedBatches = toArray<Batch>(
              (await apiService.listBatches(currentSchoolId, true).catch(() => ({ data: [] as Batch[] }))).data
            )
              .filter((item) => String(item.name || '').trim())
              .sort((left, right) =>
                String(left.name || '').localeCompare(String(right.name || ''), undefined, { sensitivity: 'base' })
              );
            if (normalizedBatches.length) {
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
                    : current.record_batch_name || normalizedBatches[0]?.name || '',
              }));
              return;
            }
          }
          const response = await apiService.listBatches(currentSchoolId, true);
          let normalizedBatches = toArray<Batch>(response.data)
            .filter((item) => String(item.name || '').trim())
            .sort((left, right) => String(left.name || '').localeCompare(String(right.name || ''), undefined, { sensitivity: 'base' }));
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
        debugAttendanceLoader('loadManagedBatches.end', { force });
        managedBatchRefreshInFlightRef.current = null;
      }
    })();

    managedBatchRefreshInFlightRef.current = refreshPromise;
    return refreshPromise;
  };

  const loadStaffTab = async () => {
    if (!canRunAttendanceRequests) {
      debugAttendanceLoader('loadStaffTab.skipped.auth_not_ready');
      return;
    }
    if (staffTabLoadInFlightRef.current) {
      debugAttendanceLoader('loadStaffTab.reused_inflight');
      return staffTabLoadInFlightRef.current;
    }
    const loadPromise = (async () => {
      try {
        debugAttendanceLoader('loadStaffTab.start');
        setTabLoading(true);
        const [staffRes, approvedLeavesRes] = await Promise.all([
          apiService.listAttendanceStaff({ school_id: 1, limit: 200 }),
          apiService.listAttendanceLeaves({ school_id: 1, status: 'approved' }).catch(() => ({ data: [] })),
        ]);
        setStaffMembers(toArray<AttendanceStaff>(staffRes.data));
        setStaffApprovedLeaves(toArray<AttendanceLeave>(approvedLeavesRes.data));
        if (staffFilters.department) {
          void loadStaffMarking();
        }
        setLoadedTabs((current) => ({ ...current, staff: true }));
      } catch (error: any) {
        if (isRequestCanceled(error)) {
          debugAttendanceLoader('loadStaffTab.canceled');
          return;
        }
        setAlert({ type: 'error', message: getApiErrorMessage(error, 'Staff attendance load nahi hua.') });
      } finally {
        debugAttendanceLoader('loadStaffTab.end');
        setLoading(false);
        setTabLoading(false);
      }
    })().finally(() => {
      staffTabLoadInFlightRef.current = null;
    });
    staffTabLoadInFlightRef.current = loadPromise;
    return loadPromise;
  };

  const refreshApprovedStaffLeaves = async () => {
    if (!canRunAttendanceRequests) {
      debugAttendanceLoader('refreshApprovedStaffLeaves.skipped.auth_not_ready');
      return;
    }
    try {
      const response = await apiService.listAttendanceLeaves({ school_id: 1, status: 'approved' });
      setStaffApprovedLeaves(toArray<AttendanceLeave>(response.data));
    } catch {
      // Keep existing approved leave data if refresh fails.
    }
  };

  const refreshStaffLeaveViews = async () => {
    await refreshApprovedStaffLeaves();

    if (isStaffTabVisible) {
      await loadStaffCalendarRecords();
      if (staffFilters.department) {
        await loadStaffMarking();
      }
    }
  };

  const loadLeavesTab = async () => {
    if (!canRunAttendanceRequests) {
      debugAttendanceLoader('loadLeavesTab.skipped.auth_not_ready');
      return;
    }
    try {
      debugAttendanceLoader('loadLeavesTab.start');
      setTabLoading(true);
      const [leavesRes, staffRes] = await Promise.all([
        apiService.listAttendanceLeaves({ school_id: 1 }),
        staffMembers.length ? Promise.resolve({ data: staffMembers }) : apiService.listAttendanceStaff({ school_id: 1, limit: 200 }),
      ]);
      setLeaves(toArray<AttendanceLeave>(leavesRes.data));
      setStaffMembers(toArray<AttendanceStaff>(staffRes.data));
      setLoadedTabs((current) => ({ ...current, leaves: true }));
    } catch (error: any) {
      if (isRequestCanceled(error)) {
        debugAttendanceLoader('loadLeavesTab.canceled');
        return;
      }
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'Leave module load nahi hua.') });
    } finally {
      debugAttendanceLoader('loadLeavesTab.end');
      setLoading(false);
      setTabLoading(false);
    }
  };

  useEffect(() => {
    if (!canRunAttendanceRequests) return;
    if (tabLoading || loadedTabs[activeTab] || tabAutoLoadDone[activeTab]) return;
    setTabAutoLoadDone((current) => ({ ...current, [activeTab]: true }));
    if (activeTab === 'overview') {
      debugAttendanceLoader('effect.autoload.overview');
      void loadOverviewData({ initial: true, force: true });
      return;
    }
    if (activeTab === 'student') {
      debugAttendanceLoader('effect.autoload.student');
      void loadStudentTab();
      return;
    }
    if (activeTab === 'staff') {
      debugAttendanceLoader('effect.autoload.staff');
      void loadStaffTab();
      return;
    }
    if (activeTab === 'leaves') {
      debugAttendanceLoader('effect.autoload.leaves');
      void loadLeavesTab();
      return;
    }
    if (activeTab === 'reports') {
      debugAttendanceLoader('effect.autoload.reports');
      setLoadedTabs((current) => ({ ...current, [activeTab]: true }));
      setLoading(false);
    }
  }, [activeTab, loading, loadedTabs, tabLoading, tabAutoLoadDone, canRunAttendanceRequests]);

  useEffect(() => {
    if (!loading) return;
    if (authLoading || !authInitialized) return;

    if (!visibleTabs.length) {
      debugAttendanceLoader('effect.loading_recovery.no_visible_tabs');
      setLoading(false);
      return;
    }

    if (!visibleTabs.some((tab) => tab.key === activeTab)) {
      debugAttendanceLoader('effect.loading_recovery.waiting_for_visible_tab');
      return;
    }

    if (!canRunAttendanceRequests) {
      debugAttendanceLoader('effect.loading_recovery.auth_settled_without_session');
      setLoading(false);
      return;
    }

    if (loadedTabs[activeTab]) {
      debugAttendanceLoader('effect.loading_recovery.active_tab_loaded');
      setLoading(false);
      return;
    }

    if (activeTab === 'reports') {
      debugAttendanceLoader('effect.loading_recovery.reports');
      setLoading(false);
    }
  }, [
    activeTab,
    authInitialized,
    authLoading,
    canRunAttendanceRequests,
    loadedTabs,
    loading,
    visibleTabs,
  ]);

  useEffect(() => {
    if (!isStudentTabVisible || user?.role !== 'teacher' || !canViewStudentTab) return;
    debugAttendanceLoader('effect.student.teacher_context');
    void loadTeacherAttendanceContext();
  }, [isStudentTabVisible, user?.role, studentFilters.date, canViewStudentTab]);

  useEffect(() => {
    if (!isOverviewTabVisible) return;
    if (!loadedTabs.overview || overviewPendingRefreshRef.current) {
      debugAttendanceLoader('effect.overview.visible_refresh', {
        loaded: loadedTabs.overview,
        pendingRefresh: overviewPendingRefreshRef.current,
      });
      void loadOverviewData({ initial: !loadedTabs.overview, force: overviewPendingRefreshRef.current });
    }
  }, [isOverviewTabVisible, loadedTabs.overview]);

  useEffect(() => {
    if (staffFilters.department) {
      loadStaffMarking();
    }
  }, [staffFilters.department, staffFilters.date]);

  useEffect(() => {
    if (!isStaffTabVisible) return;
    debugAttendanceLoader('effect.staff.records');
    void loadStaffRecords();
  }, [
    isStaffTabVisible,
    staffFilters.recordDepartment,
    staffFilters.recordStaffName,
    staffFilters.recordDate,
    staffFilters.dashboardDepartment,
    staffFilters.dashboardDate,
  ]);

  useEffect(() => {
    if (!isStaffTabVisible) return;
    debugAttendanceLoader('effect.staff.calendar');
    void loadStaffCalendarRecords();
  }, [
    isStaffTabVisible,
    staffFilters.department,
    staffFilters.date,
  ]);

  useEffect(() => {
    if (activeTab !== 'reports') return;
    if (managedBatches.length) return;
    debugAttendanceLoader('effect.reports.managed_batches');
    void loadManagedBatches({ force: false });
  }, [activeTab, managedBatches.length]);

  useEffect(() => {
    if (activeTab !== 'student') return;
    if (managedBatches.length || !students.length) return;

    const normalizedBatches = buildAttendanceBatches(students, Number(currentSchoolId) || 1);
    if (!normalizedBatches.length) return;

    debugAttendanceLoader('effect.student.recover_managed_batches', {
      batchCount: normalizedBatches.length,
      studentCount: students.length,
    });

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
          : current.record_batch_name || normalizedBatches[0]?.name || '',
    }));
  }, [activeTab, currentSchoolId, managedBatches.length, students]);

  const managedBatchOptions = useMemo(() => {
    const names = managedBatches
      .filter((item) => getManagedAttendanceCategory(item) === 'batch')
      .map((item) => String(item.name || '').trim())
      .filter(Boolean);
    if (names.length) {
      return names;
    }
    return Array.from(
      new Set(
        students
          .map((student) => getAttendanceStudentBatchName(student))
          .filter(Boolean)
      )
    ).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
  }, [managedBatches, students]);

  const managedClassOptions = useMemo(() => {
    const names = managedBatches
      .filter((item) => getManagedAttendanceCategory(item) === 'class')
      .map((item) => String(item.name || '').trim())
      .filter(Boolean);
    if (names.length) {
      return names;
    }
    return Array.from(
      new Set(
        students
          .map((student) => String(student.class_name || '').trim())
          .filter(Boolean)
      )
    ).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
  }, [managedBatches, students]);

  const batchOptions = useMemo(
    () => (studentFilters.attendance_scope === 'class' ? managedClassOptions : managedBatchOptions),
    [managedBatchOptions, managedClassOptions, studentFilters.attendance_scope]
  );

  const recordBatchOptions = useMemo(
    () => (studentFilters.record_scope === 'class' ? managedClassOptions : managedBatchOptions),
    [managedBatchOptions, managedClassOptions, studentFilters.record_scope]
  );

  useEffect(() => {
    setStudentFilters((current) => {
      const nextOptions = current.attendance_scope === 'class' ? managedClassOptions : managedBatchOptions;
      if (!nextOptions.length) return current;
      if (current.batch_name && nextOptions.includes(current.batch_name)) return current;
      return {
        ...current,
        batch_name: nextOptions[0],
        subject_id: '',
      };
    });
  }, [managedBatchOptions, managedClassOptions]);

  useEffect(() => {
    setStudentFilters((current) => {
      const nextOptions = current.record_scope === 'class' ? managedClassOptions : managedBatchOptions;
      if (!nextOptions.length) return current;
      if (!current.record_batch_name || nextOptions.includes(current.record_batch_name)) return current;
      return {
        ...current,
        record_batch_name: nextOptions[0],
      };
    });
  }, [managedBatchOptions, managedClassOptions]);
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

  const selectedBatchParts = useMemo(
    () => inferAttendanceSelectionParts(studentFilters.batch_name, studentFilters.attendance_scope, students),
    [studentFilters.attendance_scope, studentFilters.batch_name, students]
  );

  const recordBatchParts = useMemo(
    () => inferAttendanceSelectionParts(studentFilters.record_batch_name, studentFilters.record_scope, students),
    [studentFilters.record_batch_name, studentFilters.record_scope, students]
  );

  const selectedManagedAttendanceItem = useMemo(
    () => resolveManagedBatchSelection(managedBatches, studentFilters.batch_name, studentFilters.attendance_scope),
    [managedBatches, studentFilters.attendance_scope, studentFilters.batch_name]
  );

  const calendarBatchParts = useMemo(
    () => selectedBatchParts,
    [selectedBatchParts]
  );

  const calendarBatchLabel = (studentFilters.batch_name || '').trim();
  const studentSecondaryHydrationKey = useMemo(
    () =>
      [
        studentPrimaryHydrationReadyKey,
        studentFilters.attendance_scope,
        studentFilters.batch_name,
        calendarBatchParts.className,
        calendarBatchParts.section,
        studentFilters.dashboard_date,
        attendanceStudentDashboardPageSize,
      ].join('|'),
    [
      attendanceStudentDashboardPageSize,
      calendarBatchParts.className,
      calendarBatchParts.section,
      studentFilters.attendance_scope,
      studentFilters.batch_name,
      studentFilters.dashboard_date,
      studentPrimaryHydrationReadyKey,
    ]
  );

  const batchSubjectOptions = useMemo(
    () => {
      const exactBatchSubjects = subjects
        .filter((item) =>
          studentFilters.attendance_scope === 'class'
            ? normalizeClassNameKey(item.class_name) === normalizeClassNameKey(selectedBatchParts.className)
            : subjectMatchesBatchSelection(
                item,
                studentFilters.batch_name,
                selectedBatchParts.className,
                selectedBatchParts.section,
              )
        )
        .sort((a, b) => a.name.localeCompare(b.name));

      const matchingSubjects = exactBatchSubjects.length
        ? exactBatchSubjects
        : subjects
          .filter(
            (item) =>
              studentFilters.attendance_scope === 'class'
                ? normalizeClassNameKey(item.class_name) === normalizeClassNameKey(selectedBatchParts.className)
                : item.class_name === selectedBatchParts.className &&
                  item.section === selectedBatchParts.section
          )
          .sort((a, b) => a.name.localeCompare(b.name));

      const specificSubjects = matchingSubjects.filter(
        (item) => item.name.trim().toLowerCase() !== 'general attendance'
      );

      return specificSubjects.length ? specificSubjects : matchingSubjects;
    },
    [studentFilters.attendance_scope, studentFilters.batch_name, subjects, selectedBatchParts.className, selectedBatchParts.section]
  );

  const selectedBatchRosterStudents = useMemo(() => {
    const matchedStudents = students.filter((student) =>
      studentFilters.attendance_scope === 'class'
        ? normalizeClassNameKey(String(student.class_name || '').trim()) === normalizeClassNameKey(studentFilters.batch_name)
        : studentMatchesBatchSelection(student, studentFilters.batch_name)
    );
    if (matchedStudents.length) {
      return matchedStudents;
    }
    if (selectedBatchParts.className && selectedBatchParts.section) {
      return students.filter(
        (student) =>
          String(student.class_name || '').trim().toLowerCase() === selectedBatchParts.className.trim().toLowerCase()
          && String(student.section || '').trim().toLowerCase() === selectedBatchParts.section.trim().toLowerCase()
      );
    }
    if (selectedBatchParts.className) {
      return students.filter(
        (student) =>
          normalizeClassNameKey(String(student.class_name || '').trim()) ===
          normalizeClassNameKey(selectedBatchParts.className)
      );
    }
    return [];
  }, [selectedBatchParts.className, selectedBatchParts.section, studentFilters.attendance_scope, studentFilters.batch_name, students]);

  const selectedTimetableParts = useMemo(() => {
    const managedClassName = String(selectedManagedAttendanceItem?.class_name || '').trim();
    const managedSection = String(selectedManagedAttendanceItem?.section || '').trim();
    const rosterClassName = String(selectedBatchRosterStudents[0]?.class_name || '').trim();
    const rosterSection = String(selectedBatchRosterStudents[0]?.section || '').trim();

    return {
      className: selectedBatchParts.className || managedClassName || rosterClassName,
      section: selectedBatchParts.section || managedSection || rosterSection,
    };
  }, [selectedBatchParts.className, selectedBatchParts.section, selectedBatchRosterStudents, selectedManagedAttendanceItem]);

  const studentPrimaryHydrationKey = useMemo(
    () =>
      [
        currentSchoolId,
        studentFilters.attendance_scope,
        studentFilters.batch_name,
        selectedTimetableParts.className,
        selectedTimetableParts.section,
        recordBatchParts.className,
        recordBatchParts.section,
        studentFilters.date,
        studentFilters.recordStudentName.trim().toLowerCase(),
        studentFilters.record_batch_name?.trim().toLowerCase() || '',
        attendanceStudentRecordPageSize,
      ].join('|'),
    [
      attendanceStudentRecordPageSize,
      currentSchoolId,
      recordBatchParts.className,
      recordBatchParts.section,
      studentFilters.attendance_scope,
      studentFilters.batch_name,
      studentFilters.record_batch_name,
      selectedTimetableParts.className,
      selectedTimetableParts.section,
      studentFilters.date,
      studentFilters.recordStudentName,
    ]
  );

  const selectedBatchSubject = useMemo(
    () =>
      batchSubjectOptions.find((item) => normalizeSubjectId(item.id) === normalizeSubjectId(studentFilters.subject_id)) ||
      batchSubjectOptions[0] ||
      null,
    [batchSubjectOptions, studentFilters.subject_id]
  );

  const buildFallbackStudentMarking = useCallback((): StudentAttendanceMarkingResponse | null => {
    const resolvedClassName =
      selectedBatchParts.className || String(selectedBatchRosterStudents[0]?.class_name || '').trim();
    const resolvedSection =
      selectedBatchParts.section || String(selectedBatchRosterStudents[0]?.section || '').trim();
    if (!selectedBatchRosterStudents.length) return null;

    const normalizedSearch = String(studentFilters.search || '').trim().toLowerCase();
    const previousRows = new Map(
      toArray<StudentAttendanceMarkingRow>(studentMarking?.students).map((row) => [String(row.student_id), row])
    );

    const matchingStudents = selectedBatchRosterStudents
      .filter((student) => {
        if (!normalizedSearch) return true;
        const name = String(student.name || '').trim().toLowerCase();
        const rollNo = String(student.roll_no || '').trim().toLowerCase();
        return name.includes(normalizedSearch) || rollNo.includes(normalizedSearch);
      })
      .map((student) => {
        const previous = previousRows.get(String(student.id));
        return {
          student_id: student.id,
          student_name: student.name,
          roll_no: student.roll_no,
          class_name: student.class_name,
          section: student.section,
          status: previous?.status || 'present',
          absence_reason: previous?.absence_reason,
        } satisfies StudentAttendanceMarkingRow;
      });

    return {
      date: studentFilters.date,
      class_name: resolvedClassName,
      section: resolvedSection,
      subject_id: pickPreferredSubjectId(
        studentFilters.subject_id,
        selectedBatchSubject?.id,
        batchAttendanceContext?.subject_id,
        teacherAttendanceContext?.subject_id,
      ),
      subject_name: selectedBatchSubject?.name || batchAttendanceContext?.subject || teacherAttendanceContext?.subject,
      students: matchingStudents,
    };
  }, [
    batchAttendanceContext?.subject_id,
    batchAttendanceContext?.subject,
    teacherAttendanceContext?.subject_id,
    teacherAttendanceContext?.subject,
    selectedBatchRosterStudents,
    selectedBatchParts.className,
    selectedBatchParts.section,
    selectedBatchSubject?.id,
    selectedBatchSubject?.name,
    studentFilters.date,
    studentFilters.search,
    studentMarking?.students,
    selectedBatchRosterStudents,
  ]);

  const visibleStudentMarkingRows = useMemo(
    () => buildFallbackStudentMarking()?.students || [],
    [buildFallbackStudentMarking]
  );

  const updateStudentMarking = useCallback(
    (
      updater: (current: StudentAttendanceMarkingResponse) => StudentAttendanceMarkingResponse
    ) => {
      setStudentMarking((current) => {
        const base = current || buildFallbackStudentMarking();
        if (!base) {
          return current;
        }
        return updater(base);
      });
    },
    [buildFallbackStudentMarking]
  );

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

  const studentBatchSummary = useMemo(() => {
    const rows = studentRecords.filter((record) =>
      recordMatchesSelectionScope(
        record,
        studentFilters.attendance_scope,
        selectedBatchParts.className,
        selectedBatchParts.section,
      )
    );
    const present = rows.filter((record) => record.status === 'present').length;
    const absent = rows.filter((record) => record.status === 'absent').length;
    const late = rows.filter((record) => record.status === 'late').length;
    return { present, absent, late, total: rows.length };
  }, [studentRecords, studentFilters.attendance_scope, selectedBatchParts.className, selectedBatchParts.section]);

  const selectedBatchStudentCount = useMemo(() => {
    const managedCount = resolveManagedAttendanceStudentCount(
      managedBatches,
      studentFilters.batch_name,
      studentFilters.attendance_scope
    );
    return managedCount > 0 ? managedCount : selectedBatchRosterStudents.length;
  }, [
    managedBatches,
    selectedBatchRosterStudents.length,
    studentFilters.attendance_scope,
    studentFilters.batch_name,
  ]);

  const selectedRecordStudentCount = useMemo(() => {
    const managedCount = resolveManagedAttendanceStudentCount(
      managedBatches,
      studentFilters.record_batch_name,
      studentFilters.record_scope
    );
    if (managedCount > 0) {
      return managedCount;
    }

    return students.filter((student) =>
      studentFilters.record_scope === 'class'
        ? normalizeClassNameKey(String(student.class_name || '').trim()) === normalizeClassNameKey(studentFilters.record_batch_name)
        : studentMatchesBatchSelection(student, studentFilters.record_batch_name)
    ).length;
  }, [managedBatches, studentFilters.record_batch_name, studentFilters.record_scope, students]);

  const loadSelectedBatchStudentsFallback = useCallback(async () => {
    const batchLabel = String(studentFilters.batch_name || '').trim();
    if (!batchLabel || !canRunAttendanceRequests) return;
    const requestKey = `${currentSchoolId}|${batchLabel}|${attendanceStudentBatchFallbackPageSize}`;
    if (
      batchStudentFallbackRequestKeyRef.current === requestKey &&
      batchStudentFallbackPromiseRef.current
    ) {
      return batchStudentFallbackPromiseRef.current;
    }

    batchStudentFallbackRequestKeyRef.current = requestKey;
    const loadPromise = (async () => {
      debugAttendanceLoader('loadSelectedBatchStudentsFallback.start', { batchLabel, requestKey });
      try {
        const genericStudentsRes = await apiService.listStudents(
          1,
          0,
          attendanceStudentBatchFallbackPageSize,
          batchLabel,
        ).catch(() => ({ data: [] as Student[] }));

        let fallbackStudents = toArray<Student>(genericStudentsRes.data)
          .map(normalizeStudentToAttendanceStudent)
          .filter((student) => student.name);

        if (!fallbackStudents.length) {
          const broadStudentsRes = await apiService.listStudents(
            1,
            0,
            attendanceStudentBatchFallbackPageSize,
          ).catch(() => ({ data: [] as Student[] }));
          fallbackStudents = toArray<Student>(broadStudentsRes.data)
            .map(normalizeStudentToAttendanceStudent)
            .filter((student) => student.name && studentMatchesBatchSelection(student, batchLabel));
        }

        if (!fallbackStudents.length) {
          debugAttendanceLoader('loadSelectedBatchStudentsFallback.empty', { batchLabel, requestKey });
          return;
        }

        setStudents((current) => {
          const merged = new Map<string, AttendanceStudent>();
          for (const student of current) {
            merged.set(String(student.id), student);
          }
          for (const student of fallbackStudents) {
            merged.set(String(student.id), student);
          }
          return Array.from(merged.values());
        });
      } finally {
        debugAttendanceLoader('loadSelectedBatchStudentsFallback.end', { batchLabel, requestKey });
      }
    })().finally(() => {
      if (batchStudentFallbackRequestKeyRef.current === requestKey) {
        batchStudentFallbackPromiseRef.current = null;
      }
    });

    batchStudentFallbackPromiseRef.current = loadPromise;
    return loadPromise;
  }, [attendanceStudentBatchFallbackPageSize, canRunAttendanceRequests, currentSchoolId, studentFilters.batch_name]);

  useEffect(() => {
    if (!selectedTimetableParts.className) return;
    if (studentFilters.attendance_scope === 'batch' && !selectedTimetableParts.section) return;

    const currentSubjectId = normalizeSubjectId(studentFilters.subject_id);
    const selectedExists = batchSubjectOptions.some((item) => normalizeSubjectId(item.id) === currentSubjectId);
    const nextSubjectId = selectedExists
      ? currentSubjectId
      : pickPreferredSubjectId(
        batchAttendanceContext?.subject_id,
        teacherAttendanceContext?.subject_id,
        batchSubjectOptions[0]?.id,
      );

    if (nextSubjectId !== currentSubjectId) {
      setStudentFilters((current) => ({
        ...current,
        subject_id: nextSubjectId,
      }));
    }
  }, [
    batchAttendanceContext?.subject_id,
    batchSubjectOptions,
    studentFilters.attendance_scope,
    selectedTimetableParts.className,
    selectedTimetableParts.section,
    studentFilters.subject_id,
    teacherAttendanceContext?.subject_id,
  ]);

  useEffect(() => {
    if (!isStudentTabVisible || !studentFilters.batch_name) return;
    if (selectedBatchRosterStudents.length) return;
    void loadSelectedBatchStudentsFallback();
  }, [
    isStudentTabVisible,
    loadSelectedBatchStudentsFallback,
    selectedBatchRosterStudents.length,
    studentFilters.batch_name,
  ]);

  useEffect(() => {
    setBatchAttendanceContext(null);
    setBatchAttendanceOptions([]);
    setSelectedBatchAttendanceEntryId('');
    setStudentMarking(null);
    if (user?.role !== 'teacher') {
      setTeacherAttendanceContext(null);
    }
  }, [studentFilters.attendance_scope, studentFilters.batch_name, studentFilters.date, user?.role]);

  useEffect(() => {
    if (!isStudentTabVisible || !studentFilters.batch_name) return;
    const fallbackMarking = buildFallbackStudentMarking();
    if (!fallbackMarking?.students.length) return;
    setStudentMarking((current) => {
      if (!current) {
        return fallbackMarking;
      }
      const sameBatch =
        String(current.class_name || '').trim() === String(fallbackMarking.class_name || '').trim()
        && String(current.section || '').trim() === String(fallbackMarking.section || '').trim();
      if (!sameBatch || !current.students.length || current.students.length < fallbackMarking.students.length) {
        const currentRows = new Map(current.students.map((row) => [String(row.student_id), row]));
        return {
          ...fallbackMarking,
          subject_id: pickPreferredSubjectId(current.subject_id, fallbackMarking.subject_id),
          subject_name: current.subject_name || fallbackMarking.subject_name,
          students: fallbackMarking.students.map((row) => {
            const existing = currentRows.get(String(row.student_id));
            return existing
              ? {
                  ...row,
                  status: existing.status || row.status,
                  absence_reason: existing.absence_reason ?? row.absence_reason,
                }
              : row;
          }),
        };
      }
      return current;
    });
  }, [buildFallbackStudentMarking, isStudentTabVisible, studentFilters.batch_name]);

  useEffect(() => {
    const effectiveSubjectId = pickPreferredSubjectId(
      studentFilters.subject_id,
      selectedBatchSubject?.id,
      batchAttendanceContext?.subject_id,
      teacherAttendanceContext?.subject_id,
    );
    if (!effectiveSubjectId) return;
    setStudentMarking((current) => {
      if (!current) return current;
      const currentSubjectId = normalizeSubjectId(current.subject_id);
      const nextSubjectName =
        selectedBatchSubject?.name
        || current.subject_name
        || batchSubjectOptions.find((item) => normalizeSubjectId(item.id) === effectiveSubjectId)?.name
        || '';
      if (currentSubjectId === effectiveSubjectId && current.subject_name === nextSubjectName) {
        return current;
      }
      return {
        ...current,
        subject_id: effectiveSubjectId,
        subject_name: nextSubjectName,
      };
    });
  }, [
    batchAttendanceContext?.subject_id,
    batchSubjectOptions,
    selectedBatchSubject?.id,
    selectedBatchSubject?.name,
    studentFilters.subject_id,
    teacherAttendanceContext?.subject_id,
  ]);

  useEffect(() => {
    if (!isStudentTabVisible || !canRunAttendanceRequests) return;
    if (!selectedTimetableParts.className && !studentFilters.batch_name) return;
    if (studentFilters.attendance_scope === 'batch' && !selectedTimetableParts.section && !studentFilters.batch_name) return;
    if (
      studentPrimaryHydrationKeyRef.current === studentPrimaryHydrationKey &&
      studentPrimaryHydrationPromiseRef.current
    ) {
      return;
    }
    if (
      studentPrimaryHydrationKeyRef.current === studentPrimaryHydrationKey &&
      studentPrimaryHydrationReadyKey === studentPrimaryHydrationKey
    ) {
      return;
    }

    studentPrimaryHydrationKeyRef.current = studentPrimaryHydrationKey;
    if (studentPrimaryHydrationReadyKey) {
      setStudentPrimaryHydrationReadyKey('');
    }

    const hydratePromise = (async () => {
      debugAttendanceLoader('effect.student.primary_hydration', {
        requestKey: studentPrimaryHydrationKey,
      });
      const batchContext = await loadBatchAttendanceContext();
      if (studentPrimaryHydrationKeyRef.current !== studentPrimaryHydrationKey) return;
      const recordBatchName = studentFilters.record_scope === 'batch' ? (studentFilters.record_batch_name || '').trim() : '';
      await Promise.all([
        loadStudentMarking({
          subjectId: pickPreferredSubjectId(
            batchContext?.subject_id,
            teacherAttendanceContext?.subject_id,
          ),
          subjectName: batchContext?.subject || teacherAttendanceContext?.subject || '',
        }),
        (recordBatchParts.className && (studentFilters.record_scope === 'class' || recordBatchParts.section)) || recordBatchName
          ? loadStudentRecords()
          : Promise.resolve(),
      ]);
      if (studentPrimaryHydrationKeyRef.current !== studentPrimaryHydrationKey) return;
      setStudentPrimaryHydrationReadyKey(studentPrimaryHydrationKey);
    })().finally(() => {
      if (studentPrimaryHydrationKeyRef.current === studentPrimaryHydrationKey) {
        studentPrimaryHydrationPromiseRef.current = null;
      }
    });

    studentPrimaryHydrationPromiseRef.current = hydratePromise;
    void hydratePromise;
  }, [
    canRunAttendanceRequests,
    isStudentTabVisible,
    studentFilters.attendance_scope,
    selectedTimetableParts.className,
    selectedTimetableParts.section,
    studentPrimaryHydrationKey,
    studentPrimaryHydrationReadyKey,
    recordBatchParts.className,
    recordBatchParts.section,
    studentFilters.record_scope,
    teacherAttendanceContext?.subject,
    teacherAttendanceContext?.subject_id,
  ]);

  useEffect(() => {
    if (!isStudentTabVisible || !canRunAttendanceRequests) return;
    if (!studentPrimaryHydrationReadyKey) return;
    if (!calendarBatchParts.className) return;
    if (studentFilters.attendance_scope === 'batch' && !calendarBatchParts.section) return;
    if (
      studentSecondaryHydrationKeyRef.current === studentSecondaryHydrationKey &&
      studentSecondaryHydrationPromiseRef.current
    ) {
      return;
    }

    studentSecondaryHydrationKeyRef.current = studentSecondaryHydrationKey;
    const hydratePromise = (async () => {
      debugAttendanceLoader('effect.student.secondary_hydration', {
        requestKey: studentSecondaryHydrationKey,
      });
      await new Promise((resolve) => window.setTimeout(resolve, attendanceSecondaryHydrationDelayMs));
      if (studentSecondaryHydrationKeyRef.current !== studentSecondaryHydrationKey) return;
      await Promise.all([
        loadTodayStudentDashboard(studentFilters.dashboard_date),
        loadStudentCalendarRecords(),
      ]);
    })().finally(() => {
      if (studentSecondaryHydrationKeyRef.current === studentSecondaryHydrationKey) {
        studentSecondaryHydrationPromiseRef.current = null;
      }
    });

    studentSecondaryHydrationPromiseRef.current = hydratePromise;
    void hydratePromise;
  }, [
    attendanceSecondaryHydrationDelayMs,
    calendarBatchParts.className,
    calendarBatchParts.section,
    canRunAttendanceRequests,
    isStudentTabVisible,
    studentFilters.attendance_scope,
    studentFilters.dashboard_date,
    studentPrimaryHydrationReadyKey,
    studentSecondaryHydrationKey,
  ]);

  const todayBatchWiseSummary = useMemo(() => {
    const grouped = new Map<
      string,
      { batch_name: string; present: number; absent: number; late: number; total: number }
    >();
    const scopedRecords = summarizeStudentDayRecords(todayStudentRecords).filter((record) =>
      recordMatchesSelectionScope(
        {
          class_name: splitBatchLabel(record.batch_name).className,
          section: splitBatchLabel(record.batch_name).section,
        },
        studentFilters.attendance_scope,
        selectedBatchParts.className,
        selectedBatchParts.section,
      )
    );
    for (const record of scopedRecords) {
      const parsedBatch = splitBatchLabel(record.batch_name);
      const key = getAttendanceRecordBatchLabel(
        managedBatches,
        parsedBatch.className,
        parsedBatch.section,
      );
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
  }, [managedBatches, selectedBatchParts.className, selectedBatchParts.section, studentFilters.attendance_scope, todayStudentRecords]);

  const todayOverallSummary = useMemo(() => {
    const normalizedRecords = summarizeStudentDayRecords(todayStudentRecords).filter((record) =>
      recordMatchesSelectionScope(
        {
          class_name: splitBatchLabel(record.batch_name).className,
          section: splitBatchLabel(record.batch_name).section,
        },
        studentFilters.attendance_scope,
        selectedBatchParts.className,
        selectedBatchParts.section,
      )
    );
    const present = normalizedRecords.filter((record) => record.status === 'present').length;
    const absent = normalizedRecords.filter((record) => record.status === 'absent').length;
    return { present, absent, late: 0, total: normalizedRecords.length };
  }, [selectedBatchParts.className, selectedBatchParts.section, studentFilters.attendance_scope, todayStudentRecords]);

  const calendarSourceRecords = useMemo(() => {
    if (studentCalendarUsingMonthFallback) {
      return studentCalendarRecords;
    }

    const matchedCalendarRecords = studentCalendarRecords.filter((record) =>
      recordMatchesSelectionScope(
        record,
        studentFilters.attendance_scope,
        calendarBatchParts.className,
        calendarBatchParts.section,
      )
    );

    return matchedCalendarRecords;
  }, [
    calendarBatchParts.className,
    calendarBatchParts.section,
    studentCalendarRecords,
    studentCalendarUsingMonthFallback,
    studentFilters.attendance_scope,
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

  const loadStudentMarking = async (options?: { subjectId?: string; subjectName?: string }) => {
    const fallbackMarking = buildFallbackStudentMarking();
    if (!canRunAttendanceRequests) {
      setStudentMarking(fallbackMarking);
      return;
    }
    if (!selectedTimetableParts.className || !selectedTimetableParts.section) {
      setStudentMarking(fallbackMarking);
      return;
    }

    try {
      const effectiveSubjectId = pickPreferredSubjectId(
        options?.subjectId,
        studentFilters.subject_id,
        batchAttendanceContext?.subject_id,
        teacherAttendanceContext?.subject_id,
        fallbackMarking?.subject_id,
      );
      const response = await apiService.getStudentAttendanceMarking({
        date: studentFilters.date,
        class_name: selectedTimetableParts.className,
        section: selectedTimetableParts.section,
        subject_id: effectiveSubjectId || undefined,
        search: studentFilters.search || undefined,
        school_id: 1,
      });
      const payload = response.data;
      if (!payload || typeof payload !== 'object') {
        setStudentMarking(fallbackMarking);
        return;
      }
      const normalizedPayload: StudentAttendanceMarkingResponse = {
        ...(payload as StudentAttendanceMarkingResponse),
        students: toArray<StudentAttendanceMarkingRow>((payload as StudentAttendanceMarkingResponse).students),
        subject_id: effectiveSubjectId || (payload as StudentAttendanceMarkingResponse).subject_id,
        subject_name:
          options?.subjectName
          || (payload as StudentAttendanceMarkingResponse).subject_name
          || fallbackMarking?.subject_name,
      };
      setStudentMarking(normalizedPayload);
    } catch (error: any) {
      if (!isRequestCanceled(error)) {
        console.error('Error loading student attendance marking:', error);
      }
      setStudentMarking(fallbackMarking);
    }
  };

  const loadTeacherAttendanceContext = async () => {
    if (!canRunAttendanceRequests || user?.role !== 'teacher' || !canViewStudentTab) {
      setTeacherAttendanceContext(null);
      return;
    }
    try {
      const response = await apiService.getTeacherAttendanceContext({
        target_date: studentFilters.date,
        current_time: getCurrentTimeHHMM(),
        school_id: 1,
      });
      const context = response.data || null;
      setTeacherAttendanceContext(context);
      upsertAttendanceSubject(context);
    } catch (error: any) {
      if (!isRequestCanceled(error)) {
        console.error('Error loading teacher attendance context:', error);
      }
      setTeacherAttendanceContext(null);
    }
  };

  const loadBatchAttendanceContext = async () => {
    if (!canRunAttendanceRequests || !selectedTimetableParts.className || !selectedTimetableParts.section) {
      setBatchAttendanceOptions([]);
      setSelectedBatchAttendanceEntryId('');
      setBatchAttendanceContext(null);
      return null;
    }
    try {
      setBatchAttendanceOptionsLoading(true);
      const response = await apiService.getBatchDayClasses({
        class_name: selectedTimetableParts.className,
        section: selectedTimetableParts.section,
        batch_name: studentFilters.attendance_scope === 'batch' ? studentFilters.batch_name : undefined,
        target_date: studentFilters.date,
        current_time: getCurrentTimeHHMM(),
        school_id: 1,
      });
      const contexts = toArray<TeacherAttendanceContext>(response.data);
      setBatchAttendanceOptions(contexts);
      const preferredContext = contexts.find(
        (item) => getAttendanceContextOptionValue(item) === selectedBatchAttendanceEntryId
      );
      const context = preferredContext || contexts.find((item) => item.matched_by_current_time) || contexts[0] || null;
      setSelectedBatchAttendanceEntryId(context ? getAttendanceContextOptionValue(context) : '');
      setBatchAttendanceContext(context);
      upsertAttendanceSubject(context);
      return context;
    } catch (error: any) {
      if (!isRequestCanceled(error)) {
        console.error('Error loading batch attendance context:', error);
      }
      setBatchAttendanceOptions([]);
      setSelectedBatchAttendanceEntryId('');
      setBatchAttendanceContext(null);
      return null;
    } finally {
      setBatchAttendanceOptionsLoading(false);
    }
  };

  const loadStudentRecords = async () => {
    if (!canRunAttendanceRequests) {
      debugAttendanceLoader('loadStudentRecords.skipped.auth_not_ready');
      return;
    }
    const requestedSection =
      studentFilters.record_scope === 'class' ? undefined : recordBatchParts.section;
    const recordBatchName = studentFilters.record_scope === 'batch' ? (studentFilters.record_batch_name || '').trim() : '';
    const requestKey = `${studentFilters.record_scope}|${recordBatchParts.className}|${requestedSection || ''}|${studentFilters.recordStudentName}|${recordBatchName}|${attendanceStudentRecordPageSize}`;
    const cachedRecords = readStudentRecordCache(requestKey);
    if (cachedRecords) {
      debugAttendanceLoader('loadStudentRecords.cache_hit', { requestKey, count: cachedRecords.length });
      setStudentRecords(cachedRecords);
      return;
    }
    if (
      studentRecordsRequestKeyRef.current === requestKey &&
      studentRecordsRequestPromiseRef.current
    ) {
      debugAttendanceLoader('loadStudentRecords.reused_inflight', { requestKey });
      return studentRecordsRequestPromiseRef.current;
    }
    studentRecordsRequestKeyRef.current = requestKey;
    const loadPromise = (async () => {
      try {
        debugAttendanceLoader('loadStudentRecords.start', {
          className: recordBatchParts.className,
          section: recordBatchParts.section,
          requestKey,
        });
        const response = await apiService.listStudentAttendanceRecords({
          school_id: 1,
          class_name: recordBatchParts.className || undefined,
          section: requestedSection || undefined,
          student_name: studentFilters.recordStudentName || undefined,
          batch_name: recordBatchName || undefined,
          limit: attendanceStudentRecordPageSize,
        });
        if (studentRecordsRequestKeyRef.current !== requestKey) return;
        const nextRecords = toArray<StudentAttendanceRecord>(response.data);
        writeStudentRecordCache(requestKey, nextRecords);
        setStudentRecords(nextRecords);
      } catch (error: any) {
        if (isRequestCanceled(error)) {
          debugAttendanceLoader('loadStudentRecords.canceled', { requestKey });
          return;
        }
        setAlert({ type: 'error', message: getApiErrorMessage(error, 'Student records load nahi hue.') });
      } finally {
        debugAttendanceLoader('loadStudentRecords.end', {
          className: recordBatchParts.className,
          section: recordBatchParts.section,
          requestKey,
        });
      }
    })().finally(() => {
      if (studentRecordsRequestKeyRef.current === requestKey) {
        studentRecordsRequestPromiseRef.current = null;
      }
    });
    studentRecordsRequestPromiseRef.current = loadPromise;
    return loadPromise;
  };

  const loadStudentCalendarRecords = async () => {
    if (!canRunAttendanceRequests) {
      debugAttendanceLoader('loadStudentCalendarRecords.skipped.auth_not_ready');
      return;
    }
    const requestedSection =
      studentFilters.attendance_scope === 'class' ? undefined : calendarBatchParts.section;
    if (!calendarBatchParts.className || (!requestedSection && studentFilters.attendance_scope === 'batch')) {
      setStudentCalendarRecords([]);
      setStudentCalendarUsingMonthFallback(false);
      return;
    }
    const monthRange = getMonthRange(studentFilters.dashboard_date);
    const requestKey = `${studentFilters.attendance_scope}|${calendarBatchParts.className}|${requestedSection || ''}|${monthRange.from}|${monthRange.to}|${attendanceStudentDashboardPageSize}`;
    const cachedRecords = readStudentRecordCache(requestKey);
    if (cachedRecords) {
      debugAttendanceLoader('loadStudentCalendarRecords.cache_hit', { requestKey, count: cachedRecords.length });
      setStudentCalendarUsingMonthFallback(false);
      setStudentCalendarRecords(cachedRecords);
      return;
    }
    if (
      studentCalendarRequestKeyRef.current === requestKey &&
      studentCalendarRequestPromiseRef.current
    ) {
      debugAttendanceLoader('loadStudentCalendarRecords.reused_inflight', { requestKey });
      return studentCalendarRequestPromiseRef.current;
    }
    studentCalendarRequestKeyRef.current = requestKey;
    const loadPromise = (async () => {
      try {
        debugAttendanceLoader('loadStudentCalendarRecords.start', {
          className: calendarBatchParts.className,
          section: calendarBatchParts.section,
          requestKey,
        });
        const response = await apiService.listStudentAttendanceRecords({
          school_id: 1,
          class_name: calendarBatchParts.className,
          section: requestedSection || undefined,
          date_from: monthRange.from || undefined,
          date_to: monthRange.to || undefined,
          limit: attendanceStudentDashboardPageSize,
        });
        if (studentCalendarRequestKeyRef.current !== requestKey) return;
        const exactMatchRecords = toArray<StudentAttendanceRecord>(response.data);
        writeStudentRecordCache(requestKey, exactMatchRecords);
        if (exactMatchRecords.length) {
          setStudentCalendarUsingMonthFallback(false);
          setStudentCalendarRecords(exactMatchRecords);
          return;
        }
        setStudentCalendarUsingMonthFallback(false);
        setStudentCalendarRecords([]);
      } catch (error: any) {
        if (isRequestCanceled(error)) {
          debugAttendanceLoader('loadStudentCalendarRecords.canceled', { requestKey });
          return;
        }
        setStudentCalendarRecords([]);
        setStudentCalendarUsingMonthFallback(false);
        setAlert({ type: 'error', message: getApiErrorMessage(error, 'Calendar dates load nahi hui.') });
      } finally {
        debugAttendanceLoader('loadStudentCalendarRecords.end', {
          className: calendarBatchParts.className,
          section: calendarBatchParts.section,
          requestKey,
        });
      }
    })().finally(() => {
      if (studentCalendarRequestKeyRef.current === requestKey) {
        studentCalendarRequestPromiseRef.current = null;
      }
    });
    studentCalendarRequestPromiseRef.current = loadPromise;
    return loadPromise;
  };

  const loadTodayStudentDashboard = async (targetDate: string = studentFilters.dashboard_date) => {
    if (!canRunAttendanceRequests) {
      debugAttendanceLoader('loadTodayStudentDashboard.skipped.auth_not_ready', { targetDate });
      return;
    }
    const requestKey = `${targetDate}|${attendanceStudentDashboardPageSize}`;
    const cachedRecords = readStudentRecordCache(requestKey);
    if (cachedRecords) {
      debugAttendanceLoader('loadTodayStudentDashboard.cache_hit', { requestKey, count: cachedRecords.length });
      setTodayStudentRecords(cachedRecords);
      return;
    }
    if (
      todayDashboardRequestKeyRef.current === requestKey &&
      todayDashboardRequestPromiseRef.current
    ) {
      debugAttendanceLoader('loadTodayStudentDashboard.reused_inflight', { targetDate, requestKey });
      return todayDashboardRequestPromiseRef.current;
    }
    todayDashboardRequestKeyRef.current = requestKey;
    const loadPromise = (async () => {
      try {
        debugAttendanceLoader('loadTodayStudentDashboard.start', { targetDate, requestKey });
        const response = await apiService.listStudentAttendanceRecords({
          school_id: 1,
          date_from: targetDate,
          date_to: targetDate,
          limit: attendanceStudentDashboardPageSize,
        });
        if (todayDashboardRequestKeyRef.current !== requestKey) return;
        const nextRecords = toArray<StudentAttendanceRecord>(response.data);
        writeStudentRecordCache(requestKey, nextRecords);
        setTodayStudentRecords(nextRecords);
      } catch (error: any) {
        if (isRequestCanceled(error)) {
          debugAttendanceLoader('loadTodayStudentDashboard.canceled', { targetDate, requestKey });
          return;
        }
        setAlert({ type: 'error', message: getApiErrorMessage(error, 'Aaj ka batch dashboard load nahi hua.') });
      } finally {
        debugAttendanceLoader('loadTodayStudentDashboard.end', { targetDate, requestKey });
      }
    })().finally(() => {
      if (todayDashboardRequestKeyRef.current === requestKey) {
        todayDashboardRequestPromiseRef.current = null;
      }
    });
    todayDashboardRequestPromiseRef.current = loadPromise;
    return loadPromise;
  };

  const refreshStudentTabViews = async (options?: { includeOverview?: boolean; forceOverview?: boolean }) => {
    if (isStudentTabVisible) {
      await Promise.all([
        loadStudentRecords(),
        loadStudentCalendarRecords(),
        loadTodayStudentDashboard(studentFilters.dashboard_date),
      ]);
    }
    if (options?.includeOverview) {
      await loadOverviewData({ force: options.forceOverview });
    }
  };

  const refreshStaffTabViews = async (options?: { includeOverview?: boolean; forceOverview?: boolean }) => {
    if (isStaffTabVisible) {
      await loadStaffRecords();
      await loadStaffCalendarRecords();
    }
    if (options?.includeOverview) {
      await loadOverviewData({ force: options.forceOverview });
    }
  };

  const loadStaffMarking = async () => {
    if (!canRunAttendanceRequests) {
      debugAttendanceLoader('loadStaffMarking.skipped.auth_not_ready');
      return;
    }
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
    if (!canRunAttendanceRequests) {
      debugAttendanceLoader('loadStaffRecords.skipped.auth_not_ready');
      return;
    }
    const requestKey = `${staffFilters.recordDepartment}|${staffFilters.recordStaffName}|${staffFilters.recordDate}|${staffFilters.dashboardDepartment}|${staffFilters.dashboardDate}`;
    staffRecordsRequestKeyRef.current = requestKey;
    try {
      debugAttendanceLoader('loadStaffRecords.start', { requestKey });
      const recordsRes = await apiService.listStaffAttendanceRecords({
        school_id: 1,
        department: staffFilters.recordDepartment || undefined,
        staff_name: staffFilters.recordStaffName || undefined,
        date_from: staffFilters.recordDate || undefined,
        date_to: staffFilters.recordDate || undefined,
        limit: 200,
      });
      if (staffRecordsRequestKeyRef.current !== requestKey) return;
      const nextRecords = toArray<StaffAttendanceRecord>(recordsRes.data);
      setStaffRecords(nextRecords);
      if (!staffFilters.dashboardDate) {
        setStaffDashboard(null);
        return;
      }
      const dashboardRes = await apiService.getStaffAttendanceDashboard({
        school_id: 1,
        department: staffFilters.dashboardDepartment || undefined,
        date_from: staffFilters.dashboardDate || undefined,
        date_to: staffFilters.dashboardDate || undefined,
      });
      if (staffRecordsRequestKeyRef.current !== requestKey) return;
      setStaffDashboard(normalizeStaffDashboard(dashboardRes.data, nextRecords));
    } catch (error: any) {
      if (isRequestCanceled(error)) {
        debugAttendanceLoader('loadStaffRecords.canceled', { requestKey });
        return;
      }
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'Staff records load nahi hue.') });
    } finally {
      debugAttendanceLoader('loadStaffRecords.end', { requestKey });
    }
  };

  const loadStaffCalendarRecords = async () => {
    if (!canRunAttendanceRequests) {
      debugAttendanceLoader('loadStaffCalendarRecords.skipped.auth_not_ready');
      return;
    }
    try {
      debugAttendanceLoader('loadStaffCalendarRecords.start');
      const monthRange = getMonthRange(staffFilters.date);
      const response = await apiService.listStaffAttendanceRecords({
        school_id: 1,
        department: staffFilters.department || undefined,
        date_from: monthRange.from || undefined,
        date_to: monthRange.to || undefined,
        limit: 200,
      });
      setStaffCalendarRecords(toArray<StaffAttendanceRecord>(response.data));
    } catch {
      setStaffCalendarRecords([]);
    } finally {
      debugAttendanceLoader('loadStaffCalendarRecords.end');
    }
  };

  const handleSaveStudentAttendance = async () => {
    const markingPayload = studentMarking || buildFallbackStudentMarking();
    if (!markingPayload) return;
    try {
      const effectiveSubjectId = pickPreferredSubjectId(
        studentFilters.subject_id,
        batchAttendanceContext?.subject_id,
        teacherAttendanceContext?.subject_id,
        markingPayload.subject_id,
      );
      await apiService.saveStudentAttendance({
        date: studentFilters.date,
        subject_id: effectiveSubjectId || undefined,
        marked_by: visibleAttendanceContext?.teacher_name || user?.full_name || 'Attendance Department',
        entries: markingPayload.students.map((item) => ({
          student_id: item.student_id,
          status: item.status,
          absence_reason: item.status === 'absent' ? item.absence_reason : undefined,
        })),
      });
      clearStudentRecordCaches();
      setAlert({ type: 'success', message: 'Student attendance save ho gayi.' });
      await refreshStudentTabViews({ includeOverview: true, forceOverview: true });
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
      await refreshStaffTabViews({ includeOverview: true, forceOverview: true });
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
      await loadOverviewData({ force: true });
    } catch (error: any) {
      setAlert({ type: 'error', message: error?.response?.data?.detail || 'Holiday add nahi hui.' });
    }
  };

  const handleCreateLeave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      await apiService.createAttendanceLeave({
        staff_member_id: String(leaveForm.staff_member_id).trim(),
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
      await loadOverviewData({ force: true });
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
      await loadOverviewData({ force: true });
    } catch (error: any) {
      setAlert({ type: 'error', message: error?.response?.data?.detail || 'Leave decision save nahi hua.' });
    }
  };

  const handleDeleteNotification = async (notificationId: number) => {
    if (!window.confirm('Delete this notification?')) return;
    try {
      await apiService.deleteAttendanceNotification(notificationId);
      setAlert({ type: 'success', message: 'Notification delete ho gayi.' });
      await loadOverviewData({ force: true });
    } catch (error: any) {
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'Notification delete nahi hui.') });
    }
  };

  const handleDeleteHoliday = async (holidayId: number) => {
    if (!window.confirm('Delete this holiday?')) return;
    try {
      await apiService.deleteAttendanceHoliday(holidayId);
      setAlert({ type: 'success', message: 'Holiday delete ho gayi.' });
      await loadOverviewData({ force: true });
    } catch (error: any) {
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'Holiday delete nahi hui.') });
    }
  };

  const handleDeleteStudentRecord = async (recordId: number) => {
    if (!window.confirm('Delete this student attendance record?')) return;
    try {
      await apiService.deleteStudentAttendanceRecord(recordId);
      setAlert({ type: 'success', message: 'Student attendance record delete ho gaya.' });
      await refreshStudentTabViews({ includeOverview: true, forceOverview: true });
    } catch (error: any) {
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'Student attendance record delete nahi hua.') });
    }
  };

  const handleDeleteStaffRecord = async (recordId: number) => {
    if (!window.confirm('Delete this staff attendance record?')) return;
    try {
      await apiService.deleteStaffAttendanceRecord(recordId);
      setAlert({ type: 'success', message: 'Staff attendance record delete ho gaya.' });
      await refreshStaffTabViews({ includeOverview: true, forceOverview: true });
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
      await loadOverviewData({ force: true });
    } catch (error: any) {
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'Leave request delete nahi hui.') });
    }
  };

  const handleDeleteAllNotifications = async () => {
    if (!window.confirm('Delete all attendance notifications?')) return;
    try {
      await apiService.deleteAllAttendanceNotifications();
      setAlert({ type: 'success', message: 'All notifications delete ho gayi.' });
      await loadOverviewData({ force: true });
    } catch (error: any) {
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'All notifications delete nahi hui.') });
    }
  };

  const handleDeleteAllHolidays = async () => {
    if (!window.confirm('Delete all holidays?')) return;
    try {
      await apiService.deleteAllAttendanceHolidays();
      setAlert({ type: 'success', message: 'All holidays delete ho gayi.' });
      await loadOverviewData({ force: true });
    } catch (error: any) {
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'All holidays delete nahi hui.') });
    }
  };

  const handleDeleteAllStudentRecords = async () => {
    if (!window.confirm('Current filters ke hisaab se saare student attendance records delete karne hain?')) return;
    try {
      await apiService.deleteAllStudentAttendanceRecords({
        school_id: 1,
        class_name: recordBatchParts.className || undefined,
        section: recordBatchParts.section || undefined,
        student_name: studentFilters.recordStudentName || undefined,
        date_from: studentFilters.date_from || undefined,
        date_to: studentFilters.date_to || undefined,
      });
      setAlert({ type: 'success', message: 'Filtered student attendance records delete ho gaye.' });
      await refreshStudentTabViews({ includeOverview: true, forceOverview: true });
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
      await refreshStaffTabViews({ includeOverview: true, forceOverview: true });
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
      await loadOverviewData({ force: true });
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
                      Date ke saath batch ya class select karke attendance mark karein.
                    </p>
                    <p className="mt-2 text-sm text-slate-600">
                      Selected {studentFilters.attendance_scope === 'class' ? 'class' : 'batch'} total students:{' '}
                      <span className="font-semibold text-slate-900">{selectedBatchStudentCount}</span>
                    </p>
                    {visibleAttendanceContext?.subject || visibleAttendanceContext?.teacher_name ? (
                      <p className="mt-2 text-sm text-slate-600">
                        {shouldDisplayAttendanceTeacher(visibleAttendanceContext?.teacher_name) ? (
                          <>
                            Teacher: <span className="font-semibold text-slate-900">{visibleAttendanceContext?.teacher_name}</span>
                          </>
                        ) : null}
                        {shouldDisplayAttendanceTeacher(visibleAttendanceContext?.teacher_name) && shouldDisplayAttendanceSubject(visibleAttendanceContext?.subject) ? ' | ' : ''}
                        {shouldDisplayAttendanceSubject(visibleAttendanceContext?.subject) ? (
                          <>
                            Subject: <span className="font-semibold text-slate-900">{visibleAttendanceContext?.subject}</span>
                          </>
                        ) : null}
                      </p>
                    ) : null}
                    {studentFilters.batch_name ? (
                      <div className="mt-3 max-w-2xl">
                        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Today&apos;s Classes</p>
                        <SelectField
                          value={selectedBatchAttendanceEntryId}
                          disabled={batchAttendanceOptionsLoading || !batchAttendanceOptions.length}
                          onChange={async (e) => {
                            const nextValue = e.target.value;
                            setSelectedBatchAttendanceEntryId(nextValue);
                            const nextContext = batchAttendanceOptions.find(
                              (item) => getAttendanceContextOptionValue(item) === nextValue
                            ) || null;
                            setBatchAttendanceContext(nextContext);
                            upsertAttendanceSubject(nextContext);
                            setStudentFilters((current) => ({
                              ...current,
                              subject_id: pickPreferredSubjectId(nextContext?.subject_id, current.subject_id),
                            }));
                            await loadStudentMarking({
                              subjectId: String(nextContext?.subject_id || ''),
                              subjectName: nextContext?.subject || '',
                            });
                          }}
                          className="w-full pr-12 text-[13px] md:text-sm"
                        >
                          <option value="">
                            {batchAttendanceOptionsLoading
                              ? 'Loading today classes...'
                              : batchAttendanceOptions.length
                                ? 'Select teacher / subject'
                                : 'No timetable class found'}
                          </option>
                          {batchAttendanceOptions.map((item) => {
                            const optionValue = getAttendanceContextOptionValue(item);
                            return (
                              <option key={optionValue} value={optionValue}>
                                {formatAttendanceContextOptionLabel(item)}
                              </option>
                            );
                          })}
                        </SelectField>
                      </div>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        updateStudentMarking((current) => ({
                          ...current,
                          students: current.students.map((student) => ({
                            ...student,
                            status: 'present',
                            absence_reason: undefined,
                          })),
                        }))
                      }
                      className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
                    >
                      Mark All Present
                    </button>
                  </div>
                </div>

                <div className="mt-6 grid gap-4 md:grid-cols-[0.95fr_minmax(0,3.1fr)_0.75fr] xl:grid-cols-[0.9fr_minmax(0,3.6fr)_0.8fr]">
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Date</p>
                    <input type="date" value={studentFilters.date} onChange={(e) => setStudentFilters({ ...studentFilters, date: e.target.value })} className={inputClass} />
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Attendance Type</p>
                    <div className="grid grid-cols-[180px_minmax(0,1fr)] gap-3">
                      <SelectField
                        value={studentFilters.attendance_scope}
                        onChange={(e) => {
                          const nextScope = e.target.value as 'batch' | 'class';
                          const nextOptions = nextScope === 'class' ? managedClassOptions : managedBatchOptions;
                          setStudentFilters({
                            ...studentFilters,
                            attendance_scope: nextScope,
                            batch_name: nextOptions[0] || '',
                            subject_id: '',
                          });
                        }}
                      >
                        <option value="batch">Batch Wise</option>
                        <option value="class">Class Wise</option>
                      </SelectField>
                      <SelectField
                        value={studentFilters.batch_name}
                        onChange={(e) => setStudentFilters({ ...studentFilters, batch_name: e.target.value })}
                        className="w-full pr-12 text-[13px] md:text-sm"
                      >
                        <option value="">{studentFilters.attendance_scope === 'class' ? 'Select Class' : 'Select Batch'}</option>
                        {batchOptions.map((item) => (
                          <option key={item} value={item}>{item}</option>
                        ))}
                      </SelectField>
                    </div>
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
                      {visibleStudentMarkingRows.length ? visibleStudentMarkingRows.map((student) => (
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
                                    updateStudentMarking((current) => ({
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
                                    }))
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
                                  updateStudentMarking((current) => ({
                                    ...current,
                                    students: current.students.map((row) =>
                                      row.student_id === student.student_id
                                        ? { ...row, absence_reason: e.target.value }
                                        : row
                                    ),
                                  }))
                                }
                                className="w-full rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-slate-700 outline-none focus:border-amber-400"
                                placeholder="Absent reason / remark"
                            />
                          ) : null}
                        </div>
                      </div>
                    )) : (
                        <div className="px-4 py-8 text-center text-sm text-slate-500">
                          {studentFilters.batch_name
                            ? 'Selected batch me abhi koi student visible nahi hai.'
                            : 'Student attendance dekhne ke liye batch select karein.'}
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
                  <p className="mt-4 text-sm text-slate-600">
                    Selected {studentFilters.record_scope === 'class' ? 'class' : 'batch'} total students: <span className="font-semibold text-slate-900">{selectedRecordStudentCount}</span>
                  </p>
                  <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <SelectField
                      value={studentFilters.record_scope}
                      onChange={(e) => {
                        const nextScope = e.target.value as 'batch' | 'class';
                        const nextOptions = nextScope === 'class' ? managedClassOptions : managedBatchOptions;
                        setStudentFilters({
                          ...studentFilters,
                          record_scope: nextScope,
                          record_batch_name: nextOptions[0] || '',
                        });
                      }}
                    >
                      <option value="batch">Batch Records</option>
                      <option value="class">Class Records</option>
                    </SelectField>
                    <SelectField value={studentFilters.record_batch_name} onChange={(e) => setStudentFilters({ ...studentFilters, record_batch_name: e.target.value })}>
                      <option value="">{studentFilters.record_scope === 'class' ? 'All Classes' : 'All Batches'}</option>
                      {recordBatchOptions.map((item) => <option key={item} value={item}>{item}</option>)}
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
                            {shouldDisplayAttendanceSubject(record.subject_name) ? <p className="mt-1 text-xs text-slate-500">Subject: {record.subject_name}</p> : null}
                            {shouldDisplayAttendanceTeacher(record.marked_by) ? <p className="mt-1 text-xs text-slate-500">Teacher: {record.marked_by}</p> : null}
                            {record.absence_reason ? <p className="mt-1 text-xs text-amber-700">Remark: {record.absence_reason}</p> : null}
                          </div>
                          <span>
                            {record.batch_name
                              ? <span className="text-xs text-slate-600">{record.batch_name}<br /><span className="text-[10px] text-slate-400">{record.class_name} | {record.section}</span></span>
                              : getAttendanceRecordBatchLabel(managedBatches, record.class_name, record.section)
                            }
                          </span>
                          <div>
                            <p>{formatDate(record.date)}</p>
                            <p className="mt-1 text-xs text-slate-500">
                              {record.batch_name
                                ? `${record.batch_name} | ${record.class_name} | ${record.section}`
                                : getAttendanceRecordBatchLabel(managedBatches, record.class_name, record.section)
                              }
                            </p>
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
    <div className="relative w-full overflow-hidden rounded-2xl border border-sky-200 bg-sky-50 shadow-sm">
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
