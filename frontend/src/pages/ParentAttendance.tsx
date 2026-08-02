import { useEffect, useMemo, useState, useRef } from 'react';
import { CalendarCheck, CalendarDays, TrendingDown, TrendingUp, Minus, RefreshCw } from 'lucide-react';
import axios from 'axios';

import { Alert } from '@components/Alert';
import { LoadingSpinner } from '@components/LoadingSpinner';
import { useAuth } from '@/contexts/AuthProvider';
import { apiService, getRequestErrorMessage } from '@services/api';
import type { ParentPortalAttendanceChild, ParentPortalMonthlyAttendance } from '@types';

const cardClass = 'rounded-3xl border border-slate-200 bg-white p-5 shadow-sm';
const LOADING_TIMEOUT_MS = 30_000;

export default function ParentAttendance() {
  const { authReady, sessionReady, schoolContextReady, session } = useAuth();
  const canRun = authReady && sessionReady && schoolContextReady && !!session;

  const [children, setChildren] = useState<ParentPortalAttendanceChild[]>([]);
  const [selectedChildId, setSelectedChildId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestRef = useRef<AbortController | null>(null);
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
    void loadData();
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      requestRef.current?.abort();
    };
  }, [canRun]);

  const loadData = async () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError('');
    timeoutRef.current = setTimeout(() => {
      controller.abort();
      if (mountedRef.current) {
        setLoading(false);
        setError('Attendance data is taking too long to load. Please try again.');
      }
    }, LOADING_TIMEOUT_MS);
    try {
      const res = await apiService.getParentPortalAttendance(undefined, { signal: controller.signal });
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      const data = res.data;
      if (!mountedRef.current) return;
      setChildren(Array.isArray(data.children) ? data.children : []);
      if (data.children.length > 0 && !selectedChildId) {
        setSelectedChildId(data.children[0].student_id);
      }
      setLoading(false);
    } catch (err) {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (!mountedRef.current) return;
      if (axios.isCancel(err)) {
        return;
      }
      setError(getRequestErrorMessage(err, 'Attendance data load failed.'));
      setLoading(false);
    }
  };

  const child = useMemo(() => children.find((c) => c.student_id === selectedChildId) || children[0], [children, selectedChildId]);

  if (loading) return <LoadingSpinner message="Loading attendance data..." />;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Attendance Center</h1>
          <p className="mt-1 text-sm text-slate-500">Track attendance trends and monthly breakdown</p>
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

      {error ? (
        <div className="flex flex-col gap-3">
          <Alert type="error" message={error} onClose={() => setError('')} />
          <button
            type="button"
            onClick={() => void loadData()}
            className="inline-flex w-fit items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className="h-4 w-4" /> Retry
          </button>
        </div>
      ) : null}

      {child && (
        <>
          <section className="grid gap-4 sm:grid-cols-3">
            <MetricCard icon={CalendarCheck} label="Present Days" value={String(child.overall.present_days)}
              sub="Total" color="emerald" />
            <MetricCard icon={CalendarDays} label="Absent Days" value={String(child.overall.absent_days)}
              sub="Total" color="rose" />
            <MetricCard icon={CalendarCheck} label="Attendance" value={`${child.overall.attendance_percentage}%`}
              sub="Overall" color="sky" />
          </section>

          <section className={cardClass}>
            <h3 className="text-lg font-semibold text-slate-900">This Month</h3>
            <div className="mt-4 grid gap-4 sm:grid-cols-4">
              <StatBox label="Days" value={String(child.current_month.total_days)} />
              <StatBox label="Present" value={String(child.current_month.present_days)} color="emerald" />
              <StatBox label="Absent" value={String(child.current_month.absent_days)} color="rose" />
              <StatBox label="Rate" value={`${child.current_month.attendance_percentage}%`} />
            </div>
          </section>

          <section className={cardClass}>
            <div className="flex items-center gap-3">
              {child.trend.trend === 'improving' ? <TrendingUp className="h-5 w-5 text-emerald-600" /> :
               child.trend.trend === 'declining' ? <TrendingDown className="h-5 w-5 text-rose-600" /> :
               <Minus className="h-5 w-5 text-slate-600" />}
              <h3 className="text-lg font-semibold text-slate-900">Trend: {child.trend.trend}</h3>
            </div>
            {child.trend.monthly_percentages.length > 0 && (
              <div className="mt-4 flex items-end gap-2">
                {child.trend.monthly_percentages.map((pct, idx) => (
                  <div key={idx} className="flex flex-1 flex-col items-center gap-1">
                    <span className="text-xs font-semibold text-slate-600">{pct}%</span>
                    <div className="w-full rounded-t-lg bg-sky-200" style={{ height: `${Math.max(pct * 1.5, 4)}px` }}>
                      <div className="h-full rounded-t-lg bg-sky-500 transition-all" style={{ height: `${pct}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className={cardClass}>
            <h3 className="text-lg font-semibold text-slate-900">Monthly Breakdown</h3>
            <div className="mt-4 space-y-2">
              {child.monthly_breakdown.length > 0 ? (
                child.monthly_breakdown.map((m) => (
                  <MonthlyRow key={m.month} month={m} />
                ))
              ) : (
                <p className="text-sm text-slate-500">No attendance data available.</p>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, sub, color }: {
  icon: typeof CalendarCheck; label: string; value: string; sub: string; color: string;
}) {
  const colors: Record<string, string> = {
    emerald: 'bg-emerald-100 text-emerald-700', rose: 'bg-rose-100 text-rose-700', sky: 'bg-sky-100 text-sky-700',
  };
  return (
    <section className={cardClass}>
      <div className={`inline-flex rounded-2xl p-3 ${colors[color]}`}><Icon className="h-5 w-5" /></div>
      <p className="mt-3 text-3xl font-bold text-slate-900">{value}</p>
      <p className="text-sm text-slate-500">{label}</p>
      <p className="text-xs text-slate-400">{sub}</p>
    </section>
  );
}

function StatBox({ label, value, color }: { label: string; value: string; color?: string }) {
  const bg = color ? `bg-${color}-100 text-${color}-700` : 'bg-slate-100 text-slate-700';
  return (
    <div className={`rounded-2xl px-4 py-3 ${bg}`}>
      <p className="text-xs font-semibold uppercase tracking-wide">{label}</p>
      <p className="text-xl font-bold">{value}</p>
    </div>
  );
}

function MonthlyRow({ month }: { month: ParentPortalMonthlyAttendance }) {
  const pct = month.attendance_percentage;
  const color = pct >= 75 ? 'bg-emerald-500' : pct >= 60 ? 'bg-amber-500' : 'bg-rose-500';
  const label = `${month.month} — ${month.present_days}/${month.total_days} days`;
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-slate-100 px-4 py-3">
      <p className="w-20 text-sm font-semibold text-slate-700">{month.month}</p>
      <div className="flex-1">
        <div className="h-3 overflow-hidden rounded-full bg-slate-200">
          <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
        </div>
      </div>
      <p className="w-24 text-right text-sm text-slate-600">{label}</p>
      <p className="w-12 text-right text-sm font-bold text-slate-900">{pct}%</p>
    </div>
  );
}
