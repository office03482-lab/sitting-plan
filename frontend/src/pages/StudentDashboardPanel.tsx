import { useEffect, useMemo, useRef, useState } from 'react';
import { apiService, isRequestCanceled } from '@services/api';
import { useAuth } from '@/contexts/AuthProvider';
import { useAuthStore } from '@store/auth';
import type { AttendanceStudent, StudentAttendanceDashboardBucket, StudentAttendanceDashboardSummary } from '@types';
import {
  sectionClass,
  inputClass,
} from '../modules/attendance/utils/styleUtils';
import {
  toArray,
} from '../modules/attendance/utils/commonUtils';
import {
  batchMatchesClassSelection,
  inferAttendanceSelectionParts,
} from '../modules/attendance/utils/batchUtils';
import {
  readStudentDashboardCache,
  writeStudentDashboardCache,
} from '../modules/attendance/utils/cacheUtils';
import { emptyStudentDashboardSummary } from '../modules/attendance/utils/overviewUtils';
import StudentCalendarPanel from './StudentCalendarPanel';

interface StudentDashboardPanelProps {
  isVisible: boolean;
  refreshToken: number;
  students: AttendanceStudent[];
  managedBatchOptions: string[];
  managedClassOptions: string[];
  onAlert: (alert: { type: 'success' | 'error' | 'warning' | 'info'; message: string } | null) => void;
}

export default function StudentDashboardPanel({
  isVisible,
  refreshToken,
  students,
  managedBatchOptions,
  managedClassOptions,
  onAlert,
}: StudentDashboardPanelProps) {
  const user = useAuthStore((state) => state.user);
  const { authReady, sessionReady, schoolContextReady, session } = useAuth();
  const canRunAttendanceRequests = authReady && sessionReady && schoolContextReady && !!session;
  const currentSchoolId = user?.school_id;
  const [filters, setFilters] = useState({
    dashboard_scope: 'batch' as 'batch' | 'class',
    dashboard_class_name: '',
    dashboard_batch_name: '',
    dashboard_date: new Date().toISOString().slice(0, 10),
  });

  const [dashboardSummary, setDashboardSummary] = useState<StudentAttendanceDashboardSummary | null>(null);

  const dashboardCacheRef = useRef(
    new Map<string, { timestamp: number; data: StudentAttendanceDashboardSummary }>()
  );
  const dashboardRequestKeyRef = useRef('');
  const dashboardRequestPromiseRef = useRef<Promise<void> | null>(null);

  const getApiErrorMessage = (error: any, fallback: string) =>
    isRequestCanceled(error) ? '' : error?.response?.data?.detail || error?.message || fallback;

  const dashboardBatchParts = useMemo(
    () => {
      const selectedBatchName = String(filters.dashboard_batch_name || '').trim();
      const selectedClassName = String(filters.dashboard_class_name || '').trim();
      if (selectedBatchName) {
        return inferAttendanceSelectionParts(selectedBatchName, 'batch', students);
      }
      if (selectedClassName) {
        return inferAttendanceSelectionParts(selectedClassName, 'class', students);
      }
      return { className: '', section: '' };
    },
    [filters.dashboard_batch_name, filters.dashboard_class_name, students]
  );

  const effectiveDashboardScope = useMemo<'batch' | 'class'>(() => {
    if (String(filters.dashboard_batch_name || '').trim()) return 'batch';
    if (String(filters.dashboard_class_name || '').trim()) return 'class';
    return filters.dashboard_scope;
  }, [filters.dashboard_batch_name, filters.dashboard_class_name, filters.dashboard_scope]);

  const effectiveDashboardBatchLabel = useMemo(
    () => String(filters.dashboard_batch_name || '').trim(),
    [filters.dashboard_batch_name]
  );

  const effectiveDashboardClassName = useMemo(
    () =>
      String(dashboardBatchParts.className || '').trim()
      || String(filters.dashboard_class_name || '').trim(),
    [dashboardBatchParts.className, filters.dashboard_class_name]
  );

  const effectiveDashboardSection = useMemo(
    () => String(dashboardBatchParts.section || '').trim(),
    [dashboardBatchParts.section]
  );

  const dashboardBatchOptions = useMemo(
    () => {
      const filteredManagedOptions = managedBatchOptions.filter((item) =>
        batchMatchesClassSelection(item, filters.dashboard_class_name)
      );
      return filteredManagedOptions.length ? filteredManagedOptions : managedBatchOptions;
    },
    [managedBatchOptions, filters.dashboard_class_name],
  );

  const todayOverallSummary = useMemo(
    () => ({
      present: Number(dashboardSummary?.present_count || 0),
      absent: Number(dashboardSummary?.absent_count || 0),
      late: Number(dashboardSummary?.late_count || 0),
      total: Number(dashboardSummary?.total_count || 0),
    }),
    [dashboardSummary]
  );

  const todayBatchWiseSummary = useMemo(
    () =>
      toArray<StudentAttendanceDashboardBucket>(dashboardSummary?.batch_summary)
        .map((item) => ({
          batch_name: String(item.batch_name || item.label || '').trim(),
          present: Number(item.present || 0),
          absent: Number(item.absent || 0),
          late: Number(item.late || 0),
          total: Number(item.total || 0),
        }))
        .filter((item) => item.batch_name),
    [dashboardSummary]
  );

  const loadDashboard = async (targetDate: string = filters.dashboard_date) => {
    if (!canRunAttendanceRequests) {
      return;
    }
    const selectedDashboardBatchName = effectiveDashboardBatchLabel;
    const requestedClassName =
      effectiveDashboardScope === 'batch'
        ? undefined
        : effectiveDashboardClassName || undefined;
    if (!selectedDashboardBatchName && !requestedClassName) {
      setDashboardSummary(null);
      return;
    }
    const requestKey = `${targetDate}|scope:${effectiveDashboardScope}|class:${requestedClassName || ''}|batch:${selectedDashboardBatchName}`;
    const cachedSummary = readStudentDashboardCache(dashboardCacheRef.current, requestKey);
    if (cachedSummary) {
      setDashboardSummary(cachedSummary);
      return;
    }
    if (
      dashboardRequestKeyRef.current === requestKey &&
      dashboardRequestPromiseRef.current
    ) {
      return dashboardRequestPromiseRef.current;
    }
    dashboardRequestKeyRef.current = requestKey;
    const loadPromise = (async () => {
      try {
        const response = await apiService.getStudentAttendanceDashboardSummary({
          school_id: currentSchoolId,
          date: targetDate,
          class_name: requestedClassName,
          batch_name: effectiveDashboardScope === 'batch' ? selectedDashboardBatchName || undefined : undefined,
          scope: effectiveDashboardScope,
        });
        if (dashboardRequestKeyRef.current !== requestKey) return;
        const nextSummary = {
          ...emptyStudentDashboardSummary,
          ...(response.data || {}),
          class_summary: toArray(response.data?.class_summary),
          batch_summary: toArray(response.data?.batch_summary),
          date_summary: toArray(response.data?.date_summary),
        } as StudentAttendanceDashboardSummary;
        writeStudentDashboardCache(dashboardCacheRef.current, requestKey, nextSummary);
        setDashboardSummary(nextSummary);
      } catch (error: any) {
        if (isRequestCanceled(error)) {
          return;
        }
        setDashboardSummary(null);
        onAlert({ type: 'error', message: getApiErrorMessage(error, 'Aaj ka batch dashboard load nahi hua.') });
      }
    })().finally(() => {
      if (dashboardRequestKeyRef.current === requestKey) {
        dashboardRequestPromiseRef.current = null;
      }
    });
    dashboardRequestPromiseRef.current = loadPromise;
    return loadPromise;
  };

  useEffect(() => {
    if (!isVisible) return;
    if (!canRunAttendanceRequests) return;
    if (!effectiveDashboardClassName) return;
    if (effectiveDashboardScope === 'batch' && !effectiveDashboardSection) return;

    const hydratePromise = (async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 40));
      if (dashboardRequestKeyRef.current === '') return;
      await loadDashboard(filters.dashboard_date);
    })();

    void hydratePromise;
  }, [
    canRunAttendanceRequests,
    isVisible,
    effectiveDashboardClassName,
    effectiveDashboardScope,
    effectiveDashboardSection,
    filters.dashboard_date,
  ]);

  useEffect(() => {
    dashboardCacheRef.current.clear();
    dashboardRequestKeyRef.current = '';
    if (!isVisible) return;
    if (!canRunAttendanceRequests) return;
    void loadDashboard(filters.dashboard_date);
  }, [canRunAttendanceRequests, isVisible, refreshToken]);

  return (
    <div className={`${sectionClass} min-w-0`}>
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Student Dashboard</h2>
        <p className="mt-2 text-sm text-slate-500">
          Selected date ({filters.dashboard_date ? new Date(filters.dashboard_date).toLocaleDateString() : 'Selected Date'}) ke saare batches ka present/absent summary.
        </p>
        <p className="mt-2 text-sm text-slate-600">
          Calendar source:
          <span className="font-semibold text-slate-900">
            {' '}
            {effectiveDashboardBatchLabel
              ? `Attendance Batch - ${effectiveDashboardBatchLabel}`
              : effectiveDashboardClassName
                ? `Attendance Class - ${effectiveDashboardClassName}`
                : 'Dashboard se class/batch select karein'}
          </span>
        </p>
      </div>
      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.9fr)_auto]">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Dashboard Class</p>
          <div className="relative w-full overflow-hidden rounded-2xl border border-sky-200 bg-sky-50 shadow-sm">
            <select
              value={filters.dashboard_class_name}
              onChange={(e) =>
                setFilters({
                  ...filters,
                  dashboard_class_name: e.target.value,
                  dashboard_scope: 'class',
                  dashboard_batch_name: '',
                })
              }
              className={`w-full cursor-pointer appearance-none bg-transparent px-4 py-3 pr-16 text-sm font-medium text-slate-900 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-4 focus:ring-slate-200/70`}
              style={{ backgroundImage: 'none' }}
            >
              <option value="">Select Class</option>
              {managedClassOptions.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex w-12 items-center justify-center border-l border-sky-200 bg-white/80 text-sky-700">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </div>
          </div>
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Dashboard Batch</p>
          <div className="relative w-full overflow-hidden rounded-2xl border border-sky-200 bg-sky-50 shadow-sm">
            <select
              value={filters.dashboard_scope === 'batch' ? filters.dashboard_batch_name : ''}
              onChange={(e) =>
                setFilters({
                  ...filters,
                  dashboard_scope: e.target.value ? 'batch' : 'class',
                  dashboard_batch_name: e.target.value,
                })
              }
              className={`w-full cursor-pointer appearance-none bg-transparent px-4 py-3 pr-16 text-sm font-medium text-slate-900 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-4 focus:ring-slate-200/70`}
              style={{ backgroundImage: 'none' }}
            >
              <option value="">Select Batch</option>
              {dashboardBatchOptions.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex w-12 items-center justify-center border-l border-sky-200 bg-white/80 text-sky-700">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </div>
          </div>
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Dashboard Date</p>
          <input
            type="date"
            value={filters.dashboard_date}
            onChange={(e) => setFilters({ ...filters, dashboard_date: e.target.value })}
            className={inputClass}
          />
        </div>
        <div className="flex items-end gap-3">
          <button
            type="button"
            onClick={() => loadDashboard(filters.dashboard_date)}
            className="rounded-full border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Load Date
          </button>
        </div>
      </div>
      <div className="mt-6 grid gap-4 md:grid-cols-4">
        <div className={`rounded-2xl border p-4 bg-emerald-50 border-emerald-200 text-emerald-700`}>
          <p className="text-xs uppercase tracking-[0.2em]">Present</p>
          <p className="mt-2 text-2xl font-bold">{todayOverallSummary.present}</p>
        </div>
        <div className={`rounded-2xl border p-4 bg-rose-50 border-rose-200 text-rose-700`}>
          <p className="text-xs uppercase tracking-[0.2em]">Absent</p>
          <p className="mt-2 text-2xl font-bold">{todayOverallSummary.absent}</p>
        </div>
        <div className={`rounded-2xl border p-4 bg-amber-50 border-amber-200 text-amber-700`}>
          <p className="text-xs uppercase tracking-[0.2em]">Late</p>
          <p className="mt-2 text-2xl font-bold">{todayOverallSummary.late}</p>
        </div>
        <div className={`rounded-2xl border p-4 bg-indigo-50 border-indigo-200 text-indigo-700`}>
          <p className="text-xs uppercase tracking-[0.2em]">Total</p>
          <p className="mt-2 text-2xl font-bold">{todayOverallSummary.total}</p>
        </div>
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

      <StudentCalendarPanel
        isVisible={isVisible}
        refreshToken={refreshToken}
        selection={{
          scope: effectiveDashboardScope,
          batchLabel: effectiveDashboardBatchLabel,
          className: effectiveDashboardClassName,
          section: effectiveDashboardSection,
        }}
        onAlert={onAlert}
      />
    </div>
  );
}
