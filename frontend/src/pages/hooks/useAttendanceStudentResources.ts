import { useMemo, useRef, useState } from 'react';
import type { Batch, AttendanceStudent, AttendanceSubject } from '@types';
import {
  buildAttendanceStudentResourceOptions,
  fetchAttendanceStudentResources,
  fetchManagedAttendanceBatches,
} from '../services/attendanceStudentResources';

type UseAttendanceStudentResourcesOptions = {
  canRunAttendanceRequests: boolean;
  currentSchoolId: number | string;
  overviewSubjectOptions?: AttendanceSubject[];
};

export function useAttendanceStudentResources({
  canRunAttendanceRequests,
  currentSchoolId,
  overviewSubjectOptions = [],
}: UseAttendanceStudentResourcesOptions) {
  const [students, setStudents] = useState<AttendanceStudent[]>([]);
  const [managedBatches, setManagedBatches] = useState<Batch[]>([]);
  const [subjects, setSubjects] = useState<AttendanceSubject[]>([]);

  const studentLoadInFlightRef = useRef<Promise<void> | null>(null);
  const managedBatchRefreshInFlightRef = useRef<Promise<void> | null>(null);
  const lastManagedBatchRefreshAtRef = useRef(0);

  const loadStudentResources = async () => {
    if (!canRunAttendanceRequests) {
      return;
    }
    if (studentLoadInFlightRef.current) {
      return studentLoadInFlightRef.current;
    }

    const loadPromise = (async () => {
      const payload = await fetchAttendanceStudentResources(
        currentSchoolId,
        subjects.length ? subjects : overviewSubjectOptions,
      );
      setStudents(payload.students);
      setManagedBatches(payload.managedBatches);
      setSubjects(payload.subjects);
    })().finally(() => {
      studentLoadInFlightRef.current = null;
    });

    studentLoadInFlightRef.current = loadPromise;
    return loadPromise;
  };

  const refreshManagedBatches = async (options?: { force?: boolean }) => {
    const force = options?.force === true;
    if (!canRunAttendanceRequests) {
      return;
    }
    const now = Date.now();
    if (!force && now - lastManagedBatchRefreshAtRef.current < 60_000) {
      return;
    }
    if (managedBatchRefreshInFlightRef.current) {
      return managedBatchRefreshInFlightRef.current;
    }

    const refreshPromise = (async () => {
      lastManagedBatchRefreshAtRef.current = Date.now();
      try {
        const nextManagedBatches = await fetchManagedAttendanceBatches(currentSchoolId, students);
        setManagedBatches(nextManagedBatches);
      } catch {
        // Keep current options if refresh fails.
      } finally {
        managedBatchRefreshInFlightRef.current = null;
      }
    })();

    managedBatchRefreshInFlightRef.current = refreshPromise;
    return refreshPromise;
  };

  const { managedBatchOptions, managedClassOptions } = useMemo(
    () => buildAttendanceStudentResourceOptions(managedBatches, students),
    [managedBatches, students],
  );

  return {
    students,
    managedBatches,
    subjects,
    managedBatchOptions,
    managedClassOptions,
    loadStudentResources,
    refreshManagedBatches,
  };
}
