import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Pencil } from 'lucide-react';
import { apiService } from '@services/api';
import { useAuth } from '@/contexts/AuthProvider';
import { useAuthStore } from '@store/auth';
import type { RolePowerUser } from '@types';

type UserRole = 'admin' | 'store_manager' | 'teacher' | 'viewer';
type UserType = 'teaching' | 'non_teaching';

type PowerModule = {
  key: string;
  label: string;
  sections: Array<{ key: string; label: string }>;
};

type UserFormState = {
  username: string;
  password: string;
  full_name: string;
  role: UserRole;
  user_type: UserType;
  permissions: string[];
};

const PASSWORD_CACHE_KEY = 'role_power_plain_passwords';

const POWER_MODULES: PowerModule[] = [
  {
    key: 'admin_office',
    label: 'Admin Office',
    sections: [
      { key: 'admin_office.seating_generation', label: 'Seating Generation' },
      { key: 'admin_office.seating_plans', label: 'Seating Plans' },
      { key: 'admin_office.rooms', label: 'Rooms' },
      { key: 'admin_office.batches', label: 'Batches' },
      { key: 'admin_office.students', label: 'Students' },
      { key: 'admin_office.hostels', label: 'Hostel Management' },
      { key: 'admin_office.teachers', label: 'Teaching Management' },
      { key: 'admin_office.invigilators', label: 'Invigilator Management' },
      { key: 'admin_office.non_teaching', label: 'Non-Teaching Management' },
      { key: 'admin_office.reports', label: 'Reports' },
      { key: 'admin_office.access_control', label: 'Role & Access Control' },
    ],
  },
  {
    key: 'timetable',
    label: 'Timetable',
    sections: [
      { key: 'timetable.view', label: 'View Timetable' },
      { key: 'timetable.manage', label: 'Manage Timetable' },
    ],
  },
  {
    key: 'attendance',
    label: 'Attendance',
    sections: [
      { key: 'attendance.overview', label: 'Overview' },
      { key: 'attendance.student', label: 'Student Attendance' },
      { key: 'attendance.staff', label: 'Staff Attendance' },
      { key: 'attendance.leaves', label: 'Leave Management' },
      { key: 'attendance.reports', label: 'Attendance Reports' },
    ],
  },
  {
    key: 'inventory',
    label: 'Inventory',
    sections: [
      { key: 'inventory.dashboard', label: 'Dashboard' },
      { key: 'inventory.materials', label: 'Material Master' },
      { key: 'inventory.suppliers', label: 'Suppliers' },
      { key: 'inventory.stock_in', label: 'Stock In' },
      { key: 'inventory.stock_out', label: 'Stock Out / Distribution' },
      { key: 'inventory.reports', label: 'Inventory Reports' },
    ],
  },
  {
    key: 'edupay',
    label: 'BRAIN OF HIMACHAL',
    sections: [
      { key: 'edupay.dashboard', label: 'Dashboard' },
      { key: 'edupay.students', label: 'Student Management' },
      { key: 'edupay.fees', label: 'Fee Structures' },
      { key: 'edupay.payments', label: 'Payment Tracking' },
      { key: 'edupay.parent_portal', label: 'Parent Portal' },
    ],
  },
  {
    key: 'settings',
    label: 'Settings',
    sections: [],
  },
];

const POWER_LABELS: Record<string, string> = POWER_MODULES.reduce<Record<string, string>>((acc, module) => {
  acc[module.key] = module.label;
  module.sections.forEach((section) => {
    acc[section.key] = `${module.label} / ${section.label}`;
  });
  return acc;
}, {});

const getNormalizedPermissions = (values: string[]) => {
  const next = new Set(values);

  POWER_MODULES.forEach((module) => {
    const sectionKeys = module.sections.map((section) => section.key);
    if (!sectionKeys.length) return;
    const selectedSectionCount = sectionKeys.filter((key) => next.has(key)).length;
    if (selectedSectionCount > 0 && selectedSectionCount < sectionKeys.length) {
      next.delete(module.key);
    }
  });

  return Array.from(next);
};

const initialForm: UserFormState = {
  username: '',
  password: '',
  full_name: '',
  role: 'teacher',
  user_type: 'teaching',
  permissions: ['timetable'],
};

const toArray = <T,>(value: unknown): T[] => {
  if (Array.isArray(value)) return value as T[];
  if (Array.isArray((value as { data?: unknown } | null)?.data)) {
    return (value as { data: T[] }).data;
  }
  return [];
};

const normalizePermissions = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || '').trim())
      .filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
};

const normalizeRolePowerUser = (value: any): RolePowerUser => ({
  ...value,
  permissions: normalizePermissions(value?.permissions),
});

const getRequestErrorMessage = (error: any, fallback: string) =>
  error?.response?.data?.detail || error?.response?.data?.error || error?.message || fallback;

function loadPasswordCache() {
  const raw = localStorage.getItem(PASSWORD_CACHE_KEY);
  if (!raw) return {} as Record<string, string>;
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {} as Record<string, string>;
  }
}

function savePasswordCache(cache: Record<string, string>) {
  localStorage.setItem(PASSWORD_CACHE_KEY, JSON.stringify(cache));
}

function PermissionEditor({
  permissions,
  onChange,
  expandedModules,
  setExpandedModules,
}: {
  permissions: string[];
  onChange: (permissions: string[]) => void;
  expandedModules: Record<string, boolean>;
  setExpandedModules: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}) {
  const toggleModuleExpansion = (moduleKey: string) => {
    setExpandedModules((prev) => ({ ...prev, [moduleKey]: !prev[moduleKey] }));
  };

  const toggleModulePermission = (module: PowerModule) => {
    const moduleSelected = permissions.includes(module.key);
    const sectionKeys = module.sections.map((item) => item.key);

    if (moduleSelected) {
      onChange(getNormalizedPermissions(permissions.filter((item) => item !== module.key && !sectionKeys.includes(item))));
      return;
    }

    const next = new Set(permissions);
    next.add(module.key);
    sectionKeys.forEach((key) => next.add(key));
    onChange(getNormalizedPermissions(Array.from(next)));
  };

  const toggleSectionPermission = (sectionKey: string) => {
    const exists = permissions.includes(sectionKey);
    const next = new Set(permissions);
    if (exists) {
      next.delete(sectionKey);
    } else {
      next.add(sectionKey);
    }
    onChange(getNormalizedPermissions(Array.from(next)));
  };

  return (
    <div className="rounded-2xl border border-slate-300 p-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Assign Powers</p>
      <div className="mt-3 space-y-3">
        {POWER_MODULES.map((module) => {
          const moduleSelected = permissions.includes(module.key);
          const expanded = expandedModules[module.key] ?? false;
          return (
            <div key={module.key} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between gap-2">
                <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <input
                    type="checkbox"
                    checked={moduleSelected}
                    onChange={() => toggleModulePermission(module)}
                  />
                  {module.label}
                </label>
                {module.sections.length ? (
                  <button
                    type="button"
                    onClick={() => toggleModuleExpansion(module.key)}
                    className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                  >
                    Sections
                    <ChevronDown className={`h-3 w-3 transition ${expanded ? 'rotate-180' : ''}`} />
                  </button>
                ) : null}
              </div>
              {expanded && module.sections.length ? (
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {module.sections.map((section) => (
                    <label key={section.key} className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-xs text-slate-700">
                        <input
                          type="checkbox"
                          checked={permissions.includes(section.key)}
                          onChange={() => toggleSectionPermission(section.key)}
                        />
                      {section.label}
                    </label>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function AccessControl() {
  const { authReady, sessionReady, schoolContextReady, session } = useAuth();
  const user = useAuthStore((state) => state.user);
  const isPlatformAdmin = user?.role_key === 'platform_admin';
  const canRunRequests = authReady && sessionReady && schoolContextReady && !!session;
  const [users, setUsers] = useState<RolePowerUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [createForm, setCreateForm] = useState<UserFormState>(initialForm);
  const [editForm, setEditForm] = useState<UserFormState>(initialForm);
  const [editingUserId, setEditingUserId] = useState<string | number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedCreateModules, setExpandedCreateModules] = useState<Record<string, boolean>>({
    timetable: true,
    attendance: true,
  });
  const [expandedEditModules, setExpandedEditModules] = useState<Record<string, boolean>>({
    timetable: true,
    attendance: true,
  });
  const [passwordCache, setPasswordCache] = useState<Record<string, string>>(() => loadPasswordCache());

  const syncPasswordCache = (fetchedUsers: RolePowerUser[]) => {
    const nextCache = { ...passwordCache };
    fetchedUsers.forEach((item) => {
      const key = (item.username || '').toLowerCase();
      if (!key) return;
      if (item.password && item.password.trim()) {
        nextCache[key] = item.password;
      }
    });
    setPasswordCache(nextCache);
    savePasswordCache(nextCache);
  };

  const upsertUser = (user: RolePowerUser) => {
    setUsers((current) => {
      const nextUsers = [
        normalizeRolePowerUser(user),
        ...current.filter((item) => item.id !== user.id),
      ];
      syncPasswordCache(nextUsers);
      return nextUsers;
    });
  };

  const loadUsers = async () => {
    if (!canRunRequests) return;
    setLoading(true);
    try {
      const response = await apiService.listRoleUsers();
      const fetchedUsers = toArray<any>(response?.data).map(normalizeRolePowerUser);
      setUsers(fetchedUsers);
      syncPasswordCache(fetchedUsers);
      setError(null);
    } catch (requestError: any) {
      setError(getRequestErrorMessage(requestError, 'Failed to load users'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!canRunRequests) return;
    void loadUsers();
  }, [canRunRequests]);

  const handleCreateUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const response = await apiService.createRoleUser(createForm);
      upsertUser(response.data);
      const next = { ...passwordCache, [createForm.username.toLowerCase()]: createForm.password };
      setPasswordCache(next);
      savePasswordCache(next);
      setCreateForm(initialForm);
      setError(null);
    } catch (requestError: any) {
      setError(getRequestErrorMessage(requestError, 'Failed to create user'));
    }
  };

  const startEdit = (user: RolePowerUser) => {
    setEditingUserId(user.id);
    setEditForm({
      username: user.username || '',
      password: passwordCache[(user.username || '').toLowerCase()] || '',
      full_name: user.full_name,
      role: user.role as UserRole,
      user_type: user.user_type as UserType,
      permissions: normalizePermissions(user.permissions),
    });
  };

  const cancelEdit = () => {
    setEditingUserId(null);
    setEditForm(initialForm);
  };

  const handleSaveEdit = async (event: FormEvent<HTMLFormElement>, user: RolePowerUser) => {
    event.preventDefault();
    try {
      const response = await apiService.updateRoleUser(user.id, {
        full_name: editForm.full_name,
        role: editForm.role,
        user_type: editForm.user_type,
        permissions: editForm.permissions,
        password: editForm.password || undefined,
      });

      if (editForm.password && editForm.username) {
        const next = { ...passwordCache, [editForm.username.toLowerCase()]: editForm.password };
        setPasswordCache(next);
        savePasswordCache(next);
      }

      upsertUser(response.data);
      cancelEdit();
      setError(null);
    } catch (requestError: any) {
      setError(getRequestErrorMessage(requestError, 'Failed to update user'));
    }
  };

  const handleToggleStatus = async (user: RolePowerUser) => {
    try {
      const response = await apiService.updateRoleUser(user.id, { is_active: !user.is_active });
      upsertUser(response.data);
      setError(null);
    } catch (requestError: any) {
      setError(getRequestErrorMessage(requestError, 'Failed to update user'));
    }
  };

  const handleDelete = async (user: RolePowerUser) => {
    if (!window.confirm(`Delete user "${user.username}"?`)) return;
    try {
      await apiService.deleteRoleUser(user.id);
      setUsers((current) => current.filter((item) => item.id !== user.id));
      setError(null);
    } catch (requestError: any) {
      setError(getRequestErrorMessage(requestError, 'Failed to delete user'));
    }
  };

  const userPermissionLabels = useMemo(() => {
    return (values: unknown) =>
      normalizePermissions(values).map((item) => POWER_LABELS[item] || item).join(', ') || 'none';
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-7xl">
        <section className="rounded-3xl bg-white p-6 shadow-sm">
          <h1 className="text-3xl font-bold text-slate-900">Role & Power Admin Panel</h1>
          <p className="mt-2 text-sm text-slate-600">
            User Access List se username, role aur powers edit kar sakte ho. Password ab plain form me store nahi hoga.
          </p>
        </section>

        {isPlatformAdmin ? (
          <section className="mt-4 rounded-3xl border border-sky-200 bg-sky-50 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.22em] text-sky-700">Platform Navigation</p>
                <p className="mt-1 text-sm text-slate-600">Workflow approvals aur platform overview ke quick links.</p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Link to="/platform/dashboard" className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50">
                  Platform Dashboard
                </Link>
                <Link to="/platform/workflow" className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
                  Workflow Queue
                </Link>
              </div>
            </div>
          </section>
        ) : null}

        {error ? (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
        ) : null}

        <section className="mt-6 grid gap-6 xl:grid-cols-[1fr_1fr]">
          <form onSubmit={handleCreateUser} className="rounded-3xl bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-slate-900">Create User</h2>
            <div className="mt-4 grid gap-3">
              <input
                value={createForm.username}
                onChange={(event) => setCreateForm({ ...createForm, username: event.target.value })}
                placeholder="Username"
                className="rounded-2xl border border-slate-300 px-4 py-3 text-sm"
                required
              />
              <input
                value={createForm.password}
                onChange={(event) => setCreateForm({ ...createForm, password: event.target.value })}
                placeholder="Password"
                type="text"
                className="rounded-2xl border border-slate-300 px-4 py-3 text-sm"
                required
              />
              <input
                value={createForm.full_name}
                onChange={(event) => setCreateForm({ ...createForm, full_name: event.target.value })}
                placeholder="Full name"
                className="rounded-2xl border border-slate-300 px-4 py-3 text-sm"
                required
              />
              <div className="grid gap-3 md:grid-cols-2">
                <select
                  value={createForm.user_type}
                  onChange={(event) => setCreateForm({ ...createForm, user_type: event.target.value as UserType })}
                  className="rounded-2xl border border-slate-300 px-4 py-3 text-sm"
                >
                  <option value="teaching">Teaching</option>
                  <option value="non_teaching">Non-Teaching</option>
                </select>
                <select
                  value={createForm.role}
                  onChange={(event) => setCreateForm({ ...createForm, role: event.target.value as UserRole })}
                  className="rounded-2xl border border-slate-300 px-4 py-3 text-sm"
                >
                  <option value="teacher">Teacher</option>
                  <option value="viewer">Viewer</option>
                  <option value="store_manager">Store Manager</option>
                  <option value="admin">Admin</option>
                </select>
              </div>

              <PermissionEditor
                permissions={createForm.permissions}
                onChange={(permissions) => setCreateForm({ ...createForm, permissions })}
                expandedModules={expandedCreateModules}
                setExpandedModules={setExpandedCreateModules}
              />

              <button className="rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800">
                Create User
              </button>
            </div>
          </form>

          <div className="rounded-3xl bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-slate-900">User Access List</h2>
            {loading ? <p className="mt-4 text-sm text-slate-500">Loading users...</p> : null}
            <div className="mt-4 space-y-3">
              {users.map((user) => {
                const isEditing = editingUserId === user.id;
                const cachedPassword = user.password || passwordCache[(user.username || '').toLowerCase()] || '';
                return (
                  <div key={user.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    {!isEditing ? (
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="font-semibold text-slate-900">{user.full_name} ({user.username})</p>
                          <p className="text-xs text-slate-600">user: {user.username || '-'} | password: {cachedPassword ? 'available in this browser session only' : 'not shown for security'}</p>
                          <p className="text-xs text-slate-600">
                            {user.user_type} | role: {user.role}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            powers: {userPermissionLabels(user.permissions || [])}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => startEdit(user)}
                            className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-3 py-1.5 text-xs font-semibold text-sky-700"
                          >
                            <Pencil className="h-3 w-3" />
                            Edit
                          </button>
                          <button
                            onClick={() => handleToggleStatus(user)}
                            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                              user.is_active ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                            }`}
                          >
                            {user.is_active ? 'Disable' : 'Enable'}
                          </button>
                          {user.username !== 'admin' ? (
                            <button
                              onClick={() => handleDelete(user)}
                              className="rounded-full bg-rose-100 px-3 py-1.5 text-xs font-semibold text-rose-700"
                            >
                              Delete
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ) : (
                      <form onSubmit={(event) => handleSaveEdit(event, user)} className="space-y-3">
                        <h3 className="text-sm font-semibold text-slate-900">Edit User: {user.username}</h3>
                        <input
                          value={editForm.full_name}
                          onChange={(event) => setEditForm({ ...editForm, full_name: event.target.value })}
                          placeholder="Full name"
                          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                          required
                        />
                        <input
                          value={editForm.username}
                          disabled
                          className="w-full rounded-xl border border-slate-300 bg-slate-100 px-3 py-2 text-sm"
                        />
                        <input
                          value={editForm.password}
                          onChange={(event) => setEditForm({ ...editForm, password: event.target.value })}
                          placeholder="New password (leave blank to keep current)"
                          type="text"
                          className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                        />
                        <div className="grid gap-3 md:grid-cols-2">
                          <select
                            value={editForm.user_type}
                            onChange={(event) => setEditForm({ ...editForm, user_type: event.target.value as UserType })}
                            className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                          >
                            <option value="teaching">Teaching</option>
                            <option value="non_teaching">Non-Teaching</option>
                          </select>
                          <select
                            value={editForm.role}
                            onChange={(event) => setEditForm({ ...editForm, role: event.target.value as UserRole })}
                            className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                          >
                            <option value="teacher">Teacher</option>
                            <option value="viewer">Viewer</option>
                            <option value="store_manager">Store Manager</option>
                            <option value="admin">Admin</option>
                          </select>
                        </div>

                        <PermissionEditor
                          permissions={editForm.permissions}
                          onChange={(permissions) => setEditForm({ ...editForm, permissions })}
                          expandedModules={expandedEditModules}
                          setExpandedModules={setExpandedEditModules}
                        />

                        <div className="flex gap-2">
                          <button className="rounded-full bg-slate-900 px-4 py-2 text-xs font-semibold text-white">
                            Save Changes
                          </button>
                          <button
                            type="button"
                            onClick={cancelEdit}
                            className="rounded-full bg-slate-200 px-4 py-2 text-xs font-semibold text-slate-700"
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
