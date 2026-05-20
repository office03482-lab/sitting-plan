// @ts-nocheck
import { useEffect, useRef, useState } from 'react';
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
import { useAuth } from '@/contexts/AuthProvider';

type EduPaySummaryState = {
  totalCollected: number;
  pendingAmount: number;
  todayCollection: number;
  overdueAmount: number;
};

type StatsState = {
  totalStudents: number;
  totalTeachers: number;
  totalRooms: number;
  totalTimetableEntries: number;
  roomUtilization: number;
  inventoryStock: number;
  recentActivity: string[];
};

type AttendanceTodayState = {
  studentPresent: number;
  studentLate: number;
  studentAbsent: number;
  studentMarked: number;
  staffPresent: number;
  staffLate: number;
  staffHalfDay: number;
  staffAbsent: number;
  notifications: any[];
  holidays: any[];
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
  const hasPermission = useAuthStore((state) => state.hasPermission);
  const { signOut, authReady, sessionReady, initialized: authInitialized, loading: authLoading, session } = useAuth();
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
  const [eduPaySummary, setEduPaySummary] = useState<EduPaySummaryState>({
    totalCollected: 0,
    pendingAmount: 0,
    todayCollection: 0,
    overdueAmount: 0,
  });
  const [attendanceToday, setAttendanceToday] = useState<AttendanceTodayState>({
    studentPresent: 0,
    studentLate: 0,
    studentAbsent: 0,
    studentMarked: 0,
    staffPresent: 0,
    staffLate: 0,
    staffHalfDay: 0,
    staffAbsent: 0,
    notifications: [],
    holidays: [],
  });
  const [inventorySnapshot, setInventorySnapshot] = useState<any>(null);
  const [eduPayDashboardData, setEduPayDashboardData] = useState<any>(null);
  const lastDashboardLoadAtRef = useRef(0);
  const dashboardLoadInFlightRef = useRef<Promise<void> | null>(null);
  const dashboardLoadFingerprintRef = useRef('');
  const dashboardMountedRef = useRef(true);
  const authIdentityFingerprintRef = useRef('');
  const integratedPanelEnabled = false;
  const canRunDashboardRequests = authReady && sessionReady && !!session;

  const debugDashboardLoader = (source: string, details?: Record<string, unknown>) => {
    console.debug('[dashboard-attendance-loader]', source, {
      integratedPanelEnabled,
      showDetailedDashboard,
      authReady,
      sessionReady,
      authInitialized,
      authLoading,
      ...details,
    });
  };

  useEffect(() => {
    const nextFingerprint = `${user?.id || 'anon'}:${user?.school_id || ''}:${user?.role || ''}:${user?.role_key || ''}`;
    if (authIdentityFingerprintRef.current === nextFingerprint) {
      return;
    }
    authIdentityFingerprintRef.current = nextFingerprint;
    debugDashboardLoader('auth.identity.changed', {
      userId: user?.id || null,
      schoolId: user?.school_id || null,
      role: user?.role || null,
      roleKey: user?.role_key || null,
      origin: 'auth-store',
    });
  }, [user?.id, user?.school_id, user?.role, user?.role_key]);

  useEffect(() => {
    if (!canRunDashboardRequests) return;
    debugDashboardLoader('effect.loadStatistics');
    void loadStatistics();
  }, [canViewEduPay, canViewInventory, showDetailedDashboard, canRunDashboardRequests]);

  useEffect(() => {
    return () => {
      dashboardMountedRef.current = false;
    };
  }, []);

  const loadStatistics = async (options?: { force?: boolean }) => {
    const force = options?.force === true;
    if (!canRunDashboardRequests) {
      debugDashboardLoader('loadStatistics.skipped.auth_not_ready', { force });
      return;
    }
    if (!showDetailedDashboard) {
      debugDashboardLoader('loadStatistics.skipped.hidden_dashboard');
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
      setEduPaySummary({
        totalCollected: 0,
        pendingAmount: 0,
        todayCollection: 0,
        overdueAmount: 0,
      });
      setAttendanceToday({
        studentPresent: 0,
        studentLate: 0,
        studentAbsent: 0,
        studentMarked: 0,
        staffPresent: 0,
        staffLate: 0,
        staffHalfDay: 0,
        staffAbsent: 0,
        notifications: [],
        holidays: [],
      });
      setInventorySnapshot(null);
      setEduPayDashboardData(null);
      return;
    }

    const requestFingerprint = `${showDetailedDashboard}:${canViewInventory}:${canViewEduPay}:${Boolean(user?.id)}`;
    const now = Date.now();
    if (!force && dashboardLoadFingerprintRef.current === requestFingerprint && now - lastDashboardLoadAtRef.current < 60_000) {
      debugDashboardLoader('loadStatistics.skipped.cooldown', { requestFingerprint });
      return;
    }
    if (dashboardLoadInFlightRef.current) {
      debugDashboardLoader('loadStatistics.reused_inflight', { requestFingerprint });
      return dashboardLoadInFlightRef.current;
    }

    const loadPromise = (async () => {
      try {
        debugDashboardLoader('loadStatistics.start', { requestFingerprint, force });
        setLoadError(null);
        const today = new Date().toISOString().slice(0, 10);
        const [
          studentCountRes,
          teacherCountRes,
          roomsSummaryRes,
          timetableCountRes,
          attendanceOverviewRes,
        ] = await Promise.allSettled([
          apiService.getStudentsCount(),
          apiService.getTeachersCount(),
          apiService.getRoomsSummary(),
          apiService.getTimetableEntriesCount(),
          apiService.getAttendanceOverview(1),
        ]);

        const attendanceOverview = attendanceOverviewRes.status === 'fulfilled' ? attendanceOverviewRes.value.data : null;
        const studentCount = studentCountRes.status === 'fulfilled' ? Number(studentCountRes.value.data || 0) : 0;
        const teacherCount = teacherCountRes.status === 'fulfilled' ? Number(teacherCountRes.value.data || 0) : 0;
        const roomsSummary =
          roomsSummaryRes.status === 'fulfilled'
            ? roomsSummaryRes.value.data
            : { count: 0, totalCapacity: 0 };
        const timetableCount = timetableCountRes.status === 'fulfilled' ? Number(timetableCountRes.value.data || 0) : 0;
        const notifications = Array.isArray(attendanceOverview?.notifications) ? attendanceOverview.notifications : [];
        const holidays = Array.isArray(attendanceOverview?.holidays) ? attendanceOverview.holidays : [];
        const roomUtilization =
          roomsSummary.count > 0
            ? Math.round((Number(roomsSummary.totalCapacity || 0) / (roomsSummary.count * 50)) * 100)
            : 0;

        if (!dashboardMountedRef.current) return;

        setStats({
          totalStudents: studentCount,
          totalTeachers: teacherCount,
          totalRooms: Number(roomsSummary.count || 0),
          totalTimetableEntries: timetableCount,
          roomUtilization,
          inventoryStock: 0,
          recentActivity: notifications.slice(0, 2).map((item: any) => item?.title || item?.message).filter(Boolean),
        });
        setAttendanceToday({
          studentPresent: 0,
          studentLate: 0,
          studentAbsent: 0,
          studentMarked: 0,
          staffPresent: 0,
          staffLate: 0,
          staffHalfDay: 0,
          staffAbsent: 0,
          notifications,
          holidays,
        });

        if (
          studentCountRes.status === 'rejected' &&
          teacherCountRes.status === 'rejected' &&
          roomsSummaryRes.status === 'rejected' &&
          timetableCountRes.status === 'rejected' &&
          attendanceOverviewRes.status === 'rejected'
        ) {
          throw new Error('Primary dashboard requests failed');
        }

        lastDashboardLoadAtRef.current = Date.now();
        dashboardLoadFingerprintRef.current = requestFingerprint;

        const [inventoryRes, eduPayDashboardRes, staffAttendanceRes, studentAttendanceRes] = await Promise.allSettled([
          canViewInventory ? apiService.getInventoryDashboard() : Promise.resolve({ data: null }),
          canViewEduPay ? apiService.getEduPayDashboard() : Promise.resolve({ data: null }),
          apiService.getStaffAttendanceDashboard({ school_id: 1, date_from: today, date_to: today }),
          apiService.listStudentAttendanceRecords({
            school_id: 1,
            date_from: today,
            date_to: today,
            skip: 0,
            limit: 100,
          }),
        ]);
        if (!dashboardMountedRef.current) return;

        const inventoryDashboard = inventoryRes.status === 'fulfilled' ? inventoryRes.value.data : null;
        const eduPayDashboard = eduPayDashboardRes.status === 'fulfilled' ? eduPayDashboardRes.value.data : null;
        const staffAttendance = staffAttendanceRes.status === 'fulfilled' ? staffAttendanceRes.value.data : null;
        const studentAttendanceRecords =
          studentAttendanceRes.status === 'fulfilled' && Array.isArray(studentAttendanceRes.value.data)
            ? studentAttendanceRes.value.data
            : [];
        const recentPayments = Array.isArray(eduPayDashboard?.recent_payments) ? eduPayDashboard.recent_payments : [];
        const recentActivity = [
          ...notifications.slice(0, 2).map((item: any) => item?.title || item?.message).filter(Boolean),
          ...recentPayments.slice(0, 2).map((item: any) => `${item.student_name || 'Payment'} paid ${formatCompactCurrency(Number(item.amount || 0))}`).filter(Boolean),
          ...(inventoryDashboard?.low_stock_alert_count ? [`${inventoryDashboard.low_stock_alert_count} low stock alerts`] : []),
        ].slice(0, 5);

        setStats((current) => ({
          ...current,
          inventoryStock: inventoryDashboard?.current_stock_available || 0,
          recentActivity,
        }));
        setEduPaySummary({
          totalCollected: Number(eduPayDashboard?.total_collected ?? 0),
          pendingAmount: Number(eduPayDashboard?.pending_amount ?? eduPayDashboard?.total_pending ?? 0),
          todayCollection: Number(eduPayDashboard?.today_collection ?? 0),
          overdueAmount: Number(eduPayDashboard?.overdue_amount ?? 0),
        });
        setAttendanceToday((current) => ({
          ...current,
          studentPresent: studentAttendanceRecords.filter((item: any) => item?.status === 'present').length,
          studentLate: studentAttendanceRecords.filter((item: any) => item?.status === 'late').length,
          studentAbsent: studentAttendanceRecords.filter((item: any) => item?.status === 'absent').length,
          studentMarked: studentAttendanceRecords.length,
          staffPresent: Number(staffAttendance?.present_count ?? 0),
          staffLate: Number(staffAttendance?.late_count ?? 0),
          staffHalfDay: Number(staffAttendance?.half_day_count ?? 0),
          staffAbsent: Number(staffAttendance?.absent_count ?? 0),
        }));
        setInventorySnapshot(inventoryDashboard);
        setEduPayDashboardData(eduPayDashboard);
      } catch (error) {
        debugDashboardLoader('loadStatistics.error', {
          requestFingerprint,
          message: error instanceof Error ? error.message : String(error),
        });
        console.warn('Backend not available, using default statistics:', error);
        if (!dashboardMountedRef.current) return;
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
        setEduPaySummary({
          totalCollected: 0,
          pendingAmount: 0,
          todayCollection: 0,
          overdueAmount: 0,
        });
        setAttendanceToday({
          studentPresent: 0,
          studentLate: 0,
          studentAbsent: 0,
          studentMarked: 0,
          staffPresent: 0,
          staffLate: 0,
          staffHalfDay: 0,
          staffAbsent: 0,
          notifications: [],
          holidays: [],
        });
        setInventorySnapshot(null);
        setEduPayDashboardData(null);
      } finally {
        debugDashboardLoader('loadStatistics.end', { requestFingerprint, force });
      }
    })().finally(() => {
      dashboardLoadInFlightRef.current = null;
    });
    dashboardLoadInFlightRef.current = loadPromise;
    return loadPromise;
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
      title: 'BRAIN OF HIMACHAL',
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

  const staffPresent = attendanceToday.staffPresent + attendanceToday.staffLate + attendanceToday.staffHalfDay;
  const staffNotMarked = Math.max(0, stats.totalTeachers - (staffPresent + attendanceToday.staffAbsent));
  const studentPresent = attendanceToday.studentPresent + attendanceToday.studentLate;
  const studentPending = Math.max(0, stats.totalStudents - attendanceToday.studentMarked);
  const incomeAmount = eduPaySummary.totalCollected;
  const expenseAmount = eduPaySummary.overdueAmount || 0;
  const todaysCollection = eduPaySummary.todayCollection;
  const pendingFees = eduPaySummary.pendingAmount;
  const totalCapacity = Math.max(stats.totalRooms * 50, stats.totalStudents);
  const occupancyPercent = totalCapacity ? Math.round((stats.totalStudents / totalCapacity) * 100) : 0;
  const trendValues = Array.isArray(eduPayDashboardData?.collection_trend) ? eduPayDashboardData.collection_trend : [];
  const trendMax = Math.max(...trendValues.map((item: any) => Number(item?.amount || 0)), 1);
  const rawGreetingName =
    String(user?.full_name || '').trim() ||
    String(user?.username || '').trim() ||
    String(user?.email || '').split('@')[0] ||
    'User';
  const greetingName = rawGreetingName
    .split(/\s+/)
    .filter((part) => part && part.toLowerCase() !== 'main')
    .join(' ') || 'User';

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
                  onClick={async () => {
                    await signOut();
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
                onClick={() => navigate('/attendance-management#overview')}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                <Bell className="h-4 w-4" />
                <span>Notifications</span>
              </button>
              <button
                onClick={async () => {
                  await signOut();
                  navigate('/login');
                }}
                className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100"
              >
                <LogOut className="h-4 w-4" />
                <span>Logout</span>
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
                  <span>Today's Student Attendance</span>
                  <span>{attendanceToday.studentMarked}/{stats.totalStudents}</span>
                </div>
                <div className="flex h-3 overflow-hidden rounded-full bg-slate-200">
                  <div className="bg-emerald-500" style={{ width: `${stats.totalStudents ? (studentPresent / stats.totalStudents) * 100 : 0}%` }} />
                  <div className="bg-rose-500" style={{ width: `${stats.totalStudents ? (attendanceToday.studentAbsent / stats.totalStudents) * 100 : 0}%` }} />
                  <div className="bg-slate-400" style={{ width: `${stats.totalStudents ? (studentPending / stats.totalStudents) * 100 : 0}%` }} />
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-600">
                  <p>Present {attendanceToday.studentPresent}</p>
                  <p>Late {attendanceToday.studentLate}</p>
                  <p>Absent {attendanceToday.studentAbsent}</p>
                  <p>Pending {studentPending}</p>
                </div>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Inventory Snapshot">
            <div className="grid gap-2.5 md:grid-cols-2">
              <div className="rounded-[1rem] bg-slate-50 p-2.5">
                <div className="flex items-center gap-2">
                  <div className="rounded-lg bg-amber-100 p-2 text-amber-700">
                    <Package className="h-4 w-4" />
                  </div>
                  <p className="text-sm font-semibold text-slate-900">Inventory</p>
                </div>
                <div className="mt-2.5 space-y-1.5 text-[11px]">
                  <div className="flex justify-between"><span className="text-slate-600">Materials</span><span className="font-semibold">{inventorySnapshot?.total_materials_registered || 0}</span></div>
                  <div className="flex justify-between"><span className="text-slate-600">Available Stock</span><span className="font-semibold">{inventorySnapshot?.current_stock_available || 0}</span></div>
                  <div className="flex justify-between"><span className="text-slate-600">Low Stock Alerts</span><span className="font-semibold text-rose-600">{inventorySnapshot?.low_stock_alert_count || 0}</span></div>
                </div>
              </div>
              <div className="rounded-[1rem] bg-slate-50 p-2.5">
                <div className="flex items-center gap-2">
                  <div className="rounded-lg bg-violet-100 p-2 text-violet-700">
                    <Wallet className="h-4 w-4" />
                  </div>
                  <p className="text-sm font-semibold text-slate-900">Fees</p>
                </div>
                <div className="mt-2.5 space-y-1.5 text-[11px]">
                  <div className="flex justify-between"><span className="text-slate-600">Collected</span><span className="font-semibold">{formatCompactCurrency(eduPaySummary.totalCollected)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-600">Pending</span><span className="font-semibold">{formatCompactCurrency(eduPaySummary.pendingAmount)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-600">Overdue</span><span className="font-semibold text-rose-600">{formatCompactCurrency(Number(eduPayDashboardData?.overdue_amount || 0))}</span></div>
                </div>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Fee Snapshot" action="Live">
            <div className="grid grid-cols-4 items-end gap-2 pt-1">
              {[
                { label: 'Students', value: Number(eduPayDashboardData?.total_students || 0), color: 'bg-red-500' },
                { label: 'Structures', value: Number(eduPayDashboardData?.active_fee_structures || 0), color: 'bg-teal-500' },
                { label: 'Upcoming', value: Number(eduPayDashboardData?.upcoming_dues || 0), color: 'bg-amber-500' },
                { label: 'Reminders', value: Number(eduPayDashboardData?.reminders_queued || 0), color: 'bg-violet-600' },
              ].map((item, index) => (
                <div key={`${item.label}-${index}`} className="text-center">
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
          <SectionCard title="Collection Trend">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-semibold text-slate-700">
              <span>Total Collected: {formatCompactCurrency(incomeAmount)}</span>
              <span>Overdue: {formatCompactCurrency(Number(eduPayDashboardData?.overdue_amount || 0))}</span>
            </div>
            <div className="mt-3 grid h-[110px] grid-cols-12 items-end gap-1">
              {trendValues.map((value: any, index: number) => (
                <div key={`${value?.month || 'month'}-${index}`} className="flex h-full flex-col items-center justify-end gap-1">
                  <div className="flex h-full w-full items-end justify-center gap-0.5">
                    <div className="w-3 rounded-full bg-amber-400" style={{ height: `${(Number(value?.amount || 0) / trendMax) * 100}%` }} />
                  </div>
                  <span className="text-[9px] text-slate-500">{value?.month || '-'}</span>
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
                {stats.recentActivity.slice(0, 2).map((activity, index) => (
                  <div key={`${activity}-${index}`} className="flex items-start gap-2 rounded-xl bg-slate-50 p-2.5">
                    <div className="rounded-lg bg-indigo-100 p-1.5 text-indigo-700">
                      <Bell className="h-3 w-3" />
                    </div>
                    <p className="text-[11px] text-slate-700">{activity}</p>
                  </div>
                ))}
              </div>
              <div className="rounded-[1rem] bg-slate-50 p-2.5">
                <div className="mb-2 flex items-center justify-between text-[11px] text-slate-600">
                  <span>Upcoming Holidays</span>
                  <span>{attendanceToday.holidays.length}</span>
                </div>
                <div className="space-y-2 text-[11px] text-slate-600">
                  {attendanceToday.holidays.slice(0, 4).map((holiday: any) => (
                    <div key={holiday.id || holiday.holiday_date} className="flex items-center justify-between rounded-xl bg-white px-2.5 py-2">
                      <span className="truncate">{holiday.title}</span>
                      <span className="font-semibold text-slate-900">{String(holiday.holiday_date || '').slice(0, 10)}</span>
                    </div>
                  ))}
                  {!attendanceToday.holidays.length ? (
                    <p className="rounded-xl bg-white px-2.5 py-2 text-center">No holidays scheduled</p>
                  ) : null}
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
