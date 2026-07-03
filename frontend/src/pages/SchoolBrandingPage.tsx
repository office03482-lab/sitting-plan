import { useEffect, useState } from 'react';

import { apiService, getRequestErrorMessage } from '@services/api';

const INPUT = 'w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-emerald-500';

export default function SchoolBrandingPage() {
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadProfile = async () => {
    try {
      setLoading(true);
      const response = await apiService.getSchoolSelfServiceProfile();
      setForm(response.data.branding || {});
      setError(null);
    } catch (requestError: any) {
      setError(getRequestErrorMessage(requestError, 'School branding load nahi ho paayi.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadProfile();
  }, []);

  const updateField = (key: string, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const saveBranding = async () => {
    try {
      setSaving(true);
      const response = await apiService.updateSchoolBranding(form);
      setForm(response.data.branding || {});
      setMessage('Branding updated successfully.');
      setError(null);
    } catch (requestError: any) {
      setError(getRequestErrorMessage(requestError, 'Branding save nahi ho paayi.'));
    } finally {
      setSaving(false);
    }
  };

  const uploadAsset = async (assetType: string, file?: File | null) => {
    if (!file) return;
    try {
      await apiService.uploadSchoolBrandAsset(assetType, file);
      await loadProfile();
      setMessage(`${assetType.replace(/_/g, ' ')} uploaded.`);
    } catch (requestError: any) {
      setError(getRequestErrorMessage(requestError, `Asset upload failed for ${assetType}.`));
    }
  };

  if (loading) {
    return <div className="rounded-3xl bg-white p-8 shadow-sm">Loading branding...</div>;
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] bg-[radial-gradient(circle_at_top_left,_rgba(74,222,128,0.22),_transparent_30%),linear-gradient(135deg,_#022c22,_#14532d_45%,_#064e3b)] p-8 text-white shadow-xl">
        <p className="text-sm font-semibold uppercase tracking-[0.28em] text-emerald-100/80">School Self-Service</p>
        <h1 className="mt-3 text-3xl font-bold">School Branding</h1>
        <p className="mt-3 max-w-3xl text-sm text-emerald-50/90">Control how your school looks across the shared SaaS ERP without changing the underlying platform.</p>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="grid gap-4 md:grid-cols-2">
            {[
              ['school_name', 'School Name'],
              ['portal_name', 'Portal Name'],
              ['tagline', 'Tagline'],
              ['website', 'Website'],
              ['email', 'School Email'],
              ['phone', 'School Phone'],
              ['principal_name', 'Principal Name'],
              ['address', 'School Address'],
              ['welcome_message', 'Welcome Message'],
              ['footer_text', 'Footer'],
            ].map(([key, label]) => (
              <input
                key={key}
                value={String(form[key] || '')}
                onChange={(event) => updateField(key, event.target.value)}
                placeholder={label}
                className={INPUT}
              />
            ))}

            <input type="color" value={String(form.primary_color || '#0f766e')} onChange={(event) => updateField('primary_color', event.target.value)} className={`${INPUT} h-14`} />
            <input type="color" value={String(form.secondary_color || '#1d4ed8')} onChange={(event) => updateField('secondary_color', event.target.value)} className={`${INPUT} h-14`} />
            <input type="color" value={String(form.accent_color || '#f59e0b')} onChange={(event) => updateField('accent_color', event.target.value)} className={`${INPUT} h-14`} />
            <select value={String(form.theme || 'auto')} onChange={(event) => updateField('theme', event.target.value)} className={INPUT}>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="auto">Auto</option>
            </select>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <button type="button" onClick={() => void saveBranding()} disabled={saving} className="rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
              {saving ? 'Saving...' : 'Save Branding'}
            </button>
          </div>
          {message ? <p className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</p> : null}
          {error ? <p className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
        </div>

        <div className="space-y-6">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-bold text-slate-900">Brand Assets</h2>
            <div className="mt-4 grid gap-4">
              {[
                ['logo', 'School Logo'],
                ['banner', 'School Banner'],
                ['favicon', 'School Icon'],
                ['background_image', 'Login Background'],
                ['principal_signature', 'Principal Signature'],
                ['official_seal', 'Official Seal'],
                ['report_card_header', 'Report Card Header'],
                ['certificate_header', 'Certificate Header'],
              ].map(([assetType, label]) => (
                <label key={assetType} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  <span className="font-semibold text-slate-900">{label}</span>
                  <input type="file" className="mt-3 block w-full text-sm" onChange={(event) => void uploadAsset(assetType, event.target.files?.[0] || null)} />
                </label>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-bold text-slate-900">Current Visual Identity</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {[
                ['logo_url', 'Logo'],
                ['banner_url', 'Banner'],
                ['favicon_url', 'Favicon'],
                ['background_image_url', 'Background'],
              ].map(([key, label]) => (
                <div key={key} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-sm font-semibold text-slate-900">{label}</p>
                  {String(form[key] || '') ? <img src={String(form[key] || '')} alt={label} className="mt-3 h-24 w-full rounded-2xl object-cover" /> : <p className="mt-3 text-sm text-slate-500">Not uploaded yet.</p>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
