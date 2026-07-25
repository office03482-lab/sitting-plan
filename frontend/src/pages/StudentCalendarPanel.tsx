import { useEffect, useMemo, useRef, useState } from 'react';
import { apiService, isRequestCanceled } from '@services/api';
import { useAuth } from '@/contexts/AuthProvider';
import { useEffectiveSchoolId } from '@hooks/useEffectiveSchoolId';
import {
  inputClass,
  studentCalendarShadeClass,
} from '../modules/attendance/utils/styleUtils';
import {
  formatCalendarMonthLabel,
  toMonthInputValue,
  shiftMonthValue,
  applyMonthInputValue,
  getMonthRange,
} from '../modules/attendance/utils/dateUtils';
import {
  readStudentCalendarCache,
  writeStudentCalendarCache,
} from '../modules/attendance/utils/cacheUtils';
import { attendanceStudentDashboardPageSize } from '../modules/attendance/utils/commonUtils';

interface StudentCalendarPanelProps {
  isVisible: boolean;
  refreshToken: number;
  selection: {
    scope: 'batch' | 'class';
    batchLabel: string;
    className: string;
    section: string;
  };
  onAlert: (alert: { type: 'success' | 'error' | 'warning' | 'info'; message: string } | null) => void;
}

export default function StudentCalendarPanel({
  isVisible,
  refreshToken,
  selection,
  onAlert,
}: StudentCalendarPanelProps) {
  const { authReady, sessionReady, schoolContextReady, session } = useAuth();
  const canRunAttendanceRequests = authReady && sessionReady && schoolContextReady && !!session;
  const effectiveSchoolId = useEffectiveSchoolId();
  const [calendarDate, setCalendarDate] = useState(new Date().toISOString().slice(0, 10));
  const [calendarPayload, setCalendarPayload] = useState<any | null>(null);
  const [, setUsingMonthFallback] = useState(false);

  const calendarCacheRef = useRef(
    new Map<string, { timestamp: number; data: any }>()
  );
  const calendarRequestKeyRef = useRef('');
  const calendarRequestPromiseRef = useRef<Promise<void> | null>(null);

  const studentCalendar = useMemo(() => {
    return calendarPayload?.day_summary || [];
  }, [calendarPayload]);

  const studentCalendarMarkedDates = useMemo(() => {
    return calendarPayload?.marked_dates || [];
  }, [calendarPayload]);

  const getApiErrorMessage = (error: any, fallback: string) =>
    isRequestCanceled(error) ? '' : error?.response?.data?.detail || error?.message || fallback;

  const loadCalendarRecords = async () => {
    if (!canRunAttendanceRequests) {
      return;
    }
    const selectedDashboardBatchName = selection.batchLabel;
    const requestedClassName =
      selection.scope === 'batch'
        ? undefined
        : selection.className || undefined;
    if (
      (selection.scope === 'batch' && !selectedDashboardBatchName)
      || (selection.scope === 'class' && !requestedClassName)
    ) {
      setCalendarPayload(null);
      setUsingMonthFallback(false);
      return;
    }
    const monthRange = getMonthRange(calendarDate);
    const requestKey = `${selection.scope}|${requestedClassName || ''}|${selectedDashboardBatchName}|${monthRange.from}|${monthRange.to}|${attendanceStudentDashboardPageSize}`;
    const cachedRecords = readStudentCalendarCache(calendarCacheRef.current, requestKey);
    if (cachedRecords) {
      setUsingMonthFallback(false);
      setCalendarPayload(cachedRecords);
      return;
    }
    if (
      calendarRequestKeyRef.current === requestKey &&
      calendarRequestPromiseRef.current
    ) {
      return calendarRequestPromiseRef.current;
    }
    calendarRequestKeyRef.current = requestKey;
    const loadPromise = (async () => {
      try {
        const monthParam = (calendarDate || '').slice(0, 7);
        const response = await apiService.getStudentAttendanceCalendar({
          school_id: effectiveSchoolId,
          month: monthParam,
          class_name: requestedClassName,
          batch_name: selection.scope === 'batch' ? selectedDashboardBatchName || undefined : undefined,
          scope: selection.scope,
        });
        if (calendarRequestKeyRef.current !== requestKey) return;
        const payload = response.data || null;
        writeStudentCalendarCache(calendarCacheRef.current, requestKey, payload);
        setUsingMonthFallback(false);
        setCalendarPayload(payload);
      } catch (error: any) {
        if (isRequestCanceled(error)) {
          return;
        }
        setCalendarPayload(null);
        setUsingMonthFallback(false);
        onAlert({ type: 'error', message: getApiErrorMessage(error, 'Calendar dates load nahi hui.') });
      }
    })().finally(() => {
      if (calendarRequestKeyRef.current === requestKey) {
        calendarRequestPromiseRef.current = null;
      }
    });
    calendarRequestPromiseRef.current = loadPromise;
    return loadPromise;
  };

  useEffect(() => {
    if (!isVisible) return;
    if (!canRunAttendanceRequests) return;
    if (!selection.className) return;
    if (selection.scope === 'batch' && !selection.section) return;

    const hydratePromise = (async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 40));
      await loadCalendarRecords();
    })();

    void hydratePromise;
  }, [
    canRunAttendanceRequests,
    isVisible,
    selection.className,
    selection.scope,
    selection.section,
    calendarDate,
  ]);

  useEffect(() => {
    calendarCacheRef.current.clear();
    calendarRequestKeyRef.current = '';
    if (!isVisible) return;
    if (!canRunAttendanceRequests) return;
    void loadCalendarRecords();
  }, [canRunAttendanceRequests, isVisible, refreshToken]);

  const monthLabel = formatCalendarMonthLabel(calendarDate);
  const monthInputValue = toMonthInputValue(calendarDate);

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">Calendar View</h3>
          <p className="mt-1 text-sm font-medium text-slate-600">{monthLabel}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="month"
            value={monthInputValue}
            onChange={(e) =>
              setCalendarDate(applyMonthInputValue(calendarDate, e.target.value))
            }
            className={`${inputClass} min-w-[10rem]`}
          />
          <div className="inline-flex overflow-hidden rounded-full border border-slate-300 bg-white">
            <button
              type="button"
              onClick={() => setCalendarDate(shiftMonthValue(calendarDate, -1))}
              className="px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setCalendarDate(shiftMonthValue(calendarDate, 1))}
              className="border-l border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
            >
              Next
            </button>
          </div>
        </div>
      </div>
      <p className="mt-2 text-sm text-slate-600">
        Marked Dates:
        <span className="font-semibold text-slate-900">
          {' '}
          {studentCalendarMarkedDates.length
            ? studentCalendarMarkedDates.join(', ')
            : 'No marked dates in selected month'}
        </span>
      </p>
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <span className="rounded-full border border-emerald-200 bg-emerald-100 px-3 py-1 text-emerald-800">Present shade</span>
        <span className="rounded-full border border-rose-200 bg-rose-100 px-3 py-1 text-rose-800">Absent shade</span>
      </div>
      <div className="mt-4 grid grid-cols-7 gap-2">
        {studentCalendar.map((record: any) => (
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
    </div>
  );
}
