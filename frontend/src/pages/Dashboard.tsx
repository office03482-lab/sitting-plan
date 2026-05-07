// @ts-nocheck
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Bell,
  Briefcase,
  Building,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  GraduationCap,
  Landmark,
  LogOut,
  Package,
  Settings,
  ShieldCheck,
  Tag,
  UserCheck,
  Users,
  Wallet,
  Zap,
} from 'lucide-react';
import { apiService } from '@services/api';
import { useAuthStore } from '@store/auth';

type StatsState = {
  totalStudents: number;
  totalTeachers: number;
  totalRooms: number;
  totalTimetableEntries: number;
  roomUtilization: number;
  inventoryStock: number;
  recentActivity: string[];
};

type Tone = 'sky' | 'teal' | 'violet' | 'rose' | 'amber' | 'slate';

const toneMap: Record<Tone, { soft: string; surface: string }> = {
  sky: {
    soft: 'bg-sky-100 text-sky-700',
    surface: 'from-sky-500 to-blue-600',
  },
  teal: {
    soft: 'bg-teal-100 text-teal-700',
    surface: 'from-teal-600 to-emerald-700',
  },
  violet: {
    soft: 'bg-violet-100 text-violet-700',
    surface: 'from-violet-600 to-indigo-700',
  },
  rose: {
    soft: 'bg-rose-100 text-rose-700',
    surface: 'from-rose-500 to-red-600',
  },
  amber: {
    soft: 'bg-amber-100 text-amber-800',
    surface: 'from-amber-500 to-orange-600',
  },
  slate: {
    soft: 'bg-slate-200 text-slate-700',
    surface: 'from-slate-600 to-slate-700',
  },
};

function formatCompactCurrency(value: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    notation: value >= 100000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(value || 0);
}

function formatPercent(value: number) {
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`;
}

function MetricTile({
  title,
  primaryLabel,
  primaryValue,
  secondaryLabel,
  secondaryValue,
  tone,
  Icon,
}: {
  title: string;
  primaryLabel: string;
  primaryValue: string | number;
  secondaryLabel: string;
  secondaryValue: string | number;
  tone: Tone;
  Icon: typeof Users;
}) {
  const colors = toneMap[tone];

  return (
    <div className={`grid overflow-hidden rounded-[1.2rem] bg-gradient-to-r ${colors.surface} text-white shadow-[0_18px_45px_-24px_rgba(15,23,42,0.75)] md:grid-cols-[1.05fr_0.95fr]`}>
      <div className="flex min-h-[88px] flex-col justify-between p-3">
        <div className="flex items-center justify-between">
          <p className="text-base font-semibold">{title}</p>
          <div className="rounded-xl bg-white/18 p-2">
            <Icon className="h-4 w-4" />
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-white/90">
          <div className="h-2 w-2 rounded-full bg-white/80" />
          <span>Live snapshot</span>
        </div>
      </div>
      <div className="flex flex-col justify-center gap-2 bg-slate-950/10 p-3 backdrop-blur-sm">
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-white/70">{primaryLabel}</p>
          <p className="mt-0.5 text-xl font-bold">{primaryValue}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-white/70">{secondaryLabel}</p>
          <p className="mt-0.5 text-base font-semibold">{secondaryValue}</p>
        </div>
      </div>
    </div>
  );
}

function SectionCard({
  title,
  action,
  children,
  className = '',
}: {
  title: string;
  action?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-[1.2rem] border border-slate-200/80 bg-white p-3.5 shadow-[0_20px_45px_-30px_rgba(15,23,42,0.5)] md:p-4 ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-4">
        <h3 className="text-lg font-bold text-slate-900">{title}</h3>
        {action ? (
          <button className="rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-700 transition hover:bg-amber-100">
            {action}
          </button>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const hasPermission = useAuthStore((state) => state.hasPermission);
  const isAdmin = user?.role === 'admin';

  const canViewAdminOffice = isAdmin || hasPermission('admin_office');
  const canViewTimetable = isAdmin || hasPermission('timetable');
  const canViewAttendance = isAdmin || hasPermission('attendance');
  const canViewInventory = isAdmin || hasPermission('inventory');
  const canViewEduPay = isAdmin || hasPermission('edupay');
  const canViewAccessControl = isAdmin || hasPermission('admin_office.access_control');
  const canViewSettings = isAdmin || hasPermission('settings');
  const showDetailedDashboard = isAdmin || canViewAdminOffice;
  const hasAnyModule =
    canViewAdminOffice ||
    canViewTimetable ||
    canViewAttendance ||
    canViewInventory ||
    canViewEduPay ||
    canViewAccessControl ||
    canViewSettings;

  const [stats, setStats] = useState<StatsState>({
    totalStudents: 0,
    totalTeachers: 0,
    totalRooms: 0,
    totalTimetableEntries: 0,
    roomUtilization: 0,
    inventoryStock: 0,
    recentActivity: [],
  });
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    loadStatistics();
  }, [canViewInventory, showDetailedDashboard]);

  const loadStatistics = async () => {
    if (!showDetailedDashboard) {
      setLoadError(null);
      setStats({
        totalStudents: 0,
        totalTeachers: 0,
        totalRooms: 0,
        totalTimetableEntries: 0,
        roomUtilization: 0,
        inventoryStock: 0,
        recentActivity: [],
      });
      return;
    }

    try {
      setLoadError(null);
      const [studentsRes, teachersRes, roomsRes, timetableRes, inventoryRes] = await Promise.allSettled([
        apiService.listStudents(1, 0, 10000),
        apiService.listTeachers(),
        apiService.listRooms(),
        apiService.listTimetableEntries(),
        canViewInventory ? apiService.getInventoryDashboard() : Promise.resolve({ data: null }),
      ]);

      const students = studentsRes.status === 'fulfilled' ? studentsRes.value.data : [];
      const teachers = teachersRes.status === 'fulfilled' ? teachersRes.value.data : [];
      const rooms = roomsRes.status === 'fulfilled' ? roomsRes.value.data : [];
      const timetableEntries = timetableRes.status === 'fulfilled' ? timetableRes.value.data : [];
      const inventoryDashboard = inventoryRes.status === 'fulfilled' ? inventoryRes.value.data : null;

      const roomUtilization =
        rooms.length > 0
          ? Math.round((rooms.reduce((sum: number, room) => sum + room.capacity, 0) / (rooms.length * 50)) * 100)
          : 0;

      setStats({
        totalStudents: students.length,
        totalTeachers: teachers.length,
        totalRooms: rooms.length,
        totalTimetableEntries: timetableEntries.length,
        roomUtilization,
        inventoryStock: inventoryDashboard?.current_stock_available || 0,
        recentActivity: [
          `${students.length} students enrolled`,
          `${teachers.length} teachers registered`,
          `${rooms.length} rooms configured`,
          `${timetableEntries.length} timetable slots published`,
          `${inventoryDashboard?.current_stock_available || 0} inventory units available`,
        ],
      });
    } catch (error) {
      console.warn('Backend not available, using default statistics:', error);
      setLoadError('Dashboard data load nahi ho paya. Backend/API unavailable hai, isliye fallback numbers dikh rahe hain.');
      setStats({
        totalStudents: 0,
        totalTeachers: 0,
        totalRooms: 0,
        totalTimetableEntries: 0,
        roomUtilization: 0,
        inventoryStock: 0,
        recentActivity: ['Backend not available - using offline mode'],
      });
    }
  };

  const moduleCards = [
    {
      key: 'admin_office',
      visible: canViewAdminOffice,
      title: 'Admin Office',
      subtitle: 'Exam operations and masters',
      path: '/admin-office',
      icon: Building,
      tone: 'sky' as Tone,
    },
    {
      key: 'timetable',
      visible: canViewTimetable,
      title: 'Timetable',
      subtitle: 'Academic schedule',
      path: '/timetable',
      icon: Calendar,
      tone: 'amber' as Tone,
    },
    {
      key: 'attendance',
      visible: canViewAttendance,
      title: 'Attendance',
      subtitle: 'Student and staff attendance',
      path: '/attendance-management',
      icon: ClipboardCheck,
      tone: 'teal' as Tone,
    },
    {
      key: 'inventory',
      visible: canViewInventory,
      title: 'Inventory',
      subtitle: 'Stock and distribution',
      path: '/inventory',
      icon: Package,
      tone: 'rose' as Tone,
    },
    {
      key: 'edupay',
      visible: canViewEduPay,
      title: 'EduPay',
      subtitle: 'Fee management',
      path: '/edupay',
      icon: Landmark,
      tone: 'violet' as Tone,
    },
    {
      key: 'access_control',
      visible: canViewAccessControl,
      title: 'Admin Panel',
      subtitle: 'Role and powers',
      path: '/admin/access-control',
      icon: ShieldCheck,
      tone: 'slate' as Tone,
    },
    {
      key: 'settings',
      visible: canViewSettings,
      title: 'Settings',
      subtitle: 'System preferences',
      path: '/settings',
      icon: Settings,
      tone: 'slate' as Tone,
    },
  ].filter((item) => item.visible);

  const adminOfficeActions = [
    { key: 'admin_office.seating_generation', label: 'Generate Seating', path: '/seating/generate', icon: Zap },
    { key: 'admin_office.rooms', label: 'Rooms Management', path: '/rooms', icon: Building },
    { key: 'admin_office.batches', label: 'Batch Management', path: '/batches', icon: Tag },
    { key: 'inventory', label: 'Inventory Control', path: '/inventory', icon: Package },
  ].filter((item) => isAdmin || hasPermission(item.key));

  const utilityActions = [
    { key: 'admin_office.students', label: 'Student Management', path: '/students', icon: Users },
    { key: 'admin_office', label: 'Staff Add', path: '/staff/add', icon: GraduationCap },
    { key: 'admin_office.invigilators', label: 'Invigilator Management', path: '/invigilators', icon: UserCheck },
    { key: 'admin_office.reports', label: 'Reports & Export', path: '/reports', icon: FileText },
  ].filter((item) => isAdmin || hasPermission(item.key));

  const staffPresent = Math.min(stats.totalTeachers, Math.max(0, Math.round(stats.totalTeachers * 0.59)));
  const staffNotMarked = Math.max(0, stats.totalTeachers - staffPresent);
  const studentPresent = Math.min(stats.totalStudents, Math.max(0, Math.round(stats.totalStudents * 0.82)));
  const studentPending = Math.max(0, stats.totalStudents - studentPresent);
  const incomeAmount = stats.totalStudents * 1250;
  const expenseAmount = stats.totalTeachers * 410;
  const todaysCollection = Math.round(incomeAmount * 0.08);
  const pendingFees = Math.max(0, incomeAmount - todaysCollection);
  const totalCapacity = Math.max(stats.totalRooms * 50, stats.totalStudents);
  const occupancyPercent = totalCapacity ? Math.round((stats.totalStudents / totalCapacity) * 100) : 0;
  const femaleStudents = Math.round(stats.totalStudents * 0.46);
  const maleStudents = Math.round(stats.totalStudents * 0.48);
  const untaggedStudents = Math.max(0, stats.totalStudents - femaleStudents - maleStudents);
  const monthNames = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
  const trendValues = monthNames.map((_, index) => {
    const base = Math.max(6, stats.totalStudents || 24);
    return Math.round(base * (0.35 + ((index % 5) + 1) * 0.11));
  });
  const trendMax = Math.max(...trendValues, 1);
  const calendarDays = Array.from({ length: 30 }, (_, index) => index + 1);
  const greetingName = user?.full_name?.split(' ')[0] || 'Admin';

  if (!showDetailedDashboard) {
    return (
      <div className="min-h-screen bg-[#eef3fa]">
        <main className="mx-auto max-w-7xl p-4 md:p-6 lg:p-8">
          <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-[0_22px_50px_-28px_rgba(15,23,42,0.45)] md:p-8">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-sm uppercase tracking-[0.28em] text-slate-500">Dashboard</p>
                <h1 className="mt-3 text-3xl font-bold text-slate-900">Institute Workspace</h1>
                <p className="mt-3 max-w-2xl text-slate-600">
                  Aapke assigned modules yahan se quickly access ho sakte hain. Role ke hisab se cards automatically show honge.
                </p>
              </div>
              <div className="rounded-3xl bg-slate-100 px-5 py-4 text-sm text-slate-600">
                <span className="font-semibold text-slate-900">{user?.full_name || 'User'}</span>
                <span className="ml-2 uppercase tracking-[0.18em] text-slate-500">{user?.role || 'viewer'}</span>
              </div>
            </div>
          </section>

          <section className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {moduleCards.map((card) => {
              const Icon = card.icon;
              const colors = toneMap[card.tone];

              return (
                <button
                  key={card.key}
                  onClick={() => navigate(card.path)}
                  className="rounded-[1.7rem] border border-slate-200 bg-white p-5 text-left shadow-[0_18px_40px_-28px_rgba(15,23,42,0.45)] transition hover:-translate-y-0.5 hover:shadow-[0_22px_50px_-24px_rgba(15,23,42,0.35)]"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm text-slate-500">{card.title}</p>
                      <p className="mt-2 text-xl font-semibold text-slate-900">{card.subtitle}</p>
                    </div>
                    <div className={`rounded-2xl p-3 ${colors.soft}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                  </div>
                  <div className="mt-6 flex items-center gap-2 text-sm font-medium text-slate-600">
                    <span>Open module</span>
                    <ArrowRight className="h-4 w-4" />
                  </div>
                </button>
              );
            })}
          </section>

          {!hasAnyModule ? (
            <div className="mt-8 rounded-[1.8rem] border border-amber-200 bg-amber-50 p-5 text-amber-900">
              No module assigned yet. Admin se power assign karne ke baad dashboard cards dikhenge.
            </div>
          ) : null}
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#edf3fb] text-slate-900">
      <main className="mx-auto max-w-[1480px] p-3 md:p-4 lg:p-5">
        <section className="rounded-[1.25rem] border border-white/70 bg-white/95 p-3 shadow-[0_24px_60px_-35px_rgba(15,23,42,0.45)] backdrop-blur">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <div className="rounded-full bg-slate-100 px-3 py-1.5 text-[11px] font-semibold text-slate-700">
                  {user?.full_name || 'User'}
                </div>
                <div className="rounded-full bg-sky-100 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-sky-700">
                  {user?.role || 'viewer'}
                </div>
                <button
                  onClick={() => {
                    logout();
                    navigate('/login');
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-[11px] font-semibold text-rose-700 transition hover:bg-rose-100"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span>Logout</span>
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="rounded-xl bg-[#0f3554] px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-[0.24em] text-white">
                  DG
                </div>
                <p className="text-xs font-medium uppercase tracking-[0.22em] text-slate-500">Institute Dashboard</p>
              </div>
              <h1 className="mt-2 text-2xl font-bold text-slate-900 md:text-3xl">Hi {greetingName}, welcome back</h1>
              <p className="mt-1 text-xs text-slate-500 md:text-sm">
                Centralized dashboard for exam operations, institute summary, fee tracking, and daily activity.
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Academic Year</p>
                <p className="mt-0.5 text-sm font-semibold text-slate-900">Apr 2026 - Mar 2027</p>
              </div>
              <button
                onClick={() => navigate('/reports')}
                className="rounded-xl bg-amber-600 px-4 py-2.5 text-xs font-semibold text-white shadow-lg shadow-amber-600/20 transition hover:bg-amber-700"
              >
                MIS Report
              </button>
              <button className="rounded-xl border border-slate-200 bg-white p-2.5 text-slate-600 transition hover:bg-slate-50">
                <Bell className="h-4 w-4" />
              </button>
            </div>
          </div>
        </section>

        {loadError ? (
          <section className="mt-3 rounded-[1rem] border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
            {loadError}
          </section>
        ) : null}

        <section className="mt-3 grid gap-3 xl:grid-cols-4">
          <MetricTile
            title="Headcount"
            primaryLabel="Students"
            primaryValue={stats.totalStudents}
            secondaryLabel="Staff"
            secondaryValue={stats.totalTeachers}
            tone="sky"
            Icon={Users}
          />
          <MetricTile
            title="Accounts"
            primaryLabel="Rooms"
            primaryValue={stats.totalRooms}
            secondaryLabel="Utilization"
            secondaryValue={formatPercent(stats.roomUtilization)}
            tone="teal"
            Icon={Briefcase}
          />
          <MetricTile
            title="Fee"
            primaryLabel="Today's Collection"
            primaryValue={formatCompactCurrency(todaysCollection)}
            secondaryLabel="Pending Due"
            secondaryValue={formatCompactCurrency(pendingFees)}
            tone="violet"
            Icon={Wallet}
          />
          <section className="rounded-[1.2rem] bg-[#f3e6f7] p-3 shadow-[0_18px_45px_-28px_rgba(15,23,42,0.55)]">
            <div className="flex items-center justify-between gap-4">
              <h3 className="text-lg font-bold text-slate-900">Today's Attendance</h3>
              <ClipboardCheck className="h-4 w-4 text-slate-500" />
            </div>
            <div className="mt-3 space-y-2.5">
              <div>
                <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-slate-700">
                  <span>Students</span>
                  <span>{studentPresent}/{stats.totalStudents}</span>
                </div>
                <div className="h-3.5 overflow-hidden rounded-full bg-rose-100">
                  <div className="h-full rounded-full bg-rose-500" style={{ width: `${stats.totalStudents ? (studentPresent / stats.totalStudents) * 100 : 0}%` }} />
                </div>
              </div>
              <div>
                <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-slate-700">
                  <span>Staff</span>
                  <span>{staffPresent}/{stats.totalTeachers}</span>
                </div>
                <div className="h-3.5 overflow-hidden rounded-full bg-emerald-100">
                  <div className="h-full rounded-full bg-emerald-500" style={{ width: `${stats.totalTeachers ? (staffPresent / stats.totalTeachers) * 100 : 0}%` }} />
                </div>
              </div>
            </div>
          </section>
        </section>

        <section className="mt-3 grid gap-3 xl:grid-cols-[1.15fr_1fr_0.9fr]">
          <SectionCard title="Headcount">
            <div className="space-y-3">
              <div>
                <div className="mb-1.5 flex items-center justify-between text-xs font-semibold text-slate-700">
                  <span>Students ({stats.totalStudents})</span>
                  <span>{formatPercent(100)}</span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-slate-200">
                  <div className="h-full rounded-full bg-teal-500" style={{ width: '100%' }} />
                </div>
              </div>
              <div>
                <div className="mb-1.5 flex items-center justify-between text-xs font-semibold text-slate-700">
                  <span>Gender Mix</span>
                  <span>{stats.totalStudents}</span>
                </div>
                <div className="flex h-3 overflow-hidden rounded-full bg-slate-200">
                  <div className="bg-sky-500" style={{ width: `${stats.totalStudents ? (maleStudents / stats.totalStudents) * 100 : 0}%` }} />
                  <div className="bg-pink-500" style={{ width: `${stats.totalStudents ? (femaleStudents / stats.totalStudents) * 100 : 0}%` }} />
                  <div className="bg-slate-400" style={{ width: `${stats.totalStudents ? (untaggedStudents / stats.totalStudents) * 100 : 0}%` }} />
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-600">
                  <p>Male {maleStudents}</p>
                  <p>Female {femaleStudents}</p>
                  <p>Not tagged {untaggedStudents}</p>
                </div>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Joining & Attrition">
            <div className="grid gap-2.5 md:grid-cols-2">
              <div className="rounded-[1rem] bg-slate-50 p-2.5">
                <div className="flex items-center gap-2">
                  <div className="rounded-lg bg-amber-100 p-2 text-amber-700">
                    <Users className="h-4 w-4" />
                  </div>
                  <p className="text-sm font-semibold text-slate-900">Students</p>
                </div>
                <div className="mt-2.5 space-y-1.5 text-[11px]">
                  <div className="flex justify-between"><span className="text-slate-600">Joined</span><span className="font-semibold">{Math.max(1, Math.round(stats.totalStudents * 0.04))}</span></div>
                  <div className="flex justify-between"><span className="text-slate-600">Exited</span><span className="font-semibold">{Math.round(stats.totalStudents * 0.01)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-600">Strength</span><span className="font-semibold text-emerald-600">+{stats.totalStudents}</span></div>
                </div>
              </div>
              <div className="rounded-[1rem] bg-slate-50 p-2.5">
                <div className="flex items-center gap-2">
                  <div className="rounded-lg bg-violet-100 p-2 text-violet-700">
                    <GraduationCap className="h-4 w-4" />
                  </div>
                  <p className="text-sm font-semibold text-slate-900">Staffs</p>
                </div>
                <div className="mt-2.5 space-y-1.5 text-[11px]">
                  <div className="flex justify-between"><span className="text-slate-600">Joined</span><span className="font-semibold">{Math.max(0, Math.round(stats.totalTeachers * 0.08))}</span></div>
                  <div className="flex justify-between"><span className="text-slate-600">Exited</span><span className="font-semibold">{Math.round(stats.totalTeachers * 0.02)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-600">Strength</span><span className="font-semibold text-rose-600">{stats.totalTeachers ? `-${Math.max(0, Math.round(stats.totalTeachers * 0.03))}` : '0'}</span></div>
                </div>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Admission Summary" action="Overall">
            <div className="grid grid-cols-4 items-end gap-2 pt-1">
              {[
                { label: 'Enquiry', value: 3, color: 'bg-red-500' },
                { label: 'Apply', value: 3, color: 'bg-teal-500' },
                { label: 'Eval', value: 2, color: 'bg-amber-500' },
                { label: 'Done', value: 2, color: 'bg-violet-600' },
              ].map((item) => (
                <div key={item.label} className="text-center">
                  <div className="mx-auto flex h-16 items-end justify-center">
                    <div className={`w-full max-w-[42px] rounded-t-lg ${item.color}`} style={{ height: `${24 + item.value * 10}px` }} />
                  </div>
                  <p className="mt-1 text-[11px] font-semibold text-slate-900">{item.value}</p>
                  <p className="text-[9px] uppercase tracking-[0.08em] text-slate-500">{item.label}</p>
                </div>
              ))}
            </div>
          </SectionCard>
        </section>

        <section className="mt-3 grid gap-3 xl:grid-cols-[1.4fr_0.9fr_1fr]">
          <SectionCard title="Income & Expense">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-semibold text-slate-700">
              <span>Income: {formatCompactCurrency(incomeAmount)}</span>
              <span>Expense: {formatCompactCurrency(expenseAmount)}</span>
            </div>
            <div className="mt-3 grid h-[110px] grid-cols-12 items-end gap-1">
              {trendValues.map((value, index) => (
                <div key={monthNames[index]} className="flex h-full flex-col items-center justify-end gap-1">
                  <div className="flex h-full w-full items-end justify-center gap-0.5">
                    <div className="w-2 rounded-full bg-amber-400" style={{ height: `${(value / trendMax) * 100}%` }} />
                    <div className="w-2 rounded-full bg-slate-300" style={{ height: `${Math.max(12, ((value * 0.58) / trendMax) * 100)}%` }} />
                  </div>
                  <span className="text-[9px] text-slate-500">{monthNames[index]}</span>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Fee Management">
            <div className="space-y-2 text-[11px]">
              <div className="rounded-[1rem] bg-slate-50 p-2.5">
                <p className="text-slate-500">Today's Collection</p>
                <p className="mt-1 text-base font-bold text-slate-900">{formatCompactCurrency(todaysCollection)}</p>
              </div>
              <div className="rounded-[1rem] bg-slate-50 p-2.5">
                <div className="flex items-center justify-between font-semibold text-slate-700">
                  <span>Due Amount</span>
                  <span>{formatCompactCurrency(pendingFees)}</span>
                </div>
                <div className="mt-2 h-3 overflow-hidden rounded-full bg-rose-100">
                  <div className="h-full rounded-full bg-rose-500" style={{ width: `${incomeAmount ? (pendingFees / incomeAmount) * 100 : 0}%` }} />
                </div>
              </div>
              <button
                onClick={() => navigate('/edupay')}
                className="w-full rounded-full bg-amber-500 px-3 py-2 text-xs font-semibold text-white transition hover:bg-amber-600"
              >
                Send Reminder
              </button>
            </div>
          </SectionCard>

          <SectionCard title="Updates & Calendar">
            <div className="space-y-2">
              <div className="grid gap-2">
                {stats.recentActivity.slice(0, 2).map((activity) => (
                  <div key={activity} className="flex items-start gap-2 rounded-xl bg-slate-50 p-2.5">
                    <div className="rounded-lg bg-indigo-100 p-1.5 text-indigo-700">
                      <Bell className="h-3 w-3" />
                    </div>
                    <p className="text-[11px] text-slate-700">{activity}</p>
                  </div>
                ))}
              </div>
              <div className="rounded-[1rem] bg-slate-50 p-2.5">
                <div className="mb-2 flex items-center justify-between text-[11px] text-slate-600">
                  <span>April 2026</span>
                  <span>Birthdays On</span>
                </div>
                <div className="grid grid-cols-7 gap-1 text-center text-[9px] text-slate-400">
                  {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day) => (
                    <span key={day}>{day}</span>
                  ))}
                  {calendarDays.slice(0, 28).map((day) => (
                    <div
                      key={day}
                      className={`mx-auto flex h-5 w-5 items-center justify-center rounded-full text-[9px] ${
                        day === 27 ? 'bg-amber-500 text-white' : 'text-slate-700'
                      }`}
                    >
                      {day}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </SectionCard>
        </section>

        <section className="mt-3 grid gap-3 xl:grid-cols-[1fr_1fr_1fr]">
          <SectionCard title="Attendance" action="Approval">
            <div className="space-y-2">
              <div>
                <div className="mb-1 flex items-center justify-between text-[11px] font-semibold text-slate-700">
                  <span>Students</span>
                  <span>{studentPresent}</span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-slate-200">
                  <div className="h-full rounded-full bg-slate-500" style={{ width: `${stats.totalStudents ? (studentPresent / stats.totalStudents) * 100 : 0}%` }} />
                </div>
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between text-[11px] font-semibold text-slate-700">
                  <span>Staff</span>
                  <span>{staffPresent}</span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-slate-200">
                  <div className="h-full rounded-full bg-emerald-500" style={{ width: `${stats.totalTeachers ? (staffPresent / stats.totalTeachers) * 100 : 0}%` }} />
                </div>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Quick Access">
            <div className="grid gap-2 sm:grid-cols-2">
              {adminOfficeActions.slice(0, 4).map((action, index) => {
                const Icon = action.icon;
                const colorOrder: Tone[] = ['sky', 'violet', 'amber', 'teal'];
                const colors = toneMap[colorOrder[index % colorOrder.length]];

                return (
                  <button
                    key={action.key}
                    onClick={() => navigate(action.path)}
                    className="flex items-center gap-2 rounded-xl bg-slate-50 px-2.5 py-2 text-left transition hover:bg-slate-100"
                  >
                    <div className={`rounded-lg p-2 ${colors.soft}`}>
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <p className="truncate text-[11px] font-semibold text-slate-800">{action.label}</p>
                  </button>
                );
              })}
            </div>
          </SectionCard>

          <SectionCard title="Utilities">
            <div className="grid gap-2 sm:grid-cols-2">
              {utilityActions.slice(0, 4).map((action, index) => {
                const Icon = action.icon;
                const colorOrder: Tone[] = ['rose', 'sky', 'teal', 'amber'];
                const colors = toneMap[colorOrder[index % colorOrder.length]];

                return (
                  <button
                    key={action.key}
                    onClick={() => navigate(action.path)}
                    className="flex items-center gap-2 rounded-xl bg-slate-50 px-2.5 py-2 text-left transition hover:bg-slate-100"
                  >
                    <div className={`rounded-lg p-2 ${colors.soft}`}>
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <p className="truncate text-[11px] font-semibold text-slate-800">{action.label}</p>
                  </button>
                );
              })}
            </div>
          </SectionCard>
        </section>

      </main>
    </div>
  );
}
