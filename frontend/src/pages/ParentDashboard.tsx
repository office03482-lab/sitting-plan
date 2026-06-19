import { useEffect, useMemo, useState } from 'react';
import { BookOpen, CalendarCheck, CreditCard, GraduationCap, TrendingUp, ClipboardCheck } from 'lucide-react';

import { Alert } from '@components/Alert';
import { LoadingSpinner } from '@components/LoadingSpinner';
import { useAuth } from '@/contexts/AuthProvider';
import { apiService, getRequestErrorMessage } from '@services/api';
import type { ParentPortalChildDashboard } from '@types';

const cardClass = 'rounded-3xl border border-slate-200 bg-white p-5 shadow-sm';

export default function ParentDashboard() {
  const { authReady, sessionReady, schoolContextReady, session } = useAuth();
  const canRun = authReady && sessionReady && schoolContextReady && !!session;

  const [children, setChildren] = useState<ParentPortalChildDashboard[]>([]);
  const [selectedChildId, setSelectedChildId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!canRun) return;
    void loadDashboard();
  }, [canRun]);

  const loadDashboard = async () => {
    try {
      setLoading(true);
      const res = await apiService.getParentPortalDashboard();
      const data = res.data;
      setChildren(data.children);
      if (data.children.length > 0 && !selectedChildId) {
        setSelectedChildId(data.children[0].student_id);
      }
    } catch (err) {
      setError(getRequestErrorMessage(err, 'Dashboard load failed.'));
    } finally {
      setLoading(false);
    }
  };

  const selectedChild = useMemo(
    () => children.find((c) => c.student_id === selectedChildId) || children[0],
    [children, selectedChildId]
  );

  if (loading) return <LoadingSpinner message="Loading parent dashboard..." />;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Parent Dashboard</h1>
          <p className="mt-1 text-sm text-slate-500">Your child's progress at a glance</p>
        </div>
        {children.length > 1 && (
          <select
            value={selectedChildId}
            onChange={(e) => setSelectedChildId(e.target.value)}
            className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold"
          >
            {children.map((c) => (
              <option key={c.student_id} value={c.student_id}>{c.student_name}</option>
            ))}
          </select>
        )}
      </div>

      {error ? <Alert type="error" message={error} onClose={() => setError('')} /> : null}

      {selectedChild && (
        <>
          {/* Student Info Header */}
          <section className={`${cardClass} bg-gradient-to-br from-violet-50 to-indigo-50`}>
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-200 text-xl font-bold text-violet-800">
                {selectedChild.student_name.charAt(0)}
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-900">{selectedChild.student_name}</h2>
                <p className="text-sm text-slate-500">{selectedChild.class_name} {selectedChild.section}</p>
              </div>
            </div>
          </section>

          {/* Key Metrics */}
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard icon={CalendarCheck} label="Attendance" value={`${selectedChild.attendance_percentage}%`}
              sub={`${selectedChild.present_days} present · ${selectedChild.absent_days} absent`} color="emerald" />
            <MetricCard icon={GraduationCap} label="Learning Score" value={`${selectedChild.learning_score}%`}
              sub="Course progress" color="sky" />
            <MetricCard icon={ClipboardCheck} label="Assignments" value={String(selectedChild.pending_assignments)}
              sub="Pending" color="amber" />
            <MetricCard icon={TrendingUp} label="Latest Test" value={
              selectedChild.latest_test_result ? `${selectedChild.latest_test_result.percentage}%` : 'N/A'
            } sub={selectedChild.latest_test_result?.title || 'No tests taken'} color="violet" />
          </section>

          {/* Fee Status */}
          <section className={cardClass}>
            <div className="flex items-center gap-3">
              <CreditCard className="h-5 w-5 text-slate-600" />
              <h3 className="text-lg font-semibold text-slate-900">Fee Status</h3>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <FeeBar label="Total Fee" amount={selectedChild.fee_status.total_fee} />
              <FeeBar label="Paid" amount={selectedChild.fee_status.paid_amount} />
              <FeeBar label="Due" amount={selectedChild.fee_status.due_amount} />
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-200">
              <div className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${selectedChild.fee_status.payment_percentage}%` }} />
            </div>
            <p className="mt-2 text-xs text-slate-500">{selectedChild.fee_status.payment_percentage}% paid</p>
          </section>

          {/* Upcoming Tests */}
          <section className={cardClass}>
            <div className="flex items-center gap-3">
              <BookOpen className="h-5 w-5 text-slate-600" />
              <h3 className="text-lg font-semibold text-slate-900">Upcoming Tests</h3>
            </div>
            {selectedChild.upcoming_tests.length > 0 ? (
              <div className="mt-4 space-y-3">
                {selectedChild.upcoming_tests.map((test) => (
                  <div key={test.id} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{test.title}</p>
                      <p className="text-xs text-slate-500">{test.subject} · {test.total_marks} marks</p>
                    </div>
                    <span className="text-sm text-slate-600">{test.starts_at ? new Date(test.starts_at).toLocaleDateString() : 'TBD'}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-4 text-sm text-slate-500">No upcoming tests scheduled.</p>
            )}
          </section>
        </>
      )}

      {!selectedChild && !loading && (
        <section className={cardClass}>
          <p className="text-sm text-slate-500">No children linked to this account.</p>
        </section>
      )}
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, sub, color }: {
  icon: typeof CalendarCheck; label: string; value: string; sub: string;
  color?: 'emerald' | 'sky' | 'amber' | 'violet' | 'rose';
}) {
  const colors: Record<string, string> = {
    emerald: 'bg-emerald-100 text-emerald-700', sky: 'bg-sky-100 text-sky-700',
    amber: 'bg-amber-100 text-amber-700', violet: 'bg-violet-100 text-violet-700', rose: 'bg-rose-100 text-rose-700',
  };
  const c = colors[color || 'emerald'] || colors.emerald;
  return (
    <section className={cardClass}>
      <div className={`inline-flex rounded-2xl p-3 ${c}`}><Icon className="h-5 w-5" /></div>
      <p className="mt-3 text-sm text-slate-500">{label}</p>
      <p className="text-2xl font-bold text-slate-900">{value}</p>
      <p className="text-xs text-slate-400">{sub}</p>
    </section>
  );
}

function FeeBar({ label, amount }: { label: string; amount: number }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-bold text-slate-900">₹{amount.toLocaleString()}</p>
    </div>
  );
}
