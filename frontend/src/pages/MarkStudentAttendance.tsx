import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { apiService, isRequestCanceled } from '@services/api';
import { useAuthStore } from '@store/auth';
import { useAuth } from '@/contexts/AuthProvider';
import type {
  Batch,
  AttendanceSubject,
  AttendanceStudent,
  StudentAttendanceMarkingResponse,
  StudentAttendanceMarkingRow,
  StudentAttendanceStatus,
  TeacherAttendanceContext,
} from '@types';
import {
  inputClass,
  sectionClass,
  statusButtonBase,
  studentStatusClass,
} from '../modules/attendance/utils/styleUtils';
import {
  getCurrentTimeHHMM,
} from '../modules/attendance/utils/dateUtils';
import {
  normalizeClassNameKey,
  toArray,
  buildAttendanceBatchOptionNames,
} from '../modules/attendance/utils/commonUtils';
import {
  batchMatchesClassSelection,
  inferAttendanceSelectionParts,
  normalizeSubjectId,
  pickPreferredSubjectId,
  resolveManagedAttendanceStudentCount,
  resolveManagedBatchSelection,
  shouldDisplayAttendanceSubject,
  shouldDisplayAttendanceTeacher,
  studentMatchesBatchSelection,
  subjectMatchesBatchSelection,
} from '../modules/attendance/utils/batchUtils';

interface MarkStudentAttendanceProps {
  students: AttendanceStudent[];
  managedBatches: Batch[];
  subjects: AttendanceSubject[];
  managedBatchOptions: string[];
  managedClassOptions: string[];
  onAlert: (alert: { type: 'success' | 'error' | 'warning' | 'info'; message: string } | null) => void;
  onAttendanceSaved: () => void;
}

export default function MarkStudentAttendance({
  students,
  managedBatches,
  subjects,
  managedBatchOptions,
  managedClassOptions,
  onAlert,
  onAttendanceSaved,
}: MarkStudentAttendanceProps) {
  const user = useAuthStore((state) => state.user);
  const { authReady, sessionReady, session } = useAuth();
  const canRunAttendanceRequests = authReady && sessionReady && !!session;

  const [filters, setFilters] = useState({
    date: new Date().toISOString().slice(0, 10),
    attendance_scope: 'batch' as 'batch' | 'class',
    attendance_class_name: '',
    batch_name: '',
    subject_id: '',
    search: '',
  });

  const [studentMarking, setStudentMarking] = useState<StudentAttendanceMarkingResponse | null>(null);
  const [teacherAttendanceContext, setTeacherAttendanceContext] = useState<TeacherAttendanceContext | null>(null);
  const [batchAttendanceContext, setBatchAttendanceContext] = useState<TeacherAttendanceContext | null>(null);
  const [batchAttendanceOptions, setBatchAttendanceOptions] = useState<TeacherAttendanceContext[]>([]);
  const [selectedBatchAttendanceEntryId, setSelectedBatchAttendanceEntryId] = useState('');
  const [batchAttendanceOptionsLoading, setBatchAttendanceOptionsLoading] = useState(false);

  const markingBatchOptions = useMemo(() => {
    const filteredManagedOptions = managedBatchOptions.filter(
      (item: string) => batchMatchesClassSelection(item, filters.attendance_class_name)
    );
    if (filteredManagedOptions.length) {
      return filteredManagedOptions;
    }
    return buildAttendanceBatchOptionNames(students).filter(
      (item: string) => batchMatchesClassSelection(item, filters.attendance_class_name)
    );
  }, [managedBatchOptions, filters.attendance_class_name, students]);

  const selectedBatchParts = useMemo(
    () => inferAttendanceSelectionParts(filters.batch_name, filters.attendance_scope, students),
    [filters.attendance_scope, filters.batch_name, students]
  );

  const selectedManagedAttendanceItem = useMemo(
    () => resolveManagedBatchSelection(managedBatches, filters.batch_name, filters.attendance_scope),
    [managedBatches, filters.attendance_scope, filters.batch_name]
  );

  const selectedBatchRosterStudents = useMemo(() => {
    const matchedStudents = students.filter((student) =>
      filters.attendance_scope === 'class'
        ? normalizeClassNameKey(String(student.class_name || '').trim()) === normalizeClassNameKey(filters.batch_name)
        : studentMatchesBatchSelection(student, filters.batch_name)
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
  }, [selectedBatchParts.className, selectedBatchParts.section, filters.attendance_scope, filters.batch_name, students]);

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

  const batchSubjectOptions = useMemo(
    () => {
      const exactBatchSubjects = subjects
        .filter((item) =>
          filters.attendance_scope === 'class'
            ? normalizeClassNameKey(item.class_name) === normalizeClassNameKey(selectedBatchParts.className)
            : subjectMatchesBatchSelection(
                item,
                filters.batch_name,
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
              filters.attendance_scope === 'class'
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
    [filters.attendance_scope, filters.batch_name, subjects, selectedBatchParts.className, selectedBatchParts.section]
  );

  const selectedBatchSubject = useMemo(
    () =>
      batchSubjectOptions.find((item) => normalizeSubjectId(item.id) === normalizeSubjectId(filters.subject_id)) ||
      batchSubjectOptions[0] ||
      null,
    [batchSubjectOptions, filters.subject_id]
  );

  const selectedBatchStudentCount = useMemo(() => {
    const managedCount = resolveManagedAttendanceStudentCount(
      managedBatches,
      filters.batch_name,
      filters.attendance_scope
    );
    return managedCount > 0 ? managedCount : selectedBatchRosterStudents.length;
  }, [
    managedBatches,
    selectedBatchRosterStudents.length,
    filters.attendance_scope,
    filters.batch_name,
  ]);

  const visibleAttendanceContext = useMemo(() => {
    if (batchAttendanceContext && (batchAttendanceContext.subject || batchAttendanceContext.teacher_name)) {
      return batchAttendanceContext;
    }
    if (teacherAttendanceContext && (teacherAttendanceContext.subject || teacherAttendanceContext.teacher_name)) {
      return teacherAttendanceContext;
    }
    return null;
  }, [batchAttendanceContext, teacherAttendanceContext]);

  const getApiErrorMessage = (error: any, fallback: string) =>
    isRequestCanceled(error) ? '' : error?.response?.data?.detail || error?.message || fallback;

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

  const loadStudentMarking = useCallback(async (options?: { subjectId?: string; subjectName?: string }) => {
    if (!canRunAttendanceRequests) {
      setStudentMarking(null);
      return;
    }
    if (!selectedTimetableParts.className || !selectedTimetableParts.section) {
      setStudentMarking(null);
      return;
    }

    try {
      const effectiveSubjectId = pickPreferredSubjectId(
        options?.subjectId,
        filters.subject_id,
        batchAttendanceContext?.subject_id,
        teacherAttendanceContext?.subject_id,
      );
      const response = await apiService.getStudentAttendanceMarking({
        date: filters.date,
        class_name: selectedTimetableParts.className,
        section: selectedTimetableParts.section,
        subject_id: effectiveSubjectId || undefined,
        search: filters.search || undefined,
        school_id: 1,
      });
      const payload = response.data;
      if (!payload || typeof payload !== 'object') {
        setStudentMarking(null);
        return;
      }
      const normalizedPayload: StudentAttendanceMarkingResponse = {
        ...(payload as StudentAttendanceMarkingResponse),
        students: toArray<StudentAttendanceMarkingRow>((payload as StudentAttendanceMarkingResponse).students),
        subject_id: effectiveSubjectId || (payload as StudentAttendanceMarkingResponse).subject_id,
        subject_name:
          options?.subjectName
          || (payload as StudentAttendanceMarkingResponse).subject_name
          || '',
      };
      setStudentMarking(normalizedPayload);
    } catch (error: any) {
      if (!isRequestCanceled(error)) {
        console.error('Error loading student attendance marking:', error);
        onAlert({ type: 'error', message: getApiErrorMessage(error, 'Student attendance marking load nahi hua.') });
      }
      setStudentMarking(null);
    }
  }, [canRunAttendanceRequests, selectedTimetableParts, filters.date, filters.subject_id, filters.search, batchAttendanceContext?.subject_id, teacherAttendanceContext?.subject_id, onAlert]);

  const loadTeacherAttendanceContext = useCallback(async () => {
    if (!canRunAttendanceRequests || user?.role !== 'teacher') {
      setTeacherAttendanceContext(null);
      return;
    }
    try {
      const response = await apiService.getTeacherAttendanceContext({
        target_date: filters.date,
        current_time: getCurrentTimeHHMM(),
        school_id: 1,
      });
      const context = response.data || null;
      setTeacherAttendanceContext(context);
    } catch (error: any) {
      if (!isRequestCanceled(error)) {
        console.error('Error loading teacher attendance context:', error);
      }
      setTeacherAttendanceContext(null);
    }
  }, [canRunAttendanceRequests, user?.role, filters.date]);

  const loadBatchAttendanceContext = useCallback(async () => {
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
        batch_name: filters.attendance_scope === 'batch' ? filters.batch_name : undefined,
        target_date: filters.date,
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
  }, [canRunAttendanceRequests, selectedTimetableParts, filters.attendance_scope, filters.batch_name, filters.date, getAttendanceContextOptionValue, selectedBatchAttendanceEntryId]);

  const handleSaveStudentAttendance = useCallback(async () => {
    const markingPayload = studentMarking;
    if (!markingPayload) {
      onAlert({ type: 'error', message: 'Student attendance marking load nahi hua.' });
      return;
    }
    try {
      const effectiveSubjectId = pickPreferredSubjectId(
        filters.subject_id,
        batchAttendanceContext?.subject_id,
        teacherAttendanceContext?.subject_id,
        markingPayload.subject_id,
      );
      await apiService.saveStudentAttendance({
        date: filters.date,
        subject_id: effectiveSubjectId || undefined,
        marked_by: visibleAttendanceContext?.teacher_name || user?.full_name || 'Attendance Department',
        entries: markingPayload.students.map((item) => ({
          student_id: item.student_id,
          status: item.status,
          absence_reason: item.status === 'absent' ? item.absence_reason : undefined,
        })),
      });
      onAlert({ type: 'success', message: 'Student attendance save ho gayi.' });
      onAttendanceSaved();
    } catch (error: any) {
      onAlert({ type: 'error', message: getApiErrorMessage(error, 'Student attendance save nahi hui.') });
    }
  }, [studentMarking, filters.date, filters.subject_id, batchAttendanceContext, teacherAttendanceContext, visibleAttendanceContext, user?.full_name, onAlert, onAttendanceSaved, getApiErrorMessage]);

  const updateStudentMarking = useCallback(
    (
      updater: (current: StudentAttendanceMarkingResponse) => StudentAttendanceMarkingResponse
    ) => {
      setStudentMarking((current) => {
        if (!current) {
          return current;
        }
        return updater(current);
      });
    },
    []
  );

  useEffect(() => {
    if (user?.role !== 'teacher') return;
    void loadTeacherAttendanceContext();
  }, [user?.role, filters.date, loadTeacherAttendanceContext]);

  useEffect(() => {
    setBatchAttendanceContext(null);
    setBatchAttendanceOptions([]);
    setSelectedBatchAttendanceEntryId('');
    setStudentMarking(null);
    if (user?.role !== 'teacher') {
      setTeacherAttendanceContext(null);
    }
  }, [filters.attendance_scope, filters.batch_name, filters.date, user?.role]);

  useEffect(() => {
    const effectiveSubjectId = pickPreferredSubjectId(
      filters.subject_id,
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
  }, [batchAttendanceContext?.subject_id, batchSubjectOptions, selectedBatchSubject?.id, selectedBatchSubject?.name, filters.subject_id, teacherAttendanceContext?.subject_id]);

  useEffect(() => {
    if (!canRunAttendanceRequests) return;
    if (!selectedTimetableParts.className && !filters.batch_name) return;
    if (filters.attendance_scope === 'batch' && !selectedTimetableParts.section && !filters.batch_name) return;

    const hydratePromise = (async () => {
      const batchContext = await loadBatchAttendanceContext();
      if (!batchContext && user?.role === 'teacher') {
        await loadTeacherAttendanceContext();
      }
      await loadStudentMarking({
        subjectId: pickPreferredSubjectId(
          batchContext?.subject_id,
          teacherAttendanceContext?.subject_id,
        ),
        subjectName: batchContext?.subject || teacherAttendanceContext?.subject || '',
      });
    })();

    void hydratePromise;
  }, [
    canRunAttendanceRequests,
    selectedTimetableParts.className,
    selectedTimetableParts.section,
    filters.attendance_scope,
    filters.batch_name,
  ]);

  return (
    <div className={`${sectionClass} min-w-0`}>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Mark Student Attendance</h2>
          <p className="mt-2 text-sm text-slate-500">
            Date ke saath batch ya class select karke attendance mark karein.
          </p>
          <p className="mt-2 text-sm text-slate-600">
            Selected {filters.attendance_scope === 'class' ? 'class' : 'batch'} total students:{' '}
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
          {filters.batch_name ? (
            <div className="mt-3 max-w-2xl">
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Today&apos;s Classes</p>
              <div className="relative w-full overflow-hidden rounded-2xl border border-sky-200 bg-sky-50 shadow-sm">
                <select
                  value={selectedBatchAttendanceEntryId}
                  disabled={batchAttendanceOptionsLoading || !batchAttendanceOptions.length}
                  onChange={async (e) => {
                    const nextValue = e.target.value;
                    setSelectedBatchAttendanceEntryId(nextValue);
                    const nextContext = batchAttendanceOptions.find(
                      (item) => getAttendanceContextOptionValue(item) === nextValue
                    ) || null;
                    setBatchAttendanceContext(nextContext);
                    setFilters((current) => ({
                      ...current,
                      subject_id: pickPreferredSubjectId(nextContext?.subject_id, current.subject_id),
                    }));
                    await loadStudentMarking({
                      subjectId: String(nextContext?.subject_id || ''),
                      subjectName: nextContext?.subject || '',
                    });
                  }}
                  className={`w-full cursor-pointer appearance-none bg-transparent px-4 py-3 pr-16 text-sm font-medium text-slate-900 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-4 focus:ring-slate-200/70`}
                  style={{ backgroundImage: 'none' }}
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
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex w-12 items-center justify-center border-l border-sky-200 bg-white/80 text-sky-700">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                </div>
              </div>
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

      <div className="mt-6 grid gap-4 md:grid-cols-[0.95fr_minmax(0,1.5fr)_minmax(0,1.6fr)_0.75fr] xl:grid-cols-[0.9fr_minmax(0,1.45fr)_minmax(0,1.75fr)_0.8fr]">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Date</p>
          <input type="date" value={filters.date} onChange={(e) => setFilters({ ...filters, date: e.target.value })} className={inputClass} />
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Class</p>
          <div className="relative w-full overflow-hidden rounded-2xl border border-sky-200 bg-sky-50 shadow-sm">
            <select
              value={filters.attendance_class_name}
              onChange={(e) => {
                const nextClassName = e.target.value;
                setFilters({
                  ...filters,
                  attendance_class_name: nextClassName,
                  attendance_scope: 'class',
                  batch_name: nextClassName,
                  subject_id: '',
                });
              }}
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
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Batch</p>
          <div className="relative w-full overflow-hidden rounded-2xl border border-sky-200 bg-sky-50 shadow-sm">
            <select
              value={filters.attendance_scope === 'batch' ? filters.batch_name : ''}
              onChange={(e) => {
                const nextBatchName = e.target.value;
                if (!nextBatchName) {
                  setFilters({
                    ...filters,
                    attendance_scope: 'class',
                    batch_name: filters.attendance_class_name || '',
                    subject_id: '',
                  });
                  return;
                }
                setFilters({
                  ...filters,
                  attendance_scope: 'batch',
                  batch_name: nextBatchName,
                  subject_id: '',
                });
              }}
              className={`w-full cursor-pointer appearance-none bg-transparent px-4 py-3 pr-16 text-sm font-medium text-slate-900 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-4 focus:ring-slate-200/70`}
              style={{ backgroundImage: 'none' }}
            >
              <option value="">Select Batch</option>
              {markingBatchOptions.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex w-12 items-center justify-center border-l border-sky-200 bg-white/80 text-sky-700">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 flex gap-3">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            className="w-full rounded-2xl border border-slate-300 bg-white py-3 pl-11 pr-4 text-sm text-slate-900 outline-none focus:border-slate-900 focus:ring-4 focus:ring-slate-200/70"
            placeholder="Search student by name"
          />
        </div>
        <button onClick={() => loadStudentMarking()} className="rounded-full bg-indigo-600 px-5 py-3 text-sm font-semibold text-white hover:bg-indigo-700">
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
              {filters.batch_name
                ? 'Student attendance marking backend se abhi load nahi hui ya selected batch me koi student nahi mila.'
                : 'Student attendance dekhne ke liye batch select karein.'}
            </div>
          )}
        </div>
      </div>

      <button onClick={handleSaveStudentAttendance} className="mt-6 rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800">
        Save Attendance
      </button>
    </div>
  );
}
