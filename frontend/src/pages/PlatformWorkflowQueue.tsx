import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Eye, RefreshCw, X } from 'lucide-react';
import { apiService, getRequestErrorMessage } from '@services/api';
import type { BulkActionRequest, PlatformWorkflowRequestDetail } from '@types';

type WorkflowTab = 'pending' | 'approved' | 'rejected' | 'executed';

const tabs: Array<{ id: WorkflowTab; label: string }> = [
  { id: 'pending', label: 'Pending' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'executed', label: 'Executed' },
];

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function shortId(value?: string | null) {
  const text = String(value || '').trim();
  if (!text) return '-';
  return `${text.slice(0, 8)}...`;
}

function toPrettyJson(value: unknown) {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return String(value ?? '');
  }
}

export default function PlatformWorkflowQueue() {
  const [activeTab, setActiveTab] = useState<WorkflowTab>('pending');
  const [requests, setRequests] = useState<BulkActionRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<PlatformWorkflowRequestDetail | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const loadRequests = async (status: WorkflowTab = activeTab) => {
    setLoading(true);
    try {
      const response = await apiService.listBulkActionRequests({ status });
      setRequests(response.data || []);
      setError(null);
    } catch (requestError: any) {
      setError(getRequestErrorMessage(requestError, 'Workflow queue load nahi ho paayi.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRequests(activeTab);
  }, [activeTab]);

  const loadDetails = async (requestId: string) => {
    setDetailsOpen(true);
    setDetailsLoading(true);
    try {
      const response = await apiService.getPlatformWorkflowRequestDetail(requestId);
      setDetails(response.data);
    } catch (requestError: any) {
      setError(getRequestErrorMessage(requestError, 'Request details load nahi ho paaye.'));
      setDetails(null);
    } finally {
      setDetailsLoading(false);
    }
  };

  const handleApprove = async (requestId: string) => {
    setActingId(requestId);
    try {
      await apiService.approveBulkActionRequest(requestId);
      await loadRequests(activeTab);
      if (details?.request.id === requestId) {
        await loadDetails(requestId);
      }
      setError(null);
    } catch (requestError: any) {
      setError(getRequestErrorMessage(requestError, 'Request approve nahi ho paayi.'));
    } finally {
      setActingId(null);
    }
  };

  const handleReject = async (requestId: string) => {
    const reason = window.prompt('Reject reason likho');
    if (reason === null) return;
    setActingId(requestId);
    try {
      await apiService.rejectBulkActionRequest(requestId, { reason: reason.trim() || undefined });
      await loadRequests(activeTab);
      if (details?.request.id === requestId) {
        await loadDetails(requestId);
      }
      setError(null);
    } catch (requestError: any) {
      setError(getRequestErrorMessage(requestError, 'Request reject nahi ho paayi.'));
    } finally {
      setActingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-[2rem] border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.28em] text-sky-700">Platform Administration</p>
            <h1 className="mt-3 text-3xl font-bold text-slate-900">Workflow Queue</h1>
            <p className="mt-3 max-w-3xl text-sm text-slate-500">
              Existing workflow requests ko review, approve, reject, aur inspect karne ke liye central queue.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link to="/platform/dashboard" className="rounded-full bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800">
              Platform Dashboard
            </Link>
            <Link to="/admin/access-control" className="rounded-full border border-slate-300 px-5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              Access Control
            </Link>
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : null}

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap gap-2">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                  activeTab === tab.id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void loadRequests(activeTab)}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200">
          <div className="grid grid-cols-[1fr_0.9fr_0.8fr_1.1fr_1fr_0.8fr_1.1fr] gap-4 bg-slate-50 px-4 py-3 text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
            <span>Request ID</span>
            <span>Action</span>
            <span>Module</span>
            <span>Requested By</span>
            <span>Requested Date</span>
            <span>Status</span>
            <span>Actions</span>
          </div>
          <div className="divide-y divide-slate-100">
            {loading ? (
              <div className="px-4 py-8 text-center text-sm text-slate-500">Workflow queue load ho rahi hai...</div>
            ) : null}
            {!loading && !requests.length ? (
              <div className="px-4 py-8 text-center text-sm text-slate-500">Is tab mein koi request nahi mili.</div>
            ) : null}
            {!loading && requests.map((request) => (
              <div key={request.id} className="grid grid-cols-[1fr_0.9fr_0.8fr_1.1fr_1fr_0.8fr_1.1fr] gap-4 px-4 py-3 text-sm text-slate-700">
                <span className="font-medium text-slate-900">{shortId(request.id)}</span>
                <span>{request.action_type}</span>
                <span className="capitalize">{request.module_name}</span>
                <span>{request.requested_role} / {shortId(request.requested_by_profile_id)}</span>
                <span>{formatDateTime(request.created_at)}</span>
                <span className="capitalize">{request.status}</span>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void loadDetails(request.id)}
                    className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200"
                  >
                    <Eye className="h-3.5 w-3.5" />
                    View Details
                  </button>
                  {request.status === 'pending' ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void handleApprove(request.id)}
                        disabled={actingId === request.id}
                        className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-200 disabled:opacity-50"
                      >
                        <Check className="h-3.5 w-3.5" />
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleReject(request.id)}
                        disabled={actingId === request.id}
                        className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-200 disabled:opacity-50"
                      >
                        <X className="h-3.5 w-3.5" />
                        Reject
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {detailsOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
          <div className="max-h-[88vh] w-full max-w-5xl overflow-auto rounded-[2rem] bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.24em] text-sky-700">Request Details</p>
                <h2 className="mt-2 text-2xl font-bold text-slate-900">
                  {details?.request.action_type || 'Workflow Request'}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  setDetailsOpen(false);
                  setDetails(null);
                }}
                className="rounded-full bg-slate-100 p-2 text-slate-600 hover:bg-slate-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {detailsLoading ? (
              <div className="py-10 text-center text-sm text-slate-500">Request details load ho rahe hain...</div>
            ) : null}

            {details ? (
              <div className="mt-6 space-y-6">
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Request ID</p>
                    <p className="mt-2 font-semibold text-slate-900">{details.request.id}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Requested By</p>
                    <p className="mt-2 font-semibold text-slate-900">{details.requested_by_name || details.request.requested_by_profile_id || '-'}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Status</p>
                    <p className="mt-2 font-semibold capitalize text-slate-900">{details.request.status}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Created</p>
                    <p className="mt-2 font-semibold text-slate-900">{formatDateTime(details.request.created_at)}</p>
                  </div>
                </div>

                <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
                  <section className="rounded-3xl border border-slate-200 p-5">
                    <h3 className="text-lg font-semibold text-slate-900">Request Metadata</h3>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <div>
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Module</p>
                        <p className="mt-1 text-sm font-medium text-slate-900">{details.request.module_name}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Action Type</p>
                        <p className="mt-1 text-sm font-medium text-slate-900">{details.request.action_type}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Requested Role</p>
                        <p className="mt-1 text-sm font-medium text-slate-900">{details.request.requested_role}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Reason</p>
                        <p className="mt-1 text-sm font-medium text-slate-900">{details.request.reason || '-'}</p>
                      </div>
                    </div>
                    <div className="mt-5">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Payload</p>
                      <pre className="mt-2 overflow-auto rounded-2xl bg-slate-950 p-4 text-xs text-slate-100">{toPrettyJson(details.request.payload_json)}</pre>
                    </div>
                    <div className="mt-5">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Execution Result</p>
                      <pre className="mt-2 overflow-auto rounded-2xl bg-slate-100 p-4 text-xs text-slate-800">{toPrettyJson(details.request.execution_result)}</pre>
                    </div>
                  </section>

                  <section className="rounded-3xl border border-slate-200 p-5">
                    <h3 className="text-lg font-semibold text-slate-900">Status History</h3>
                    <div className="mt-4 space-y-3">
                      {details.events.map((event, index) => (
                        <div key={`${event.id || event.event_type}-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <p className="font-semibold capitalize text-slate-900">{event.event_type.split('_').join(' ')}</p>
                              <p className="mt-1 text-sm text-slate-500">{event.actor_name || event.actor_profile_id || 'System'} {event.actor_role ? `• ${event.actor_role}` : ''}</p>
                            </div>
                            <span className="text-xs text-slate-400">{formatDateTime(event.created_at)}</span>
                          </div>
                          {event.notes ? <p className="mt-3 text-sm text-slate-700">{event.notes}</p> : null}
                          {Object.keys(event.payload || {}).length ? (
                            <pre className="mt-3 overflow-auto rounded-2xl bg-white p-3 text-xs text-slate-700">{toPrettyJson(event.payload)}</pre>
                          ) : null}
                        </div>
                      ))}
                      {!details.events.length ? (
                        <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500">
                          Status history available nahi hai.
                        </div>
                      ) : null}
                    </div>
                  </section>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
