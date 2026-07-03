import { useEffect, useState } from 'react';
import { apiService, getRequestErrorMessage } from '@services/api';
import type { PlatformUsageDashboardResponse } from '@types';

export default function PlatformUsageDashboardPage() {
  const [usage, setUsage] = useState<PlatformUsageDashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const response = await apiService.getPlatformUsageDashboard();
        setUsage(response.data);
      } catch (requestError: any) {
        setError(getRequestErrorMessage(requestError, 'Usage dashboard load nahi ho paaya.'));
      }
    };
    void load();
  }, []);

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] bg-gradient-to-br from-slate-950 via-cyan-900 to-teal-700 p-8 text-white shadow-xl">
        <p className="text-sm font-semibold uppercase tracking-[0.28em] text-cyan-100/80">Usage Dashboard</p>
        <h1 className="mt-3 text-3xl font-bold">Live Tenant Usage</h1>
      </section>
      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          ['Total Students', usage?.total_students || 0],
          ['Total Teachers', usage?.total_teachers || 0],
          ['AI Requests', usage?.total_ai_requests || 0],
          ['Storage Used', `${usage?.total_storage_used_gb || 0} GB`],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">{label}</p>
            <p className="mt-3 text-3xl font-bold text-slate-900">{value}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
