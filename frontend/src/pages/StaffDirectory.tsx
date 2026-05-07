import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Eye, Pencil, Search, Trash2, Upload, UserPlus2, Users, X } from 'lucide-react';
import { apiService } from '@services/api';
import {
  clearStaffDirectoryRecords,
  findStaffDirectoryNameMatches,
  getStaffDirectoryDuplicateGroups,
  readStaffDirectoryRecords,
  removeStaffDirectoryRecord,
  removeStoredEntityId,
  STAFF_ADDED_INVIGILATOR_IDS_KEY,
  STAFF_ADDED_TEACHER_IDS_KEY,
  storeEntityId,
  type StaffDirectoryRecord,
  upsertStaffDirectoryRecord,
  writeStaffDirectoryRecords,
} from '@utils/staffDirectory';

const inputClass =
  'w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-900 focus:ring-4 focus:ring-slate-200/70';
const editLabelClass = 'mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500';
const detailLabelClass = 'text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400';

type EditFormState = {
  staffType: 'teaching' | 'non_teaching';
  fullName: string;
  category: string;
  employeeId: string;
  subject: string;
  department: string;
  designation: string;
  phone: string;
  email: string;
  joiningDate: string;
  shiftTiming: string;
  isActive: boolean;
  photoDataUrl: string;
};

const toEditForm = (record: StaffDirectoryRecord): EditFormState => ({
  staffType: record.staffType,
  fullName: record.fullName,
  category: record.category,
  employeeId: record.employeeId || '',
  subject: record.subject || '',
  department: record.department || '',
  designation: record.designation || '',
  phone: record.phone || '',
  email: record.email || '',
  joiningDate: record.joiningDate || '',
  shiftTiming: record.shiftTiming || '',
  isActive: record.isActive,
  photoDataUrl: record.photoDataUrl || '',
});

const splitNameParts = (fullName: string) => {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) {
    return { firstName: '', middleName: '', lastName: '' };
  }
  if (parts.length === 1) {
    return { firstName: parts[0], middleName: '', lastName: '' };
  }
  return {
    firstName: parts[0],
    middleName: parts.length > 2 ? parts.slice(1, -1).join(' ') : '',
    lastName: parts[parts.length - 1],
  };
};

const buildDirectoryId = (backendType: 'teaching' | 'non_teaching', backendId: number) =>
  `${backendType}:${backendId}`;

const normalizeDirectoryRecord = (record: StaffDirectoryRecord): StaffDirectoryRecord => {
  const normalizedType = record.backendType || record.staffType;
  return {
    ...record,
    id:
      record.backendId && normalizedType
        ? buildDirectoryId(normalizedType, record.backendId)
        : record.id,
    backendType: normalizedType,
    staffType: normalizedType,
  };
};

const buildDirectoryDedupKey = (record: StaffDirectoryRecord) => {
  if (record.backendId && record.backendType) {
    return buildDirectoryId(record.backendType, record.backendId);
  }

  const normalizedType = record.backendType || record.staffType;
  const employeeId = (record.employeeId || '').trim().toLowerCase();
  const fullName = record.fullName.trim().toLowerCase();
  const email = (record.email || '').trim().toLowerCase();

  if (employeeId) {
    return `${normalizedType}:employee:${employeeId}`;
  }

  if (email) {
    return `${normalizedType}:email:${email}`;
  }

  return `${normalizedType}:name:${fullName}`;
};

const mergeDirectoryRecords = (primary: StaffDirectoryRecord, secondary: StaffDirectoryRecord): StaffDirectoryRecord =>
  normalizeDirectoryRecord({
    ...secondary,
    ...primary,
    id: primary.id || secondary.id,
    backendId: primary.backendId ?? secondary.backendId,
    backendType: primary.backendType || secondary.backendType,
    staffType: primary.staffType || secondary.staffType,
  });

const mapTeacherToDirectoryRecord = (teacher: any): StaffDirectoryRecord => {
  const fullName = String(teacher?.name || '').trim();
  const nameParts = splitNameParts(fullName);
  return {
    id: buildDirectoryId('teaching', Number(teacher?.id)),
    backendId: Number(teacher?.id),
    backendType: 'teaching',
    staffType: 'teaching',
    category: String(teacher?.subject || 'Teaching').trim() || 'Teaching',
    fullName,
    firstName: nameParts.firstName,
    middleName: nameParts.middleName || undefined,
    lastName: nameParts.lastName || undefined,
    employeeId: undefined,
    subject: String(teacher?.subject || '').trim() || undefined,
    department: String(teacher?.subject || '').trim() || undefined,
    designation: 'Teacher',
    phone: String(teacher?.phone || '').trim() || undefined,
    email: String(teacher?.email || '').trim() || undefined,
    joiningDate: undefined,
    shiftTiming: undefined,
    isActive: Boolean(teacher?.is_active ?? true),
    createdAt: String(teacher?.created_at || new Date().toISOString()),
  };
};

const mapInvigilatorToDirectoryRecord = (invigilator: any): StaffDirectoryRecord => {
  const fullName = String(invigilator?.name || '').trim();
  const nameParts = splitNameParts(fullName);
  const department = String(invigilator?.department || '').trim();
  const designation = String(invigilator?.designation || '').trim();
  return {
    id: buildDirectoryId('non_teaching', Number(invigilator?.id)),
    backendId: Number(invigilator?.id),
    backendType: 'non_teaching',
    staffType: 'non_teaching',
    category: department || designation || 'Non-Teaching',
    fullName,
    firstName: nameParts.firstName,
    middleName: nameParts.middleName || undefined,
    lastName: nameParts.lastName || undefined,
    employeeId: String(invigilator?.staff_id || '').trim() || undefined,
    subject: undefined,
    department: department || undefined,
    designation: designation || undefined,
    phone: String(invigilator?.phone || '').trim() || undefined,
    email: String(invigilator?.email || '').trim() || undefined,
    joiningDate: undefined,
    shiftTiming: undefined,
    isActive: Boolean(invigilator?.is_active ?? true),
    createdAt: String(invigilator?.created_at || new Date().toISOString()),
  };
};

export default function StaffDirectory() {
  const navigate = useNavigate();
  const location = useLocation();
  const [records, setRecords] = useState<StaffDirectoryRecord[]>([]);
  const [search, setSearch] = useState('');
  const [staffType, setStaffType] = useState<'all' | 'teaching' | 'non_teaching'>('all');
  const [category, setCategory] = useState('all');
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error'>('success');
  const [editingRecord, setEditingRecord] = useState<StaffDirectoryRecord | null>(null);
  const [editForm, setEditForm] = useState<EditFormState | null>(null);
  const [viewingRecord, setViewingRecord] = useState<StaffDirectoryRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [viewMode, setViewMode] = useState<'card' | 'row'>('card');

  const loadRecords = async () => {
    const localRecords = readStaffDirectoryRecords().map(normalizeDirectoryRecord);
    try {
      const [teachersRes, invigilatorsRes] = await Promise.all([
        apiService.listTeachers(1, 0, 1000),
        apiService.listInvigilators(1, undefined, 0, 1000),
      ]);

      const backendRecords = [
        ...(Array.isArray(teachersRes.data) ? teachersRes.data.map(mapTeacherToDirectoryRecord) : []),
        ...(Array.isArray(invigilatorsRes.data) ? invigilatorsRes.data.map(mapInvigilatorToDirectoryRecord) : []),
      ];

      const merged = new Map<string, StaffDirectoryRecord>();
      backendRecords.forEach((record) => merged.set(record.id, normalizeDirectoryRecord(record)));
      localRecords.forEach((record) => {
        const key =
          record.backendId && record.backendType
            ? buildDirectoryId(record.backendType, record.backendId)
            : record.id;

        const backendRecord = merged.get(key);
        if (backendRecord) {
          merged.set(
            key,
            normalizeDirectoryRecord({
              ...backendRecord,
              ...record,
              id: backendRecord.id,
              backendId: backendRecord.backendId,
              backendType: backendRecord.backendType,
              staffType: backendRecord.staffType,
            })
          );
          return;
        }

        merged.set(key, normalizeDirectoryRecord(record));
      });

      const deduped = new Map<string, StaffDirectoryRecord>();
      Array.from(merged.values())
        .map(normalizeDirectoryRecord)
        .forEach((record) => {
          const dedupKey = buildDirectoryDedupKey(record);
          const existing = deduped.get(dedupKey);
          deduped.set(dedupKey, existing ? mergeDirectoryRecords(existing, record) : record);
        });

      const nextRecords = Array.from(deduped.values())
        .sort((a, b) => a.fullName.localeCompare(b.fullName));
      setRecords(nextRecords);
      writeStaffDirectoryRecords(nextRecords);
    } catch {
      setRecords(localRecords);
    }
  };

  useEffect(() => {
    void loadRecords();
  }, []);

  useEffect(() => {
    const state = location.state as { staffType?: 'all' | 'teaching' | 'non_teaching' } | undefined;
    if (!state?.staffType) return;
    setStaffType(state.staffType);
    window.history.replaceState({}, document.title);
  }, [location.state]);

  useEffect(() => {
    if (!viewingRecord) return;
    const latestViewingRecord = records.find((record) => record.id === viewingRecord.id);
    if (latestViewingRecord) {
      setViewingRecord(latestViewingRecord);
    }
  }, [records, viewingRecord]);

  const showMessage = (nextMessage: string, type: 'success' | 'error' = 'success') => {
    setMessage(nextMessage);
    setMessageType(type);
    window.setTimeout(() => setMessage(''), 3000);
  };

  const categories = useMemo(
    () => Array.from(new Set(records.map((item) => item.category).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [records]
  );

  const duplicateGroups = useMemo(() => getStaffDirectoryDuplicateGroups(records), [records]);
  const duplicateCountByRecordId = useMemo(() => {
    const counts = new Map<string, number>();
    duplicateGroups.forEach((group) => {
      group.records.forEach((record) => counts.set(record.id, group.records.length));
    });
    return counts;
  }, [duplicateGroups]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return records.filter((item) => {
      const matchesType = staffType === 'all' || item.staffType === staffType;
      const matchesCategory = category === 'all' || item.category === category;
      const matchesSearch =
        !query ||
        item.fullName.toLowerCase().includes(query) ||
        (item.employeeId || '').toLowerCase().includes(query) ||
        (item.email || '').toLowerCase().includes(query) ||
        (item.department || '').toLowerCase().includes(query) ||
        (item.designation || '').toLowerCase().includes(query);
      return matchesType && matchesCategory && matchesSearch;
    });
  }, [records, search, staffType, category]);

  const startEdit = (record: StaffDirectoryRecord) => {
    setEditingRecord(record);
    setEditForm(toEditForm(record));
  };

  const closeEdit = () => {
    setEditingRecord(null);
    setEditForm(null);
  };

  const handleEditPhotoChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !editForm) return;

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setEditForm((current) => (current ? { ...current, photoDataUrl: reader.result as string } : current));
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSaveEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingRecord || !editForm) return;
    if (!editForm.fullName.trim()) {
      showMessage('Name required hai.', 'error');
      return;
    }
    if (editForm.staffType === 'teaching' && !editForm.subject.trim()) {
      showMessage('Teaching staff ke liye subject required hai.', 'error');
      return;
    }
    if (editForm.staffType === 'non_teaching' && !editForm.employeeId.trim()) {
      showMessage('Non-teaching staff ke liye employee ID required hai.', 'error');
      return;
    }

    const duplicateNameMatches = findStaffDirectoryNameMatches(records, editForm.fullName, editingRecord.id);
    if (duplicateNameMatches.length) {
      const duplicateSummary = duplicateNameMatches
        .map((record) => `${record.fullName} (${record.staffType === 'teaching' ? 'Teaching' : 'Non-Teaching'})`)
        .join(', ');
      const shouldContinue = window.confirm(
        `Same name ke ${duplicateNameMatches.length} record already mil gaye: ${duplicateSummary}. Kya aap phir bhi save karna chahte hain?`
      );
      if (!shouldContinue) {
        return;
      }
    }

    try {
      setSaving(true);
      const isTypeChanged = editForm.staffType !== editingRecord.staffType;
      let nextBackendId = editingRecord.backendId;
      let nextBackendType = isTypeChanged ? editForm.staffType : editingRecord.backendType;

      if (editingRecord.backendId && !isTypeChanged) {
        if (editForm.staffType === 'teaching') {
          await apiService.updateTeacher(editingRecord.backendId, {
            name: editForm.fullName.trim(),
            subject: editForm.subject.trim(),
            email: editForm.email.trim() || undefined,
            phone: editForm.phone.trim() || undefined,
            is_active: editForm.isActive,
          });
        } else {
          await apiService.updateInvigilator(editingRecord.backendId, {
            staff_id: editForm.employeeId.trim() || undefined,
            name: editForm.fullName.trim(),
            email: editForm.email.trim() || undefined,
            phone: editForm.phone.trim() || undefined,
            department: editForm.department.trim() || undefined,
            designation: editForm.designation.trim() || undefined,
            is_active: editForm.isActive,
          });
        }
      } else if (editingRecord.backendId && isTypeChanged) {
        if (editForm.staffType === 'teaching') {
          const createdTeacher = await apiService.createTeacher({
            name: editForm.fullName.trim(),
            subject: editForm.subject.trim(),
            email: editForm.email.trim() || undefined,
            phone: editForm.phone.trim() || undefined,
            is_active: editForm.isActive,
          });
          await apiService.deleteInvigilator(editingRecord.backendId);
          removeStoredEntityId(STAFF_ADDED_INVIGILATOR_IDS_KEY, editingRecord.backendId);
          nextBackendId = createdTeacher.data.id;
          nextBackendType = 'teaching';
          storeEntityId(STAFF_ADDED_TEACHER_IDS_KEY, createdTeacher.data.id);
        } else {
          const createdInvigilator = await apiService.createInvigilator(
            {
              staff_id: editForm.employeeId.trim(),
              name: editForm.fullName.trim(),
              email: editForm.email.trim() || undefined,
              phone: editForm.phone.trim() || undefined,
              department: editForm.department.trim() || editForm.category.trim() || undefined,
              designation: editForm.designation.trim() || editForm.category.trim() || undefined,
              is_active: editForm.isActive,
            },
            1
          );
          await apiService.deleteTeacher(editingRecord.backendId);
          removeStoredEntityId(STAFF_ADDED_TEACHER_IDS_KEY, editingRecord.backendId);
          nextBackendId = createdInvigilator.data.id;
          nextBackendType = 'non_teaching';
          storeEntityId(STAFF_ADDED_INVIGILATOR_IDS_KEY, createdInvigilator.data.id);
        }
      }

      const nameParts = splitNameParts(editForm.fullName);
      if (isTypeChanged) {
        removeStaffDirectoryRecord(editingRecord.id);
      }
      const nextRecord = {
        ...editingRecord,
        id:
          nextBackendId && nextBackendType
            ? buildDirectoryId(nextBackendType, nextBackendId)
            : editingRecord.id,
        backendId: nextBackendId,
        backendType: nextBackendType,
        staffType: editForm.staffType,
        ...nameParts,
        fullName: editForm.fullName.trim(),
        category: editForm.category.trim() || editingRecord.category,
        employeeId: editForm.staffType === 'non_teaching' ? editForm.employeeId.trim() || undefined : undefined,
        subject: editForm.staffType === 'teaching' ? editForm.subject.trim() || undefined : undefined,
        department:
          editForm.staffType === 'non_teaching'
            ? editForm.department.trim() || undefined
            : editForm.subject.trim() || undefined,
        designation:
          editForm.staffType === 'non_teaching'
            ? editForm.designation.trim() || undefined
            : 'Teacher',
        phone: editForm.phone.trim() || undefined,
        email: editForm.email.trim() || undefined,
        joiningDate: editForm.joiningDate || undefined,
        shiftTiming: editForm.shiftTiming.trim() || undefined,
        isActive: editForm.isActive,
        photoDataUrl: editForm.photoDataUrl || undefined,
        details: {
          ...editingRecord.details,
          primaryMobile: editForm.phone.trim() || undefined,
        },
      };
      upsertStaffDirectoryRecord(nextRecord);
      setViewingRecord((current) => (current?.id === editingRecord.id ? nextRecord : current));

      await loadRecords();
      closeEdit();
      showMessage('Staff record updated successfully.');
    } catch (error: any) {
      showMessage(error?.response?.data?.detail || error?.message || 'Staff update failed.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRecord = async (record: StaffDirectoryRecord) => {
    if (!window.confirm(`Delete ${record.fullName}?`)) return;
    try {
      if (record.backendId) {
        if (record.backendType === 'teaching') {
          await apiService.deleteTeacher(record.backendId);
          removeStoredEntityId(STAFF_ADDED_TEACHER_IDS_KEY, record.backendId);
        } else {
          await apiService.deleteInvigilator(record.backendId);
          removeStoredEntityId(STAFF_ADDED_INVIGILATOR_IDS_KEY, record.backendId);
        }
      }
      removeStaffDirectoryRecord(record.id);
      await loadRecords();
      showMessage('Staff record deleted successfully.');
    } catch (error: any) {
      showMessage(error?.response?.data?.detail || error?.message || 'Delete failed.', 'error');
    }
  };

  const handleDeleteAll = async () => {
    if (!filtered.length) return;
    if (!window.confirm('Current filtered staff records delete karne hain?')) return;

    try {
      setSaving(true);
      for (const record of filtered) {
        if (record.backendId) {
          if (record.backendType === 'teaching') {
            await apiService.deleteTeacher(record.backendId);
            removeStoredEntityId(STAFF_ADDED_TEACHER_IDS_KEY, record.backendId);
          } else {
            await apiService.deleteInvigilator(record.backendId);
            removeStoredEntityId(STAFF_ADDED_INVIGILATOR_IDS_KEY, record.backendId);
          }
        }
        removeStaffDirectoryRecord(record.id);
      }

      if (filtered.length === records.length) {
        clearStaffDirectoryRecords();
      }

      await loadRecords();
      showMessage('Selected staff records deleted successfully.');
    } catch (error: any) {
      showMessage(error?.response?.data?.detail || error?.message || 'Delete all failed.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-7xl">
        <section className="rounded-3xl bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="text-3xl font-bold text-slate-900">Staff Directory</h1>
              <p className="mt-2 text-sm text-slate-500">Add Staff aur Bulk Upload se jo staff create hoga, woh yahan dikhai dega.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => navigate('/staff/add', { state: { staffType } })}
                className="inline-flex items-center gap-2 rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700"
              >
                <UserPlus2 className="h-4 w-4" />
                Add Staff
              </button>
              <button
                type="button"
                onClick={() => navigate('/staff/bulk-upload')}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                <Upload className="h-4 w-4" />
                Bulk Upload
              </button>
            </div>
          </div>
        </section>

        <section className="mt-6 rounded-3xl bg-white p-6 shadow-sm">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="relative xl:col-span-2">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-white py-3 pl-11 pr-4 text-sm text-slate-900 outline-none focus:border-slate-900 focus:ring-4 focus:ring-slate-200/70"
                placeholder="Search by name, employee ID, email, department"
              />
            </div>
            <select value={staffType} onChange={(e) => setStaffType(e.target.value as typeof staffType)} className={inputClass}>
              <option value="all">All Staff Types</option>
              <option value="teaching">Teaching</option>
              <option value="non_teaching">Non-Teaching</option>
            </select>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass}>
              <option value="all">All Categories</option>
              {categories.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <MetricCard label="Total Staff" value={String(records.length)} />
            <MetricCard label="Teaching" value={String(records.filter((item) => item.staffType === 'teaching').length)} />
            <MetricCard label="Non-Teaching" value={String(records.filter((item) => item.staffType === 'non_teaching').length)} />
          </div>

          {duplicateGroups.length ? (
            <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <div className="flex flex-col gap-2">
                <p className="text-sm font-semibold text-amber-900">
                  Same-name alert: {duplicateGroups.length} name group{duplicateGroups.length > 1 ? 's' : ''} me duplicate entries mili hain.
                </p>
                {duplicateGroups.map((group) => (
                  <p key={group.normalizedName} className="text-sm text-amber-800">
                    {group.fullName}: {group.records.length} records
                    {' - '}
                    {group.records.map((record) => `${record.staffType === 'teaching' ? 'Teaching' : 'Non-Teaching'}${record.employeeId ? ` (${record.employeeId})` : ''}`).join(', ')}
                  </p>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        <section className="mt-6 rounded-3xl bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-indigo-600" />
              <h2 className="text-xl font-semibold text-slate-900">Directory List</h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-xl border border-slate-300 bg-white p-1">
                <button
                  type="button"
                  onClick={() => setViewMode('card')}
                  className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${viewMode === 'card' ? 'bg-slate-900 text-white' : 'text-slate-700'}`}
                >
                  Card View
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('row')}
                  className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${viewMode === 'row' ? 'bg-slate-900 text-white' : 'text-slate-700'}`}
                >
                  Row View
                </button>
              </div>
              <button
                type="button"
                disabled={!filtered.length || saving}
                onClick={handleDeleteAll}
                className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
                Delete All
              </button>
            </div>
          </div>

          {message ? (
            <div className={`mb-4 rounded-xl px-4 py-3 text-sm font-medium ${messageType === 'success' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-700'}`}>
              {message}
            </div>
          ) : null}

          {filtered.length ? (
            viewMode === 'card' ? (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {filtered.map((record) => (
                  <div key={record.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <StaffAvatar record={record} />
                        <div>
                          <p className="text-lg font-semibold text-slate-900">{record.fullName}</p>
                          <p className="mt-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{record.staffType === 'teaching' ? 'Teaching' : 'Non-Teaching'}</p>
                          {duplicateCountByRecordId.get(record.id) ? (
                            <p className="mt-2 inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-800">
                              Same name x{duplicateCountByRecordId.get(record.id)}
                            </p>
                          ) : null}
                        </div>
                      </div>
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${record.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                        {record.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <div className="mt-4 space-y-2 text-sm text-slate-600">
                      <p><span className="font-medium text-slate-900">Category:</span> {record.category}</p>
                      {record.employeeId ? <p><span className="font-medium text-slate-900">Employee ID:</span> {record.employeeId}</p> : null}
                      {record.subject ? <p><span className="font-medium text-slate-900">Subject:</span> {record.subject}</p> : null}
                      {record.department ? <p><span className="font-medium text-slate-900">Department:</span> {record.department}</p> : null}
                      {record.designation ? <p><span className="font-medium text-slate-900">Designation:</span> {record.designation}</p> : null}
                      {record.phone ? <p><span className="font-medium text-slate-900">Phone:</span> {record.phone}</p> : null}
                      {record.email ? <p><span className="font-medium text-slate-900">Email:</span> {record.email}</p> : null}
                      {record.joiningDate ? <p><span className="font-medium text-slate-900">Joining:</span> {record.joiningDate}</p> : null}
                    </div>
                    <div className="mt-4 flex gap-2">
                      <button
                        type="button"
                        onClick={() => setViewingRecord(record)}
                        className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-100"
                      >
                        <Eye className="h-4 w-4" />
                        Full Details
                      </button>
                      <button
                        type="button"
                        onClick={() => startEdit(record)}
                        className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        <Pencil className="h-4 w-4" />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteRecord(record)}
                        className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100"
                      >
                        <Trash2 className="h-4 w-4" />
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-slate-200">
                <div className="grid grid-cols-[1.4fr_0.85fr_1fr_1.1fr_1fr_1fr_0.9fr] gap-4 bg-slate-50 px-4 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  <span>Photo / Name</span>
                  <span>Type</span>
                  <span>Category</span>
                  <span>Department / Subject</span>
                  <span>Designation / Joining</span>
                  <span>Contact</span>
                  <span>Action</span>
                </div>
                <div className="divide-y divide-slate-100 bg-white">
                  {filtered.map((record) => (
                    <div key={record.id} className="grid grid-cols-[1.4fr_0.85fr_1fr_1.1fr_1fr_1fr_0.9fr] gap-4 px-4 py-4 text-sm text-slate-700">
                      <div className="flex items-center gap-3">
                        <StaffAvatar record={record} />
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900">{record.fullName}</p>
                          {record.employeeId ? <p className="text-xs text-slate-500">{record.employeeId}</p> : null}
                          {duplicateCountByRecordId.get(record.id) ? (
                            <p className="mt-1 text-xs font-semibold text-amber-700">
                              Same name x{duplicateCountByRecordId.get(record.id)}
                            </p>
                          ) : null}
                        </div>
                      </div>
                      <div>
                        <p>{record.staffType === 'teaching' ? 'Teaching' : 'Non-Teaching'}</p>
                        <p className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${record.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                          {record.isActive ? 'Active' : 'Inactive'}
                        </p>
                      </div>
                      <div>
                        <p>{record.category}</p>
                        {record.designation ? <p className="text-xs text-slate-500">{record.designation}</p> : null}
                      </div>
                      <div>
                        <p>{record.subject || record.department || 'N/A'}</p>
                        {record.department && record.subject ? <p className="text-xs text-slate-500">{record.department}</p> : null}
                      </div>
                      <div>
                        <p>{record.designation || 'N/A'}</p>
                        {record.joiningDate ? <p className="text-xs text-slate-500">{record.joiningDate}</p> : null}
                      </div>
                      <div>
                        <p>{record.phone || 'No phone'}</p>
                        {record.email ? <p className="text-xs text-slate-500 break-all">{record.email}</p> : null}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setViewingRecord(record)}
                          className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-100"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          Details
                        </button>
                        <button
                          type="button"
                          onClick={() => startEdit(record)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteRecord(record)}
                          className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 px-6 py-10 text-center text-sm text-slate-500">
              Staff directory mein abhi koi matching record nahi hai.
            </div>
          )}
        </section>
      </div>

      {editingRecord && editForm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4">
          <div className="w-full max-w-3xl rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-2xl font-bold text-slate-900">Edit Staff</h3>
                <p className="mt-1 text-sm text-slate-500">Directory aur supported backend fields dono update honge.</p>
              </div>
              <button type="button" onClick={closeEdit} className="rounded-full p-2 text-slate-500 hover:bg-slate-100">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="mt-6 grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <label className={editLabelClass}>Photo</label>
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-center gap-3">
                    {editForm.photoDataUrl ? (
                      <img src={editForm.photoDataUrl} alt={editForm.fullName} className="h-16 w-16 rounded-full object-cover ring-2 ring-slate-200" />
                    ) : (
                      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-200 text-lg font-bold text-slate-700 ring-2 ring-slate-200">
                        {(editForm.fullName.trim().charAt(0).toUpperCase() || 'S')}
                      </div>
                    )}
                    <p className="text-sm text-slate-500">Photo optional hai. Chaaho to upload karo, nahi to bina photo ke bhi save ho jayega.</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">
                      Upload Photo
                      <input type="file" accept="image/*" className="hidden" onChange={handleEditPhotoChange} />
                    </label>
                    {editForm.photoDataUrl ? (
                      <button
                        type="button"
                        onClick={() => setEditForm({ ...editForm, photoDataUrl: '' })}
                        className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100"
                      >
                        Remove Photo
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
              <div>
                <label className={editLabelClass}>Staff Type</label>
                <select
                  value={editForm.staffType}
                  onChange={(e) => setEditForm({ ...editForm, staffType: e.target.value as 'teaching' | 'non_teaching' })}
                  className={inputClass}
                >
                  <option value="teaching">Teaching</option>
                  <option value="non_teaching">Non-Teaching</option>
                </select>
              </div>
              <div>
                <label className={editLabelClass}>Full Name</label>
                <input value={editForm.fullName} onChange={(e) => setEditForm({ ...editForm, fullName: e.target.value })} className={inputClass} placeholder="Full name" />
              </div>
              <div>
                <label className={editLabelClass}>Category</label>
                <input value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })} className={inputClass} placeholder="Category" />
              </div>
              <div>
                <label className={editLabelClass}>Employee ID</label>
                <input value={editForm.employeeId} onChange={(e) => setEditForm({ ...editForm, employeeId: e.target.value })} className={inputClass} placeholder="Employee ID" />
              </div>
              <div>
                <label className={editLabelClass}>Subject</label>
                <input value={editForm.subject} onChange={(e) => setEditForm({ ...editForm, subject: e.target.value })} className={inputClass} placeholder="Subject" />
              </div>
              <div>
                <label className={editLabelClass}>Department</label>
                <input value={editForm.department} onChange={(e) => setEditForm({ ...editForm, department: e.target.value })} className={inputClass} placeholder="Department" />
              </div>
              <div>
                <label className={editLabelClass}>Designation</label>
                <input value={editForm.designation} onChange={(e) => setEditForm({ ...editForm, designation: e.target.value })} className={inputClass} placeholder="Designation" />
              </div>
              <div>
                <label className={editLabelClass}>Phone</label>
                <input value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} className={inputClass} placeholder="Phone" />
              </div>
              <div>
                <label className={editLabelClass}>Email</label>
                <input value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} className={inputClass} placeholder="Email" />
              </div>
              <div>
                <label className={editLabelClass}>Joining Date</label>
                <input type="date" value={editForm.joiningDate} onChange={(e) => setEditForm({ ...editForm, joiningDate: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label className={editLabelClass}>Shift Timing</label>
                <input value={editForm.shiftTiming} onChange={(e) => setEditForm({ ...editForm, shiftTiming: e.target.value })} className={inputClass} placeholder="Shift timing" />
              </div>
              <label className="md:col-span-2 flex items-center gap-2 rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                <input type="checkbox" checked={editForm.isActive} onChange={(e) => setEditForm({ ...editForm, isActive: e.target.checked })} />
                Active staff
              </label>
              <div className="md:col-span-2 flex justify-end gap-3">
                <button type="button" onClick={closeEdit} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">
                  Cancel
                </button>
                <button type="submit" disabled={saving} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60">
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {viewingRecord ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4">
          <div className="w-full max-w-5xl rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-4">
                <StaffAvatar record={viewingRecord} />
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.28em] text-slate-400">Staff Full Details</p>
                  <h3 className="mt-2 text-2xl font-bold text-slate-900">{viewingRecord.fullName}</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    {viewingRecord.staffType === 'teaching' ? 'Teaching Staff' : 'Non-Teaching Staff'}
                  </p>
                </div>
              </div>
              <button type="button" onClick={() => setViewingRecord(null)} className="rounded-full p-2 text-slate-500 hover:bg-slate-100">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-6 grid max-h-[70vh] gap-5 overflow-y-auto pr-1 md:grid-cols-2">
              <DetailCard title="Basic Profile">
                <DetailItem label="Full Name" value={viewingRecord.fullName} />
                <DetailItem label="Category" value={viewingRecord.category} />
                <DetailItem label="Employee ID" value={viewingRecord.employeeId} />
                <DetailItem label="Subject" value={viewingRecord.subject} />
                <DetailItem label="Department" value={viewingRecord.department} />
                <DetailItem label="Designation" value={viewingRecord.designation} />
                <DetailItem label="Joining Date" value={viewingRecord.joiningDate} />
                <DetailItem label="Shift Timing" value={viewingRecord.shiftTiming} />
                <DetailItem label="Status" value={viewingRecord.isActive ? 'Active' : 'Inactive'} />
              </DetailCard>

              <DetailCard title="Personal Details">
                <DetailItem label="Date Of Birth" value={viewingRecord.details?.dob} />
                <DetailItem label="Gender" value={viewingRecord.details?.gender} />
                <DetailItem label="Marital Status" value={viewingRecord.details?.maritalStatus} />
                <DetailItem label="Blood Group" value={viewingRecord.details?.bloodGroup} />
                <DetailItem label="Aadhaar Number" value={viewingRecord.details?.aadhaarNumber} />
                <DetailItem label="PAN Number" value={viewingRecord.details?.panNumber} />
                <DetailItem label="School Name" value={viewingRecord.details?.schoolName} />
              </DetailCard>

              <DetailCard title="Contact Details">
                <DetailItem label="Primary Mobile" value={viewingRecord.details?.primaryMobile || viewingRecord.phone} />
                <DetailItem label="WhatsApp Number" value={viewingRecord.details?.whatsappNumber} />
                <DetailItem label="Email" value={viewingRecord.email} />
                <DetailItem label="Address Line 1" value={viewingRecord.details?.addressLine1} />
                <DetailItem label="Address Line 2" value={viewingRecord.details?.addressLine2} />
                <DetailItem label="City" value={viewingRecord.details?.city} />
                <DetailItem label="State" value={viewingRecord.details?.state} />
                <DetailItem label="Country" value={viewingRecord.details?.country} />
                <DetailItem label="Pin Code" value={viewingRecord.details?.pinCode} />
              </DetailCard>

              <DetailCard title="Family Details">
                <DetailItem label="Father Name" value={viewingRecord.details?.fatherName} />
                <DetailItem label="Father Contact" value={viewingRecord.details?.fatherContact} />
                <DetailItem label="Mother Name" value={viewingRecord.details?.motherName} />
                <DetailItem label="Mother Contact" value={viewingRecord.details?.motherContact} />
                <DetailItem label="Spouse Name" value={viewingRecord.details?.spouseName} />
              </DetailCard>

              <DetailCard title="Emergency Details">
                <DetailItem label="Contact Name" value={viewingRecord.details?.emergencyContactName} />
                <DetailItem label="Contact Number" value={viewingRecord.details?.emergencyContactNumber} />
                <DetailItem label="Relation" value={viewingRecord.details?.emergencyRelation} />
              </DetailCard>

              <DetailCard title="Salary & Bank">
                <DetailItem label="Monthly Salary" value={viewingRecord.details?.monthlySalary} />
                <DetailItem label="Account Number" value={viewingRecord.details?.accountNumber} />
                <DetailItem label="IFSC Code" value={viewingRecord.details?.ifscCode} />
                <DetailItem label="Bank Name" value={viewingRecord.details?.bankName} />
                <DetailItem label="Notes" value={viewingRecord.details?.notes} multiline />
              </DetailCard>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => navigate('/staff/add', { state: { editingRecord: viewingRecord, returnStaffType: staffType } })}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              >
                Edit Full Form
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-bold text-slate-900">{value}</p>
    </div>
  );
}

function StaffAvatar({ record }: { record: StaffDirectoryRecord }) {
  if (record.photoDataUrl) {
    return <img src={record.photoDataUrl} alt={record.fullName} className="h-11 w-11 rounded-full object-cover ring-2 ring-slate-200" />;
  }

  const initial = record.fullName.trim().charAt(0).toUpperCase() || 'S';
  return (
    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-200 text-sm font-bold text-slate-700 ring-2 ring-slate-200">
      {initial}
    </div>
  );
}

function DetailCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <h4 className="mb-3 text-sm font-bold text-slate-900">{title}</h4>
      <div className="grid gap-3">{children}</div>
    </section>
  );
}

function DetailItem({
  label,
  value,
  multiline = false,
}: {
  label: string;
  value?: string;
  multiline?: boolean;
}) {
  return (
    <div>
      <p className={detailLabelClass}>{label}</p>
      <p className={`mt-1 text-sm text-slate-700 ${multiline ? 'whitespace-pre-wrap' : ''}`}>{value || '-'}</p>
    </div>
  );
}
