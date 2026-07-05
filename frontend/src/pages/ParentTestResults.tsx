import { useEffect, useMemo, useState, useRef } from 'react';
import { Award, BarChart3, TrendingDown, TrendingUp, Minus, ClipboardCheck } from 'lucide-react';

import { Alert } from '@components/Alert';
import { LoadingSpinner } from '@components/LoadingSpinner';
import { useAuth } from '@/contexts/AuthProvider';
import { apiService, getRequestErrorMessage } from '@services/api';
import type { ParentPortalTestChild } from '@types';

const cardClass = 'rounded-3xl border border-slate-200 bg-white p-5 shadow-sm';
const LOADING_TIMEOUT_MS = 30_000;

export default function ParentTestResults() {
  const { authReady, sessionReady, schoolContextReady, session } = useAuth();
  const canRun = authReady && sessionReady && schoolContextReady && !!session;

  const [children, setChildren] = useState<ParentPortalTestChild[]>([]);
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
      const res = await apiService.getParentPortalTestResults();
      const data = res.data;
      if (!mountedRef.current) return;
      setChildren(Array.isArray(data.children) ? data.children : []);
      if (data.children.length > 0 && !selectedChildId) {
        setSelectedChildId(data.children[0].student_id);
      }
      setLoading(false);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(getRequestErrorMessage(err, 'Test results load failed.'));
      setLoading(false);
    }
  };

  const child = useMemo(() => children.find((c) => c.student_id === selectedChildId) || children[0], [children, selectedChildId]);

  if (loading) return <LoadingSpinner message="Loading test results..." />;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Online Test Results</h1>
          <p className="mt-1 text-sm text-slate-500">Recent tests, marks, and improvement trends</p>
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
          <section className="grid gap-4 sm:grid-cols-4">
            <MetricCard icon={BarChart3} label="Average" value={`${child.average_percentage}%`} color="sky" />
            <MetricCard icon={Award} label="Best Rank" value={child.best_rank ? `#${child.best_rank}` : 'N/A'} color="amber" />
            <MetricCard icon={ClipboardCheck} label="Tests Taken" value={String(child.total_tests)} color="violet" />
            <MetricCard icon={child.improvement_trend === 'improving' ? TrendingUp : child.improvement_trend === 'declining' ? TrendingDown : Minus}
              label="Trend" value={child.improvement_trend.replace('_', ' ')} color={child.improvement_trend === 'improving' ? 'emerald' : child.improvement_trend === 'declining' ? 'rose' : 'slate'} />
          </section>

          {child.percentage_history.length > 1 && (
            <section className={cardClass}>
              <h3 className="text-lg font-semibold text-slate-900">Score History</h3>
              <div className="mt-4 flex items-end gap-2">
                {child.percentage_history.map((pct, idx) => (
                  <div key={idx} className="flex flex-1 flex-col items-center gap-1">
                    <span className="text-xs font-semibold text-slate-600">{pct}%</span>
                    <div className="w-full rounded-t-lg" style={{
                      height: `${Math.max(pct * 2, 8)}px`,
                      background: pct >= 60 ? '#10b981' : pct >= 40 ? '#f59e0b' : '#ef4444',
                    }} />
                    <span className="text-xs text-slate-400">{idx + 1}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className={cardClass}>
            <h3 className="text-lg font-semibold text-slate-900">Recent Tests</h3>
            {child.recent_tests.length > 0 ? (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <th className="pb-3 pr-4">Test</th>
                      <th className="pb-3 pr-4">Subject</th>
                      <th className="pb-3 pr-4">Score</th>
                      <th className="pb-3 pr-4">Percentage</th>
                      <th className="pb-3 pr-4">Rank</th>
                      <th className="pb-3">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {child.recent_tests.map((test) => (
                      <tr key={test.id} className="border-b border-slate-100">
                        <td className="py-3 pr-4 font-semibold text-slate-900">{test.title}</td>
                        <td className="py-3 pr-4 text-slate-600">{test.subject}</td>
                        <td className="py-3 pr-4 text-slate-900">{test.score}/{test.total_marks}</td>
                        <td className="py-3 pr-4">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                            test.percentage >= 60 ? 'bg-emerald-100 text-emerald-700' :
                            test.percentage >= 40 ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'
                          }`}>
                            {test.percentage}%
                          </span>
                        </td>
                        <td className="py-3 pr-4 text-slate-600">{test.rank > 0 ? `#${test.rank}` : '-'}</td>
                        <td className="py-3 text-slate-500">{test.completed_at ? new Date(test.completed_at).toLocaleDateString() : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-4 text-sm text-slate-500">No test results available.</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, color }: {
  icon: typeof BarChart3; label: string; value: string; color: string;
}) {
  const colors: Record<string, string> = {
    sky: 'bg-sky-100 text-sky-700', amber: 'bg-amber-100 text-amber-700',
    violet: 'bg-violet-100 text-violet-700', emerald: 'bg-emerald-100 text-emerald-700',
    rose: 'bg-rose-100 text-rose-700', slate: 'bg-slate-100 text-slate-700',
  };
  return (
    <section className={cardClass}>
      <div className={`inline-flex rounded-2xl p-3 ${colors[color] || colors.slate}`}>
        <Icon className="h-5 w-5" />
      </div>
      <p className="mt-2 text-2xl font-bold text-slate-900 capitalize">{value}</p>
      <p className="text-sm text-slate-500">{label}</p>
    </section>
  );
}
