import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle, Clock, FileText, XCircle } from 'lucide-react';

import { Alert } from '@components/Alert';
import { LoadingSpinner } from '@components/LoadingSpinner';
import { useAuth } from '@/contexts/AuthProvider';
import { apiService, getRequestErrorMessage } from '@services/api';
import type { ParentPortalAssignmentChild } from '@types';

const cardClass = 'rounded-3xl border border-slate-200 bg-white p-5 shadow-sm';

export default function ParentAssignments() {
  const { authReady, sessionReady, schoolContextReady, session } = useAuth();
  const canRun = authReady && sessionReady && schoolContextReady && !!session;

  const [children, setChildren] = useState<ParentPortalAssignmentChild[]>([]);
  const [selectedChildId, setSelectedChildId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!canRun) return;
    void loadData();
  }, [canRun]);

  const loadData = async () => {
    try {
      setLoading(true);
      const res = await apiService.getParentPortalAssignments();
      const data = res.data;
      setChildren(data.children);
      if (data.children.length > 0 && !selectedChildId) {
        setSelectedChildId(data.children[0].student_id);
      }
    } catch (err) {
      setError(getRequestErrorMessage(err, 'Assignments load failed.'));
    } finally {
      setLoading(false);
    }
  };

  const child = useMemo(() => children.find((c) => c.student_id === selectedChildId) || children[0], [children, selectedChildId]);

  if (loading) return <LoadingSpinner message="Loading assignments..." />;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Assignments</h1>
          <p className="mt-1 text-sm text-slate-500">Track pending, submitted, and graded assignments</p>
        </div>
        {children.length > 1 && (
          <select value={selectedChildId} onChange={(e) => setSelectedChildId(e.target.value)}
            className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold">
            {children.map((c) => (
              <option key={c.student_id} value={c.student_id}>{c.student_name}</option>
            ))}
          </select>
        )}
      </div>

      {error ? <Alert type="error" message={error} onClose={() => setError('')} /> : null}

      {child && (
        <>
          {/* Summary Cards */}
          <section className="grid gap-4 sm:grid-cols-4">
            <SummaryCard icon={AlertCircle} label="Pending" value={String(child.summary.pending)} color="amber" />
            <SummaryCard icon={CheckCircle} label="Submitted" value={String(child.summary.submitted)} color="sky" />
            <SummaryCard icon={FileText} label="Graded" value={String(child.summary.graded)} color="emerald" />
            <SummaryCard icon={XCircle} label="Late" value={String(child.summary.late)} color="rose" />
          </section>

          {/* Assignment List */}
          <section className={cardClass}>
            <h3 className="text-lg font-semibold text-slate-900">All Assignments</h3>
            {child.assignments.length > 0 ? (
              <div className="mt-4 space-y-3">
                {child.assignments.map((a) => {
                  const statusColors: Record<string, string> = {
                    pending: 'bg-amber-100 text-amber-700 border-amber-200',
                    submitted: 'bg-sky-100 text-sky-700 border-sky-200',
                    graded: 'bg-emerald-100 text-emerald-700 border-emerald-200',
                    late: 'bg-rose-100 text-rose-700 border-rose-200',
                  };
                  const sc = statusColors[a.status] || 'bg-slate-100 text-slate-700 border-slate-200';
                  return (
                    <div key={a.id} className={`flex flex-col gap-2 rounded-2xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${sc}`}>
                      <div>
                        <p className="text-sm font-semibold">{a.title}</p>
                        <p className="text-xs opacity-70">{a.course_name}</p>
                      </div>
                      <div className="flex items-center gap-4 text-xs">
                        {a.due_date && (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {new Date(a.due_date).toLocaleDateString()}
                          </span>
                        )}
                        {a.grade !== null && <span>Grade: {a.grade}{a.max_grade ? `/${a.max_grade}` : ''}</span>}
                        <span className="rounded-full bg-white/60 px-2 py-0.5 text-xs font-bold capitalize">{a.status}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="mt-4 text-sm text-slate-500">No assignments found.</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value, color }: {
  icon: typeof AlertCircle; label: string; value: string; color: string;
}) {
  const colors: Record<string, string> = {
    amber: 'bg-amber-100 text-amber-700', sky: 'bg-sky-100 text-sky-700',
    emerald: 'bg-emerald-100 text-emerald-700', rose: 'bg-rose-100 text-rose-700',
  };
  return (
    <section className={cardClass}>
      <div className={`inline-flex rounded-2xl p-3 ${colors[color]}`}><Icon className="h-5 w-5" /></div>
      <p className="mt-3 text-3xl font-bold text-slate-900">{value}</p>
      <p className="text-sm text-slate-500">{label}</p>
    </section>
  );
}
