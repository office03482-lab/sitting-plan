import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  CalendarClock,
  Link as LinkIcon,
  Loader2,
  PlayCircle,
  Radio,
  RefreshCw,
  Square,
  Upload,
  Users,
  Video,
} from 'lucide-react';

import { Alert } from '@components/Alert';
import { LoadingSpinner } from '@components/LoadingSpinner';
import { useAuth } from '@/contexts/AuthProvider';
import { apiService, getRequestErrorMessage } from '@services/api';
import type { LiveClassAttendance, LiveClassSession, TimetableView } from '@types';

type BannerState = { type: 'success' | 'error' | 'warning' | 'info'; message: string } | null;

type CreateSessionForm = {
  timetable_entry_id: string;
  session_date: string;
  provider: string;
  meeting_link: string;
  meeting_id: string;
  meeting_password: string;
  scheduled_start_at: string;
  scheduled_end_at: string;
};

type RecordingForm = {
  title: string;
  recording_url: string;
  notes_url: string;
  duration_seconds: string;
  recording_file_name?: string;
  notes_file_name?: string;
};

const initialCreateForm: CreateSessionForm = {
  timetable_entry_id: '',
  session_date: new Date().toISOString().slice(0, 10),
  provider: 'google_meet',
  meeting_link: '',
  meeting_id: '',
  meeting_password: '',
  scheduled_start_at: '',
  scheduled_end_at: '',
};

const initialRecordingForm: RecordingForm = {
  title: '',
  recording_url: '',
  notes_url: '',
  duration_seconds: '',
};

const cardClass = 'rounded-3xl border border-slate-200 bg-white p-5 shadow-sm';

function formatDateTime(value?: string | null) {
  if (!value) return 'Not set';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatDuration(seconds?: number | null) {
  const total = Number(seconds || 0);
  if (!total) return '0m';
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

function deriveParticipantLabel(session: LiveClassSession) {
  return session.timetable_entry?.class_name || 'Unassigned class';
}

export default function LiveClasses() {
  const { authReady, sessionReady, schoolContextReady, session, user } = useAuth();
  const canRunRequests = authReady && sessionReady && schoolContextReady && !!session;
  const roleKey = String(user?.role_key || user?.role || '').toLowerCase();
  const isTeacher = user?.role === 'teacher' || roleKey === 'teacher';
  const isStudent = user?.role === 'student' || roleKey === 'student';
  const isParent = roleKey === 'parent' || Boolean(user?.permissions?.includes('edupay.parent_portal'));
  const isAdmin = user?.role === 'admin' || roleKey === 'school_admin' || roleKey === 'platform_admin';
  const canManage = isTeacher || isAdmin;
  const canJoin = isStudent;
  const canViewAttendance = canManage || isParent;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sessions, setSessions] = useState<LiveClassSession[]>([]);
  const [timetableEntries, setTimetableEntries] = useState<TimetableView[]>([]);
  const [attendanceRows, setAttendanceRows] = useState<Record<string, LiveClassAttendance[]>>({});
  const [attendanceLoadingId, setAttendanceLoadingId] = useState('');
  const [recordingSessionId, setRecordingSessionId] = useState('');
  const [banner, setBanner] = useState<BannerState>(null);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [createForm, setCreateForm] = useState<CreateSessionForm>(initialCreateForm);
  const [recordingForms, setRecordingForms] = useState<Record<string, RecordingForm>>({});
  const [uploadingAssetKey, setUploadingAssetKey] = useState('');
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});

  const visibleSessions = useMemo(() => {
    if (!statusFilter) return sessions;
    return sessions.filter((item) => item.status === statusFilter);
  }, [sessions, statusFilter]);

  const loadPage = async (showRefresh = false) => {
    if (!canRunRequests) return;
    try {
      setError('');
      if (showRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      const requests: Promise<unknown>[] = [apiService.listLiveClasses()];
      if (canManage) {
        requests.push(apiService.listTimetableEntries());
      }
      const [sessionsResponse, timetableResponse] = await Promise.all(requests);
      setSessions((sessionsResponse as Awaited<ReturnType<typeof apiService.listLiveClasses>>).data || []);
      setTimetableEntries(
        canManage ? ((timetableResponse as Awaited<ReturnType<typeof apiService.listTimetableEntries>>).data || []) : [],
      );
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'Live classes load nahi ho paye.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!canRunRequests) return;
    void loadPage();
  }, [canRunRequests]);

  useEffect(() => {
    if (!canManage || !timetableEntries.length || createForm.timetable_entry_id) return;
    const defaultEntry = timetableEntries.find((item) => (item.session_mode || 'offline') !== 'offline') || timetableEntries[0];
    if (defaultEntry) {
      setCreateForm((current) => ({ ...current, timetable_entry_id: String(defaultEntry.id) }));
    }
  }, [canManage, createForm.timetable_entry_id, timetableEntries]);

  const handleCreateSession = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      setSaving(true);
      await apiService.createLiveClass({
        timetable_entry_id: createForm.timetable_entry_id,
        session_date: createForm.session_date,
        provider: createForm.provider,
        meeting_link: createForm.meeting_link || undefined,
        meeting_id: createForm.meeting_id || undefined,
        meeting_password: createForm.meeting_password || undefined,
        scheduled_start_at: createForm.scheduled_start_at || undefined,
        scheduled_end_at: createForm.scheduled_end_at || undefined,
      });
      setBanner({ type: 'success', message: 'Live class session scheduled successfully.' });
      setCreateForm(initialCreateForm);
      await loadPage(true);
    } catch (requestError) {
      setBanner({ type: 'error', message: getRequestErrorMessage(requestError, 'Live class schedule nahi ho paya.') });
    } finally {
      setSaving(false);
    }
  };

  const handleSessionAction = async (sessionId: string, action: 'start' | 'end' | 'join' | 'leave') => {
    try {
      setSaving(true);
      if (action === 'start') {
        await apiService.startLiveClass(sessionId);
      } else if (action === 'end') {
        await apiService.endLiveClass(sessionId);
      } else if (action === 'join') {
        await apiService.joinLiveClass(sessionId);
      } else {
        await apiService.leaveLiveClass(sessionId);
      }
      const labelMap = {
        start: 'Live class started.',
        end: 'Live class ended.',
        join: 'Joined live class successfully.',
        leave: 'Left live class and attendance updated.',
      };
      setBanner({ type: 'success', message: labelMap[action] });
      await loadPage(true);
      if (attendanceRows[sessionId]) {
        await handleLoadAttendance(sessionId);
      }
    } catch (requestError) {
      setBanner({ type: 'error', message: getRequestErrorMessage(requestError, `Unable to ${action} live class.`) });
    } finally {
      setSaving(false);
    }
  };

  const handleLoadAttendance = async (sessionId: string) => {
    try {
      setAttendanceLoadingId(sessionId);
      const response = await apiService.getLiveClassAttendance(sessionId);
      setAttendanceRows((current) => ({ ...current, [sessionId]: response.data || [] }));
    } catch (requestError) {
      setBanner({ type: 'error', message: getRequestErrorMessage(requestError, 'Attendance load nahi ho payi.') });
    } finally {
      setAttendanceLoadingId('');
    }
  };

  const handleRecordingUpload = async (sessionId: string) => {
    const form = recordingForms[sessionId] || initialRecordingForm;
    try {
      setSaving(true);
      await apiService.uploadLiveClassRecording(sessionId, {
        title: form.title || 'Live class recording',
        recording_url: form.recording_url,
        notes_url: form.notes_url || undefined,
        duration_seconds: Number(form.duration_seconds || 0),
      });
      setBanner({ type: 'success', message: 'Recording and notes linked successfully.' });
      setRecordingForms((current) => ({ ...current, [sessionId]: initialRecordingForm }));
      setRecordingSessionId('');
      await loadPage(true);
    } catch (requestError) {
      setBanner({ type: 'error', message: getRequestErrorMessage(requestError, 'Recording upload nahi ho paayi.') });
    } finally {
      setSaving(false);
    }
  };

  const trackUploadProgress = (key: string) => (progressEvent: { loaded?: number; total?: number }) => {
    const total = Number(progressEvent.total || 0);
    const loaded = Number(progressEvent.loaded || 0);
    if (!total) return;
    setUploadProgress((current) => ({ ...current, [key]: Math.round((loaded / total) * 100) }));
  };

  const handleRecordingAssetUpload = async (sessionId: string, kind: 'recording' | 'notes', file: File) => {
    const key = `${sessionId}-${kind}`;
    try {
      setUploadingAssetKey(key);
      if (kind === 'recording') {
        const response = await apiService.uploadVideo(file, {
          purpose: 'live_class_recording',
          onUploadProgress: trackUploadProgress(key),
        });
        updateRecordingForm(sessionId, { recording_url: response.data.url, recording_file_name: response.data.file_name });
        setBanner({ type: 'success', message: 'Recording uploaded successfully.' });
      } else {
        const response = await apiService.uploadDocument(file, {
          purpose: 'notes',
          onUploadProgress: trackUploadProgress(key),
        });
        updateRecordingForm(sessionId, { notes_url: response.data.url, notes_file_name: response.data.file_name });
        setBanner({ type: 'success', message: 'Notes uploaded successfully.' });
      }
    } catch (requestError) {
      setBanner({ type: 'error', message: getRequestErrorMessage(requestError, 'File upload nahi ho payi.') });
    } finally {
      setUploadingAssetKey('');
    }
  };

  const updateRecordingForm = (sessionId: string, patch: Partial<RecordingForm>) => {
    setRecordingForms((current) => ({
      ...current,
      [sessionId]: {
        ...(current[sessionId] || initialRecordingForm),
        ...patch,
      },
    }));
  };

  if (loading) {
    return <LoadingSpinner message="Live classes load ho rahi hain..." />;
  }

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Live Classes</h1>
          <p className="mt-1 text-sm text-slate-600">
            Timetable-linked online sessions, attendance automation, recordings, and role-based classroom actions.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
          >
            <option value="">All statuses</option>
            <option value="scheduled">Scheduled</option>
            <option value="live">Live</option>
            <option value="ended">Ended</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <button
            type="button"
            onClick={() => void loadPage(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-70"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {banner ? <Alert type={banner.type} message={banner.message} onClose={() => setBanner(null)} /> : null}
      {error ? <Alert type="error" message={error} onClose={() => setError('')} /> : null}

      <div className="mb-6 grid gap-4 lg:grid-cols-4">
        <section className={cardClass}>
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-blue-100 p-3 text-blue-700">
              <CalendarClock className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm text-slate-500">Total Sessions</p>
              <p className="text-2xl font-bold text-slate-900">{sessions.length}</p>
            </div>
          </div>
        </section>
        <section className={cardClass}>
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-emerald-100 p-3 text-emerald-700">
              <Radio className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm text-slate-500">Live Now</p>
              <p className="text-2xl font-bold text-slate-900">{sessions.filter((item) => item.status === 'live').length}</p>
            </div>
          </div>
        </section>
        <section className={cardClass}>
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-amber-100 p-3 text-amber-700">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm text-slate-500">Attendance Avg</p>
              <p className="text-2xl font-bold text-slate-900">
                {sessions.length
                  ? `${Math.round(sessions.reduce((sum, item) => sum + Number(item.attendance_rate || 0), 0) / sessions.length)}%`
                  : '0%'}
              </p>
            </div>
          </div>
        </section>
        <section className={cardClass}>
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-violet-100 p-3 text-violet-700">
              <Video className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm text-slate-500">Recordings</p>
              <p className="text-2xl font-bold text-slate-900">{sessions.filter((item) => item.recording_url).length}</p>
            </div>
          </div>
        </section>
      </div>

      {canManage ? (
        <section className={`${cardClass} mb-6`}>
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-slate-900">Schedule From Timetable</h2>
            <p className="text-sm text-slate-600">
              Reuses existing timetable entries. No duplicate scheduling system is created here.
            </p>
          </div>
          <form onSubmit={handleCreateSession} className="grid gap-3 xl:grid-cols-4">
            <select
              value={createForm.timetable_entry_id}
              onChange={(event) => setCreateForm((current) => ({ ...current, timetable_entry_id: event.target.value }))}
              className="rounded-xl border border-slate-300 px-4 py-3 text-sm"
              required
            >
              <option value="">Select timetable entry</option>
              {timetableEntries.map((item) => (
                <option key={item.id} value={String(item.id)}>
                  {item.class_name} | {item.subject} | {item.day_of_week} {item.start_time}-{item.end_time}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={createForm.session_date}
              onChange={(event) => setCreateForm((current) => ({ ...current, session_date: event.target.value }))}
              className="rounded-xl border border-slate-300 px-4 py-3 text-sm"
              required
            />
            <select
              value={createForm.provider}
              onChange={(event) => setCreateForm((current) => ({ ...current, provider: event.target.value }))}
              className="rounded-xl border border-slate-300 px-4 py-3 text-sm"
            >
              <option value="google_meet">Google Meet</option>
              <option value="zoom">Zoom</option>
              <option value="microsoft_teams">Microsoft Teams</option>
              <option value="jitsi_meet">Jitsi Meet</option>
            </select>
            <input
              type="url"
              placeholder="Meeting link"
              value={createForm.meeting_link}
              onChange={(event) => setCreateForm((current) => ({ ...current, meeting_link: event.target.value }))}
              className="rounded-xl border border-slate-300 px-4 py-3 text-sm"
            />
            <input
              type="text"
              placeholder="Meeting ID"
              value={createForm.meeting_id}
              onChange={(event) => setCreateForm((current) => ({ ...current, meeting_id: event.target.value }))}
              className="rounded-xl border border-slate-300 px-4 py-3 text-sm"
            />
            <input
              type="text"
              placeholder="Meeting password"
              value={createForm.meeting_password}
              onChange={(event) => setCreateForm((current) => ({ ...current, meeting_password: event.target.value }))}
              className="rounded-xl border border-slate-300 px-4 py-3 text-sm"
            />
            <input
              type="datetime-local"
              value={createForm.scheduled_start_at}
              onChange={(event) => setCreateForm((current) => ({ ...current, scheduled_start_at: event.target.value }))}
              className="rounded-xl border border-slate-300 px-4 py-3 text-sm"
            />
            <input
              type="datetime-local"
              value={createForm.scheduled_end_at}
              onChange={(event) => setCreateForm((current) => ({ ...current, scheduled_end_at: event.target.value }))}
              className="rounded-xl border border-slate-300 px-4 py-3 text-sm"
            />
            <div className="xl:col-span-4">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg bg-[#1e3a8a] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1b3277] disabled:opacity-70"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
                Schedule Live Class
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {!visibleSessions.length ? (
        <section className={`${cardClass} text-center`}>
          <h2 className="text-lg font-semibold text-slate-900">No live classes found</h2>
          <p className="mt-2 text-sm text-slate-600">
            {canManage
              ? 'Create a live session from the timetable to make join links, attendance, and recordings available.'
              : 'Assigned live classes will appear here once the school schedules them.'}
          </p>
        </section>
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          {visibleSessions.map((sessionItem) => {
            const attendance = attendanceRows[sessionItem.id] || [];
            const recordingForm = recordingForms[sessionItem.id] || initialRecordingForm;
            return (
              <article key={sessionItem.id} className={cardClass}>
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold text-slate-900">{deriveParticipantLabel(sessionItem)}</h2>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold capitalize text-slate-600">
                        {sessionItem.status}
                      </span>
                      <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold capitalize text-blue-700">
                        {sessionItem.provider.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-slate-600">
                      {sessionItem.timetable_entry?.subject || 'Live class'} on {sessionItem.session_date}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-right">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Watch Time</p>
                    <p className="text-lg font-bold text-slate-900">{formatDuration(sessionItem.average_watch_time_seconds)}</p>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Scheduled</p>
                    <p className="mt-2 text-sm font-semibold text-slate-900">{formatDateTime(sessionItem.scheduled_start_at)}</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Actual Start</p>
                    <p className="mt-2 text-sm font-semibold text-slate-900">{formatDateTime(sessionItem.actual_start_at)}</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Attendance</p>
                    <p className="mt-2 text-sm font-semibold text-slate-900">{Math.round(Number(sessionItem.attendance_rate || 0))}%</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Participants</p>
                    <p className="mt-2 text-sm font-semibold text-slate-900">{sessionItem.participation_count}</p>
                  </div>
                </div>

                <div className="mt-4 space-y-2 text-sm text-slate-600">
                  {sessionItem.meeting_link ? (
                    <div className="flex items-center gap-2">
                      <LinkIcon className="h-4 w-4 text-slate-400" />
                      <a
                        href={sessionItem.meeting_link}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-blue-700 hover:underline"
                      >
                        Join meeting link
                      </a>
                    </div>
                  ) : null}
                  {sessionItem.recording_url ? (
                    <div className="flex items-center gap-2">
                      <Video className="h-4 w-4 text-slate-400" />
                      <a
                        href={sessionItem.recording_url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-emerald-700 hover:underline"
                      >
                        View recording
                      </a>
                    </div>
                  ) : null}
                  {sessionItem.notes_url ? (
                    <div className="flex items-center gap-2">
                      <LinkIcon className="h-4 w-4 text-slate-400" />
                      <a
                        href={sessionItem.notes_url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-violet-700 hover:underline"
                      >
                        Download notes
                      </a>
                    </div>
                  ) : null}
                </div>

                <div className="mt-5 flex flex-wrap gap-3">
                  {canManage && sessionItem.status === 'scheduled' ? (
                    <button
                      type="button"
                      onClick={() => void handleSessionAction(sessionItem.id, 'start')}
                      disabled={saving}
                      className="inline-flex items-center gap-2 rounded-lg bg-[#1e3a8a] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1b3277] disabled:opacity-70"
                    >
                      <PlayCircle className="h-4 w-4" />
                      Start Class
                    </button>
                  ) : null}
                  {canManage && sessionItem.status === 'live' ? (
                    <button
                      type="button"
                      onClick={() => void handleSessionAction(sessionItem.id, 'end')}
                      disabled={saving}
                      className="inline-flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-70"
                    >
                      <Square className="h-4 w-4" />
                      End Class
                    </button>
                  ) : null}
                  {canJoin && sessionItem.status === 'live' ? (
                    <button
                      type="button"
                      onClick={() => void handleSessionAction(sessionItem.id, 'join')}
                      disabled={saving}
                      className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-70"
                    >
                      <Radio className="h-4 w-4" />
                      Join Class
                    </button>
                  ) : null}
                  {canJoin && (sessionItem.status === 'live' || sessionItem.status === 'ended') ? (
                    <button
                      type="button"
                      onClick={() => void handleSessionAction(sessionItem.id, 'leave')}
                      disabled={saving}
                      className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-70"
                    >
                      <Square className="h-4 w-4" />
                      Leave Class
                    </button>
                  ) : null}
                  {canViewAttendance ? (
                    <button
                      type="button"
                      onClick={() => void handleLoadAttendance(sessionItem.id)}
                      disabled={attendanceLoadingId === sessionItem.id}
                      className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-70"
                    >
                      {attendanceLoadingId === sessionItem.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
                      Attendance
                    </button>
                  ) : null}
                  {canManage ? (
                    <button
                      type="button"
                      onClick={() => setRecordingSessionId((current) => (current === sessionItem.id ? '' : sessionItem.id))}
                      className="inline-flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-4 py-2 text-sm font-semibold text-violet-700 hover:bg-violet-100"
                    >
                      <Upload className="h-4 w-4" />
                      {sessionItem.recording_url ? 'Update Recording' : 'Upload Recording'}
                    </button>
                  ) : null}
                </div>

                {recordingSessionId === sessionItem.id ? (
                  <div className="mt-5 rounded-2xl border border-violet-100 bg-violet-50/60 p-4">
                    <h3 className="text-sm font-semibold text-slate-900">Recording + Notes</h3>
                    <div className="mt-3 grid gap-3 lg:grid-cols-2">
                      <input
                        type="text"
                        placeholder="Recording title"
                        value={recordingForm.title}
                        onChange={(event) => updateRecordingForm(sessionItem.id, { title: event.target.value })}
                        className="rounded-xl border border-slate-300 px-4 py-3 text-sm"
                      />
                      <div className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm">
                        <label className="block text-sm font-semibold text-slate-700">Upload Recording</label>
                        <input
                          type="file"
                          accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.m4v"
                          className="mt-2 block w-full text-sm"
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            event.target.value = '';
                            if (file) void handleRecordingAssetUpload(sessionItem.id, 'recording', file);
                          }}
                        />
                        {recordingForm.recording_url ? <a href={recordingForm.recording_url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm font-semibold text-violet-700 hover:text-violet-900">Preview recording</a> : null}
                        {uploadingAssetKey === `${sessionItem.id}-recording` ? <p className="mt-2 text-xs text-slate-500">Uploading... {uploadProgress[`${sessionItem.id}-recording`] || 0}%</p> : null}
                      </div>
                      <div className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm">
                        <label className="block text-sm font-semibold text-slate-700">Upload Notes</label>
                        <input
                          type="file"
                          accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                          className="mt-2 block w-full text-sm"
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            event.target.value = '';
                            if (file) void handleRecordingAssetUpload(sessionItem.id, 'notes', file);
                          }}
                        />
                        {recordingForm.notes_url ? <a href={recordingForm.notes_url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm font-semibold text-violet-700 hover:text-violet-900">Preview notes</a> : null}
                        {uploadingAssetKey === `${sessionItem.id}-notes` ? <p className="mt-2 text-xs text-slate-500">Uploading... {uploadProgress[`${sessionItem.id}-notes`] || 0}%</p> : null}
                      </div>
                      <input
                        type="number"
                        placeholder="Duration in seconds"
                        value={recordingForm.duration_seconds}
                        onChange={(event) => updateRecordingForm(sessionItem.id, { duration_seconds: event.target.value })}
                        className="rounded-xl border border-slate-300 px-4 py-3 text-sm"
                      />
                    </div>
                    <div className="mt-3">
                      <button
                        type="button"
                        onClick={() => void handleRecordingUpload(sessionItem.id)}
                        disabled={saving}
                        className="inline-flex items-center gap-2 rounded-lg bg-violet-700 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-800 disabled:opacity-70"
                      >
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                        Save Recording
                      </button>
                    </div>
                  </div>
                ) : null}

                {attendance.length ? (
                  <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-slate-900">Attendance Snapshot</h3>
                      <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{attendance.length} rows</span>
                    </div>
                    <div className="space-y-3">
                      {attendance.map((row) => (
                        <div key={row.id} className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 md:flex-row md:items-center md:justify-between">
                          <div>
                            <p className="font-semibold text-slate-900">{row.participant_name || 'Participant'}</p>
                            <p className="text-xs text-slate-500">
                              Joined {formatDateTime(row.join_timestamp)} | Left {formatDateTime(row.leave_timestamp)}
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-3 text-sm">
                            <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold capitalize text-slate-700">{row.attendance_status}</span>
                            <span className="font-semibold text-slate-900">{Math.round(row.attendance_percentage)}%</span>
                            <span className="text-slate-600">{formatDuration(row.total_duration_seconds)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
