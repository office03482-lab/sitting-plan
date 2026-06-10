import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, Search } from 'lucide-react';
import { apiService, getRequestErrorMessage } from '@services/api';
import type { PlatformAuditLog } from '@types';

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function summarizePayload(payload: Record<string, unknown>) {
  const keys = Object.keys(payload || {});
  if (!keys.length) return 'No payload';
  return keys.slice(0, 4).map((key) => `${key}: ${String(payload[key])}`).join(' | ');
}

export default function PlatformAuditLogs() {
  const [logs, setLogs] = useState<PlatformAuditLog[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [moduleKey, setModuleKey] = useState('');
  const [action, setAction] = useState('');
  const [offset, setOffset] = useState(0);
  const pageSize = 50;

  const loadLogs = async (nextOffset: number = offset) => {
    setLoading(true);
    try {
      const response = await apiService.listPlatformAuditLogs({
        q: search || undefined,
        module_key: moduleKey || undefined,
        action: action || undefined,
        limit: pageSize,
        offset: nextOffset,
      });
      setLogs(response.data?.items || []);
      setTotalCount(response.data?.total_count || 0);
      setOffset(nextOffset);
      setError(null);
    } catch (requestError: any) {
      setError(getRequestErrorMessage(requestError, 'Audit logs load nahi ho paaye.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadLogs();
  }, []);

  const canGoPrev = offset > 0;
  const canGoNext = offset + logs.length < totalCount;
  const pageStart = totalCount ? offset + 1 : 0;
  const pageEnd = offset + logs.length;

  const actionOptions = useMemo(
    () => Array.from(new Set(logs.map((log) => log.action).filter(Boolean))).sort(),
    [logs],
  );
  const moduleOptions = useMemo(
    () => Array.from(new Set(logs.map((log) => log.module_key).filter(Boolean) as string[])).sort(),
    [logs],
  );

  return (
    <div className="space-y-6">
      <div className="rounded-[2rem] border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.28em] text-sky-700">Platform Administration</p>
            <h1 className="mt-3 text-3xl font-bold text-slate-900">Audit Logs</h1>
            <p className="mt-3 max-w-3xl text-sm text-slate-500">
              Workflow aur admin actions ka read-only audit trail with search and filters.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link to="/platform/dashboard" className="rounded-full border border-slate-300 px-5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              Platform Dashboard
            </Link>
            <Link to="/platform/workflow" className="rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800">
              Workflow Queue
            </Link>
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : null}

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[1.4fr_0.9fr_0.9fr_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search action, module, entity, profile..."
              className="w-full rounded-2xl border border-slate-300 py-3 pl-11 pr-4 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
            />
          </div>
          <select
            value={moduleKey}
            onChange={(event) => setModuleKey(event.target.value)}
            className="rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
          >
            <option value="">All Modules</option>
            {moduleOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <select
            value={action}
            onChange={(event) => setAction(event.target.value)}
            className="rounded-2xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
          >
            <option value="">All Actions</option>
            {actionOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              void loadLogs(0);
            }}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Apply
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500">
          <span>
            Showing {pageStart}-{pageEnd} of {totalCount}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                const nextOffset = Math.max(0, offset - pageSize);
                void loadLogs(nextOffset);
              }}
              disabled={!canGoPrev || loading}
              className="rounded-full border border-slate-300 px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => {
                const nextOffset = offset + pageSize;
                void loadLogs(nextOffset);
              }}
              disabled={!canGoNext || loading}
              className="rounded-full border border-slate-300 px-3 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>

        <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200">
          <div className="grid grid-cols-[1fr_1fr_1.1fr_1fr_1.6fr] gap-4 bg-slate-50 px-4 py-3 text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
            <span>Timestamp</span>
            <span>User</span>
            <span>Action</span>
            <span>Entity</span>
            <span>Result</span>
          </div>
          <div className="divide-y divide-slate-100">
            {loading ? (
              <div className="px-4 py-8 text-center text-sm text-slate-500">Audit logs load ho rahe hain...</div>
            ) : null}
            {!loading && !logs.length ? (
              <div className="px-4 py-8 text-center text-sm text-slate-500">Audit logs nahi mile.</div>
            ) : null}
            {!loading && logs.map((log) => (
              <div key={log.id} className="grid grid-cols-[1fr_1fr_1.1fr_1fr_1.6fr] gap-4 px-4 py-3 text-sm text-slate-700">
                <span>{formatDateTime(log.created_at)}</span>
                <span>{log.profile_name || log.profile_id || '-'}</span>
                <span className="font-medium text-slate-900">{log.action}</span>
                <span>{log.entity_table || '-'} {log.entity_id ? `• ${String(log.entity_id).slice(0, 8)}...` : ''}</span>
                <span className="truncate" title={summarizePayload(log.payload)}>{summarizePayload(log.payload)}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
