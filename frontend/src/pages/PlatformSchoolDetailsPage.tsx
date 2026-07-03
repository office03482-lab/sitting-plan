import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiService, getRequestErrorMessage } from '@services/api';
import type { PlatformSchoolSummary } from '@types';

const lifecycleActions = ['active', 'suspended', 'archived', 'deleted'] as const;

export default function PlatformSchoolDetailsPage() {
  const { schoolId = '' } = useParams();
  const [school, setSchool] = useState<PlatformSchoolSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSchool = async () => {
    try {
      const response = await apiService.getPlatformSchool(schoolId);
      setSchool(response.data);
      setError(null);
    } catch (requestError: any) {
      setError(getRequestErrorMessage(requestError, 'School detail load nahi ho paaya.'));
    }
  };

  useEffect(() => {
    if (schoolId) void loadSchool();
  }, [schoolId]);

  const handleStatus = async (status: string) => {
    try {
      const response = await apiService.updatePlatformSchoolStatus(schoolId, { status });
      setSchool(response.data);
    } catch (requestError: any) {
      setError(getRequestErrorMessage(requestError, 'School status update nahi ho paaya.'));
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] bg-gradient-to-br from-slate-950 via-sky-900 to-indigo-700 p-8 text-white shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.28em] text-sky-100/80">School Details</p>
            <h1 className="mt-3 text-3xl font-bold">{school?.name || 'Loading school...'}</h1>
            <p className="mt-3 max-w-3xl text-sm text-sky-50/90">Branding, domain, timezone, academic session, subscription, usage, aur health snapshot ek hi screen par.</p>
          </div>
          <Link to="/platform/schools" className="rounded-full bg-white px-5 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100">Back to Schools</Link>
        </div>
      </section>

      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

      <section className="grid gap-5 xl:grid-cols-[1.35fr_1fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-slate-900">School Profile</h2>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {[
              ['Code', school?.school_code],
              ['Slug', school?.slug],
              ['Timezone', school?.timezone],
              ['Domain', school?.school_domain],
              ['Academic Session', school?.academic_session],
              ['Status', school?.status],
              ['Contact Email', school?.contact_email],
              ['Contact Phone', school?.contact_phone],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{label}</p>
                <p className="mt-2 text-sm font-medium text-slate-900">{value || '-'}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold text-slate-900">Lifecycle Controls</h2>
          <div className="mt-5 grid gap-3">
            {lifecycleActions.map((status) => (
              <button key={status} onClick={() => void handleStatus(status)} className="rounded-2xl border border-slate-300 px-4 py-3 text-left text-sm font-semibold text-slate-800 hover:bg-slate-50">
                Mark as {status}
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
