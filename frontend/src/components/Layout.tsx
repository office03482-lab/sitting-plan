import { useNavigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import {
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
  Users,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { apiService } from '@services/api';
import { useAuthStore } from '@store/auth';
import bhavyaAxisLogo from '@/assets/bhavya-axis-logo.png';

interface LayoutProps {
  children: ReactNode;
}

type MenuChild = {
  name: string;
  path: string;
  permission?: string;
};

type MenuSection = {
  key: string;
  name: string;
  icon: typeof LayoutDashboard;
  iconBackground: string;
  permission?: string;
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
  const user = useAuthStore((state) => state.user);
  const hasPermission = useAuthStore((state) => state.hasPermission);
  const isAdmin = user?.role === 'admin';
  const currentRoute = `${location.pathname}${location.hash || ''}`;

  const canAccess = (permission?: string) => !permission || isAdmin || hasPermission(permission);

  const rawSections: MenuSection[] = [
    {
      key: 'dashboard',
      name: 'Overview',
      icon: LayoutDashboard,
      iconBackground: 'linear-gradient(180deg, #93c5fd 0%, #60a5fa 100%)',
      path: '/',
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
      ],
    },
  ];

  const sections = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    return rawSections
      .map((section) => {
        const filteredChildren = (section.children || []).filter((child) => canAccess(child.permission));
        const sectionVisible =
          section.path ? canAccess(section.permission) : canAccess(section.permission) && filteredChildren.length > 0;

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
    await apiService.logout();
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
        background:
          'linear-gradient(180deg, rgba(30,58,138,0.92) 0%, rgba(37,99,235,0.84) 38%, rgba(59,130,246,0.8) 68%, rgba(34,211,238,0.56) 100%)',
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
              <img src={bhavyaAxisLogo} alt="Dr. Girish App logo" className="h-8 w-auto object-contain" />
            </div>
            {sidebarExpanded || mobile ? (
              <div className="min-w-0">
                <p className="truncate text-lg font-semibold text-white">Dr. Girish App</p>
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
      <div className="relative hidden h-[100dvh] shrink-0 lg:block">
        <div
          className={`h-full transition-all duration-300 ${sidebarExpanded ? 'w-[320px]' : 'w-[94px]'}`}
          style={{
            background:
              'linear-gradient(180deg, rgba(30,58,138,0.92) 0%, rgba(37,99,235,0.84) 38%, rgba(59,130,246,0.8) 68%, rgba(34,211,238,0.56) 100%)',
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
              background:
                'linear-gradient(180deg, rgba(30,58,138,0.92) 0%, rgba(37,99,235,0.84) 38%, rgba(59,130,246,0.8) 68%, rgba(34,211,238,0.56) 100%)',
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
          <p className="truncate text-sm font-semibold text-slate-900">{user?.full_name || 'Dr. Girish App'}</p>
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
