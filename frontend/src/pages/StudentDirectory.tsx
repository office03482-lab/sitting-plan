// @ts-nocheck
import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Camera, ChevronLeft, Eye, Pencil, Search, Trash2, X } from 'lucide-react';
import { apiService } from '@services/api';
import type { Batch, Student } from '@types';
import {
  readEduPayAdmissionRequests,
  readEduPayStudentProfiles,
  upsertEduPayAdmissionRequest,
  type EduPayAdmissionSnapshot,
} from '@utils/eduPayAdmissions';
import {
  getStudentPhoto,
  getStudentSession,
  readStudentSessionOptions,
  removeStudentPhoto,
  removeStudentSession,
  setStudentSession,
  setStudentPhoto,
} from '@utils/studentDirectory';

const inputClass =
  'w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-900 focus:ring-4 focus:ring-slate-200/70';
const labelClass = 'mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500';
const detailLabelClass = 'text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400';

type EditFormState = {
  name: string;
  rollNumber: string;
  fatherName: string;
  batch: string;
  className: string;
  section: string;
  academicSession: string;
  email: string;
  phone: string;
  specialNeeds: string;
  isActive: boolean;
  photoDataUrl: string;
};

const safeText = (value: unknown) => (value == null ? '' : String(value).trim());
const looksLikeBatchName = (value: string) => {
  const normalized = safeText(value).toLowerCase();
  if (!normalized) return false;
  return [
    'med',
    'medical',
    'non med',
    'non medical',
    'newton',
    'aiims',
    'neet',
    'jee',
    'advance',
    'adv',
    'ssb',
    'sure selection',
    'dropper',
    'pcm',
    'pcb',
    'batch',
  ].some((keyword) => normalized.includes(keyword));
};
const getSafeStudentClassName = (student: Pick<Student, 'class_name' | 'batch'>) => {
  const className = safeText(student.class_name);
  const batchName = safeText(student.batch);
  if (!className) return '';
  if (looksLikeBatchName(className)) return '';
  if (batchName && className.toLowerCase() === batchName.toLowerCase()) return '';
  return className;
};
const getStudentClassLabel = (student: Pick<Student, 'class_name' | 'section' | 'batch'>) =>
  [getSafeStudentClassName(student), safeText(student.section)].filter(Boolean).join(' | ');

type StudentDetailsState = {
  student: Student;
  localDetails?: Record<string, unknown>;
};

const normalizeStudent = (student: any): Student => ({
  ...student,
  id: Number(student?.id ?? 0),
  roll_number: safeText(student?.roll_number || student?.rollNo || student?.roll_no),
  name: safeText(student?.name),
  father_name: safeText(student?.father_name || student?.fatherName) || undefined,
  batch: safeText(student?.batch),
  class_name: getSafeStudentClassName({
    class_name: student?.class_name || student?.className,
    batch: student?.batch,
  }) || undefined,
  section: safeText(student?.section) || undefined,
  academic_session: safeText(student?.academic_session || student?.academicSession) || undefined,
  email: safeText(student?.email) || undefined,
  phone: safeText(student?.phone) || undefined,
  special_needs: safeText(student?.special_needs || student?.specialNeeds) || undefined,
  is_active: Boolean(student?.is_active ?? student?.isActive ?? true),
});

const toEditForm = (student: Student): EditFormState => ({
  name: student.name,
  rollNumber: student.roll_number,
  fatherName: student.father_name || '',
  batch: student.batch,
  className: student.class_name || '',
  section: student.section || '',
  academicSession: student.academic_session || getStudentSession(student.id, student.roll_number) || '',
  email: student.email || '',
  phone: student.phone || '',
  specialNeeds: student.special_needs || '',
  isActive: student.is_active,
  photoDataUrl: getStudentPhoto(student.id, student.roll_number),
});

function StudentAvatar({ student, className = 'h-14 w-14' }: { student: Student; className?: string }) {
  const photo = getStudentPhoto(student.id, student.roll_number);
  if (photo) {
    return <img src={photo} alt={student.name} className={`${className} rounded-full object-cover`} />;
  }
  return (
    <div className={`${className} flex items-center justify-center rounded-full bg-slate-200 text-base font-bold text-slate-600`}>
      {(student.name.trim()[0] || 'S').toUpperCase()}
    </div>
  );
}

export default function StudentDirectory() {
  const navigate = useNavigate();
  const [students, setStudents] = useState<Student[]>([]);
  const [classBatches, setClassBatches] = useState<Batch[]>([]);
  const [search, setSearch] = useState('');
  const [batchFilter, setBatchFilter] = useState('all');
  const [classFilter, setClassFilter] = useState('all');
  const [sessionFilter, setSessionFilter] = useState('all');
  const [viewMode, setViewMode] = useState<'card' | 'row'>('card');
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error'>('success');
  const [editingStudent, setEditingStudent] = useState<Student | null>(null);
  const [editForm, setEditForm] = useState<EditFormState | null>(null);
  const [viewingDetails, setViewingDetails] = useState<StudentDetailsState | null>(null);
  const [saving, setSaving] = useState(false);

  const loadStudents = async () => {
    try {
      const response = await apiService.listStudents();
      const nextStudents = Array.isArray(response.data)
        ? response.data.map(normalizeStudent).filter((student) => student.id > 0 && (student.name || student.roll_number))
        : [];
      setStudents(nextStudents);
    } catch (error: any) {
      showMessage(error?.response?.data?.detail || 'Students load nahi ho paaye.', 'error');
    }
  };

  const loadClassBatches = async () => {
    try {
      const [classResponse, batchResponse] = await Promise.all([
        apiService.listBatches(1, undefined, 'class'),
        apiService.listBatches(1, undefined, 'batch'),
      ]);
      const regularBatchNames = new Set(
        (Array.isArray(batchResponse.data) ? batchResponse.data : []).map((batch) => safeText(batch.name).toLowerCase()),
      );
      const nextClassBatches = (Array.isArray(classResponse.data) ? classResponse.data : []).filter(
        (batch) => !regularBatchNames.has(safeText(batch.name).toLowerCase()),
      );
      setClassBatches(nextClassBatches);
    } catch {
      setClassBatches([]);
    }
  };

  useEffect(() => {
    void loadStudents();
    void loadClassBatches();
  }, []);

  const showMessage = (nextMessage: string, type: 'success' | 'error' = 'success') => {
    setMessage(nextMessage);
    setMessageType(type);
    window.setTimeout(() => setMessage(''), 3000);
  };

  const batchOptions = useMemo(
    () => Array.from(new Set(students.map((student) => safeText(student.batch)).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [students],
  );
  const classOptions = useMemo(
    () =>
      Array.from(new Set(classBatches.map((batch) => safeText(batch.name)).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [classBatches],
  );
  const sessionOptions = useMemo(() => {
    const mappedSessions = students
      .map((student) => safeText(student.academic_session || getStudentSession(student.id, student.roll_number)))
      .filter(Boolean);
    return Array.from(new Set([...readStudentSessionOptions(), ...mappedSessions])).sort((a, b) => a.localeCompare(b));
  }, [students]);

  const filteredStudents = useMemo(() => {
    const query = search.trim().toLowerCase();
    return students.filter((student) => {
      const batchLabel = safeText(student.batch);
      const name = safeText(student.name).toLowerCase();
      const rollNumber = safeText(student.roll_number).toLowerCase();
      const fatherName = safeText(student.father_name).toLowerCase();
      const email = safeText(student.email).toLowerCase();
      const phone = safeText(student.phone).toLowerCase();
      const matchesBatch = batchFilter === 'all' || batchLabel === batchFilter;
      const className = getSafeStudentClassName(student);
      const classLabel = getStudentClassLabel(student);
      const matchesClass = classFilter === 'all' || className === classFilter;
      const studentSession = safeText(student.academic_session || getStudentSession(student.id, student.roll_number));
      const matchesSession = sessionFilter === 'all' || studentSession === sessionFilter;
      const matchesSearch =
        !query ||
        name.includes(query) ||
        rollNumber.includes(query) ||
        fatherName.includes(query) ||
        email.includes(query) ||
        phone.includes(query) ||
        classLabel.toLowerCase().includes(query);
      return matchesBatch && matchesClass && matchesSession && matchesSearch;
    });
  }, [students, search, batchFilter, classFilter, sessionFilter]);

  const openEdit = (student: Student) => {
    setEditingStudent(student);
    setEditForm(toEditForm(student));
  };

  const openDetails = async (student: Student) => {
    const requests = readEduPayAdmissionRequests();
    const profiles = readEduPayStudentProfiles();
    const localRequestMatch = requests.find(
      (item) => item.linkedStudentId === student.id || item.linkedStudentRollNumber === student.roll_number,
    );
    const localProfileMatch = profiles.find(
      (item) =>
        item.edupayStudentId === student.id ||
        item.admissionNo === student.roll_number ||
        item.details.rollNumber === student.roll_number,
    );
    const localDetails =
      (localRequestMatch?.details as Record<string, unknown> | undefined) ||
      (localProfileMatch?.details as Record<string, unknown> | undefined);

    try {
      const response = await apiService.getStudent(student.id);
      setViewingDetails({
        student: normalizeStudent(response.data),
        localDetails,
      });
    } catch {
      setViewingDetails({
        student,
        localDetails,
      });
      showMessage('Full details local record se dikhaye gaye hain.', 'success');
    }
  };

  const closeEdit = () => {
    setEditingStudent(null);
    setEditForm(null);
  };

  const handleEditPhotoChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setEditForm((current) => (current ? { ...current, photoDataUrl: reader.result } : current));
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingStudent || !editForm) return;
    if (!editForm.name.trim() || !editForm.rollNumber.trim() || !editForm.batch.trim()) {
      showMessage('Name, roll number aur batch required hain.', 'error');
      return;
    }

    try {
      setSaving(true);
      const trimmedName = editForm.name.trim();
      const trimmedRollNumber = editForm.rollNumber.trim();
      const trimmedBatch = editForm.batch.trim();
      const trimmedClassName = editForm.className.trim();
      const trimmedSection = editForm.section.trim();
      const trimmedSession = editForm.academicSession.trim();
      const trimmedFatherName = editForm.fatherName.trim();
      const trimmedEmail = editForm.email.trim();
      const trimmedPhone = editForm.phone.trim();
      const trimmedSpecialNeeds = editForm.specialNeeds.trim();

      await apiService.updateStudent(editingStudent.id, {
        name: trimmedName,
        roll_number: trimmedRollNumber,
        father_name: (trimmedFatherName || null) as unknown as string | undefined,
        batch: trimmedBatch,
        class_name: (trimmedClassName || null) as unknown as string | undefined,
        section: (trimmedSection || null) as unknown as string | undefined,
        academic_session: (trimmedSession || null) as unknown as string | undefined,
        email: (trimmedEmail || null) as unknown as string | undefined,
        phone: (trimmedPhone || null) as unknown as string | undefined,
        special_needs: (trimmedSpecialNeeds || null) as unknown as string | undefined,
        is_active: editForm.isActive,
      });
      if (editForm.photoDataUrl.trim()) {
        if (editingStudent.roll_number !== trimmedRollNumber) {
          removeStudentPhoto(editingStudent.id, editingStudent.roll_number);
        }
        setStudentPhoto(editForm.photoDataUrl, editingStudent.id, trimmedRollNumber);
      } else {
        removeStudentPhoto(editingStudent.id, editingStudent.roll_number);
        removeStudentPhoto(editingStudent.id, trimmedRollNumber);
      }
      if (trimmedSession) {
        if (editingStudent.roll_number !== trimmedRollNumber) {
          removeStudentSession(editingStudent.id, editingStudent.roll_number);
        }
        setStudentSession(trimmedSession, editingStudent.id, trimmedRollNumber);
      } else {
        removeStudentSession(editingStudent.id, editingStudent.roll_number);
        removeStudentSession(editingStudent.id, trimmedRollNumber);
      }
      const existingRequest = readEduPayAdmissionRequests().find(
        (item) => item.linkedStudentId === editingStudent.id || item.linkedStudentRollNumber === editingStudent.roll_number,
      );
      const existingDetails = (existingRequest?.details || {}) as Partial<EduPayAdmissionSnapshot>;
      const nameParts = trimmedName.split(/\s+/).filter(Boolean);
      const nextSnapshot: EduPayAdmissionSnapshot = {
        ...(existingDetails as EduPayAdmissionSnapshot),
        admissionId: safeText(existingDetails.admissionId),
        academicYear: trimmedSession || safeText(existingDetails.academicYear),
        course: (existingDetails.course as EduPayAdmissionSnapshot['course']) || '',
        program: (existingDetails.program as EduPayAdmissionSnapshot['program']) || '',
        managedBatch: trimmedBatch,
        className: trimmedClassName,
        section: trimmedSection,
        rollNumber: trimmedRollNumber,
        firstName: nameParts[0] || safeText(existingDetails.firstName),
        middleName:
          nameParts.length > 2 ? nameParts.slice(1, -1).join(' ') : safeText(existingDetails.middleName) || undefined,
        lastName:
          nameParts.length > 1 ? nameParts[nameParts.length - 1] : safeText(existingDetails.lastName) || undefined,
        fullName: trimmedName,
        email: trimmedEmail,
        phone: trimmedPhone,
        fatherName: trimmedFatherName,
        specialNeeds: trimmedSpecialNeeds,
        priorityContact:
          existingDetails.priorityContact === 'mother' || existingDetails.priorityContact === 'guardian'
            ? existingDetails.priorityContact
            : 'father',
        photoDataUrl: editForm.photoDataUrl.trim() || undefined,
      };
      upsertEduPayAdmissionRequest({
        source: 'admin_request',
        status: existingRequest?.status || 'processed',
        linkedStudentId: editingStudent.id,
        linkedStudentRollNumber: trimmedRollNumber,
        details: nextSnapshot,
      });
      await loadStudents();
      closeEdit();
      showMessage('Student updated successfully.');
    } catch (error: any) {
      showMessage(error?.response?.data?.detail || 'Student update failed.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteStudent = async (student: Student) => {
    if (!window.confirm(`${student.name} ko delete karna hai?`)) return;
    try {
      await apiService.deleteStudent(student.id);
      removeStudentPhoto(student.id, student.roll_number);
      removeStudentSession(student.id, student.roll_number);
      await loadStudents();
      showMessage('Student deleted successfully.');
    } catch (error: any) {
      showMessage(error?.response?.data?.detail || 'Student delete failed.', 'error');
    }
  };

  const handleDeleteAll = async () => {
    if (!filteredStudents.length) return;
    if (!window.confirm('Current filtered students delete karne hain?')) return;

    try {
      setSaving(true);
      for (const student of filteredStudents) {
        await apiService.deleteStudent(student.id);
        removeStudentPhoto(student.id, student.roll_number);
        removeStudentSession(student.id, student.roll_number);
      }
      await loadStudents();
      showMessage('Selected students deleted successfully.');
    } catch (error: any) {
      showMessage(error?.response?.data?.detail || 'Delete all failed.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const activeCount = filteredStudents.filter((student) => student.is_active).length;

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-col gap-4 rounded-[1.75rem] bg-white p-6 shadow-sm lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.28em] text-slate-400">Student Directory</p>
            <h1 className="mt-2 text-3xl font-bold text-slate-900">Student records ek jagah</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-500">Yahan add student aur bulk upload se aaye hue students ko edit, delete aur filter kar sakte ho.</p>
          </div>
          <div />
        </div>

        {message ? (
          <div
            className={`mb-4 rounded-2xl border px-4 py-3 text-sm ${
              messageType === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-rose-200 bg-rose-50 text-rose-700'
            }`}
          >
            {message}
          </div>
        ) : null}

          <div className="mb-4 grid gap-4 md:grid-cols-4">
            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <p className="text-sm text-slate-500">Total Students</p>
              <p className="mt-2 text-3xl font-bold text-slate-900">{filteredStudents.length}</p>
            </div>
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-500">Active Students</p>
            <p className="mt-2 text-3xl font-bold text-slate-900">{activeCount}</p>
          </div>
            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <p className="text-sm text-slate-500">Sessions</p>
              <p className="mt-2 text-3xl font-bold text-slate-900">{sessionOptions.length}</p>
            </div>
            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <p className="text-sm text-slate-500">Classes</p>
              <p className="mt-2 text-3xl font-bold text-slate-900">{classOptions.length}</p>
            </div>
          </div>

        <div className="rounded-[1.75rem] bg-white p-5 shadow-sm">
          <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="grid flex-1 gap-3 md:grid-cols-[1.3fr_0.9fr_0.9fr_0.9fr_0.8fr]">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search by name, roll number, father name, email..."
                  className="w-full rounded-xl border border-slate-300 bg-white py-3 pl-11 pr-4 text-sm text-slate-900 outline-none focus:border-slate-900 focus:ring-4 focus:ring-slate-200/70"
                />
              </label>
              <select
                value={batchFilter}
                onChange={(event) => setBatchFilter(event.target.value)}
                className={inputClass}
              >
                <option value="all">All Batches</option>
                {batchOptions.map((batch) => (
                  <option key={batch} value={batch}>
                    {batch}
                  </option>
                ))}
              </select>
              <select
                value={classFilter}
                onChange={(event) => setClassFilter(event.target.value)}
                className={inputClass}
              >
                <option value="all">All Classes</option>
                {classOptions.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
              <select
                value={sessionFilter}
                onChange={(event) => setSessionFilter(event.target.value)}
                className={inputClass}
              >
                <option value="all">All Sessions</option>
                {sessionOptions.map((session) => (
                  <option key={session} value={session}>
                    {session}
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setViewMode('card')}
                  className={`rounded-xl px-4 py-3 text-sm font-semibold ${viewMode === 'card' ? 'bg-slate-900 text-white' : 'border border-slate-300 bg-white text-slate-700'}`}
                >
                  Card View
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('row')}
                  className={`rounded-xl px-4 py-3 text-sm font-semibold ${viewMode === 'row' ? 'bg-slate-900 text-white' : 'border border-slate-300 bg-white text-slate-700'}`}
                >
                  Row View
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={handleDeleteAll}
              disabled={!filteredStudents.length || saving}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Trash2 className="h-4 w-4" />
              Delete All
            </button>
          </div>

          {viewMode === 'card' ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filteredStudents.map((student) => (
                <article key={student.id} className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-5">
                  {(() => {
                    const session = student.academic_session || getStudentSession(student.id, student.roll_number);
                    return (
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex min-w-0 items-start gap-3">
                      <StudentAvatar student={student} />
                      <div className="min-w-0">
                        <p className="truncate text-lg font-bold text-slate-900">{student.name}</p>
                        <p className="mt-1 text-sm text-slate-500">Roll No: {student.roll_number}</p>
                        <p className="mt-1 text-sm text-slate-500">{student.batch}</p>
                        <p className="mt-1 text-xs font-semibold text-slate-500">{getStudentClassLabel(student) || 'Class not set'}</p>
                        <p className="mt-1 text-xs font-medium text-slate-400">{session || 'No session set'}</p>
                      </div>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${student.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                      {student.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                    );
                  })()}
                  <div className="mt-4 space-y-1 text-sm text-slate-600">
                    <p>Father: {student.father_name || '-'}</p>
                    <p>Email: {student.email || '-'}</p>
                    <p>Phone: {student.phone || '-'}</p>
                    <p>Special Needs: {student.special_needs || '-'}</p>
                  </div>
                  <div className="mt-5 flex gap-2">
                    <button
                      type="button"
                      onClick={() => openDetails(student)}
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-700 hover:bg-amber-100"
                    >
                      <Eye className="h-4 w-4" />
                      Full Details
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteStudent(student)}
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700 hover:bg-rose-100"
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[980px] overflow-hidden rounded-[1.5rem] border border-slate-200">
                <div className="grid grid-cols-[1.2fr_0.8fr_1fr_0.9fr_1fr_1fr_0.8fr_0.8fr] bg-slate-100 px-4 py-3 text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
                  <span>Student</span>
                  <span>Roll No</span>
                  <span>Batch</span>
                  <span>Class</span>
                  <span>Session</span>
                  <span>Father / Phone</span>
                  <span>Email / Needs</span>
                  <span>Action</span>
                </div>
                {filteredStudents.map((student) => (
                  <div key={student.id} className="grid grid-cols-[1.2fr_0.8fr_1fr_0.9fr_1fr_1fr_0.8fr_0.8fr] items-center gap-4 border-t border-slate-200 bg-white px-4 py-4 text-sm text-slate-700">
                    <div className="flex items-center gap-3">
                      <StudentAvatar student={student} className="h-11 w-11" />
                      <div>
                        <p className="font-semibold text-slate-900">{student.name}</p>
                        <p className="mt-1 text-xs text-slate-500">{student.is_active ? 'Active' : 'Inactive'}</p>
                      </div>
                    </div>
                    <span>{student.roll_number}</span>
                    <span>{student.batch}</span>
                    <span>{getStudentClassLabel(student) || '-'}</span>
                    <span>{student.academic_session || getStudentSession(student.id, student.roll_number) || '-'}</span>
                    <div>
                      <p>{student.father_name || '-'}</p>
                      <p className="mt-1 text-xs text-slate-500">{student.phone || '-'}</p>
                    </div>
                    <div>
                      <p>{student.email || '-'}</p>
                      <p className="mt-1 text-xs text-slate-500">{student.special_needs || '-'}</p>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => openDetails(student)} className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-amber-700 hover:bg-amber-100" title="Full details">
                        <Eye className="h-4 w-4" />
                      </button>
                      <button type="button" onClick={() => handleDeleteStudent(student)} className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-rose-700 hover:bg-rose-100" title="Delete">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!filteredStudents.length ? (
            <div className="rounded-[1.5rem] border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center text-sm text-slate-500">
              Abhi koi student record available nahi hai.
            </div>
          ) : null}
        </div>
      </div>

      {viewingDetails ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4">
          <div className="w-full max-w-5xl rounded-[1.75rem] bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-4">
                <StudentAvatar student={viewingDetails.student} className="h-16 w-16" />
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.28em] text-slate-400">Student Full Details</p>
                  <h2 className="mt-2 text-2xl font-bold text-slate-900">{viewingDetails.student.name}</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Roll No: {viewingDetails.student.roll_number} | Batch: {viewingDetails.student.batch} | Class: {getStudentClassLabel(viewingDetails.student) || '-'}
                  </p>
                </div>
              </div>
              <button type="button" onClick={() => setViewingDetails(null)} className="rounded-full p-2 text-slate-500 hover:bg-slate-100">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-6 grid max-h-[70vh] gap-5 overflow-y-auto pr-1 md:grid-cols-2">
              <DetailCard title="Basic Details">
                <DetailItem label="Full Name" value={safeText(viewingDetails.localDetails?.fullName || viewingDetails.student.name)} />
                <DetailItem label="Admission ID" value={safeText(viewingDetails.localDetails?.admissionId)} />
                <DetailItem label="Roll Number" value={safeText(viewingDetails.localDetails?.rollNumber || viewingDetails.student.roll_number)} />
                <DetailItem label="Academic Year" value={safeText(viewingDetails.localDetails?.academicYear || viewingDetails.student.academic_session)} />
                <DetailItem label="Class / Batch" value={safeText(viewingDetails.localDetails?.managedBatch || viewingDetails.student.batch)} />
                <DetailItem label="Class Name" value={safeText(viewingDetails.localDetails?.className || viewingDetails.student.class_name)} />
                <DetailItem label="Section" value={safeText(viewingDetails.localDetails?.section || viewingDetails.student.section)} />
                <DetailItem label="Admission Date" value={safeText(viewingDetails.localDetails?.admissionDate)} />
                <DetailItem label="Admission Type" value={safeText(viewingDetails.localDetails?.admissionType)} />
              </DetailCard>

              <DetailCard title="Personal Details">
                <DetailItem label="First Name" value={safeText(viewingDetails.localDetails?.firstName)} />
                <DetailItem label="Middle Name" value={safeText(viewingDetails.localDetails?.middleName)} />
                <DetailItem label="Last Name" value={safeText(viewingDetails.localDetails?.lastName)} />
                <DetailItem label="Local Name" value={safeText(viewingDetails.localDetails?.localName || viewingDetails.localDetails?.identifier)} />
                <DetailItem label="Age As Of Today" value={safeText(viewingDetails.localDetails?.ageAsOfToday)} />
                <DetailItem label="Date Of Birth" value={safeText(viewingDetails.localDetails?.dob)} />
                <DetailItem label="Gender" value={safeText(viewingDetails.localDetails?.gender)} />
                <DetailItem label="Phone" value={safeText(viewingDetails.localDetails?.phone || viewingDetails.student.phone)} />
                <DetailItem label="Email" value={safeText(viewingDetails.localDetails?.email || viewingDetails.student.email)} />
              </DetailCard>

              <DetailCard title="Family Details">
                <DetailItem label="Father Name" value={safeText(viewingDetails.localDetails?.fatherName || viewingDetails.student.father_name)} />
                <DetailItem label="Father Mobile" value={safeText(viewingDetails.localDetails?.fatherMobile)} />
                <DetailItem label="Father Occupation" value={safeText(viewingDetails.localDetails?.fatherOccupation)} />
                <DetailItem label="Mother Name" value={safeText(viewingDetails.localDetails?.motherName)} />
                <DetailItem label="Mother Mobile" value={safeText(viewingDetails.localDetails?.motherMobile)} />
                <DetailItem label="Mother Occupation" value={safeText(viewingDetails.localDetails?.motherOccupation)} />
              </DetailCard>

              <DetailCard title="Guardian & Emergency">
                <DetailItem label="Guardian Name" value={safeText(viewingDetails.localDetails?.guardianName)} />
                <DetailItem label="Guardian Relation" value={safeText(viewingDetails.localDetails?.guardianRelation)} />
                <DetailItem label="Guardian Mobile" value={safeText(viewingDetails.localDetails?.guardianMobile)} />
                <DetailItem label="Guardian Address" value={safeText(viewingDetails.localDetails?.guardianAddress)} multiline />
                <DetailItem label="Emergency Name" value={safeText(viewingDetails.localDetails?.emergencyName)} />
                <DetailItem label="Emergency Mobile" value={safeText(viewingDetails.localDetails?.emergencyMobile)} />
                <DetailItem label="Priority Contact" value={safeText(viewingDetails.localDetails?.priorityContact)} />
              </DetailCard>

              <DetailCard title="Address">
                <DetailItem label="Address Line 1" value={safeText(viewingDetails.localDetails?.address1)} />
                <DetailItem label="Address Line 2" value={safeText(viewingDetails.localDetails?.address2)} />
                <DetailItem label="City" value={safeText(viewingDetails.localDetails?.city)} />
                <DetailItem label="State" value={safeText(viewingDetails.localDetails?.state)} />
                <DetailItem label="Country" value={safeText(viewingDetails.localDetails?.country)} />
                <DetailItem label="Pincode" value={safeText(viewingDetails.localDetails?.pincode)} />
                <DetailItem label="Region" value={safeText(viewingDetails.localDetails?.region)} />
              </DetailCard>

              <DetailCard title="Academic & Other">
                <DetailItem label="Course" value={safeText(viewingDetails.localDetails?.course)} />
                <DetailItem label="Program" value={safeText(viewingDetails.localDetails?.program)} />
                <DetailItem label="Fee Schedule" value={safeText(viewingDetails.localDetails?.feeSchedule)} />
                <DetailItem label="TC Number" value={safeText(viewingDetails.localDetails?.tcNumber)} />
                <DetailItem label="Previous School" value={safeText(viewingDetails.localDetails?.previousSchool)} />
                <DetailItem label="Previous Board" value={safeText(viewingDetails.localDetails?.previousBoard)} />
                <DetailItem label="Previous Exam" value={safeText(viewingDetails.localDetails?.previousExam)} />
                <DetailItem label="Previous Percentage" value={safeText(viewingDetails.localDetails?.previousPercentage)} />
                <DetailItem label="Previous Total Marks" value={safeText(viewingDetails.localDetails?.previousTotalMarks)} />
                <DetailItem label="Previous Average" value={safeText(viewingDetails.localDetails?.previousAverage)} />
                <DetailItem label="Category" value={safeText(viewingDetails.localDetails?.category)} />
                <DetailItem label="Sub Category" value={safeText(viewingDetails.localDetails?.subCategory)} />
                <DetailItem label="Special Needs" value={safeText(viewingDetails.localDetails?.specialNeeds || viewingDetails.student.special_needs)} multiline />
                <DetailItem label="Boarding Type" value={safeText(viewingDetails.localDetails?.boardingType || viewingDetails.student.boarding_type)} />
              </DetailCard>

              <DetailCard title="Sibling & Transport">
                <DetailItem label="Sibling Name" value={safeText(viewingDetails.localDetails?.siblingName)} />
                <DetailItem label="Sibling School / Working" value={safeText(viewingDetails.localDetails?.siblingSchool)} />
                <DetailItem label="Pickup Enabled" value={safeText(viewingDetails.localDetails?.pickupEnabled)} />
                <DetailItem label="Drop Enabled" value={safeText(viewingDetails.localDetails?.dropEnabled)} />
                <DetailItem label="Transport Month" value={safeText(viewingDetails.localDetails?.transportMonth)} />
                <DetailItem label="Transport Route" value={safeText(viewingDetails.localDetails?.transportRoute)} />
                <DetailItem label="Transport Stop" value={safeText(viewingDetails.localDetails?.transportStop)} />
              </DetailCard>

              <DetailCard title="Hostel & Misc">
                <DetailItem label="Hostel Required" value={safeText(viewingDetails.student.hostel_required)} />
                <DetailItem label="Hostel Request Status" value={safeText(viewingDetails.student.hostel_request_status)} />
                <DetailItem label="Assigned Hostel" value={safeText(viewingDetails.student.assigned_hostel_name)} />
                <DetailItem label="Assigned Room" value={safeText(viewingDetails.student.assigned_room_number)} />
                <DetailItem label="Assigned Bed" value={safeText(viewingDetails.student.assigned_bed_label)} />
                <DetailItem label="Availing Mess Facility" value={safeText(viewingDetails.localDetails?.availingMessFacility)} />
                <DetailItem label="Reference Name" value={safeText(viewingDetails.student.reference_name)} />
                <DetailItem label="Reference Number" value={safeText(viewingDetails.student.reference_number)} />
                <DetailItem label="Reference Remark" value={safeText(viewingDetails.student.reference_remark)} multiline />
                <DetailItem label="Hostel Notes" value={safeText(viewingDetails.student.hostel_notes)} multiline />
              </DetailCard>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() =>
                  navigate('/students#add', {
                    state: {
                      directoryEditStudent: viewingDetails.student,
                      directoryEditDetails: viewingDetails.localDetails,
                    },
                  })
                }
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              >
                Edit
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DetailCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <h3 className="mb-3 text-sm font-bold text-slate-900">{title}</h3>
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
