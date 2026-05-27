import type { StudentAttendanceRecord, StudentAttendanceDashboardSummary } from '@types';

export const studentRecordCacheTtlMs = 45_000;

export function readStudentRecordCache(
  cache: Map<string, { timestamp: number; data: StudentAttendanceRecord[] }>,
  requestKey: string
) {
  const cached = cache.get(requestKey);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > studentRecordCacheTtlMs) {
    cache.delete(requestKey);
    return null;
  }
  return cached.data;
}

export function writeStudentRecordCache(
  cache: Map<string, { timestamp: number; data: StudentAttendanceRecord[] }>,
  requestKey: string,
  data: StudentAttendanceRecord[]
) {
  cache.set(requestKey, {
    timestamp: Date.now(),
    data,
  });
}

export function readStudentCalendarCache(
  cache: Map<string, { timestamp: number; data: any }>,
  requestKey: string
) {
  const cached = cache.get(requestKey);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > studentRecordCacheTtlMs) {
    cache.delete(requestKey);
    return null;
  }
  return cached.data;
}

export function writeStudentCalendarCache(
  cache: Map<string, { timestamp: number; data: any }>,
  requestKey: string,
  data: any
) {
  cache.set(requestKey, { timestamp: Date.now(), data });
}

export function readStudentDashboardCache(
  cache: Map<string, { timestamp: number; data: StudentAttendanceDashboardSummary }>,
  requestKey: string
) {
  const cached = cache.get(requestKey);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > studentRecordCacheTtlMs) {
    cache.delete(requestKey);
    return null;
  }
  return cached.data;
}

export function writeStudentDashboardCache(
  cache: Map<string, { timestamp: number; data: StudentAttendanceDashboardSummary }>,
  requestKey: string,
  data: StudentAttendanceDashboardSummary
) {
  cache.set(requestKey, {
    timestamp: Date.now(),
    data,
  });
}

export function clearStudentRecordCaches(
  recordsCache: Map<string, { timestamp: number; data: StudentAttendanceRecord[] }>,
  dashboardCache: Map<string, { timestamp: number; data: StudentAttendanceDashboardSummary }>,
  refs: {
    recordsRequestKey: { current: string };
    recordsRequestPromise: { current: Promise<void> | null };
    calendarRequestKey: { current: string };
    calendarRequestPromise: { current: Promise<void> | null };
    dashboardRequestKey: { current: string };
    dashboardRequestPromise: { current: Promise<void> | null };
  }
) {
  recordsCache.clear();
  dashboardCache.clear();
  refs.recordsRequestKey.current = '';
  refs.recordsRequestPromise.current = null;
  refs.calendarRequestKey.current = '';
  refs.calendarRequestPromise.current = null;
  refs.dashboardRequestKey.current = '';
  refs.dashboardRequestPromise.current = null;
}
