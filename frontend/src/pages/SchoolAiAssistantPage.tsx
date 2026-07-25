import { FormEvent, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, BarChart3, BrainCircuit, Coins, RefreshCcw, Send, ShieldAlert, Sparkles } from 'lucide-react';

import { Alert } from '@components/Alert';
import { LoadingSpinner } from '@components/LoadingSpinner';
import { apiService, getRequestErrorMessage } from '@services/api';
import { useEffectiveSchoolId } from '@hooks/useEffectiveSchoolId';
import type {
  AiAgentDashboard,
  AiAgentRecommendation,
  CampusPredictionsDashboard,
  FinancePredictionsDashboard,
  SchoolAiAssistantResponse,
  SchoolAnalytics,
} from '@types';

const cardClass = 'rounded-3xl border border-slate-200 bg-white p-5 shadow-sm';

const severityTone: Record<string, string> = {
  critical: 'bg-rose-50 text-rose-700',
  warning: 'bg-amber-50 text-amber-700',
  positive: 'bg-emerald-50 text-emerald-700',
  info: 'bg-sky-50 text-sky-700',
};

export default function SchoolAiAssistantPage() {
  const [question, setQuestion] = useState('');
  const [dashboard, setDashboard] = useState<AiAgentDashboard | null>(null);
  const [recommendations, setRecommendations] = useState<AiAgentRecommendation[]>([]);
  const [schoolAnalytics, setSchoolAnalytics] = useState<SchoolAnalytics | null>(null);
  const [campusDashboard, setCampusDashboard] = useState<CampusPredictionsDashboard | null>(null);
  const [financeDashboard, setFinanceDashboard] = useState<FinancePredictionsDashboard | null>(null);
  const [assistantResponse, setAssistantResponse] = useState<SchoolAiAssistantResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const effectiveSchoolId = useEffectiveSchoolId();

  const loadAssistant = async () => {
    if (!effectiveSchoolId) return;
    try {
      setLoading(true);
      setError('');
      const [
        dashboardResponse,
        recommendationsResponse,
        schoolAnalyticsResponse,
        campusPredictionsResponse,
        financePredictionsResponse,
      ] = await Promise.all([
        apiService.getAiAgentsDashboard(),
        apiService.listAiAgentRecommendations(),
        apiService.getSchoolAnalytics(effectiveSchoolId),
        apiService.getCampusPredictions(),
        apiService.getFinancePredictions(),
      ]);
      setDashboard(dashboardResponse.data);
      setRecommendations(recommendationsResponse.data);
      setSchoolAnalytics(schoolAnalyticsResponse.data);
      setCampusDashboard(campusPredictionsResponse.data);
      setFinanceDashboard(financePredictionsResponse.data);
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'School AI Assistant load nahi ho paya.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAssistant();
  }, [effectiveSchoolId]);

  const summaryCards = useMemo(
    () => [
      {
        label: 'Critical Alerts',
        value: dashboard?.summary.critical_alerts || 0,
        helper: `${dashboard?.summary.pending_approvals || 0} pending approvals`,
        icon: ShieldAlert,
      },
      {
        label: 'Active Students',
        value: schoolAnalytics?.active_students || 0,
        helper: `${schoolAnalytics?.active_tests || 0} active tests`,
        icon: BrainCircuit,
      },
      {
        label: 'Campus Risks',
        value: campusDashboard?.risk_overview.length || 0,
        helper: `${campusDashboard?.automated_actions.length || 0} automated actions`,
        icon: AlertTriangle,
      },
      {
        label: 'Finance Risks',
        value: financeDashboard?.risk_overview.length || 0,
        helper: `Rs ${(financeDashboard?.total_pending_window || 0).toFixed(0)} pending`,
        icon: Coins,
      },
    ],
    [campusDashboard, dashboard, financeDashboard, schoolAnalytics],
  );

  const submitQuestion = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!question.trim()) {
      setError('School question likhna zaroori hai.');
      return;
    }
    try {
      setSubmitting(true);
      setError('');
      const response = await apiService.askSchoolAiAssistant({ question: question.trim() });
      setAssistantResponse(response.data);
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'School AI answer generate nahi hua.'));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <LoadingSpinner message="School AI Assistant load ho raha hai..." />;
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="rounded-[2rem] bg-gradient-to-br from-slate-950 via-sky-900 to-cyan-600 p-8 text-white shadow-xl">
        <p className="text-sm font-semibold uppercase tracking-[0.28em] text-cyan-100/80">Admin AI</p>
        <h1 className="mt-3 text-3xl font-bold">School AI Assistant</h1>
        <p className="mt-3 max-w-3xl text-sm text-cyan-50/90">
          One leadership assistant for school questions, risk alerts, attendance insight, and performance insight grounded in analytics, predictions, LMS, assignments, and online tests.
        </p>
      </div>

      {error ? <Alert type="error" message={error} onClose={() => setError('')} /> : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className={cardClass}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{item.label}</p>
                  <p className="mt-2 text-2xl font-bold text-slate-900">{item.value}</p>
                  <p className="mt-2 text-sm text-slate-600">{item.helper}</p>
                </div>
                <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">
                  <Icon className="h-5 w-5" />
                </div>
              </div>
            </div>
          );
        })}
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <div className={cardClass}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Ask School AI</h2>
              <p className="mt-1 text-sm text-slate-500">Ask about attendance drift, weak classes, performance trends, or pending risks.</p>
            </div>
            <button
              type="button"
              onClick={() => void loadAssistant()}
              className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              <RefreshCcw className="h-4 w-4" />
              Refresh
            </button>
          </div>

          <form onSubmit={submitQuestion} className="mt-5 space-y-3">
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              rows={5}
              className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm"
              placeholder="Example: Which batches need urgent intervention this week, and what should the academic team do first?"
            />
            <button
              disabled={submitting}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-70"
            >
              <Send className="h-4 w-4" />
              {submitting ? 'Generating...' : 'Ask Assistant'}
            </button>
          </form>

          <div className="mt-5 space-y-4">
            {assistantResponse ? (
              <>
                <InsightPanel title="Answer" icon={Sparkles} items={[assistantResponse.answer]} />
                <InsightPanel title="Attendance Insights" icon={BarChart3} items={assistantResponse.attendance_insights} />
                <InsightPanel title="Performance Insights" icon={BrainCircuit} items={assistantResponse.performance_insights} />
                <InsightPanel title="Risk Alerts" icon={ShieldAlert} items={assistantResponse.risk_alerts} />
              </>
            ) : (
              <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-sm text-slate-500">
                Ask your first leadership question to get a grounded school-level answer.
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <InsightCard title="Priority Recommendations" icon={Sparkles}>
            <div className="space-y-3">
              {recommendations.slice(0, 5).map((item) => (
                <div key={item.id} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-slate-900">{item.title}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">
                        {item.agent_name || item.agent_key} | {item.recommendation_type}
                      </p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${severityTone[item.severity] || 'bg-slate-100 text-slate-700'}`}>
                      {item.severity.toUpperCase()}
                    </span>
                  </div>
                  <p className="mt-3 text-sm text-slate-600">{item.summary}</p>
                </div>
              ))}
              {!recommendations.length ? <EmptyState text="No AI recommendations available right now." /> : null}
            </div>
          </InsightCard>

          <InsightCard title="School Performance Snapshot" icon={BrainCircuit}>
            <div className="grid gap-3 md:grid-cols-2">
              {(schoolAnalytics?.subject_wise_trends || []).slice(0, 4).map((item) => (
                <div key={item.name} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-sm font-semibold text-slate-900">{item.name}</p>
                  <p className="mt-1 text-sm text-slate-600">{item.average_percentage.toFixed(1)}% average</p>
                  <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">{item.tests_count} tests</p>
                </div>
              ))}
              {!(schoolAnalytics?.subject_wise_trends || []).length ? <EmptyState text="Subject trends not available yet." /> : null}
            </div>
          </InsightCard>
        </div>
      </section>
    </div>
  );
}

function InsightCard({ title, icon: Icon, children }: { title: string; icon: typeof BrainCircuit; children: ReactNode }) {
  return (
    <section className={cardClass}>
      <div className="flex items-center gap-2">
        <Icon className="h-5 w-5 text-slate-700" />
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function InsightPanel({ title, icon: Icon, items }: { title: string; icon: typeof BrainCircuit; items: string[] }) {
  return (
    <div>
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        <Icon className="h-4 w-4" />
        {title}
      </div>
      <div className="mt-2 space-y-2">
        {items.length ? items.map((item) => (
          <div key={`${title}-${item}`} className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
            {item}
          </div>
        )) : <EmptyState text="No insights available." />}
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-500">{text}</div>;
}
