import { useEffect, useState } from 'react';
import { apiService, getRequestErrorMessage } from '@services/api';
import type { PlatformAnalyticsOverview } from '@types';

export default function PlatformAnalyticsPage() {
  const [analytics, setAnalytics] = useState<PlatformAnalyticsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const response = await apiService.getPlatformAnalyticsOverview();
        setAnalytics(response.data);
      } catch (requestError: any) {
        setError(getRequestErrorMessage(requestError, 'Platform analytics load nahi ho paaya.'));
      }
    };
    void load();
  }, []);

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] bg-gradient-to-br from-slate-950 via-lime-900 to-emerald-700 p-8 text-white shadow-xl">
        <p className="text-sm font-semibold uppercase tracking-[0.28em] text-lime-100/80">Platform Analytics</p>
        <h1 className="mt-3 text-3xl font-bold">SaaS Growth & Revenue Metrics</h1>
      </section>
      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {[
          ['Total Schools', analytics?.total_schools || 0],
          ['Active Schools', analytics?.active_schools || 0],
          ['Trial Schools', analytics?.trial_schools || 0],
          ['Monthly Growth', analytics?.monthly_growth || 0],
          ['Subscriptions', analytics?.subscriptions || 0],
          ['Revenue', analytics?.revenue || 0],
          ['Students', analytics?.student_count || 0],
          ['Teachers', analytics?.teacher_count || 0],
          ['AI Usage', analytics?.ai_usage || 0],
          ['Credit Sales', analytics?.credit_sales || 0],
        ].map(([label, value]) => (
          <article key={String(label)} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">{label}</p>
            <p className="mt-3 text-3xl font-bold text-slate-900">{value}</p>
          </article>
        ))}
      </section>
    </div>
  );
}
