import { useEffect, useMemo, useState, useRef } from 'react';
import { AlertTriangle, Bell, BookOpen, Calendar, CreditCard, TrendingDown } from 'lucide-react';

import { Alert } from '@components/Alert';
import { LoadingSpinner } from '@components/LoadingSpinner';
import { useAuth } from '@/contexts/AuthProvider';
import { apiService, getRequestErrorMessage } from '@services/api';
import type { ParentPortalAlertChild, ParentPortalAlertItem } from '@types';

const cardClass = 'rounded-3xl border border-slate-200 bg-white p-5 shadow-sm';
const LOADING_TIMEOUT_MS = 30_000;

export default function ParentAlerts() {
  const { authReady, sessionReady, schoolContextReady, session } = useAuth();
  const canRun = authReady && sessionReady && schoolContextReady && !!session;

  const [children, setChildren] = useState<ParentPortalAlertChild[]>([]);
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
      const res = await apiService.getParentPortalAlerts();
      const data = res.data;
      if (!mountedRef.current) return;
      setChildren(Array.isArray(data.children) ? data.children : []);
      if (data.children.length > 0 && !selectedChildId) {
        setSelectedChildId(data.children[0].student_id);
      }
      setLoading(false);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(getRequestErrorMessage(err, 'Alerts load failed.'));
      setLoading(false);
    }
  };

  const child = useMemo(() => children.find((c) => c.student_id === selectedChildId) || children[0], [children, selectedChildId]);
  const allAlerts = child?.alerts || [];

  const criticalCount = allAlerts.filter((a) => a.severity === 'critical').length;
  const warningCount = allAlerts.filter((a) => a.severity === 'warning').length;
  const infoCount = allAlerts.filter((a) => a.severity === 'info').length;

  if (loading) return <LoadingSpinner message="Loading alerts..." />;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Parent Alerts</h1>
          <p className="mt-1 text-sm text-slate-500">Stay informed about your child's progress</p>
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

      <section className="grid gap-4 sm:grid-cols-3">
        <SummaryTile icon={AlertTriangle} label="Critical" value={String(criticalCount)} color="rose" />
        <SummaryTile icon={Bell} label="Warnings" value={String(warningCount)} color="amber" />
        <SummaryTile icon={Bell} label="Info" value={String(infoCount)} color="sky" />
      </section>

      <section className={cardClass}>
        <h3 className="text-lg font-semibold text-slate-900">All Alerts</h3>
        {allAlerts.length > 0 ? (
          <div className="mt-4 space-y-3">
            {allAlerts.map((alert, idx) => (
              <AlertCard key={`${alert.type}-${idx}`} alert={alert} />
            ))}
          </div>
        ) : (
          <div className="mt-6 flex flex-col items-center py-8 text-center">
            <Bell className="h-12 w-12 text-slate-300" />
            <p className="mt-3 text-sm font-semibold text-slate-600">No alerts</p>
            <p className="text-sm text-slate-400">Everything looks good for {child?.student_name}.</p>
          </div>
        )}
      </section>
    </div>
  );
}

function SummaryTile({ icon: Icon, label, value, color }: {
  icon: typeof AlertTriangle; label: string; value: string; color: string;
}) {
  const colors: Record<string, string> = {
    rose: 'bg-rose-100 text-rose-700', amber: 'bg-amber-100 text-amber-700', sky: 'bg-sky-100 text-sky-700',
  };
  return (
    <section className={cardClass}>
      <div className={`inline-flex rounded-2xl p-3 ${colors[color]}`}><Icon className="h-5 w-5" /></div>
      <p className="mt-3 text-3xl font-bold text-slate-900">{value}</p>
      <p className="text-sm text-slate-500">{label}</p>
    </section>
  );
}

function AlertCard({ alert }: { alert: ParentPortalAlertItem }) {
  const icons: Record<string, typeof AlertTriangle> = {
    low_attendance: TrendingDown, low_performance: TrendingDown,
    missed_assignments: BookOpen, upcoming_test: Calendar, fee_due: CreditCard,
  };
  const Icon = icons[alert.type] || Bell;

  const severityColors: Record<string, string> = {
    critical: 'border-rose-300 bg-rose-50',
    warning: 'border-amber-300 bg-amber-50',
    info: 'border-sky-300 bg-sky-50',
  };
  const border = severityColors[alert.severity] || 'border-slate-200 bg-slate-50';

  return (
    <div className={`flex items-start gap-4 rounded-2xl border p-4 ${border}`}>
      <div className={`rounded-xl p-2 ${
        alert.severity === 'critical' ? 'bg-rose-200 text-rose-700' :
        alert.severity === 'warning' ? 'bg-amber-200 text-amber-700' : 'bg-sky-200 text-sky-700'
      }`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="flex-1">
        <p className="text-sm font-bold text-slate-900">{alert.title}</p>
        <p className="mt-1 text-sm text-slate-600">{alert.message}</p>
      </div>
      <span className={`rounded-full px-2 py-1 text-xs font-bold uppercase ${
        alert.severity === 'critical' ? 'bg-rose-200 text-rose-800' :
        alert.severity === 'warning' ? 'bg-amber-200 text-amber-800' : 'bg-sky-200 text-sky-800'
      }`}>
        {alert.severity}
      </span>
    </div>
  );
}
