import { apiService } from '@services/api';
import type { Batch, AttendanceStudent, AttendanceSubject } from '@types';
import {
  attendanceStudentListPageSize,
  buildAttendanceBatches,
  buildAttendanceBatchOptionNames,
  buildAttendanceClassOptionNames,
  toArray,
} from '../../modules/attendance/utils/commonUtils';
import { getManagedAttendanceCategory } from '../../modules/attendance/utils/batchUtils';

export type AttendanceStudentResources = {
  managedBatches: Batch[];
  students: AttendanceStudent[];
  subjects: AttendanceSubject[];
};

export type AttendanceStudentResourceOptions = {
  managedBatchOptions: string[];
  managedClassOptions: string[];
};

function normalizeManagedBatches(
  batches: Batch[],
  students: AttendanceStudent[],
  schoolId: number,
): Batch[] {
  const normalizedBatches = toArray<Batch>(batches)
    .filter((item) => String(item.name || '').trim())
    .sort((left, right) =>
      String(left.name || '').localeCompare(String(right.name || ''), undefined, {
        sensitivity: 'base',
      }),
    );

  if (normalizedBatches.length) {
    return normalizedBatches;
  }

  return buildAttendanceBatches(students, Number(schoolId) || 1);
}

export function buildAttendanceStudentResourceOptions(
  managedBatches: Batch[],
  students: AttendanceStudent[],
): AttendanceStudentResourceOptions {
  const managedBatchOptions = managedBatches
    .filter((item) => getManagedAttendanceCategory(item) === 'batch')
    .map((item) => String(item.name || '').trim())
    .filter(Boolean);

  return {
    managedBatchOptions: managedBatchOptions.length
      ? managedBatchOptions
      : buildAttendanceBatchOptionNames(students),
    managedClassOptions: buildAttendanceClassOptionNames(managedBatches, students),
  };
}

export async function fetchAttendanceStudentResources(
  schoolId: number,
  overviewSubjectOptions: AttendanceSubject[] = [],
): Promise<AttendanceStudentResources> {
  const studentsRes = await apiService.listIntegratedStudents({
    school_id: schoolId,
    limit: attendanceStudentListPageSize,
  });
  const batchesRes = await apiService
    .listBatches(schoolId, true)
    .catch(() => ({ data: [] as Batch[] }));
  const subjectsRes =
    overviewSubjectOptions.length
      ? ({ data: overviewSubjectOptions } as { data: AttendanceSubject[] })
      : await apiService.listAttendanceSubjects(schoolId).catch(() => ({ data: [] as AttendanceSubject[] }));

  const students = toArray<AttendanceStudent>(studentsRes.data);
  const managedBatches = normalizeManagedBatches(
    toArray<Batch>(batchesRes.data),
    students,
    schoolId,
  );

  return {
    students,
    managedBatches,
    subjects: toArray<AttendanceSubject>(subjectsRes.data),
  };
}

export async function fetchManagedAttendanceBatches(
  schoolId: number,
  students: AttendanceStudent[],
): Promise<Batch[]> {
  const response = await apiService.listBatches(schoolId, true);
  return normalizeManagedBatches(toArray<Batch>(response.data), students, schoolId);
}
