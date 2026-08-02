import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { apiService, getRequestErrorMessage } from '@services/api';
import PlatformSchoolPicker from '@components/PlatformSchoolPicker';
import type { PlatformNotification, PlatformSchoolSummary } from '@types';

const NOTIFICATION_TYPE_LABELS: Record<string, string> = {
  maintenance: 'Maintenance Notice',
  subscription: 'Subscription Reminder',
  system_alert: 'System Alert',
  security_notice: 'Security Notice',
};

const SCOPE_LABELS: Record<string, string> = {
  school: 'Specific School',
  multiple: 'Multiple Schools',
  all: 'All Schools',
};

export default function PlatformNotificationCenterPage() {
  const [notifications, setNotifications] = useState<PlatformNotification[]>([]);
  const [form, setForm] = useState({
    title: '',
    message: '',
    notification_type: 'maintenance',
    severity: 'info',
    audience_scope: 'all',
  });
  const [selectedSchools, setSelectedSchools] = useState<PlatformSchoolSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);

  const loadNotifications = async () => {
    try {
      const response = await apiService.listPlatformNotifications();
      setNotifications(response.data.items || []);
    } catch (requestError: any) {
      setError(getRequestErrorMessage(requestError, 'Notifications load nahi ho paaye.'));
    }
  };

  useEffect(() => {
    void loadNotifications();
  }, []);

  const resetForm = () => {
    setForm({ title: '', message: '', notification_type: 'maintenance', severity: 'info', audience_scope: 'all' });
    setSelectedSchools([]);
  };

  const handleScopeChange = (scope: string) => {
    setForm((current) => ({ ...current, audience_scope: scope }));
    setSelectedSchools([]);
  };

  const handleSendClick = () => {
    setError(null);
    if (form.audience_scope !== 'all' && selectedSchools.length === 0) {
      setError('Please select one or more schools.');
      return;
    }
    setConfirmOpen(true);
  };

  const handleConfirmSend = async () => {
    setSending(true);
    setError(null);
    try {
      await apiService.createPlatformNotification({
        ...form,
        school_ids: selectedSchools.map((school) => school.id),
      });
      setConfirmOpen(false);
      resetForm();
      await loadNotifications();
    } catch (requestError: any) {
      setError(getRequestErrorMessage(requestError, 'Notification create nahi ho paayi.'));
      setConfirmOpen(false);
    } finally {
      setSending(false);
    }
  };

  const scope = form.audience_scope;
  const recipientLabel =
    scope === 'all' ? 'All Schools' : `${selectedSchools.length} ${selectedSchools.length === 1 ? 'School' : 'Schools'}`;

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] bg-gradient-to-br from-slate-950 via-indigo-900 to-sky-700 p-8 text-white shadow-xl">
        <p className="text-sm font-semibold uppercase tracking-[0.28em] text-indigo-100/80">Notification Center</p>
        <h1 className="mt-3 text-3xl font-bold">Platform Broadcasts</h1>
      </section>
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="grid gap-3 md:grid-cols-2">
          <input
            value={form.title}
            onChange={(e) => setForm((current) => ({ ...current, title: e.target.value }))}
            placeholder="Title"
            className="rounded-2xl border border-slate-300 px-4 py-3 text-sm"
          />
          <select
            value={form.notification_type}
            onChange={(e) => setForm((current) => ({ ...current, notification_type: e.target.value }))}
            className="rounded-2xl border border-slate-300 px-4 py-3 text-sm"
          >
            <option value="maintenance">Maintenance Notice</option>
            <option value="subscription">Subscription Reminder</option>
            <option value="system_alert">System Alert</option>
            <option value="security_notice">Security Notice</option>
          </select>
          <select
            value={form.severity}
            onChange={(e) => setForm((current) => ({ ...current, severity: e.target.value }))}
            className="rounded-2xl border border-slate-300 px-4 py-3 text-sm"
          >
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="critical">Critical</option>
          </select>
          <select
            value={form.audience_scope}
            onChange={(e) => handleScopeChange(e.target.value)}
            className="rounded-2xl border border-slate-300 px-4 py-3 text-sm"
          >
            <option value="school">Specific School</option>
            <option value="multiple">Multiple Schools</option>
            <option value="all">All Schools</option>
          </select>
          <textarea
            value={form.message}
            onChange={(e) => setForm((current) => ({ ...current, message: e.target.value }))}
            placeholder="Message"
            className="min-h-32 rounded-2xl border border-slate-300 px-4 py-3 text-sm md:col-span-2"
          />
          {scope !== 'all' && (
            <div className="md:col-span-2">
              <p className="mb-1.5 text-sm font-semibold text-slate-700">
                {scope === 'school' ? 'Select School' : 'Select Schools'}
              </p>
              <PlatformSchoolPicker
                mode={scope === 'school' ? 'single' : 'multiple'}
                value={selectedSchools}
                onChange={setSelectedSchools}
              />
            </div>
          )}
        </div>
        <button
          onClick={handleSendClick}
          className="mt-4 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800"
        >
          Send Notification
        </button>
        {error ? <p className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
      </section>
      <section className="grid gap-4 xl:grid-cols-2">
        {notifications.map((notification) => (
          <article key={notification.id} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">{notification.notification_type}</p>
            <h2 className="mt-2 text-xl font-bold text-slate-900">{notification.title}</h2>
            <p className="mt-3 text-sm text-slate-600">{notification.message}</p>
          </article>
        ))}
      </section>

      {confirmOpen &&
        createPortal(
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30 p-4">
            <div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-6 shadow-xl">
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-indigo-700">Confirm Broadcast</p>
              <h2 className="mt-1 text-xl font-bold text-slate-900">Review before sending</h2>

              <dl className="mt-4 space-y-3">
                <div className="flex gap-3">
                  <dt className="w-36 shrink-0 text-sm font-medium text-slate-500">Notification Type</dt>
                  <dd className="text-sm font-semibold text-slate-800">
                    {NOTIFICATION_TYPE_LABELS[form.notification_type] || form.notification_type}
                  </dd>
                </div>
                <div className="flex gap-3">
                  <dt className="w-36 shrink-0 text-sm font-medium text-slate-500">Scope</dt>
                  <dd className="text-sm font-semibold text-slate-800">{SCOPE_LABELS[scope] || scope}</dd>
                </div>
                <div className="flex gap-3">
                  <dt className="w-36 shrink-0 text-sm font-medium text-slate-500">School</dt>
                  <dd className="min-w-0 text-sm font-semibold text-slate-800">
                    {scope === 'all' ? (
                      'All Schools'
                    ) : (
                      <ul className="space-y-1">
                        {selectedSchools.map((school) => (
                          <li key={school.id}>
                            {school.name}
                            {school.school_code ? <span className="text-slate-500"> ({school.school_code})</span> : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </dd>
                </div>
                <div className="flex gap-3">
                  <dt className="w-36 shrink-0 text-sm font-medium text-slate-500">Recipients</dt>
                  <dd className="text-sm font-semibold text-slate-800">{recipientLabel}</dd>
                </div>
              </dl>

              <div className="mt-6 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmOpen(false)}
                  className="rounded-2xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleConfirmSend()}
                  disabled={sending}
                  className="rounded-2xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  {sending ? 'Sending...' : 'Confirm & Send'}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
