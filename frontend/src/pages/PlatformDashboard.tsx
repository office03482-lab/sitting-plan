import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, CheckCircle2, Clock3, ShieldCheck, Users, XCircle } from 'lucide-react';
import { apiService, getRequestErrorMessage } from '@services/api';
import type { PlatformAnalytics, PlatformDashboardSummary } from '@types';

const countCardClass = 'rounded-3xl border border-slate-200 bg-white p-5 shadow-sm';

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export default function PlatformDashboard() {
  const [summary, setSummary] = useState<PlatformDashboardSummary | null>(null);
  const [analytics, setAnalytics] = useState<PlatformAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const loadSummary = async () => {
      setLoading(true);
      try {
        const [summaryResponse, analyticsResponse] = await Promise.all([
          apiService.getPlatformDashboardSummary(),
          apiService.getPlatformAnalytics(),
        ]);
        if (!active) return;
        setSummary(summaryResponse.data);
        setAnalytics(analyticsResponse.data);
        setError(null);
      } catch (requestError: any) {
        if (!active) return;
        setError(getRequestErrorMessage(requestError, 'Platform dashboard load nahi ho paaya.'));
      } finally {
        if (active) setLoading(false);
      }
    };

    void loadSummary();
    return () => {
      active = false;
    };
  }, []);

  const cards = useMemo(() => {
    const counts = summary?.workflow_counts || {};
    return [
      { label: 'Pending Requests', value: counts.pending || 0, icon: Clock3, tone: 'text-amber-600' },
      { label: 'Approved Requests', value: counts.approved || 0, icon: CheckCircle2, tone: 'text-sky-600' },
      { label: 'Rejected Requests', value: counts.rejected || 0, icon: XCircle, tone: 'text-rose-600' },
      { label: 'Executed Requests', value: counts.executed || 0, icon: ShieldCheck, tone: 'text-emerald-600' },
      { label: 'Schools Count', value: summary?.schools_count || 0, icon: Activity, tone: 'text-indigo-600' },
      { label: 'Active Users', value: summary?.active_users_count || 0, icon: Users, tone: 'text-violet-600' },
    ];
  }, [summary]);

  return (
    <div className="space-y-6">
      <div className="rounded-[2rem] bg-gradient-to-br from-slate-900 via-sky-900 to-cyan-700 p-8 text-white shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.28em] text-sky-100/80">Platform Administration</p>
            <h1 className="mt-3 text-3xl font-bold">Platform Dashboard</h1>
            <p className="mt-3 max-w-3xl text-sm text-sky-50/90">
              Workflow approvals, system activity, aur cross-platform admin metrics ka read-only command view.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link to="/platform/workflow" className="rounded-full bg-white px-5 py-2 text-sm font-semibold text-slate-900 shadow-sm hover:bg-slate-100">
              Open Workflow Queue
            </Link>
            <Link to="/admin/access-control" className="rounded-full border border-white/30 px-5 py-2 text-sm font-semibold text-white hover:bg-white/10">
              Open Access Control
            </Link>
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label} className={countCardClass}>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-slate-500">{card.label}</p>
                  <p className="mt-2 text-3xl font-bold text-slate-900">{loading ? '...' : card.value}</p>
                </div>
                <div className={`rounded-2xl bg-slate-100 p-3 ${card.tone}`}>
                  <Icon className="h-6 w-6" />
                </div>
              </div>
            </div>
          );
        })}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Recent Workflow Activity</h2>
            <p className="mt-1 text-sm text-slate-500">Latest approval, rejection, and execution events.</p>
          </div>
          <Link to="/platform/workflow" className="text-sm font-semibold text-sky-700 hover:text-sky-900">
            View full queue
          </Link>
        </div>

        <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200">
          <div className="grid grid-cols-[1.2fr_1fr_1fr_1fr] gap-4 bg-slate-50 px-4 py-3 text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
            <span>Event</span>
            <span>Actor</span>
            <span>Role</span>
            <span>When</span>
          </div>
          <div className="divide-y divide-slate-100">
            {(summary?.recent_workflow_activity || []).map((event, index) => (
              <div key={`${event.id || event.request_id}-${index}`} className="grid grid-cols-[1.2fr_1fr_1fr_1fr] gap-4 px-4 py-3 text-sm text-slate-700">
                <span className="font-medium text-slate-900">{event.event_type}</span>
                <span>{event.actor_name || event.actor_profile_id || '-'}</span>
                <span>{event.actor_role || '-'}</span>
                <span>{formatDateTime(event.created_at)}</span>
              </div>
            ))}
            {!loading && !(summary?.recent_workflow_activity || []).length ? (
              <div className="px-4 py-8 text-center text-sm text-slate-500">Workflow activity abhi available nahi hai.</div>
            ) : null}
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Online Test Platform Analytics</h2>
            <p className="mt-1 text-sm text-slate-500">Cross-school comparison, adoption, and usage metrics.</p>
          </div>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[
            ['Active Students', analytics?.active_students || 0],
            ['Active Tests', analytics?.active_tests || 0],
            ['Average Score', analytics?.average_score || 0],
            ['Average %', `${analytics?.average_percentage || 0}%`],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">{label}</p>
              <p className="mt-2 text-2xl font-bold text-slate-900">{loading ? '...' : value}</p>
            </div>
          ))}
        </div>

        <div className="mt-5 grid gap-5 xl:grid-cols-[1.8fr_1fr]">
          <div className="overflow-hidden rounded-2xl border border-slate-200">
            <div className="grid grid-cols-[1.4fr_0.8fr_0.8fr_0.8fr] gap-4 bg-slate-50 px-4 py-3 text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
              <span>School</span>
              <span>Average %</span>
              <span>Tests</span>
              <span>Students</span>
            </div>
            <div className="divide-y divide-slate-100">
              {(analytics?.cross_school_comparison || []).slice(0, 8).map((item) => (
                <div key={item.school_id} className="grid grid-cols-[1.4fr_0.8fr_0.8fr_0.8fr] gap-4 px-4 py-3 text-sm text-slate-700">
                  <span className="font-medium text-slate-900">{item.school_name}</span>
                  <span>{item.average_percentage}%</span>
                  <span>{item.tests_count}</span>
                  <span>{item.active_students}</span>
                </div>
              ))}
              {!loading && !(analytics?.cross_school_comparison || []).length ? (
                <div className="px-4 py-8 text-center text-sm text-slate-500">Online test analytics abhi available nahi hai.</div>
              ) : null}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Usage Metrics</p>
            <div className="mt-4 space-y-3 text-sm text-slate-700">
              {Object.entries(analytics?.usage_metrics || {}).map(([key, value]) => (
                <div key={key} className="flex items-center justify-between gap-3">
                  <span className="capitalize">{key.replace(/_/g, ' ')}</span>
                  <span className="font-semibold text-slate-900">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
