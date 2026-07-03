import { useEffect, useState } from 'react';

import { apiService, getRequestErrorMessage } from '@services/api';

const TEMPLATE_LABELS: Record<string, string> = {
  parent_alerts: 'Parent Alerts',
  fee_due: 'Fee Due',
  attendance: 'Attendance',
  emergency_notice: 'Emergency Notice',
};

export default function SchoolSmsTemplatesPage() {
  const [templates, setTemplates] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const response = await apiService.getSchoolSelfServiceProfile();
        setTemplates(response.data.messaging_templates || {});
      } catch (requestError: any) {
        setError(getRequestErrorMessage(requestError, 'SMS templates load nahi ho paaye.'));
      }
    })();
  }, []);

  const save = async () => {
    try {
      setSaving(true);
      const response = await apiService.updateSchoolMessagingTemplates(templates);
      setTemplates(response.data.messaging_templates || {});
      setMessage('SMS / WhatsApp templates updated.');
      setError(null);
    } catch (requestError: any) {
      setError(getRequestErrorMessage(requestError, 'SMS templates save nahi ho paaye.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] bg-[radial-gradient(circle_at_top_left,_rgba(167,139,250,0.28),_transparent_28%),linear-gradient(135deg,_#312e81,_#6d28d9_45%,_#0f766e)] p-8 text-white shadow-xl">
        <p className="text-sm font-semibold uppercase tracking-[0.28em] text-violet-100/80">School Self-Service</p>
        <h1 className="mt-3 text-3xl font-bold">SMS / WhatsApp Templates</h1>
        <p className="mt-3 max-w-3xl text-sm text-violet-50/90">Own the tone of parent-facing communication while preserving platform auditability and tenant isolation.</p>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="grid gap-5">
          {Object.entries(TEMPLATE_LABELS).map(([key, label]) => (
            <div key={key}>
              <label className="mb-2 block text-sm font-semibold text-slate-700">{label}</label>
              <textarea
                value={templates[key] || ''}
                onChange={(event) => setTemplates((current) => ({ ...current, [key]: event.target.value }))}
                rows={4}
                className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-violet-500"
                placeholder={`Template for ${label}`}
              />
            </div>
          ))}
        </div>
        <button type="button" onClick={() => void save()} disabled={saving} className="mt-6 rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
          {saving ? 'Saving...' : 'Save Messaging Templates'}
        </button>
        {message ? <p className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</p> : null}
        {error ? <p className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
      </section>
    </div>
  );
}
