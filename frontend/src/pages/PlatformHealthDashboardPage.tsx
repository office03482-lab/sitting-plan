import { useEffect, useState } from 'react';
import { apiService, getRequestErrorMessage } from '@services/api';
import type { PlatformHealthDashboardResponse } from '@types';

export default function PlatformHealthDashboardPage() {
  const [health, setHealth] = useState<PlatformHealthDashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const response = await apiService.getPlatformHealthDashboard();
        setHealth(response.data);
      } catch (requestError: any) {
        setError(getRequestErrorMessage(requestError, 'Health dashboard load nahi ho paaya.'));
      }
    };
    void load();
  }, []);

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] bg-gradient-to-br from-slate-950 via-rose-900 to-orange-700 p-8 text-white shadow-xl">
        <p className="text-sm font-semibold uppercase tracking-[0.28em] text-rose-100/80">School Health</p>
        <h1 className="mt-3 text-3xl font-bold">Tenant Health Dashboard</h1>
      </section>
      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
      <section className="grid gap-4 xl:grid-cols-2">
        {(health?.items || []).map((item) => (
          <article key={item.school_id} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-slate-900">{item.school_name}</h2>
            <p className="mt-1 text-sm text-slate-500">API {item.api_status} • Queue {item.queue_status} • Jobs {item.background_jobs}</p>
          </article>
        ))}
      </section>
    </div>
  );
}
