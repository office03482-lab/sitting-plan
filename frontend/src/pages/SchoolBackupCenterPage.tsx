import { useEffect, useState } from 'react';

import { apiService, getRequestErrorMessage } from '@services/api';
import type { SchoolBackupHistoryItem } from '@types';

export default function SchoolBackupCenterPage() {
  const [items, setItems] = useState<SchoolBackupHistoryItem[]>([]);
  const [notes, setNotes] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingAction, setLoadingAction] = useState<'backup' | 'restore' | null>(null);

  const loadHistory = async () => {
    try {
      const response = await apiService.getSchoolBackupHistory();
      setItems(response.data.items || []);
      setError(null);
    } catch (requestError: any) {
      setError(getRequestErrorMessage(requestError, 'Backup history load nahi ho paayi.'));
    }
  };

  useEffect(() => {
    void loadHistory();
  }, []);

  const runAction = async (type: 'backup' | 'restore') => {
    try {
      setLoadingAction(type);
      const response =
        type === 'backup'
          ? await apiService.requestSchoolBackup(notes || undefined)
          : await apiService.requestSchoolRestore(notes || undefined);
      setItems(response.data.items || []);
      setMessage(type === 'backup' ? 'Backup request submitted.' : 'Restore request submitted.');
      setError(null);
      setNotes('');
    } catch (requestError: any) {
      setError(getRequestErrorMessage(requestError, `${type} request submit nahi ho paayi.`));
    } finally {
      setLoadingAction(null);
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-[2rem] bg-[radial-gradient(circle_at_top_left,_rgba(236,72,153,0.22),_transparent_28%),linear-gradient(135deg,_#4a044e,_#831843_45%,_#1d4ed8)] p-8 text-white shadow-xl">
        <p className="text-sm font-semibold uppercase tracking-[0.28em] text-fuchsia-100/80">School Self-Service</p>
        <h1 className="mt-3 text-3xl font-bold">Backup Center</h1>
        <p className="mt-3 max-w-3xl text-sm text-fuchsia-50/90">Request school-scoped backups or restore reviews while keeping audit trails and tenant isolation intact.</p>
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900">Request Action</h2>
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={5}
            placeholder="Add optional notes for backup or restore review"
            className="mt-4 w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-fuchsia-500"
          />
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void runAction('backup')}
              disabled={loadingAction !== null}
              className="rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {loadingAction === 'backup' ? 'Requesting...' : 'Request Backup'}
            </button>
            <button
              type="button"
              onClick={() => void runAction('restore')}
              disabled={loadingAction !== null}
              className="rounded-full border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {loadingAction === 'restore' ? 'Requesting...' : 'Request Restore Review'}
            </button>
          </div>
          {message ? <p className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</p> : null}
          {error ? <p className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900">Backup History</h2>
          <div className="mt-4 overflow-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Notes</th>
                  <th className="px-3 py-2">Created</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-b border-slate-100">
                    <td className="px-3 py-3 capitalize">{item.request_type}</td>
                    <td className="px-3 py-3 capitalize">{item.status}</td>
                    <td className="px-3 py-3">{item.notes || 'No notes'}</td>
                    <td className="px-3 py-3">{item.created_at ? new Date(item.created_at).toLocaleString() : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {items.length === 0 ? <p className="px-3 py-6 text-sm text-slate-500">No backup requests yet.</p> : null}
          </div>
        </div>
      </section>
    </div>
  );
}
