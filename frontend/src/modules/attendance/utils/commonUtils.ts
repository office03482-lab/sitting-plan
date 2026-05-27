import type { Batch, AttendanceStudent } from '@types';

export const attendanceStudentListPageSize = 10000;
export const attendanceStudentRecordPageSize = 100;
export const attendanceStudentDashboardPageSize = 200;
export const attendanceUiDebounceMs = 350;

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
      category: 'batch',
      school_id: schoolId,
      is_active: true,
      created_at: '',
      updated_at: '',
      student_count: studentCount,
    }));
};

export const buildAttendanceBatchOptionNames = (students: AttendanceStudent[]) =>
  Array.from(
    new Set(
      students
        .map((student) => {
          const batchName = getAttendanceStudentBatchName(student);
          if (batchName) return batchName;
          const className = String(student.class_name || '').trim();
          const section = String(student.section || '').trim();
          return className && section ? `${className} | ${section}` : '';
        })
        .filter(Boolean)
    )
  ).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));

export const getAttendanceStudentBatchName = (student: AttendanceStudent) => {
  return String((student as AttendanceStudent & { batch_name?: string; batch?: string }).batch_name
    || (student as AttendanceStudent & { batch?: string }).batch
    || '')
    .trim();
};

export const buildAttendanceClassOptionNames = (
  managedBatches: Batch[],
  students: AttendanceStudent[]
) => {
  const managedNames = managedBatches
    .filter((item) => getManagedAttendanceCategory(item) === 'class')
    .map((item) => String(item.name || '').trim())
    .filter(Boolean);
  if (managedNames.length) {
    return managedNames;
  }
  return Array.from(
    new Set(
      students
        .map((student) => String(student.class_name || '').trim())
        .filter(Boolean)
    )
  ).sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
};

export const getManagedAttendanceCategory = (batch?: Batch | null) => {
  return String(batch?.category || 'batch').trim().toLowerCase() === 'class' ? 'class' : 'batch';
};

export function normalizeClassNameKey(value?: string) {
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

export function normalizeBatchComparisonKey(value?: string) {
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

export function isTeachingStaffMember(member?: { designation?: string | null }) {
  return String(member?.designation || '').trim().toLowerCase() === 'teacher';
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.URL.revokeObjectURL(url);
}
