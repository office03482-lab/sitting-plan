import { useNavigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import {
  Activity,
  BookOpen,
  Building,
  Bus,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  FileBarChart2,
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
  Sparkles,
  Users,
  Video,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useAuthStore } from '@store/auth';
import { useAuth } from '@/contexts/AuthProvider';
import { apiService } from '@services/api';
import type { UserRole } from '@types';
import bhavyaAxisLogo from '@/assets/bhavya-axis-logo.png';

interface LayoutProps {
  children: ReactNode;
}

type MenuChild = {
  name: string;
  path: string;
  permission?: string;
  roles?: UserRole[];
};

type MenuSection = {
  key: string;
  name: string;
  icon: typeof LayoutDashboard;
  iconBackground: string;
  permission?: string;
  roles?: UserRole[];
  path?: string;
  children?: MenuChild[];
};

export default function Layout({ children }: LayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [openSections, setOpenSections] = useState<string[]>(['dashboard']);
  const [hoveredCollapsedKey, setHoveredCollapsedKey] = useState<string | null>(null);
  const [schoolBranding, setSchoolBranding] = useState<{
    logo_url?: string | null;
    favicon_url?: string | null;
    portal_name?: string;
    primary_color?: string;
    secondary_color?: string;
    accent_color?: string;
  } | null>(null);
  const user = useAuthStore((state) => state.user);
  const hasPermission = useAuthStore((state) => state.hasPermission);
  const { signOut } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isPlatformAdmin = user?.role_key === 'platform_admin';
  const roleKey = String(user?.role_key || '').toLowerCase();
  const isStudentAiUser = roleKey === 'student' || user?.role === 'student';
  const isTeacherAiUser = roleKey === 'teacher' || user?.role === 'teacher';
  const isSchoolAiUser = isAdmin || roleKey === 'school_admin' || roleKey === 'platform_admin';
  const currentRoute = `${location.pathname}${location.hash || ''}`;
  const brandPrimary = schoolBranding?.primary_color || '#1e3a8a';
  const brandSecondary = schoolBranding?.secondary_color || '#2563eb';
  const brandAccent = schoolBranding?.accent_color || '#22d3ee';
  const sidebarGradient = `linear-gradient(180deg, ${brandPrimary} 0%, ${brandSecondary} 48%, ${brandAccent} 100%)`;
  const shellBackground = `linear-gradient(180deg, color-mix(in srgb, ${brandAccent} 12%, white) 0%, #eef3fa 40%, white 100%)`;

  useEffect(() => {
    if (!user?.school_id || isPlatformAdmin) {
      setSchoolBranding(null);
      return;
    }
    let active = true;
    (async () => {
      try {
        const response = await apiService.getPublicSchoolBranding({ school: user.school_id });
        if (active) {
          setSchoolBranding(response.data);
        }
      } catch {
        if (active) {
          setSchoolBranding(null);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [user?.school_id, isPlatformAdmin]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.title = schoolBranding?.portal_name || 'Dr. Girish App';
    const faviconHref = schoolBranding?.logo_url || bhavyaAxisLogo;
    let favicon = document.querySelector("link[rel='icon']") as HTMLLinkElement | null;
    if (!favicon) {
      favicon = document.createElement('link');
      favicon.rel = 'icon';
      document.head.appendChild(favicon);
    }
    favicon.href = schoolBranding?.logo_url || schoolBranding?.favicon_url || faviconHref;
  }, [schoolBranding]);

  const canAccess = (permission?: string, roles?: UserRole[]) => {
    const roleAllowed = !roles?.length || Boolean(user?.role && roles.includes(user.role));
    const permissionAllowed = !permission || isAdmin || hasPermission(permission);
    return roleAllowed && permissionAllowed;
  };

  const rawSections: MenuSection[] = [
    {
      key: 'dashboard',
      name: 'Overview',
      icon: LayoutDashboard,
      iconBackground: 'linear-gradient(180deg, #93c5fd 0%, #60a5fa 100%)',
      path: '/',
    },
    {
      key: 'parent-portal',
      name: 'Parent Portal',
      icon: LayoutDashboard,
      iconBackground: 'linear-gradient(180deg, #e0e7ff 0%, #6366f1 100%)',
      permission: 'edupay.parent_portal',
      roles: ['parent', 'admin'],
      children: [
        { name: 'Dashboard', path: '/parent/dashboard', permission: 'parent_intelligence.view' },
        { name: 'Attendance', path: '/parent/attendance', permission: 'parent_intelligence.view' },
        { name: 'Progress', path: '/parent/progress', permission: 'parent_intelligence.view' },
        { name: 'Assignments', path: '/parent/assignments', permission: 'parent_intelligence.view' },
        { name: 'Tests', path: '/parent/tests', permission: 'parent_intelligence.view' },
        { name: 'Fees', path: '/edupay', permission: 'edupay.parent_portal' },
        { name: 'Parent AI Assistant', path: '/parent/ai', permission: 'parent_intelligence.view' },
      ],
    },
    {
      key: 'platform-admin',
      name: 'Platform Administration',
      icon: ShieldCheck,
      iconBackground: 'linear-gradient(180deg, #bae6fd 0%, #0f766e 100%)',
      children: [
        { name: 'Platform Dashboard', path: '/platform/dashboard' },
        { name: 'Schools', path: '/platform/schools' },
        { name: 'Subscriptions', path: '/platform/subscriptions' },
        { name: 'Usage', path: '/platform/usage' },
        { name: 'Health', path: '/platform/health' },
        { name: 'Global Search', path: '/platform/search' },
        { name: 'Analytics', path: '/platform/analytics' },
        { name: 'Support Center', path: '/platform/support' },
        { name: 'Notifications', path: '/platform/notifications' },
        { name: 'Onboarding Wizard', path: '/platform/onboarding' },
        { name: 'Workflow Queue', path: '/platform/workflow' },
        { name: 'Audit Logs', path: '/platform/audit-logs' },
        { name: 'Access Control', path: '/admin/access-control', permission: 'admin_office.access_control' },
      ],
    },
    {
      key: 'enterprise-bi',
      name: 'Enterprise BI',
      icon: Activity,
      iconBackground: 'linear-gradient(180deg, #bfdbfe 0%, #0f766e 100%)',
      children: [
        { name: 'BI Dashboard', path: '/bi', permission: 'bi.academic' },
      ],
    },
    {
      key: 'admin-office',
      name: 'Exam Planner',
      icon: Building,
      iconBackground: 'linear-gradient(180deg, #bfdbfe 0%, #3b82f6 100%)',
      permission: 'admin_office',
      children: [
        { name: 'Admin Office Dashboard', path: '/admin-office', permission: 'admin_office' },
        { name: 'Room Configuration', path: '/rooms', permission: 'admin_office.rooms' },
        { name: 'Seating Generation', path: '/seating/generate', permission: 'admin_office.seating_generation' },
        { name: 'Seating Plans', path: '/seating/plans', permission: 'admin_office.seating_plans' },
        { name: 'Staff Assignment', path: '/invigilators', permission: 'admin_office.invigilators' },
      ],
    },
    {
      key: 'attendance',
      name: 'Attendance',
      icon: ClipboardCheck,
      iconBackground: 'linear-gradient(180deg, #a5f3fc 0%, #06b6d4 100%)',
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
      key: 'staff',
      name: 'Staff Management',
      icon: Users,
      iconBackground: 'linear-gradient(180deg, #c4b5fd 0%, #6366f1 100%)',
      permission: 'admin_office',
      children: [
        { name: 'Add Staff', path: '/staff/add', permission: 'admin_office' },
        { name: 'Staff Directory', path: '/staff/directory', permission: 'admin_office' },
        { name: 'Bulk Upload', path: '/staff/bulk-upload', permission: 'admin_office' },
      ],
    },
    {
      key: 'academic',
      name: 'Student Management',
      icon: BookOpen,
      iconBackground: 'linear-gradient(180deg, #7dd3fc 0%, #0ea5e9 100%)',
      permission: 'admin_office.students',
      children: [
        { name: 'Add Student', path: '/students#add', permission: 'admin_office.students' },
        { name: 'Student Directory', path: '/students/directory', permission: 'admin_office.students' },
        { name: 'Bulk Upload', path: '/students#bulk-upload', permission: 'admin_office.students' },
        { name: 'Batch Management', path: '/batches', permission: 'admin_office.batches' },
      ],
    },
    {
      key: 'hostels',
      name: 'Hostel Management',
      icon: Home,
      iconBackground: 'linear-gradient(180deg, #fde68a 0%, #f59e0b 100%)',
      permission: 'admin_office.hostels',
      children: [
        { name: 'Hostel Dashboard', path: '/hostels', permission: 'admin_office.hostels' },
      ],
    },
    {
      key: 'timetable',
      name: 'Time Table',
      icon: CalendarDays,
      iconBackground: 'linear-gradient(180deg, #93c5fd 0%, #2563eb 100%)',
      permission: 'timetable',
      children: [
        { name: 'Timetable Management', path: '/timetable', permission: 'timetable' },
      ],
    },
    {
      key: 'lms',
      name: 'Learning Hub',
      icon: GraduationCap,
      iconBackground: 'linear-gradient(180deg, #bfdbfe 0%, #0f172a 100%)',
      roles: ['admin', 'teacher', 'student', 'viewer'],
      children: [
        { name: 'Courses', path: '/courses', permission: 'lms.view' },
        { name: 'My Learning', path: '/my-learning' },
        { name: 'Assignments', path: '/assignments', permission: 'lms.assignments' },
      ],
    },
    {
      key: 'online-tests',
      name: 'Online Tests',
      icon: ClipboardCheck,
      iconBackground: 'linear-gradient(180deg, #bfdbfe 0%, #1d4ed8 100%)',
      roles: ['admin', 'teacher', 'student'],
      children: [
        { name: 'Overview', path: '/online-tests', roles: ['admin', 'teacher', 'student'] },
        { name: 'Create Test', path: '/online-tests/create', roles: ['admin', 'teacher'] },
      ],
    },
    {
      key: 'ai-assistants',
      name: 'AI Assistants',
      icon: Sparkles,
      iconBackground: 'linear-gradient(180deg, #e0f2fe 0%, #0284c7 100%)',
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
      key: 'live-classes',
      name: 'Live Classes',
      icon: Video,
      iconBackground: 'linear-gradient(180deg, #bfdbfe 0%, #2563eb 100%)',
      children: [
        { name: 'Session Hub', path: '/live-classes', permission: 'live_classes.view' },
      ],
    },
    {
      key: 'inventory',
      name: 'Inventory Control',
      icon: Package,
      iconBackground: 'linear-gradient(180deg, #67e8f9 0%, #0284c7 100%)',
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
      key: 'fees',
      name: 'Fee Management',
      icon: Landmark,
      iconBackground: 'linear-gradient(180deg, #818cf8 0%, #4f46e5 100%)',
      permission: 'edupay',
      children: [
        { name: 'BRAIN OF HIMACHAL Dashboard', path: '/edupay', permission: 'edupay' },
        { name: 'Revenue & Commerce', path: '/commerce', permission: 'edupay.revenue' },
      ],
    },
    {
      key: 'reports',
      name: 'Download Statistics',
      icon: FileBarChart2,
      iconBackground: 'linear-gradient(180deg, #dbeafe 0%, #38bdf8 100%)',
      permission: 'admin_office.reports',
      children: [
        { name: 'Reports & Export', path: '/reports', permission: 'admin_office.reports' },
      ],
    },
    {
      key: 'transport',
      name: 'Transport Management',
      icon: Bus,
      iconBackground: 'linear-gradient(180deg, #bae6fd 0%, #0284c7 100%)',
      children: [],
    },
    {
      key: 'digital-diary',
      name: 'Digital Diary',
      icon: GraduationCap,
      iconBackground: 'linear-gradient(180deg, #a5b4fc 0%, #3b82f6 100%)',
      children: [],
    },
    {
      key: 'school-self-service',
      name: 'School Self-Service',
      icon: Settings,
      iconBackground: 'linear-gradient(180deg, #86efac 0%, #0f766e 100%)',
      permission: 'settings',
      roles: ['admin', 'school_admin'],
      children: [
        { name: 'School Branding', path: '/school-self-service/branding', permission: 'settings', roles: ['admin', 'school_admin'] },
        { name: 'School Preferences', path: '/school-self-service/preferences', permission: 'settings', roles: ['admin', 'school_admin'] },
        { name: 'Portal Settings', path: '/school-self-service/portal-settings', permission: 'settings', roles: ['admin', 'school_admin'] },
        { name: 'Email Templates', path: '/school-self-service/email-templates', permission: 'settings', roles: ['admin', 'school_admin'] },
        { name: 'SMS / WhatsApp', path: '/school-self-service/messaging-templates', permission: 'settings', roles: ['admin', 'school_admin'] },
        { name: 'Storage Center', path: '/school-self-service/storage', permission: 'settings', roles: ['admin', 'school_admin'] },
        { name: 'Backup Center', path: '/school-self-service/backups', permission: 'settings', roles: ['admin', 'school_admin'] },
      ],
    },
    {
      key: 'settings',
      name: 'Settings',
      icon: Settings,
      iconBackground: 'linear-gradient(180deg, #e0f2fe 0%, #0ea5e9 100%)',
      permission: 'settings',
      children: [
        { name: 'System Settings', path: '/settings', permission: 'settings' },
      ],
    },
    {
      key: 'security',
      name: 'Role & Security',
      icon: ShieldCheck,
      iconBackground: 'linear-gradient(180deg, #bfdbfe 0%, #2563eb 100%)',
      permission: 'admin_office.access_control',
      children: [
        { name: 'Access Control', path: '/admin/access-control', permission: 'admin_office.access_control' },
        { name: 'Portal Access Manager', path: '/admin/portal-access', permission: 'admin_office.access_control' },
        { name: 'Security & Sessions', path: '/admin/security-sessions', permission: 'admin_office.access_control' },
      ],
    },
  ];

  const sections = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    return rawSections
      .map((section) => {
        if (section.key === 'platform-admin' && !isPlatformAdmin) return null;
        if (section.key === 'school-self-service' && isPlatformAdmin) return null;
        const filteredChildren = (section.children || []).filter((child) => canAccess(child.permission, child.roles));
        const sectionVisible =
          section.path
            ? canAccess(section.permission, section.roles)
            : canAccess(section.permission, section.roles) && filteredChildren.length > 0;

        if (!sectionVisible) return null;

        const matchesQuery =
          !normalizedQuery ||
          section.name.toLowerCase().includes(normalizedQuery) ||
          filteredChildren.some((child) => child.name.toLowerCase().includes(normalizedQuery));

        if (!matchesQuery) return null;

        return {
          ...section,
          children: !normalizedQuery
            ? filteredChildren
            : filteredChildren.filter(
                (child) =>
                  child.name.toLowerCase().includes(normalizedQuery) ||
                  section.name.toLowerCase().includes(normalizedQuery),
              ),
        };
      })
      .filter(Boolean) as MenuSection[];
  }, [searchQuery, user, location.pathname]);

  useEffect(() => {
    setMobileMenuOpen(false);

    const activeSection = sections.find((section) => {
      if (section.path && (section.path === currentRoute || section.path === location.pathname)) return true;
      return (section.children || []).some(
        (child) => child.path === currentRoute || child.path === location.pathname,
      );
    });

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
    setOpenSections((current) => (current.includes(key) ? [] : [key]));
  };

  const isSectionActive = (section: MenuSection) => {
    if (section.path) return currentRoute === section.path || location.pathname === section.path;
    return (section.children || []).some((child) => child.path === currentRoute || child.path === location.pathname);
  };

  const renderSectionButton = (section: MenuSection, compact = false) => {
    const Icon = section.icon;
    const active = isSectionActive(section);
    const isOpen = openSections.includes(section.key);
    const hasChildren = !!section.children?.length;

    return (
      <div
        key={section.key}
        className="relative"
        onMouseEnter={() => {
          if (!sidebarExpanded && hasChildren) setHoveredCollapsedKey(section.key);
        }}
        onMouseLeave={() => {
          if (!sidebarExpanded) setHoveredCollapsedKey((current) => (current === section.key ? null : current));
        }}
      >
        <button
          onClick={() => {
            if (section.path && !hasChildren) {
              handleNavigate(section.path);
              return;
            }
            if (section.path && hasChildren && section.key === 'dashboard') {
              handleNavigate(section.path);
              return;
            }
            toggleSection(section.key);
          }}
          className={`group flex w-full items-center gap-3 rounded-[1rem] px-3 py-3 text-left transition-all ${
            active
              ? 'text-white shadow-[inset_3px_0_0_0_#dbeafe]'
              : 'text-white'
          } ${compact ? 'justify-center px-2' : ''}`}
          style={{
            background: active
              ? 'linear-gradient(180deg, rgba(255,255,255,0.34) 0%, rgba(96,165,250,0.3) 45%, rgba(99,102,241,0.28) 100%)'
              : 'linear-gradient(180deg, rgba(255,255,255,0.18) 0%, rgba(147,197,253,0.13) 50%, rgba(56,189,248,0.14) 100%)',
            color: '#ffffff',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            border: active ? '1px solid rgba(219,234,254,0.55)' : '1px solid rgba(191,219,254,0.28)',
            boxShadow: active
              ? 'inset 0 1px 0 rgba(255,255,255,0.22), 0 12px 24px rgba(15,23,42,0.18)'
              : 'inset 0 1px 0 rgba(255,255,255,0.18), 0 10px 18px rgba(15,23,42,0.12)',
          }}
          aria-expanded={hasChildren ? isOpen : undefined}
        >
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white shadow-md shadow-blue-950/20"
            style={{
              background: section.iconBackground,
              border: '1px solid rgba(255,255,255,0.28)',
            }}
          >
            <Icon className="h-5 w-5" />
          </div>

          {!compact ? (
            <>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-bold tracking-[0.01em]">{section.name}</p>
              </div>
              {hasChildren ? (
                isOpen ? <ChevronDown className="h-4 w-4 text-white/60" /> : <ChevronRight className="h-4 w-4 text-white/60" />
              ) : null}
            </>
          ) : null}
        </button>

        {!compact && hasChildren && isOpen ? (
          <div
            className="mt-2 overflow-hidden rounded-[1rem] shadow-lg shadow-slate-950/20"
            style={{
              background: 'linear-gradient(180deg, rgba(30,58,138,0.58) 0%, rgba(59,130,246,0.3) 52%, rgba(34,211,238,0.22) 100%)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              border: '1px solid rgba(219,234,254,0.2)',
            }}
          >
            <div className="py-2">
              {section.children?.map((child) => {
                const childActive = currentRoute === child.path || location.pathname === child.path;
                return (
                  <button
                    key={child.path}
                    onClick={() => handleNavigate(child.path)}
                    className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm transition ${
                      childActive ? 'bg-white/10 text-white' : 'text-white/90 hover:bg-white/7'
                    }`}
                  >
                    <span>{child.name}</span>
                    <ArrowHint />
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {compact && hasChildren && hoveredCollapsedKey === section.key ? (
          <div
            className="absolute left-[calc(100%+12px)] top-0 z-40 w-72 overflow-hidden rounded-[1rem] border shadow-2xl shadow-slate-950/30"
            style={{
              background: 'linear-gradient(180deg, rgba(30,58,138,0.72) 0%, rgba(59,130,246,0.34) 50%, rgba(99,102,241,0.28) 100%)',
              borderColor: 'rgba(191,219,254,0.45)',
              backdropFilter: 'blur(18px)',
              WebkitBackdropFilter: 'blur(18px)',
            }}
          >
            <div className="border-b border-white/10 px-4 py-3 text-sm font-semibold text-white">{section.name}</div>
            <div className="py-2">
              {section.children?.map((child) => (
                <button
                  key={child.path}
                  onClick={() => handleNavigate(child.path)}
                  className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm transition ${
                    currentRoute === child.path || location.pathname === child.path ? 'bg-white/10 text-white' : 'text-white/90 hover:bg-white/7'
                  }`}
                >
                  <span>{child.name}</span>
                  <ArrowHint />
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  const sidebarContent = (mobile = false) => (
    <div
      className="flex h-full flex-col text-white"
      style={{
        background: sidebarGradient,
        color: '#ffffff',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
      }}
    >
      <div
        className="border-b border-white/10 px-3 py-3"
        style={{
          background: 'linear-gradient(180deg, rgba(255,255,255,0.16) 0%, rgba(191,219,254,0.06) 100%)',
        }}
      >
        <div className={`flex items-center ${sidebarExpanded || mobile ? 'justify-between gap-3' : 'justify-center'}`}>
          <div className="flex items-center gap-3 overflow-hidden">
            <div className="flex h-10 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white px-1">
              <img src={schoolBranding?.logo_url || bhavyaAxisLogo} alt="School logo" className="h-8 w-auto object-contain" />
            </div>
            {sidebarExpanded || mobile ? (
              <div className="min-w-0">
                <p className="truncate text-lg font-semibold text-white">{schoolBranding?.portal_name || 'Dr. Girish App'}</p>
                <p className="truncate text-[11px] uppercase tracking-[0.22em] text-white/70">{user?.school_id ? 'School Workspace' : 'Platform Workspace'}</p>
              </div>
            ) : null}
          </div>

          {mobile ? (
            <button
              onClick={() => setMobileMenuOpen(false)}
              className="rounded-lg p-2 text-white hover:bg-white/10"
              aria-label="Close menu"
            >
              <X className="h-5 w-5" />
            </button>
          ) : sidebarExpanded ? (
            <ChevronDown className="h-4 w-4 text-orange-300" />
          ) : null}
        </div>
      </div>

      <div
        className="border-b border-white/10 px-3 py-4"
        style={{
          background: 'linear-gradient(180deg, rgba(255,255,255,0.12) 0%, rgba(147,197,253,0.08) 55%, rgba(34,211,238,0.06) 100%)',
        }}
      >
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/70" />
          {(sidebarExpanded || mobile) ? (
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search menu"
              className="h-12 w-full rounded-[0.95rem] border border-orange-300 bg-transparent pl-11 pr-3 text-sm text-white outline-none placeholder:text-white/55 focus:border-orange-400"
            />
          ) : (
            <button
              onClick={() => setSidebarExpanded(true)}
              className="flex h-12 w-full items-center justify-center rounded-[0.95rem] border border-orange-300 bg-transparent text-white transition hover:bg-white/5"
              aria-label="Expand and search menu"
            >
              <Search className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>

      <nav className="flex-1 space-y-2 overflow-y-auto px-2 py-3" style={{ backgroundColor: 'transparent' }}>
        {sections.map((section) => renderSectionButton(section, !sidebarExpanded && !mobile))}
      </nav>

      <div
        className="border-t border-white/10 px-2 py-3"
        style={{
          background: 'linear-gradient(180deg, rgba(255,255,255,0.08) 0%, rgba(191,219,254,0.04) 100%)',
        }}
      >
        <button
          onClick={handleLogout}
          className={`flex w-full items-center gap-3 rounded-[1rem] px-3 py-3 text-left text-white transition hover:bg-white/10 ${
            sidebarExpanded || mobile ? '' : 'justify-center px-2'
          }`}
          style={{
            border: '1px solid rgba(191,219,254,0.28)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.14), 0 10px 18px rgba(15,23,42,0.12)',
          }}
        >
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white shadow-md shadow-blue-950/20"
            style={{
              background: 'linear-gradient(180deg, #fca5a5 0%, #ef4444 100%)',
              border: '1px solid rgba(255,255,255,0.28)',
            }}
          >
            <LogOut className="h-5 w-5" />
          </div>
          {sidebarExpanded || mobile ? (
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-bold tracking-[0.01em]">Logout</p>
            </div>
          ) : null}
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-[#eef3fa]">
      <div
        className="pointer-events-none fixed inset-0 -z-10"
        style={{ background: shellBackground }}
      />
      <div className="relative hidden h-[100dvh] shrink-0 lg:block">
        <div
          className={`h-full transition-all duration-300 ${sidebarExpanded ? 'w-[320px]' : 'w-[94px]'}`}
          style={{
            background: sidebarGradient,
          }}
        >
          {sidebarContent(false)}
        </div>
        <button
          onClick={() => {
            setSidebarExpanded((current) => !current);
            setHoveredCollapsedKey(null);
          }}
          className="absolute -right-6 top-3 z-30 flex h-[108px] w-8 items-center justify-center rounded-r-xl text-[11px] font-bold uppercase tracking-[0.16em] text-[#153e75] shadow-lg [writing-mode:vertical-rl]"
          style={{
            background: 'linear-gradient(180deg, rgba(255,255,255,0.86) 0%, rgba(147,197,253,0.9) 60%, rgba(125,211,252,0.88) 100%)',
            border: '1px solid rgba(255,255,255,0.5)',
          }}
        >
          {sidebarExpanded ? 'Collapse' : 'Expand'}
        </button>
      </div>

      {mobileMenuOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            className="absolute inset-0 bg-slate-950/45"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Close menu overlay"
          />
          <div
            className="relative h-full w-[88vw] max-w-[340px] shadow-2xl"
            style={{
              background: sidebarGradient,
            }}
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
          <p className="truncate text-sm font-semibold text-slate-900">{schoolBranding?.portal_name || user?.full_name || 'Dr. Girish App'}</p>
          <button
            onClick={handleLogout}
            className="inline-flex items-center gap-1 rounded-lg bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700"
          >
            <LogOut className="h-3.5 w-3.5" />
            Logout
          </button>
        </div>

        <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

function ArrowHint() {
  return (
    <div className="flex h-5 min-w-5 items-center justify-center rounded-full bg-orange-300 px-1.5 text-[10px] font-bold leading-none text-slate-900">
      Go
    </div>
  );
}
