import { useState } from 'react';
import { apiService, getRequestErrorMessage } from '@services/api';
import type { PlatformOnboardingResponse } from '@types';

export default function PlatformOnboardingWizardPage() {
  const [form, setForm] = useState({
    school_code: '',
    slug: '',
    name: '',
    legal_name: '',
    timezone: 'Asia/Kolkata',
    contact_email: '',
    contact_phone: '',
    academic_session: '',
    plan_tier: 'starter',
    billing_cycle: 'monthly',
  });
  const [result, setResult] = useState<PlatformOnboardingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    try {
      const response = await apiService.runPlatformOnboarding(form);
      setResult(response.data);
      setError(null);
    } catch (requestError: any) {
      setError(getRequestErrorMessage(requestError, 'Onboarding wizard complete nahi ho paaya.'));
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] bg-gradient-to-br from-slate-950 via-emerald-900 to-lime-700 p-8 text-white shadow-xl">
        <p className="text-sm font-semibold uppercase tracking-[0.28em] text-lime-100/80">School Onboarding Wizard</p>
        <h1 className="mt-3 text-3xl font-bold">Launch a New School</h1>
      </section>
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="grid gap-3 md:grid-cols-2">
          {[
            ['school_code', 'School Code'],
            ['slug', 'Slug'],
            ['name', 'School Name'],
            ['legal_name', 'Legal Name'],
            ['timezone', 'Timezone'],
            ['contact_email', 'Contact Email'],
            ['contact_phone', 'Contact Phone'],
            ['academic_session', 'Academic Session'],
          ].map(([key, label]) => (
            <input key={key} value={(form as any)[key]} onChange={(e) => setForm((current) => ({ ...current, [key]: e.target.value }))} placeholder={label} className="rounded-2xl border border-slate-300 px-4 py-3 text-sm" />
          ))}
          <select value={form.plan_tier} onChange={(e) => setForm((current) => ({ ...current, plan_tier: e.target.value }))} className="rounded-2xl border border-slate-300 px-4 py-3 text-sm">
            <option value="starter">Starter</option>
            <option value="basic">Basic</option>
            <option value="standard">Standard</option>
            <option value="premium">Premium</option>
            <option value="enterprise">Enterprise</option>
          </select>
          <select value={form.billing_cycle} onChange={(e) => setForm((current) => ({ ...current, billing_cycle: e.target.value }))} className="rounded-2xl border border-slate-300 px-4 py-3 text-sm">
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
        </div>
        <button onClick={() => void handleSubmit()} className="mt-4 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800">Run Onboarding</button>
        {error ? <p className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
      </section>
      {result ? <pre className="overflow-auto rounded-2xl bg-slate-950 p-4 text-xs text-slate-100">{JSON.stringify(result, null, 2)}</pre> : null}
    </div>
  );
}
