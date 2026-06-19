import { FormEvent, useEffect, useMemo, useState } from 'react';
import { BookOpenCheck, CalendarClock, SearchCheck, Sparkles, Target } from 'lucide-react';

import { Alert } from '@components/Alert';
import { LoadingSpinner } from '@components/LoadingSpinner';
import { apiService, getRequestErrorMessage } from '@services/api';
import { useAuth } from '@/contexts/AuthProvider';
import type { AiTutorResponse, DoubtSolverResponse, LmsProgressDashboard, StudyPlan, StudyPlannerWeek } from '@types';

const cardClass = 'rounded-3xl border border-slate-200 bg-white p-5 shadow-sm';

type AssistantTab = 'doubt' | 'explain' | 'mcqs' | 'plan' | 'weak-topics';

export default function AiStudyAssistantPage() {
  const { authReady, sessionReady, schoolContextReady, session } = useAuth();
  const canRunRequests = authReady && sessionReady && schoolContextReady && !!session;

  const [tab, setTab] = useState<AssistantTab>('doubt');
  const [topic, setTopic] = useState('');
  const [question, setQuestion] = useState('');
  const [ocrText, setOcrText] = useState('');
  const [dashboard, setDashboard] = useState<LmsProgressDashboard | null>(null);
  const [todayPlan, setTodayPlan] = useState<StudyPlan | null>(null);
  const [weekPlan, setWeekPlan] = useState<StudyPlannerWeek | null>(null);
  const [recommendations, setRecommendations] = useState<Record<string, unknown> | null>(null);
  const [tutorResult, setTutorResult] = useState<AiTutorResponse | null>(null);
  const [doubtResult, setDoubtResult] = useState<DoubtSolverResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [bootstrapLoading, setBootstrapLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!canRunRequests) return;
    void loadAssistantData();
  }, [canRunRequests]);

  const weakTopics = useMemo(() => {
    const plannerWeak = Array.isArray(recommendations?.weak_topics) ? recommendations?.weak_topics as string[] : [];
    const dashboardWeak = dashboard?.student_dashboard?.topic_analysis.weak || dashboard?.ai_insights.weak_chapters || [];
    return Array.from(new Set([...plannerWeak, ...dashboardWeak].filter(Boolean)));
  }, [dashboard, recommendations]);

  const weeklyFocus = useMemo(() => {
    const plan = weekPlan?.weekly_plan as { weekly_focus?: unknown } | undefined;
    return Array.isArray(plan?.weekly_focus) ? (plan?.weekly_focus as string[]) : [];
  }, [weekPlan]);

  const loadAssistantData = async () => {
    try {
      setBootstrapLoading(true);
      setError('');
      const [progressRes, todayRes, weekRes, recommendationRes] = await Promise.all([
        apiService.getLmsProgress(),
        apiService.getStudyPlannerToday(),
        apiService.getStudyPlannerWeek(),
        apiService.getStudyPlannerRecommendations(),
      ]);
      setDashboard(progressRes.data);
      setTodayPlan(todayRes.data as unknown as StudyPlan);
      setWeekPlan(weekRes.data as StudyPlannerWeek);
      setRecommendations(recommendationRes.data as Record<string, unknown>);
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'AI Study Assistant load nahi hua.'));
    } finally {
      setBootstrapLoading(false);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!topic.trim() && !question.trim() && !ocrText.trim()) {
      setError('Topic ya question dena zaroori hai.');
      return;
    }
    try {
      setLoading(true);
      setError('');
      setTutorResult(null);
      setDoubtResult(null);
      if (tab === 'doubt') {
        const response = await apiService.solveTextDoubt({
          question: question.trim() || undefined,
          extracted_text: ocrText.trim() || undefined,
          metadata: { source: 'ai_study_assistant' },
        });
        setDoubtResult(response.data);
      } else if (tab === 'explain') {
        const response = await apiService.aiTutorExplain({
          topic: topic.trim() || undefined,
          question: question.trim() || undefined,
        });
        setTutorResult(response.data);
      } else if (tab === 'mcqs') {
        const response = await apiService.aiTutorPractice({
          topic: topic.trim() || undefined,
          question: question.trim() || undefined,
        });
        setTutorResult(response.data);
      } else {
        const response = await apiService.aiTutorRevision({
          topic: topic.trim() || weakTopics[0] || undefined,
          question: question.trim() || undefined,
        });
        setTutorResult(response.data);
      }
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'AI Study Assistant response generate nahi hua.'));
    } finally {
      setLoading(false);
    }
  };

  if (bootstrapLoading) {
    return <LoadingSpinner message="AI Study Assistant load ho raha hai..." />;
  }

  const modeButtons: Array<{ key: AssistantTab; label: string }> = [
    { key: 'doubt', label: 'Ask Doubt' },
    { key: 'explain', label: 'Explain Topic' },
    { key: 'mcqs', label: 'Generate MCQs' },
    { key: 'plan', label: 'Study Plan' },
    { key: 'weak-topics', label: 'Weak Topics' },
  ];

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="rounded-[2rem] bg-[linear-gradient(135deg,_#0f172a_0%,_#1d4ed8_55%,_#38bdf8_100%)] p-8 text-white shadow-xl">
        <p className="text-sm font-semibold uppercase tracking-[0.28em] text-sky-100/80">Student AI</p>
        <h1 className="mt-3 text-3xl font-bold">AI Study Assistant</h1>
        <p className="mt-3 max-w-3xl text-sm text-sky-50/90">
          One place for doubts, topic explanations, MCQ practice, study planning, and weak-topic coaching grounded in attendance, online tests, LMS progress, and assignments.
        </p>
      </div>

      {error ? <Alert type="error" message={error} onClose={() => setError('')} /> : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={Target} label="Learning Score" value={`${Math.round(dashboard?.student_dashboard?.overall_learning_score || 0)}%`} helper="From LMS, tests, and assignments" />
        <MetricCard icon={CalendarClock} label="Today's Plan" value={`${todayPlan?.tasks.length || 0} tasks`} helper={`${todayPlan?.completion_percentage || 0}% completed`} />
        <MetricCard icon={SearchCheck} label="Weak Topics" value={String(weakTopics.length)} helper="Need focused revision" />
        <MetricCard icon={BookOpenCheck} label="Recommended Tests" value={String((dashboard?.ai_insights.recommended_tests || []).length)} helper="Next high-impact attempts" />
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <div className={cardClass}>
          <div className="grid gap-2 sm:grid-cols-5">
            {modeButtons.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setTab(item.key)}
                className={`rounded-2xl px-3 py-3 text-sm font-semibold transition ${tab === item.key ? 'bg-slate-900 text-white' : 'border border-slate-300 text-slate-700 hover:bg-slate-100'}`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {tab === 'plan' ? (
            <div className="mt-5 space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-semibold text-slate-900">Today's Tasks</p>
                <div className="mt-3 space-y-3">
                  {(todayPlan?.tasks || []).map((task, index) => (
                    <div key={`${task.title}-${index}`} className="rounded-2xl bg-white p-4">
                      <p className="text-sm font-semibold text-slate-900">{task.title}</p>
                      <p className="mt-1 text-sm text-slate-600">{task.description}</p>
                    </div>
                  ))}
                  {!todayPlan?.tasks.length ? <p className="text-sm text-slate-500">No planner tasks generated yet.</p> : null}
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-semibold text-slate-900">Weekly Focus</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {weeklyFocus.length ? weeklyFocus.map((item) => (
                    <span key={item} className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700">{item}</span>
                  )) : <p className="text-sm text-slate-500">Weekly focus not available.</p>}
                </div>
              </div>
            </div>
          ) : tab === 'weak-topics' ? (
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
                <p className="text-sm font-semibold text-rose-700">Weak Topics</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {weakTopics.length ? weakTopics.map((item) => (
                    <span key={item} className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-rose-700">{item}</span>
                  )) : <p className="text-sm text-rose-700">No weak topics detected yet.</p>}
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-semibold text-slate-900">AI Recommendations</p>
                <div className="mt-3 space-y-2">
                  {(dashboard?.student_dashboard?.today_tasks || dashboard?.ai_insights.revision_suggestions || []).map((item) => (
                    <div key={item} className="rounded-2xl bg-white px-3 py-3 text-sm text-slate-700">{item}</div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <form onSubmit={submit} className="mt-5 grid gap-3">
              <input
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
                className="rounded-2xl border border-slate-300 px-4 py-3 text-sm"
                placeholder="Topic, e.g. Ray Optics"
              />
              <textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                className="rounded-2xl border border-slate-300 px-4 py-3 text-sm"
                rows={4}
                placeholder={tab === 'doubt' ? 'Type your doubt or paste the question' : 'What do you want help with?'}
              />
              {tab === 'doubt' ? (
                <textarea
                  value={ocrText}
                  onChange={(event) => setOcrText(event.target.value)}
                  className="rounded-2xl border border-slate-300 px-4 py-3 text-sm"
                  rows={3}
                  placeholder="Optional OCR or handwritten text"
                />
              ) : null}
              <button disabled={loading} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-70">
                <Sparkles className="h-4 w-4" />
                {loading ? 'Generating...' : 'Run Assistant'}
              </button>
            </form>
          )}
        </div>

        <div className={cardClass}>
          {loading ? <LoadingSpinner message="AI Study Assistant working..." /> : null}
          {!loading && !tutorResult && !doubtResult && tab !== 'plan' && tab !== 'weak-topics' ? (
            <div className="space-y-3 text-sm text-slate-600">
              <p>This assistant merges:</p>
              <ul className="space-y-2">
                <li>AI Tutor for explanation and practice</li>
                <li>Doubt Solver for direct question solving</li>
                <li>Study Planner for daily focus and weak-topic guidance</li>
              </ul>
            </div>
          ) : null}
          {!loading && tutorResult ? (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-slate-900">{tutorResult.topic}</h2>
              <Panel title="Explanation" items={[tutorResult.explanation, ...tutorResult.key_points]} />
              <Panel title="Practice / Revision" items={[...tutorResult.revision_plan, ...tutorResult.challenge_questions]} />
              <Panel title="MCQs / Questions" items={tutorResult.practice_questions.map((item) => `${item.level.toUpperCase()}: ${item.question}`)} />
            </div>
          ) : null}
          {!loading && doubtResult ? (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-slate-900">{doubtResult.detected_topic || 'Solved Doubt'}</h2>
              <Panel title="Answer" items={[doubtResult.explanation, doubtResult.final_answer || '']} />
              <Panel title="Step by Step" items={doubtResult.step_by_step} />
              <Panel title="Common Mistakes" items={doubtResult.common_mistakes} />
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, helper }: { icon: typeof Target; label: string; value: string; helper: string }) {
  return (
    <div className={cardClass}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{value}</p>
          <p className="mt-2 text-sm text-slate-600">{helper}</p>
        </div>
        <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

function Panel({ title, items }: { title: string; items: string[] }) {
  const cleaned = items.filter(Boolean);
  return (
    <div>
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      <div className="mt-2 space-y-2">
        {cleaned.length ? cleaned.map((item) => (
          <div key={`${title}-${item}`} className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
            {item}
          </div>
        )) : <p className="text-sm text-slate-500">No items generated.</p>}
      </div>
    </div>
  );
}
