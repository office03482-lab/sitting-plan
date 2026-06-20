import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Copy, Download, Eye, FileText, KeyRound, Lock, LogOut, RefreshCw, Shield, Users } from 'lucide-react';

import { apiService, getRequestErrorMessage } from '@services/api';
import type {
  AccountHistoryItem,
  ActiveSessionRecord,
  Batch,
  BulkPortalCredentialRow,
  GeneratedCredentialRecord,
  PortalOverviewRecord,
  PortalOverviewResponse,
  PortalPermissionTemplate,
  RolePowerUser,
} from '@types';

type TabKey = 'student' | 'parent' | 'teacher' | 'staff' | 'administrator' | 'credentials' | 'sessions' | 'history';
type PermissionModule = { key: string; label: string; sections: Array<{ key: string; label: string }> };
type ScopeValue = 'selected' | 'batch' | 'class' | 'school';
type ParentScopeValue = 'selected_parents' | 'selected_students' | 'batch' | 'school';

const PANEL_INPUT =
  'w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-900 focus:ring-4 focus:ring-slate-200/60';
const BUTTON_PRIMARY =
  'inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60';
const BUTTON_SECONDARY =
  'inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60';

const tabLabels: Array<{ key: TabKey; label: string }> = [
  { key: 'student', label: 'Students' },
  { key: 'parent', label: 'Parents' },
  { key: 'teacher', label: 'Teachers' },
  { key: 'staff', label: 'Staff' },
  { key: 'administrator', label: 'Administrators' },
  { key: 'credentials', label: 'Credentials' },
  { key: 'sessions', label: 'Sessions' },
  { key: 'history', label: 'Account History' },
];

const formatDateTime = (value?: string | null) => {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const toTitle = (value?: string | null) =>
  String(value || '')
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ') || 'User';

const permissionLabel = (key: string) =>
  key
    .split('.')
    .map((chunk) =>
      chunk
        .split('_')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' '),
    )
    .join(' / ');

const normalizeStaffType = (value: 'teacher' | 'staff' | 'non_teaching' | 'teaching' | 'invigilator') => {
  if (value === 'teacher' || value === 'teaching') return 'teaching';
  return 'invigilator';
};

function SummaryCard({ title, value, helper }: { title: string; value: number; helper?: string }) {
  return (
    <div className="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-semibold text-slate-500">{title}</p>
      <p className="mt-3 text-4xl font-bold text-slate-900">{value}</p>
      {helper ? <p className="mt-2 text-xs text-slate-500">{helper}</p> : null}
    </div>
  );
}

function SectionCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="rounded-[2rem] border border-white/70 bg-white/95 p-6 shadow-sm">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
        {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Modal({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 px-4">
      <div className="w-full max-w-4xl rounded-[2rem] bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-sky-700">User Account & Access Center</p>
            <h3 className="mt-1 text-2xl font-bold text-slate-900">{title}</h3>
          </div>
          <button type="button" onClick={onClose} className={BUTTON_SECONDARY}>
            Close
          </button>
        </div>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}

function PermissionChecklist({
  modules,
  selected,
  onToggle,
}: {
  modules: PermissionModule[];
  selected: string[];
  onToggle: (permissionKey: string) => void;
}) {
  return (
    <div className="grid gap-4">
      {modules.map((module) => (
        <div key={module.key} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-semibold text-slate-900">{module.label}</p>
          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            <label className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
              <input type="checkbox" checked={selected.includes(module.key)} onChange={() => onToggle(module.key)} />
              {module.label}
            </label>
            {module.sections.map((section) => (
              <label key={section.key} className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                <input type="checkbox" checked={selected.includes(section.key)} onChange={() => onToggle(section.key)} />
                {section.label}
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function PortalAccessManager() {
  const [activeTab, setActiveTab] = useState<TabKey>('student');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [processingKey, setProcessingKey] = useState<string | null>(null);

  const [batches, setBatches] = useState<Batch[]>([]);
  const [permissionTemplates, setPermissionTemplates] = useState<PortalPermissionTemplate[]>([]);
  const [permissionModules, setPermissionModules] = useState<PermissionModule[]>([]);
  const [studentOverview, setStudentOverview] = useState<PortalOverviewResponse | null>(null);
  const [parentOverview, setParentOverview] = useState<PortalOverviewResponse | null>(null);
  const [teacherOverview, setTeacherOverview] = useState<PortalOverviewResponse | null>(null);
  const [staffOverview, setStaffOverview] = useState<PortalOverviewResponse | null>(null);
  const [roleUsers, setRoleUsers] = useState<RolePowerUser[]>([]);
  const [recentCredentials, setRecentCredentials] = useState<GeneratedCredentialRecord[]>([]);
  const [history, setHistory] = useState<AccountHistoryItem[]>([]);
  const [sessions, setSessions] = useState<ActiveSessionRecord[]>([]);
  const [generatedRows, setGeneratedRows] = useState<BulkPortalCredentialRow[]>([]);
  const [generatedModalOpen, setGeneratedModalOpen] = useState(false);
  const [credentialModal, setCredentialModal] = useState<GeneratedCredentialRecord | null>(null);

  const [studentScope, setStudentScope] = useState<ScopeValue>('school');
  const [studentBatchId, setStudentBatchId] = useState('');
  const [studentClassName, setStudentClassName] = useState('');
  const [studentSearch, setStudentSearch] = useState('');
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [studentTemplateKey, setStudentTemplateKey] = useState('student');
  const [studentPermissions, setStudentPermissions] = useState<string[]>([]);

  const [parentScope, setParentScope] = useState<ParentScopeValue>('school');
  const [parentBatchId, setParentBatchId] = useState('');
  const [parentSearch, setParentSearch] = useState('');
  const [selectedParentIds, setSelectedParentIds] = useState<string[]>([]);
  const [parentTemplateKey, setParentTemplateKey] = useState('parent');
  const [parentPermissions, setParentPermissions] = useState<string[]>([]);

  const [teacherTemplateKey, setTeacherTemplateKey] = useState('teacher');
  const [teacherPermissions, setTeacherPermissions] = useState<string[]>([]);
  const [selectedTeacherIds, setSelectedTeacherIds] = useState<string[]>([]);
  const [teacherSearch, setTeacherSearch] = useState('');

  const [staffTemplateKey, setStaffTemplateKey] = useState('accountant');
  const [staffRoleKey, setStaffRoleKey] = useState('staff');
  const [staffPermissions, setStaffPermissions] = useState<string[]>([]);
  const [selectedStaffIds, setSelectedStaffIds] = useState<string[]>([]);
  const [staffSearch, setStaffSearch] = useState('');

  const [adminName, setAdminName] = useState('');
  const [adminUsername, setAdminUsername] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [adminRoleKey, setAdminRoleKey] = useState('school_admin');
  const [adminPermissions, setAdminPermissions] = useState<string[]>([]);
  const [historySearch, setHistorySearch] = useState('');

  const templateMap = useMemo(
    () => new Map(permissionTemplates.map((template) => [template.key, template])),
    [permissionTemplates],
  );

  useEffect(() => {
    setStudentPermissions(templateMap.get(studentTemplateKey)?.permissions || []);
  }, [studentTemplateKey, templateMap]);

  useEffect(() => {
    setParentPermissions(templateMap.get(parentTemplateKey)?.permissions || []);
  }, [parentTemplateKey, templateMap]);

  useEffect(() => {
    setTeacherPermissions(templateMap.get(teacherTemplateKey)?.permissions || []);
  }, [teacherTemplateKey, templateMap]);

  useEffect(() => {
    const template = templateMap.get(staffTemplateKey);
    setStaffPermissions(template?.permissions || []);
    if (template?.selected_role) {
      setStaffRoleKey(template.selected_role);
    }
  }, [staffTemplateKey, templateMap]);

  useEffect(() => {
    const defaultAdminTemplate = templateMap.get('academic_coordinator') || templateMap.get('viewer');
    setAdminPermissions(defaultAdminTemplate?.permissions || []);
  }, [templateMap]);

  const refreshAll = async () => {
    try {
      setError(null);
      const [
        batchesRes,
        templatesRes,
        permissionsRes,
        studentsRes,
        parentsRes,
        teachersRes,
        staffRes,
        usersRes,
        credentialsRes,
        historyRes,
        sessionsRes,
      ] = await Promise.all([
        apiService.listBatches(),
        apiService.getPortalPermissionTemplates(),
        apiService.listPermissions(),
        apiService.getPortalOverview({ entity_type: 'student', limit: 25, offset: 0 }),
        apiService.getPortalOverview({ entity_type: 'parent', limit: 25, offset: 0 }),
        apiService.getPortalOverview({ entity_type: 'staff', staff_type: normalizeStaffType('teacher'), limit: 25, offset: 0 }),
        apiService.getPortalOverview({ entity_type: 'staff', staff_type: normalizeStaffType('non_teaching'), limit: 25, offset: 0 }),
        apiService.listRoleUsers(),
        apiService.listRecentGeneratedCredentials({ limit: 50 }),
        apiService.getAccountHistory({ limit: 50, offset: 0 }),
        apiService.listSecuritySessions(),
      ]);
      setBatches(Array.isArray(batchesRes.data) ? batchesRes.data : []);
      setPermissionTemplates(Array.isArray(templatesRes.data) ? templatesRes.data : []);
      setPermissionModules(Array.isArray(permissionsRes.data) ? permissionsRes.data : []);
      setStudentOverview(studentsRes.data);
      setParentOverview(parentsRes.data);
      setTeacherOverview(teachersRes.data);
      setStaffOverview(staffRes.data);
      setRoleUsers(Array.isArray(usersRes.data) ? usersRes.data : []);
      setRecentCredentials(Array.isArray(credentialsRes.data) ? credentialsRes.data : []);
      setHistory(historyRes.data.items || []);
      setSessions(Array.isArray(sessionsRes.data) ? sessionsRes.data : []);
    } catch (requestError: any) {
      setError(getRequestErrorMessage(requestError, 'Failed to load access center.'));
    }
  };

  useEffect(() => {
    void refreshAll();
  }, []);

  const studentRecords = useMemo(() => {
    const rows = studentOverview?.records || [];
    return rows.filter((record) => {
      if (studentScope === 'batch' && studentBatchId && record.batch_id !== studentBatchId) return false;
      if (studentScope === 'class' && studentClassName && String(record.class_name || '').toLowerCase() !== studentClassName.toLowerCase()) return false;
      if (studentSearch) {
        const haystack = `${record.entity_name || ''} ${record.roll_number || ''} ${record.username || ''}`.toLowerCase();
        if (!haystack.includes(studentSearch.toLowerCase())) return false;
      }
      if (studentScope === 'selected' && selectedStudentIds.length) return selectedStudentIds.includes(record.entity_id);
      return true;
    });
  }, [selectedStudentIds, studentBatchId, studentClassName, studentOverview?.records, studentScope, studentSearch]);

  const parentRecords = useMemo(() => {
    const rows = parentOverview?.records || [];
    return rows.filter((record) => {
      if (parentSearch) {
        const haystack = `${record.entity_name || ''} ${record.phone || ''} ${record.username || ''}`.toLowerCase();
        if (!haystack.includes(parentSearch.toLowerCase())) return false;
      }
      if (parentScope === 'selected_parents' && selectedParentIds.length) return selectedParentIds.includes(record.entity_id);
      return true;
    });
  }, [parentOverview?.records, parentScope, parentSearch, selectedParentIds]);

  const teacherRecords = useMemo(() => {
    const rows = teacherOverview?.records || [];
    return rows.filter((record) => {
      if (!teacherSearch) return true;
      const haystack = `${record.entity_name || ''} ${record.employee_code || ''} ${record.username || ''}`.toLowerCase();
      return haystack.includes(teacherSearch.toLowerCase());
    });
  }, [teacherOverview?.records, teacherSearch]);

  const staffRecords = useMemo(() => {
    const rows = staffOverview?.records || [];
    return rows.filter((record) => {
      if (!staffSearch) return true;
      const haystack = `${record.entity_name || ''} ${record.employee_code || ''} ${record.department || ''}`.toLowerCase();
      return haystack.includes(staffSearch.toLowerCase());
    });
  }, [staffOverview?.records, staffSearch]);

  const adminUsers = useMemo(
    () => roleUsers.filter((user) => ['school_admin', 'platform_admin', 'store_manager', 'viewer'].includes(String(user.role || '').toLowerCase())),
    [roleUsers],
  );

  const summary = useMemo(() => {
    const studentTotal = studentOverview?.summary.total_records || 0;
    const studentPending = studentOverview?.summary.accounts_pending || 0;
    const studentActive = studentOverview?.summary.portal_active || 0;
    const parentActive = parentOverview?.summary.portal_active || 0;
    const teacherTotal = teacherOverview?.summary.total_records || 0;
    const staffTotal = staffOverview?.summary.total_records || 0;
    const adminTotal = adminUsers.length;
    return { studentTotal, studentPending, studentActive, parentActive, teacherTotal, staffTotal, adminTotal, totalStaff: teacherTotal + staffTotal };
  }, [adminUsers.length, parentOverview?.summary.portal_active, staffOverview?.summary.total_records, studentOverview?.summary.accounts_pending, studentOverview?.summary.portal_active, studentOverview?.summary.total_records, teacherOverview?.summary.total_records]);

  const toggleSelection = (value: string, selected: string[], setter: React.Dispatch<React.SetStateAction<string[]>>) => {
    setter(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);
  };

  const togglePermission = (permission: string, selected: string[], setter: React.Dispatch<React.SetStateAction<string[]>>) => {
    setter(selected.includes(permission) ? selected.filter((item) => item !== permission) : [...selected, permission]);
  };

  const withAction = async (key: string, action: () => Promise<void>) => {
    try {
      setProcessingKey(key);
      setError(null);
      setMessage(null);
      await action();
    } catch (requestError: any) {
      setError(getRequestErrorMessage(requestError, 'Action failed.'));
    } finally {
      setProcessingKey(null);
    }
  };

  const copyToClipboard = async (value: string, success: string) => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setMessage(success);
  };

  const exportExcel = async (rows: BulkPortalCredentialRow[] = generatedRows) => {
    if (!rows.length) return;
    const response = await apiService.exportPortalCredentials(rows as unknown as Array<Record<string, unknown>>);
    const blob = response.data instanceof Blob ? response.data : new Blob([response.data]);
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `PortalCredentials_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.xlsx`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.URL.revokeObjectURL(url);
  };

  const exportPdf = (rows: GeneratedCredentialRecord[]) => {
    const printable = window.open('', '_blank', 'width=900,height=700');
    if (!printable) return;
    printable.document.write(`
      <html>
        <head>
          <title>Portal Credentials</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; }
            table { width: 100%; border-collapse: collapse; margin-top: 16px; }
            th, td { border: 1px solid #d1d5db; padding: 10px; text-align: left; }
            th { background: #f8fafc; }
          </style>
        </head>
        <body>
          <h1>Portal Credentials</h1>
          <table>
            <thead><tr><th>Name</th><th>Role</th><th>Username</th><th>Password</th><th>Created</th></tr></thead>
            <tbody>
              ${rows
                .map(
                  (row) =>
                    `<tr><td>${row.entity_name || ''}</td><td>${toTitle(row.role_key)}</td><td>${row.username}</td><td>${row.temporary_password}</td><td>${formatDateTime(row.created_at)}</td></tr>`,
                )
                .join('')}
            </tbody>
          </table>
        </body>
      </html>
    `);
    printable.document.close();
    printable.focus();
    printable.print();
  };

  const openCredentialDetails = async (profileId: string) => {
    const response = await apiService.getGeneratedCredentialDetails(profileId);
    setCredentialModal(response.data);
  };

  const handleStudentGenerate = async () => {
    await withAction('generate-students', async () => {
      const response = await apiService.bulkGenerateStudentPortalAccounts({
        student_ids: studentScope === 'selected' ? selectedStudentIds : undefined,
        batch_id: studentScope === 'batch' ? studentBatchId : undefined,
        class_name: studentScope === 'class' ? studentClassName : undefined,
        permission_template: studentTemplateKey,
        permissions: studentPermissions,
      });
      setGeneratedRows(response.data.credentials || []);
      setGeneratedModalOpen(true);
      setMessage(`Generated ${response.data.count} student accounts.`);
      await refreshAll();
    });
  };

  const handleParentGenerate = async () => {
    await withAction('generate-parents', async () => {
      const response = await apiService.bulkGenerateParentPortalAccounts({
        guardian_ids: parentScope === 'selected_parents' ? selectedParentIds : undefined,
        student_ids: parentScope === 'selected_students' ? selectedStudentIds : undefined,
        batch_id: parentScope === 'batch' ? parentBatchId : undefined,
        permission_template: parentTemplateKey,
        permissions: parentPermissions,
      });
      setGeneratedRows(response.data.credentials || []);
      setGeneratedModalOpen(true);
      setMessage(`Generated ${response.data.count} parent accounts.`);
      await refreshAll();
    });
  };

  const handleTeacherGenerate = async () => {
    await withAction('generate-teachers', async () => {
      const response = await apiService.bulkGenerateStaffPortalAccounts({
        staff_member_ids: selectedTeacherIds.length ? selectedTeacherIds : undefined,
        staff_type: normalizeStaffType('teacher'),
        permission_template: teacherTemplateKey,
        selected_role: 'teacher',
        permissions: teacherPermissions,
      });
      setGeneratedRows(response.data.credentials || []);
      setGeneratedModalOpen(true);
      setMessage(`Generated ${response.data.count} teacher accounts.`);
      await refreshAll();
    });
  };

  const handleStaffGenerate = async () => {
    await withAction('generate-staff', async () => {
      const response = await apiService.bulkGenerateStaffPortalAccounts({
        staff_member_ids: selectedStaffIds.length ? selectedStaffIds : undefined,
        staff_type: normalizeStaffType('non_teaching'),
        permission_template: staffTemplateKey,
        selected_role: staffRoleKey,
        permissions: staffPermissions,
      });
      setGeneratedRows(response.data.credentials || []);
      setGeneratedModalOpen(true);
      setMessage(`Generated ${response.data.count} staff accounts.`);
      await refreshAll();
    });
  };

  const handleCreateAdministrator = async () => {
    await withAction('create-admin', async () => {
      const response = await apiService.createRoleUser({
        username: adminUsername,
        full_name: adminName,
        email: adminEmail || undefined,
        password: adminPassword,
        role: adminRoleKey,
        user_type: 'non_teaching',
        permissions: adminPermissions,
      });
      const created = response.data as RolePowerUser & { password?: string };
      setGeneratedRows([
        {
          name: created.full_name,
          role: toTitle(created.role),
          identifier: created.email || created.username,
          student_name: created.full_name,
          roll_number: created.email || created.username,
          username: created.username,
          temporary_password: created.password || adminPassword,
          created_at: new Date().toISOString(),
        },
      ]);
      setGeneratedModalOpen(true);
      setAdminName('');
      setAdminUsername('');
      setAdminEmail('');
      setAdminPassword('');
      setMessage('Administrator account created.');
      await refreshAll();
    });
  };

  const handleSessionAction = async (session: ActiveSessionRecord, action: 'device' | 'all' | 'disable') => {
    await withAction(`${action}-${session.id}`, async () => {
      if (action === 'device') await apiService.logoutDeviceSession(session.id);
      if (action === 'all') await apiService.logoutAllProfileSessions(session.profile_id);
      if (action === 'disable') await apiService.disableProfileAccount(session.profile_id);
      await refreshAll();
      setMessage(action === 'device' ? 'Device logged out.' : action === 'all' ? 'All devices logged out.' : 'Account disabled.');
    });
  };

  const studentPreviewPending = Math.max(studentRecords.filter((item) => item.portal_status === 'not_created').length, 0);
  const studentPreviewCreated = studentRecords.filter((item) => item.portal_status !== 'not_created').length;

  const renderAccountTable = (
    rows: PortalOverviewRecord[],
    selected: string[],
    setter: React.Dispatch<React.SetStateAction<string[]>>,
    roleMode: 'student' | 'parent' | 'teacher' | 'staff',
  ) => (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>
            <th className="px-4 py-3 text-left"></th>
            <th className="px-4 py-3 text-left font-semibold text-slate-600">Name</th>
            <th className="px-4 py-3 text-left font-semibold text-slate-600">Username</th>
            <th className="px-4 py-3 text-left font-semibold text-slate-600">Status</th>
            <th className="px-4 py-3 text-left font-semibold text-slate-600">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((record) => (
            <tr key={record.entity_id}>
              <td className="px-4 py-3">
                <input type="checkbox" checked={selected.includes(record.entity_id)} onChange={() => toggleSelection(record.entity_id, selected, setter)} />
              </td>
              <td className="px-4 py-3">
                <p className="font-semibold text-slate-900">{record.entity_name}</p>
                <p className="text-xs text-slate-500">{record.roll_number || record.employee_code || record.phone || record.email || 'Record'}</p>
              </td>
              <td className="px-4 py-3 font-semibold text-slate-900">{record.username || 'Not created'}</td>
              <td className="px-4 py-3 text-slate-700">{record.portal_status}</td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      void withAction(`reset-${record.entity_id}`, async () => {
                        if (roleMode === 'student') {
                          await (record.profile_linked ? apiService.resetStudentPortalPassword(record.entity_id) : apiService.createStudentPortalLogin(record.entity_id));
                        }
                        if (roleMode === 'parent') {
                          await (record.profile_linked ? apiService.resetParentPortalPassword(record.entity_id) : apiService.createParentPortalLogin(record.entity_id));
                        }
                        if (roleMode === 'teacher' || roleMode === 'staff') {
                          await apiService.resetStaffPortalPassword(record.entity_id, roleMode === 'teacher' ? 'teacher' : staffRoleKey);
                        }
                        await refreshAll();
                        setMessage('Password reset complete.');
                      })
                    }
                    className={BUTTON_SECONDARY}
                  >
                    <KeyRound className="h-4 w-4" />
                    {record.profile_linked ? 'Reset Password' : 'Create Account'}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void withAction(`disable-${record.entity_id}`, async () => {
                        if (record.profile_id) {
                          await (record.is_enabled ? apiService.disableProfileAccount(record.profile_id) : apiService.enableProfileAccount(record.profile_id));
                          await refreshAll();
                        }
                      })
                    }
                    disabled={!record.profile_id}
                    className={BUTTON_SECONDARY}
                  >
                    <Lock className="h-4 w-4" />
                    {record.is_enabled ? 'Disable Account' : 'Enable Account'}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void withAction(`logout-${record.entity_id}`, async () => {
                        if (roleMode === 'student') await apiService.forceLogoutStudentPortal(record.entity_id);
                        if (roleMode === 'parent') await apiService.forceLogoutParentPortal(record.entity_id);
                        if ((roleMode === 'teacher' || roleMode === 'staff') && record.profile_id) await apiService.logoutAllProfileSessions(record.profile_id);
                        await refreshAll();
                      })
                    }
                    disabled={!record.profile_linked}
                    className={BUTTON_SECONDARY}
                  >
                    <LogOut className="h-4 w-4" />
                    Logout All Devices
                  </button>
                  <button type="button" onClick={() => record.profile_id && void openCredentialDetails(record.profile_id)} disabled={!record.profile_id} className={BUTTON_SECONDARY}>
                    <Eye className="h-4 w-4" />
                    View Credentials
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="min-h-full bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.14),_transparent_28%),linear-gradient(180deg,_#f8fafc_0%,_#eef2ff_100%)] px-4 py-8 md:px-8">
      <div className="mx-auto max-w-7xl">
        <section className="rounded-[2rem] border border-white/70 bg-white/95 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-sky-700">Portal Access Manager V4</p>
          <h1 className="mt-2 text-3xl font-bold text-slate-900">User Account & Access Center</h1>
          <p className="mt-2 max-w-4xl text-sm text-slate-600">Create accounts, manage permissions, reset passwords, export credentials, and monitor active sessions.</p>
        </section>

        {message ? <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div> : null}
        {error ? <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

        <section className="mt-6 grid gap-4 md:grid-cols-5">
          <SummaryCard title="Students" value={summary.studentTotal} helper={`${summary.studentPending} Pending • ${summary.studentActive} Active`} />
          <SummaryCard title="Parents" value={summary.parentActive} helper="Active" />
          <SummaryCard title="Teaching Staff" value={summary.teacherTotal} helper="Total" />
          <SummaryCard title="Non-Teaching Staff" value={summary.staffTotal} helper={`Combined staff ${summary.totalStaff}`} />
          <SummaryCard title="Admins" value={summary.adminTotal} helper="Total" />
        </section>

        <section className="mt-6 flex flex-wrap gap-3">
          {tabLabels.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`rounded-full px-5 py-2 text-sm font-semibold transition ${
                activeTab === tab.key ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 shadow-sm hover:bg-slate-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
          <button type="button" onClick={() => void refreshAll()} className={BUTTON_SECONDARY}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </section>

        {activeTab === 'student' ? (
          <div className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            <SectionCard title="Select Students" subtitle="Choose the students who should receive portal access.">
              <div className="grid gap-4 md:grid-cols-4">
                <label className="rounded-2xl border border-slate-200 p-4 text-sm text-slate-700"><input type="radio" checked={studentScope === 'selected'} onChange={() => setStudentScope('selected')} /> <span className="ml-2">Selected Students</span></label>
                <label className="rounded-2xl border border-slate-200 p-4 text-sm text-slate-700"><input type="radio" checked={studentScope === 'batch'} onChange={() => setStudentScope('batch')} /> <span className="ml-2">Batch</span></label>
                <label className="rounded-2xl border border-slate-200 p-4 text-sm text-slate-700"><input type="radio" checked={studentScope === 'class'} onChange={() => setStudentScope('class')} /> <span className="ml-2">Class</span></label>
                <label className="rounded-2xl border border-slate-200 p-4 text-sm text-slate-700"><input type="radio" checked={studentScope === 'school'} onChange={() => setStudentScope('school')} /> <span className="ml-2">Entire School</span></label>
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-3">
                <select value={studentBatchId} onChange={(event) => setStudentBatchId(event.target.value)} className={PANEL_INPUT} disabled={studentScope !== 'batch'}>
                  <option value="">Batch</option>
                  {batches.map((batch) => (
                    <option key={String(batch.id)} value={String(batch.id)}>{batch.name}</option>
                  ))}
                </select>
                <input value={studentClassName} onChange={(event) => setStudentClassName(event.target.value)} className={PANEL_INPUT} placeholder="Class" disabled={studentScope !== 'class'} />
                <input value={studentSearch} onChange={(event) => setStudentSearch(event.target.value)} className={PANEL_INPUT} placeholder="Search Name / Roll Number" />
              </div>
              <div className="mt-5 rounded-3xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">Selected: <span className="font-semibold text-slate-900">{selectedStudentIds.length}</span> Students</div>
              <div className="mt-5">{renderAccountTable(studentRecords, selectedStudentIds, setSelectedStudentIds, 'student')}</div>
            </SectionCard>
            <div className="space-y-6">
              <SectionCard title="Choose Access" subtitle="Student Portal Access">
                <select value={studentTemplateKey} onChange={(event) => setStudentTemplateKey(event.target.value)} className={PANEL_INPUT}>
                  {permissionTemplates.filter((template) => ['student', 'custom'].includes(template.key)).map((template) => (
                    <option key={template.key} value={template.key}>{template.label}</option>
                  ))}
                </select>
                <div className="mt-4 space-y-2">
                  {studentPermissions.map((permission) => (
                    <label key={permission} className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-700">
                      <input type="checkbox" checked={studentPermissions.includes(permission)} onChange={() => togglePermission(permission, studentPermissions, setStudentPermissions)} />
                      {permissionLabel(permission)}
                    </label>
                  ))}
                </div>
              </SectionCard>
              <SectionCard title="Preview" subtitle="Review before generating accounts.">
                <div className="space-y-3 text-sm text-slate-700">
                  <div className="flex items-center justify-between"><span>Students Selected</span><span className="font-semibold text-slate-900">{selectedStudentIds.length || studentRecords.length}</span></div>
                  <div className="flex items-center justify-between"><span>Accounts Already Created</span><span className="font-semibold text-slate-900">{studentPreviewCreated}</span></div>
                  <div className="flex items-center justify-between"><span>New Accounts To Create</span><span className="font-semibold text-slate-900">{studentPreviewPending}</span></div>
                </div>
                <button type="button" onClick={() => void handleStudentGenerate()} disabled={processingKey === 'generate-students'} className={`${BUTTON_PRIMARY} mt-5`}>
                  <Users className="h-4 w-4" />
                  Generate {studentPreviewPending} Accounts
                </button>
              </SectionCard>
            </div>
          </div>
        ) : null}

        {activeTab === 'parent' ? (
          <div className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            <SectionCard title="Generate Linked Parents" subtitle="Choose which parents should receive accounts.">
              <div className="grid gap-4 md:grid-cols-4">
                <label className="rounded-2xl border border-slate-200 p-4 text-sm text-slate-700"><input type="radio" checked={parentScope === 'selected_parents'} onChange={() => setParentScope('selected_parents')} /> <span className="ml-2">Selected Parents</span></label>
                <label className="rounded-2xl border border-slate-200 p-4 text-sm text-slate-700"><input type="radio" checked={parentScope === 'selected_students'} onChange={() => setParentScope('selected_students')} /> <span className="ml-2">Parents of Selected Students</span></label>
                <label className="rounded-2xl border border-slate-200 p-4 text-sm text-slate-700"><input type="radio" checked={parentScope === 'batch'} onChange={() => setParentScope('batch')} /> <span className="ml-2">Batch Parents</span></label>
                <label className="rounded-2xl border border-slate-200 p-4 text-sm text-slate-700"><input type="radio" checked={parentScope === 'school'} onChange={() => setParentScope('school')} /> <span className="ml-2">All Parents</span></label>
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <select value={parentBatchId} onChange={(event) => setParentBatchId(event.target.value)} className={PANEL_INPUT} disabled={parentScope !== 'batch'}>
                  <option value="">Batch</option>
                  {batches.map((batch) => (
                    <option key={String(batch.id)} value={String(batch.id)}>{batch.name}</option>
                  ))}
                </select>
                <input value={parentSearch} onChange={(event) => setParentSearch(event.target.value)} className={PANEL_INPUT} placeholder="Search Parent" />
              </div>
              <div className="mt-5">{renderAccountTable(parentRecords, selectedParentIds, setSelectedParentIds, 'parent')}</div>
            </SectionCard>
            <div className="space-y-6">
              <SectionCard title="Choose Access" subtitle="Permissions">
                <select value={parentTemplateKey} onChange={(event) => setParentTemplateKey(event.target.value)} className={PANEL_INPUT}>
                  {permissionTemplates.filter((template) => ['parent', 'custom'].includes(template.key)).map((template) => (
                    <option key={template.key} value={template.key}>{template.label}</option>
                  ))}
                </select>
                <div className="mt-4 space-y-2">
                  {parentPermissions.map((permission) => (
                    <label key={permission} className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-700">
                      <input type="checkbox" checked={parentPermissions.includes(permission)} onChange={() => togglePermission(permission, parentPermissions, setParentPermissions)} />
                      {permissionLabel(permission)}
                    </label>
                  ))}
                </div>
              </SectionCard>
              <SectionCard title="Preview">
                <button type="button" onClick={() => void handleParentGenerate()} disabled={processingKey === 'generate-parents'} className={BUTTON_PRIMARY}>
                  <Users className="h-4 w-4" />
                  Generate Parent Accounts
                </button>
              </SectionCard>
            </div>
          </div>
        ) : null}

        {activeTab === 'teacher' ? (
          <div className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            <SectionCard title="Teaching Staff" subtitle="Select teaching staff and generate accounts.">
              <input value={teacherSearch} onChange={(event) => setTeacherSearch(event.target.value)} className={PANEL_INPUT} placeholder="Search Teacher" />
              <div className="mt-5">{renderAccountTable(teacherRecords, selectedTeacherIds, setSelectedTeacherIds, 'teacher')}</div>
            </SectionCard>
            <div className="space-y-6">
              <SectionCard title="Teacher Template">
                <select value={teacherTemplateKey} onChange={(event) => setTeacherTemplateKey(event.target.value)} className={PANEL_INPUT}>
                  {permissionTemplates.filter((template) => ['teacher', 'class_teacher', 'academic_coordinator', 'custom'].includes(template.key)).map((template) => (
                    <option key={template.key} value={template.key}>{template.label}</option>
                  ))}
                </select>
                <div className="mt-4 space-y-2">
                  {teacherPermissions.map((permission) => (
                    <label key={permission} className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-700">
                      <input type="checkbox" checked={teacherPermissions.includes(permission)} onChange={() => togglePermission(permission, teacherPermissions, setTeacherPermissions)} />
                      {permissionLabel(permission)}
                    </label>
                  ))}
                </div>
                <button type="button" onClick={() => void handleTeacherGenerate()} disabled={processingKey === 'generate-teachers'} className={`${BUTTON_PRIMARY} mt-5`}>
                  <Users className="h-4 w-4" />
                  Generate Teacher Accounts
                </button>
              </SectionCard>
            </div>
          </div>
        ) : null}

        {activeTab === 'staff' ? (
          <div className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            <SectionCard title="Non-Teaching Staff" subtitle="Choose role and create non-teaching staff accounts.">
              <input value={staffSearch} onChange={(event) => setStaffSearch(event.target.value)} className={PANEL_INPUT} placeholder="Search Staff" />
              <div className="mt-5">{renderAccountTable(staffRecords, selectedStaffIds, setSelectedStaffIds, 'staff')}</div>
            </SectionCard>
            <div className="space-y-6">
              <SectionCard title="Role">
                <select value={staffTemplateKey} onChange={(event) => setStaffTemplateKey(event.target.value)} className={PANEL_INPUT}>
                  {permissionTemplates.filter((template) => ['accountant', 'exam_cell', 'store_manager', 'viewer', 'custom'].includes(template.key)).map((template) => (
                    <option key={template.key} value={template.key}>{template.label}</option>
                  ))}
                </select>
                <div className="mt-4 space-y-2">
                  {staffPermissions.map((permission) => (
                    <label key={permission} className="flex items-center gap-3 rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-700">
                      <input type="checkbox" checked={staffPermissions.includes(permission)} onChange={() => togglePermission(permission, staffPermissions, setStaffPermissions)} />
                      {permissionLabel(permission)}
                    </label>
                  ))}
                </div>
                <button type="button" onClick={() => void handleStaffGenerate()} disabled={processingKey === 'generate-staff'} className={`${BUTTON_PRIMARY} mt-5`}>
                  <Users className="h-4 w-4" />
                  Generate Staff Accounts
                </button>
              </SectionCard>
            </div>
          </div>
        ) : null}

        {activeTab === 'administrator' ? (
          <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_1fr]">
            <SectionCard title="Create Administrator" subtitle="Create a new administrator with the right access.">
              <div className="grid gap-4 md:grid-cols-2">
                <input value={adminName} onChange={(event) => setAdminName(event.target.value)} className={PANEL_INPUT} placeholder="Full name" />
                <input value={adminUsername} onChange={(event) => setAdminUsername(event.target.value)} className={PANEL_INPUT} placeholder="Username" />
                <input value={adminEmail} onChange={(event) => setAdminEmail(event.target.value)} className={PANEL_INPUT} placeholder="Email" />
                <input value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} className={PANEL_INPUT} placeholder="Password" />
              </div>
              <div className="mt-4">
                <select value={adminRoleKey} onChange={(event) => setAdminRoleKey(event.target.value)} className={PANEL_INPUT}>
                  <option value="school_admin">School Admin</option>
                  <option value="platform_admin">Platform Admin</option>
                  <option value="staff">Academic Coordinator</option>
                  <option value="staff">Exam Cell</option>
                  <option value="store_manager">Store Manager</option>
                  <option value="viewer">Viewer</option>
                  <option value="school_admin">Custom Admin</option>
                </select>
              </div>
              <div className="mt-5">
                <PermissionChecklist modules={permissionModules} selected={adminPermissions} onToggle={(permission) => togglePermission(permission, adminPermissions, setAdminPermissions)} />
              </div>
              <button type="button" onClick={() => void handleCreateAdministrator()} disabled={processingKey === 'create-admin'} className={`${BUTTON_PRIMARY} mt-5`}>
                <Shield className="h-4 w-4" />
                Create Administrator
              </button>
            </SectionCard>
            <SectionCard title="Existing Administrators" subtitle="Current administrator accounts in this school.">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold text-slate-600">Name</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-600">Role</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-600">Username</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {adminUsers.map((user) => (
                      <tr key={String(user.id)}>
                        <td className="px-4 py-3 font-semibold text-slate-900">{user.full_name}</td>
                        <td className="px-4 py-3 text-slate-700">{toTitle(user.role)}</td>
                        <td className="px-4 py-3 text-slate-700">{user.username}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          </div>
        ) : null}

        {activeTab === 'credentials' ? (
          <div className="mt-6">
            <SectionCard title="Recently Generated Accounts" subtitle="View credentials that were generated recently.">
              <div className="mb-4 flex flex-wrap gap-3">
                <button type="button" onClick={() => void exportExcel(recentCredentials.map((row) => ({ name: row.entity_name || row.username, role: toTitle(row.role_key), student_name: row.entity_name || row.username, roll_number: row.login_email || row.username, username: row.username, temporary_password: row.temporary_password, created_at: row.created_at })))} className={BUTTON_SECONDARY}>
                  <Download className="h-4 w-4" />
                  Export Excel
                </button>
                <button type="button" onClick={() => exportPdf(recentCredentials)} className={BUTTON_SECONDARY}>
                  <FileText className="h-4 w-4" />
                  Export PDF
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold text-slate-600">Name</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-600">Role</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-600">Username</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-600">Password</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-600">Created</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-600">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {recentCredentials.map((item) => (
                      <tr key={item.id}>
                        <td className="px-4 py-3 font-semibold text-slate-900">{item.entity_name || item.username}</td>
                        <td className="px-4 py-3 text-slate-700">{toTitle(item.role_key)}</td>
                        <td className="px-4 py-3 text-slate-700">{item.username}</td>
                        <td className="px-4 py-3 text-slate-700">{item.temporary_password}</td>
                        <td className="px-4 py-3 text-slate-700">{formatDateTime(item.created_at)}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            <button type="button" onClick={() => void copyToClipboard(item.username, 'Username copied.')} className={BUTTON_SECONDARY}>
                              <Copy className="h-4 w-4" />
                              Copy
                            </button>
                            <button type="button" onClick={() => item.profile_id && void openCredentialDetails(item.profile_id)} className={BUTTON_SECONDARY}>
                              <Eye className="h-4 w-4" />
                              View
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          </div>
        ) : null}

        {activeTab === 'sessions' ? (
          <div className="mt-6">
            <SectionCard title="Active Sessions" subtitle="Monitor user devices and sign out sessions when needed.">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold text-slate-600">Name</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-600">Role</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-600">Device</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-600">Last Activity</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-600">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sessions.map((session) => (
                      <tr key={session.id}>
                        <td className="px-4 py-3 font-semibold text-slate-900">{session.full_name || session.username}</td>
                        <td className="px-4 py-3 text-slate-700">{toTitle(session.role_key)}</td>
                        <td className="px-4 py-3 text-slate-700">{session.device_name || session.browser || 'Unknown device'}</td>
                        <td className="px-4 py-3 text-slate-700">{formatDateTime(session.last_activity)}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-2">
                            <button type="button" onClick={() => void handleSessionAction(session, 'device')} className={BUTTON_SECONDARY}>
                              <LogOut className="h-4 w-4" />
                              Logout Device
                            </button>
                            <button type="button" onClick={() => void handleSessionAction(session, 'all')} className={BUTTON_SECONDARY}>
                              <LogOut className="h-4 w-4" />
                              Logout All Devices
                            </button>
                            <button type="button" onClick={() => void handleSessionAction(session, 'disable')} className={BUTTON_SECONDARY}>
                              <Lock className="h-4 w-4" />
                              Disable Account
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          </div>
        ) : null}

        {activeTab === 'history' ? (
          <div className="mt-6">
            <SectionCard title="Audit Log" subtitle="Track account creation, password reset, disable, enable, and permission changes.">
              <div className="mb-4 max-w-md">
                <input value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} className={PANEL_INPUT} placeholder="Search history" />
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold text-slate-600">User</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-600">Action</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-600">By</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-600">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {history
                      .filter((item) => {
                        if (!historySearch) return true;
                        const haystack = `${item.name} ${item.action} ${item.created_by}`.toLowerCase();
                        return haystack.includes(historySearch.toLowerCase());
                      })
                      .map((item) => (
                        <tr key={item.id}>
                          <td className="px-4 py-3 font-semibold text-slate-900">{item.name}</td>
                          <td className="px-4 py-3 text-slate-700">{item.action}</td>
                          <td className="px-4 py-3 text-slate-700">{item.created_by}</td>
                          <td className="px-4 py-3 text-slate-700">{formatDateTime(item.timestamp)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          </div>
        ) : null}
      </div>

      <Modal open={generatedModalOpen} title="Accounts Generated Successfully" onClose={() => setGeneratedModalOpen(false)}>
        <div className="mb-4 flex flex-wrap gap-3">
          <button type="button" onClick={() => void exportExcel()} className={BUTTON_PRIMARY}>
            <Download className="h-4 w-4" />
            Export Excel
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-slate-600">Name</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600">Role</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600">Username</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-600">Password</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {generatedRows.map((row) => (
                <tr key={`${row.username}-${row.temporary_password}`}>
                  <td className="px-4 py-3 text-slate-700">{row.name || row.student_name}</td>
                  <td className="px-4 py-3 text-slate-700">{row.role || 'User'}</td>
                  <td className="px-4 py-3 font-semibold text-slate-900">{row.username}</td>
                  <td className="px-4 py-3 font-semibold text-slate-900">{row.temporary_password}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Modal>

      <Modal open={Boolean(credentialModal)} title="View Credentials" onClose={() => setCredentialModal(null)}>
        {credentialModal ? (
          <div className="grid gap-5 md:grid-cols-2">
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
              <p className="text-lg font-semibold text-slate-900">{credentialModal.entity_name || credentialModal.username}</p>
              <p className="mt-1 text-sm text-slate-500">{toTitle(credentialModal.role_key)}</p>
              <div className="mt-5 space-y-4 text-sm text-slate-700">
                <div><span className="font-semibold text-slate-900">Username:</span> {credentialModal.username}</div>
                <div><span className="font-semibold text-slate-900">Password:</span> {credentialModal.temporary_password}</div>
                <div><span className="font-semibold text-slate-900">Created:</span> {formatDateTime(credentialModal.created_at)}</div>
                <div><span className="font-semibold text-slate-900">Expires:</span> {formatDateTime(credentialModal.expires_at)}</div>
              </div>
            </div>
            <div className="rounded-3xl border border-slate-200 p-5">
              <p className="text-sm font-semibold text-slate-900">Actions</p>
              <div className="mt-4 flex flex-wrap gap-3">
                <button type="button" onClick={() => void copyToClipboard(credentialModal.username, 'Username copied.')} className={BUTTON_SECONDARY}>
                  <Copy className="h-4 w-4" />
                  Copy Username
                </button>
                <button type="button" onClick={() => void copyToClipboard(credentialModal.temporary_password, 'Password copied.')} className={BUTTON_SECONDARY}>
                  <Copy className="h-4 w-4" />
                  Copy Password
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
