import { useMemo, useState } from 'react';

import { apiService, getRequestErrorMessage } from '@services/api';
import type { PlatformOnboardingResponse } from '@types';

const INPUT =
  'w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-emerald-500';

type OnboardingForm = {
  school_code: string;
  slug: string;
  name: string;
  legal_name: string;
  board: string;
  academic_session: string;
  address: string;
  city: string;
  state: string;
  country: string;
  contact_phone: string;
  contact_email: string;
  website: string;
  timezone: string;
  language: string;
  logo_url: string;
  school_domain: string;
  plan_tier: string;
  billing_cycle: string;
  max_students: string;
  max_teachers: string;
  max_staff: string;
  max_parents: string;
  max_storage_gb: string;
  admin_full_name: string;
  admin_email: string;
  admin_mobile: string;
  admin_employee_code: string;
};

const initialForm: OnboardingForm = {
  school_code: '',
  slug: '',
  name: '',
  legal_name: '',
  board: '',
  academic_session: '',
  address: '',
  city: '',
  state: '',
  country: 'India',
  contact_phone: '',
  contact_email: '',
  website: '',
  timezone: 'Asia/Kolkata',
  language: 'English',
  logo_url: '',
  school_domain: '',
  plan_tier: 'starter',
  billing_cycle: 'monthly',
  max_students: '100',
  max_teachers: '10',
  max_staff: '10',
  max_parents: '50',
  max_storage_gb: '5',
  admin_full_name: '',
  admin_email: '',
  admin_mobile: '',
  admin_employee_code: '',
};

export default function PlatformOnboardingWizardPage() {
  const [form, setForm] = useState<OnboardingForm>(initialForm);
  const [result, setResult] = useState<PlatformOnboardingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copyLabel, setCopyLabel] = useState('Copy Credentials');

  const provisioningItems = useMemo(
    () =>
      result
        ? Object.entries(result.provisioning).map(([key, value]) => ({
            key,
            value,
          }))
        : [],
    [result],
  );

  const updateField = (key: keyof OnboardingForm, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const buildPayload = () => ({
    ...form,
    school_code: form.school_code || undefined,
    slug: form.slug || undefined,
    legal_name: form.legal_name || undefined,
    board: form.board || undefined,
    academic_session: form.academic_session || undefined,
    address: form.address || undefined,
    city: form.city || undefined,
    state: form.state || undefined,
    country: form.country || undefined,
    contact_phone: form.contact_phone || undefined,
    contact_email: form.contact_email || undefined,
    website: form.website || undefined,
    logo_url: form.logo_url || undefined,
    school_domain: form.school_domain || undefined,
    admin_mobile: form.admin_mobile || undefined,
    admin_employee_code: form.admin_employee_code || undefined,
    max_students: Number(form.max_students || 0),
    max_teachers: Number(form.max_teachers || 0),
    max_staff: Number(form.max_staff || 0),
    max_parents: Number(form.max_parents || 0),
    max_storage_gb: Number(form.max_storage_gb || 0),
  });

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const response = await apiService.runPlatformOnboarding(buildPayload());
      setResult(response.data);
      setError(null);
    } catch (requestError: any) {
      setError(getRequestErrorMessage(requestError, 'Onboarding wizard complete nahi ho paaya.'));
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!result) return;
    const value = [
      `School: ${result.school.name}`,
      `School Code: ${result.school.school_code}`,
      `Admin: ${result.admin.full_name}`,
      `Username: ${result.credentials.username}`,
      `Login Email: ${result.credentials.login_email}`,
      `Temporary Password: ${result.credentials.temporary_password}`,
      `Login URL: ${result.credentials.login_url}`,
    ].join('\n');
    await navigator.clipboard.writeText(value);
    setCopyLabel('Copied');
    window.setTimeout(() => setCopyLabel('Copy Credentials'), 1200);
  };

  const handlePrint = () => {
    window.print();
  };

  const handleDownload = () => {
    if (!result) return;
    const blob = new Blob(
      [
        [
          'School Onboarding Credentials',
          `School: ${result.school.name}`,
          `School Code: ${result.school.school_code}`,
          `Admin Username: ${result.credentials.username}`,
          `Login Email: ${result.credentials.login_email}`,
          `Temporary Password: ${result.credentials.temporary_password}`,
          `Login URL: ${result.credentials.login_url}`,
        ].join('\n'),
      ],
      { type: 'text/plain;charset=utf-8' },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${result.school.school_code || 'school'}-credentials.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleRegenerate = async () => {
    if (!result) return;
    try {
      const response = await apiService.regeneratePlatformSchoolAdminPassword(result.school.id);
      setResult((current) =>
        current
          ? {
              ...current,
              credentials: response.data,
              audit_events: [...current.audit_events, 'platform.onboarding.credentials_regenerated'],
            }
          : current,
      );
      setError(null);
    } catch (requestError: any) {
      setError(getRequestErrorMessage(requestError, 'Temporary password regenerate nahi ho paaya.'));
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] bg-[radial-gradient(circle_at_top_left,_rgba(52,211,153,0.35),_transparent_35%),linear-gradient(135deg,_#020617,_#14532d_45%,_#0f766e)] p-8 text-white shadow-xl">
        <p className="text-sm font-semibold uppercase tracking-[0.28em] text-lime-100/80">School Onboarding Wizard</p>
        <h1 className="mt-3 text-3xl font-bold">Launch a new school with first-login readiness</h1>
        <p className="mt-3 max-w-3xl text-sm text-emerald-50/90">
          Create the school, provision the baseline platform setup, create the school admin, and hand over one-time credentials in a single workflow.
        </p>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="grid gap-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Step 1</p>
              <h2 className="mt-2 text-xl font-bold text-slate-900">School creation</h2>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {[
                  ['name', 'School Name'],
                  ['school_code', 'School Code (optional)'],
                  ['slug', 'Slug (optional)'],
                  ['legal_name', 'Legal Name'],
                  ['board', 'Board'],
                  ['academic_session', 'Academic Session'],
                  ['contact_phone', 'Phone'],
                  ['contact_email', 'Email'],
                  ['website', 'Website'],
                  ['school_domain', 'School Domain'],
                  ['timezone', 'Timezone'],
                  ['language', 'Language'],
                  ['address', 'Address'],
                  ['city', 'City'],
                  ['state', 'State'],
                  ['country', 'Country'],
                  ['logo_url', 'Logo URL'],
                ].map(([key, label]) => (
                  <input
                    key={key}
                    value={form[key as keyof OnboardingForm]}
                    onChange={(event) => updateField(key as keyof OnboardingForm, event.target.value)}
                    placeholder={label}
                    className={INPUT}
                  />
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Step 2</p>
              <h2 className="mt-2 text-xl font-bold text-slate-900">Plan and limits</h2>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <select value={form.plan_tier} onChange={(event) => updateField('plan_tier', event.target.value)} className={INPUT}>
                  <option value="starter">Starter</option>
                  <option value="basic">Basic</option>
                  <option value="standard">Standard</option>
                  <option value="premium">Premium</option>
                  <option value="enterprise">Enterprise</option>
                </select>
                <select value={form.billing_cycle} onChange={(event) => updateField('billing_cycle', event.target.value)} className={INPUT}>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </select>
                {[
                  ['max_students', 'Maximum Students'],
                  ['max_teachers', 'Maximum Teachers'],
                  ['max_staff', 'Maximum Staff'],
                  ['max_parents', 'Maximum Parents'],
                  ['max_storage_gb', 'Maximum Storage (GB)'],
                ].map(([key, label]) => (
                  <input
                    key={key}
                    type="number"
                    min="0"
                    value={form[key as keyof OnboardingForm]}
                    onChange={(event) => updateField(key as keyof OnboardingForm, event.target.value)}
                    placeholder={label}
                    className={INPUT}
                  />
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Step 3</p>
              <h2 className="mt-2 text-xl font-bold text-slate-900">School admin information</h2>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {[
                  ['admin_full_name', 'Admin Full Name'],
                  ['admin_email', 'Admin Email'],
                  ['admin_mobile', 'Admin Mobile'],
                  ['admin_employee_code', 'Employee Code (optional)'],
                ].map(([key, label]) => (
                  <input
                    key={key}
                    value={form[key as keyof OnboardingForm]}
                    onChange={(event) => updateField(key as keyof OnboardingForm, event.target.value)}
                    placeholder={label}
                    className={INPUT}
                  />
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={loading}
              className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {loading ? 'Provisioning school...' : 'Run Onboarding'}
            </button>

            {error ? <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
          </div>
        </div>

        <div className="space-y-6">
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">Provisioning Coverage</p>
            <div className="mt-4 grid gap-3">
              {[
                'School',
                'School Settings',
                'Academic Session',
                'Roles and Permissions',
                'Attendance / Timetable / Exam defaults',
                'Usage Counters',
                'Subscription',
                'AI Wallet',
                'School Admin Account',
                'First Login Enforcement',
              ].map((item) => (
                <div key={item} className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  {item}
                </div>
              ))}
            </div>
          </section>

          {result ? (
            <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-700">Credentials Visible Once</p>
              <h2 className="mt-2 text-2xl font-bold text-slate-900">School created successfully</h2>
              <div className="mt-4 space-y-3 text-sm text-slate-700">
                <div><span className="font-semibold text-slate-900">School:</span> {result.school.name}</div>
                <div><span className="font-semibold text-slate-900">School Code:</span> {result.school.school_code}</div>
                <div><span className="font-semibold text-slate-900">Admin Username:</span> {result.credentials.username}</div>
                <div><span className="font-semibold text-slate-900">Login Email:</span> {result.credentials.login_email}</div>
                <div><span className="font-semibold text-slate-900">Temporary Password:</span> {result.credentials.temporary_password}</div>
                <div><span className="font-semibold text-slate-900">Login URL:</span> {result.credentials.login_url}</div>
              </div>

              <div className="mt-5 flex flex-wrap gap-3">
                <button type="button" onClick={() => void handleCopy()} className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">{copyLabel}</button>
                <button type="button" onClick={handlePrint} className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-white">Print</button>
                <button type="button" onClick={handleDownload} className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-white">Download PDF</button>
                <a
                  href={`mailto:${result.admin.email}?subject=${encodeURIComponent(`Welcome to ${result.school.name}`)}&body=${encodeURIComponent(`Username: ${result.credentials.username}\nTemporary Password: ${result.credentials.temporary_password}\nLogin URL: ${result.credentials.login_url}`)}`}
                  className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-white"
                >
                  Send Email
                </a>
                <button type="button" onClick={() => void handleRegenerate()} className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-white">Regenerate Password</button>
              </div>

              <div className="mt-6 rounded-2xl bg-white p-4">
                <p className="text-sm font-semibold text-slate-900">Provisioning status</p>
                <div className="mt-3 grid gap-2">
                  {provisioningItems.map((item) => (
                    <div key={item.key} className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-2 text-sm">
                      <span className="text-slate-600">{item.key.replace(/_/g, ' ')}</span>
                      <span className={`font-semibold ${item.value ? 'text-emerald-700' : 'text-amber-700'}`}>{item.value ? 'Ready' : 'Pending'}</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          ) : null}
        </div>
      </section>
    </div>
  );
}
