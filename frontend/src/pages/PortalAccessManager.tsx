import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Copy, Download, Eye, FileText, KeyRound, Lock, LogOut, Pencil, Plus, RefreshCw, Search, Shield, Users, X } from 'lucide-react';

import { apiService, getRequestErrorMessage } from '@services/api';
import { useAuthStore } from '@store/auth';
import { usePlatformAdminSchoolStore } from '@store/platformAdminSchool';
import type {
  AccountHistoryItem,
  ActiveSessionRecord,
  AdministratorOverviewResponse,
  Batch,
  BulkPortalCredentialRow,
  GeneratedCredentialRecord,
  PortalOverviewRecord,
  PortalOverviewResponse,
  PortalPermissionGroup,
  PortalPermissionSummary,
  PortalPermissionTemplate,
  RolePowerUser,
} from '@types';

type TabKey = 'student' | 'parent' | 'teacher' | 'staff' | 'administrator' | 'credentials' | 'sessions' | 'history';
type PermissionModule = { key: string; label: string; sections: Array<{ key: string; label: string }> };
type ScopeValue = 'selected' | 'batch' | 'class' | 'school';
type ParentScopeValue = 'selected_parents' | 'selected_students' | 'batch' | 'school';
type PermissionScopeValue = 'own' | 'assigned' | 'school' | 'platform';

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

const adminRoleLabel = (role?: string | null) => {
  const r = String(role || '').toLowerCase();
  if (r === 'platform_admin') return 'Platform Administrator';
  if (r === 'school_admin') return 'School Administrator';
  return toTitle(role);
};

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

const buildPermissionGroups = (
  modules: PermissionModule[],
  grantedPermissions: string[],
  templatePermissions: string[] = grantedPermissions,
): PortalPermissionGroup[] => {
  const granted = new Set(grantedPermissions);
  const template = new Set(templatePermissions);
  return modules
    .map((module) => {
      const permissions = [
        {
          key: module.key,
          label: module.label,
          granted: granted.has(module.key),
          from_template: template.has(module.key),
          manually_added: granted.has(module.key) && !template.has(module.key),
          manually_removed: !granted.has(module.key) && template.has(module.key),
        },
        ...module.sections.map((section) => ({
          key: section.key,
          label: section.label,
          granted: granted.has(section.key),
          from_template: template.has(section.key),
          manually_added: granted.has(section.key) && !template.has(section.key),
          manually_removed: !granted.has(section.key) && template.has(section.key),
        })),
      ];
      return {
        key: module.key,
        label: module.label,
        count: permissions.filter((item) => item.granted).length,
        permissions,
      };
    })
    .filter(Boolean) as PortalPermissionGroup[];
};

const getAllPermissionKeys = (modules: PermissionModule[]) =>
  modules.flatMap((module) => [module.key, ...module.sections.map((section) => section.key)]);

const permissionScopeOptions: PermissionScopeValue[] = ['own', 'assigned', 'school', 'platform'];

const defaultScopeForRole = (role: string): PermissionScopeValue => {
  const normalized = String(role || '').trim().toLowerCase();
  if (normalized === 'platform_admin') return 'platform';
  if (normalized === 'student' || normalized === 'parent') return 'own';
  if (normalized === 'teacher' || normalized === 'staff' || normalized === 'viewer' || normalized === 'store_manager') return 'assigned';
  return 'school';
};

const normalizeScopeAssignments = (
  permissions: string[],
  selectedRole: string,
  rawAssignments?: Record<string, string>,
): Record<string, PermissionScopeValue> => {
  const fallback = defaultScopeForRole(selectedRole);
  const result: Record<string, PermissionScopeValue> = {};
  permissions.forEach((permission) => {
    const value = rawAssignments?.[permission];
    result[permission] = permissionScopeOptions.includes(value as PermissionScopeValue) ? (value as PermissionScopeValue) : fallback;
  });
  return result;
};

const buildPermissionCatalogGroups = (
  modules: PermissionModule[],
  selectedPermissions: string[],
  templatePermissions: string[] = [],
): PortalPermissionGroup[] => {
  const selected = new Set(selectedPermissions);
  const template = new Set(templatePermissions);
  return modules.map((module) => {
    const moduleIncluded = selected.has(module.key);
    const moduleFromTemplate = template.has(module.key);
    return {
      key: module.key,
      label: module.label,
      count: [module.key, ...module.sections.map((section) => section.key)].filter((key) => selected.has(key)).length,
      permissions: [
        {
          key: module.key,
          label: module.label,
          granted: moduleIncluded,
          from_template: moduleFromTemplate,
          manually_added: moduleIncluded && !moduleFromTemplate,
          manually_removed: !moduleIncluded && moduleFromTemplate,
        },
        ...module.sections.map((section) => ({
          key: section.key,
          label: section.label,
          granted: selected.has(section.key),
          from_template: template.has(section.key),
          manually_added: selected.has(section.key) && !template.has(section.key),
          manually_removed: !selected.has(section.key) && template.has(section.key),
        })),
      ],
    };
  });
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

function Modal({
  open,
  title,
  onClose,
  children,
  sizeClassName = 'max-w-4xl',
  panelClassName = '',
  contentClassName = '',
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  sizeClassName?: string;
  panelClassName?: string;
  contentClassName?: string;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/45 px-4 py-4">
      <div className={`mx-auto flex min-h-full items-center justify-center ${sizeClassName}`}>
        <div className={`flex w-full flex-col rounded-[2rem] bg-white p-6 shadow-2xl ${panelClassName}`}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-sky-700">User Account & Access Center</p>
              <h3 className="mt-1 text-2xl font-bold text-slate-900">{title}</h3>
            </div>
            <button type="button" onClick={onClose} className={BUTTON_SECONDARY}>
              Close
            </button>
          </div>
          <div className={`mt-6 ${contentClassName}`}>{children}</div>
        </div>
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

function Drawer({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/45">
      <div className="h-full w-full max-w-2xl overflow-y-auto bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-sky-700">Portal Account Details</p>
            <h3 className="mt-1 text-2xl font-bold text-slate-900">{title}</h3>
          </div>
          <button type="button" onClick={onClose} className={BUTTON_SECONDARY}>Close</button>
        </div>
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}

function PermissionGroupList({
  groups,
  search,
  expanded,
  onToggleGroup,
  editable = false,
  selectedPermissions = [],
  onTogglePermission,
}: {
  groups: PortalPermissionGroup[];
  search: string;
  expanded: Record<string, boolean>;
  onToggleGroup: (key: string) => void;
  editable?: boolean;
  selectedPermissions?: string[];
  onTogglePermission?: (permissionKey: string) => void;
}) {
  const normalizedSearch = search.trim().toLowerCase();
  const filteredGroups = groups
    .map((group) => ({
      ...group,
      permissions: group.permissions.filter((permission) => {
        if (!normalizedSearch) return true;
        return `${group.label} ${permission.label} ${permission.key}`.toLowerCase().includes(normalizedSearch);
      }),
    }))
    .filter((group) => group.permissions.length > 0);

  return (
    <div className="space-y-3">
      {filteredGroups.map((group) => (
        <div key={group.key} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
          <button type="button" onClick={() => onToggleGroup(group.key)} className="flex w-full items-center justify-between gap-3 text-left">
            <div>
              <p className="text-sm font-semibold text-slate-900">{group.label}</p>
              <p className="text-xs text-slate-500">{group.count} granted</p>
            </div>
            <ChevronDown className={`h-4 w-4 text-slate-500 transition ${expanded[group.key] ? 'rotate-180' : ''}`} />
          </button>
          {expanded[group.key] ? (
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {group.permissions.map((permission) => {
                const checked = editable ? selectedPermissions.includes(permission.key) : permission.granted;
                return (
                  <label key={permission.key} className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700">
                    <div className="flex items-start gap-3">
                      {editable ? (
                        <input type="checkbox" checked={checked} onChange={() => onTogglePermission?.(permission.key)} className="mt-1" />
                      ) : (
                        <span className={`mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full ${permission.granted ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>
                          {permission.granted ? <Check className="h-3.5 w-3.5" /> : null}
                        </span>
                      )}
                      <div className="min-w-0">
                        <p className="font-medium text-slate-900">{permission.label}</p>
                        <div className="mt-1 flex flex-wrap gap-2 text-[11px]">
                          {permission.from_template ? <span className="rounded-full bg-sky-100 px-2 py-1 text-sky-700">Template</span> : null}
                          {permission.manually_added ? <span className="rounded-full bg-emerald-100 px-2 py-1 text-emerald-700">Manual Add</span> : null}
                          {permission.manually_removed ? <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-700">Manual Remove</span> : null}
                        </div>
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function TemplatePreviewCard({
  title,
  permissions,
  modules,
  onViewFull,
}: {
  title: string;
  permissions: string[];
  modules: PermissionModule[];
  onViewFull: () => void;
}) {
  const groups = useMemo(() => buildPermissionGroups(modules, permissions), [modules, permissions]);
  return (
    <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-lg font-semibold text-slate-900">{title}</p>
      <p className="mt-3 text-sm font-semibold text-slate-700">Permissions Included:</p>
      <div className="mt-3 space-y-2 text-sm text-slate-700">
        {groups.map((group) => (
          <div key={group.key} className="flex items-center justify-between rounded-2xl bg-white px-3 py-2">
            <span>{group.label}</span>
            <span className="font-semibold text-slate-900">({group.count})</span>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between rounded-2xl bg-white px-4 py-3 text-sm">
        <span className="text-slate-600">Total Permissions</span>
        <span className="font-semibold text-slate-900">{permissions.length}</span>
      </div>
      <button type="button" onClick={onViewFull} className={`${BUTTON_SECONDARY} mt-4`}>
        <Eye className="h-4 w-4" />
        View Full Template
      </button>
    </div>
  );
}

function RbacPermissionEditor({
  modules,
  selectedPermissions,
  templatePermissions,
  scopeAssignments,
  selectedRole,
  search,
  onSearchChange,
  expanded,
  onToggleGroup,
  onTogglePermission,
  onChangePermissionScope,
  onSelectAll,
  onDeselectAll,
  onResetToTemplate,
  onSave,
  onClose,
  saving,
  templateLabel,
}: {
  modules: PermissionModule[];
  selectedPermissions: string[];
  templatePermissions: string[];
  scopeAssignments: Record<string, PermissionScopeValue>;
  selectedRole: string;
  search: string;
  onSearchChange: (value: string) => void;
  expanded: Record<string, boolean>;
  onToggleGroup: (key: string) => void;
  onTogglePermission: (permissionKey: string) => void;
  onChangePermissionScope: (permissionKey: string, scope: PermissionScopeValue) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onResetToTemplate: () => void;
  onSave: () => void;
  onClose: () => void;
  saving: boolean;
  templateLabel: string;
}) {
  const catalogGroups = useMemo(
    () => buildPermissionCatalogGroups(modules, selectedPermissions, templatePermissions),
    [modules, selectedPermissions, templatePermissions],
  );
  const selectedGroups = useMemo(
    () => buildPermissionGroups(modules, selectedPermissions, templatePermissions),
    [modules, selectedPermissions, templatePermissions],
  );
  const selectedScopeBadges = useMemo(() => {
    const counts: Record<PermissionScopeValue, number> = { own: 0, assigned: 0, school: 0, platform: 0 };
    selectedPermissions.forEach((permission) => {
      const scope = scopeAssignments[permission] || defaultScopeForRole(selectedRole);
      counts[scope] += 1;
    });
    return counts;
  }, [scopeAssignments, selectedPermissions, selectedRole]);
  const normalizedSearch = search.trim().toLowerCase();
  const filteredCatalogGroups = useMemo(
    () =>
      catalogGroups
        .map((group) => ({
          ...group,
          permissions: group.permissions.filter((permission) => {
            if (!normalizedSearch) return true;
            return `${group.label} ${permission.label} ${permission.key}`.toLowerCase().includes(normalizedSearch);
          }),
        }))
        .filter((group) => group.permissions.length > 0),
    [catalogGroups, normalizedSearch],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[2rem] border border-slate-200 bg-slate-50">
      <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-6 py-5 backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-slate-900">Permission Editor</p>
            <p className="mt-1 text-sm text-slate-500">Browse the full RBAC catalog, review role-derived powers, and apply manual overrides without leaving the current manager.</p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-sky-100 px-3 py-1 font-semibold text-sky-700">Role: {templateLabel}</span>
            <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold text-slate-700">Assigned: {selectedPermissions.length}</span>
            <span className="rounded-full bg-emerald-100 px-3 py-1 font-semibold text-emerald-700">Manual Adds: {selectedPermissions.filter((item) => !templatePermissions.includes(item)).length}</span>
            <span className="rounded-full bg-amber-100 px-3 py-1 font-semibold text-amber-700">Removed Overrides: {templatePermissions.filter((item) => !selectedPermissions.includes(item)).length}</span>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" onClick={onSelectAll} className={BUTTON_SECONDARY}>Select All</button>
          <button type="button" onClick={onDeselectAll} className={BUTTON_SECONDARY}>Deselect All</button>
          <button type="button" onClick={onResetToTemplate} className={BUTTON_SECONDARY}>Reset To Template</button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="grid min-h-full gap-5 xl:grid-cols-[1.3fr_0.7fr]">
          <div className="rounded-[1.75rem] border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">Permission Catalog</p>
                <p className="text-xs text-slate-500">Every module and action is available here, not just the ones already assigned.</p>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{filteredCatalogGroups.length} modules</span>
            </div>
            <div className="mt-4 space-y-3">
              {filteredCatalogGroups.map((group) => (
                <div key={group.key} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                  <button type="button" onClick={() => onToggleGroup(group.key)} className="flex w-full items-center justify-between gap-3 text-left">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{group.label}</p>
                      <p className="text-xs text-slate-500">{group.permissions.filter((permission) => permission.granted).length} selected</p>
                    </div>
                    <ChevronDown className={`h-4 w-4 text-slate-500 transition ${expanded[group.key] ? 'rotate-180' : ''}`} />
                  </button>
                  {expanded[group.key] ? (
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      {group.permissions.map((permission) => {
                        const isSelected = selectedPermissions.includes(permission.key);
                        return (
                          <div key={permission.key} className="rounded-2xl border border-slate-200 bg-white px-3 py-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="font-medium text-slate-900">{permission.label}</p>
                                <p className="mt-1 text-xs text-slate-500">{permission.key}</p>
                                <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                                  {permission.from_template ? <span className="rounded-full bg-sky-100 px-2 py-1 text-sky-700">Role</span> : null}
                                  {permission.manually_added ? <span className="rounded-full bg-emerald-100 px-2 py-1 text-emerald-700">Manual</span> : null}
                                  {permission.manually_removed ? <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-700">Removed Override</span> : null}
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => onTogglePermission(permission.key)}
                                className={`inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-2 text-xs font-semibold transition ${
                                  isSelected
                                    ? 'border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
                                    : 'border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                                }`}
                              >
                                {isSelected ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                                {isSelected ? 'Remove' : 'Add Permission'}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[1.75rem] border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">Assigned Access</p>
                <p className="text-xs text-slate-500">Selected powers, grouped by module with source badges and scope assignment.</p>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{selectedPermissions.length} permissions</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
              {permissionScopeOptions.map((scope) => (
                <span key={scope} className="rounded-full bg-slate-100 px-2 py-1 font-semibold text-slate-700">
                  {toTitle(scope)}: {selectedScopeBadges[scope]}
                </span>
              ))}
            </div>
            <div className="mt-4">
              {selectedGroups.length ? (
                <div className="space-y-3">
                  {selectedGroups
                    .map((group) => ({
                      ...group,
                      permissions: group.permissions.filter((permission) => {
                        if (!normalizedSearch) return true;
                        return `${group.label} ${permission.label} ${permission.key}`.toLowerCase().includes(normalizedSearch);
                      }),
                    }))
                    .filter((group) => group.permissions.length > 0)
                    .map((group) => (
                      <div key={group.key} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                        <button type="button" onClick={() => onToggleGroup(group.key)} className="flex w-full items-center justify-between gap-3 text-left">
                          <div>
                            <p className="text-sm font-semibold text-slate-900">{group.label}</p>
                            <p className="text-xs text-slate-500">{group.count} selected</p>
                          </div>
                          <ChevronDown className={`h-4 w-4 text-slate-500 transition ${expanded[group.key] ? 'rotate-180' : ''}`} />
                        </button>
                        {expanded[group.key] ? (
                          <div className="mt-3 space-y-2">
                            {group.permissions.map((permission) => (
                              <div key={permission.key} className="rounded-2xl border border-slate-200 bg-white px-3 py-3">
                                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                  <div className="min-w-0">
                                    <p className="font-medium text-slate-900">{permission.label}</p>
                                    <p className="mt-1 text-xs text-slate-500">{permission.key}</p>
                                    <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                                      {permission.from_template ? <span className="rounded-full bg-sky-100 px-2 py-1 text-sky-700">Role</span> : null}
                                      {permission.manually_added ? <span className="rounded-full bg-emerald-100 px-2 py-1 text-emerald-700">Manual</span> : null}
                                      {permission.manually_removed ? <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-700">Removed Override</span> : null}
                                    </div>
                                  </div>
                                  <div className="flex w-full flex-col gap-2 lg:w-44">
                                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Scope</label>
                                    <select
                                      value={scopeAssignments[permission.key] || defaultScopeForRole(selectedRole)}
                                      onChange={(event) => onChangePermissionScope(permission.key, event.target.value as PermissionScopeValue)}
                                      className="w-full rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-slate-900 focus:ring-4 focus:ring-slate-200/60"
                                    >
                                      {permissionScopeOptions.map((scope) => (
                                        <option key={scope} value={scope}>{toTitle(scope)}</option>
                                      ))}
                                    </select>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ))}
                </div>
              ) : (
                <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                  No permissions selected. Use the catalog to add powers.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="sticky bottom-0 z-20 border-t border-slate-200 bg-white/95 px-6 py-4 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="relative w-full max-w-md">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              className={`${PANEL_INPUT} pl-11`}
              placeholder="Search permissions, modules, or keys"
            />
          </div>
          <div className="flex flex-wrap justify-end gap-3">
            <button type="button" onClick={onClose} className={BUTTON_SECONDARY}>Cancel</button>
            <button type="button" onClick={onSave} disabled={saving} className={BUTTON_PRIMARY}>Save Changes</button>
          </div>
        </div>
      </div>
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
  const [adminOverview, setAdminOverview] = useState<AdministratorOverviewResponse | null>(null);
  const [recentCredentials, setRecentCredentials] = useState<GeneratedCredentialRecord[]>([]);
  const [history, setHistory] = useState<AccountHistoryItem[]>([]);
  const [sessions, setSessions] = useState<ActiveSessionRecord[]>([]);
  const [generatedRows, setGeneratedRows] = useState<BulkPortalCredentialRow[]>([]);
  const [generatedModalOpen, setGeneratedModalOpen] = useState(false);
  const [credentialModal, setCredentialModal] = useState<GeneratedCredentialRecord | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<PortalOverviewRecord | null>(null);
  const [accountSummary, setAccountSummary] = useState<PortalPermissionSummary | null>(null);
  const [accountHistory, setAccountHistory] = useState<AccountHistoryItem[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [viewPowersOpen, setViewPowersOpen] = useState(false);
  const [editPowersOpen, setEditPowersOpen] = useState(false);
  const [permissionSearch, setPermissionSearch] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [editTemplateKey, setEditTemplateKey] = useState('custom');
  const [editSelectedRole, setEditSelectedRole] = useState('viewer');
  const [editPermissions, setEditPermissions] = useState<string[]>([]);
  const [editScopeAssignments, setEditScopeAssignments] = useState<Record<string, PermissionScopeValue>>({});
  const [templatePreviewTitle, setTemplatePreviewTitle] = useState<string | null>(null);
  const [templatePreviewGroups, setTemplatePreviewGroups] = useState<PortalPermissionGroup[]>([]);
  const [templatePreviewCount, setTemplatePreviewCount] = useState(0);

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
  const [adminPermissions, setAdminPermissions] = useState<string[]>([]);
  const [historySearch, setHistorySearch] = useState('');
  const [loading, setLoading] = useState(true);
  const loadedTabsRef = useRef<Partial<Record<TabKey, boolean>>>({});

  const currentUser = useAuthStore((state) => state.user);
  const { activeSchoolId, activeSchoolName } = usePlatformAdminSchoolStore();
  const isPlatformWorkspace = Boolean(currentUser?.role_key === 'platform_admin' && !activeSchoolId);

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

  useEffect(() => {
    if (!editPowersOpen) return;
    setPermissionSearch('');
    setExpandedGroups(Object.fromEntries(permissionModules.map((module) => [module.key, false])));
  }, [editPowersOpen, permissionModules]);

  const loadSharedData = useCallback(async () => {
    const [batchesRes, templatesRes, permissionsRes] = await Promise.all([
      apiService.listBatches(),
      apiService.getPortalPermissionTemplates(),
      apiService.listPermissions(),
    ]);
    setBatches(Array.isArray(batchesRes.data) ? batchesRes.data : []);
    setPermissionTemplates(Array.isArray(templatesRes.data) ? templatesRes.data : []);
    setPermissionModules(Array.isArray(permissionsRes.data) ? permissionsRes.data : []);
  }, []);

  const loadStudentOverview = useCallback(async () => {
    const response = await apiService.getPortalOverview({ entity_type: 'student', limit: 25, offset: 0 });
    setStudentOverview(response.data);
    loadedTabsRef.current.student = true;
  }, []);

  const loadParentOverview = useCallback(async () => {
    const response = await apiService.getPortalOverview({ entity_type: 'parent', limit: 25, offset: 0 });
    setParentOverview(response.data);
    loadedTabsRef.current.parent = true;
  }, []);

  const loadTeacherOverview = useCallback(async () => {
    const response = await apiService.getPortalOverview({ entity_type: 'staff', staff_type: normalizeStaffType('teacher'), limit: 25, offset: 0 });
    setTeacherOverview(response.data);
    loadedTabsRef.current.teacher = true;
  }, []);

  const loadStaffOverview = useCallback(async () => {
    const response = await apiService.getPortalOverview({ entity_type: 'staff', staff_type: normalizeStaffType('non_teaching'), limit: 25, offset: 0 });
    setStaffOverview(response.data);
    loadedTabsRef.current.staff = true;
  }, []);

  const loadAdminOverview = useCallback(async () => {
    const response = await apiService.listAdministratorUsers();
    setAdminOverview(response.data);
    loadedTabsRef.current.administrator = true;
  }, []);

  const loadCredentials = useCallback(async () => {
    const response = await apiService.listRecentGeneratedCredentials({ limit: 50 });
    setRecentCredentials(Array.isArray(response.data) ? response.data : []);
    loadedTabsRef.current.credentials = true;
  }, []);

  const loadHistory = useCallback(async () => {
    const response = await apiService.getAccountHistory({ limit: 50, offset: 0 });
    setHistory(response.data.items || []);
    loadedTabsRef.current.history = true;
  }, []);

  const loadSessions = useCallback(async () => {
    const response = await apiService.listSecuritySessions();
    setSessions(Array.isArray(response.data) ? response.data : []);
    loadedTabsRef.current.sessions = true;
  }, []);

  const loadTabData = useCallback(async (tab: TabKey, force = false) => {
    if (!force && loadedTabsRef.current[tab]) return;
    if (tab === 'student') return loadStudentOverview();
    if (tab === 'parent') return loadParentOverview();
    if (tab === 'teacher') return loadTeacherOverview();
    if (tab === 'staff') return loadStaffOverview();
    if (tab === 'administrator') return loadAdminOverview();
    if (tab === 'credentials') return loadCredentials();
    if (tab === 'sessions') return loadSessions();
    if (tab === 'history') return loadHistory();
  }, [loadAdminOverview, loadCredentials, loadHistory, loadParentOverview, loadSessions, loadStaffOverview, loadStudentOverview, loadTeacherOverview]);

  const warmSummaryData = useCallback(() => {
    void Promise.allSettled([
      loadedTabsRef.current.parent ? Promise.resolve() : loadParentOverview(),
      loadedTabsRef.current.teacher ? Promise.resolve() : loadTeacherOverview(),
      loadedTabsRef.current.staff ? Promise.resolve() : loadStaffOverview(),
      loadedTabsRef.current.administrator ? Promise.resolve() : loadAdminOverview(),
    ]);
  }, [loadAdminOverview, loadParentOverview, loadStaffOverview, loadTeacherOverview]);

  const refreshAll = useCallback(async () => {
    try {
      setError(null);
      setLoading(true);
      await loadSharedData();
      await loadTabData(activeTab, true);
      if (activeTab !== 'student') {
        await loadStudentOverview();
      }
      warmSummaryData();
    } catch (requestError: any) {
      setError(getRequestErrorMessage(requestError, 'Failed to load access center.'));
    } finally {
      setLoading(false);
    }
  }, [activeTab, loadSharedData, loadStudentOverview, loadTabData, warmSummaryData]);

  useEffect(() => {
    let active = true;
    const bootstrap = async () => {
      try {
        setError(null);
        setLoading(true);
        await loadSharedData();
        await loadStudentOverview();
        loadedTabsRef.current.student = true;
        if (!active) return;
        warmSummaryData();
      } catch (requestError: any) {
        if (!active) return;
        setError(getRequestErrorMessage(requestError, 'Failed to load access center.'));
      } finally {
        if (active) setLoading(false);
      }
    };
    void bootstrap();
    return () => {
      active = false;
    };
  }, [loadSharedData, loadStudentOverview, warmSummaryData]);

  useEffect(() => {
    if (loading) return;
    void loadTabData(activeTab);
  }, [activeTab, loadTabData, loading]);

  useEffect(() => {
    if (!activeSchoolId) return;
    loadedTabsRef.current = {};
    void refreshAll();
  }, [activeSchoolId, refreshAll]);

  useEffect(() => {
    if (loading || activeTab !== 'parent') return;
    void loadParentOverview();
  }, [activeTab, activeSchoolId, loadParentOverview, loading]);

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

  const platformAdminUsers = useMemo(() => adminOverview?.platform_administrators || [], [adminOverview?.platform_administrators]);

  const schoolAdminUsers = useMemo(() => adminOverview?.school_administrators || [], [adminOverview?.school_administrators]);

  const summary = useMemo(() => {
    const studentTotal = studentOverview?.summary.total_records || 0;
    const studentPending = studentOverview?.summary.accounts_pending || 0;
    const studentActive = studentOverview?.summary.portal_active || 0;
    const parentActive = parentOverview?.summary.portal_active || 0;
    const teacherTotal = teacherOverview?.summary.total_records || 0;
    const staffTotal = staffOverview?.summary.total_records || 0;
    const platformAdminTotal = platformAdminUsers.filter((user) => user.is_active).length;
    const schoolAdminTotal = schoolAdminUsers.filter((user) => user.is_active).length;
    return {
      studentTotal,
      studentPending,
      studentActive,
      parentActive,
      teacherTotal,
      staffTotal,
      platformAdminTotal,
      schoolAdminTotal,
      totalStaff: teacherTotal + staffTotal,
    };
  }, [parentOverview?.summary.portal_active, platformAdminUsers, schoolAdminUsers, staffOverview?.summary.total_records, studentOverview?.summary.accounts_pending, studentOverview?.summary.portal_active, studentOverview?.summary.total_records, teacherOverview?.summary.total_records]);

  const toggleSelection = (value: string, selected: string[], setter: React.Dispatch<React.SetStateAction<string[]>>) => {
    setter(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);
  };

  const togglePermission = (permission: string, selected: string[], setter: React.Dispatch<React.SetStateAction<string[]>>) => {
    setter(selected.includes(permission) ? selected.filter((item) => item !== permission) : [...selected, permission]);
  };

  const toggleExpandedGroup = (key: string) => {
    setExpandedGroups((current) => ({ ...current, [key]: !current[key] }));
  };

  const openTemplatePreview = (title: string, permissions: string[]) => {
    const groups = buildPermissionGroups(permissionModules, permissions);
    setTemplatePreviewTitle(title);
    setTemplatePreviewGroups(groups);
    setTemplatePreviewCount(permissions.length);
    setExpandedGroups(Object.fromEntries(groups.map((group) => [group.key, true])));
    setPermissionSearch('');
    setViewPowersOpen(true);
  };

  const loadAccountPanel = async (record: PortalOverviewRecord, mode: 'drawer' | 'view' | 'edit') => {
    if (!record.profile_id) return;
    const [summaryResponse, historyResponse] = await Promise.all([
      apiService.getUserPermissionSummary(record.profile_id),
      apiService.getAccountAuditLog({ profile_id: record.profile_id, limit: 25 }),
    ]);
    const summaryData = summaryResponse.data;
    setSelectedAccount(record);
    setAccountSummary(summaryData);
    setAccountHistory(historyResponse.data.items || []);
    setExpandedGroups(Object.fromEntries((summaryData.groups || []).map((group) => [group.key, true])));
    setPermissionSearch('');
    if (mode === 'drawer') {
      setDrawerOpen(true);
      return;
    }
    if (mode === 'view') {
      setTemplatePreviewTitle(null);
      setViewPowersOpen(true);
      return;
    }
    setEditTemplateKey(summaryData.template_key || 'custom');
    setEditSelectedRole(summaryData.selected_role || summaryData.role || 'viewer');
    setEditPermissions(summaryData.permissions || []);
    setEditScopeAssignments(normalizeScopeAssignments(summaryData.permissions || [], summaryData.selected_role || summaryData.role || 'viewer', summaryData.scope_assignments));
    setEditPowersOpen(true);
  };

  const loadAdminAccountPanel = async (user: RolePowerUser, mode: 'drawer' | 'view' | 'edit') => {
    const record: PortalOverviewRecord = {
      entity_type: 'administrator',
      entity_id: String(user.id),
      entity_name: user.full_name,
      username: user.username,
      email: user.email || null,
      portal_status: user.is_active ? 'active' : 'disabled',
      profile_linked: true,
      profile_id: String(user.id),
      active_sessions: 0,
      role_key: user.role,
      is_enabled: user.is_active,
      account_created_date: user.created_at || null,
    };
    await loadAccountPanel(record, mode);
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
        role: 'school_admin',
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

  const handleDrawerPasswordReset = async () => {
    if (!selectedAccount) return;
    await withAction(`drawer-reset-${selectedAccount.entity_id}`, async () => {
      if (selectedAccount.entity_type === 'student') {
        await apiService.resetStudentPortalPassword(selectedAccount.entity_id);
      } else if (selectedAccount.entity_type === 'parent') {
        await apiService.resetParentPortalPassword(selectedAccount.entity_id);
      } else if (selectedAccount.entity_type === 'administrator') {
        const response = await apiService.resetRoleUserPassword(selectedAccount.entity_id);
        setGeneratedRows([
          {
            name: selectedAccount.entity_name || accountSummary?.user_name || response.data.username,
            role: adminRoleLabel(accountSummary?.selected_role || selectedAccount.role_key || 'school_admin'),
            identifier: response.data.email || response.data.username,
            student_name: selectedAccount.entity_name || accountSummary?.user_name || response.data.username,
            roll_number: response.data.email || response.data.username,
            username: response.data.username,
            temporary_password: response.data.temporary_password,
            created_at: new Date().toISOString(),
          },
        ]);
        setGeneratedModalOpen(true);
      } else {
        await apiService.resetStaffPortalPassword(selectedAccount.entity_id, accountSummary?.selected_role || selectedAccount.role_key || 'teacher');
      }
      await refreshAll();
      if (selectedAccount.profile_id && selectedAccount.entity_type !== 'administrator') {
        await openCredentialDetails(selectedAccount.profile_id);
      }
      setMessage('Password reset complete.');
    });
  };

  const handleAdminPasswordReset = async (user: RolePowerUser) => {
    await withAction(`reset-admin-${user.id}`, async () => {
      const response = await apiService.resetRoleUserPassword(user.id);
      setGeneratedRows([
        {
          name: user.full_name,
          role: adminRoleLabel(user.role),
          identifier: response.data.email || response.data.username,
          student_name: user.full_name,
          roll_number: response.data.email || response.data.username,
          username: response.data.username,
          temporary_password: response.data.temporary_password,
          created_at: new Date().toISOString(),
        },
      ]);
      setGeneratedModalOpen(true);
      setMessage('Administrator password reset complete.');
      await refreshAll();
    });
  };

  const handleAdminActivationToggle = async (user: RolePowerUser) => {
    await withAction(`toggle-admin-${user.id}`, async () => {
      await apiService.updateRoleUser(user.id, { is_active: !user.is_active });
      setMessage(user.is_active ? 'Administrator deactivated.' : 'Administrator reactivated.');
      await refreshAll();
    });
  };

  const handleTransferOwnership = async (user: RolePowerUser) => {
    await withAction(`transfer-admin-${user.id}`, async () => {
      await apiService.transferRoleUserOwnership(user.id);
      setMessage('School ownership transferred.');
      await refreshAll();
    });
  };

  const handleSavePermissionChanges = async () => {
    if (!accountSummary?.profile_id) return;
    await withAction(`save-powers-${accountSummary.profile_id}`, async () => {
      const response = await apiService.updateUserPermissions(accountSummary.profile_id, {
        selected_role: editSelectedRole,
        permission_template: editTemplateKey,
        permissions: editPermissions,
        scope_assignments: editScopeAssignments,
      });
      setAccountSummary(response.data);
      setEditScopeAssignments(normalizeScopeAssignments(response.data.permissions || [], response.data.selected_role || response.data.role || 'viewer', response.data.scope_assignments));
      setEditPowersOpen(false);
      setMessage('Permissions updated.');
      await refreshAll();
    });
  };

  const handleResetToTemplate = async () => {
    if (!accountSummary?.profile_id) return;
    await withAction(`reset-template-${accountSummary.profile_id}`, async () => {
      const response = await apiService.resetUserPermissionsToTemplate(accountSummary.profile_id, {
        selected_role: editSelectedRole,
        permission_template: editTemplateKey,
      });
      setAccountSummary(response.data);
      setEditPermissions(response.data.permissions || []);
      setEditTemplateKey(response.data.template_key || editTemplateKey);
      setEditSelectedRole(response.data.selected_role || editSelectedRole);
      setEditScopeAssignments(normalizeScopeAssignments(response.data.permissions || [], response.data.selected_role || response.data.role || 'viewer', response.data.scope_assignments));
      setMessage('Permissions reset to template.');
      await refreshAll();
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
            <th className="px-4 py-3 text-left font-semibold text-slate-600">Permissions</th>
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
              <td className="px-4 py-3">
                {record.profile_id ? (
                  <button type="button" onClick={() => void loadAccountPanel(record, 'drawer')} className="font-semibold text-sky-700 hover:text-sky-900">
                    {record.username || 'Not created'}
                  </button>
                ) : (
                  <span className="font-semibold text-slate-900">{record.username || 'Not created'}</span>
                )}
              </td>
              <td className="px-4 py-3">
                <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                  Permissions: {record.permission_count || 0}
                </span>
              </td>
              <td className="px-4 py-3 text-slate-700">{record.portal_status}</td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => void loadAccountPanel(record, 'view')} disabled={!record.profile_id} className={BUTTON_SECONDARY}>
                    <Eye className="h-4 w-4" />
                    View Powers
                  </button>
                  <button type="button" onClick={() => void loadAccountPanel(record, 'edit')} disabled={!record.profile_id} className={BUTTON_SECONDARY}>
                    <Pencil className="h-4 w-4" />
                    Edit Powers
                  </button>
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

  const effectiveViewGroups = templatePreviewTitle ? templatePreviewGroups : (accountSummary?.groups || []);

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
          <SummaryCard title="Platform Administrators" value={summary.platformAdminTotal} helper="Global read-only" />
          <SummaryCard title="School Administrators" value={summary.schoolAdminTotal} helper="Active for current school" />
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
                <div className="mt-5">
                  <TemplatePreviewCard title={`${toTitle(studentTemplateKey)} Template`} permissions={studentPermissions} modules={permissionModules} onViewFull={() => openTemplatePreview(`${toTitle(studentTemplateKey)} Template`, studentPermissions)} />
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
                <div className="mt-5">
                  <TemplatePreviewCard title={`${toTitle(parentTemplateKey)} Template`} permissions={parentPermissions} modules={permissionModules} onViewFull={() => openTemplatePreview(`${toTitle(parentTemplateKey)} Template`, parentPermissions)} />
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
                <div className="mt-5">
                  <TemplatePreviewCard title={`${toTitle(teacherTemplateKey)} Template`} permissions={teacherPermissions} modules={permissionModules} onViewFull={() => openTemplatePreview(`${toTitle(teacherTemplateKey)} Template`, teacherPermissions)} />
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
                <div className="mt-5">
                  <TemplatePreviewCard title={`${toTitle(staffTemplateKey)} Template`} permissions={staffPermissions} modules={permissionModules} onViewFull={() => openTemplatePreview(`${toTitle(staffTemplateKey)} Template`, staffPermissions)} />
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
            <SectionCard title="Create School Administrator" subtitle="Create a school-scoped administrator for the current school.">
              <div className="grid gap-4 md:grid-cols-2">
                <input value={adminName} onChange={(event) => setAdminName(event.target.value)} className={PANEL_INPUT} placeholder="Full name" />
                <input value={adminUsername} onChange={(event) => setAdminUsername(event.target.value)} className={PANEL_INPUT} placeholder="Username" />
                <input value={adminEmail} onChange={(event) => setAdminEmail(event.target.value)} className={PANEL_INPUT} placeholder="Email" />
                <input value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} className={PANEL_INPUT} placeholder="Password" />
              </div>
              <div className="mt-4 rounded-3xl border border-sky-100 bg-sky-50 px-4 py-3 text-sm text-sky-900">
                New administrator accounts created from this panel are always assigned the <span className="font-semibold">School Administrator</span> role for the current school.
              </div>
              <div className="mt-5">
                <PermissionChecklist modules={permissionModules} selected={adminPermissions} onToggle={(permission) => togglePermission(permission, adminPermissions, setAdminPermissions)} />
              </div>
              <button type="button" onClick={() => void handleCreateAdministrator()} disabled={processingKey === 'create-admin'} className={`${BUTTON_PRIMARY} mt-5`}>
                <Shield className="h-4 w-4" />
                Create School Administrator
              </button>
            </SectionCard>
            <div className="space-y-6">
              <SectionCard
                title="Platform Administrators"
                subtitle={isPlatformWorkspace ? 'Global administrators are visible here in read-only mode.' : 'Platform administrators are global and never editable from a school workspace.'}
              >
                {platformAdminUsers.length ? (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="px-4 py-3 text-left font-semibold text-slate-600">Name</th>
                          <th className="px-4 py-3 text-left font-semibold text-slate-600">Email</th>
                          <th className="px-4 py-3 text-left font-semibold text-slate-600">Role</th>
                          <th className="px-4 py-3 text-left font-semibold text-slate-600">Status</th>
                          <th className="px-4 py-3 text-left font-semibold text-slate-600">Description</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {platformAdminUsers.map((user) => (
                          <tr key={`platform-${String(user.id)}`}>
                            <td className="px-4 py-3 font-semibold text-slate-900">{user.full_name}</td>
                            <td className="px-4 py-3 text-slate-700">{user.email || 'Not available'}</td>
                            <td className="px-4 py-3 text-slate-700">{adminRoleLabel(user.role)}</td>
                            <td className="px-4 py-3 text-slate-700">{user.is_active ? 'Active' : 'Inactive'}</td>
                            <td className="px-4 py-3 text-slate-700">Global platform administrator. Managed outside school workspace.</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-sm text-slate-500">
                    No platform administrator is available in this workspace context. Global admin management remains read-only here.
                  </div>
                )}
              </SectionCard>
              <SectionCard
                title="School Administrators"
                subtitle={`Only administrators assigned to ${activeSchoolName || 'the current school'} are shown here.`}
              >
                {schoolAdminUsers.length ? (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="px-4 py-3 text-left font-semibold text-slate-600">Name</th>
                          <th className="px-4 py-3 text-left font-semibold text-slate-600">Email</th>
                          <th className="px-4 py-3 text-left font-semibold text-slate-600">Status</th>
                          <th className="px-4 py-3 text-left font-semibold text-slate-600">Created Date</th>
                          <th className="px-4 py-3 text-left font-semibold text-slate-600">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {schoolAdminUsers.map((user) => (
                          <tr key={`school-admin-${String(user.id)}`}>
                            <td className="px-4 py-3 font-semibold text-slate-900">{user.full_name}</td>
                            <td className="px-4 py-3 text-slate-700">{user.email || 'Not available'}</td>
                            <td className="px-4 py-3 text-slate-700">{user.is_active ? 'Active' : 'Inactive'}</td>
                            <td className="px-4 py-3 text-slate-700">{formatDateTime(user.created_at)}</td>
                            <td className="px-4 py-3">
                              <div className="flex flex-wrap gap-2">
                                <button type="button" onClick={() => void loadAdminAccountPanel(user, 'edit')} className={BUTTON_SECONDARY}>
                                  <Pencil className="h-4 w-4" />
                                  Edit
                                </button>
                                <button type="button" onClick={() => void handleAdminActivationToggle(user)} className={BUTTON_SECONDARY}>
                                  <Lock className="h-4 w-4" />
                                  {user.is_active ? 'Deactivate' : 'Activate'}
                                </button>
                                <button type="button" onClick={() => void handleAdminPasswordReset(user)} className={BUTTON_SECONDARY}>
                                  <KeyRound className="h-4 w-4" />
                                  Reset Password
                                </button>
                                {user.is_primary ? (
                                  <span className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-2 text-sm font-semibold text-emerald-800">
                                    <Check className="h-4 w-4" />
                                    Current Owner
                                  </span>
                                ) : (
                                  <button type="button" onClick={() => void handleTransferOwnership(user)} disabled={!user.is_active} className={BUTTON_SECONDARY}>
                                    <RefreshCw className="h-4 w-4" />
                                    Transfer Ownership
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="rounded-3xl border border-dashed border-amber-200 bg-amber-50 px-5 py-6">
                    <p className="text-sm font-semibold text-amber-900">No School Administrator has been assigned to this school.</p>
                    <p className="mt-2 text-sm text-amber-800">Create one below or assign an existing user.</p>
                    <button
                      type="button"
                      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                      className={`${BUTTON_PRIMARY} mt-4`}
                    >
                      <Plus className="h-4 w-4" />
                      Create School Administrator
                    </button>
                  </div>
                )}
              </SectionCard>
            </div>
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
                        const haystack = `${item.name} ${item.target_user || ''} ${item.permission_key || ''} ${item.action} ${item.created_by}`.toLowerCase();
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

      <Drawer open={drawerOpen} title={accountSummary?.user_name || selectedAccount?.entity_name || 'Account Details'} onClose={() => setDrawerOpen(false)}>
        {accountSummary ? (
          <div className="space-y-6">
            <div className="grid gap-3 rounded-3xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-700 md:grid-cols-2">
              <div><span className="font-semibold text-slate-900">Username:</span> {accountSummary.username}</div>
              <div><span className="font-semibold text-slate-900">Role:</span> {accountSummary.role_label}</div>
              <div><span className="font-semibold text-slate-900">Status:</span> {toTitle(accountSummary.status)}</div>
              <div><span className="font-semibold text-slate-900">Created:</span> {formatDateTime(accountSummary.created_at)}</div>
              <div><span className="font-semibold text-slate-900">Last Login:</span> {formatDateTime(accountSummary.last_login)}</div>
              <div><span className="font-semibold text-slate-900">Active Sessions:</span> {accountSummary.active_sessions}</div>
              <div><span className="font-semibold text-slate-900">Permissions:</span> {accountSummary.permission_count}</div>
              <div><span className="font-semibold text-slate-900">Template:</span> {accountSummary.template_label}</div>
            </div>
            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={() => { setTemplatePreviewTitle(null); setViewPowersOpen(true); }} className={BUTTON_SECONDARY}>
                <Eye className="h-4 w-4" />
                View Powers
              </button>
              <button type="button" onClick={() => { setEditTemplateKey(accountSummary.template_key || 'custom'); setEditSelectedRole(accountSummary.selected_role || accountSummary.role); setEditPermissions(accountSummary.permissions || []); setEditScopeAssignments(normalizeScopeAssignments(accountSummary.permissions || [], accountSummary.selected_role || accountSummary.role || 'viewer', accountSummary.scope_assignments)); setEditPowersOpen(true); }} className={BUTTON_SECONDARY}>
                <Pencil className="h-4 w-4" />
                Edit Powers
              </button>
              <button type="button" onClick={() => void handleDrawerPasswordReset()} className={BUTTON_SECONDARY}>
                <KeyRound className="h-4 w-4" />
                Reset Password
              </button>
              <button type="button" onClick={() => accountSummary.profile_id && void withAction(`drawer-disable-${accountSummary.profile_id}`, async () => { await (accountSummary.is_enabled ? apiService.disableProfileAccount(accountSummary.profile_id) : apiService.enableProfileAccount(accountSummary.profile_id)); await refreshAll(); const summaryResponse = await apiService.getUserPermissionSummary(accountSummary.profile_id); setAccountSummary(summaryResponse.data); })} className={BUTTON_SECONDARY}>
                <Lock className="h-4 w-4" />
                {accountSummary.is_enabled ? 'Disable Account' : 'Enable Account'}
              </button>
              <button type="button" onClick={() => accountSummary.profile_id && void withAction(`drawer-logout-${accountSummary.profile_id}`, async () => { await apiService.logoutAllProfileSessions(accountSummary.profile_id); await refreshAll(); const summaryResponse = await apiService.getUserPermissionSummary(accountSummary.profile_id); setAccountSummary(summaryResponse.data); })} className={BUTTON_SECONDARY}>
                <LogOut className="h-4 w-4" />
                Logout All Devices
              </button>
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">Account History</p>
              <div className="mt-3 overflow-x-auto rounded-3xl border border-slate-200">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold text-slate-600">Action</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-600">Actor</th>
                      <th className="px-4 py-3 text-left font-semibold text-slate-600">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {accountHistory.map((item) => (
                      <tr key={item.id}>
                        <td className="px-4 py-3 text-slate-700">{item.action}</td>
                        <td className="px-4 py-3 text-slate-700">{item.created_by}</td>
                        <td className="px-4 py-3 text-slate-700">{formatDateTime(item.timestamp)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : null}
      </Drawer>

      <Modal open={viewPowersOpen} title={templatePreviewTitle || `${accountSummary?.user_name || 'User'} Powers`} onClose={() => setViewPowersOpen(false)}>
        <div className="space-y-5">
          {accountSummary && !templatePreviewTitle ? (
            <div className="grid gap-3 rounded-3xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 md:grid-cols-3">
              <div><span className="font-semibold text-slate-900">Role:</span> {accountSummary.role_label}</div>
              <div><span className="font-semibold text-slate-900">Status:</span> {toTitle(accountSummary.status)}</div>
              <div><span className="font-semibold text-slate-900">Permission Count:</span> {accountSummary.permission_count}</div>
            </div>
          ) : (
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              <span className="font-semibold text-slate-900">Permission Count:</span> {templatePreviewCount}
            </div>
          )}
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={permissionSearch} onChange={(event) => setPermissionSearch(event.target.value)} className={`${PANEL_INPUT} pl-11`} placeholder="Search permission" />
          </div>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={() => setExpandedGroups(Object.fromEntries(effectiveViewGroups.map((group) => [group.key, true])))} className={BUTTON_SECONDARY}>Expand All</button>
            <button type="button" onClick={() => setExpandedGroups(Object.fromEntries(effectiveViewGroups.map((group) => [group.key, false])))} className={BUTTON_SECONDARY}>Collapse All</button>
          </div>
          <PermissionGroupList groups={effectiveViewGroups} search={permissionSearch} expanded={expandedGroups} onToggleGroup={toggleExpandedGroup} />
        </div>
      </Modal>

      <Modal
        open={editPowersOpen}
        title={`Edit Powers${accountSummary ? ` - ${accountSummary.user_name}` : ''}`}
        onClose={() => setEditPowersOpen(false)}
        sizeClassName="max-w-7xl"
        panelClassName="max-h-[95vh] overflow-hidden"
        contentClassName="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex min-h-0 flex-1 flex-col gap-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="mb-2 text-sm font-semibold text-slate-900">Role Template</p>
              <select
                value={editTemplateKey}
                onChange={(event) => {
                  const nextTemplateKey = event.target.value;
                  setEditTemplateKey(nextTemplateKey);
                  if (nextTemplateKey === 'custom') return;
                  const template = templateMap.get(nextTemplateKey);
                  if (!template) return;
                  setEditSelectedRole(template.selected_role || editSelectedRole);
                  setEditPermissions(template.permissions || []);
                  setEditScopeAssignments(normalizeScopeAssignments(template.permissions || [], template.selected_role || editSelectedRole));
                }}
                className={PANEL_INPUT}
              >
                {permissionTemplates.map((template) => (
                  <option key={template.key} value={template.key}>{template.label}</option>
                ))}
              </select>
            </div>
            <div>
              <p className="mb-2 text-sm font-semibold text-slate-900">Selected Role</p>
              <select
                value={editSelectedRole}
                onChange={(event) => {
                  const nextRole = event.target.value;
                  setEditSelectedRole(nextRole);
                  setEditScopeAssignments(normalizeScopeAssignments(editPermissions, nextRole, editScopeAssignments));
                }}
                className={PANEL_INPUT}
              >
                {permissionTemplates.map((template) => (
                  <option key={`${template.key}-${template.selected_role}`} value={template.selected_role}>{template.label}</option>
                ))}
              </select>
            </div>
          </div>
          <RbacPermissionEditor
            modules={permissionModules}
            selectedPermissions={editPermissions}
            templatePermissions={editTemplateKey === 'custom' ? accountSummary?.template_permissions || [] : templateMap.get(editTemplateKey)?.permissions || []}
            search={permissionSearch}
            onSearchChange={setPermissionSearch}
            expanded={expandedGroups}
            onToggleGroup={toggleExpandedGroup}
            onTogglePermission={(permissionKey) =>
              setEditPermissions((current) => {
                const next = current.includes(permissionKey) ? current.filter((item) => item !== permissionKey) : [...current, permissionKey];
                setEditScopeAssignments((existing) => normalizeScopeAssignments(next, editSelectedRole, existing));
                return next;
              })
            }
            onChangePermissionScope={(permissionKey, scope) => setEditScopeAssignments((current) => ({ ...current, [permissionKey]: scope }))}
            onSelectAll={() => {
              const next = getAllPermissionKeys(permissionModules);
              setEditPermissions(next);
              setEditScopeAssignments(normalizeScopeAssignments(next, editSelectedRole, editScopeAssignments));
            }}
            onDeselectAll={() => {
              setEditPermissions([]);
              setEditScopeAssignments({});
            }}
            onResetToTemplate={() => void handleResetToTemplate()}
            onSave={() => void handleSavePermissionChanges()}
            onClose={() => setEditPowersOpen(false)}
            saving={processingKey === `save-powers-${accountSummary?.profile_id || ''}`}
            templateLabel={templateMap.get(editTemplateKey)?.label || accountSummary?.template_label || 'Custom Role'}
            scopeAssignments={editScopeAssignments}
            selectedRole={editSelectedRole}
          />
        </div>
      </Modal>

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
