import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiService, getRequestErrorMessage } from '@services/api';
import type { PlatformSchoolSummary, PlatformSubscriptionSummary } from '@types';

export default function PlatformSubscriptionCenterPage() {
  const [params] = useSearchParams();
  const [schools, setSchools] = useState<PlatformSchoolSummary[]>([]);
  const [selectedSchoolId, setSelectedSchoolId] = useState(params.get('school_id') || '');
  const [subscription, setSubscription] = useState<PlatformSubscriptionSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadSchools = async () => {
      const response = await apiService.listPlatformSchools();
      setSchools(response.data.items || []);
      const firstSchoolId = selectedSchoolId || response.data.items?.[0]?.id || '';
      setSelectedSchoolId(firstSchoolId);
    };
    void loadSchools();
  }, []);

  useEffect(() => {
    if (!selectedSchoolId) return;
    const loadSubscription = async () => {
      try {
        const response = await apiService.getPlatformSubscriptionSummary(selectedSchoolId);
        setSubscription(response.data);
        setError(null);
      } catch (requestError: any) {
        setError(getRequestErrorMessage(requestError, 'Subscription summary load nahi ho paayi.'));
      }
    };
    void loadSubscription();
  }, [selectedSchoolId]);

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] bg-gradient-to-br from-slate-950 via-orange-900 to-amber-700 p-8 text-white shadow-xl">
        <p className="text-sm font-semibold uppercase tracking-[0.28em] text-amber-100/80">Subscription Center</p>
        <h1 className="mt-3 text-3xl font-bold">Cross-School Subscription Management</h1>
      </section>
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <select value={selectedSchoolId} onChange={(e) => setSelectedSchoolId(e.target.value)} className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm">
          {schools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}
        </select>
        {error ? <p className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
      </section>
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          ['Current Plan', subscription?.current_plan],
          ['Status', subscription?.status],
          ['Expiry', subscription?.expiry],
          ['Renewal', subscription?.renewal],
          ['Payment Status', subscription?.payment_status],
          ['Grace Period', `${subscription?.grace_period_days || 0} days`],
          ['Billing Cycle', subscription?.billing_cycle],
          ['Amount', subscription?.amount ? `${subscription.amount} ${subscription.currency || ''}` : '-'],
        ].map(([label, value]) => (
          <article key={String(label)} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">{label}</p>
            <p className="mt-3 text-2xl font-bold text-slate-900">{value || '-'}</p>
          </article>
        ))}
      </section>
    </div>
  );
}
