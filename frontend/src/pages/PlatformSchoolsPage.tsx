import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiService, getRequestErrorMessage } from '@services/api';
import type { PlatformSchoolSummary } from '@types';

export default function PlatformSchoolsPage() {
  const [schools, setSchools] = useState<PlatformSchoolSummary[]>([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);

  const loadSchools = async () => {
    try {
      const response = await apiService.listPlatformSchools({
        q: query || undefined,
        status: status || undefined,
      });
      setSchools(response.data.items || []);
      setError(null);
    } catch (requestError: any) {
      setError(getRequestErrorMessage(requestError, 'Schools load nahi ho paaye.'));
    }
  };

  useEffect(() => {
    void loadSchools();
  }, []);

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] bg-gradient-to-br from-slate-950 via-emerald-900 to-cyan-700 p-8 text-white shadow-xl">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.28em] text-emerald-100/80">Platform Control Plane</p>
            <h1 className="mt-3 text-3xl font-bold">Schools Management</h1>
            <p className="mt-3 max-w-3xl text-sm text-emerald-50/90">Create, filter, inspect, suspend, reactivate, archive, aur soft-delete schools from one place.</p>
          </div>
          <Link to="/platform/onboarding" className="rounded-full bg-white px-5 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100">Open Onboarding Wizard</Link>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-3 md:grid-cols-[1.2fr_0.8fr_auto]">
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search school code, slug, name, email" className="rounded-2xl border border-slate-300 px-4 py-3 text-sm" />
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-2xl border border-slate-300 px-4 py-3 text-sm">
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="archived">Archived</option>
            <option value="deleted">Deleted</option>
          </select>
          <button onClick={() => void loadSchools()} className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800">Refresh</button>
        </div>
        {error ? <p className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        {schools.map((school) => (
          <article key={school.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">{school.school_code}</p>
                <h2 className="mt-2 text-2xl font-bold text-slate-900">{school.name}</h2>
                <p className="mt-1 text-sm text-slate-500">{school.slug} • {school.timezone}</p>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-700">{school.status}</span>
            </div>
            <div className="mt-5 grid grid-cols-3 gap-3 text-sm">
              <div className="rounded-2xl bg-slate-50 p-3"><p className="text-slate-500">Students</p><p className="mt-1 text-xl font-bold text-slate-900">{school.student_count}</p></div>
              <div className="rounded-2xl bg-slate-50 p-3"><p className="text-slate-500">Teachers</p><p className="mt-1 text-xl font-bold text-slate-900">{school.teacher_count}</p></div>
              <div className="rounded-2xl bg-slate-50 p-3"><p className="text-slate-500">Staff</p><p className="mt-1 text-xl font-bold text-slate-900">{school.staff_count}</p></div>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link to={`/platform/schools/${school.id}`} className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">Open Details</Link>
              <Link to={`/platform/subscriptions?school_id=${school.id}`} className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Subscription</Link>
              <Link to={`/platform/support?school_id=${school.id}`} className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Support</Link>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
