import { useNavigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  BookOpen,
  Building,
  Building2,
  CalendarClock,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Contact,
  DoorOpen,
  FileBarChart2,
  FileQuestion,
  GraduationCap,
  Home,
  Landmark,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
  UserCheck,
  UserCog,
  Users,
  Video,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuthStore } from '@store/auth';
import { usePlatformAdminSchoolStore } from '@store/platformAdminSchool';
import { useAppStore } from '@store/app';
import PlatformAdminSchoolSelector from '@components/PlatformAdminSchoolSelector';
import PlatformAdminSchoolScopeBanner from '@components/PlatformAdminSchoolScopeBanner';
import { DEFAULT_HOME_ROUTE, useAuth } from '@/contexts/AuthProvider';
import { apiService } from '@services/api';
import type { UserRole } from '@types';
import bhavyaAxisLogo from '@/assets/bhavya-axis-logo-removebg-preview.png';

interface LayoutProps {
  children: ReactNode;
}

type MenuChild = {
  name: string;
  path: string;
  permission?: string | string[];
  roles?: UserRole[];
};

type MenuSection = {
  key: string;
  name: string;
  icon: LucideIcon;
  permission?: string | string[];
  roles?: UserRole[];
  path?: string;
  children?: MenuChild[];
};

/* ── premium design tokens ─────────────────────────────────────────────── */
const SIDEBAR_BG = 'linear-gradient(180deg, #1D4ED8 0%, #2563EB 50%, #0F3D91 100%)';
const SIDEBAR_FONT = "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif";

const IconChip = ({ icon: Icon, color }: { icon: LucideIcon; color: string }) => (
  <span
    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl shadow-sm ring-1 ring-white/20"
    style={{ background: color }}
  >
    <Icon className="h-[18px] w-[18px] text-white" />
  </span>
);

const itemBase = (active: boolean) =>
  `group relative flex w-full items-center gap-3 rounded-2xl pl-2 pr-3 text-left transition-all duration-200 h-[48px] ${
    active
      ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-lg shadow-blue-500/40 ring-1 ring-white/25'
      : 'bg-white/5 text-blue-100 hover:bg-white/10 hover:text-white hover:shadow-lg hover:-translate-y-px'
  }`;

const childBase = (active: boolean) =>
  `group relative flex w-full items-center gap-3 rounded-xl pl-3 pr-3 text-left text-[13px] transition-all duration-200 h-[40px] ${
    active
      ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-md shadow-blue-500/30 font-semibold'
      : 'text-blue-200 hover:bg-white/10 hover:text-white'
  }`;

const labelCls = (active: boolean) =>
  `min-w-0 flex-1 truncate text-[14px] ${active ? 'font-bold text-white' : 'font-semibold text-blue-100'}`;

const LeftAccent = () => <span className="absolute inset-y-2.5 left-0 w-[3px] rounded-r-full bg-white" />;

/* Per-category accent colours (rounded icon containers + category headers) */


const SECTION_COLOR: Record<string, string> = {
  dashboard: '#3b82f6',
  academic: '#10b981',
  attendance: '#f59e0b',
  timetable: '#06b6d4',
  lms: '#8b5cf6',
  examinations: '#ec4899',
  'online-tests': '#ec4899',
  'live-classes': '#14b8a6',
  'exam-planner': '#f97316',
  staff: '#6366f1',
  hostels: '#0ea5e9',
  inventory: '#84cc16',
  'admin-office': '#eab308',
  rooms: '#a855f7',
  invigilators: '#ef4444',
  fees: '#f43f5e',
  'school-self-service': '#22d3ee',
  'parent-portal': '#d946ef',
  'student-portal': '#fb7185',
  'ai-assistants': '#7c3aed',
  predictions: '#c026d3',
  'enterprise-bi': '#0891b2',
  reports: '#0d9488',
  settings: '#64748b',
  security: '#475569',
};





export default function Layout({ children }: LayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [openSections, setOpenSections] = useState<string[]>([]);
  const [hoveredCollapsedKey, setHoveredCollapsedKey] = useState<string | null>(null);
  const [totalSchools, setTotalSchools] = useState<number | null>(null);
  const user = useAuthStore((state) => state.user);
  const { signOut, canAccess: authCanAccess } = useAuth();
  const { activeSchoolId, activeSchoolName, schoolBranding, setSchoolBranding, clearActiveSchool } = usePlatformAdminSchoolStore();
  const brandingFetchKeyRef = useRef<string | null>(null);
  const isAdmin = user?.role === 'admin';
  const isPlatformAdmin = user?.role_key === 'platform_admin';
  const roleKey = String(user?.role_key || '').toLowerCase();
  const isStudentAiUser = roleKey === 'student' || user?.role === 'student';
  const isTeacherAiUser = roleKey === 'teacher' || user?.role === 'teacher';
  const isSchoolAiUser = isAdmin || roleKey === 'school_admin' || roleKey === 'platform_admin';
  const currentRoute = `${location.pathname}${location.hash || ''}`;

  const brandAccent = schoolBranding?.accent_color || '#22d3ee';
  const shellBackground = `linear-gradient(180deg, color-mix(in srgb, ${brandAccent} 12%, white) 0%, #eef3fa 40%, white 100%)`;

  const PLATFORM_ITEMS: Record<string, { name: string; path: string }> = {
    'platform-dashboard': { name: 'Platform Dashboard', path: '/platform/dashboard' },
    'platform-schools': { name: 'Schools', path: '/platform/schools' },
    'platform-analytics': { name: 'Platform Analytics', path: '/platform/analytics' },
    'platform-health': { name: 'Platform Health', path: '/platform/health' },
    'platform-subscriptions': { name: 'Subscriptions', path: '/platform/subscriptions' },
    'platform-usage': { name: 'Usage', path: '/platform/usage' },
    'platform-search': { name: 'Global Search', path: '/platform/search' },
    'platform-support': { name: 'Support Center', path: '/platform/support' },
    'platform-notifications': { name: 'Notifications', path: '/platform/notifications' },
    'platform-onboarding': { name: 'Onboarding', path: '/platform/onboarding' },
    'platform-workflow': { name: 'Workflow Queue', path: '/platform/workflow' },
    'platform-audit': { name: 'Audit Logs', path: '/platform/audit-logs' },
  };

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.title = activeSchoolName || schoolBranding?.portal_name || 'Dr. Girish App';
    const faviconHref = schoolBranding?.logo_url || bhavyaAxisLogo;
    let favicon = document.querySelector("link[rel='icon']") as HTMLLinkElement | null;
    if (!favicon) {
      favicon = document.createElement('link');
      favicon.rel = 'icon';
      document.head.appendChild(favicon);
    }
    favicon.href = schoolBranding?.logo_url || schoolBranding?.favicon_url || faviconHref;
  }, [schoolBranding, activeSchoolName]);

  // Platform Workspace metric: total number of schools managed by the platform.
  // Only fetched for platform admins so the default "Managing All Schools" panel
  // can surface a live count. No school context is entered by this call.
  useEffect(() => {
    if (!isPlatformAdmin) {
      setTotalSchools(null);
      return;
    }
    const controller = new AbortController();
    (async () => {
      try {
        const response = await apiService.listPlatformSchools({}, { signal: controller.signal });
        setTotalSchools(response.data.total_count ?? response.data.items?.length ?? 0);
      } catch (error) {
        if ((error as { code?: string } | null)?.code === 'ERR_CANCELED') {
          return;
        }
        setTotalSchools(null);
      }
    })();
    return () => {
      controller.abort();
    };
  }, [isPlatformAdmin]);

  // Fetch branding whenever the active school changes.
  const fetchBranding = useCallback(async (schoolId: string, signal?: AbortSignal) => {
    const fetchKey = schoolId || '__platform__';
    if (brandingFetchKeyRef.current === fetchKey) return;
    brandingFetchKeyRef.current = fetchKey;
    try {
      const res = await apiService.getPublicSchoolBranding({ school: schoolId }, { signal });
      setSchoolBranding({
        logo_url: res.data.logo_url,
        favicon_url: res.data.favicon_url,
        portal_name: res.data.portal_name,
        primary_color: res.data.primary_color,
        secondary_color: res.data.secondary_color,
        accent_color: res.data.accent_color,
      });
    } catch (error) {
      if ((error as { code?: string } | null)?.code === 'ERR_CANCELED') {
        return;
      }
      setSchoolBranding(null);
    }
  }, [setSchoolBranding]);

  useEffect(() => {
    const controller = new AbortController();
    if (activeSchoolId) {
      void fetchBranding(activeSchoolId, controller.signal);
    } else {
      brandingFetchKeyRef.current = null;
      setSchoolBranding(null);
    }
    // Clear stale app store arrays to prevent showing data from previous school
    // while preserving school-scoped reference caches for quick switch-back.
    useAppStore.getState().setStudents([]);
    useAppStore.getState().setRooms([]);
    useAppStore.getState().setSeatingPlans([]);
    return () => {
      controller.abort();
    };
  }, [activeSchoolId, fetchBranding, setSchoolBranding]);

  const canAccess = (permission?: string | string[], roles?: UserRole[]) =>
    authCanAccess({
      roles,
      permissions: Array.isArray(permission) ? permission : permission ? [permission] : undefined,
    });

  const rawSections: MenuSection[] = [
    {
      key: 'dashboard',
      name: 'Dashboard',
      icon: LayoutDashboard,
      path: DEFAULT_HOME_ROUTE,
    },
    {
      key: 'academic',
      name: 'Student Management',
      icon: Users,
      permission: 'admin_office.students',
      children: [
        { name: 'Add Student', path: '/students#add', permission: 'admin_office.students' },
        { name: 'Student Directory', path: '/students/directory', permission: 'admin_office.students' },
        { name: 'Bulk Upload', path: '/students#bulk-upload', permission: 'admin_office.students' },
        { name: 'Batch Management', path: '/batches', permission: 'admin_office.batches' },
      ],
    },
    {
      key: 'attendance',
      name: 'Attendance',
      icon: ClipboardCheck,
      permission: 'attendance',
      children: [
        { name: 'Overview', path: '/attendance-management#overview', permission: 'attendance.overview' },
        { name: 'Student Attendance', path: '/attendance-management#student', permission: 'attendance.student' },
        { name: 'Staff Attendance', path: '/attendance-management#staff', permission: 'attendance.staff' },
        { name: 'Leave Management', path: '/attendance-management#leaves', permission: 'attendance.leaves' },
        { name: 'Reports', path: '/attendance-management#reports', permission: 'attendance.reports' },
      ],
    },
    {
      key: 'timetable',
      name: 'Time Table',
      icon: CalendarDays,
      permission: 'timetable',
      children: [{ name: 'Timetable Management', path: '/timetable', permission: 'timetable' }],
    },
    {
      key: 'lms',
      name: 'Learning Hub',
      icon: BookOpen,
      roles: ['admin', 'teacher', 'student', 'viewer'],
      children: [
        { name: 'Courses', path: '/courses', permission: 'lms.view' },
        { name: 'My Learning', path: '/my-learning' },
        { name: 'Assignments', path: '/assignments', permission: 'lms.assignments' },
      ],
    },
    {
      key: 'examinations',
      name: 'Examinations',
      icon: FileQuestion,
      children: [
        {
          name: 'Dashboard',
          path: '/online-tests',
          permission: ['online_tests', 'online_tests.view', 'online_tests.manage', 'online_tests.attempt', 'online_tests.grade', 'online_tests.reports'],
        },
        {
          name: 'Question Bank',
          path: '/question-bank',
          permission: ['online_tests', 'online_tests.manage'],
        },
        {
          name: 'Online Tests',
          path: '/online-tests',
          permission: ['online_tests', 'online_tests.view', 'online_tests.manage', 'online_tests.attempt', 'online_tests.grade', 'online_tests.reports'],
        },
        {
          name: 'Offline Exams',
          path: '/offline-exams',
          permission: ['offline_exams', 'offline_exams.view', 'offline_exams.manage', 'offline_exams.reports'],
        },
        {
          name: 'Paper Generator',
          path: '/teacher-ai',
          permission: ['teacher_ai.generate', 'teacher_ai.evaluate', 'teacher_ai.reports'],
        },
        {
          name: 'Reports',
          path: '/reports',
          permission: 'admin_office.reports',
        },
      ],
    },
    {
      key: 'live-classes',
      name: 'Live Classes',
      icon: Video,
      children: [{ name: 'Session Hub', path: '/live-classes', permission: 'live_classes.view' }],
    },
    {
      key: 'exam-planner',
      name: 'Exam Planner',
      icon: CalendarClock,
      permission: 'admin_office',
      children: [
        { name: 'Seating Generation', path: '/seating/generate', permission: 'admin_office.seating_generation' },
        { name: 'Seating Plans', path: '/seating/plans', permission: 'admin_office.seating_plans' },
      ],
    },
    {
      key: 'staff',
      name: 'Staff Management',
      icon: UserCog,
      permission: 'admin_office',
      children: [
        { name: 'Add Staff', path: '/staff/add', permission: 'admin_office' },
        { name: 'Staff Directory', path: '/staff/directory', permission: 'admin_office' },
        { name: 'Bulk Upload', path: '/staff/bulk-upload', permission: 'admin_office' },
      ],
    },
    {
      key: 'hostels',
      name: 'Hostel Management',
      icon: Home,
      permission: 'admin_office.hostels',
      children: [{ name: 'Hostel Dashboard', path: '/hostels', permission: 'admin_office.hostels' }],
    },
    {
      key: 'inventory',
      name: 'Inventory Control',
      icon: Package,
      permission: 'inventory',
      children: [
        { name: 'Inventory Dashboard', path: '/inventory#dashboard', permission: 'inventory' },
        { name: 'Material Master', path: '/inventory#materials', permission: 'inventory' },
        { name: 'Suppliers', path: '/inventory#suppliers', permission: 'inventory' },
        { name: 'Stock In', path: '/inventory#stock-in', permission: 'inventory' },
        { name: 'Batch Distribution', path: '/inventory#stock-out', permission: 'inventory' },
        { name: 'Reports & Export', path: '/inventory#reports', permission: 'inventory' },
      ],
    },
    {
      key: 'admin-office',
      name: 'Admin Office',
      icon: Building,
      permission: 'admin_office',
      children: [{ name: 'Admin Office Dashboard', path: '/admin-office', permission: 'admin_office' }],
    },
    {
      key: 'rooms',
      name: 'Room Management',
      icon: DoorOpen,
      permission: 'admin_office.rooms',
      children: [{ name: 'Room Configuration', path: '/rooms', permission: 'admin_office.rooms' }],
    },
    {
      key: 'invigilators',
      name: 'Invigilator Management',
      icon: UserCheck,
      permission: 'admin_office.invigilators',
      children: [{ name: 'Staff Assignment', path: '/invigilators', permission: 'admin_office.invigilators' }],
    },
    {
      key: 'fees',
      name: 'Fee Management',
      icon: Landmark,
      permission: 'edupay',
      children: [
        { name: 'Fee Management', path: '/edupay', permission: 'edupay' },
        { name: 'EduPay', path: '/commerce', permission: 'edupay.revenue' },
      ],
    },
    {
      key: 'school-self-service',
      name: 'School Self-Service',
      icon: SlidersHorizontal,
      permission: 'settings',
      roles: ['admin', 'school_admin', 'platform_admin'],
      children: [
        { name: 'School Branding', path: '/school-self-service/branding', permission: 'settings', roles: ['admin', 'school_admin', 'platform_admin'] },
        { name: 'School Preferences', path: '/school-self-service/preferences', permission: 'settings', roles: ['admin', 'school_admin', 'platform_admin'] },
        { name: 'Portal Settings', path: '/school-self-service/portal-settings', permission: 'settings', roles: ['admin', 'school_admin', 'platform_admin'] },
        { name: 'Email Templates', path: '/school-self-service/email-templates', permission: 'settings', roles: ['admin', 'school_admin', 'platform_admin'] },
        { name: 'SMS / WhatsApp', path: '/school-self-service/messaging-templates', permission: 'settings', roles: ['admin', 'school_admin', 'platform_admin'] },
        { name: 'Storage Center', path: '/school-self-service/storage', permission: 'settings', roles: ['admin', 'school_admin', 'platform_admin'] },
        { name: 'Backup Center', path: '/school-self-service/backups', permission: 'settings', roles: ['admin', 'school_admin', 'platform_admin'] },
      ],
    },
    {
      key: 'parent-portal',
      name: 'Parent Portal',
      icon: Contact,
      permission: 'edupay.parent_portal',
      roles: ['parent', 'admin'],
      children: [
        { name: 'Dashboard', path: '/parent/dashboard', permission: 'parent_intelligence.view' },
        { name: 'Attendance', path: '/parent/attendance', permission: 'parent_intelligence.view' },
        { name: 'Progress', path: '/parent/progress', permission: 'parent_intelligence.view' },
        { name: 'Assignments', path: '/parent/assignments', permission: 'parent_intelligence.view' },
        { name: 'Tests', path: '/parent/tests', permission: 'parent_intelligence.view' },
                { name: 'Fees', path: '/parent/fees', permission: 'edupay.parent_portal' },
        { name: 'Parent AI Assistant', path: '/parent/ai', permission: 'parent_intelligence.view' },
      ],
    },
    {
      key: 'student-portal',
      name: 'Student Portal',
      icon: GraduationCap,
      roles: ['student'],
      children: [{ name: 'Dashboard', path: '/student/dashboard' }],
    },
    {
      key: 'ai-assistants',
      name: 'AI Assistants',
      icon: Sparkles,
      children: [
        ...(isStudentAiUser
          ? [{ name: 'AI Study Assistant', path: '/ai-study-assistant', permission: 'study_planner.view' }]
          : []),
        ...(isTeacherAiUser
          ? [{ name: 'Teacher AI Assistant', path: '/teacher-ai', permission: 'teacher_ai.generate' }]
          : []),
        ...(isSchoolAiUser
          ? [{ name: 'School AI Assistant', path: '/school-ai-assistant', permission: 'ai_agents.view' }]
          : []),
      ],
    },
    {
      key: 'enterprise-bi',
      name: 'Enterprise BI',
      icon: BarChart3,
      children: [{ name: 'BI Dashboard', path: '/bi', permission: 'bi.academic' }],
    },
    {
      key: 'reports',
      name: 'Download Statistics',
      icon: FileBarChart2,
      permission: 'admin_office.reports',
      children: [{ name: 'Reports', path: '/reports', permission: 'admin_office.reports' }],
    },
    {
      key: 'settings',
      name: 'Settings',
      icon: Settings,
      permission: 'settings',
      children: [{ name: 'System Settings', path: '/settings', permission: 'settings' }],
    },
    {
      key: 'security',
      name: 'Role & Security',
      icon: ShieldCheck,
      permission: 'admin_office.access_control',
      children: [
        { name: 'Access Control', path: '/admin/access-control', permission: 'admin_office.access_control' },
        { name: 'Portal Access Manager', path: '/admin/portal-access', permission: 'admin_office.access_control' },
        { name: 'Security & Sessions', path: '/admin/security-sessions', permission: 'admin_office.access_control' },
      ],
    },
  ];

  const sections = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    return rawSections
      .map((section) => {
        if (section.key === 'student-portal' && user?.role !== 'student') return null;
        const isSecurityForPlatform = section.key === 'security' && isPlatformAdmin;
        const children =
          isSecurityForPlatform
            ? section.children || []
            : (section.children || []).filter((child) => canAccess(child.permission, child.roles));

        const sectionVisible = section.path
          ? canAccess(section.permission, section.roles)
          : isSecurityForPlatform
            ? children.length > 0
            : canAccess(section.permission, section.roles) && children.length > 0;

        if (!sectionVisible) return null;

        const matchesQuery =
          !q ||
          section.name.toLowerCase().includes(q) ||
          children.some((child) => child.name.toLowerCase().includes(q));

        if (!matchesQuery) return null;

        return { ...section, children };
      })
      .filter(Boolean) as MenuSection[];
  }, [searchQuery, user, location.pathname, isPlatformAdmin]);

  useEffect(() => {
    setMobileMenuOpen(false);

    const activeSection = sections.find((section) => {
      if (section.path && (section.path === currentRoute || section.path === location.pathname)) return true;
      return (section.children || []).some(
        (child) => child.path === currentRoute || child.path === location.pathname,
      );
    });

    if (currentRoute.startsWith('/platform')) {
      setOpenSections(['__platform']);
      return;
    }

    if (activeSection) {
      setOpenSections([activeSection.key]);
    }
  }, [currentRoute, location.pathname, sections]);

  const handleNavigate = (path: string) => {
    setMobileMenuOpen(false);
    navigate(path);
  };

  const handleLogout = async () => {
    await signOut();
    setMobileMenuOpen(false);
    navigate('/login', { replace: true });
  };

  const toggleSection = (key: string) => {
    setOpenSections((current) =>
      current.includes(key) ? current.filter((k) => k !== key) : [...current, key],
    );
  };

  const isChildActive = (path?: string) =>
    !!path && (currentRoute === path || location.pathname === path);

  const isSectionActive = (section: MenuSection) => {
    if (section.path && isChildActive(section.path)) return true;
    return (section.children || []).some((child) => isChildActive(child.path));
  };

  const searching = searchQuery.trim().length > 0;

  const renderNavItem = (section: MenuSection, compact: boolean) => {
    const Icon = section.icon;
    const color = SECTION_COLOR[section.key] || '#3b82f6';
    const childList = section.children ?? [];
    const isAccordion = childList.length > 1;
    const directPath = isAccordion ? undefined : section.path ?? childList[0]?.path;
    const active = isSectionActive(section);
    const isOpen = searching || openSections.includes(section.key);
    const q = searchQuery.trim().toLowerCase();
    const shownChildren = searching
      ? childList.filter((child) => child.name.toLowerCase().includes(q))
      : childList;

    if (compact) {
      return (
        <div
          key={section.key}
          className="relative"
          onMouseEnter={() => setHoveredCollapsedKey(section.key)}
          onMouseLeave={() => setHoveredCollapsedKey((c) => (c === section.key ? null : c))}
        >
          <button
            onClick={() => {
              if (directPath && !isAccordion) {
                handleNavigate(directPath);
                return;
              }
              toggleSection(section.key);
            }}
            className={`flex w-full items-center justify-center rounded-2xl p-2 transition-all duration-200 ${
              active ? 'bg-white/15 ring-1 ring-white/30' : 'hover:bg-white/10 hover:-translate-y-px hover:shadow-lg'
            }`}
            aria-expanded={isAccordion ? isOpen : undefined}
          >
            <IconChip icon={Icon} color={color} />
          </button>
          {hoveredCollapsedKey === section.key && (
            <div className="absolute left-[calc(100%+10px)] top-0 z-40 w-60 overflow-hidden rounded-2xl border border-white/15 bg-[#1e3a8a]/95 shadow-2xl backdrop-blur-xl">
              <div className="border-b border-white/10 px-3 py-2.5 text-[13px] font-bold text-white">
                {section.name}
              </div>
              <div className="max-h-80 overflow-y-auto py-1.5">
                {shownChildren.length > 0 ? (
                  shownChildren.map((child) => {
                    const cActive = isChildActive(child.path);
                    return (
                      <button
                        key={child.path}
                        onClick={() => handleNavigate(child.path)}
                        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors ${
                          cActive
                            ? 'bg-gradient-to-r from-blue-500 to-blue-600 font-semibold text-white'
                            : 'text-blue-100 hover:bg-white/10 hover:text-white'
                        }`}
                      >
                        {child.name}
                      </button>
                    );
                  })
                ) : (
                  directPath && (
                    <button
                      onClick={() => handleNavigate(directPath)}
                      className="flex w-full items-center px-3 py-2 text-left text-[13px] text-blue-100 hover:bg-white/10 hover:text-white"
                    >
                      {section.name}
                    </button>
                  )
                )}
              </div>
            </div>
          )}
        </div>
      );
    }

    if (isAccordion) {
      return (
        <div key={section.key}>
          <button
            onClick={() => toggleSection(section.key)}
            className={itemBase(active)}
            aria-expanded={isOpen}
          >
            {active && <LeftAccent />}
            <IconChip icon={Icon} color={color} />
            <span className={labelCls(active)}>{section.name}</span>
            {isOpen ? (
              <ChevronDown className={`h-4 w-4 shrink-0 ${active ? 'text-white' : 'text-blue-200'}`} />
            ) : (
              <ChevronRight className={`h-4 w-4 shrink-0 ${active ? 'text-white' : 'text-blue-200'}`} />
            )}
          </button>
          {isOpen && (
            <div
              className="overflow-hidden"
              style={{
                display: 'grid',
                gridTemplateRows: isOpen ? '1fr' : '0fr',
                transition: 'grid-template-rows 220ms ease-out',
              }}
            >
              <div className="min-h-0">
                <div className="ml-5 mt-1 space-y-1 border-l border-white/15 py-1 pl-[18px]">
                  {shownChildren.map((child) => {
                    const cActive = isChildActive(child.path);
                    return (
                      <button
                        key={child.path}
                        onClick={() => handleNavigate(child.path)}
                        className={childBase(cActive)}
                      >
                        {cActive && <LeftAccent />}
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ background: color, opacity: cActive ? 1 : 0.6 }}
                        />
                        <span className="min-w-0 flex-1 truncate">{child.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      );
    }

    return (
      <button
        key={section.key}
        onClick={() => directPath && handleNavigate(directPath)}
        className={itemBase(active)}
      >
        {active && <LeftAccent />}
        <IconChip icon={Icon} color={color} />
        <span className={labelCls(active)}>{section.name}</span>
      </button>
    );
  };

  const renderCollapsedPlatform = () => {
    if (!isPlatformAdmin) return null;
    const q = searchQuery.trim().toLowerCase();
    const items = Object.values(PLATFORM_ITEMS).filter((item) => !q || item.name.toLowerCase().includes(q));
    if (items.length === 0) return null;
    return (
      <div
        className="relative"
        onMouseEnter={() => setHoveredCollapsedKey('__platform')}
        onMouseLeave={() => setHoveredCollapsedKey((c) => (c === '__platform' ? null : c))}
      >
        <button
          className={`flex w-full items-center justify-center rounded-2xl p-2 transition-all duration-200 ${
            searching ? 'bg-white/15 ring-1 ring-white/30' : 'hover:bg-white/10 hover:-translate-y-px hover:shadow-lg'
          }`}
        >
          <IconChip icon={ShieldCheck} color="#3b82f6" />
        </button>
        {hoveredCollapsedKey === '__platform' && (
          <div className="absolute left-[calc(100%+10px)] top-0 z-40 w-64 overflow-hidden rounded-2xl border border-white/15 bg-[#1e3a8a]/95 shadow-2xl backdrop-blur-xl">
            <div className="border-b border-white/10 px-3 py-2.5 text-[13px] font-bold uppercase tracking-wide text-white">
              Platform Management
            </div>
            <div className="max-h-80 overflow-y-auto py-1.5">
              {items.map((item) => {
                const a = isChildActive(item.path);
                return (
                  <button
                    key={item.path}
                    onClick={() => handleNavigate(item.path)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors ${
                      a ? 'bg-gradient-to-r from-blue-500 to-blue-600 font-semibold text-white' : 'text-blue-100 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    {item.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderSchoolCard = (compact: boolean) => {
    // Only platform admins have a workspace-context switcher. School admins,
    // teachers, parents and students always operate in their own school and do
    // not see this control.
    if (!isPlatformAdmin) return null;

    // ── Platform Workspace (default): Managing All Schools ──────────────────
    if (!activeSchoolId) {
      const platformCard = (
        <div className="overflow-hidden rounded-2xl border border-white/15 bg-white/10 shadow-xl ring-1 ring-white/10 backdrop-blur-md">
          <div className="h-1 w-full bg-gradient-to-r from-blue-400 to-blue-600" />
          <div className="p-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-400 to-blue-600 text-white shadow-md ring-1 ring-white/20">
                <Building2 className="h-[18px] w-[18px]" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-[14px] font-bold text-white">Platform Workspace</p>
                <p className="truncate text-[12px] font-medium text-blue-100">Managing All Schools</p>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2">
              <span className="text-[12px] font-medium text-blue-100">Total Schools</span>
              <span className="text-[15px] font-bold text-white">{totalSchools ?? '—'}</span>
            </div>
            <div className="mt-3">
              <button
                type="button"
                onClick={() => handleNavigate('/platform/schools')}
                className="w-full rounded-xl border border-white/20 bg-white/15 px-2 py-1.5 text-[12px] font-semibold text-white transition hover:bg-white/25"
              >
                Open Schools
              </button>
            </div>
          </div>
        </div>
      );

      if (compact) {
        return (
          <div
            className="relative"
            onMouseEnter={() => setHoveredCollapsedKey('__school')}
            onMouseLeave={() => setHoveredCollapsedKey((c) => (c === '__school' ? null : c))}
          >
            <button
              onClick={() => handleNavigate('/platform/schools')}
              className="flex w-full items-center justify-center rounded-2xl p-2 text-blue-100 transition-all duration-200 hover:bg-white/10 hover:-translate-y-px"
            >
              <IconChip icon={Building2} color="#3b82f6" />
            </button>
            {hoveredCollapsedKey === '__school' && (
              <div className="absolute left-[calc(100%+10px)] top-0 z-40 w-60 rounded-2xl border border-white/15 bg-[#1e3a8a]/95 p-2 shadow-2xl backdrop-blur-xl">
                {platformCard}
              </div>
            )}
          </div>
        );
      }

      return <div className="mx-3">{platformCard}</div>;
    }

    // ── School Workspace: an individual school has been explicitly entered ───
    const card = (
      <div className="overflow-hidden rounded-2xl border border-white/15 bg-white/10 shadow-xl ring-1 ring-white/10 backdrop-blur-md">
        <div className="h-1 w-full bg-gradient-to-r from-blue-400 to-blue-600" />
        <div className="p-3">
          <p className="truncate text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-100/80">School Workspace</p>
          <div className="mt-2 flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-400 to-blue-600 text-[14px] font-bold text-white shadow-md ring-1 ring-white/20">
              {(activeSchoolName || 'S').charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="truncate text-[14px] font-bold text-white">{activeSchoolName || activeSchoolId}</p>
              <p className="truncate text-[12px] font-medium text-blue-100">Dr. Girish App Mode · Active</p>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <PlatformAdminSchoolSelector
              returnPath={location.pathname}
              trigger={
                <button
                  type="button"
                  className="flex-1 rounded-xl border border-white/20 bg-white/15 px-2 py-1.5 text-[12px] font-semibold text-white transition hover:bg-white/25"
                >
                  Change School
                </button>
              }
            />
            <button
              type="button"
              onClick={() => clearActiveSchool()}
              className="flex-1 rounded-xl border border-white/15 bg-white/5 px-2 py-1.5 text-[12px] font-semibold text-blue-100 transition hover:bg-white/10 hover:text-white"
            >
              Exit Workspace
            </button>
          </div>
        </div>
      </div>
    );

    if (compact) {
      return (
        <div
          className="relative"
          onMouseEnter={() => setHoveredCollapsedKey('__school')}
          onMouseLeave={() => setHoveredCollapsedKey((c) => (c === '__school' ? null : c))}
        >
          <button className="flex w-full items-center justify-center rounded-2xl p-2 text-blue-100 transition-all duration-200 hover:bg-white/10 hover:-translate-y-px">
            <IconChip icon={Building2} color="#3b82f6" />
          </button>
          {hoveredCollapsedKey === '__school' && (
            <div className="absolute left-[calc(100%+10px)] top-0 z-40 w-60 rounded-2xl border border-white/15 bg-[#1e3a8a]/95 p-2 shadow-2xl backdrop-blur-xl">
              {card}
            </div>
          )}
        </div>
      );
    }

    return <div className="mx-3">{card}</div>;
  };

  const sidebarContent = (mobile = false) => {
    const expanded = sidebarExpanded || mobile;
    const dashboardSection = sections.find((s) => s.key === 'dashboard');

    return (
      <div
        className="flex h-full flex-col text-white"
        style={{ background: SIDEBAR_BG, fontFamily: SIDEBAR_FONT }}
      >
        {/* ── Header ── */}
        <div className="shrink-0 border-b border-white/10 px-4 py-4">
          <div className={`flex items-center ${expanded ? 'justify-between gap-3' : 'justify-center'}`}>
            <div className="flex items-center gap-3 overflow-hidden">
              <div className="flex h-11 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/95 px-1 shadow-lg ring-1 ring-white/30">
                <img src={schoolBranding?.logo_url || bhavyaAxisLogo} alt="" className="h-8 w-auto object-contain" />
              </div>
              {expanded && (
                <div className="min-w-0">
                  <p className="truncate text-[22px] font-bold leading-tight text-white">{activeSchoolName || schoolBranding?.portal_name || 'Dr. Girish App'}</p>
                  <p className="truncate text-[13px] font-medium uppercase tracking-[0.16em] text-blue-100/80">
                    {isPlatformAdmin
                      ? activeSchoolId
                        ? 'School Workspace'
                        : 'Platform Workspace'
                      : 'School Workspace'}
                  </p>
                </div>
              )}
            </div>
            {expanded && mobile && (
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="rounded-xl p-2 text-white transition hover:bg-white/10"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </button>
            )}
          </div>
        </div>

        {/* ── Search ── */}
        <div className="shrink-0 px-3 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/70" />
            {expanded ? (
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search modules..."
                className="h-12 w-full rounded-2xl border border-white/15 bg-white/10 pl-11 pr-3 text-[14px] text-white outline-none shadow-inner backdrop-blur placeholder:text-white/55 transition focus:border-white/35 focus:bg-white/15"
              />
            ) : (
              <button
                onClick={() => setSidebarExpanded(true)}
                className="flex h-12 w-full items-center justify-center rounded-2xl border border-white/15 bg-white/10 text-white/70 shadow-inner backdrop-blur transition hover:bg-white/15"
                aria-label="Search"
              >
                <Search className="h-5 w-5" />
              </button>
            )}
          </div>
        </div>

        {/* ── Navigation ── */}
        <nav className="flex-1 space-y-1.5 overflow-y-auto px-3 py-2 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/25 [&::-webkit-scrollbar-track]:bg-transparent">
          {!expanded ? (
            <div className="space-y-1.5">
              {dashboardSection && renderNavItem(dashboardSection, true)}
              {renderCollapsedPlatform()}
              {sections
                .filter((s) => s.key !== 'dashboard')
                .map((s) => renderNavItem(s, true))}
            </div>
          ) : (
            <>
              {dashboardSection && renderNavItem(dashboardSection, false)}

              {/* ── Platform Management (collapsible, platform admins only) ── */}
              {isPlatformAdmin &&
                (() => {
                  const q = searchQuery.trim().toLowerCase();
                  const items = Object.values(PLATFORM_ITEMS).filter(
                    (item) => !q || item.name.toLowerCase().includes(q),
                  );
                  if (items.length === 0) return null;
                  const open = searching || openSections.includes('__platform');
                  const platformActive = currentRoute.startsWith('/platform');
                  return (
                    <div className="mt-2 rounded-2xl border border-white/15 bg-white/10 p-1.5 shadow-lg backdrop-blur-md">
                      <button
                        onClick={() => toggleSection('__platform')}
                        className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all duration-200 ${
                          platformActive
                            ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-md shadow-blue-500/30'
                            : 'text-blue-100 hover:bg-white/10 hover:text-white'
                        }`}
                      >
                        <IconChip icon={ShieldCheck} color="#3b82f6" />
                        <span className="flex-1 text-[13px] font-bold uppercase tracking-[0.1em] text-white/90">
                          Platform Management
                        </span>
                        <ChevronRight
                          className={`h-4 w-4 text-blue-200 transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
                        />
                      </button>
                      {open && (
                        <div className="mt-1 space-y-1 border-l border-white/15 py-1 pl-[14px] ml-3">
                          {items.map((item) => {
                            const a = isChildActive(item.path);
                            return (
                              <button
                                key={item.path}
                                onClick={() => handleNavigate(item.path)}
                                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[13px] transition-all duration-200 ${
                                  a
                                    ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-md shadow-blue-500/30 font-semibold'
                                    : 'text-blue-100 hover:bg-white/10 hover:text-white'
                                }`}
                              >
                                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-white/40" />
                                <span className="min-w-0 flex-1 truncate">{item.name}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })()}

              {/* ── Current School (compact premium glass card) ── */}

              {/* ── Dr. Girish App divider (platform admins only) ── */}
              {isPlatformAdmin && (
                <div className="mx-1 mt-4 flex items-center gap-2 border-t border-white/10 pt-3">
                  <span className="h-1.5 w-1.5 rounded-full bg-white/50" />
                  <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/50">
                    Dr. Girish App
                  </span>
                </div>
              )}

              {/* ── All sections (flat, no categories) ── */}
              {sections
                .filter((s) => s.key !== 'dashboard')
                .map((s) => (
                  <div key={s.key} className="mt-0.5">
                    {renderNavItem(s, false)}
                  </div>
                ))}
            </>
          )}
        </nav>

        {/* ── Logout ── */}
        <div className="shrink-0 border-t border-white/10 px-3 py-3">
          <button
            onClick={handleLogout}
            className={`flex w-full items-center gap-3 rounded-2xl border border-white/15 bg-white/5 px-3 py-3 text-left text-white shadow-lg transition-all duration-200 hover:bg-white/10 hover:-translate-y-px hover:shadow-xl ${
              expanded ? '' : 'justify-center px-2'
            }`}
          >
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white shadow-md"
              style={{
                background: 'linear-gradient(180deg, #fca5a5 0%, #ef4444 100%)',
                border: '1px solid rgba(255,255,255,0.28)',
              }}
            >
              <LogOut className="h-5 w-5" />
            </div>
            {expanded && (
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-bold">Logout</p>
              </div>
            )}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-[#eef3fa]">
      <div
        className="pointer-events-none fixed inset-0 -z-10"
        style={{ background: shellBackground }}
      />
      <div className="relative hidden h-[100dvh] shrink-0 lg:block">
        <div
          className={`h-full transition-all duration-300 ${sidebarExpanded ? 'w-[280px]' : 'w-[76px]'}`}
          style={{ background: SIDEBAR_BG }}
        >
          {sidebarContent(false)}
        </div>
        <button
          onClick={() => {
            setSidebarExpanded((current) => !current);
            setHoveredCollapsedKey(null);
          }}
          className="absolute -right-3 top-4 z-30 flex h-24 w-6 items-center justify-center rounded-r-xl border border-white/20 bg-white/10 text-[10px] font-bold uppercase tracking-[0.16em] text-white/80 shadow-lg backdrop-blur transition hover:bg-white/20 [writing-mode:vertical-rl]"
        >
          {sidebarExpanded ? 'Collapse' : 'Expand'}
        </button>
      </div>

      {mobileMenuOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            className="absolute inset-0 bg-slate-950/55"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Close menu overlay"
          />
          <div
            className="relative h-full w-[88vw] max-w-[320px] shadow-2xl"
            style={{ background: SIDEBAR_BG }}
          >
            {sidebarContent(true)}
          </div>
        </div>
      ) : null}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur lg:hidden">
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="rounded-lg p-2 text-slate-700 hover:bg-slate-100"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <p className="truncate text-sm font-semibold text-slate-900">{activeSchoolName || schoolBranding?.portal_name || user?.full_name || 'Dr. Girish App'}</p>
          <button
            onClick={handleLogout}
            className="inline-flex items-center gap-1 rounded-lg bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700"
          >
            <LogOut className="h-3.5 w-3.5" />
            Logout
          </button>
        </div>

        <PlatformAdminSchoolScopeBanner />
        <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
