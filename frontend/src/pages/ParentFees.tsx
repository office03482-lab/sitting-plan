import { useEffect, useMemo, useState, useRef } from 'react';
import { CreditCard, IndianRupee, CheckCircle2, AlertCircle, Clock } from 'lucide-react';

import { Alert } from '@components/Alert';
import { LoadingSpinner } from '@components/LoadingSpinner';
import { useAuth } from '@/contexts/AuthProvider';
import { apiService, getRequestErrorMessage } from '@services/api';
import type { ParentPortalFeesChild } from '@types';

const cardClass = 'rounded-3xl border border-slate-200 bg-white p-5 shadow-sm';
const LOADING_TIMEOUT_MS = 30_000;

export default function ParentFees() {
  const { authReady, sessionReady, schoolContextReady, session } = useAuth();
  const canRun = authReady && sessionReady && schoolContextReady && !!session;

  const [children, setChildren] = useState<ParentPortalFeesChild[]>([]);
  const [selectedChildId, setSelectedChildId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!canRun) {
      timeoutRef.current = setTimeout(() => {
        if (mountedRef.current) {
          setLoading(false);
          setError('Parent authentication context not fully ready. Please wait or refresh.');
        }
      }, LOADING_TIMEOUT_MS);
      return () => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
      };
    }
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    void loadData();
  }, [canRun]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await apiService.getParentPortalFees();
      const data = res.data;
      if (!mountedRef.current) return;
      setChildren(Array.isArray(data.children) ? data.children : []);
      if (data.children.length > 0 && !selectedChildId) {
        setSelectedChildId(data.children[0].student_id);
      }
      setLoading(false);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(getRequestErrorMessage(err, 'Fees load failed.'));
      setLoading(false);
    }
  };

  const child = useMemo(() => children.find((c) => c.student_id === selectedChildId) || children[0], [children, selectedChildId]);
  const fee = child?.fee_status;

  if (loading) return <LoadingSpinner message="Loading fees..." />;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Fee Status</h1>
          <p className="mt-1 text-sm text-slate-500">Track your child's fee payments</p>
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

      {!child || !fee ? (
        <section className={cardClass}>
          <div className="mt-6 flex flex-col items-center py-8 text-center">
            <CreditCard className="h-12 w-12 text-slate-300" />
            <p className="mt-3 text-sm font-semibold text-slate-600">No fee information available</p>
            <p className="text-sm text-slate-400">Fee details will appear here once the school updates them.</p>
          </div>
        </section>
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-3">
            <StatTile icon={IndianRupee} label="Total Fee" value={formatRupees(fee.total_fee)} />
            <StatTile icon={CheckCircle2} label="Paid" value={formatRupees(fee.paid_amount)} accent />
            <StatTile icon={AlertCircle} label="Due" value={formatRupees(fee.due_amount)} due={fee.due_amount > 0} />
          </section>

          <section className={cardClass}>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Payment Summary</h3>
                <p className="mt-1 text-sm text-slate-500">
                  {child.student_name}{child.class_name ? ` • ${child.class_name}${child.section ? ` ${child.section}` : ''}` : ''}
                </p>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase ${
                fee.status === 'paid' ? 'bg-emerald-100 text-emerald-800' :
                fee.status === 'unavailable' ? 'bg-slate-100 text-slate-600' :
                fee.due_amount > 0 ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'
              }`}>
                {fee.status === 'unavailable' ? 'Unavailable' : fee.status}
              </span>
            </div>

            <div className="mt-4">
              <div className="flex items-center justify-between text-sm text-slate-600">
                <span>Payment completed</span>
                <span>{Math.round(fee.payment_percentage)}%</span>
              </div>
              <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-emerald-500 transition-all"
                  style={{ width: `${Math.min(100, Math.max(0, fee.payment_percentage))}%` }} />
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs font-semibold uppercase text-slate-400">Total Fee</p>
                <p className="mt-1 text-xl font-bold text-slate-900">{formatRupees(fee.total_fee)}</p>
              </div>
              <div className="rounded-2xl bg-emerald-50 p-4">
                <p className="text-xs font-semibold uppercase text-emerald-600">Paid Amount</p>
                <p className="mt-1 text-xl font-bold text-emerald-700">{formatRupees(fee.paid_amount)}</p>
              </div>
              <div className="rounded-2xl bg-rose-50 p-4">
                <p className="text-xs font-semibold uppercase text-rose-600">Due Amount</p>
                <p className="mt-1 text-xl font-bold text-rose-700">{formatRupees(fee.due_amount)}</p>
              </div>
            </div>

            {fee.due_date && (
              <div className="mt-4 flex items-center gap-2 text-sm text-slate-600">
                <Clock className="h-4 w-4 text-slate-400" />
                <span>Due date: {new Date(fee.due_date).toLocaleDateString()}</span>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function StatTile({ icon: Icon, label, value, accent, due }: {
  icon: typeof IndianRupee; label: string; value: string; accent?: boolean; due?: boolean;
}) {
  const tone = due ? 'bg-rose-100 text-rose-700' : accent ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-700';
  return (
    <section className={cardClass}>
      <div className={`inline-flex rounded-2xl p-3 ${tone}`}><Icon className="h-5 w-5" /></div>
      <p className="mt-3 text-3xl font-bold text-slate-900">{value}</p>
      <p className="text-sm text-slate-500">{label}</p>
    </section>
  );
}

function formatRupees(value: number | undefined) {
  const num = Number(value || 0);
  return `₹${num.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}
