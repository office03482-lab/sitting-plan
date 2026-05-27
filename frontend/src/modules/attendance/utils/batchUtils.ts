import type { Batch, AttendanceSubject, AttendanceStudent, StudentAttendanceRecord } from '@types';
import { normalizeClassNameKey, normalizeBatchComparisonKey } from './commonUtils';

export function splitBatchLabel(value?: string) {
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

export function getManagedAttendanceCategory(batch?: Batch | null) {
  return String(batch?.category || 'batch').trim().toLowerCase() === 'class' ? 'class' : 'batch';
}

export function getAttendanceStudentBatchName(student: AttendanceStudent) {
  return String((student as AttendanceStudent & { batch_name?: string; batch?: string }).batch_name
    || (student as AttendanceStudent & { batch?: string }).batch
    || '')
    .trim();
}

export function normalizeSubjectId(value?: string | number | null) {
  return String(value ?? '').trim();
}

export function pickPreferredSubjectId(...values: Array<string | number | null | undefined>) {
  for (const value of values) {
    const normalized = normalizeSubjectId(value);
    if (normalized) {
      return normalized;
    }
  }
  return '';
}

export function subjectMatchesBatchSelection(
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

export function studentMatchesBatchSelection(student: AttendanceStudent, selectedBatchLabel?: string) {
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

export function inferBatchPartsFromStudents(selectedBatchLabel: string, students: AttendanceStudent[]) {
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

export function inferClassPartsFromStudents(selectedClassLabel: string, students: AttendanceStudent[]) {
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

export function inferAttendanceSelectionParts(
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

export function batchMatchesClassSelection(batchLabel: string, classLabel?: string) {
  const normalizedClassKey = normalizeClassNameKey(classLabel);
  if (!normalizedClassKey) return true;

  const parsedBatch = splitBatchLabel(batchLabel);
  if (parsedBatch.className) {
    return normalizeClassNameKey(parsedBatch.className) === normalizedClassKey;
  }

  return normalizeClassNameKey(batchLabel) === normalizedClassKey;
}

export function matchManagedAttendanceLabel(
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

export function resolveManagedBatchSelection(
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

export function resolveManagedAttendanceStudentCount(
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

export function getAttendanceRecordBatchLabel(
  managedItems: Batch[],
  className?: string,
  section?: string
) {
  return (
    matchManagedAttendanceLabel(managedItems, 'batch', className, section) ||
    [String(className || '').trim(), String(section || '').trim()].filter(Boolean).join(' | ')
  );
}

export function hasDistinctAttendanceBatchLabel(
  batchName: string | undefined,
  className?: string,
  section?: string
) {
  const normalizedBatchName = String(batchName || '').trim();
  if (!normalizedBatchName) return false;
  return normalizeBatchComparisonKey(normalizedBatchName) !== normalizeBatchComparisonKey(
    [String(className || '').trim(), String(section || '').trim()].filter(Boolean).join(' | ')
  );
}

export function getEffectiveAttendanceRecordLabel(
  record: Pick<StudentAttendanceRecord, 'batch_name' | 'class_name' | 'section'>,
  managedItems: Batch[]
) {
  const className = String(record.class_name || '').trim();
  const section = String(record.section || '').trim();
  const batchName = String(record.batch_name || '').trim();
  return hasDistinctAttendanceBatchLabel(batchName, className, section)
    ? batchName
    : getAttendanceRecordBatchLabel(managedItems, className, section);
}

export function getAttendanceRecordCandidateKeys(
  record: Pick<StudentAttendanceRecord, 'batch_name' | 'class_name' | 'section'>,
  managedItems: Batch[]
) {
  const candidateKeys = new Set<string>();
  const batchName = String(record.batch_name || '').trim();
  const className = String(record.class_name || '').trim();
  const section = String(record.section || '').trim();
  const classSectionLabel = [className, section].filter(Boolean).join(' | ');
  const managedBatchLabel = getAttendanceRecordBatchLabel(managedItems, className, section);

  [batchName, classSectionLabel, managedBatchLabel, getEffectiveAttendanceRecordLabel(record, managedItems)].forEach((value) => {
    const normalizedKey = normalizeBatchComparisonKey(value);
    if (normalizedKey) {
      candidateKeys.add(normalizedKey);
    }
  });

  return candidateKeys;
}

export function filterAttendanceRecordsForSelection(
  records: StudentAttendanceRecord[],
  managedItems: Batch[],
  selectedBatchLabel: string,
  className?: string,
  section?: string
) {
  const normalizedBatchKey = normalizeBatchComparisonKey(selectedBatchLabel);
  return records.filter((record) => {
    const candidateKeys = getAttendanceRecordCandidateKeys(record, managedItems);
    const matchesBatchKey = normalizedBatchKey ? candidateKeys.has(normalizedBatchKey) : false;
    const matchesScope = recordMatchesSelectionScope(record, 'batch', className, section);
    return matchesBatchKey || matchesScope;
  });
}

export function shouldDisplayAttendanceSubject(subjectName?: string | null) {
  const normalized = String(subjectName || '').trim();
  return Boolean(normalized);
}

export function shouldDisplayAttendanceTeacher(teacherName?: string | null) {
  const normalized = String(teacherName || '').trim().toLowerCase();
  return Boolean(normalized && normalized !== 'system' && normalized !== 'attendance department');
}

export function recordMatchesSelectionScope(
  record: Pick<StudentAttendanceRecord, 'class_name' | 'section'>,
  scope: 'batch' | 'class',
  className?: string,
  section?: string
) {
  if (!className) return true;
  if (scope === 'class') {
    return normalizeClassNameKey(record.class_name) === normalizeClassNameKey(className);
  }
  if (!section) return false;
  return normalizeBatchComparisonKey(`${record.class_name} | ${record.section}`) === normalizeBatchComparisonKey(`${className} | ${section}`);
}
