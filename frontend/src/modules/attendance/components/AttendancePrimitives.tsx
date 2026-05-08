// @ts-nocheck
import type { SelectHTMLAttributes } from 'react';
import { ChevronDown, Users } from 'lucide-react';

export function SelectField({
  children,
  className = '',
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-sky-200 bg-sky-50 shadow-sm">
      <select
        {...props}
        className={`w-full cursor-pointer appearance-none bg-transparent px-4 py-3 pr-16 text-sm font-medium text-slate-900 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-4 focus:ring-slate-200/70 ${className}`.trim()}
        style={{ backgroundImage: 'none' }}
      >
        {children}
      </select>
      <div className="pointer-events-none absolute inset-y-0 right-0 flex w-12 items-center justify-center border-l border-sky-200 bg-white/80 text-sky-700">
        <ChevronDown className="h-4 w-4" />
      </div>
    </div>
  );
}

export function HeroMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl bg-slate-50 p-4 text-center">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}

export function StatCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  icon: typeof Users;
  tone: 'indigo' | 'amber' | 'emerald' | 'rose';
}) {
  const colors = {
    indigo: 'bg-indigo-100 text-indigo-600',
    amber: 'bg-amber-100 text-amber-700',
    emerald: 'bg-emerald-100 text-emerald-700',
    rose: 'bg-rose-100 text-rose-700',
  };

  return (
    <div className="rounded-[1.75rem] bg-white p-5 shadow-sm">
      <div className="flex items-center gap-4">
        <div className={`rounded-2xl p-3 ${colors[tone]}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm text-slate-500">{label}</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
        </div>
      </div>
    </div>
  );
}

export function SmallMetricCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'emerald' | 'rose' | 'amber' | 'orange' | 'indigo';
}) {
  const colors = {
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    rose: 'bg-rose-50 border-rose-200 text-rose-700',
    amber: 'bg-amber-50 border-amber-200 text-amber-700',
    orange: 'bg-orange-50 border-orange-200 text-orange-700',
    indigo: 'bg-indigo-50 border-indigo-200 text-indigo-700',
  };

  return (
    <div className={`rounded-2xl border p-4 ${colors[tone]}`}>
      <p className="text-xs uppercase tracking-[0.2em]">{label}</p>
      <p className="mt-2 text-2xl font-bold">{value}</p>
    </div>
  );
}

export function AttendancePageHeader({ vm }: { vm: any }) {
  return (
    <section className="rounded-[2rem] bg-white p-4 shadow-xl sm:p-6 lg:p-8">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.2em] text-indigo-600">Admin Office</p>
          <h1 className="mt-3 text-4xl font-bold text-slate-900">
            {vm.isTeacherSelfView ? 'Teacher Attendance Workspace' : 'Attendance Management System'}
          </h1>
          <p className="mt-4 max-w-3xl text-slate-600">
            {vm.isTeacherSelfView
              ? 'Aapki class attendance, aapki attendance history, aur aapki leave requests yahin dikhenge.'
              : 'Student Attendance, Staff Attendance, Leave Management, Notifications, and Reports from one Admin Office workspace.'}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <HeroMetric label="Students" value={`${vm.overview?.student_count || 0}`} />
          <HeroMetric label="Staff" value={`${vm.overview?.staff_count || 0}`} />
        </div>
      </div>
      <div className="mt-6 flex gap-2 overflow-x-auto rounded-[1.5rem] bg-slate-50 p-2">
        {vm.visibleTabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => vm.setActiveTab(tab.key)}
            className={`shrink-0 rounded-full px-4 py-2.5 text-sm font-medium transition ${
              vm.activeTab === tab.key
                ? 'bg-indigo-600 text-white shadow-md'
                : 'text-slate-600 hover:bg-white hover:text-slate-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </section>
  );
}
