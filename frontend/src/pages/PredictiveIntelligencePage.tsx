import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BrainCircuit, Building2, Coins, RefreshCcw, ShieldAlert, TrendingUp } from 'lucide-react';

import { Alert } from '@components/Alert';
import { LoadingSpinner } from '@components/LoadingSpinner';
import { useAuth } from '@/contexts/AuthProvider';
import { apiService, getRequestErrorMessage } from '@services/api';
import type {
  CampusPredictionsDashboard,
  FinancePredictionsDashboard,
  StudentPredictionsDashboard,
} from '@types';

const cardClass = 'rounded-3xl border border-slate-200 bg-white p-5 shadow-sm';
type PredictionView = 'student' | 'campus' | 'finance';

const riskTone: Record<string, string> = {
  low: 'bg-emerald-50 text-emerald-700',
  medium: 'bg-amber-50 text-amber-700',
  high: 'bg-orange-50 text-orange-700',
  critical: 'bg-rose-50 text-rose-700',
};

export default function PredictiveIntelligencePage() {
  const { user } = useAuth();
  const [view, setView] = useState<PredictionView>('student');
  const [studentDashboard, setStudentDashboard] = useState<StudentPredictionsDashboard | null>(null);
  const [campusDashboard, setCampusDashboard] = useState<CampusPredictionsDashboard | null>(null);
  const [financeDashboard, setFinanceDashboard] = useState<FinancePredictionsDashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const canViewCampus = ['teacher', 'school_admin', 'platform_admin'].includes(user?.role_key || '') || user?.role === 'admin';
  const canViewFinance = ['school_admin', 'platform_admin'].includes(user?.role_key || '') || user?.role === 'admin';

  useEffect(() => {
    if (view === 'campus' && !canViewCampus) {
      setView('student');
    } else if (view === 'finance' && !canViewFinance) {
      setView(canViewCampus ? 'campus' : 'student');
    }
  }, [view, canViewCampus, canViewFinance]);

  const loadDashboard = async () => {
    try {
      setLoading(true);
      setError('');
      const requests: Promise<unknown>[] = [apiService.getStudentPredictions({ limit: 20 })];
      if (canViewCampus) requests.push(apiService.getCampusPredictions());
      if (canViewFinance) requests.push(apiService.getFinancePredictions());
      const responses = await Promise.all(requests);

      let cursor = 0;
      setStudentDashboard((responses[cursor++] as { data: StudentPredictionsDashboard }).data);
      if (canViewCampus) {
        setCampusDashboard((responses[cursor++] as { data: CampusPredictionsDashboard }).data);
      }
      if (canViewFinance) {
        setFinanceDashboard((responses[cursor++] as { data: FinancePredictionsDashboard }).data);
      }
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'Predictive dashboard load nahi ho paaya.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDashboard();
  }, [canViewCampus, canViewFinance]);

  const summaryCards = useMemo(() => {
    const topStudent = [...(studentDashboard?.students || [])].sort((left, right) => right.overall_risk_score - left.overall_risk_score)[0];
    return [
      {
        label: 'Student Risks',
        value: studentDashboard?.students.length || 0,
        subtitle: topStudent ? `${topStudent.student_name} is the highest-risk learner` : 'No student risk signals yet',
        icon: BrainCircuit,
      },
      {
        label: 'Campus Risks',
        value: campusDashboard?.risk_overview.length || 0,
        subtitle: campusDashboard ? `${campusDashboard.active_staff_count} staff in scope` : 'Campus view unavailable',
        icon: Building2,
      },
      {
        label: 'Finance Risks',
        value: financeDashboard?.risk_overview.length || 0,
        subtitle: financeDashboard ? `Pending window: Rs ${financeDashboard.total_pending_window.toFixed(2)}` : 'Finance view unavailable',
        icon: Coins,
      },
    ];
  }, [studentDashboard, campusDashboard, financeDashboard]);

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="rounded-[2rem] bg-gradient-to-br from-slate-950 via-cyan-900 to-sky-700 p-8 text-white shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.28em] text-cyan-100/80">Predictive AI Engine</p>
            <h1 className="mt-3 text-3xl font-bold">Future Risk & Forecast Command Center</h1>
            <p className="mt-3 max-w-3xl text-sm text-cyan-50/90">
              Warehouse facts se forward-looking student, campus, aur finance risks generate kiye gaye hain. Har signal ke saath confidence, early warning, aur intervention actions bhi diye gaye hain.
            </p>
          </div>
          <button onClick={() => void loadDashboard()} className="inline-flex items-center gap-2 rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm font-semibold text-white hover:bg-white/15">
            <RefreshCcw className="h-4 w-4" />
            Refresh Predictions
          </button>
        </div>
      </div>

      {error ? <Alert type="error" message={error} onClose={() => setError('')} /> : null}
      {loading ? <LoadingSpinner message="Predictive models warehouse data se refresh ho rahe hain..." /> : null}

      <section className="grid gap-4 md:grid-cols-3">
        {summaryCards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className={cardClass}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-slate-500">{card.label}</div>
                  <div className="mt-2 text-2xl font-bold text-slate-900">{card.value}</div>
                  <div className="mt-2 text-sm text-slate-600">{card.subtitle}</div>
                </div>
                <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">
                  <Icon className="h-5 w-5" />
                </div>
              </div>
            </div>
          );
        })}
      </section>

      <section className="flex flex-wrap gap-3">
        <TabButton active={view === 'student'} onClick={() => setView('student')} label="Student Risk" />
        {canViewCampus ? <TabButton active={view === 'campus'} onClick={() => setView('campus')} label="Campus Risk" /> : null}
        {canViewFinance ? <TabButton active={view === 'finance'} onClick={() => setView('finance')} label="Finance Forecast" /> : null}
      </section>

      {view === 'student' ? (
        <section className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
          <div className={cardClass}>
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-slate-700" />
              <h2 className="text-lg font-semibold text-slate-900">Student Risk Dashboard</h2>
            </div>
            <div className="mt-4 space-y-4">
              {(studentDashboard?.students || []).map((student) => (
                <div key={student.student_id} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-lg font-semibold text-slate-900">{student.student_name}</div>
                      <div className="text-sm text-slate-600">
                        {student.class_name || 'Class N/A'}{student.section ? ` • ${student.section}` : ''}
                      </div>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${riskTone[student.overall_risk_level] || 'bg-slate-100 text-slate-700'}`}>
                      {student.overall_risk_level.toUpperCase()} • {student.overall_risk_score.toFixed(1)}%
                    </span>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-4">
                    <MetricPill label="Dropout" value={student.dropout_risk} />
                    <MetricPill label="Attendance" value={student.attendance_risk} />
                    <MetricPill label="Exam Failure" value={student.exam_failure_risk} />
                    <MetricPill label="Engagement" value={student.engagement_decline_risk} />
                  </div>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <ListBlock title="Top Factors" items={student.top_factors} emptyLabel="No high-risk factors captured." />
                    <ListBlock title="Recommended Actions" items={student.recommended_actions} emptyLabel="No actions suggested." />
                  </div>
                </div>
              ))}
              {!(studentDashboard?.students || []).length ? <EmptyState label="No student predictions available yet." /> : null}
            </div>
          </div>
          <div className="space-y-4">
            <Panel title="Early Warnings" icon={AlertTriangle}>
              <ListBlock title="" items={studentDashboard?.early_warnings || []} emptyLabel="No early warnings generated." />
            </Panel>
            <Panel title="Automated Actions" icon={TrendingUp}>
              <ListBlock title="" items={studentDashboard?.automated_actions || []} emptyLabel="No automation actions suggested." />
            </Panel>
            <Panel title="Model Registry" icon={BrainCircuit}>
              <div className="space-y-3">
                {(studentDashboard?.model_registry || []).slice(0, 5).map((model) => (
                  <div key={model.model_key} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="font-semibold text-slate-900">{model.model_name || model.model_key}</div>
                    <div className="mt-1 text-sm text-slate-600">
                      {model.model_type} • {model.target_metric} • {model.version}
                    </div>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        </section>
      ) : null}

      {view === 'campus' ? (
        <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <div className={cardClass}>
            <div className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-slate-700" />
              <h2 className="text-lg font-semibold text-slate-900">Campus Risk Overview</h2>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {(campusDashboard?.risk_overview || []).map((item) => (
                <div key={item.risk_type} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-semibold text-slate-900">{item.headline}</div>
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${riskTone[item.risk_level] || 'bg-slate-100 text-slate-700'}`}>
                      {item.risk_level.toUpperCase()}
                    </span>
                  </div>
                  <div className="mt-3 text-sm text-slate-600">{item.explanation}</div>
                  <div className="mt-4">
                    <MetricPill label="Risk Score" value={item.score} />
                  </div>
                  <div className="mt-4">
                    <ListBlock title="Actions" items={item.recommended_actions} emptyLabel="No action suggested." />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-4">
            <Panel title="Admissions Forecast" icon={TrendingUp}>
              <ForecastList items={campusDashboard?.admissions_forecast || []} />
            </Panel>
            <Panel title="Hostel Capacity Forecast" icon={TrendingUp}>
              <ForecastList items={campusDashboard?.hostel_forecast || []} />
            </Panel>
            <Panel title="Automation Queue" icon={BrainCircuit}>
              <ListBlock title="" items={campusDashboard?.automated_actions || []} emptyLabel="No automated action suggested." />
            </Panel>
          </div>
        </section>
      ) : null}

      {view === 'finance' ? (
        <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <div className={cardClass}>
            <div className="flex items-center gap-2">
              <Coins className="h-5 w-5 text-slate-700" />
              <h2 className="text-lg font-semibold text-slate-900">Finance Forecast Dashboard</h2>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {(financeDashboard?.risk_overview || []).map((item) => (
                <div key={item.risk_type} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-semibold text-slate-900">{item.headline}</div>
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${riskTone[item.risk_level] || 'bg-slate-100 text-slate-700'}`}>
                      {item.risk_level.toUpperCase()}
                    </span>
                  </div>
                  <div className="mt-3 text-sm text-slate-600">{item.explanation}</div>
                  <div className="mt-4">
                    <MetricPill label="Risk Score" value={item.score} />
                  </div>
                  <div className="mt-4">
                    <ListBlock title="Actions" items={item.recommended_actions} emptyLabel="No action suggested." />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Revenue Window</div>
                <div className="mt-2 text-2xl font-bold text-slate-900">Rs {(financeDashboard?.total_revenue_window || 0).toFixed(2)}</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Pending Window</div>
                <div className="mt-2 text-2xl font-bold text-slate-900">Rs {(financeDashboard?.total_pending_window || 0).toFixed(2)}</div>
              </div>
            </div>
          </div>
          <div className="space-y-4">
            <Panel title="Revenue Forecast" icon={TrendingUp}>
              <ForecastList items={financeDashboard?.revenue_forecast || []} currency />
            </Panel>
            <Panel title="Fee Default Forecast" icon={TrendingUp}>
              <ForecastList items={financeDashboard?.fee_default_forecast || []} currency />
            </Panel>
            <Panel title="Automation Queue" icon={BrainCircuit}>
              <ListBlock title="" items={financeDashboard?.automated_actions || []} emptyLabel="No automated action suggested." />
            </Panel>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-2xl px-4 py-3 text-sm font-semibold transition ${
        active ? 'bg-slate-900 text-white shadow-sm' : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
      }`}
    >
      {label}
    </button>
  );
}

function Panel({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof BrainCircuit;
  children: ReactNode;
}) {
  return (
    <div className={cardClass}>
      <div className="flex items-center gap-2">
        <Icon className="h-5 w-5 text-slate-700" />
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function MetricPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
      <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">{label}</div>
      <div className="mt-2 text-xl font-bold text-slate-900">{value.toFixed(1)}%</div>
    </div>
  );
}

function ListBlock({ title, items, emptyLabel }: { title: string; items: string[]; emptyLabel: string }) {
  return (
    <div>
      {title ? <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">{title}</div> : null}
      <div className="mt-3 space-y-2">
        {items.map((item) => (
          <div key={item} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
            {item}
          </div>
        ))}
        {!items.length ? <div className="text-sm text-slate-500">{emptyLabel}</div> : null}
      </div>
    </div>
  );
}

function ForecastList({ items, currency = false }: { items: Array<{ period: string; forecast_value: number; lower_bound?: number | null; upper_bound?: number | null }>; currency?: boolean }) {
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.period} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="font-semibold text-slate-900">{item.period}</div>
            <div className="text-sm font-semibold text-slate-900">
              {currency ? `Rs ${item.forecast_value.toFixed(2)}` : item.forecast_value.toFixed(2)}
            </div>
          </div>
          <div className="mt-1 text-sm text-slate-600">
            Range: {currency ? `Rs ${(item.lower_bound || 0).toFixed(2)} - Rs ${(item.upper_bound || 0).toFixed(2)}` : `${(item.lower_bound || 0).toFixed(2)} - ${(item.upper_bound || 0).toFixed(2)}`}
          </div>
        </div>
      ))}
      {!items.length ? <div className="text-sm text-slate-500">No forecast points available.</div> : null}
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center text-sm text-slate-500">{label}</div>;
}
