import { FormEvent, useEffect, useMemo, useState } from 'react';
import { BookOpenCheck, Flame, Goal, ShieldAlert, Sparkles, TimerReset } from 'lucide-react';

import { Alert } from '@components/Alert';
import { LoadingSpinner } from '@components/LoadingSpinner';
import { useAuth } from '@/contexts/AuthProvider';
import { apiService, getRequestErrorMessage } from '@services/api';
import type { LearningGoal, StudyPlan, StudyTask } from '@types';

const cardClass = 'rounded-3xl border border-slate-200 bg-white p-5 shadow-sm';

type GoalFormState = {
  goal_type: string;
  exam_mode: string;
  title: string;
  description: string;
  target_date: string;
  target_value: string;
};

const initialGoalForm: GoalFormState = {
  goal_type: 'weekly',
  exam_mode: '',
  title: '',
  description: '',
  target_date: '',
  target_value: '',
};

export default function StudyPlanner() {
  const { authReady, sessionReady, schoolContextReady, session, user } = useAuth();
  const canRunRequests = authReady && sessionReady && schoolContextReady && !!session;
  const roleKey = String(user?.role_key || user?.role || '').toLowerCase();
  const isStudent = roleKey === 'student';
  const isParent = roleKey === 'parent';
  const isTeacherView = !isStudent && !isParent;

  const [todayPayload, setTodayPayload] = useState<Record<string, unknown> | null>(null);
  const [weekPayload, setWeekPayload] = useState<Record<string, unknown> | null>(null);
  const [recommendationsPayload, setRecommendationsPayload] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingGoal, setSavingGoal] = useState(false);
  const [error, setError] = useState('');
  const [banner, setBanner] = useState('');
  const [goalForm, setGoalForm] = useState<GoalFormState>(initialGoalForm);

  useEffect(() => {
    if (!canRunRequests) return;
    void loadPlanner();
  }, [canRunRequests]);

  const loadPlanner = async () => {
    try {
      setLoading(true);
      setError('');
      const [todayResponse, weekResponse, recommendationsResponse] = await Promise.all([
        apiService.getStudyPlannerToday(),
        apiService.getStudyPlannerWeek(),
        apiService.getStudyPlannerRecommendations(),
      ]);
      setTodayPayload((todayResponse.data || {}) as Record<string, unknown>);
      setWeekPayload((weekResponse.data || {}) as Record<string, unknown>);
      setRecommendationsPayload((recommendationsResponse.data || {}) as Record<string, unknown>);
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'Study planner load nahi ho paya.'));
    } finally {
      setLoading(false);
    }
  };

  const currentPlan = useMemo(() => {
    if (isStudent) {
      return (todayPayload as unknown as StudyPlan | null) || null;
    }
    return null;
  }, [isStudent, todayPayload]);

  const weeklyPlan = useMemo(() => {
    if (isStudent) {
      return weekPayload as Record<string, unknown> | null;
    }
    return null;
  }, [isStudent, weekPayload]);

  const recommendationItems = useMemo(() => {
    if (isStudent) {
      const raw = recommendationsPayload?.recommendations;
      return Array.isArray(raw) ? raw : [];
    }
    return [];
  }, [isStudent, recommendationsPayload]);

  const handleCreateGoal = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!goalForm.title.trim()) {
      setError('Goal title required hai.');
      return;
    }

    try {
      setSavingGoal(true);
      setError('');
      const payload = {
        goal_type: goalForm.goal_type,
        exam_mode: goalForm.exam_mode || null,
        title: goalForm.title.trim(),
        description: goalForm.description.trim() || null,
        target_date: goalForm.target_date || null,
        target_value: goalForm.target_value ? Number(goalForm.target_value) : null,
        current_value: 0,
        status: 'active',
      };
      const response = await apiService.createStudyPlannerGoal(payload);
      const createdGoal = response.data as LearningGoal;
      setBanner(`Learning goal created: ${createdGoal.title}`);
      setGoalForm(initialGoalForm);
      await loadPlanner();
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'Learning goal save nahi hua.'));
    } finally {
      setSavingGoal(false);
    }
  };

  if (loading) {
    return <LoadingSpinner message="Study planner load ho raha hai..." />;
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">AI Study Planner</h1>
          <p className="mt-1 text-sm text-slate-600">
            {isStudent
              ? 'Attendance, LMS, tests, assignments aur live classes se personalized study plan.'
              : isParent
                ? 'Child study consistency, risk alerts aur completion summary ek jagah.'
                : 'At-risk students, low engagement patterns aur weak-topic clusters for intervention.'}
          </p>
        </div>
      </div>

      {banner ? <Alert type="success" message={banner} onClose={() => setBanner('')} /> : null}
      {error ? <Alert type="error" message={error} onClose={() => setError('')} /> : null}

      {isStudent && currentPlan ? (
        <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard icon={TimerReset} label="Study Time" value={`${currentPlan.total_estimated_minutes} min`} helper="Expected today" />
            <MetricCard icon={BookOpenCheck} label="Completion" value={`${currentPlan.completion_percentage}%`} helper="Task completion" color="emerald" />
            <MetricCard icon={Flame} label="Streak" value={`${currentPlan.streak_count} days`} helper="Study consistency" color="amber" />
            <MetricCard icon={ShieldAlert} label="Risk Level" value={String(currentPlan.risk_level || 'low').toUpperCase()} helper={String(currentPlan.achievement_level || 'Starter')} color="rose" />
          </section>

          <section className={cardClass}>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Today's Study Plan</h2>
                <p className="text-sm text-slate-500">
                  Generated for {currentPlan.target_student_name || 'student'} on {currentPlan.plan_date}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {(currentPlan.badges || []).map((badge) => (
                  <span key={badge} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                    {badge}
                  </span>
                ))}
              </div>
            </div>

            {!currentPlan.tasks.length ? (
              <p className="mt-4 text-sm text-slate-600">Aaj ke liye koi pending task nahi mila. Great momentum.</p>
            ) : (
              <div className="mt-5 grid gap-4 xl:grid-cols-2">
                {currentPlan.tasks.map((task, index) => (
                  <TaskCard key={`${task.title}-${index}`} task={task} />
                ))}
              </div>
            )}
          </section>

          <section className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
            <div className={cardClass}>
              <h2 className="text-lg font-semibold text-slate-900">Weekly and Monthly Focus</h2>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">This Week</p>
                  <ul className="mt-3 space-y-2 text-sm text-slate-700">
                    {toStringList(weeklyPlan?.weekly_plan && (weeklyPlan.weekly_plan as Record<string, unknown>).weekly_focus).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">This Month</p>
                  <ul className="mt-3 space-y-2 text-sm text-slate-700">
                    {toStringList(weeklyPlan?.monthly_plan && (weeklyPlan.monthly_plan as Record<string, unknown>).monthly_focus).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            <div className={cardClass}>
              <h2 className="text-lg font-semibold text-slate-900">Recommendations</h2>
              <div className="mt-4 space-y-3">
                {recommendationItems.length ? (
                  recommendationItems.slice(0, 5).map((item, index) => {
                    const row = item as Record<string, unknown>;
                    return (
                      <div key={`${row.title || 'recommendation'}-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <p className="text-sm font-semibold text-slate-900">{String(row.title || 'Recommendation')}</p>
                        <p className="mt-1 text-sm text-slate-600">{String(row.summary || 'No summary available.')}</p>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-sm text-slate-600">Recommendations abhi generate nahi hui hain.</p>
                )}
              </div>
            </div>
          </section>

          <section className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
            <div className={cardClass}>
              <h2 className="text-lg font-semibold text-slate-900">Weak Topics and Exam Mode</h2>
              <div className="mt-4 grid gap-4 md:grid-cols-3">
                <TopicBox
                  title="Weak Topics"
                  items={toStringList((recommendationsPayload?.weak_topics as unknown) || (currentPlan.summary?.weak_topics as unknown))}
                  tone="rose"
                />
                <TopicBox
                  title="Weak Subjects"
                  items={toStringList((recommendationsPayload?.weak_subjects as unknown) || (currentPlan.summary?.weak_subjects as unknown))}
                  tone="amber"
                />
                <TopicBox
                  title="Recurring Mistakes"
                  items={toStringList((recommendationsPayload?.recurring_mistakes as unknown) || (currentPlan.summary?.recurring_mistakes as unknown))}
                  tone="sky"
                />
              </div>
            </div>

            <form onSubmit={handleCreateGoal} className={cardClass}>
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">
                  <Goal className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Learning Goal</h2>
                  <p className="text-sm text-slate-500">Daily, weekly, or exam-focused target set karein.</p>
                </div>
              </div>
              <div className="mt-4 grid gap-3">
                <select className="rounded-xl border border-slate-300 px-4 py-3 text-sm" value={goalForm.goal_type} onChange={(e) => setGoalForm({ ...goalForm, goal_type: e.target.value })}>
                  <option value="daily">Daily Goal</option>
                  <option value="weekly">Weekly Goal</option>
                  <option value="monthly">Monthly Goal</option>
                  <option value="exam">Exam Goal</option>
                </select>
                <select className="rounded-xl border border-slate-300 px-4 py-3 text-sm" value={goalForm.exam_mode} onChange={(e) => setGoalForm({ ...goalForm, exam_mode: e.target.value })}>
                  <option value="">Select Exam Mode</option>
                  <option value="neet">NEET</option>
                  <option value="jee">JEE</option>
                  <option value="board_exams">Board Exams</option>
                  <option value="custom_school_exam">Custom School Exam</option>
                </select>
                <input className="rounded-xl border border-slate-300 px-4 py-3 text-sm" placeholder="Goal Title" value={goalForm.title} onChange={(e) => setGoalForm({ ...goalForm, title: e.target.value })} />
                <textarea className="rounded-xl border border-slate-300 px-4 py-3 text-sm" rows={3} placeholder="Goal Description" value={goalForm.description} onChange={(e) => setGoalForm({ ...goalForm, description: e.target.value })} />
                <input className="rounded-xl border border-slate-300 px-4 py-3 text-sm" type="date" value={goalForm.target_date} onChange={(e) => setGoalForm({ ...goalForm, target_date: e.target.value })} />
                <input className="rounded-xl border border-slate-300 px-4 py-3 text-sm" type="number" placeholder="Target Value" value={goalForm.target_value} onChange={(e) => setGoalForm({ ...goalForm, target_value: e.target.value })} />
                <button disabled={savingGoal} className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-70">
                  <Sparkles className="h-4 w-4" />
                  {savingGoal ? 'Saving...' : 'Create Goal'}
                </button>
              </div>
            </form>
          </section>
        </>
      ) : null}

      {isParent ? (
        <ParentView payload={todayPayload} />
      ) : null}

      {isTeacherView ? (
        <TeacherView payload={todayPayload} recommendations={recommendationsPayload} />
      ) : null}
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  helper,
  color = 'blue',
}: {
  icon: typeof BookOpenCheck;
  label: string;
  value: string;
  helper: string;
  color?: 'blue' | 'emerald' | 'amber' | 'rose';
}) {
  const theme = {
    blue: 'bg-blue-100 text-blue-700',
    emerald: 'bg-emerald-100 text-emerald-700',
    amber: 'bg-amber-100 text-amber-700',
    rose: 'bg-rose-100 text-rose-700',
  }[color];

  return (
    <section className={cardClass}>
      <div className="flex items-center gap-3">
        <div className={`rounded-2xl p-3 ${theme}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm text-slate-500">{label}</p>
          <p className="text-2xl font-bold text-slate-900">{value}</p>
          <p className="text-xs text-slate-500">{helper}</p>
        </div>
      </div>
    </section>
  );
}

function TaskCard({ task }: { task: StudyTask }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{task.task_type}</p>
          <h3 className="mt-1 text-base font-semibold text-slate-900">{task.title}</h3>
        </div>
        <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700">
          P{task.priority}
        </span>
      </div>
      <p className="mt-2 text-sm text-slate-600">{task.description}</p>
      <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-500">
        {task.subject_name ? <span className="rounded-full bg-white px-3 py-1">{task.subject_name}</span> : null}
        {task.chapter_name ? <span className="rounded-full bg-white px-3 py-1">{task.chapter_name}</span> : null}
        <span className="rounded-full bg-white px-3 py-1">{task.estimated_minutes} min</span>
      </div>
    </article>
  );
}

function TopicBox({ title, items, tone }: { title: string; items: string[]; tone: 'rose' | 'amber' | 'sky' }) {
  const classes = {
    rose: 'border-rose-200 bg-rose-50 text-rose-700',
    amber: 'border-amber-200 bg-amber-50 text-amber-700',
    sky: 'border-sky-200 bg-sky-50 text-sky-700',
  }[tone];

  return (
    <div className={`rounded-2xl border p-4 ${classes}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.18em]">{title}</p>
      <ul className="mt-3 space-y-2 text-sm text-slate-700">
        {items.length ? items.map((item) => <li key={item}>{item}</li>) : <li>No signals detected yet.</li>}
      </ul>
    </div>
  );
}

function ParentView({ payload }: { payload: Record<string, unknown> | null }) {
  const children = Array.isArray(payload?.children) ? (payload?.children as Record<string, unknown>[]) : [];

  return (
    <section className={cardClass}>
      <h2 className="text-lg font-semibold text-slate-900">Parent Study View</h2>
      <p className="mt-1 text-sm text-slate-500">Study consistency, missed tasks, aur risk alerts for linked children.</p>
      {!children.length ? (
        <p className="mt-4 text-sm text-slate-600">Linked child study data available nahi hai.</p>
      ) : (
        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          {children.map((child) => (
            <article key={String(child.student_id || child.student_name)} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <h3 className="text-base font-semibold text-slate-900">{String(child.student_name || 'Student')}</h3>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <InfoCell label="Study Consistency" value={`${String(child.study_consistency || 0)} days`} />
                <InfoCell label="Completion" value={`${String(child.completion_percentage || 0)}%`} />
                <InfoCell label="Missed Tasks" value={String(child.missed_tasks || 0)} />
                <InfoCell label="Risk Alert" value={String(child.risk_alert || 'low').toUpperCase()} />
              </div>
              <div className="mt-4 rounded-xl bg-white p-3 text-sm text-slate-700">
                Weak topics: {toStringList(child.weak_topics).join(', ') || 'No weak topics flagged'}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function TeacherView({
  payload,
  recommendations,
}: {
  payload: Record<string, unknown> | null;
  recommendations: Record<string, unknown> | null;
}) {
  const atRisk = Array.isArray(payload?.at_risk_students) ? (payload?.at_risk_students as Record<string, unknown>[]) : [];
  const lowEngagement = Array.isArray(payload?.low_engagement_students) ? (payload?.low_engagement_students as Record<string, unknown>[]) : [];
  const clusters = Array.isArray(payload?.weak_topic_clusters) ? (payload?.weak_topic_clusters as Record<string, unknown>[]) : [];
  const schoolView = recommendations?.school_view as Record<string, unknown> | undefined;
  const platformView = recommendations?.platform_view as Record<string, unknown> | undefined;

  return (
    <div className="space-y-6">
      <section className="grid gap-4 xl:grid-cols-3">
        <TeacherListCard title="At-Risk Students" rows={atRisk} primaryKey="student_name" secondaryKey="risk_level" tertiaryKey="completion_percentage" />
        <TeacherListCard title="Low Engagement" rows={lowEngagement} primaryKey="student_name" secondaryKey="streak_count" tertiaryKey="completion_percentage" />
        <TeacherListCard title="Weak Topic Clusters" rows={clusters} primaryKey="topic_name" secondaryKey="student_count" />
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <AnalyticsSnapshot title="School Snapshot" payload={schoolView} />
        <AnalyticsSnapshot title="Platform Snapshot" payload={platformView} />
      </section>
    </div>
  );
}

function TeacherListCard({
  title,
  rows,
  primaryKey,
  secondaryKey,
  tertiaryKey,
}: {
  title: string;
  rows: Record<string, unknown>[];
  primaryKey: string;
  secondaryKey?: string;
  tertiaryKey?: string;
}) {
  return (
    <section className={cardClass}>
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <div className="mt-4 space-y-3">
        {rows.length ? rows.slice(0, 6).map((row) => (
          <div key={String(row[primaryKey] || Math.random())} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-900">{String(row[primaryKey] || '-')}</p>
            <p className="mt-1 text-sm text-slate-600">
              {secondaryKey ? `${secondaryKey.replace(/_/g, ' ')}: ${String(row[secondaryKey] || '-')}` : ''}
              {secondaryKey && tertiaryKey ? ' | ' : ''}
              {tertiaryKey ? `${tertiaryKey.replace(/_/g, ' ')}: ${String(row[tertiaryKey] || '-')}` : ''}
            </p>
          </div>
        )) : <p className="text-sm text-slate-600">No analytics available yet.</p>}
      </div>
    </section>
  );
}

function AnalyticsSnapshot({ title, payload }: { title: string; payload?: Record<string, unknown> }) {
  if (!payload || !Object.keys(payload).length) {
    return (
      <section className={cardClass}>
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <p className="mt-3 text-sm text-slate-600">No analytics snapshot available.</p>
      </section>
    );
  }

  return (
    <section className={cardClass}>
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {Object.entries(payload).slice(0, 8).map(([key, value]) => (
          <InfoCell key={key} label={key.replace(/_/g, ' ')} value={formatSnapshotValue(value)} />
        ))}
      </div>
    </section>
  );
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-2 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function formatSnapshotValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.slice(0, 3).map((item) => String(item)).join(', ') || 'None';
  }
  if (value && typeof value === 'object') {
    return `${Object.keys(value as Record<string, unknown>).length} fields`;
  }
  return String(value ?? 'N/A');
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean);
}
