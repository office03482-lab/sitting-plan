import { Component, type ErrorInfo, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  Bell,
  CalendarDays,
  ChevronDown,
  ClipboardCheck,
  UserCheck,
  Users,
} from 'lucide-react';

import { Alert } from '@components/Alert';
import { LoadingSpinner } from '@components/LoadingSpinner';
import { apiService, isRequestCanceled } from '@services/api';
import { useAuthStore } from '@store/auth';
import { useAuth } from '@/contexts/AuthProvider';
import type {
  AttendanceHoliday,
  AttendanceLeave,
  AttendanceLeaveStatus,
  AttendanceLeaveType,
  AttendanceNotification,
  AttendanceOverview,
  AttendanceReportResponse,
  AttendanceStaff,
  StaffAttendanceMarkingResponse,
  StaffAttendanceMarkingRow,
  StaffAttendanceRecord,
  StaffAttendanceStatus,
  StaffDashboard,
} from '@types';

import MarkStudentAttendance from './MarkStudentAttendance';
import StudentRecordsPanel from './StudentRecordsPanel';
import StudentDashboardPanel from './StudentDashboardPanel';
import { useAttendanceStudentResources } from './hooks/useAttendanceStudentResources';

import {
  sectionClass,
  inputClass,
  statusButtonBase,
  deleteButtonClass,
  deleteAllButtonClass,
  staffStatusClass,
  staffCalendarShadeClass,
} from '../modules/attendance/utils/styleUtils';
import {
  formatDate,
  formatCalendarMonthLabel,
  toMonthInputValue,
  shiftMonthValue,
  applyMonthInputValue,
  getMonthRange,
  parseCalendarDate,
  dateToKeyFromDate,
  toDateKey,
} from '../modules/attendance/utils/dateUtils';
import {
  toArray,
  normalizeDepartmentKey,
  parseCommaSeparatedValues,
  getUniqueDepartmentOptions,
  isTeachingStaffMember,
} from '../modules/attendance/utils/commonUtils';
import {
  normalizeOverview,
  normalizeStaffDashboard,
} from '../modules/attendance/utils/overviewUtils';


type TabKey = 'overview' | 'student' | 'staff' | 'leaves' | 'reports';

const tabs: Array<{ key: TabKey; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'student', label: 'Student Attendance' },
  { key: 'staff', label: 'Staff Attendance' },
  { key: 'leaves', label: 'Leave Management' },
  { key: 'reports', label: 'Reports' },
];

const initialHolidayForm = { title: '', holiday_date: '', description: '' };
const initialLeaveForm = {
  staff_member_id: '',
  leave_type: 'casual' as AttendanceLeaveType,
  from_date: '',
  to_date: '',
  reason: '',
};

function AttendanceManagementContent() {
  const location = useLocation();
  const user = useAuthStore((state) => state.user);
  const { authReady, sessionReady, schoolContextReady, initialized: authInitialized, loading: authLoading, session } = useAuth();
  const isTeacherSelfView = user?.role === 'teacher' && user?.user_type === 'teaching';
  const isPlatformSuperAdmin = user?.role_key === 'platform_admin';
  const permissionList = user?.permissions || [];
  const hasExactPermission = (permission: string) => user?.role === 'admin' || permissionList.includes(permission);
  const initialHashTab = location.hash.replace('#', '').trim();
  const [activeTab, setActiveTab] = useState<TabKey>(
    tabs.some((tab) => tab.key === initialHashTab) ? (initialHashTab as TabKey) : 'overview'
  );
  const [loading, setLoading] = useState(true);
  const [tabLoading, setTabLoading] = useState(false);
  const [alert, setAlert] = useState<{ type: 'success' | 'error' | 'warning' | 'info'; message: string } | null>(null);

  const [overview, setOverview] = useState<AttendanceOverview | null>(null);
  const [staffMembers, setStaffMembers] = useState<AttendanceStaff[]>([]);
  const [notifications, setNotifications] = useState<AttendanceNotification[]>([]);
  const [holidays, setHolidays] = useState<AttendanceHoliday[]>([]);
  const [staffMarking, setStaffMarking] = useState<StaffAttendanceMarkingResponse | null>(null);
  const [staffRecords, setStaffRecords] = useState<StaffAttendanceRecord[]>([]);
  const [staffCalendarRecords, setStaffCalendarRecords] = useState<StaffAttendanceRecord[]>([]);
  const [staffApprovedLeaves, setStaffApprovedLeaves] = useState<AttendanceLeave[]>([]);
  const [staffDashboard, setStaffDashboard] = useState<StaffDashboard | null>(null);
  const [leaves, setLeaves] = useState<AttendanceLeave[]>([]);
  const [reportData, setReportData] = useState<AttendanceReportResponse | null>(null);
  const [holidayForm, setHolidayForm] = useState(initialHolidayForm);
  const [leaveForm, setLeaveForm] = useState(initialLeaveForm);

  const [staffFilters, setStaffFilters] = useState({
    date: new Date().toISOString().slice(0, 10),
    staffType: 'all' as 'all' | 'teaching' | 'non_teaching',
    department: '',
    dashboardDepartment: '',
    recordDepartment: '',
    search: '',
    dashboardDate: '',
    recordStaffName: '',
    recordDate: '',
  });

  const [reportFilters, setReportFilters] = useState({
    report_type: 'student_summary' as 'student_summary' | 'staff_summary' | 'leave_summary',
    batch_names: '',
    department: '',
    date_from: '',
    date_to: '',
  });
  const [reportBatchPicker, setReportBatchPicker] = useState('');
  const [studentPanelRefreshToken, setStudentPanelRefreshToken] = useState(0);
  const authIdentityFingerprintRef = useRef('');

  useEffect(() => {
    if (!alert || alert.type !== 'success') return;
    const timer = window.setTimeout(() => setAlert(null), 2800);
    return () => window.clearTimeout(timer);
  }, [alert]);

  const [loadedTabs, setLoadedTabs] = useState<Record<TabKey, boolean>>({
    overview: false,
    student: false,
    staff: false,
    leaves: false,
    reports: false,
  });
  const [tabAutoLoadDone, setTabAutoLoadDone] = useState<Record<TabKey, boolean>>({
    overview: false,
    student: false,
    staff: false,
    leaves: false,
    reports: false,
  });

  const getApiErrorMessage = (error: any, fallback: string) =>
    isRequestCanceled(error) ? '' : error?.response?.data?.detail || error?.message || fallback;

  const hasAttendanceRootAccess = hasExactPermission('attendance');
  const canViewOverviewTab = hasAttendanceRootAccess || hasExactPermission('attendance.overview');
  const canViewStudentTab = hasAttendanceRootAccess || hasExactPermission('attendance.student');
  const canViewStaffTab = hasAttendanceRootAccess || hasExactPermission('attendance.staff');
  const canViewLeavesTab = hasAttendanceRootAccess || hasExactPermission('attendance.leaves');
  const canViewReportsTab = hasAttendanceRootAccess || hasExactPermission('attendance.reports');
  const visibleTabs = useMemo(
    () =>
      tabs.filter((tab) => {
        if (isTeacherSelfView && (tab.key === 'overview' || tab.key === 'reports')) return false;
        if (tab.key === 'overview') return canViewOverviewTab;
        if (tab.key === 'student') return canViewStudentTab;
        if (tab.key === 'staff') return canViewStaffTab;
        if (tab.key === 'leaves') return canViewLeavesTab;
        if (tab.key === 'reports') return canViewReportsTab;
        return true;
      }),
    [canViewLeavesTab, canViewOverviewTab, canViewReportsTab, canViewStaffTab, canViewStudentTab, isTeacherSelfView]
  );

  const lastOverviewRefreshAtRef = useRef(0);
  const overviewRefreshInFlightRef = useRef<Promise<void> | null>(null);
  const staffTabLoadInFlightRef = useRef<Promise<void> | null>(null);
  const overviewPendingRefreshRef = useRef(false);
  const staffRecordsRequestKeyRef = useRef('');

  const isOverviewTabVisible = activeTab === 'overview' && canViewOverviewTab && !isTeacherSelfView;
  const isStudentTabVisible = activeTab === 'student' && loadedTabs.student;
  const isStaffTabVisible = activeTab === 'staff' && loadedTabs.staff;
  const canRunAttendanceRequests = authReady && sessionReady && schoolContextReady && !!session;
  const currentSchoolId = user?.school_id;

  const debugAttendanceLoader = (source: string, details?: Record<string, unknown>) => {
    console.debug('[attendance-loader]', source, {
      activeTab,
      authReady,
      sessionReady,
      schoolContextReady,
      authInitialized,
      authLoading,
      ...details,
    });
  };

  const {
    students,
    managedBatches,
    subjects,
    managedBatchOptions,
    managedClassOptions,
    loadStudentResources,
    refreshManagedBatches,
  } = useAttendanceStudentResources({
    canRunAttendanceRequests,
    currentSchoolId,
    overviewSubjectOptions: toArray(overview?.subject_options),
  });

  useEffect(() => {
    const nextFingerprint = `${user?.id || 'anon'}:${user?.school_id || ''}:${user?.role || ''}:${user?.role_key || ''}`;
    if (authIdentityFingerprintRef.current === nextFingerprint) {
      return;
    }
    authIdentityFingerprintRef.current = nextFingerprint;
    debugAttendanceLoader('auth.identity.changed', {
      userId: user?.id || null,
      schoolId: user?.school_id || null,
      role: user?.role || null,
      roleKey: user?.role_key || null,
      origin: 'auth-store',
    });
  }, [user?.id, user?.school_id, user?.role, user?.role_key]);

  const loadOverviewData = async (options?: { initial?: boolean; force?: boolean }) => {
    const initial = options?.initial === true;
    const force = options?.force === true;
    if (!canRunAttendanceRequests) {
      debugAttendanceLoader('loadOverviewData.skipped.auth_not_ready', { initial, force });
      return;
    }
    if (!initial && !isOverviewTabVisible) {
      debugAttendanceLoader('loadOverviewData.skipped.hidden_tab', { initial, force });
      overviewPendingRefreshRef.current = true;
      return;
    }
    if (overviewRefreshInFlightRef.current) {
      debugAttendanceLoader('loadOverviewData.reused_inflight', { initial, force });
      return overviewRefreshInFlightRef.current;
    }
    const refreshPromise = (async () => {
      const now = Date.now();
      if (!initial && !force && now - lastOverviewRefreshAtRef.current < 60_000) {
        debugAttendanceLoader('loadOverviewData.skipped.cooldown', { initial, force });
        return;
      }
      try {
        debugAttendanceLoader('loadOverviewData.start', { initial, force });
        initial ? setLoading(true) : setTabLoading(true);
        let normalizedOverview: AttendanceOverview | null = null;
        const overviewRes = await apiService.getAttendanceOverview();
        normalizedOverview = normalizeOverview(overviewRes.data);
        setOverview(normalizedOverview);
        if (normalizedOverview) {
          setNotifications(normalizedOverview.notifications);
          setHolidays(normalizedOverview.holidays);
        }
        lastOverviewRefreshAtRef.current = Date.now();
        overviewPendingRefreshRef.current = false;
        setLoadedTabs((current) => ({ ...current, overview: true }));
      } catch (error: any) {
        console.error('Failed to load attendance module', error);
        setAlert({ type: 'error', message: getApiErrorMessage(error, 'Attendance module load nahi ho paaya.') });
      } finally {
        debugAttendanceLoader('loadOverviewData.end', { initial, force });
        initial ? setLoading(false) : setTabLoading(false);
      }
    })().finally(() => {
      overviewRefreshInFlightRef.current = null;
    });
    overviewRefreshInFlightRef.current = refreshPromise;
    return refreshPromise;
  };

  useEffect(() => {
    const hashValue = location.hash.replace('#', '').trim();
    if (!hashValue) return;
    const nextTab = visibleTabs.find((tab) => tab.key === hashValue);
    if (nextTab) {
      setActiveTab(nextTab.key);
    }
  }, [location.hash, visibleTabs]);

  useEffect(() => {
    if (visibleTabs.some((tab) => tab.key === activeTab)) return;
    if (visibleTabs[0]?.key) {
      setActiveTab(visibleTabs[0].key);
    }
  }, [activeTab, visibleTabs]);

  useEffect(() => {
    if (!isTeacherSelfView || leaveForm.staff_member_id || !staffMembers.length) return;
    setLeaveForm((current) => ({ ...current, staff_member_id: String(staffMembers[0].id) }));
  }, [isTeacherSelfView, leaveForm.staff_member_id, staffMembers]);

  const loadStudentTab = async () => {
    if (!canRunAttendanceRequests) {
      debugAttendanceLoader('loadStudentTab.skipped.auth_not_ready');
      return;
    }
    try {
      debugAttendanceLoader('loadStudentTab.start');
      setTabLoading(true);
      await loadStudentResources();
      setLoadedTabs((current) => ({ ...current, student: true }));
    } catch (error: any) {
      if (isRequestCanceled(error)) {
        debugAttendanceLoader('loadStudentTab.canceled');
        return;
      }
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'Student attendance load nahi hua.') });
    } finally {
      debugAttendanceLoader('loadStudentTab.end');
      setLoading(false);
      setTabLoading(false);
    }
  };

  const loadStaffTab = async () => {
    if (!canRunAttendanceRequests) {
      debugAttendanceLoader('loadStaffTab.skipped.auth_not_ready');
      return;
    }
    if (staffTabLoadInFlightRef.current) {
      debugAttendanceLoader('loadStaffTab.reused_inflight');
      return staffTabLoadInFlightRef.current;
    }
    const loadPromise = (async () => {
      try {
        debugAttendanceLoader('loadStaffTab.start');
        setTabLoading(true);
        const [staffRes, approvedLeavesRes] = await Promise.all([
          apiService.listAttendanceStaff({ school_id: currentSchoolId, limit: 200 }),
          apiService.listAttendanceLeaves({ school_id: currentSchoolId, status: 'approved' }).catch(() => ({ data: [] })),
        ]);
        setStaffMembers(toArray<AttendanceStaff>(staffRes.data));
        setStaffApprovedLeaves(toArray<AttendanceLeave>(approvedLeavesRes.data));
        if (staffFilters.department) {
          void loadStaffMarking();
        }
        setLoadedTabs((current) => ({ ...current, staff: true }));
      } catch (error: any) {
        if (isRequestCanceled(error)) {
          debugAttendanceLoader('loadStaffTab.canceled');
          return;
        }
        setAlert({ type: 'error', message: getApiErrorMessage(error, 'Staff attendance load nahi hua.') });
      } finally {
        debugAttendanceLoader('loadStaffTab.end');
        setLoading(false);
        setTabLoading(false);
      }
    })().finally(() => {
      staffTabLoadInFlightRef.current = null;
    });
    staffTabLoadInFlightRef.current = loadPromise;
    return loadPromise;
  };

  const refreshApprovedStaffLeaves = async () => {
    if (!canRunAttendanceRequests) {
      debugAttendanceLoader('refreshApprovedStaffLeaves.skipped.auth_not_ready');
      return;
    }
    try {
      const response = await apiService.listAttendanceLeaves({ school_id: currentSchoolId, status: 'approved' });
      setStaffApprovedLeaves(toArray<AttendanceLeave>(response.data));
    } catch {
      // Keep existing approved leave data if refresh fails.
    }
  };

  const refreshStaffLeaveViews = async () => {
    await refreshApprovedStaffLeaves();

    if (isStaffTabVisible) {
      await loadStaffCalendarRecords();
      if (staffFilters.department) {
        await loadStaffMarking();
      }
    }
  };

  const loadLeavesTab = async () => {
    if (!canRunAttendanceRequests) {
      debugAttendanceLoader('loadLeavesTab.skipped.auth_not_ready');
      return;
    }
    try {
      debugAttendanceLoader('loadLeavesTab.start');
      setTabLoading(true);
      const [leavesRes, staffRes] = await Promise.all([
        apiService.listAttendanceLeaves({ school_id: currentSchoolId }),
        staffMembers.length ? Promise.resolve({ data: staffMembers }) : apiService.listAttendanceStaff({ school_id: currentSchoolId, limit: 200 }),
      ]);
      setLeaves(toArray<AttendanceLeave>(leavesRes.data));
      setStaffMembers(toArray<AttendanceStaff>(staffRes.data));
      setLoadedTabs((current) => ({ ...current, leaves: true }));
    } catch (error: any) {
      if (isRequestCanceled(error)) {
        debugAttendanceLoader('loadLeavesTab.canceled');
        return;
      }
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'Leave module load nahi hua.') });
    } finally {
      debugAttendanceLoader('loadLeavesTab.end');
      setLoading(false);
      setTabLoading(false);
    }
  };

  useEffect(() => {
    if (!canRunAttendanceRequests) return;
    if (tabLoading || loadedTabs[activeTab] || tabAutoLoadDone[activeTab]) return;
    setTabAutoLoadDone((current) => ({ ...current, [activeTab]: true }));
    if (activeTab === 'overview') {
      debugAttendanceLoader('effect.autoload.overview');
      void loadOverviewData({ initial: true, force: true });
      return;
    }
    if (activeTab === 'student') {
      debugAttendanceLoader('effect.autoload.student');
      void loadStudentTab();
      return;
    }
    if (activeTab === 'staff') {
      debugAttendanceLoader('effect.autoload.staff');
      void loadStaffTab();
      return;
    }
    if (activeTab === 'leaves') {
      debugAttendanceLoader('effect.autoload.leaves');
      void loadLeavesTab();
      return;
    }
    if (activeTab === 'reports') {
      debugAttendanceLoader('effect.autoload.reports');
      setLoadedTabs((current) => ({ ...current, [activeTab]: true }));
      setLoading(false);
    }
  }, [activeTab, loading, loadedTabs, tabLoading, tabAutoLoadDone, canRunAttendanceRequests]);

  useEffect(() => {
    if (!loading) return;
    if (authLoading || !authInitialized) return;

    if (!visibleTabs.length) {
      debugAttendanceLoader('effect.loading_recovery.no_visible_tabs');
      setLoading(false);
      return;
    }

    if (!visibleTabs.some((tab) => tab.key === activeTab)) {
      debugAttendanceLoader('effect.loading_recovery.waiting_for_visible_tab');
      return;
    }

    if (!canRunAttendanceRequests) {
      debugAttendanceLoader('effect.loading_recovery.auth_settled_without_session');
      setLoading(false);
      return;
    }

    if (loadedTabs[activeTab]) {
      debugAttendanceLoader('effect.loading_recovery.active_tab_loaded');
      setLoading(false);
      return;
    }

    if (activeTab === 'reports') {
      debugAttendanceLoader('effect.loading_recovery.reports');
      setLoading(false);
    }
  }, [
    activeTab,
    authInitialized,
    authLoading,
    canRunAttendanceRequests,
    loadedTabs,
    loading,
    visibleTabs,
  ]);

  useEffect(() => {
    if (!isOverviewTabVisible) return;
    if (!loadedTabs.overview || overviewPendingRefreshRef.current) {
      debugAttendanceLoader('effect.overview.visible_refresh', {
        loaded: loadedTabs.overview,
        pendingRefresh: overviewPendingRefreshRef.current,
      });
      void loadOverviewData({ initial: !loadedTabs.overview, force: overviewPendingRefreshRef.current });
    }
  }, [isOverviewTabVisible, loadedTabs.overview]);

  useEffect(() => {
    if (staffFilters.department) {
      loadStaffMarking();
    }
  }, [staffFilters.department, staffFilters.date]);

  useEffect(() => {
    if (!isStaffTabVisible) return;
    debugAttendanceLoader('effect.staff.records');
    void loadStaffRecords();
  }, [
    isStaffTabVisible,
    staffFilters.recordDepartment,
    staffFilters.recordStaffName,
    staffFilters.recordDate,
    staffFilters.dashboardDepartment,
    staffFilters.dashboardDate,
  ]);

  useEffect(() => {
    if (!isStaffTabVisible) return;
    debugAttendanceLoader('effect.staff.calendar');
    void loadStaffCalendarRecords();
  }, [
    isStaffTabVisible,
    staffFilters.department,
    staffFilters.date,
  ]);

  useEffect(() => {
    if (activeTab !== 'reports') return;
    if (managedBatches.length) return;
    debugAttendanceLoader('effect.reports.managed_batches');
    void refreshManagedBatches({ force: false });
  }, [activeTab, managedBatches.length]);

  const selectedReportBatchNames = useMemo(
    () => parseCommaSeparatedValues(reportFilters.batch_names),
    [reportFilters.batch_names]
  );

  const batchOptions = managedBatchOptions;

  const toggleReportBatchName = (batchName: string) => {
    const currentSelections = parseCommaSeparatedValues(reportFilters.batch_names);
    const nextSelections = currentSelections.includes(batchName)
      ? currentSelections.filter((item) => item !== batchName)
      : [...currentSelections, batchName];
    setReportFilters((current) => ({
      ...current,
      batch_names: nextSelections.join(', '),
    }));
  };

  const addReportBatchName = (batchName: string) => {
    if (!batchName) return;
    const currentSelections = parseCommaSeparatedValues(reportFilters.batch_names);
    if (currentSelections.includes(batchName)) {
      setReportBatchPicker('');
      return;
    }
    setReportFilters((current) => ({
      ...current,
      batch_names: [...currentSelections, batchName].join(', '),
    }));
    setReportBatchPicker('');
  };

  const departmentOptions = useMemo(() => {
    const staffDepartmentOptions = getUniqueDepartmentOptions(
      staffMembers.map((member) => member.department)
    );
    if (staffDepartmentOptions.length) {
      return staffDepartmentOptions;
    }
    return getUniqueDepartmentOptions(toArray<string>(overview?.department_options));
  }, [overview?.department_options, staffMembers]);

  const departmentSummary = toArray<{ department: string; present: number; absent: number; late: number; half_day: number }>(
    (staffDashboard as any)?.department_summary
  );
  const staffDepartmentWiseSummary = useMemo(
    () =>
      departmentSummary.map((summary) => ({
        ...summary,
        total:
          Number(summary.present || 0) +
          Number(summary.absent || 0) +
          Number(summary.late || 0) +
          Number(summary.half_day || 0),
      })),
    [departmentSummary]
  );

  const staffCalendar = useMemo(() => {
    const selectedMonthDate = parseCalendarDate(staffFilters.date) || new Date();
    const currentYear = selectedMonthDate.getFullYear();
    const currentMonth = selectedMonthDate.getMonth();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const mapByDay = new Map<
      number,
      { status: string; present: number; absent: number; late: number; half_day: number; leave: number; total: number }
    >();

    const staffDepartmentMap = new Map(
      staffMembers.map((member) => [member.id, String(member.department || '').trim()])
    );
    const selectedDepartmentKey = normalizeDepartmentKey(staffFilters.department);

    const approvedLeavesSet = new Set<string>();

    staffApprovedLeaves.forEach((leave) => {
      if (leave.status !== 'approved') return;
      if (selectedDepartmentKey) {
        const leaveDepartment = staffDepartmentMap.get(leave.staff_member_id) || '';
        if (normalizeDepartmentKey(leaveDepartment) !== selectedDepartmentKey) return;
      }
      const fromDate = parseCalendarDate(leave.from_date);
      const toDate = parseCalendarDate(leave.to_date);
      if (!fromDate || !toDate) return;
      for (let dayCursor = new Date(fromDate); dayCursor <= toDate; dayCursor.setDate(dayCursor.getDate() + 1)) {
        if (dayCursor.getFullYear() !== currentYear || dayCursor.getMonth() !== currentMonth) continue;
        const key = `${leave.staff_member_id}-${dateToKeyFromDate(dayCursor)}`;
        approvedLeavesSet.add(key);
        const day = dayCursor.getDate();
        const current = mapByDay.get(day) || {
          status: 'leave',
          present: 0,
          absent: 0,
          late: 0,
          half_day: 0,
          leave: 0,
          total: 0,
        };
        current.leave += 1;
        current.total += 1;
        if (current.absent === 0 && current.present === 0 && current.late === 0 && current.half_day === 0) {
          current.status = 'leave';
        }
        mapByDay.set(day, current);
      }
    });

    staffCalendarRecords.forEach((record) => {
      const dt = parseCalendarDate(record.date);
      if (!dt) return;
      if (dt.getFullYear() !== currentYear || dt.getMonth() !== currentMonth) return;

      const key = `${record.staff_member_id}-${dateToKeyFromDate(dt)}`;
      if (approvedLeavesSet.has(key)) return;

      const day = dt.getDate();
      const current = mapByDay.get(day) || {
        status: record.status,
        present: 0,
        absent: 0,
        late: 0,
        half_day: 0,
        leave: 0,
        total: 0,
      };

      if (record.status === 'present') current.present += 1;
      if (record.status === 'absent') current.absent += 1;
      if (record.status === 'late') current.late += 1;
      if (record.status === 'half_day') current.half_day += 1;
      current.total += 1;

      mapByDay.set(day, current);
    });

    for (const current of mapByDay.values()) {
      if (current.absent > 0) current.status = 'absent';
      else if (current.late > 0) current.status = 'late';
      else if (current.half_day > 0) current.status = 'half_day';
      else if (current.present > 0) current.status = 'present';
      else if (current.leave > 0) current.status = 'leave';
      else current.status = null;
    }

    return Array.from({ length: daysInMonth }, (_, idx) => {
      const day = idx + 1;
      const summary = mapByDay.get(day);
      return {
        id: day,
        day,
        status: summary?.status || null,
        total: summary?.total || 0,
        present: summary?.present || 0,
        absent: summary?.absent || 0,
        late: summary?.late || 0,
        half_day: summary?.half_day || 0,
        leave: summary?.leave || 0,
      };
    });
  }, [staffApprovedLeaves, staffCalendarRecords, staffFilters.department, staffFilters.date, staffMembers]);

  const staffCalendarMarkedDates = useMemo(() => {
    const selectedMonthDate = parseCalendarDate(staffFilters.date) || new Date();
    const currentYear = selectedMonthDate.getFullYear();
    const currentMonth = selectedMonthDate.getMonth();
    const uniqueDates = new Map<string, string>();

    staffCalendarRecords.forEach((record) => {
      const dt = parseCalendarDate(record.date);
      if (!dt) return;
      if (dt.getFullYear() !== currentYear || dt.getMonth() !== currentMonth) return;
      const key = toDateKey(record.date);
      if (!key) return;
      uniqueDates.set(
        key,
        dt.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
      );
    });

    const staffDepartmentMap = new Map(
      staffMembers.map((member) => [member.id, String(member.department || '').trim()])
    );
    const selectedDepartmentKey = normalizeDepartmentKey(staffFilters.department);
    staffApprovedLeaves.forEach((leave) => {
      if (leave.status !== 'approved') return;
      if (selectedDepartmentKey) {
        const leaveDepartment = staffDepartmentMap.get(leave.staff_member_id) || '';
        if (normalizeDepartmentKey(leaveDepartment) !== selectedDepartmentKey) return;
      }
      const fromDate = parseCalendarDate(leave.from_date);
      const toDate = parseCalendarDate(leave.to_date);
      if (!fromDate || !toDate) return;
      for (let dayCursor = new Date(fromDate); dayCursor <= toDate; dayCursor.setDate(dayCursor.getDate() + 1)) {
        if (dayCursor.getFullYear() !== currentYear || dayCursor.getMonth() !== currentMonth) continue;
        const key = dateToKeyFromDate(dayCursor);
        uniqueDates.set(
          key,
          new Date(dayCursor).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
        );
      }
    });

    return Array.from(uniqueDates.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, label]) => label);
  }, [staffApprovedLeaves, staffCalendarRecords, staffFilters.department, staffFilters.date, staffMembers]);

  const staffCalendarMonthLabel = formatCalendarMonthLabel(staffFilters.date);
  const staffCalendarMonthInputValue = toMonthInputValue(staffFilters.date);

  const staffMonthlyApprovedLeaves = useMemo(() => {
    const selectedMonthDate = parseCalendarDate(staffFilters.date) || new Date();
    const currentYear = selectedMonthDate.getFullYear();
    const currentMonth = selectedMonthDate.getMonth();
    const selectedDepartmentKey = normalizeDepartmentKey(staffFilters.department);
    const staffDepartmentMap = new Map(
      staffMembers.map((member) => [member.id, String(member.department || '').trim()])
    );

    return staffApprovedLeaves.filter((leave) => {
      if (leave.status !== 'approved') return false;
      if (selectedDepartmentKey) {
        const leaveDepartment = staffDepartmentMap.get(leave.staff_member_id) || '';
        if (normalizeDepartmentKey(leaveDepartment) !== selectedDepartmentKey) return false;
      }
      const fromDate = parseCalendarDate(leave.from_date);
      const toDate = parseCalendarDate(leave.to_date);
      if (!fromDate || !toDate) return false;

      return (
        (fromDate.getFullYear() === currentYear && fromDate.getMonth() === currentMonth) ||
        (toDate.getFullYear() === currentYear && toDate.getMonth() === currentMonth) ||
        (fromDate < new Date(currentYear, currentMonth, 1) &&
          toDate > new Date(currentYear, currentMonth + 1, 0))
      );
    });
  }, [staffApprovedLeaves, staffFilters.date, staffFilters.department, staffMembers]);

  const staffMonthlyApprovedLeaveSummary = useMemo(() => {
    const selectedMonthDate = parseCalendarDate(staffFilters.date) || new Date();
    const monthStart = new Date(selectedMonthDate.getFullYear(), selectedMonthDate.getMonth(), 1);
    const monthEnd = new Date(selectedMonthDate.getFullYear(), selectedMonthDate.getMonth() + 1, 0);

    return staffMonthlyApprovedLeaves.map((leave) => {
      const fromDate = parseCalendarDate(leave.from_date);
      const toDate = parseCalendarDate(leave.to_date);

      if (!fromDate || !toDate) {
        return {
          ...leave,
          leaveDaysInMonth: 0,
        };
      }

      const effectiveStart = fromDate > monthStart ? fromDate : monthStart;
      const effectiveEnd = toDate < monthEnd ? toDate : monthEnd;
      const millisPerDay = 24 * 60 * 60 * 1000;
      const leaveDaysInMonth =
        effectiveEnd >= effectiveStart
          ? Math.floor((effectiveEnd.getTime() - effectiveStart.getTime()) / millisPerDay) + 1
          : 0;

      return {
        ...leave,
        leaveDaysInMonth,
      };
    });
  }, [staffMonthlyApprovedLeaves, staffFilters.date]);

  const markStaffDepartmentOptions = useMemo(() => {
    const filteredStaff = staffMembers.filter((member) => {
      if (staffFilters.staffType === 'teaching') return isTeachingStaffMember(member);
      if (staffFilters.staffType === 'non_teaching') return !isTeachingStaffMember(member);
      return true;
    });

    const filteredDepartments = getUniqueDepartmentOptions(
      filteredStaff.map((member) => member.department)
    );

    return filteredDepartments.length ? filteredDepartments : departmentOptions;
  }, [departmentOptions, staffFilters.staffType, staffMembers]);

  useEffect(() => {
    if (!departmentOptions.length) return;
    setStaffFilters((current) => {
      if (!current.department) {
        return current;
      }
      if (departmentOptions.includes(current.department)) {
        return current;
      }
      return {
        ...current,
        department: '',
      };
    });
  }, [departmentOptions]);

  useEffect(() => {
    if (!markStaffDepartmentOptions.length) return;
    setStaffFilters((current) => {
      if (!current.department) {
        return current;
      }
      if (markStaffDepartmentOptions.includes(current.department)) {
        return current;
      }
      return {
        ...current,
        department: '',
      };
    });
  }, [markStaffDepartmentOptions]);

  const loadStaffMarking = async () => {
    if (!canRunAttendanceRequests) {
      debugAttendanceLoader('loadStaffMarking.skipped.auth_not_ready');
      return;
    }
    if (!staffFilters.department) return;
    try {
      const response = await apiService.getStaffAttendanceMarking({
        date: staffFilters.date,
        department: staffFilters.department,
        search: staffFilters.search || undefined,
        school_id: currentSchoolId,
      });
      const payload = response.data;
      if (!payload || typeof payload !== 'object') {
        setStaffMarking(null);
        return;
      }
      setStaffMarking({
        ...(payload as StaffAttendanceMarkingResponse),
        staff: toArray<StaffAttendanceMarkingRow>(
          (payload as StaffAttendanceMarkingResponse).staff
        ),
      });
    } catch (error: any) {
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'Staff marking load nahi hua.') });
    }
  };

  const loadStaffRecords = async () => {
    if (!canRunAttendanceRequests) {
      debugAttendanceLoader('loadStaffRecords.skipped.auth_not_ready');
      return;
    }
    const requestKey = `${staffFilters.recordDepartment}|${staffFilters.recordStaffName}|${staffFilters.recordDate}|${staffFilters.dashboardDepartment}|${staffFilters.dashboardDate}`;
    staffRecordsRequestKeyRef.current = requestKey;
    try {
      debugAttendanceLoader('loadStaffRecords.start', { requestKey });
      const recordsRes = await apiService.listStaffAttendanceRecords({
        department: staffFilters.recordDepartment || undefined,
        staff_name: staffFilters.recordStaffName || undefined,
        date_from: staffFilters.recordDate || undefined,
        date_to: staffFilters.recordDate || undefined,
        limit: 200,
        school_id: currentSchoolId,
      });
      if (staffRecordsRequestKeyRef.current !== requestKey) return;
      const nextRecords = toArray<StaffAttendanceRecord>(recordsRes.data);
      setStaffRecords(nextRecords);
      if (!staffFilters.dashboardDate) {
        setStaffDashboard(null);
        return;
      }
      const dashboardRes = await apiService.getStaffAttendanceDashboard({
        school_id: currentSchoolId,
        department: staffFilters.dashboardDepartment || undefined,
        date_from: staffFilters.dashboardDate || undefined,
        date_to: staffFilters.dashboardDate || undefined,
      });
      if (staffRecordsRequestKeyRef.current !== requestKey) return;
      setStaffDashboard(normalizeStaffDashboard(dashboardRes.data, nextRecords));
    } catch (error: any) {
      if (isRequestCanceled(error)) {
        debugAttendanceLoader('loadStaffRecords.canceled', { requestKey });
        return;
      }
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'Staff records load nahi hue.') });
    } finally {
      debugAttendanceLoader('loadStaffRecords.end', { requestKey });
    }
  };

  const loadStaffCalendarRecords = async () => {
    if (!canRunAttendanceRequests) {
      debugAttendanceLoader('loadStaffCalendarRecords.skipped.auth_not_ready');
      return;
    }
    try {
      debugAttendanceLoader('loadStaffCalendarRecords.start');
      const monthRange = getMonthRange(staffFilters.date);
      const response = await apiService.listStaffAttendanceRecords({
        school_id: currentSchoolId,
        department: staffFilters.department || undefined,
        date_from: monthRange.from || undefined,
        date_to: monthRange.to || undefined,
        limit: 200,
      });
      setStaffCalendarRecords(toArray<StaffAttendanceRecord>(response.data));
    } catch {
      setStaffCalendarRecords([]);
    } finally {
      debugAttendanceLoader('loadStaffCalendarRecords.end');
    }
  };

  const refreshStudentTabViews = async (options?: { includeOverview?: boolean; forceOverview?: boolean }) => {
    setStudentPanelRefreshToken((current) => current + 1);
    if (options?.includeOverview) {
      await loadOverviewData({ force: options.forceOverview });
    }
  };

  const refreshStaffTabViews = async (options?: { includeOverview?: boolean; forceOverview?: boolean }) => {
    if (isStaffTabVisible) {
      await loadStaffRecords();
      await loadStaffCalendarRecords();
    }
    if (options?.includeOverview) {
      await loadOverviewData({ force: options.forceOverview });
    }
  };

  const handleSaveStaffAttendance = async () => {
    if (!staffMarking) return;
    try {
      await apiService.saveStaffAttendance({
        date: staffFilters.date,
        marked_by: 'HR Admin',
        entries: staffMarking.staff.map((item) => ({
          staff_member_id: item.staff_member_id,
          status: item.status,
          check_in: item.check_in,
          check_out: item.check_out,
        })),
      });
      setAlert({ type: 'success', message: 'Staff attendance save ho gayi.' });
      await refreshStaffTabViews({ includeOverview: true, forceOverview: true });
    } catch (error: any) {
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'Staff attendance save nahi hui.') });
    }
  };

  const handleCreateHoliday = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      await apiService.createAttendanceHoliday({
        ...holidayForm,
        holiday_date: holidayForm.holiday_date,
        description: holidayForm.description || undefined,
      });
      setHolidayForm(initialHolidayForm);
      setAlert({ type: 'success', message: 'Holiday add ho gayi.' });
      await loadOverviewData({ force: true });
    } catch (error: any) {
      setAlert({ type: 'error', message: error?.response?.data?.detail || 'Holiday add nahi hui.' });
    }
  };

  const handleCreateLeave = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!leaveForm.from_date || !leaveForm.to_date) {
      setAlert({ type: 'error', message: 'Start date aur end date dono required hain.' });
      return;
    }
    if (leaveForm.from_date > leaveForm.to_date) {
      setAlert({ type: 'error', message: 'End date start date se pehle nahi ho sakti.' });
      return;
    }
    try {
      await apiService.createAttendanceLeave({
        staff_member_id: String(leaveForm.staff_member_id).trim(),
        leave_type: leaveForm.leave_type,
        from_date: leaveForm.from_date,
        to_date: leaveForm.to_date,
        reason: leaveForm.reason || undefined,
      });
      setLeaveForm(initialLeaveForm);
      setAlert({ type: 'success', message: 'Leave application submit ho gayi.' });
      const response = await apiService.listAttendanceLeaves({ school_id: currentSchoolId });
      setLeaves(toArray<AttendanceLeave>(response.data));
      await refreshStaffLeaveViews();
      await loadOverviewData({ force: true });
    } catch (error: any) {
      setAlert({ type: 'error', message: error?.response?.data?.detail || 'Leave apply nahi hui.' });
    }
  };

  const handleLeaveDecision = async (leaveId: number, nextStatus: AttendanceLeaveStatus) => {
    try {
      await apiService.decideAttendanceLeave(leaveId, {
        status: nextStatus === 'approved' ? 'approved' : 'rejected',
        approved_by: 'HR Admin',
      });
      setAlert({ type: 'success', message: `Leave ${nextStatus} ho gayi.` });
      const response = await apiService.listAttendanceLeaves({ school_id: currentSchoolId });
      setLeaves(toArray<AttendanceLeave>(response.data));
      await refreshStaffLeaveViews();
      await loadOverviewData({ force: true });
    } catch (error: any) {
      setAlert({ type: 'error', message: error?.response?.data?.detail || 'Leave decision save nahi hua.' });
    }
  };

  const handleDeleteNotification = async (notificationId: number) => {
    if (!window.confirm('Delete this notification?')) return;
    try {
      await apiService.deleteAttendanceNotification(notificationId);
      setAlert({ type: 'success', message: 'Notification delete ho gayi.' });
      await loadOverviewData({ force: true });
    } catch (error: any) {
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'Notification delete nahi hui.') });
    }
  };

  const handleDeleteHoliday = async (holidayId: number) => {
    if (!window.confirm('Delete this holiday?')) return;
    try {
      await apiService.deleteAttendanceHoliday(holidayId);
      setAlert({ type: 'success', message: 'Holiday delete ho gayi.' });
      await loadOverviewData({ force: true });
    } catch (error: any) {
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'Holiday delete nahi hui.') });
    }
  };

  const handleDeleteStaffRecord = async (recordId: number) => {
    if (!window.confirm('Delete this staff attendance record?')) return;
    try {
      await apiService.deleteStaffAttendanceRecord(recordId);
      setAlert({ type: 'success', message: 'Staff attendance record delete ho gaya.' });
      await refreshStaffTabViews({ includeOverview: true, forceOverview: true });
    } catch (error: any) {
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'Staff attendance record delete nahi hua.') });
    }
  };

  const handleDeleteLeave = async (leaveId: number) => {
    if (!window.confirm('Delete this leave request?')) return;
    try {
      await apiService.deleteAttendanceLeave(leaveId);
      setAlert({ type: 'success', message: 'Leave request delete ho gayi.' });
      const response = await apiService.listAttendanceLeaves({ school_id: currentSchoolId });
      setLeaves(toArray<AttendanceLeave>(response.data));
      await refreshStaffLeaveViews();
      await loadOverviewData({ force: true });
    } catch (error: any) {
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'Leave request delete nahi hui.') });
    }
  };

  const handleDeleteAllNotifications = async () => {
    if (!window.confirm(`${isPlatformSuperAdmin ? 'Delete' : 'Request delete for'} all attendance notifications?`)) return;
    try {
      const response = await apiService.deleteAllAttendanceNotifications();
      if (response.data?.mode === 'approval_required') {
        setAlert({ type: 'success', message: response.data?.message || 'Delete all notifications request bhej di gayi hai.' });
        return;
      }
      setAlert({ type: 'success', message: 'All notifications delete ho gayi.' });
      await loadOverviewData({ force: true });
    } catch (error: any) {
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'All notifications delete nahi hui.') });
    }
  };

  const handleDeleteAllHolidays = async () => {
    if (!window.confirm(`${isPlatformSuperAdmin ? 'Delete' : 'Request delete for'} all holidays?`)) return;
    try {
      const response = await apiService.deleteAllAttendanceHolidays();
      if (response.data?.mode === 'approval_required') {
        setAlert({ type: 'success', message: response.data?.message || 'Delete all holidays request bhej di gayi hai.' });
        return;
      }
      setAlert({ type: 'success', message: 'All holidays delete ho gayi.' });
      await loadOverviewData({ force: true });
    } catch (error: any) {
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'All holidays delete nahi hui.') });
    }
  };

  const handleDeleteAllStaffRecords = async () => {
    if (!window.confirm(`Current filters ke hisaab se saare staff attendance records ${isPlatformSuperAdmin ? 'delete' : 'delete request'} karne hain?`)) return;
    try {
      const response = await apiService.deleteAllStaffAttendanceRecords({
        school_id: currentSchoolId,
        department: staffFilters.recordDepartment || undefined,
        staff_name: staffFilters.recordStaffName || undefined,
        date_from: staffFilters.recordDate || undefined,
        date_to: staffFilters.recordDate || undefined,
      });
      if (response.data?.mode === 'approval_required') {
        setAlert({ type: 'success', message: response.data?.message || 'Staff attendance bulk delete request bhej di gayi hai.' });
        return;
      }
      setAlert({ type: 'success', message: 'Filtered staff attendance records delete ho gaye.' });
      await refreshStaffTabViews({ includeOverview: true, forceOverview: true });
    } catch (error: any) {
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'Staff attendance records delete nahi hue.') });
    }
  };

  const handleDeleteAllLeaves = async () => {
    if (!window.confirm(`${isPlatformSuperAdmin ? 'Delete' : 'Request delete for'} all leave requests?`)) return;
    try {
      const response = await apiService.deleteAllAttendanceLeaves({ school_id: currentSchoolId });
      if (response.data?.mode === 'approval_required') {
        setAlert({ type: 'success', message: response.data?.message || 'Delete all leave requests request bhej di gayi hai.' });
        return;
      }
      setAlert({ type: 'success', message: 'All leave requests delete ho gayi.' });
      const leavesResponse = await apiService.listAttendanceLeaves({ school_id: currentSchoolId });
      setLeaves(toArray<AttendanceLeave>(leavesResponse.data));
      await refreshStaffLeaveViews();
      await loadOverviewData({ force: true });
    } catch (error: any) {
      setAlert({ type: 'error', message: getApiErrorMessage(error, 'All leave requests delete nahi hui.') });
    }
  };

  const handleRunReport = async () => {
    try {
      const response = await apiService.getAttendanceReportData({
        report_type: reportFilters.report_type,
        school_id: currentSchoolId,
        batch_names: reportFilters.batch_names || undefined,
        department: reportFilters.department || undefined,
        date_from: reportFilters.date_from || undefined,
        date_to: reportFilters.date_to || undefined,
      });
      const report = response.data;
      if (!report || typeof report !== 'object') {
        setReportData(null);
        return;
      }
      setReportData({
        ...(report as AttendanceReportResponse),
        rows: toArray((report as AttendanceReportResponse).rows),
      });
    } catch (error: any) {
      setAlert({ type: 'error', message: error?.response?.data?.detail || 'Report load nahi hua.' });
    }
  };

  const downloadBlob = (blob: Blob, filename: string = 'download') => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportReport = async (format: 'excel' | 'pdf') => {
    try {
      const response = await apiService.exportAttendanceReport({
        report_type: reportFilters.report_type,
        export_format: format,
        school_id: currentSchoolId,
        batch_names: reportFilters.batch_names || undefined,
        department: reportFilters.department || undefined,
        date_from: reportFilters.date_from || undefined,
        date_to: reportFilters.date_to || undefined,
      });
      downloadBlob(response.data, `attendance-${reportFilters.report_type}.${format === 'excel' ? 'xlsx' : 'pdf'}`);
    } catch (error: any) {
      setAlert({ type: 'error', message: error?.response?.data?.detail || 'Report export nahi hua.' });
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50">
      <main className="mx-auto max-w-[1550px] p-3 sm:p-4 md:p-6 xl:p-8">
        <section className="rounded-[2rem] bg-white p-4 shadow-xl sm:p-6 lg:p-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.2em] text-indigo-600">Admin Office</p>
              <h1 className="mt-3 text-4xl font-bold text-slate-900">
                {isTeacherSelfView ? 'Teacher Attendance Workspace' : 'Attendance Management System'}
              </h1>
              <p className="mt-4 max-w-3xl text-slate-600">
                {isTeacherSelfView
                  ? 'Aapki class attendance, aapki attendance history, aur aapki leave requests yahin dikhenge.'
                  : 'Student Attendance, Staff Attendance, Leave Management, Notifications, and Reports from one Admin Office workspace.'}
              </p>
            </div>
            <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
              <HeroMetric label="Students" value={`${overview?.student_count || 0}`} />
              <HeroMetric label="Staff" value={`${overview?.staff_count || 0}`} />
            </div>
          </div>
          <div className="mt-6 flex gap-2 overflow-x-auto rounded-[1.5rem] bg-slate-50 p-2">
            {visibleTabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`shrink-0 rounded-full px-4 py-2.5 text-sm font-medium transition ${
                  activeTab === tab.key
                    ? 'bg-indigo-600 text-white shadow-md'
                    : 'text-slate-600 hover:bg-white hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </section>

        {alert ? (
          <div className="mt-6">
            <Alert message={alert.message} type={alert.type} onClose={() => setAlert(null)} />
          </div>
        ) : null}

        {loading ? (
          <div className="mt-6">
            <LoadingSpinner message="Attendance Management module load ho raha hai..." />
          </div>
        ) : null}

        {tabLoading ? (
          <div className="mt-6">
            <LoadingSpinner message="Attendance tab load ho raha hai..." />
          </div>
        ) : null}

        {!isTeacherSelfView && activeTab === 'overview' ? (
          <div className="mt-6 grid gap-6">
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Notifications" value={`${notifications.length}`} icon={Bell} tone="indigo" />
              <StatCard label="Pending Leaves" value={`${leaves.filter((item) => item.status === 'pending').length}`} icon={ClipboardCheck} tone="amber" />
              <StatCard label="Departments" value={`${overview?.department_options?.length || 0}`} icon={UserCheck} tone="emerald" />
              <StatCard label="Holidays" value={`${holidays.length}`} icon={CalendarDays} tone="rose" />
            </section>

            <section className="grid gap-6 xl:grid-cols-2">
              <div className={sectionClass}>
                <h2 className="text-2xl font-bold text-slate-900">Student Overview</h2>
                <div className="mt-6 grid gap-4 md:grid-cols-3">
                  <SmallMetricCard label="Total Students" value={`${overview?.student_count || 0}`} tone="indigo" />
                  <SmallMetricCard label="Present" value={`0`} tone="emerald" />
                  <SmallMetricCard label="Absent" value={`0`} tone="rose" />
                </div>
              </div>
              <div className={sectionClass}>
                <h2 className="text-2xl font-bold text-slate-900">Staff Overview</h2>
                <div className="mt-6 grid gap-4 md:grid-cols-3">
                  <SmallMetricCard label="Total Staff" value={`${overview?.staff_count || 0}`} tone="indigo" />
                  <SmallMetricCard label="Present" value={`${staffDashboard?.present_count || 0}`} tone="emerald" />
                  <SmallMetricCard label="Absent" value={`${staffDashboard?.absent_count || 0}`} tone="rose" />
                </div>
              </div>
            </section>

            <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
              <div className={sectionClass}>
                <div className="flex items-center justify-between gap-4">
                  <h2 className="text-2xl font-bold text-slate-900">Recent Notifications</h2>
                  <button type="button" onClick={handleDeleteAllNotifications} className={deleteAllButtonClass}>
                    {isPlatformSuperAdmin ? 'Delete All' : 'Request Delete All'}
                  </button>
                </div>
                <div className="mt-6 space-y-3">
                  {notifications.map((item) => (
                    <div key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{item.message}</p>
                          <p className="mt-1 text-sm text-slate-500">{item.notification_type}</p>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <span className="text-xs text-slate-400">{formatDate(item.created_at)}</span>
                          <button type="button" onClick={() => handleDeleteNotification(item.id)} className={deleteButtonClass}>
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className={sectionClass}>
                <div className="flex items-center justify-between gap-4">
                  <h2 className="text-2xl font-bold text-slate-900">Holiday Calendar</h2>
                  <button type="button" onClick={handleDeleteAllHolidays} className={deleteAllButtonClass}>
                    {isPlatformSuperAdmin ? 'Delete All' : 'Request Delete All'}
                  </button>
                </div>
                <div className="mt-6 space-y-3">
                  {holidays.map((holiday) => (
                    <div key={holiday.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{holiday.title}</p>
                          <p className="mt-1 text-sm text-slate-500">{formatDate(holiday.holiday_date)}</p>
                          <p className="mt-2 text-sm text-slate-600">{holiday.description || 'No description'}</p>
                        </div>
                        <button type="button" onClick={() => handleDeleteHoliday(holiday.id)} className={deleteButtonClass}>
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>
        ) : null}

        {activeTab === 'student' ? (
          <div className="mt-6 grid gap-6">
            <section className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
              <MarkStudentAttendance
                students={students}
                managedBatches={managedBatches}
                subjects={subjects}
                managedBatchOptions={managedBatchOptions}
                managedClassOptions={managedClassOptions}
                onAlert={setAlert}
                onAttendanceSaved={() => refreshStudentTabViews({ includeOverview: true, forceOverview: true })}
              />

                <div className="grid min-w-0 gap-6">
                  <StudentRecordsPanel
                    isVisible={isStudentTabVisible}
                    refreshToken={studentPanelRefreshToken}
                    students={students}
                    managedBatches={managedBatches}
                    managedBatchOptions={managedBatchOptions}
                  managedClassOptions={managedClassOptions}
                  onAlert={setAlert}
                  onRefresh={() => refreshStudentTabViews({ includeOverview: true, forceOverview: true })}
                />

                  <div className={`${sectionClass} min-w-0`}>
                    <StudentDashboardPanel
                      isVisible={isStudentTabVisible}
                      refreshToken={studentPanelRefreshToken}
                      students={students}
                      managedBatchOptions={managedBatchOptions}
                      managedClassOptions={managedClassOptions}
                      onAlert={setAlert}
                    />
                  </div>
                </div>
              </section>
          </div>
        ) : null}

        {activeTab === 'staff' ? (
          <div className="mt-6 grid gap-6">
            <section className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
              {!isTeacherSelfView ? (
              <div className={`${sectionClass} min-w-0`}>
                <div>
                  <h2 className="text-2xl font-bold text-slate-900">Mark Staff Attendance</h2>
                  <p className="mt-2 text-sm text-slate-500">HR / Admin controlled daily attendance.</p>
                </div>
                <div className="mt-6 grid gap-4 md:grid-cols-4">
                  <input type="date" value={staffFilters.date} onChange={(e) => setStaffFilters({ ...staffFilters, date: e.target.value })} className={inputClass} />
                  <div className="relative w-full overflow-hidden rounded-2xl border border-sky-200 bg-sky-50 shadow-sm">
                    <select
                      value={staffFilters.staffType}
                      onChange={(e) =>
                        setStaffFilters({
                          ...staffFilters,
                          staffType: e.target.value as 'all' | 'teaching' | 'non_teaching',
                          department: '',
                        })
                      }
                      className={`w-full cursor-pointer appearance-none bg-transparent px-4 py-3 pr-16 text-sm font-medium text-slate-900 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-4 focus:ring-slate-200/70`}
                      style={{ backgroundImage: 'none' }}
                    >
                      <option value="all">All Staff</option>
                      <option value="teaching">Teaching</option>
                      <option value="non_teaching">Non-Teaching</option>
                    </select>
                    <div className="pointer-events-none absolute inset-y-0 right-0 flex w-12 items-center justify-center border-l border-sky-200 bg-white/80 text-sky-700">
                      <ChevronDown className="h-4 w-4" />
                    </div>
                  </div>
                  <div className="relative w-full overflow-hidden rounded-2xl border border-sky-200 bg-sky-50 shadow-sm">
                    <select value={staffFilters.department} onChange={(e) => setStaffFilters({ ...staffFilters, department: e.target.value })} className={`w-full cursor-pointer appearance-none bg-transparent px-4 py-3 pr-16 text-sm font-medium text-slate-900 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-4 focus:ring-slate-200/70`} style={{ backgroundImage: 'none' }}>
                      <option value="">Department</option>
                      {markStaffDepartmentOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                    </select>
                    <div className="pointer-events-none absolute inset-y-0 right-0 flex w-12 items-center justify-center border-l border-sky-200 bg-white/80 text-sky-700">
                      <ChevronDown className="h-4 w-4" />
                    </div>
                  </div>
                  <input value={staffFilters.search} onChange={(e) => setStaffFilters({ ...staffFilters, search: e.target.value })} className={inputClass} placeholder="Search staff" />
                </div>
                <button onClick={loadStaffMarking} className="mt-4 rounded-full bg-indigo-600 px-5 py-3 text-sm font-semibold text-white hover:bg-indigo-700">
                  Load Staff
                </button>

                  <div className="mt-6 max-h-[26rem] overflow-auto rounded-[1.5rem] border border-slate-200">
                  <div className="grid min-w-[58rem] grid-cols-[0.9fr_1.2fr_1fr_1.1fr_0.8fr_0.8fr] gap-4 bg-slate-50 px-4 py-3 text-xs uppercase tracking-[0.22em] text-slate-500">
                    <span>Staff ID</span>
                    <span>Name</span>
                    <span>Department</span>
                    <span>Status</span>
                    <span>Check-In</span>
                    <span>Check-Out</span>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {staffMarking?.staff?.length ? staffMarking.staff.map((member) => (
                      <div key={member.staff_member_id} className="grid min-w-[58rem] grid-cols-[0.9fr_1.2fr_1fr_1.1fr_0.8fr_0.8fr] gap-4 px-4 py-4 text-sm text-slate-700">
                        <span>{member.staff_id}</span>
                        <span>{member.staff_name}</span>
                        <div>
                          <p>{member.department || 'N/A'}</p>
                          <p className="text-xs text-slate-500">{member.designation || 'Staff'}</p>
                          {member.is_on_approved_leave ? (
                            <p className="mt-1 text-xs font-medium text-sky-700">
                              Approved leave{member.leave_type ? `: ${String(member.leave_type).replace('_', ' ')}` : ''}
                              {member.leave_reason ? ` | ${member.leave_reason}` : ''}
                            </p>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {(['present', 'absent', 'late', 'half_day'] as StaffAttendanceStatus[]).map((status) => (
                            <button
                              key={status}
                              type="button"
                              onClick={() =>
                                setStaffMarking((current) =>
                                  current
                                    ? {
                                        ...current,
                                        staff: current.staff.map((row) =>
                                          row.staff_member_id === member.staff_member_id ? { ...row, status } : row
                                        ),
                                      }
                                    : current
                                )
                              }
                              className={`${statusButtonBase} ${
                                member.status === status ? staffStatusClass(status) : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {status}
                            </button>
                          ))}
                        </div>
                        <input
                          value={member.check_in || ''}
                          onChange={(e) =>
                            setStaffMarking((current) =>
                              current
                                ? {
                                    ...current,
                                    staff: current.staff.map((row) =>
                                      row.staff_member_id === member.staff_member_id ? { ...row, check_in: e.target.value } : row
                                    ),
                                  }
                                : current
                            )
                          }
                          className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                        />
                        <input
                          value={member.check_out || ''}
                          onChange={(e) =>
                            setStaffMarking((current) =>
                              current
                                ? {
                                    ...current,
                                    staff: current.staff.map((row) =>
                                      row.staff_member_id === member.staff_member_id ? { ...row, check_out: e.target.value } : row
                                    ),
                                  }
                                : current
                            )
                          }
                          className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                        />
                      </div>
                    )) : (
                      <div className="px-4 py-8 text-center text-sm text-slate-500">
                        Staff attendance data load nahi hua. Department select karke `Load Staff` dabayein.
                      </div>
                    )}
                  </div>
                </div>

                <button onClick={handleSaveStaffAttendance} className="mt-6 rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800">
                  Save Attendance
                </button>

                <div className="mt-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold text-slate-900">Calendar View</h3>
                      <p className="mt-1 text-sm font-medium text-slate-600">{staffCalendarMonthLabel}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <input
                        type="month"
                        value={staffCalendarMonthInputValue}
                        onChange={(e) =>
                          setStaffFilters((current) => ({
                            ...current,
                            date: applyMonthInputValue(current.date, e.target.value),
                          }))
                        }
                        className={`${inputClass} min-w-[10rem]`}
                      />
                      <div className="inline-flex overflow-hidden rounded-full border border-slate-300 bg-white">
                        <button
                          type="button"
                          onClick={() =>
                            setStaffFilters((current) => ({
                              ...current,
                              date: shiftMonthValue(current.date, -1),
                            }))
                          }
                          className="px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                        >
                          Previous
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setStaffFilters((current) => ({
                              ...current,
                              date: shiftMonthValue(current.date, 1),
                            }))
                          }
                          className="border-l border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  </div>
                  <p className="mt-2 text-sm text-slate-500">
                    {staffFilters.department
                      ? `Selected department: ${staffFilters.department}`
                      : 'Showing approved leaves and attendance for all departments'}
                  </p>
                  <p className="mt-2 text-sm text-slate-600">
                    Marked Dates:
                    <span className="font-semibold text-slate-900">
                      {' '}
                      {staffCalendarMarkedDates.length
                        ? staffCalendarMarkedDates.join(', ')
                        : 'No marked dates in selected month'}
                    </span>
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full border border-emerald-200 bg-emerald-100 px-3 py-1 text-emerald-800">Present shade</span>
                    <span className="rounded-full border border-rose-200 bg-rose-100 px-3 py-1 text-rose-800">Absent shade</span>
                    <span className="rounded-full border border-amber-200 bg-amber-100 px-3 py-1 text-amber-800">Late shade</span>
                    <span className="rounded-full border border-orange-200 bg-orange-100 px-3 py-1 text-orange-800">Half day shade</span>
                    <span className="rounded-full border border-sky-200 bg-sky-100 px-3 py-1 text-sky-800">Approved leave</span>
                  </div>
                  <div className="mt-4 grid grid-cols-7 gap-2">
                    {staffCalendar.map((record) => (
                      <div
                        key={record.id}
                        className={`rounded-2xl border p-3 text-center text-xs transition ${staffCalendarShadeClass(record.status)}`}
                      >
                        <p className="text-sm font-semibold">{record.day}</p>
                        <p className="mt-1 capitalize">{record.status || 'N/A'}</p>
                        {record.total ? (
                          <p className="mt-1 text-[11px] opacity-80">
                            {record.present}P / {record.absent}A{record.leave ? ` / ${record.leave}L` : ''}
                          </p>
                        ) : (
                          <p className="mt-1 text-[11px] opacity-70">No entry</p>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-sm font-semibold text-slate-900">
                      Approved Leaves In Selected Month ({staffMonthlyApprovedLeaves.length})
                    </p>
                    <div className="mt-3 space-y-2 text-sm text-slate-600">
                      {staffMonthlyApprovedLeaveSummary.length ? (
                        staffMonthlyApprovedLeaveSummary.map((leave) => (
                          <p key={leave.id}>
                            {leave.staff_name || `Staff #${leave.staff_member_id}`}: {formatDate(leave.from_date)} to {formatDate(leave.to_date)} ({leave.leaveDaysInMonth} day{leave.leaveDaysInMonth === 1 ? '' : 's'})
                          </p>
                        ))
                      ) : (
                        <p>No approved leave matches the current month and department filter.</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              ) : null}

              <div className="grid min-w-0 gap-6">
                <div className={`${sectionClass} min-w-0`}>
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <h2 className="text-2xl font-bold text-slate-900">{isTeacherSelfView ? 'My Attendance Summary' : 'Staff Dashboard'}</h2>
                      <p className="mt-2 text-sm text-slate-500">
                        {isTeacherSelfView ? 'Sirf aapki attendance summary aur records dikh rahe hain.' : 'Department-wise attendance summary.'}
                      </p>
                    </div>
                    <button onClick={loadStaffRecords} className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
                      Refresh Records
                    </button>
                  </div>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <input
                      type="date"
                      value={staffFilters.dashboardDate}
                      onChange={(e) => setStaffFilters({ ...staffFilters, dashboardDate: e.target.value })}
                      className={inputClass}
                    />
                    {!isTeacherSelfView ? (
                      <div className="relative w-full overflow-hidden rounded-2xl border border-sky-200 bg-sky-50 shadow-sm">
                        <select
                          value={staffFilters.dashboardDepartment}
                          onChange={(e) => setStaffFilters({ ...staffFilters, dashboardDepartment: e.target.value })}
                          className={`w-full cursor-pointer appearance-none bg-transparent px-4 py-3 pr-16 text-sm font-medium text-slate-900 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-4 focus:ring-slate-200/70`}
                          style={{ backgroundImage: 'none' }}
                        >
                          <option value="">All Departments</option>
                          {departmentOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                        </select>
                        <div className="pointer-events-none absolute inset-y-0 right-0 flex w-12 items-center justify-center border-l border-sky-200 bg-white/80 text-sky-700">
                          <ChevronDown className="h-4 w-4" />
                        </div>
                      </div>
                    ) : <div />}
                  </div>
                  {staffFilters.dashboardDate ? (
                    <>
                      <div className="mt-6 grid gap-4 md:grid-cols-5">
                        <SmallMetricCard label="Present" value={`${staffDashboard?.present_count || 0}`} tone="emerald" />
                        <SmallMetricCard label="Absent" value={`${staffDashboard?.absent_count || 0}`} tone="rose" />
                        <SmallMetricCard label="Late" value={`${staffDashboard?.late_count || 0}`} tone="amber" />
                        <SmallMetricCard label="Half Day" value={`${staffDashboard?.half_day_count || 0}`} tone="orange" />
                        <SmallMetricCard label="Monthly %" value={`${staffDashboard?.monthly_attendance_percentage || 0}%`} tone="indigo" />
                      </div>
                      <div className="mt-6 overflow-auto rounded-[1.5rem] border border-slate-200">
                        <div className="grid min-w-[52rem] grid-cols-[1.2fr_0.6fr_0.6fr_0.6fr_0.7fr_0.6fr] gap-4 bg-slate-50 px-4 py-3 text-xs uppercase tracking-[0.22em] text-slate-500">
                          <span>Department</span>
                          <span>Present</span>
                          <span>Absent</span>
                          <span>Late</span>
                          <span>Half Day</span>
                          <span>Total</span>
                        </div>
                        <div className="divide-y divide-slate-100">
                          {staffDepartmentWiseSummary.map((summary) => (
                            <div
                              key={summary.department}
                              className="grid min-w-[52rem] grid-cols-[1.2fr_0.6fr_0.6fr_0.6fr_0.7fr_0.6fr] gap-4 px-4 py-3 text-sm text-slate-700"
                            >
                              <span className="font-medium text-slate-900">{String(summary.department)}</span>
                              <span>{String(summary.present)}</span>
                              <span>{String(summary.absent)}</span>
                              <span>{String(summary.late)}</span>
                              <span>{String(summary.half_day)}</span>
                              <span>{String(summary.total)}</span>
                            </div>
                          ))}
                          {!staffDepartmentWiseSummary.length ? (
                            <div className="px-4 py-5 text-sm text-slate-500">
                              Selected filters ke liye abhi department-wise staff attendance summary available nahi hai.
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                      Staff Dashboard data dekhne ke liye pehle date select karein.
                    </div>
                  )}
                </div>

                <div className={`${sectionClass} min-w-0`}>
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <h2 className="text-2xl font-bold text-slate-900">{isTeacherSelfView ? 'My Attendance Records' : 'Staff Records'}</h2>
                    {!isTeacherSelfView ? (
                      <button type="button" onClick={handleDeleteAllStaffRecords} className={deleteAllButtonClass}>
                        {isPlatformSuperAdmin ? 'Delete All' : 'Request Delete All'}
                      </button>
                    ) : null}
                  </div>
                  <div className="mt-6 grid gap-4 md:grid-cols-3">
                    <input value={staffFilters.recordStaffName} onChange={(e) => setStaffFilters({ ...staffFilters, recordStaffName: e.target.value })} className={inputClass} placeholder={isTeacherSelfView ? 'My name' : 'Staff name'} />
                    {!isTeacherSelfView ? (
                      <div className="relative w-full overflow-hidden rounded-2xl border border-sky-200 bg-sky-50 shadow-sm">
                        <select value={staffFilters.recordDepartment} onChange={(e) => setStaffFilters({ ...staffFilters, recordDepartment: e.target.value })} className={`w-full cursor-pointer appearance-none bg-transparent px-4 py-3 pr-16 text-sm font-medium text-slate-900 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-4 focus:ring-slate-200/70`} style={{ backgroundImage: 'none' }}>
                          <option value="">Department</option>
                          {departmentOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                        </select>
                        <div className="pointer-events-none absolute inset-y-0 right-0 flex w-12 items-center justify-center border-l border-sky-200 bg-white/80 text-sky-700">
                          <ChevronDown className="h-4 w-4" />
                        </div>
                      </div>
                    ) : <div />}
                    <input type="date" value={staffFilters.recordDate} onChange={(e) => setStaffFilters({ ...staffFilters, recordDate: e.target.value })} className={inputClass} />
                  </div>
                  <div className="mt-4 max-h-72 overflow-auto rounded-[1.5rem] border border-slate-200">
                    <div className="grid min-w-[46rem] grid-cols-[1fr_1fr_0.9fr_0.9fr_0.7fr] gap-4 bg-slate-50 px-4 py-3 text-xs uppercase tracking-[0.22em] text-slate-500">
                      <span>Staff</span>
                      <span>Department</span>
                      <span>Date</span>
                      <span>Status</span>
                      <span>Action</span>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {staffRecords.map((record) => (
                        <div key={record.id} className="grid min-w-[46rem] grid-cols-[1fr_1fr_0.9fr_0.9fr_0.7fr] gap-4 px-4 py-3 text-sm text-slate-700">
                          <span>{record.staff_name}</span>
                          <span>{record.department}</span>
                          <span>{formatDate(record.date)}</span>
                          <span className={`inline-flex max-w-max rounded-full px-3 py-1 text-xs ${staffStatusClass(record.status)}`}>{record.status}</span>
                          {!isTeacherSelfView ? (
                            <button type="button" onClick={() => handleDeleteStaffRecord(record.id)} className={deleteButtonClass}>
                              Delete
                            </button>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                  {!isTeacherSelfView ? (
                  <div className="mt-6 grid gap-4">
                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <h3 className="text-lg font-semibold text-slate-900">Holiday Calendar</h3>
                      <button type="button" onClick={handleDeleteAllHolidays} className={deleteAllButtonClass}>
                        {isPlatformSuperAdmin ? 'Delete All' : 'Request Delete All'}
                      </button>
                    </div>
                    <form onSubmit={handleCreateHoliday} className="grid gap-3 md:grid-cols-3">
                      <input value={holidayForm.title} onChange={(e) => setHolidayForm({ ...holidayForm, title: e.target.value })} className={inputClass} placeholder="Holiday title" />
                      <input type="date" value={holidayForm.holiday_date} onChange={(e) => setHolidayForm({ ...holidayForm, holiday_date: e.target.value })} className={inputClass} />
                      <input value={holidayForm.description} onChange={(e) => setHolidayForm({ ...holidayForm, description: e.target.value })} className={inputClass} placeholder="Description" />
                      <button className="rounded-full bg-indigo-600 px-5 py-3 text-sm font-semibold text-white hover:bg-indigo-700 md:col-span-3">
                        Add Holiday
                      </button>
                    </form>
                    <div className="max-h-56 overflow-auto rounded-2xl border border-slate-200 bg-slate-50 p-3">
                      <div className="space-y-2">
                        {holidays.map((item) => (
                          <div key={item.id} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="font-semibold text-slate-900">{item.title}</p>
                                <p className="text-xs text-slate-500">{formatDate(item.holiday_date)}</p>
                                <p className="text-xs text-slate-600">{item.description || 'No description'}</p>
                              </div>
                              <button type="button" onClick={() => handleDeleteHoliday(item.id)} className={deleteButtonClass}>
                                Delete
                              </button>
                            </div>
                          </div>
                        ))}
                        {!holidays.length ? <p className="text-sm text-slate-500">No holidays added yet.</p> : null}
                      </div>
                    </div>
                  </div>
                  ) : null}
                </div>
              </div>
            </section>
          </div>
        ) : null}

        {activeTab === 'leaves' ? (
          <div className="mt-6 grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
            <section className={sectionClass}>
              <h2 className="text-2xl font-bold text-slate-900">Leave Application</h2>
              <form onSubmit={handleCreateLeave} className="mt-6 grid gap-4">
                {isTeacherSelfView ? (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                    Applying leave for: <span className="font-semibold text-slate-900">{staffMembers[0]?.name || user?.full_name || 'Teacher'}</span>
                  </div>
                ) : (
                  <div className="relative w-full overflow-hidden rounded-2xl border border-sky-200 bg-sky-50 shadow-sm">
                    <select value={leaveForm.staff_member_id} onChange={(e) => setLeaveForm({ ...leaveForm, staff_member_id: e.target.value })} className={`w-full cursor-pointer appearance-none bg-transparent px-4 py-3 pr-16 text-sm font-medium text-slate-900 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-4 focus:ring-slate-200/70`} style={{ backgroundImage: 'none' }}>
                      <option value="">Staff Member</option>
                      {staffMembers.map((member) => (
                        <option key={member.id} value={member.id}>{member.name}</option>
                      ))}
                    </select>
                    <div className="pointer-events-none absolute inset-y-0 right-0 flex w-12 items-center justify-center border-l border-sky-200 bg-white/80 text-sky-700">
                      <ChevronDown className="h-4 w-4" />
                    </div>
                  </div>
                )}
                <div className="relative w-full overflow-hidden rounded-2xl border border-sky-200 bg-sky-50 shadow-sm">
                  <select value={leaveForm.leave_type} onChange={(e) => setLeaveForm({ ...leaveForm, leave_type: e.target.value as AttendanceLeaveType })} className={`w-full cursor-pointer appearance-none bg-transparent px-4 py-3 pr-16 text-sm font-medium text-slate-900 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-4 focus:ring-slate-200/70`} style={{ backgroundImage: 'none' }}>
                    <option value="casual">Casual Leave</option>
                    <option value="sick">Sick Leave</option>
                    <option value="paid">Paid Leave</option>
                    <option value="emergency">Emergency Leave</option>
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex w-12 items-center justify-center border-l border-sky-200 bg-white/80 text-sky-700">
                    <ChevronDown className="h-4 w-4" />
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <input type="date" value={leaveForm.from_date} onChange={(e) => setLeaveForm({ ...leaveForm, from_date: e.target.value })} className={inputClass} />
                  <input type="date" min={leaveForm.from_date || undefined} value={leaveForm.to_date} onChange={(e) => setLeaveForm({ ...leaveForm, to_date: e.target.value })} className={inputClass} />
                </div>
                <textarea value={leaveForm.reason} onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })} className={`${inputClass} min-h-28`} placeholder="Reason" />
                <button className="rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800">
                  Apply Leave
                </button>
              </form>
            </section>

            <section className={sectionClass}>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-slate-900">Leave History Log</h2>
                  <p className="mt-2 text-sm text-slate-500">
                    {isTeacherSelfView ? 'Sirf aapki leave requests yahan dikhengi.' : 'Approve or reject leave requests.'}
                  </p>
                </div>
                {!isTeacherSelfView ? (
                  <button type="button" onClick={handleDeleteAllLeaves} className={deleteAllButtonClass}>
                    {isPlatformSuperAdmin ? 'Delete All' : 'Request Delete All'}
                  </button>
                ) : null}
              </div>
              <div className="mt-6 max-h-[34rem] space-y-3 overflow-auto pr-1">
                {leaves.map((leave) => (
                  <div key={leave.id} className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{leave.staff_name}</p>
                        <p className="mt-1 text-sm text-slate-500">{leave.leave_type.replace('_', ' ')}</p>
                        <p className="mt-2 text-sm text-slate-600">
                          {formatDate(leave.from_date)} to {formatDate(leave.to_date)}
                        </p>
                        <p className="mt-2 text-sm text-slate-600">{leave.reason || 'No reason provided'}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
                          leave.status === 'approved'
                            ? 'bg-emerald-100 text-emerald-700'
                            : leave.status === 'rejected'
                              ? 'bg-rose-100 text-rose-700'
                              : 'bg-amber-100 text-amber-700'
                        }`}>
                          {leave.status}
                        </span>
                        {!isTeacherSelfView && leave.status === 'pending' ? (
                          <>
                            <button onClick={() => handleLeaveDecision(leave.id, 'approved')} className="rounded-full bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700">
                              Approve
                            </button>
                            <button onClick={() => handleLeaveDecision(leave.id, 'rejected')} className="rounded-full bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700">
                              Reject
                            </button>
                          </>
                        ) : null}
                        <button type="button" onClick={() => handleDeleteLeave(leave.id)} className={deleteButtonClass}>
                          {isTeacherSelfView ? 'Withdraw' : 'Delete'}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        ) : null}

        {!isTeacherSelfView && activeTab === 'reports' ? (
          <div className="mt-6 grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
            <section className={sectionClass}>
              <h2 className="text-2xl font-bold text-slate-900">Attendance Reports</h2>
              <div className="mt-6 grid gap-4">
                <div className="relative w-full overflow-hidden rounded-2xl border border-sky-200 bg-sky-50 shadow-sm">
                  <select value={reportFilters.report_type} onChange={(e) => setReportFilters({ ...reportFilters, report_type: e.target.value as typeof reportFilters.report_type })} className={`w-full cursor-pointer appearance-none bg-transparent px-4 py-3 pr-16 text-sm font-medium text-slate-900 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-4 focus:ring-slate-200/70`} style={{ backgroundImage: 'none' }}>
                    <option value="student_summary">Student Summary</option>
                    <option value="staff_summary">Staff Summary</option>
                    <option value="leave_summary">Leave Summary</option>
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex w-12 items-center justify-center border-l border-sky-200 bg-white/80 text-sky-700">
                    <ChevronDown className="h-4 w-4" />
                  </div>
                </div>
                {reportFilters.report_type === 'student_summary' ? (
                  <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-slate-900">Select Batches</p>
                      {selectedReportBatchNames.length ? (
                        <button
                          type="button"
                          onClick={() => setReportFilters({ ...reportFilters, batch_names: '' })}
                          className="text-xs font-semibold text-indigo-600 hover:text-indigo-700"
                        >
                          Clear
                        </button>
                      ) : null}
                    </div>
                    <p className="mt-2 text-xs text-slate-500">
                      {selectedReportBatchNames.length
                        ? `${selectedReportBatchNames.length} batch selected`
                        : 'Agar koi batch select nahi karte, to report all batches ke liye chalegi.'}
                    </p>
                    <div className="mt-3">
                      <div className="relative w-full overflow-hidden rounded-2xl border border-sky-200 bg-sky-50 shadow-sm">
                        <select
                          value={reportBatchPicker}
                          onChange={(e) => {
                            const value = e.target.value;
                            setReportBatchPicker(value);
                            addReportBatchName(value);
                          }}
                          className={`w-full cursor-pointer appearance-none bg-transparent px-4 py-3 pr-16 text-sm font-medium text-slate-900 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-4 focus:ring-slate-200/70`}
                          style={{ backgroundImage: 'none' }}
                        >
                          <option value="">Choose batch</option>
                          {batchOptions.map((batchName) => (
                            <option
                              key={batchName}
                              value={batchName}
                              disabled={selectedReportBatchNames.includes(batchName)}
                            >
                              {batchName}
                            </option>
                          ))}
                        </select>
                        <div className="pointer-events-none absolute inset-y-0 right-0 flex w-12 items-center justify-center border-l border-sky-200 bg-white/80 text-sky-700">
                          <ChevronDown className="h-4 w-4" />
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 flex max-h-40 flex-wrap gap-2 overflow-auto pr-1">
                      {selectedReportBatchNames.length ? (
                        selectedReportBatchNames.map((batchName) => (
                          <button
                            key={batchName}
                            type="button"
                            onClick={() => toggleReportBatchName(batchName)}
                            className="rounded-full border border-indigo-200 bg-white px-3 py-2 text-xs font-semibold text-indigo-700 transition hover:border-rose-200 hover:text-rose-700"
                          >
                            {batchName} x
                          </button>
                        ))
                      ) : batchOptions.length ? null : (
                        <p className="text-sm text-slate-500">Batch list load ho rahi hai ya abhi available nahi hai.</p>
                      )}
                    </div>
                  </div>
                ) : null}
                <div className="grid gap-4 md:grid-cols-2">
                  {reportFilters.report_type !== 'student_summary' ? (
                    <div className="relative w-full overflow-hidden rounded-2xl border border-sky-200 bg-sky-50 shadow-sm">
                      <select value={reportFilters.department} onChange={(e) => setReportFilters({ ...reportFilters, department: e.target.value })} className={`w-full cursor-pointer appearance-none bg-transparent px-4 py-3 pr-16 text-sm font-medium text-slate-900 outline-none transition placeholder:text-slate-400 focus:bg-white focus:ring-4 focus:ring-slate-200/70`} style={{ backgroundImage: 'none' }}>
                        <option value="">Department</option>
                        {departmentOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                      </select>
                      <div className="pointer-events-none absolute inset-y-0 right-0 flex w-12 items-center justify-center border-l border-sky-200 bg-white/80 text-sky-700">
                        <ChevronDown className="h-4 w-4" />
                      </div>
                    </div>
                  ) : (
                    <div />
                  )}
                  <div className="grid gap-4 md:grid-cols-2">
                    <input type="date" value={reportFilters.date_from} onChange={(e) => setReportFilters({ ...reportFilters, date_from: e.target.value })} className={inputClass} />
                    <input type="date" value={reportFilters.date_to} onChange={(e) => setReportFilters({ ...reportFilters, date_to: e.target.value })} className={inputClass} />
                  </div>
                </div>
                <div className="flex flex-wrap gap-3">
                  <button onClick={handleRunReport} className="rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800">
                    Run Report
                  </button>
                  <button onClick={() => handleExportReport('excel')} className="rounded-full bg-emerald-600 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-700">
                    Export Excel
                  </button>
                  <button onClick={() => handleExportReport('pdf')} className="rounded-full bg-rose-600 px-5 py-3 text-sm font-semibold text-white hover:bg-rose-700">
                    Export PDF
                  </button>
                </div>
              </div>
            </section>

            <section className={sectionClass}>
              <h2 className="text-2xl font-bold text-slate-900">Report Preview</h2>
              <p className="mt-2 text-sm text-slate-500">
                {reportData ? `${reportData.total_records} records loaded.` : 'Run a report to preview data.'}
              </p>
              <div className="mt-6 max-h-[34rem] overflow-auto rounded-[1.5rem] border border-slate-200">
                {reportData && reportData.rows.length ? (
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-left text-slate-500">
                        {Object.keys(reportData.rows[0].values).map((column) => (
                          <th key={column} className="px-4 py-3 capitalize">{column.replace(/_/g, ' ')}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {reportData.rows.map((row, index) => (
                        <tr key={index} className="border-t border-slate-100 text-slate-700">
                          {Object.keys(reportData.rows[0].values).map((column) => (
                            <td key={column} className="px-4 py-3">{String(row.values[column] ?? '')}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="p-6 text-sm text-slate-500">No report data available.</div>
                )}
              </div>
            </section>
          </div>
        ) : null}
      </main>
    </div>
  );
}

function HeroMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-3xl bg-slate-50 p-4 text-center">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function StatCard({
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

function SmallMetricCard({
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

type AttendanceBoundaryState = {
  hasError: boolean;
  message: string;
};

class AttendanceErrorBoundary extends Component<{ children: ReactNode }, AttendanceBoundaryState> {
  state: AttendanceBoundaryState = {
    hasError: false,
    message: '',
  };

  static getDerivedStateFromError(error: Error): AttendanceBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'Attendance module render error',
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Attendance module crashed', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 p-6">
          <div className="mx-auto max-w-3xl rounded-3xl border border-rose-200 bg-white p-8 shadow-sm">
            <h2 className="text-2xl font-bold text-slate-900">Attendance module recover mode</h2>
            <p className="mt-3 text-sm text-slate-600">
              Page render error aaya tha, isliye white screen ke bajay safe fallback dikhaya gaya hai.
            </p>
            <p className="mt-3 text-sm text-rose-600">{this.state.message}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-5 rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Reload Attendance
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function AttendanceManagement() {
  return (
    <AttendanceErrorBoundary>
      <AttendanceManagementContent />
    </AttendanceErrorBoundary>
  );
}
