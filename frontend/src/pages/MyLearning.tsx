import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { Alert } from '@components/Alert';
import { LoadingSpinner } from '@components/LoadingSpinner';
import { useAuth, canPreviewStudentPortal } from '@/contexts/AuthProvider';
import { apiService, getRequestErrorMessage } from '@services/api';
import type { LmsDashboardCourseSummary, LmsProgressDashboard, LmsRevisionTrackerItem } from '@types';

const cardClass = 'rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm';

const formatDate = (value?: string | null) => {
  if (!value) return 'Not scheduled';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Not scheduled';
  return parsed.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const statusButtonClass = (active: boolean) =>
  active
    ? 'rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white'
    : 'rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50';

function MetricCard({ label, value, helper }: { label: string; value: string; helper: string }) {
  return (
    <div className={cardClass}>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-3 text-3xl font-bold text-slate-900">{value}</p>
      <p className="mt-2 text-sm text-slate-600">{helper}</p>
    </div>
  );
}

function TopicBucket({ title, items, tone }: { title: string; items: string[]; tone: string }) {
  const toneClass =
    tone === 'weak'
      ? 'bg-rose-50 text-rose-700 border-rose-200'
      : tone === 'strong'
        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
        : 'bg-amber-50 text-amber-700 border-amber-200';
  return (
    <div className={cardClass}>
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {items.length ? (
          items.map((item) => (
            <span key={`${title}-${item}`} className={`rounded-full border px-3 py-1 text-xs font-semibold ${toneClass}`}>
              {item}
            </span>
          ))
        ) : (
          <p className="text-sm text-slate-500">No topics detected yet.</p>
        )}
      </div>
    </div>
  );
}

function PreviewBanner({ studentName, onExit }: { studentName: string; onExit: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
      <p className="text-sm font-semibold text-amber-900">
        Previewing as student: <span className="font-bold">{studentName || 'Student'}</span>
        <span className="ml-2 font-normal text-amber-700">(read-only admin view — changes are disabled)</span>
      </p>
      <button
        type="button"
        onClick={onExit}
        className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100"
      >
        Exit Preview
      </button>
    </div>
  );
}

export default function MyLearning() {
  const { authReady, sessionReady, schoolContextReady, session, user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const canRunRequests = authReady && sessionReady && schoolContextReady && !!session;

  const previewStudentId = searchParams.get('preview')?.trim() || '';
  const isAdminPreview = Boolean(previewStudentId) && canPreviewStudentPortal(user);

  const [dashboard, setDashboard] = useState<LmsProgressDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatingTopicKey, setUpdatingTopicKey] = useState('');

  useEffect(() => {
    if (!canRunRequests) return;
    void loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRunRequests, previewStudentId]);

  const isParentView = dashboard?.viewer_mode === 'parent' || user?.role_key === 'parent';
  const studentDashboard = dashboard?.student_dashboard || null;
  const coursesById = useMemo(() => {
    const mapped = new Map<string, string>();
    for (const item of dashboard?.enrolled_courses || []) {
      mapped.set(item.id, item.title);
    }
    return mapped;
  }, [dashboard?.enrolled_courses]);

  const loadDashboard = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await apiService.getLmsProgress(
        previewStudentId ? { child_student_id: previewStudentId } : {},
      );
      setDashboard(response.data);
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'My Learning dashboard load nahi hua.'));
    } finally {
      setLoading(false);
    }
  };

  const handleRevisionUpdate = async (
    item: LmsRevisionTrackerItem,
    status: 'not_started' | 'in_progress' | 'completed',
  ) => {
    try {
      setUpdatingTopicKey(item.topic_key);
      await apiService.updateLmsRevisionTracker({
        topic_key: item.topic_key,
        topic_name: item.topic_name,
        chapter_name: item.chapter_name || undefined,
        subject_name: item.subject_name || undefined,
        course_id: item.course_id || undefined,
        course_title: item.course_title || undefined,
        status,
        metadata: item.metadata || {},
      });
      await loadDashboard();
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'Revision tracker update nahi hua.'));
    } finally {
      setUpdatingTopicKey('');
    }
  };

  if (loading) {
    return <LoadingSpinner message="My Learning load ho raha hai..." />;
  }

  if (isParentView) {
    const childDashboards = dashboard?.child_dashboards || [];
    return (
      <div className="space-y-6 p-4 md:p-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">My Learning</h1>
          <p className="mt-1 text-sm text-slate-600">Parent view for overall progress, attendance, pending work, and upcoming tests.</p>
        </div>

        {error ? <Alert type="error" message={error} onClose={() => setError('')} /> : null}

        {!childDashboards.length ? (
          <section className={`${cardClass} text-center`}>
            <h2 className="text-lg font-semibold text-slate-900">No linked student progress found</h2>
            <p className="mt-2 text-sm text-slate-600">Jaise hi student LMS aur tests use karega, progress yahan visible ho jayegi.</p>
          </section>
        ) : (
          <>
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                label="Children"
                value={String(childDashboards.length)}
                helper="Linked students visible in parent view"
              />
              <MetricCard
                label="Avg Progress"
                value={`${Math.round(childDashboards.reduce((sum, item) => sum + item.overall_learning_score, 0) / Math.max(childDashboards.length, 1))}%`}
                helper="Average learning score across linked students"
              />
              <MetricCard
                label="Pending Assignments"
                value={String(childDashboards.reduce((sum, item) => sum + item.assignments_pending, 0))}
                helper="Assignments still waiting for submission"
              />
              <MetricCard
                label="Upcoming Tests"
                value={String(childDashboards.reduce((sum, item) => sum + item.upcoming_tests_count, 0))}
                helper="Scheduled tests approaching soon"
              />
            </section>

            <section className="grid gap-5 xl:grid-cols-2">
              {childDashboards.map((child) => (
                <article key={child.student_id} className={cardClass}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-lg font-semibold text-slate-900">{child.student_name}</h2>
                      <p className="mt-1 text-sm text-slate-600">Clean parent snapshot with progress, attendance, and deadlines.</p>
                    </div>
                    <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white">
                      {Math.round(child.overall_learning_score)}%
                    </span>
                  </div>
                  <div className="mt-5 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl bg-slate-50 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Attendance</p>
                      <p className="mt-2 text-2xl font-bold text-slate-900">{Math.round(child.attendance_percentage)}%</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Upcoming Tests</p>
                      <p className="mt-2 text-2xl font-bold text-slate-900">{child.upcoming_tests_count}</p>
                    </div>
                    <div className="rounded-2xl bg-rose-50 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-600">Pending Assignments</p>
                      <p className="mt-2 text-2xl font-bold text-rose-700">{child.assignments_pending}</p>
                    </div>
                    <div className="rounded-2xl bg-emerald-50 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-600">Graded Work</p>
                      <p className="mt-2 text-2xl font-bold text-emerald-700">{child.assignments_graded}</p>
                    </div>
                  </div>
                  <p className="mt-4 text-sm text-slate-500">Last activity: {formatDate(child.last_activity)}</p>
                </article>
              ))}
            </section>
          </>
        )}
      </div>
    );
  }

  if (!studentDashboard) {
    return (
      <div className="space-y-6 p-4 md:p-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">My Learning</h1>
          <p className="mt-1 text-sm text-slate-600">Student success center will appear here once you start learning activity.</p>
        </div>
        {isAdminPreview ? <PreviewBanner studentName="" onExit={() => navigate('/students')} /> : null}
        {error ? <Alert type="error" message={error} onClose={() => setError('')} /> : null}
        <section className={`${cardClass} text-center`}>
          <h2 className="text-lg font-semibold text-slate-900">No learning activity yet</h2>
          <p className="mt-2 text-sm text-slate-600">Course join karo, lessons watch karo, aur tests attempt karo to dashboard populate ho jaye.</p>
        </section>
      </div>
    );
  }

  const assignmentStatus = studentDashboard.assignment_status;
  const tests = studentDashboard.test_summary;

  return (
    <div className="space-y-6 p-4 md:p-6">
      {isAdminPreview ? (
        <PreviewBanner studentName={studentDashboard.student_name} onExit={() => navigate('/students')} />
      ) : null}
      <div className="rounded-[2rem] border border-slate-200 bg-[linear-gradient(135deg,_#0f172a_0%,_#1e293b_55%,_#334155_100%)] p-6 text-white shadow-lg">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-300">Student Success Center</p>
            <h1 className="mt-3 text-3xl font-bold">{studentDashboard.student_name}</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-300">
              Course completion, assignment health, upcoming tests, weak topics, and today's action plan in one clean view.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-3xl bg-white/10 p-4 backdrop-blur">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-300">Learning Score</p>
              <p className="mt-2 text-4xl font-bold">{Math.round(studentDashboard.overall_learning_score)}%</p>
            </div>
            <div className="rounded-3xl bg-white/10 p-4 backdrop-blur">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-300">Attendance</p>
              <p className="mt-2 text-4xl font-bold">{Math.round(studentDashboard.attendance_percentage)}%</p>
            </div>
          </div>
        </div>
      </div>

      {error ? <Alert type="error" message={error} onClose={() => setError('')} /> : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Tests Taken" value={String(tests.tests_taken)} helper="Completed online tests so far" />
        <MetricCard label="Average Score" value={`${Math.round(tests.average_score)}%`} helper="Average across attempted tests" />
        <MetricCard label="Highest Score" value={`${Math.round(tests.highest_score)}%`} helper="Best test performance recorded" />
        <MetricCard
          label="Pending Work"
          value={String(assignmentStatus.pending)}
          helper="Assignments still waiting for submission"
        />
      </section>

      {!studentDashboard.course_summaries.length ? (
        <section className={`${cardClass} text-center`}>
          <h2 className="text-lg font-semibold text-slate-900">No enrolled courses found</h2>
          <p className="mt-2 text-sm text-slate-600">Jab batch ke liye course publish hoga, success dashboard yahan start ho jayega.</p>
        </section>
      ) : (
        <section className="grid gap-5 xl:grid-cols-2">
          {studentDashboard.course_summaries.map((course: LmsDashboardCourseSummary) => (
            <article key={course.course_id} className={cardClass}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{course.course_title || coursesById.get(course.course_id) || 'Course'}</h2>
                  <p className="mt-1 text-sm text-slate-500">Last activity: {formatDate(course.last_activity)}</p>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                  {Math.round(course.progress_percentage)}%
                </span>
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-200">
                <div className="h-full rounded-full bg-slate-900" style={{ width: `${Math.max(Math.min(course.progress_percentage, 100), 0)}%` }} />
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Videos</p>
                  <p className="mt-2 text-xl font-bold text-slate-900">{course.videos_watched}</p>
                  <p className="text-sm text-slate-500">{course.videos_remaining} remaining</p>
                </div>
                <div className="rounded-2xl bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Assignments</p>
                  <p className="mt-2 text-xl font-bold text-slate-900">{course.assignments_submitted}</p>
                  <p className="text-sm text-slate-500">of {course.assignments_total} submitted</p>
                </div>
              </div>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link to={`/course/${course.course_id}`} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                  Open Course
                </Link>
              </div>
            </article>
          ))}
        </section>
      )}

      <section className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="grid gap-5">
          <div className={cardClass}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Assignments</h2>
                <p className="mt-1 text-sm text-slate-600">Stay on top of what is pending, submitted, and graded.</p>
              </div>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl bg-rose-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-600">Pending</p>
                <p className="mt-2 text-2xl font-bold text-rose-700">{assignmentStatus.pending}</p>
              </div>
              <div className="rounded-2xl bg-amber-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-600">Submitted</p>
                <p className="mt-2 text-2xl font-bold text-amber-700">{assignmentStatus.submitted}</p>
              </div>
              <div className="rounded-2xl bg-emerald-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-600">Graded</p>
                <p className="mt-2 text-2xl font-bold text-emerald-700">{assignmentStatus.graded + assignmentStatus.returned}</p>
              </div>
            </div>
          </div>

          <div className={cardClass}>
            <h2 className="text-lg font-semibold text-slate-900">Revision Tracker</h2>
            <p className="mt-1 text-sm text-slate-600">Mark each topic so your revision plan reflects what is done and what still needs attention.</p>
            <div className="mt-5 space-y-3">
              {studentDashboard.revision_tracker.length ? (
                studentDashboard.revision_tracker.map((item) => (
                  <div key={item.topic_key} className="rounded-2xl border border-slate-200 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{item.topic_name}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {[item.subject_name, item.chapter_name, item.course_title].filter(Boolean).join(' • ') || 'Revision topic'}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {isAdminPreview ? (
                          <span className="rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-500">
                            Read-only preview
                          </span>
                        ) : (
                          <>
                            <button
                              type="button"
                              disabled={updatingTopicKey === item.topic_key}
                              onClick={() => void handleRevisionUpdate(item, 'not_started')}
                              className={statusButtonClass(item.status === 'not_started')}
                            >
                              Not Started
                            </button>
                            <button
                              type="button"
                              disabled={updatingTopicKey === item.topic_key}
                              onClick={() => void handleRevisionUpdate(item, 'in_progress')}
                              className={statusButtonClass(item.status === 'in_progress')}
                            >
                              In Progress
                            </button>
                            <button
                              type="button"
                              disabled={updatingTopicKey === item.topic_key}
                              onClick={() => void handleRevisionUpdate(item, 'completed')}
                              className={statusButtonClass(item.status === 'completed')}
                            >
                              Completed
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-500">Revision topics will appear after you attempt tests or start course progress.</p>
              )}
            </div>
          </div>
        </div>

        <div className="grid gap-5">
          <div className={cardClass}>
            <h2 className="text-lg font-semibold text-slate-900">Upcoming Tests</h2>
            <div className="mt-4 space-y-3">
              {studentDashboard.upcoming_tests.length ? (
                studentDashboard.upcoming_tests.map((test) => (
                  <div key={test.test_id} className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-sm font-semibold text-slate-900">{test.title}</p>
                    <p className="mt-1 text-xs text-slate-500">{[test.subject_name, test.topic].filter(Boolean).join(' • ') || 'Scheduled test'}</p>
                    <p className="mt-2 text-sm text-slate-700">{formatDate(test.starts_at)}</p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-500">No upcoming tests scheduled right now.</p>
              )}
            </div>
          </div>

          <div className={cardClass}>
            <h2 className="text-lg font-semibold text-slate-900">Today's Tasks</h2>
            <div className="mt-4 space-y-3">
              {(studentDashboard.today_tasks.length ? studentDashboard.today_tasks : dashboard?.ai_insights.revision_suggestions || []).map((task) => (
                <div key={task} className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
                  {task}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-3">
        <TopicBucket title="Weak Topics" items={studentDashboard.topic_analysis.weak} tone="weak" />
        <TopicBucket title="Medium Topics" items={studentDashboard.topic_analysis.medium} tone="medium" />
        <TopicBucket title="Strong Topics" items={studentDashboard.topic_analysis.strong} tone="strong" />
      </section>
    </div>
  );
}
