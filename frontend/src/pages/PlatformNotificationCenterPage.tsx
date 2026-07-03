import { useEffect, useState } from 'react';
import { apiService, getRequestErrorMessage } from '@services/api';
import type { PlatformNotification } from '@types';

export default function PlatformNotificationCenterPage() {
  const [notifications, setNotifications] = useState<PlatformNotification[]>([]);
  const [form, setForm] = useState({
    title: '',
    message: '',
    notification_type: 'maintenance',
    severity: 'info',
    audience_scope: 'all',
    school_ids: '',
  });
  const [error, setError] = useState<string | null>(null);

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

  const handleCreate = async () => {
    try {
      await apiService.createPlatformNotification({
        ...form,
        school_ids: form.school_ids.split(',').map((value) => value.trim()).filter(Boolean),
      });
      setForm({ title: '', message: '', notification_type: 'maintenance', severity: 'info', audience_scope: 'all', school_ids: '' });
      setError(null);
      await loadNotifications();
    } catch (requestError: any) {
      setError(getRequestErrorMessage(requestError, 'Notification create nahi ho paayi.'));
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] bg-gradient-to-br from-slate-950 via-indigo-900 to-sky-700 p-8 text-white shadow-xl">
        <p className="text-sm font-semibold uppercase tracking-[0.28em] text-indigo-100/80">Notification Center</p>
        <h1 className="mt-3 text-3xl font-bold">Platform Broadcasts</h1>
      </section>
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="grid gap-3 md:grid-cols-2">
          <input value={form.title} onChange={(e) => setForm((current) => ({ ...current, title: e.target.value }))} placeholder="Title" className="rounded-2xl border border-slate-300 px-4 py-3 text-sm" />
          <select value={form.notification_type} onChange={(e) => setForm((current) => ({ ...current, notification_type: e.target.value }))} className="rounded-2xl border border-slate-300 px-4 py-3 text-sm">
            <option value="maintenance">Maintenance Notice</option>
            <option value="subscription">Subscription Reminder</option>
            <option value="system_alert">System Alert</option>
            <option value="security_notice">Security Notice</option>
          </select>
          <select value={form.severity} onChange={(e) => setForm((current) => ({ ...current, severity: e.target.value }))} className="rounded-2xl border border-slate-300 px-4 py-3 text-sm">
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="critical">Critical</option>
          </select>
          <select value={form.audience_scope} onChange={(e) => setForm((current) => ({ ...current, audience_scope: e.target.value }))} className="rounded-2xl border border-slate-300 px-4 py-3 text-sm">
            <option value="school">Specific School</option>
            <option value="multiple">Multiple Schools</option>
            <option value="all">All Schools</option>
          </select>
          <textarea value={form.message} onChange={(e) => setForm((current) => ({ ...current, message: e.target.value }))} placeholder="Message" className="min-h-32 rounded-2xl border border-slate-300 px-4 py-3 text-sm md:col-span-2" />
          <input value={form.school_ids} onChange={(e) => setForm((current) => ({ ...current, school_ids: e.target.value }))} placeholder="Comma separated school IDs when scope is school or multiple" className="rounded-2xl border border-slate-300 px-4 py-3 text-sm md:col-span-2" />
        </div>
        <button onClick={() => void handleCreate()} className="mt-4 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800">Send Notification</button>
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
    </div>
  );
}
