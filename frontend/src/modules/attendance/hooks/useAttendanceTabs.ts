import { useEffect, useMemo, useState } from 'react';
import type { TabKey } from '../utils/attendanceUtils';
import { tabs } from '../utils/attendanceUtils';

export function useAttendanceTabs({
  canViewOverviewTab,
  canViewStudentTab,
  canViewStaffTab,
  canViewLeavesTab,
  canViewReportsTab,
  isTeacherSelfView,
  locationHash,
}: {
  canViewOverviewTab: boolean;
  canViewStudentTab: boolean;
  canViewStaffTab: boolean;
  canViewLeavesTab: boolean;
  canViewReportsTab: boolean;
  isTeacherSelfView: boolean;
  locationHash: string;
}) {
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
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

  useEffect(() => {
    const hashValue = locationHash.replace('#', '').trim();
    if (!hashValue) return;
    const nextTab = visibleTabs.find((tab) => tab.key === hashValue);
    if (nextTab) {
      setActiveTab(nextTab.key);
    }
  }, [locationHash, visibleTabs]);

  useEffect(() => {
    if (visibleTabs.some((tab) => tab.key === activeTab)) return;
    if (visibleTabs[0]?.key) {
      setActiveTab(visibleTabs[0].key);
    }
  }, [activeTab, visibleTabs]);

  return {
    activeTab,
    setActiveTab,
    loadedTabs,
    setLoadedTabs,
    tabAutoLoadDone,
    setTabAutoLoadDone,
    visibleTabs,
  };
}
