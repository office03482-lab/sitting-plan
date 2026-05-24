import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Edit, Trash2, Clock, Users, Filter, Download, Building2, Layers3 } from 'lucide-react';
import { apiService } from '../services/api';
import { Alert } from '../components/Alert';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { useAuthStore } from '@store/auth';
import type {
  Batch,
  DayOfWeek,
  Room,
  Student,
  Teacher,
  TimetableEntry,
  TimetableExtraClassScope,
  TimetableSessionMode,
  TimetableSessionType,
  TimetableView,
} from '../types';

type TimetableSessionModeFilter = 'all' | 'offline' | 'online' | 'merged';

const DAY_INDEX: Record<DayOfWeek, number> = {
  monday: 0,
  tuesday: 1,
  wednesday: 2,
  thursday: 3,
  friday: 4,
  saturday: 5,
  sunday: 6,
};

const DAY_LABELS: Record<DayOfWeek, string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
};

const formatDateBadge = (value: Date) =>
  value.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

const compareTimeValues = (left: string, right: string) => {
  if (left === right) return 0;
  return left < right ? -1 : 1;
};

const toInputDateValue = (value: Date) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getDayOfWeekFromDate = (value: string): DayOfWeek => {
  const parts = value.split('-').map(Number);
  const date = new Date(parts[0], parts[1] - 1, parts[2]);
  const jsDay = date.getDay();
  const day = (Object.keys(DAY_INDEX) as DayOfWeek[]).find((item) => DAY_INDEX[item] === jsDay);
  return day || 'monday';
};

const getWeekDateForDay = (referenceDate: string, day: DayOfWeek) => {
  const parts = referenceDate.split('-').map(Number);
  const date = new Date(parts[0], parts[1] - 1, parts[2]);
  const referenceDay = getDayOfWeekFromDate(referenceDate);
  const diff = DAY_INDEX[day] - DAY_INDEX[referenceDay];
  date.setDate(date.getDate() + diff);
  return date;
};

const isNoTeacherSession = (sessionType?: TimetableSessionType) =>
  sessionType === 'break_time' || sessionType === 'self_study';

const ensureArray = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
const getRequestErrorMessage = (error: any, fallback: string) =>
  error?.response?.data?.detail || error?.response?.data?.error || error?.message || fallback;

const hasValue = (value: unknown) => String(value ?? '').trim().length > 0;
const sameId = (left: string | number | null | undefined, right: string | number | null | undefined) =>
  String(left ?? '').trim() === String(right ?? '').trim();
const sortTimetableEntries = (items: TimetableView[]) =>
  [...items].sort((left, right) => {
    const dayDiff = DAY_INDEX[left.day_of_week] - DAY_INDEX[right.day_of_week];
    if (dayDiff !== 0) return dayDiff;
    const startDiff = compareTimeValues(left.start_time, right.start_time);
    if (startDiff !== 0) return startDiff;
    return String(left.id).localeCompare(String(right.id));
  });

const TimetableManagement: React.FC = () => {
  const user = useAuthStore((state) => state.user);
  const isTeacherSelfView = user?.role === 'teacher' && user?.user_type === 'teaching';
  const canManageTimetable = !isTeacherSelfView;
  const [entries, setEntries] = useState<TimetableView[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [managedBatchOptions, setManagedBatchOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingEntry, setEditingEntry] = useState<TimetableEntry | null>(null);
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list' | 'teacher' | 'room' | 'batch'>('grid');
  const [selectedDay, setSelectedDay] = useState<DayOfWeek | 'all'>('all');
  const [selectedTeacher, setSelectedTeacher] = useState<string | number | 'all'>('all');
  const [selectedRoom, setSelectedRoom] = useState<string | number | 'all'>('all');
  const [selectedBatch, setSelectedBatch] = useState<string | 'all'>('all');
  const [selectedSessionModeFilter, setSelectedSessionModeFilter] = useState<TimetableSessionModeFilter>('all');
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null);
  const [copyingDay, setCopyingDay] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [referenceDate, setReferenceDate] = useState(() => toInputDateValue(new Date()));
  const [copyDayForm, setCopyDayForm] = useState<{
    source_day: DayOfWeek;
    target_day: DayOfWeek;
    replace_target: boolean;
  }>({
    source_day: 'monday',
    target_day: 'tuesday',
    replace_target: false,
  });
  // Form state
  const [formData, setFormData] = useState({
    teacher_id: '',
    room_id: '',
    session_mode: 'offline' as TimetableSessionMode,
    session_type: 'regular_class' as TimetableSessionType,
    extra_class_scope: 'general' as TimetableExtraClassScope,
    online_platform: '',
    online_link: '',
    notes: '',
    day_of_week: 'monday' as DayOfWeek,
    start_time: '',
    end_time: '',
    class_names: [] as string[],
    subject: '',
  });

  const daysOfWeek: DayOfWeek[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const defaultTimeSlots = [
    '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00'
  ];

  const visibleTeachers = useMemo(() => {
    const teacherList = ensureArray<Teacher>(teachers);
    const entryList = ensureArray<TimetableView>(entries);
    if (!isTeacherSelfView) return teacherList;
    if (teacherList.length === 0) {
      const teacherMap = new Map<string, Teacher>();
      entryList.forEach((entry) => {
        if (!entry.teacher_id) return;
        const teacherKey = String(entry.teacher_id);
        if (teacherMap.has(teacherKey)) return;
        teacherMap.set(teacherKey, {
          id: entry.teacher_id,
          name: String(entry.teacher_name || user?.full_name || 'Teacher'),
          subject: String(entry.subject || 'Assigned Subject'),
          email: user?.email,
          phone: '',
          school_id: 1,
          is_active: true,
        } as Teacher);
      });
      return Array.from(teacherMap.values());
    }
    const actorName = String(user?.full_name || '').trim().toLowerCase();
    return teacherList.filter((teacher) => String(teacher.name || '').trim().toLowerCase() === actorName);
  }, [entries, isTeacherSelfView, teachers, user?.email, user?.full_name]);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (!isTeacherSelfView) return;
    setViewMode('teacher');
    if (visibleTeachers[0]?.id) {
      setSelectedTeacher(visibleTeachers[0].id);
    }
  }, [isTeacherSelfView, visibleTeachers]);

  const refreshEntries = async () => {
    const response = await apiService.listTimetableEntries();
    const nextEntries = sortTimetableEntries(ensureArray<TimetableView>(response.data));
    setEntries(nextEntries);
    return nextEntries;
  };

  const upsertEntry = (entry: TimetableEntry | TimetableView) => {
    setEntries((current) =>
      sortTimetableEntries([
        ...current.filter((item) => !sameId(item.id, entry.id)),
        entry as TimetableView,
      ])
    );
  };

  const loadReferenceData = async () => {
    if (isTeacherSelfView) {
      const teachersResponse = await apiService.listTeachers();
      setTeachers(ensureArray<Teacher>(teachersResponse.data));
      setRooms([]);
      setStudents([]);
      setManagedBatchOptions([]);
      return;
    }

    const [teachersResponse, roomsResponse, batchResponse, classResponse] = await Promise.allSettled([
      apiService.listTeachers(),
      apiService.listRooms(),
      apiService.listBatches(undefined, undefined, 'batch'),
      apiService.listBatches(undefined, undefined, 'class'),
    ]);

    setTeachers(teachersResponse.status === 'fulfilled' ? ensureArray<Teacher>(teachersResponse.value.data) : []);
    setRooms(roomsResponse.status === 'fulfilled' ? ensureArray<Room>(roomsResponse.value.data) : []);
    setStudents([]);
    const managedOptions = [
      ...ensureArray<Batch>(batchResponse.status === 'fulfilled' ? batchResponse.value.data : []),
      ...ensureArray<Batch>(classResponse.status === 'fulfilled' ? classResponse.value.data : []),
    ]
      .map((item: Batch) => String(item.name || '').trim())
      .filter(Boolean);
    setManagedBatchOptions(Array.from(new Set(managedOptions)).sort((a, b) => a.localeCompare(b)));
    apiService.listStudents()
      .then((response) => {
        setStudents(ensureArray<Student>(response.data));
      })
      .catch(() => {
        setStudents([]);
      });
  };

  const loadData = async () => {
    try {
      setLoading(true);
      setAlert(null);
      const [entriesResponse, referenceResponse] = await Promise.allSettled([
        refreshEntries(),
        loadReferenceData(),
      ]);

      if (entriesResponse.status !== 'fulfilled') {
        setAlert({
          type: 'error',
          message: getRequestErrorMessage(entriesResponse.reason, 'Timetable entries load nahi ho paaye.'),
        });
      }
      if (referenceResponse.status !== 'fulfilled' && isTeacherSelfView) {
        setTeachers([]);
      }
    } catch (error) {
      console.error('Error loading data:', error);
      setAlert({ type: 'error', message: getRequestErrorMessage(error, 'Failed to load timetable data') });
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      teacher_id: '',
      room_id: '',
      session_mode: 'offline',
      session_type: 'regular_class',
      extra_class_scope: 'general',
      online_platform: '',
      online_link: '',
      notes: '',
      day_of_week: 'monday',
      start_time: '',
      end_time: '',
      class_names: [],
      subject: '',
    });
    setEditingEntry(null);
    setShowForm(false);
  };

  const openCreateForm = () => {
    setAlert(null);
    setEditingEntry(null);
    setFormData({
      teacher_id: '',
      room_id: '',
      session_mode: 'offline',
      session_type: 'regular_class',
      extra_class_scope: 'general',
      online_platform: '',
      online_link: '',
      notes: '',
      day_of_week: 'monday',
      start_time: '',
      end_time: '',
      class_names: [],
      subject: '',
    });
    setShowForm(true);
  };

  const populateFormFromEntry = (entry: Pick<TimetableView, 'teacher_id' | 'room_id' | 'session_mode' | 'session_type' | 'extra_class_scope' | 'online_platform' | 'online_link' | 'notes' | 'day_of_week' | 'start_time' | 'end_time' | 'class_name' | 'subject'>) => {
    setFormData({
      teacher_id: entry.teacher_id?.toString() || '',
      room_id: entry.room_id?.toString() || '',
      session_mode: entry.session_mode || 'offline',
      session_type: entry.session_type || 'regular_class',
      extra_class_scope: entry.extra_class_scope || 'general',
      online_platform: entry.online_platform || '',
      online_link: entry.online_link || '',
      notes: entry.notes || '',
      day_of_week: entry.day_of_week,
      start_time: entry.start_time,
      end_time: entry.end_time,
      class_names: String(entry.class_name || '')
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean),
      subject: entry.subject || '',
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    const isBreakSession = formData.session_type === 'break_time';
    const isTeacherFreeSession = isNoTeacherSession(formData.session_type);

    if ((!isTeacherFreeSession && !formData.teacher_id) || formData.class_names.length === 0 || (!isBreakSession && !formData.subject) || !formData.start_time || !formData.end_time) {
      setAlert({ type: 'error', message: 'All fields are required' });
      return;
    }
    if (compareTimeValues(formData.start_time, formData.end_time) >= 0) {
      setAlert({ type: 'error', message: 'End time start time se aage honi chahiye.' });
      return;
    }

    try {
      setSubmitting(true);
      const submitData = {
        teacher_id: isTeacherFreeSession ? undefined : formData.teacher_id,
        room_id: hasValue(formData.room_id) ? formData.room_id : undefined,
        session_mode: formData.session_mode,
        session_type: formData.session_type,
        extra_class_scope: formData.session_type === 'extra_class' ? formData.extra_class_scope : undefined,
        online_platform: formData.session_mode === 'online' ? formData.online_platform || undefined : undefined,
        online_link: formData.session_mode === 'online' ? formData.online_link || undefined : undefined,
        notes: formData.notes || undefined,
        day_of_week: formData.day_of_week,
        start_time: formData.start_time,
        end_time: formData.end_time,
        class_name: formData.class_names.join(', '),
        subject: isBreakSession ? 'Break Time' : formData.subject,
      };
      const selectedTeacherData = visibleTeachers.find((teacher) => sameId(teacher.id, submitData.teacher_id));
      const selectedRoomData = normalizedRooms.find((room) => sameId(room.id, submitData.room_id));

      if (editingEntry) {
        const response = await apiService.updateTimetableEntry(editingEntry.id, submitData);
        upsertEntry(response.data);
        setAlert({ type: 'success', message: 'Timetable entry updated successfully' });
      } else {
        const tempId = `temp-${Date.now()}`;
        const optimisticEntry: TimetableView = {
          id: tempId,
          day_of_week: submitData.day_of_week,
          start_time: submitData.start_time,
          end_time: submitData.end_time,
          class_name: submitData.class_name,
          subject: submitData.subject,
          teacher_id: submitData.teacher_id,
          teacher_name: isTeacherFreeSession
            ? (formData.session_type === 'break_time' ? 'BREAK TIME' : 'SELF STUDY')
            : selectedTeacherData?.name || '',
          room_id: submitData.room_id,
          room_name: selectedRoomData?.name || '',
          session_mode: submitData.session_mode,
          session_type: submitData.session_type,
          extra_class_scope: submitData.extra_class_scope,
          online_platform: submitData.online_platform,
          online_link: submitData.online_link,
          notes: submitData.notes,
        };
        upsertEntry(optimisticEntry);
        resetForm();
        const response = await apiService.createTimetableEntry(submitData);
        setEntries((current) => current.filter((entry) => !sameId(entry.id, tempId)));
        upsertEntry(response.data);
        setAlert({ type: 'success', message: 'Timetable entry created successfully' });
        void refreshEntries();
        return;
      }
      resetForm();
      void refreshEntries();
    } catch (error) {
      setEntries((current) => current.filter((entry) => !String(entry.id).startsWith('temp-')));
      console.error('Error saving timetable entry:', error);
      const requestError = error as any;
      setAlert({
        type: 'error',
        message: requestError?.response?.data?.detail || requestError?.message || 'Failed to save timetable entry',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteAllEntries = async () => {
    if (!confirm('Are you sure you want to delete all records? This action cannot be undone.')) {
      return;
    }

    try {
      await apiService.deleteAllTimetableEntries(undefined, true);
      setEntries([]);
      setAlert({ type: 'success', message: 'All timetable entries deleted successfully' });
    } catch (error) {
      console.error('Error deleting timetable entries:', error);
      setAlert({ type: 'error', message: 'Failed to delete all timetable entries' });
    }
  };

  const handleEdit = (entry: TimetableView) => {
    populateFormFromEntry(entry);
    setEditingEntry(entry as TimetableEntry);
    setShowForm(true);

    apiService.getTimetableEntry(entry.id).then(response => {
      const fullEntry = response.data;
      setEditingEntry(fullEntry);
      populateFormFromEntry(fullEntry);
    }).catch(error => {
      console.error('Error loading entry details:', error);
      setAlert({ type: 'error', message: 'Failed to load latest entry details. Showing loaded timetable data instead.' });
    });
  };

  const handleDelete = async (entryId: string | number) => {
    if (!confirm('Are you sure you want to delete this timetable entry?')) return;

    try {
      await apiService.deleteTimetableEntry(entryId);
      setEntries((current) => current.filter((entry) => !sameId(entry.id, entryId)));
      setAlert({ type: 'success', message: 'Timetable entry deleted successfully' });
    } catch (error) {
      console.error('Error deleting timetable entry:', error);
      setAlert({ type: 'error', message: 'Failed to delete timetable entry' });
    }
  };

  const getEntriesForDayAndTime = (day: DayOfWeek, time: string) => {
    return entries.filter(entry =>
      entry.day_of_week === day &&
      compareTimeValues(entry.start_time, time) <= 0 &&
      compareTimeValues(entry.end_time, time) > 0
    );
  };

  const handleCopyDayTimetable = async () => {
    const { source_day, target_day, replace_target } = copyDayForm;

    if (source_day === target_day) {
      setAlert({ type: 'error', message: 'Source day aur target day same nahi ho sakte.' });
      return;
    }

    const sourceEntries = entries.filter((entry) => entry.day_of_week === source_day);
    if (sourceEntries.length === 0) {
      setAlert({ type: 'error', message: `${DAY_LABELS[source_day]} mein copy karne ke liye koi timetable entry nahi hai.` });
      return;
    }

    const targetEntries = entries.filter((entry) => entry.day_of_week === target_day);

    try {
      setCopyingDay(true);

      if (replace_target && targetEntries.length > 0) {
        for (const targetEntry of targetEntries) {
          await apiService.deleteTimetableEntry(targetEntry.id);
        }
      }

      for (const sourceEntry of sourceEntries) {
        await apiService.createTimetableEntry({
          teacher_id: isNoTeacherSession(sourceEntry.session_type) ? undefined : sourceEntry.teacher_id,
          room_id: sourceEntry.room_id || undefined,
          session_mode: sourceEntry.session_mode || 'offline',
          session_type: sourceEntry.session_type || 'regular_class',
          extra_class_scope: sourceEntry.extra_class_scope || undefined,
          online_platform: sourceEntry.online_platform || undefined,
          online_link: sourceEntry.online_link || undefined,
          notes: sourceEntry.notes || undefined,
          day_of_week: target_day,
          start_time: sourceEntry.start_time,
          end_time: sourceEntry.end_time,
          class_name: sourceEntry.class_name,
          subject: sourceEntry.subject,
        });
      }

      setAlert({
        type: 'success',
        message: `${DAY_LABELS[source_day]} ka timetable ${DAY_LABELS[target_day]} mein copy ho gaya${replace_target ? ' aur purana target timetable replace ho gaya' : ''}.`,
      });
      await refreshEntries();
    } catch (error: any) {
      console.error('Error copying timetable day:', error);
      setAlert({
        type: 'error',
        message: error?.response?.data?.detail || 'Timetable day copy nahi ho paaya.',
      });
    } finally {
      setCopyingDay(false);
    }
  };

  const formatTime = (time: string) => {
    const [hours, minutes] = time.split(':').map(Number);
    const suffix = hours >= 12 ? 'PM' : 'AM';
    const normalizedHour = hours % 12 || 12;
    return `${normalizedHour.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')} ${suffix}`;
  };

const getSessionTypeLabel = (value?: TimetableSessionType) => {
    switch (value) {
      case 'break_time':
        return 'Break Time';
      case 'doubt_session':
        return 'Doubt Session';
      case 'extra_class':
        return 'Extra Class';
      case 'self_study':
        return 'Self Study';
      default:
        return 'Regular Class';
    }
};

const getModeLabel = (entry: TimetableView | TimetableEntry) => (entry.session_mode === 'online' ? 'Online' : 'Offline');
const getRoomModeSummary = (entry: TimetableView | TimetableEntry) => {
  const roomName = entry.room_name || '';
  const platformName = entry.online_platform || '';
  if (entry.session_mode === 'online') {
    if (roomName && platformName) return `${roomName} | ${platformName}`;
    return roomName || platformName || 'Online';
  }
  return roomName || '-';
};

  const normalizedEntries = ensureArray<TimetableView>(entries);
  const normalizedRooms = ensureArray<Room>(rooms);
  const normalizedStudents = ensureArray<Student>(students);
  const normalizedManagedBatchOptions = ensureArray<string>(managedBatchOptions);

  const filteredEntries = normalizedEntries.filter(entry => {
    if (selectedDay !== 'all' && entry.day_of_week !== selectedDay) return false;
    if (selectedTeacher !== 'all' && !sameId(entry.teacher_id, selectedTeacher)) return false;
    if (selectedRoom !== 'all' && !sameId(entry.room_id, selectedRoom)) return false;
    if (selectedBatch !== 'all') {
      const batches = entry.class_name
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
      if (!batches.includes(selectedBatch)) return false;
    }
    return true;
  });

  const gridTimeSlots = useMemo(() => {
    const slotSet = new Set(defaultTimeSlots);
    filteredEntries.forEach((entry) => {
      if (entry.start_time) slotSet.add(entry.start_time);
    });
    return Array.from(slotSet).sort(compareTimeValues);
  }, [filteredEntries]);

  const batchOptions = Array.from(
    new Set([
      ...normalizedStudents.map((student) => String(student.batch || '').trim()).filter(Boolean),
      ...normalizedManagedBatchOptions,
    ])
  ).sort((a, b) => a.localeCompare(b));
  const batchOptionsForForm = Array.from(new Set([...batchOptions, ...formData.class_names])).sort();
  const roomEntries = normalizedRooms
    .map((room) => ({
      room,
      entries: filteredEntries.filter((entry) => sameId(entry.room_id, room.id)),
    }))
    .filter(({ entries }) => entries.length > 0);
  const batchEntries = batchOptions
    .map((batch) => ({
      batch,
      entries: filteredEntries.filter((entry) =>
        entry.class_name
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
          .includes(batch)
      ),
    }))
    .filter(({ entries }) => entries.length > 0);

  const selectedReferenceDay = getDayOfWeekFromDate(referenceDate);
  const weekDateByDay = daysOfWeek.reduce<Record<DayOfWeek, Date>>((acc, day) => {
    acc[day] = getWeekDateForDay(referenceDate, day);
    return acc;
  }, {} as Record<DayOfWeek, Date>);

  const handleExport = async (format: 'excel' | 'pdf') => {
    try {
      setExporting(format);
      const response = await apiService.exportTimetableReport({
        export_format: format,
        view_by:
        viewMode === 'teacher' || viewMode === 'room' || viewMode === 'batch'
            ? viewMode
            : 'day',
        session_mode_filter: selectedSessionModeFilter,
        day_of_week: selectedDay === 'all' ? undefined : selectedDay,
        teacher_id: selectedTeacher === 'all' ? undefined : selectedTeacher,
        room_id: selectedRoom === 'all' ? undefined : selectedRoom,
        batch_name: selectedBatch === 'all' ? undefined : selectedBatch,
      });

      const extension = format === 'excel' ? 'xlsx' : 'pdf';
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute(
        'download',
        `timetable-${selectedSessionModeFilter}-${viewMode}-${selectedDay === 'all' ? 'all' : selectedDay}.${extension}`
      );
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setAlert({ type: 'success', message: 'Timetable exported successfully' });
    } catch (error) {
      console.error('Error exporting timetable:', error);
      setAlert({ type: 'error', message: 'Failed to export timetable' });
    } finally {
      setExporting(null);
    }
  };

  if (loading) {
    return <LoadingSpinner />;
  }

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Timetable Management</h1>
        {canManageTimetable ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <button
              onClick={handleDeleteAllEntries}
              className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 flex items-center gap-2"
            >
              <Trash2 size={20} />
              Delete All
            </button>
            <button
              onClick={openCreateForm}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 flex items-center gap-2"
            >
              <Plus size={20} />
              Add Entry
            </button>
          </div>
        ) : null}
      </div>

      {alert && (
        <Alert
          type={alert.type}
          message={alert.message}
          onClose={() => setAlert(null)}
        />
      )}

      {/* View Controls */}
      <div className="mb-6 bg-white rounded-lg shadow p-4">
        <div className="flex flex-col gap-4">
          {canManageTimetable ? (
          <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-blue-900">Copy Day Timetable</h2>
                <p className="mt-1 text-sm text-blue-700">Agar Monday ka same timetable Tuesday ya kisi aur day mein chahiye ho to yahan se copy kar sakte ho.</p>
              </div>
              <div className="grid gap-3 md:grid-cols-4">
                <select
                  value={copyDayForm.source_day}
                  onChange={(e) => setCopyDayForm((current) => ({ ...current, source_day: e.target.value as DayOfWeek }))}
                  className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm text-slate-900"
                >
                  {daysOfWeek.map((day) => (
                    <option key={day} value={day}>{DAY_LABELS[day]}</option>
                  ))}
                </select>
                <select
                  value={copyDayForm.target_day}
                  onChange={(e) => setCopyDayForm((current) => ({ ...current, target_day: e.target.value as DayOfWeek }))}
                  className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm text-slate-900"
                >
                  {daysOfWeek.map((day) => (
                    <option key={day} value={day}>{DAY_LABELS[day]}</option>
                  ))}
                </select>
                <label className="flex items-center gap-2 rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={copyDayForm.replace_target}
                    onChange={(e) => setCopyDayForm((current) => ({ ...current, replace_target: e.target.checked }))}
                  />
                  Replace target day
                </label>
                <button
                  type="button"
                  onClick={handleCopyDayTimetable}
                  disabled={copyingDay}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {copyingDay ? 'Copying...' : 'Copy Timetable'}
                </button>
              </div>
            </div>
          </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setViewMode('grid')}
              className={`px-3 py-1 rounded ${viewMode === 'grid' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}
            >
              Grid View
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`px-3 py-1 rounded ${viewMode === 'list' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}
            >
              List View
            </button>
            <button
              onClick={() => setViewMode('teacher')}
              className={`px-3 py-1 rounded ${viewMode === 'teacher' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}
            >
              Teacher View
            </button>
            {canManageTimetable ? (
              <>
                <button
                  onClick={() => setViewMode('room')}
                  className={`px-3 py-1 rounded ${viewMode === 'room' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}
                >
                  Room View
                </button>
                <button
                  onClick={() => setViewMode('batch')}
                  className={`px-3 py-1 rounded ${viewMode === 'batch' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}
                >
                  Batch View
                </button>
              </>
            ) : null}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <Filter size={16} className="text-gray-500" />
            <input
              type="date"
              value={referenceDate}
              onChange={(e) => setReferenceDate(e.target.value)}
              className="px-3 py-1 border border-gray-300 rounded"
            />
            <button
              type="button"
              onClick={() => setSelectedDay(selectedReferenceDay)}
              className="px-3 py-1 rounded bg-indigo-100 text-indigo-700 hover:bg-indigo-200"
            >
              Use {DAY_LABELS[selectedReferenceDay]}
            </button>
            <button
              type="button"
              onClick={() => setSelectedDay('all')}
              className="px-3 py-1 rounded bg-slate-100 text-slate-700 hover:bg-slate-200"
            >
              Show Full Week
            </button>
            <select
              value={selectedDay}
              onChange={(e) => setSelectedDay(e.target.value as DayOfWeek | 'all')}
              className="px-3 py-1 border border-gray-300 rounded"
            >
              <option value="all">All Days</option>
              {daysOfWeek.map(day => (
                <option key={day} value={day}>{day.charAt(0).toUpperCase() + day.slice(1)}</option>
              ))}
            </select>

            <select
              value={selectedTeacher}
              onChange={(e) => setSelectedTeacher(e.target.value === 'all' ? 'all' : e.target.value)}
              className="px-3 py-1 border border-gray-300 rounded"
            >
              <option value="all">{isTeacherSelfView ? 'My Timetable' : 'All Teachers'}</option>
              {visibleTeachers.map(teacher => (
                <option key={teacher.id} value={teacher.id}>{teacher.name}</option>
              ))}
            </select>

            {canManageTimetable ? (
              <select
                value={selectedRoom}
                onChange={(e) => setSelectedRoom(e.target.value === 'all' ? 'all' : e.target.value)}
                className="px-3 py-1 border border-gray-300 rounded"
              >
                <option value="all">All Rooms</option>
                {normalizedRooms.map(room => (
                  <option key={room.id} value={room.id}>{room.name}</option>
                ))}
              </select>
            ) : null}

            {canManageTimetable ? (
              <select
                value={selectedBatch}
                onChange={(e) => setSelectedBatch(e.target.value)}
                className="px-3 py-1 border border-gray-300 rounded"
              >
                <option value="all">All Batches</option>
                {batchOptions.map(batch => (
                  <option key={batch} value={batch}>{batch}</option>
                ))}
              </select>
            ) : null}

            <select
              value={selectedSessionModeFilter}
              onChange={(e) => setSelectedSessionModeFilter(e.target.value as TimetableSessionModeFilter)}
              className="px-3 py-1 border border-gray-300 rounded"
            >
              <option value="all">All Modes</option>
              <option value="offline">Offline Only</option>
              <option value="online">Online Only</option>
              <option value="merged">Merged Online + Offline</option>
            </select>
          </div>

          <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-800">
            Selected date <span className="font-semibold">{(() => { const p = referenceDate.split('-').map(Number); return formatDateBadge(new Date(p[0], p[1] - 1, p[2])); })()}</span> ka day
            <span className="font-semibold"> {DAY_LABELS[selectedReferenceDay]}</span> hai.
            {selectedDay === 'all'
              ? ' Neeche poore week ki actual dates dikh rahi hain.'
              : ` Current filter bhi ${DAY_LABELS[selectedDay]} par hai.`}
          </div>

        </div>
      </div>

      <div className="mb-6 bg-white rounded-lg shadow p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Timetable Report</h2>
            <p className="mt-1 text-sm text-gray-500">
              Export timetable in day wise, teacher wise, room wise, ya batch wise format with online, offline, ya merged online-offline mode.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => handleExport('excel')}
              disabled={exporting !== null}
              className="flex items-center gap-2 rounded bg-green-600 px-4 py-2 text-white hover:bg-green-700 disabled:opacity-50"
            >
              <Download size={16} />
              {exporting === 'excel' ? 'Exporting Excel...' : 'Export Excel'}
            </button>
            <button
              onClick={() => handleExport('pdf')}
              disabled={exporting !== null}
              className="flex items-center gap-2 rounded bg-red-600 px-4 py-2 text-white hover:bg-red-700 disabled:opacity-50"
            >
              <Download size={16} />
              {exporting === 'pdf' ? 'Exporting PDF...' : 'Export PDF'}
            </button>
          </div>
        </div>
      </div>

      {/* Form Modal */}
      {canManageTimetable && showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="flex max-h-[90vh] w-full max-w-md flex-col rounded-lg bg-white shadow-xl">
            <div className="px-6 pt-6 pb-4 border-b border-gray-200">
              <h2 className="text-xl font-bold">
                {editingEntry ? 'Edit Timetable Entry' : 'Add New Entry'}
              </h2>
            </div>

            <form onSubmit={handleSubmit} className="flex flex-col min-h-0">
              <div className="space-y-4 overflow-y-auto px-6 py-4">
              {!isNoTeacherSession(formData.session_type) && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Teacher *
                  </label>
                  <select
                    value={formData.teacher_id}
                    onChange={(e) => {
                      const selectedTeacherData = visibleTeachers.find((teacher) => sameId(teacher.id, e.target.value));
                      setFormData({
                        ...formData,
                        teacher_id: e.target.value,
                        subject: selectedTeacherData?.subject || formData.subject,
                      });
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    required
                  >
                    <option value="">Select Teacher</option>
                    {visibleTeachers.map(teacher => (
                      <option key={teacher.id} value={teacher.id}>{teacher.name} - {teacher.subject}</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Session Mode *
                </label>
                <select
                  value={formData.session_mode}
                  onChange={(e) => setFormData({ ...formData, session_mode: e.target.value as TimetableSessionMode })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                >
                  <option value="offline">Offline Class</option>
                  <option value="online">Online Class</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Session Type *
                </label>
                <select
                  value={formData.session_type}
                  onChange={(e) =>
                    setFormData((current) => {
                      const nextSessionType = e.target.value as TimetableSessionType;
                      return {
                        ...current,
                        session_type: nextSessionType,
                        teacher_id: isNoTeacherSession(nextSessionType) ? '' : current.teacher_id,
                        subject:
                          nextSessionType === 'break_time'
                            ? 'Break Time'
                            : nextSessionType === 'self_study'
                              ? current.subject === 'Break Time' || !current.subject
                                ? 'Self Study'
                                : current.subject
                              : current.subject === 'Break Time' || current.subject === 'Self Study'
                                ? ''
                                : current.subject,
                      };
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                >
                  <option value="regular_class">Regular Class</option>
                  <option value="break_time">Break Time</option>
                  <option value="doubt_session">Doubt Session</option>
                  <option value="extra_class">Extra Class</option>
                  <option value="self_study">Self Study</option>
                </select>
              </div>

              {formData.session_type === 'extra_class' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Extra Class Type
                  </label>
                  <select
                    value={formData.extra_class_scope}
                    onChange={(e) => setFormData({ ...formData, extra_class_scope: e.target.value as TimetableExtraClassScope })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  >
                    <option value="general">General Extra Class</option>
                    <option value="class_wise">Class Wise Extra Class</option>
                    <option value="subject_wise">Subject Wise Extra Class</option>
                  </select>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Room {formData.session_mode === 'online' ? '(optional for smart board room)' : ''}
                </label>
                <select
                  value={formData.room_id}
                  onChange={(e) => setFormData({ ...formData, room_id: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">Select Room</option>
                  {normalizedRooms.map(room => (
                    <option key={room.id} value={room.id}>{room.name}</option>
                  ))}
                </select>
              </div>

              {formData.session_mode === 'online' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Online Platform
                    </label>
                    <input
                      type="text"
                      value={formData.online_platform}
                      onChange={(e) => setFormData({ ...formData, online_platform: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="Zoom / Google Meet / Teams"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Meeting Link
                    </label>
                    <input
                      type="url"
                      value={formData.online_link}
                      onChange={(e) => setFormData({ ...formData, online_link: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="https://..."
                    />
                  </div>
                </>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Day of Week *
                </label>
                <select
                  value={formData.day_of_week}
                  onChange={(e) => setFormData({ ...formData, day_of_week: e.target.value as DayOfWeek })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                >
                  {daysOfWeek.map(day => (
                    <option key={day} value={day}>{day.charAt(0).toUpperCase() + day.slice(1)}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Start Time *
                  </label>
                  <input
                    type="time"
                    value={formData.start_time}
                    onChange={(e) => setFormData({ ...formData, start_time: e.target.value })}
                    step={60}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    required
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    {formData.start_time ? `Selected: ${formatTime(formData.start_time)}` : 'Example: 01:10 PM'}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    End Time *
                  </label>
                  <input
                    type="time"
                    value={formData.end_time}
                    onChange={(e) => setFormData({ ...formData, end_time: e.target.value })}
                    step={60}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    required
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    {formData.end_time ? `Selected: ${formatTime(formData.end_time)}` : 'Example: 02:10 PM'}
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Class / Batch *
                </label>
                <select
                  value={formData.class_names}
                  onChange={(e) => {
                    const selectedValues = Array.from(e.target.selectedOptions).map((option) => option.value);
                    setFormData({ ...formData, class_names: selectedValues });
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                  multiple
                  size={Math.min(6, Math.max(3, batchOptionsForForm.length || 3))}
                >
                  {batchOptionsForForm.map((batch) => (
                    <option key={batch} value={batch}>{batch}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-500">Hold Ctrl/Cmd to select multiple batches.</p>
                {formData.class_names.length > 0 && (
                  <p className="mt-1 text-xs text-blue-600">
                    Selected: {formData.class_names.join(', ')}
                  </p>
                )}
                {batchOptionsForForm.length === 0 && (
                  <p className="mt-1 text-xs text-amber-600">
                    Batch/Class management se jo names add honge wo yahan student data ke bina bhi show honge.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Subject {formData.session_type === 'break_time' ? '' : '*'}
                </label>
                <input
                  type="text"
                  value={formData.subject}
                  onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder={formData.session_type === 'break_time' ? 'Auto set as Break Time' : formData.session_type === 'self_study' ? 'Self Study subject' : 'Auto-filled from teacher selection'}
                  required={formData.session_type !== 'break_time'}
                  disabled={formData.session_type === 'break_time'}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Notes
                </label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  rows={3}
                  placeholder="Break note, doubt session topic, extra class reason, etc."
                />
              </div>

              </div>

              <div className="flex gap-3 px-6 py-4 border-t border-gray-200 bg-white">
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 disabled:opacity-60"
                >
                  {submitting ? (editingEntry ? 'Updating...' : 'Creating...') : (editingEntry ? 'Update' : 'Create')}
                </button>
                <button
                  type="button"
                  onClick={resetForm}
                  disabled={submitting}
                  className="flex-1 bg-gray-300 text-gray-700 py-2 rounded-lg hover:bg-gray-400"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Grid View */}
      {viewMode === 'grid' && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Time
                  </th>
                  {daysOfWeek.map(day => (
                    <th key={day} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      <div>{DAY_LABELS[day]}</div>
                      <div className="mt-1 normal-case tracking-normal text-[11px] text-gray-400">
                        {formatDateBadge(weekDateByDay[day])}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {gridTimeSlots.map(time => (
                  <tr key={time}>
                    <td className="px-4 py-2 whitespace-nowrap text-sm font-medium text-gray-900">
                      {formatTime(time)}
                    </td>
                    {daysOfWeek.map(day => {
                      const dayEntries = getEntriesForDayAndTime(day, time);
                      return (
                        <td key={day} className="px-4 py-2 whitespace-nowrap">
                          {dayEntries.map(entry => (
                            <div key={entry.id} className="mb-1 p-2 bg-blue-50 rounded text-xs">
                              <div className="font-medium">{entry.class_name}</div>
                              <div className="text-gray-600">{entry.subject}</div>
                              {entry.teacher_name && <div className="text-gray-500">{entry.teacher_name}</div>}
                              <div className="text-gray-500">{getSessionTypeLabel(entry.session_type)}</div>
                              <div className="text-gray-500">Mode: {getModeLabel(entry)}</div>
                              {entry.room_name && <div className="text-gray-500">Room: {entry.room_name}</div>}
                              {entry.online_platform && <div className="text-gray-500">Platform: {entry.online_platform}</div>}
                              {canManageTimetable ? (
                                <div className="flex gap-1 mt-1">
                                  <button
                                    onClick={() => handleEdit(entry)}
                                    className="text-blue-600 hover:text-blue-800"
                                  >
                                    <Edit size={12} />
                                  </button>
                                  <button
                                    onClick={() => handleDelete(entry.id)}
                                    className="text-red-600 hover:text-red-800"
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* List View */}
      {viewMode === 'list' && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Day
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Time
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Class
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Subject
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Teacher
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Room
                  </th>
                  {canManageTimetable ? (
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredEntries.length === 0 ? (
                  <tr>
                    <td colSpan={canManageTimetable ? 8 : 7} className="px-6 py-4 text-center text-gray-500">
                      No timetable entries found.
                    </td>
                  </tr>
                ) : (
                  filteredEntries.map((entry) => (
                    <tr key={entry.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full">
                          {DAY_LABELS[entry.day_of_week]}
                        </span>
                        <div className="mt-1 text-xs text-gray-500">
                          {formatDateBadge(weekDateByDay[entry.day_of_week])}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {formatTime(entry.start_time)} - {formatTime(entry.end_time)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {entry.class_name}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {entry.subject}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {getSessionTypeLabel(entry.session_type)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {entry.teacher_name || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {getRoomModeSummary(entry)}
                      </td>
                      {canManageTimetable ? (
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleEdit(entry)}
                              className="text-indigo-600 hover:text-indigo-900"
                              title="Edit entry"
                            >
                              <Edit size={16} />
                            </button>
                            <button
                              onClick={() => handleDelete(entry.id)}
                              className="text-red-600 hover:text-red-900"
                              title="Delete entry"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      ) : null}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Teacher View */}
      {viewMode === 'teacher' && (
        <div className="space-y-6">
          {visibleTeachers.map(teacher => {
            const teacherEntries = filteredEntries.filter(entry => entry.teacher_id === teacher.id);
            return (
              <div key={teacher.id} className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                  <Users className="mr-2" size={20} />
                  {teacher.name} - {teacher.subject}
                </h3>

                {teacherEntries.length === 0 ? (
                  <p className="text-gray-500">No timetable entries for this teacher.</p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {teacherEntries.map(entry => (
                      <div key={entry.id} className="border border-gray-200 rounded-lg p-4">
                        <div className="flex justify-between items-start mb-2">
                          <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full">
                            {DAY_LABELS[entry.day_of_week]}
                          </span>
                          {canManageTimetable ? (
                            <div className="flex gap-1">
                              <button
                                onClick={() => handleEdit(entry)}
                                className="text-blue-600 hover:text-blue-800"
                              >
                                <Edit size={14} />
                              </button>
                              <button
                                onClick={() => handleDelete(entry.id)}
                                className="text-red-600 hover:text-red-800"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          ) : null}
                        </div>
                          <div className="space-y-1">
                          <div className="text-xs text-gray-500">{formatDateBadge(weekDateByDay[entry.day_of_week])}</div>
                          <div className="font-medium text-gray-900">{entry.class_name}</div>
                          <div className="text-sm text-gray-600">{entry.subject}</div>
                          {entry.teacher_name && <div className="text-sm text-gray-500">{entry.teacher_name}</div>}
                          <div className="text-sm text-gray-500">{getSessionTypeLabel(entry.session_type)}</div>
                          <div className="text-sm text-gray-500 flex items-center">
                            <Clock size={14} className="mr-1" />
                            {formatTime(entry.start_time)} - {formatTime(entry.end_time)}
                          </div>
                          <div className="text-sm text-gray-500">Mode: {getModeLabel(entry)}</div>
                          {entry.room_name && <div className="text-sm text-gray-500">Room: {entry.room_name}</div>}
                          {entry.online_platform && <div className="text-sm text-gray-500">Platform: {entry.online_platform}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {viewMode === 'room' && (
        <div className="space-y-6">
          {roomEntries.length === 0 ? (
            <div className="bg-white rounded-lg shadow p-6 text-gray-500">No timetable entries for selected room filters.</div>
          ) : (
            roomEntries.map(({ room, entries: roomWiseEntries }) => (
              <div key={room.id} className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                  <Building2 className="mr-2" size={20} />
                  {room.name}
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {roomWiseEntries.map(entry => (
                    <div key={entry.id} className="border border-gray-200 rounded-lg p-4">
                      <div className="flex justify-between items-start mb-2">
                        <span className="px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded-full">
                          {DAY_LABELS[entry.day_of_week]}
                        </span>
                        <div className="flex gap-1">
                          <button onClick={() => handleEdit(entry)} className="text-blue-600 hover:text-blue-800"><Edit size={14} /></button>
                          <button onClick={() => handleDelete(entry.id)} className="text-red-600 hover:text-red-800"><Trash2 size={14} /></button>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <div className="text-xs text-gray-500">{formatDateBadge(weekDateByDay[entry.day_of_week])}</div>
                        <div className="font-medium text-gray-900">{entry.class_name}</div>
                        <div className="text-sm text-gray-600">{entry.subject}</div>
                        <div className="text-sm text-gray-500">{getSessionTypeLabel(entry.session_type)}</div>
                        {entry.teacher_name && <div className="text-sm text-gray-500">{entry.teacher_name}</div>}
                        <div className="text-sm text-gray-500 flex items-center">
                          <Clock size={14} className="mr-1" />
                          {formatTime(entry.start_time)} - {formatTime(entry.end_time)}
                        </div>
                        <div className="text-sm text-gray-500">Mode: {getModeLabel(entry)}</div>
                        {entry.online_platform && <div className="text-sm text-gray-500">Platform: {entry.online_platform}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {viewMode === 'batch' && (
        <div className="space-y-6">
          {batchEntries.length === 0 ? (
            <div className="bg-white rounded-lg shadow p-6 text-gray-500">No timetable entries for selected batch filters.</div>
          ) : (
            batchEntries.map(({ batch, entries: batchWiseEntries }) => (
              <div key={batch} className="bg-white rounded-lg shadow p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
                  <Layers3 className="mr-2" size={20} />
                  {batch}
                </h3>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Day</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Time</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Teacher</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Subject</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Room</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {batchWiseEntries.map(entry => (
                        <tr key={`${batch}-${entry.id}`}>
                          <td className="px-4 py-3 text-sm text-gray-900">
                            <div>{DAY_LABELS[entry.day_of_week]}</div>
                            <div className="text-xs text-gray-500">{formatDateBadge(weekDateByDay[entry.day_of_week])}</div>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-900">{formatTime(entry.start_time)} - {formatTime(entry.end_time)}</td>
                          <td className="px-4 py-3 text-sm text-gray-900">{entry.teacher_name || '-'}</td>
                          <td className="px-4 py-3 text-sm text-gray-900">{entry.subject}</td>
                          <td className="px-4 py-3 text-sm text-gray-900">
                            {getRoomModeSummary(entry)}
                          </td>
                          <td className="px-4 py-3 text-sm">
                            <div className="flex gap-2">
                              <button onClick={() => handleEdit(entry)} className="text-indigo-600 hover:text-indigo-900"><Edit size={16} /></button>
                              <button onClick={() => handleDelete(entry.id)} className="text-red-600 hover:text-red-900"><Trash2 size={16} /></button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Summary */}
      <div className="mt-6 bg-white rounded-lg shadow p-4">
        <div className="text-sm text-gray-600">
          Total Entries: <span className="font-semibold text-gray-900">{entries.length}</span>
          {selectedDay !== 'all' && (
            <> | Filtered by {selectedDay}: <span className="font-semibold text-gray-900">{filteredEntries.length}</span></>
          )}
          {selectedTeacher !== 'all' && (
            <> | Filtered by teacher: <span className="font-semibold text-gray-900">{filteredEntries.length}</span></>
          )}
        </div>
      </div>
    </div>
  );
};

export default TimetableManagement;
