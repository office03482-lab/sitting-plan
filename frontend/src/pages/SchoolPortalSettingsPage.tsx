import { useEffect, useState } from 'react';

import { apiService, getRequestErrorMessage } from '@services/api';

const INPUT = 'w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-blue-500';

export default function SchoolPortalSettingsPage() {
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const normalizePortalSettings = (portalSettings: Record<string, any>) => ({
    ...portalSettings,
    working_days: Array.isArray(portalSettings.working_days) ? portalSettings.working_days.join(', ') : '',
    minimum_attendance_threshold: portalSettings.attendance_rules?.minimum_attendance_threshold || 75,
    working_hours_start: portalSettings.attendance_rules?.working_hours_start || '09:00',
    working_hours_end: portalSettings.attendance_rules?.working_hours_end || '17:00',
    notification_email: Boolean(portalSettings.notification_preferences?.email),
    notification_sms: Boolean(portalSettings.notification_preferences?.sms),
    notification_whatsapp: Boolean(portalSettings.notification_preferences?.whatsapp),
    ai_enabled: Boolean(portalSettings.ai_preferences?.enabled),
    ai_guardian_mode: String(portalSettings.ai_preferences?.guardian_mode || 'assisted'),
  });

  useEffect(() => {
    (async () => {
      try {
        const response = await apiService.getSchoolSelfServiceProfile();
        setForm(normalizePortalSettings(response.data.portal_settings || {}));
      } catch (requestError: any) {
        setError(getRequestErrorMessage(requestError, 'Portal settings load nahi ho paaye.'));
      }
    })();
  }, []);

  const save = async () => {
    try {
      setSaving(true);
      const payload = {
        ...form,
        periods_per_day: Number(form.periods_per_day || 0),
        working_days: String(form.working_days || '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
        attendance_rules: {
          minimum_attendance_threshold: Number(form.minimum_attendance_threshold || 75),
          working_hours_start: String(form.working_hours_start || '09:00'),
          working_hours_end: String(form.working_hours_end || '17:00'),
        },
        notification_preferences: {
          email: Boolean(form.notification_email),
          sms: Boolean(form.notification_sms),
          whatsapp: Boolean(form.notification_whatsapp),
        },
        ai_preferences: {
          enabled: Boolean(form.ai_enabled),
          guardian_mode: String(form.ai_guardian_mode || 'assisted'),
        },
      };
      const response = await apiService.updateSchoolPortalSettings(payload);
      const portalSettings = response.data.portal_settings || {};
      setForm(normalizePortalSettings(portalSettings));
      setMessage('Portal settings updated.');
      setError(null);
    } catch (requestError: any) {
      setError(getRequestErrorMessage(requestError, 'Portal settings save nahi ho paaye.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] bg-[radial-gradient(circle_at_top_left,_rgba(96,165,250,0.22),_transparent_25%),linear-gradient(135deg,_#172554,_#1d4ed8_45%,_#0f766e)] p-8 text-white shadow-xl">
        <p className="text-sm font-semibold uppercase tracking-[0.28em] text-blue-100/80">School Self-Service</p>
        <h1 className="mt-3 text-3xl font-bold">Portal Settings</h1>
        <p className="mt-3 max-w-3xl text-sm text-blue-50/90">Configure academic year, attendance rules, periods, examination defaults, notifications, AI preferences, and school-local portal behavior.</p>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900">Academic & Scheduling</h2>
          <div className="mt-4 grid gap-4">
            {[
              ['academic_year', 'Academic Year'],
              ['working_days', 'Working Days (comma separated)'],
              ['periods_per_day', 'Periods Per Day'],
              ['exam_pattern', 'Exam Pattern'],
              ['grade_system', 'Grade System'],
              ['language', 'Language'],
              ['timezone', 'Timezone'],
            ].map(([key, label]) => (
              <input
                key={key}
                value={String(form[key] || '')}
                onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
                placeholder={label}
                className={INPUT}
              />
            ))}
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900">Attendance, Notifications & AI</h2>
          <div className="mt-4 grid gap-4">
            {[
              ['minimum_attendance_threshold', 'Minimum Attendance Threshold'],
              ['working_hours_start', 'Working Hours Start'],
              ['working_hours_end', 'Working Hours End'],
              ['ai_guardian_mode', 'AI Guardian Mode'],
            ].map(([key, label]) => (
              <input
                key={key}
                value={String(form[key] || '')}
                onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
                placeholder={label}
                className={INPUT}
              />
            ))}
            <label className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              <input type="checkbox" checked={Boolean(form.notification_email)} onChange={(event) => setForm((current) => ({ ...current, notification_email: event.target.checked }))} className="mr-2" />
              Email Notifications
            </label>
            <label className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              <input type="checkbox" checked={Boolean(form.notification_sms)} onChange={(event) => setForm((current) => ({ ...current, notification_sms: event.target.checked }))} className="mr-2" />
              SMS Notifications
            </label>
            <label className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              <input type="checkbox" checked={Boolean(form.notification_whatsapp)} onChange={(event) => setForm((current) => ({ ...current, notification_whatsapp: event.target.checked }))} className="mr-2" />
              WhatsApp Notifications
            </label>
            <label className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              <input type="checkbox" checked={Boolean(form.ai_enabled)} onChange={(event) => setForm((current) => ({ ...current, ai_enabled: event.target.checked }))} className="mr-2" />
              AI Preferences Enabled
            </label>
          </div>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <button type="button" onClick={() => void save()} disabled={saving} className="rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
          {saving ? 'Saving...' : 'Save Portal Settings'}
        </button>
        {message ? <p className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</p> : null}
        {error ? <p className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
      </section>
    </div>
  );
}
