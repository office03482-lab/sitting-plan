import { useEffect, useState } from 'react';

import { apiService, getRequestErrorMessage } from '@services/api';
import type { SchoolSelfServiceProfile } from '@types';

const INPUT = 'w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-cyan-500';

export default function SchoolPreferencesPage() {
  const [profile, setProfile] = useState<SchoolSelfServiceProfile | null>(null);
  const [preferences, setPreferences] = useState<Record<string, unknown>>({});
  const [domainSettings, setDomainSettings] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const response = await apiService.getSchoolSelfServiceProfile();
      setProfile(response.data);
      setPreferences(response.data.preferences || {});
      setDomainSettings(response.data.domain_settings || {});
    } catch (requestError: any) {
      setError(getRequestErrorMessage(requestError, 'Preferences load nahi ho paayi.'));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async () => {
    try {
      setSaving(true);
      const [preferencesResponse, domainResponse] = await Promise.all([
        apiService.updateSchoolPreferences(preferences),
        apiService.updateSchoolDomainSettings(domainSettings),
      ]);
      setProfile(domainResponse.data);
      setPreferences(preferencesResponse.data.preferences || {});
      setDomainSettings(domainResponse.data.domain_settings || {});
      setMessage('School preferences updated.');
      setError(null);
    } catch (requestError: any) {
      setError(getRequestErrorMessage(requestError, 'Preferences save nahi ho paayi.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.28),_transparent_28%),linear-gradient(135deg,_#082f49,_#0f766e_45%,_#164e63)] p-8 text-white shadow-xl">
        <p className="text-sm font-semibold uppercase tracking-[0.28em] text-cyan-100/80">School Self-Service</p>
        <h1 className="mt-3 text-3xl font-bold">School Preferences</h1>
        <p className="mt-3 max-w-3xl text-sm text-cyan-50/90">Configure school-wide defaults, domain identity, and session preferences without touching tenant isolation or ERP workflows.</p>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900">Regional Preferences</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {[
              ['default_currency', 'Default Currency'],
              ['date_format', 'Date Format'],
              ['time_format', 'Time Format'],
              ['language', 'Language'],
              ['timezone', 'Timezone'],
              ['session_start', 'Session Start'],
              ['session_end', 'Session End'],
            ].map(([key, label]) => (
              <input
                key={key}
                value={String(preferences[key] || '')}
                onChange={(event) => setPreferences((current) => ({ ...current, [key]: event.target.value }))}
                placeholder={label}
                className={INPUT}
              />
            ))}
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900">Domain & SSL</h2>
          <div className="mt-4 grid gap-4">
            {[
              ['custom_domain', 'Custom Domain'],
              ['subdomain', 'Subdomain'],
              ['ssl_status', 'SSL Status'],
              ['verification_status', 'Verification Status'],
            ].map(([key, label]) => (
              <input
                key={key}
                value={String(domainSettings[key] || '')}
                onChange={(event) => setDomainSettings((current) => ({ ...current, [key]: event.target.value }))}
                placeholder={label}
                className={INPUT}
              />
            ))}
          </div>
          <p className="mt-4 text-sm text-slate-500">Examples: `portal.schoolname.com` or `school.yourdomain.com`.</p>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => void save()} disabled={saving} className="rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
            {saving ? 'Saving...' : 'Save Preferences'}
          </button>
          <div className="text-sm text-slate-500">School: {String(profile?.school_summary?.name || 'Current school')}</div>
        </div>
        {message ? <p className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</p> : null}
        {error ? <p className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
      </section>
    </div>
  );
}
