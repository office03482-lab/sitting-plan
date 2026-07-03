import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiService, getRequestErrorMessage } from '@services/api';
import type { PlatformSchoolSummary, PlatformSupportActionResponse } from '@types';

const actions = [
  'impersonate_school_admin',
  'reset_school_cache',
  'resync_school',
  'rebuild_permissions',
  'recalculate_usage',
  'repair_subscription',
  'repair_entitlements',
  'repair_ai_wallet',
];

export default function PlatformSupportCenterPage() {
  const [params] = useSearchParams();
  const [schools, setSchools] = useState<PlatformSchoolSummary[]>([]);
  const [selectedSchoolId, setSelectedSchoolId] = useState(params.get('school_id') || '');
  const [result, setResult] = useState<PlatformSupportActionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const response = await apiService.listPlatformSchools();
      setSchools(response.data.items || []);
      setSelectedSchoolId((current) => current || response.data.items?.[0]?.id || '');
    };
    void load();
  }, []);

  const runAction = async (action: string) => {
    try {
      const response = await apiService.runPlatformSupportAction(selectedSchoolId, { action });
      setResult(response.data);
      setError(null);
    } catch (requestError: any) {
      setError(getRequestErrorMessage(requestError, 'Support action run nahi ho paaya.'));
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] bg-gradient-to-br from-slate-950 via-red-900 to-amber-700 p-8 text-white shadow-xl">
        <p className="text-sm font-semibold uppercase tracking-[0.28em] text-red-100/80">Support Center</p>
        <h1 className="mt-3 text-3xl font-bold">Platform Support Actions</h1>
      </section>
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <select value={selectedSchoolId} onChange={(e) => setSelectedSchoolId(e.target.value)} className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm">
          {schools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}
        </select>
      </section>
      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {actions.map((action) => (
          <button key={action} onClick={() => void runAction(action)} className="rounded-3xl border border-slate-200 bg-white px-5 py-4 text-left text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50">
            {action.replace(/_/g, ' ')}
          </button>
        ))}
      </section>
      {result ? <pre className="overflow-auto rounded-2xl bg-slate-950 p-4 text-xs text-slate-100">{JSON.stringify(result, null, 2)}</pre> : null}
    </div>
  );
}
