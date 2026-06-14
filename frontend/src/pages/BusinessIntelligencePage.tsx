import { FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import { Activity, Building2, Download, GraduationCap, Landmark, RefreshCcw, Save, ShieldCheck } from 'lucide-react';

import { Alert } from '@components/Alert';
import { LoadingSpinner } from '@components/LoadingSpinner';
import { useAuth } from '@/contexts/AuthProvider';
import { apiService, getRequestErrorMessage } from '@services/api';
import type {
  AcademicBiDashboard,
  FinanceBiDashboard,
  OperationsBiDashboard,
  PlatformBiDashboard,
  SavedBiReport,
} from '@types';

const cardClass = 'rounded-3xl border border-slate-200 bg-white p-5 shadow-sm';
type Period = 'daily' | 'weekly' | 'monthly' | 'yearly';

export default function BusinessIntelligencePage() {
  const { user } = useAuth();
  const [period, setPeriod] = useState<Period>('monthly');
  const [academic, setAcademic] = useState<AcademicBiDashboard | null>(null);
  const [finance, setFinance] = useState<FinanceBiDashboard | null>(null);
  const [operations, setOperations] = useState<OperationsBiDashboard | null>(null);
  const [platform, setPlatform] = useState<PlatformBiDashboard | null>(null);
  const [reports, setReports] = useState<SavedBiReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reportName, setReportName] = useState('');
  const [reportDashboard, setReportDashboard] = useState<'academic' | 'finance' | 'operations' | 'platform'>('academic');
  const isPlatformAdmin = user?.role_key === 'platform_admin';

  const loadDashboard = async () => {
    try {
      setLoading(true);
      setError('');
      const [academicResponse, financeResponse, operationsResponse, reportsResponse, platformResponse] = await Promise.all([
        apiService.getAcademicBiDashboard({ period }),
        apiService.getFinanceBiDashboard({ period }),
        apiService.getOperationsBiDashboard({ period }),
        apiService.listBiReports(),
        isPlatformAdmin ? apiService.getPlatformBiDashboard({ period }) : Promise.resolve(null),
      ]);
      setAcademic(academicResponse.data as AcademicBiDashboard);
      setFinance(financeResponse.data as FinanceBiDashboard);
      setOperations(operationsResponse.data as OperationsBiDashboard);
      setReports(reportsResponse.data as SavedBiReport[]);
      setPlatform(platformResponse ? (platformResponse.data as PlatformBiDashboard) : null);
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'BI dashboard load nahi ho paaya.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDashboard();
  }, [period, isPlatformAdmin]);

  const summaryCards = useMemo(
    () => [
      { label: 'Students', value: academic?.student_count ?? 0, icon: GraduationCap },
      { label: 'MRR', value: `₹${(finance?.mrr ?? 0).toFixed(2)}`, icon: Landmark },
      { label: 'Hostel Utilization', value: `${(operations?.hostel_utilization ?? 0).toFixed(2)}%`, icon: Building2 },
      { label: 'Platform Users', value: isPlatformAdmin ? platform?.active_users ?? 0 : 'School Scope', icon: ShieldCheck },
    ],
    [academic, finance, operations, platform, isPlatformAdmin],
  );

  const handleSaveReport = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!reportName.trim()) {
      setError('Report name required hai.');
      return;
    }
    try {
      setLoading(true);
      setError('');
      await apiService.createBiReport({
        report_name: reportName.trim(),
        dashboard_key: reportDashboard,
        filters: { period },
        selected_metrics: reportDashboard === 'academic' ? ['attendance_trends', 'performance_trends'] : ['trends'],
        export_format: 'csv',
        cadence: period === 'daily' ? 'daily' : period === 'weekly' ? 'weekly' : 'monthly',
      });
      setReportName('');
      await loadDashboard();
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'Report save nahi hua.'));
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async (dashboardKey: 'academic' | 'finance' | 'operations' | 'platform') => {
    try {
      setLoading(true);
      setError('');
      const response = await apiService.exportBiReport({ dashboard_key: dashboardKey, period });
      const payload = response.data;
      const blob = new Blob([payload.content], { type: payload.content_type });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = payload.filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'Export generate nahi hua.'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="rounded-[2rem] bg-gradient-to-br from-slate-900 via-sky-900 to-cyan-700 p-8 text-white shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.28em] text-sky-100/80">Enterprise BI</p>
            <h1 className="mt-3 text-3xl font-bold">Data Warehouse Dashboards</h1>
            <p className="mt-3 max-w-3xl text-sm text-sky-50/90">
              Operational modules se warehouse snapshots build karke academic, finance, operations, aur platform reporting ko fast aur isolated rakha gaya hai.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <select value={period} onChange={(event) => setPeriod(event.target.value as Period)} className="rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-white outline-none">
              <option value="daily" className="text-slate-900">Daily</option>
              <option value="weekly" className="text-slate-900">Weekly</option>
              <option value="monthly" className="text-slate-900">Monthly</option>
              <option value="yearly" className="text-slate-900">Yearly</option>
            </select>
            <button onClick={() => void loadDashboard()} className="inline-flex items-center gap-2 rounded-2xl border border-white/25 bg-white/10 px-4 py-3 text-sm font-semibold text-white hover:bg-white/15">
              <RefreshCcw className="h-4 w-4" />
              Refresh Warehouse
            </button>
          </div>
        </div>
      </div>

      {error ? <Alert type="error" message={error} onClose={() => setError('')} /> : null}
      {loading ? <LoadingSpinner message="Warehouse dashboards load ho rahe hain..." /> : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className={cardClass}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-slate-500">{item.label}</div>
                  <div className="mt-2 text-2xl font-bold text-slate-900">{item.value}</div>
                </div>
                <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">
                  <Icon className="h-5 w-5" />
                </div>
              </div>
            </div>
          );
        })}
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <DashboardCard title="Academic Dashboard" icon={GraduationCap} onExport={() => void handleExport('academic')}>
          <TrendList label="Attendance Trends" items={academic?.attendance_trends || []} suffix="%" />
          <TrendList label="Performance Trends" items={academic?.performance_trends || []} suffix="%" />
          <div className="mt-4">
            <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Weak Topics</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {(academic?.weak_topics || []).map((topic) => (
                <span key={topic.topic} className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                  {topic.topic} ({topic.mentions})
                </span>
              ))}
              {!(academic?.weak_topics || []).length ? <span className="text-sm text-slate-500">No weak-topic signals yet.</span> : null}
            </div>
          </div>
        </DashboardCard>

        <DashboardCard title="Finance Dashboard" icon={Landmark} onExport={() => void handleExport('finance')}>
          <TrendList label="Revenue Trends" items={finance?.revenue_trends || []} prefix="₹" />
          <div className="mt-4 space-y-2 text-sm text-slate-700">
            <div>Subscriptions: <span className="font-semibold">{finance?.subscriptions || 0}</span></div>
            <div>MRR: <span className="font-semibold">₹{(finance?.mrr || 0).toFixed(2)}</span></div>
            <div>ARR: <span className="font-semibold">₹{(finance?.arr || 0).toFixed(2)}</span></div>
          </div>
        </DashboardCard>

        <DashboardCard title="Operations Dashboard" icon={Building2} onExport={() => void handleExport('operations')}>
          <div className="space-y-2 text-sm text-slate-700">
            <div>Hostel Utilization: <span className="font-semibold">{(operations?.hostel_utilization || 0).toFixed(2)}%</span></div>
            <div>Inventory Utilization: <span className="font-semibold">{(operations?.inventory_utilization || 0).toFixed(2)}</span></div>
            <div>Staff Workload: <span className="font-semibold">{(operations?.staff_workload || 0).toFixed(2)}</span></div>
          </div>
          <TrendList label="Operations Trends" items={operations?.operations_trends || []} />
        </DashboardCard>
      </section>

      {isPlatformAdmin ? (
        <section className={cardClass}>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-slate-700" />
              <h2 className="text-lg font-semibold text-slate-900">Platform Dashboard</h2>
            </div>
            <button onClick={() => void handleExport('platform')} className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-100">
              <Download className="h-4 w-4" />
              Export
            </button>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            {[
              ['Tenant Growth', platform?.tenant_growth || 0],
              ['AI Usage', platform?.ai_usage || 0],
              ['LMS Usage', platform?.lms_usage || 0],
              ['Active Users', platform?.active_users || 0],
              ['Churn Risk', `${(platform?.churn_risk || 0).toFixed(2)}%`],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">{label}</div>
                <div className="mt-2 text-2xl font-bold text-slate-900">{value}</div>
              </div>
            ))}
          </div>
          <TrendList label="Platform Trends" items={platform?.trends || []} className="mt-4" />
        </section>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className={cardClass}>
          <div className="flex items-center gap-2">
            <Save className="h-5 w-5 text-slate-700" />
            <h2 className="text-lg font-semibold text-slate-900">Report Builder</h2>
          </div>
          <form onSubmit={handleSaveReport} className="mt-4 grid gap-3">
            <input value={reportName} onChange={(event) => setReportName(event.target.value)} className="rounded-2xl border border-slate-300 px-4 py-3 text-sm" placeholder="Report name" />
            <select value={reportDashboard} onChange={(event) => setReportDashboard(event.target.value as typeof reportDashboard)} className="rounded-2xl border border-slate-300 px-4 py-3 text-sm">
              <option value="academic">Academic</option>
              <option value="finance">Finance</option>
              <option value="operations">Operations</option>
              {isPlatformAdmin ? <option value="platform">Platform</option> : null}
            </select>
            <button className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800">
              <Save className="h-4 w-4" />
              Save & Schedule Report
            </button>
          </form>
        </div>

        <div className={cardClass}>
          <h2 className="text-lg font-semibold text-slate-900">Saved Reports</h2>
          <div className="mt-4 space-y-2">
            {reports.map((report) => (
              <div key={report.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="font-semibold text-slate-900">{report.report_name}</div>
                <div className="mt-1 text-sm text-slate-600">
                  {report.dashboard_key} | {report.export_format} | {report.created_at ? new Date(report.created_at).toLocaleString() : 'pending'}
                </div>
              </div>
            ))}
            {!reports.length ? <div className="text-sm text-slate-500">No BI reports saved yet.</div> : null}
          </div>
        </div>
      </section>
    </div>
  );
}

function DashboardCard({
  title,
  icon: Icon,
  onExport,
  children,
}: {
  title: string;
  icon: typeof GraduationCap;
  onExport: () => void;
  children: ReactNode;
}) {
  return (
    <div className={cardClass}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon className="h-5 w-5 text-slate-700" />
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        </div>
        <button onClick={onExport} className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">
          <Download className="h-4 w-4" />
          Export
        </button>
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function TrendList({
  label,
  items,
  prefix = '',
  suffix = '',
  className = '',
}: {
  label: string;
  items: Array<{ period: string; value: number }>;
  prefix?: string;
  suffix?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">{label}</div>
      <div className="mt-3 space-y-2">
        {items.slice(0, 6).map((item) => (
          <div key={item.period} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            <span>{item.period}</span>
            <span className="font-semibold text-slate-900">{prefix}{item.value.toFixed(2)}{suffix}</span>
          </div>
        ))}
        {!items.length ? <div className="text-sm text-slate-500">No trend data available.</div> : null}
      </div>
    </div>
  );
}
