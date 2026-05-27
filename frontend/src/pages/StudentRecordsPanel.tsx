// @ts-nocheck
import { useEffect, useMemo, useRef, useState } from 'react';
import { apiService, isRequestCanceled } from '@services/api';
import type { Batch, AttendanceStudent, StudentAttendanceRecord } from '@types';
import {
  sectionClass,
  inputClass,
  deleteAllButtonClass,
  studentRecordDeleteButtonClass,
  studentRecordStatusClass,
} from '../modules/attendance/utils/styleUtils';
import { formatDate, toDateKey } from '../modules/attendance/utils/dateUtils';
import {
  toArray,
  normalizeClassNameKey,
  normalizeBatchComparisonKey,
  buildAttendanceBatchOptionNames,
  getManagedAttendanceCategory,
  buildAttendanceClassOptionNames,
} from '../modules/attendance/utils/commonUtils';
import {
  getAttendanceRecordBatchLabel,
  shouldDisplayAttendanceSubject,
  shouldDisplayAttendanceTeacher,
  batchMatchesClassSelection,
  resolveManagedAttendanceStudentCount,
  studentMatchesBatchSelection,
  inferAttendanceSelectionParts,
} from '../modules/attendance/utils/batchUtils';
import {
  readStudentRecordCache,
  writeStudentRecordCache,
} from '../modules/attendance/utils/cacheUtils';
import { attendanceStudentRecordPageSize } from '../modules/attendance/utils/commonUtils';

interface StudentRecordsPanelProps {
  isVisible: boolean;
  refreshToken: number;
  students: AttendanceStudent[];
  managedBatches: Batch[];
  managedBatchOptions: string[];
  managedClassOptions: string[];
  onAlert: (alert: { type: 'success' | 'error' | 'warning' | 'info'; message: string } | null) => void;
  onRefresh: () => void;
}

export default function StudentRecordsPanel({
  isVisible,
  refreshToken,
  students,
  managedBatches,
  managedBatchOptions,
  managedClassOptions,
  onAlert,
  onRefresh,
}: StudentRecordsPanelProps) {
  const [records, setRecords] = useState<StudentAttendanceRecord[]>([]);
  const [filteredRecords, setFilteredRecords] = useState<StudentAttendanceRecord[]>([]);
  const [filters, setFilters] = useState({
    record_scope: 'batch' as 'batch' | 'class',
    record_batch_name: '',
    record_class_name: '',
    recordStudentName: '',
    date_from: '',
    date_to: '',
  });

  const recordsCacheRef = useRef(
    new Map<string, { timestamp: number; data: StudentAttendanceRecord[] }>()
  );
  const recordsRequestKeyRef = useRef('');
  const recordsRequestPromiseRef = useRef<Promise<void> | null>(null);

  const recordBatchOptions = useMemo(
    () => (filters.record_scope === 'class' ? managedClassOptions : managedBatchOptions),
    [managedBatchOptions, managedClassOptions, filters.record_scope]
  );

  const recordBatchParts = useMemo(
    () => {
      const selectedBatchName = String(filters.record_batch_name || '').trim();
      const selectedClassName = String(filters.record_class_name || '').trim();
      if (selectedBatchName) {
        return inferAttendanceSelectionParts(selectedBatchName, 'batch', students);
      }
      if (selectedClassName) {
        return inferAttendanceSelectionParts(selectedClassName, 'class', students);
      }
      return { className: '', section: '' };
    },
    [filters.record_batch_name, filters.record_class_name, students]
  );

  const selectedRecordStudentCount = useMemo(() => {
    const recordClassName = String(filters.record_class_name || '').trim();
    const recordBatchName = String(filters.record_batch_name || '').trim();
    if (!recordBatchName && !recordClassName) {
      return 0;
    }
    const managedCount = resolveManagedAttendanceStudentCount(
      managedBatches,
      recordBatchName || recordClassName,
      recordBatchName ? 'batch' : 'class'
    );
    if (managedCount > 0) {
      return managedCount;
    }

    const matchedStudents = students.filter((student) =>
      recordBatchName
        ? studentMatchesBatchSelection(student, recordBatchName)
        : recordClassName
          ? normalizeClassNameKey(String(student.class_name || '').trim()) === normalizeClassNameKey(recordClassName)
          : true
    );
    if (matchedStudents.length > 0) {
      return matchedStudents.length;
    }
    return new Set(
      records
        .map((record) => String(record.student_id || '').trim())
        .filter(Boolean)
    ).size;
  }, [managedBatches, filters.record_batch_name, filters.record_class_name, records, students]);

  const getApiErrorMessage = (error: any, fallback: string) =>
    isRequestCanceled(error) ? '' : error?.response?.data?.detail || error?.message || fallback;

  const loadRecords = async (options?: { force?: boolean }) => {
    const recordBatchName = (filters.record_batch_name || '').trim();
    const resolvedRecordClassName = (recordBatchName ? '' : filters.record_class_name || '').trim();
    const requestKey = `class:${resolvedRecordClassName}|section:|batch:${recordBatchName}|name:${filters.recordStudentName}|dates:${filters.date_from}|${filters.date_to}|limit:${attendanceStudentRecordPageSize}`;
    if (!options?.force) {
      const cachedRecords = readStudentRecordCache(recordsCacheRef.current, requestKey);
      if (cachedRecords) {
        setRecords(cachedRecords);
        setFilteredRecords(cachedRecords);
        return;
      }
    }
    if (
      recordsRequestKeyRef.current === requestKey &&
      recordsRequestPromiseRef.current
    ) {
      return recordsRequestPromiseRef.current;
    }
    recordsRequestKeyRef.current = requestKey;
    const loadPromise = (async () => {
      try {
        const response = await apiService.listStudentAttendanceRecords({
          school_id: 1,
          class_name: resolvedRecordClassName || undefined,
          section: undefined,
          batch_name: recordBatchName || undefined,
          student_name: filters.recordStudentName || undefined,
          date_from: filters.date_from || undefined,
          date_to: filters.date_to || undefined,
          limit: 500,
        });
        if (recordsRequestKeyRef.current !== requestKey) return;
        const nextRecords = toArray<StudentAttendanceRecord>(response.data);
        writeStudentRecordCache(recordsCacheRef.current, requestKey, nextRecords);
        setRecords(nextRecords);
        setFilteredRecords(nextRecords);
      } catch (error: any) {
        if (isRequestCanceled(error)) {
          return;
        }
        onAlert({ type: 'error', message: getApiErrorMessage(error, 'Student records load nahi hue.') });
      }
    })().finally(() => {
      if (recordsRequestKeyRef.current === requestKey) {
        recordsRequestPromiseRef.current = null;
      }
    });
    recordsRequestPromiseRef.current = loadPromise;
    return loadPromise;
  };

  const handleDeleteRecord = async (recordId: number) => {
    if (!window.confirm('Delete this student attendance record?')) return;
    try {
      await apiService.deleteStudentAttendanceRecord(recordId);
      onAlert({ type: 'success', message: 'Student attendance record delete ho gaya.' });
      onRefresh();
    } catch (error: any) {
      onAlert({ type: 'error', message: getApiErrorMessage(error, 'Student attendance record delete nahi hua.') });
    }
  };

  const handleDeleteAllRecords = async () => {
    const action = window.confirm('Current filters ke hisaab se saare student attendance records delete karne hain?');
    if (!action) return;
    try {
      const selectedRecordBatchName = String(filters.record_batch_name || '').trim();
      await apiService.deleteAllStudentAttendanceRecords({
        school_id: 1,
        class_name: recordBatchParts.className || undefined,
        section: selectedRecordBatchName ? recordBatchParts.section || undefined : undefined,
        student_name: filters.recordStudentName || undefined,
        date_from: filters.date_from || undefined,
        date_to: filters.date_to || undefined,
      });
      onAlert({ type: 'success', message: 'Filtered student attendance records delete ho gaye.' });
      onRefresh();
    } catch (error: any) {
      onAlert({ type: 'error', message: getApiErrorMessage(error, 'Student attendance records delete nahi hue.') });
    }
  };

  useEffect(() => {
    const dateFromKey = filters.date_from || '';
    const dateToKey = filters.date_to || '';
    const normalizedStudentSearch = (filters.recordStudentName || '').trim().toLowerCase();
    const nextRecords = records.filter((record) => {
      const recordDateKey = toDateKey(record.date);
      if (!recordDateKey) return false;
      if (dateFromKey && recordDateKey < dateFromKey) return false;
      if (dateToKey && recordDateKey > dateToKey) return false;
      if (normalizedStudentSearch) {
        const studentName = String(record.student_name || '').trim().toLowerCase();
        const rollNo = String(record.roll_no || '').trim().toLowerCase();
        if (!studentName.includes(normalizedStudentSearch) && !rollNo.includes(normalizedStudentSearch)) {
          return false;
        }
      }
      return true;
    });
    setFilteredRecords(nextRecords);
  }, [records, filters.date_from, filters.date_to, filters.recordStudentName]);

  useEffect(() => {
    if (!isVisible) return;
    const hasRecordFilters = Boolean(
      String(filters.record_class_name || '').trim()
      || String(filters.record_batch_name || '').trim()
      || String(filters.recordStudentName || '').trim()
      || String(filters.date_from || '').trim()
      || String(filters.date_to || '').trim()
    );
    if (!hasRecordFilters) {
      setRecords([]);
      setFilteredRecords([]);
      return;
    }
    void loadRecords();
  }, [
    isVisible,
    filters.record_class_name,
    filters.record_batch_name,
    filters.recordStudentName,
    filters.date_from,
    filters.date_to,
  ]);

  useEffect(() => {
    recordsCacheRef.current.clear();
    recordsRequestKeyRef.current = '';
    if (!isVisible) return;
    const hasRecordFilters = Boolean(
      String(filters.record_class_name || '').trim()
      || String(filters.record_batch_name || '').trim()
      || String(filters.recordStudentName || '').trim()
      || String(filters.date_from || '').trim()
      || String(filters.date_to || '').trim()
    );
    if (!hasRecordFilters) return;
    void loadRecords({ force: true });
  }, [refreshToken]);

  return (
    <div className={`${sectionClass} min-w-0`}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Student Records</h2>
          <p className="mt-2 text-sm text-slate-500">Batch-wise records with total students count.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => loadRecords({ force: true })} className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
            Apply Filters
          </button>
          <button type="button" onClick={handleDeleteAllRecords} className={deleteAllButtonClass}>
            Delete All
          </button>
        </div>
      </div>
      <p className="mt-4 text-sm text-slate-600">
        Selected {filters.record_batch_name ? 'batch' : filters.record_class_name ? 'class' : 'filter'} total students: <span className="font-semibold text-slate-900">{selectedRecordStudentCount}</span>
      </p>
      <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
        <p>Debug: records response {records.length}, rendered {filteredRecords.length}</p>
        <p className="mt-1 break-all">Request: {recordsRequestKeyRef.current || 'N/A'}</p>
      </div>
      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <div className="relative w-full overflow-hidden rounded-2xl border border-sky-200 bg-sky-50 shadow-sm">
          <select
            value={filters.record_class_name}
            onChange={(e) => setFilters({ ...filters, record_class_name: e.target.value, record_batch_name: '' })}
            className={`w-full cursor-pointer appearance-none bg-transparent px-4 py-3 pr-16 text-sm font-medium text-slate-900 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-4 focus:ring-slate-200/70`}
            style={{ backgroundImage: 'none' }}
          >
            <option value="">All Classes</option>
            {managedClassOptions.map((item: string) => <option key={item} value={item}>{item}</option>)}
          </select>
          <div className="pointer-events-none absolute inset-y-0 right-0 flex w-12 items-center justify-center border-l border-sky-200 bg-white/80 text-sky-700">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
          </div>
        </div>
        <div className="relative w-full overflow-hidden rounded-2xl border border-sky-200 bg-sky-50 shadow-sm">
          <select
            value={filters.record_batch_name}
            onChange={(e) => {
              const nextBatchName = e.target.value;
              setFilters({
                ...filters,
                record_batch_name: nextBatchName,
              });
            }}
            className={`w-full cursor-pointer appearance-none bg-transparent px-4 py-3 pr-16 text-sm font-medium text-slate-900 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-4 focus:ring-slate-200/70`}
            style={{ backgroundImage: 'none' }}
          >
            <option value="">All Batches</option>
            {(managedBatchOptions.length ? managedBatchOptions : buildAttendanceBatchOptionNames(students))
              .filter((item: string) => batchMatchesClassSelection(item, filters.record_class_name))
              .map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <div className="pointer-events-none absolute inset-y-0 right-0 flex w-12 items-center justify-center border-l border-sky-200 bg-white/80 text-sky-700">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
          </div>
        </div>
        <input value={filters.recordStudentName} onChange={(e) => setFilters({ ...filters, recordStudentName: e.target.value })} className={inputClass} placeholder="Student name" />
        <input type="date" value={filters.date_from} onChange={(e) => setFilters({ ...filters, date_from: e.target.value })} className={inputClass} />
        <input type="date" value={filters.date_to} onChange={(e) => setFilters({ ...filters, date_to: e.target.value })} className={inputClass} />
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
          {filteredRecords.map((record) => (
            <div key={record.id} className="grid min-w-[52rem] grid-cols-[1.2fr_1fr_1fr_0.8fr_0.7fr] gap-4 px-4 py-3 text-sm text-slate-700">
              <div>
                <p>{record.student_name}</p>
                {shouldDisplayAttendanceSubject(record.subject_name) ? <p className="mt-1 text-xs text-slate-500">Subject: {record.subject_name}</p> : null}
                {shouldDisplayAttendanceTeacher(record.marked_by) ? <p className="mt-1 text-xs text-slate-500">Teacher: {record.marked_by}</p> : null}
                {record.absence_reason ? <p className="mt-1 text-xs text-amber-700">Remark: {record.absence_reason}</p> : null}
              </div>
              <span>
                <span className="text-xs text-slate-600">
                  {String(record.batch_name || '').trim()
                    || String(filters.record_batch_name || '').trim()
                    || getAttendanceRecordBatchLabel(managedBatches, record.class_name, record.section)
                    || '-'}
                </span>
              </span>
              <div>
                <p>{formatDate(record.date)}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {[String(record.class_name || '').trim(), String(record.section || '').trim()].filter(Boolean).join(' | ')}
                </p>
              </div>
              <span className={studentRecordStatusClass(record.status)}>{record.status}</span>
              <button type="button" onClick={() => handleDeleteRecord(record.id)} className={studentRecordDeleteButtonClass}>
                Delete
              </button>
            </div>
          ))}
          {!filteredRecords.length ? (
            <div className="px-4 py-5 text-sm text-slate-500">Selected filters ke hisaab se koi student record nahi mila.</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
