import { useEffect, useMemo, useState } from 'react';
import { Monitor, ShieldAlert, Smartphone, RefreshCw } from 'lucide-react';

import { apiService, getRequestErrorMessage } from '@services/api';
import type { ActiveSessionRecord } from '@types';

const formatDateTime = (value?: string | null) => {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

export default function SecuritySessionsPage() {
  const [sessions, setSessions] = useState<ActiveSessionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [processingProfileId, setProcessingProfileId] = useState<string | null>(null);

  const groupedSessions = useMemo(() => {
    const groups = new Map<string, { profileId: string; username: string; fullName: string; roleKey: string; sessions: ActiveSessionRecord[] }>();
    sessions.forEach((session) => {
      const existing = groups.get(session.profile_id);
      if (existing) {
        existing.sessions.push(session);
        return;
      }
      groups.set(session.profile_id, {
        profileId: session.profile_id,
        username: session.username,
        fullName: session.full_name,
        roleKey: session.role_key,
        sessions: [session],
      });
    });
    return Array.from(groups.values());
  }, [sessions]);

  const loadSessions = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await apiService.listSecuritySessions();
      setSessions(response.data || []);
    } catch (requestError: any) {
      setError(getRequestErrorMessage(requestError, 'Failed to load active sessions.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSessions();
  }, []);

  const handleLogoutAll = async (profileId: string) => {
    try {
      setProcessingProfileId(profileId);
      setMessage(null);
      await apiService.logoutAllProfileSessions(profileId);
      setMessage('All active sessions were terminated.');
      await loadSessions();
    } catch (requestError: any) {
      setError(getRequestErrorMessage(requestError, 'Failed to terminate sessions.'));
    } finally {
      setProcessingProfileId(null);
    }
  };

  const handleDisableAccount = async (profileId: string) => {
    try {
      setProcessingProfileId(profileId);
      setMessage(null);
      await apiService.disableProfileAccount(profileId);
      setMessage('Account disabled and active sessions terminated.');
      await loadSessions();
    } catch (requestError: any) {
      setError(getRequestErrorMessage(requestError, 'Failed to disable account.'));
    } finally {
      setProcessingProfileId(null);
    }
  };

  return (
    <div className="min-h-full bg-slate-50 px-4 py-8 md:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col gap-4 rounded-3xl bg-white p-6 shadow-sm md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-blue-700">Security & Sessions</p>
            <h1 className="mt-2 text-3xl font-bold text-slate-900">Active device monitoring</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              Review who is logged in, which device they are using, and force logout across portal accounts.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadSessions()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {message ? <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}
        {error ? <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

        <div className="mt-8 grid gap-5">
          {loading ? (
            <div className="rounded-3xl bg-white p-10 text-center text-sm text-slate-500 shadow-sm">Loading active sessions...</div>
          ) : groupedSessions.length === 0 ? (
            <div className="rounded-3xl bg-white p-10 text-center shadow-sm">
              <ShieldAlert className="mx-auto h-12 w-12 text-slate-300" />
              <h2 className="mt-4 text-xl font-semibold text-slate-900">No active sessions</h2>
              <p className="mt-2 text-sm text-slate-500">Session telemetry will appear here after portal users sign in.</p>
            </div>
          ) : (
            groupedSessions.map((group) => (
              <section key={group.profileId} className="rounded-3xl bg-white p-6 shadow-sm">
                <div className="flex flex-col gap-4 border-b border-slate-100 pb-5 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">{group.fullName || group.username}</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      {group.username} | {group.roleKey}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => void handleLogoutAll(group.profileId)}
                      disabled={processingProfileId === group.profileId}
                      className="inline-flex items-center justify-center rounded-full bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
                    >
                      {processingProfileId === group.profileId ? 'Processing...' : 'Logout All Devices'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDisableAccount(group.profileId)}
                      disabled={processingProfileId === group.profileId}
                      className="inline-flex items-center justify-center rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                    >
                      Disable Account
                    </button>
                  </div>
                </div>

                <div className="mt-5 grid gap-4 lg:grid-cols-2">
                  {group.sessions.map((session) => (
                    <div key={session.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-center gap-3">
                        <div className="rounded-2xl bg-white p-3 text-blue-700 shadow-sm">
                          {session.device_name?.toLowerCase().includes('mobile') ? (
                            <Smartphone className="h-5 w-5" />
                          ) : (
                            <Monitor className="h-5 w-5" />
                          )}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{session.device_name || 'Unknown device'}</p>
                          <p className="text-xs text-slate-500">{session.browser || 'Browser not detected'}</p>
                        </div>
                      </div>
                      <div className="mt-4 grid gap-2 text-sm text-slate-600">
                        <p><span className="font-semibold text-slate-800">IP:</span> {session.ip_address || 'Unavailable'}</p>
                        <p><span className="font-semibold text-slate-800">Login Time:</span> {formatDateTime(session.login_time)}</p>
                        <p><span className="font-semibold text-slate-800">Last Activity:</span> {formatDateTime(session.last_activity)}</p>
                        <p><span className="font-semibold text-slate-800">Status:</span> {session.status || (session.is_active ? 'active' : 'ended')}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
