import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { Upload, Download, RefreshCw, CheckCircle, XCircle, AlertTriangle, Edit2, Trash2, Plus, Camera, ExternalLink, FileText, X } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppStore } from '@store/app';
import { apiService } from '@services/api';
import type { Student, StudentImportResponse, Batch, Hostel } from '@types';
import {
  readEduPayAdmissionRequests,
  upsertEduPayAdmissionRequest,
  type EduPayAdmissionSnapshot,
} from '@utils/eduPayAdmissions';

type StudentDocument = {
  id: string;
  file: File;
  previewUrl: string;
};

type StudentCourse = '' | 'neet' | 'jee_main' | 'advance' | 'ssb';
type StudentProgram = '' | 'medical' | 'non_medical';

type StudentFormState = {
  admissionId: string;
  academicYear: string;
  program: StudentProgram;
  course: StudentCourse;
  managedBatch: string;
  firstName: string;
  middleName: string;
  lastName: string;
  localName: string;
  ageAsOfToday: string;
  dob: string;
  email: string;
  gender: string;
  phone: string;
  admissionDate: string;
  className: string;
  section: string;
  rollNumber: string;
  feeSchedule: string;
  tcNumber: string;
  pickupEnabled: boolean;
  dropEnabled: boolean;
  transportMonth: string;
  transportRoute: string;
  transportStop: string;
  previousSchool: string;
  previousExam: string;
  previousBoard: string;
  previousPercentage: string;
  previousTotalMarks: string;
  previousAverage: string;
  fatherName: string;
  fatherMobile: string;
  fatherOccupation: string;
  motherName: string;
  motherMobile: string;
  motherOccupation: string;
  category: string;
  subCategory: string;
  siblingName: string;
  siblingSchool: string;
  guardianName: string;
  guardianRelation: string;
  guardianMobile: string;
  guardianAddress: string;
  emergencyName: string;
  emergencyMobile: string;
  priorityContact: 'father' | 'mother' | 'guardian';
  address1: string;
  address2: string;
  city: string;
  state: string;
  country: string;
  pincode: string;
  region: string;
  referenceName: string;
  referenceNumber: string;
  referenceRemark: string;
  admissionType: 'old' | 'new';
  boardingType: string;
  specialNeeds: string;
  availingMessFacility: 'yes' | 'no';
  hostelRequired: boolean;
  preferredHostelId: string;
  hostelRequestNote: string;
  sendToEduPayRequest: boolean;
};

const studentInitialForm: StudentFormState = {
  admissionId: '',
  academicYear: 'Apr 2026 - Mar 2027',
  program: '',
  course: '',
  managedBatch: '',
  firstName: '',
  middleName: '',
  lastName: '',
  localName: '',
  ageAsOfToday: '',
  dob: '',
  email: '',
  gender: '',
  phone: '',
  admissionDate: new Date().toISOString().slice(0, 10),
  className: '',
  section: '',
  rollNumber: '',
  feeSchedule: '',
  tcNumber: '',
  pickupEnabled: false,
  dropEnabled: false,
  transportMonth: 'Apr-2026',
  transportRoute: '',
  transportStop: '',
  previousSchool: '',
  previousExam: '',
  previousBoard: '',
  previousPercentage: '',
  previousTotalMarks: '',
  previousAverage: '',
  fatherName: '',
  fatherMobile: '',
  fatherOccupation: '',
  motherName: '',
  motherMobile: '',
  motherOccupation: '',
  category: '',
  subCategory: '',
  siblingName: '',
  siblingSchool: '',
  guardianName: '',
  guardianRelation: '',
  guardianMobile: '',
  guardianAddress: '',
  emergencyName: '',
  emergencyMobile: '',
  priorityContact: 'father',
  address1: '',
  address2: '',
  city: '',
  state: '',
  country: 'India',
  pincode: '',
  region: '',
  referenceName: '',
  referenceNumber: '',
  referenceRemark: '',
  admissionType: 'new',
  boardingType: '',
  specialNeeds: '',
  availingMessFacility: 'no',
  hostelRequired: false,
  preferredHostelId: '',
  hostelRequestNote: '',
  sendToEduPayRequest: true,
};

const studentInputClass =
  'w-full rounded-lg border border-[#d8e2ec] bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-[#d58a17] focus:ring-2 focus:ring-[#f7d9a8]';
const studentLabelClass = 'mb-1.5 block text-[12px] font-semibold text-slate-700';
const DEFAULT_SESSION_OPTIONS = ['Apr 2026 - Mar 2027', 'Apr 2027 - Mar 2028'];

const normalizeBatchText = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const detectStudentProgramFromBatch = (batch: Pick<Batch, 'name' | 'syllabus'> | string): StudentProgram => {
  const rawValue = typeof batch === 'string' ? batch : `${batch.name} ${batch.syllabus || ''}`;
  const normalized = normalizeBatchText(rawValue);

  if (
    normalized.includes('non medical') ||
    normalized.includes('non med') ||
    normalized.includes('jee') ||
    normalized.includes('advance') ||
    normalized.includes('adv') ||
    normalized.includes('pcm')
  ) {
    return 'non_medical';
  }

  if (
    normalized.includes('medical') ||
    normalized.includes('neet') ||
    normalized.includes('aiims') ||
    normalized.includes('pcb') ||
    normalized.includes('bio')
  ) {
    return 'medical';
  }

  return '';
};

const inferStudentCourseFromBatch = (batch: Pick<Batch, 'name' | 'syllabus'> | string): StudentCourse => {
  const rawValue = typeof batch === 'string' ? batch : `${batch.name} ${batch.syllabus || ''}`;
  const normalized = normalizeBatchText(rawValue);

  if (normalized.includes('ssb') || normalized.includes('sure selection')) return 'ssb';
  if (normalized.includes('advance') || normalized.includes('adv')) return 'advance';
  if (normalized.includes('jee')) return 'jee_main';
  if (normalized.includes('neet') || (normalized.includes('medical') && normalized.includes('dropper'))) return 'neet';

  return '';
};

const deriveProgramFromCourse = (course: StudentCourse): StudentProgram => {
  if (course === 'neet') return 'medical';
  if (course === 'jee_main' || course === 'advance') return 'non_medical';
  return '';
};

const sortBatchNames = (items: string[]) => items.sort((a, b) => a.localeCompare(b));
const toNullableString = (value: string) => {
  const trimmed = value.trim();
  return trimmed || null;
};

const calculateAgeAsOfToday = (dob: string) => {
  if (!dob) return '';

  const birthDate = new Date(dob);
  if (Number.isNaN(birthDate.getTime())) return '';

  const today = new Date();
  let years = today.getFullYear() - birthDate.getFullYear();
  let months = today.getMonth() - birthDate.getMonth();
  let days = today.getDate() - birthDate.getDate();

  if (days < 0) {
    months -= 1;
    const previousMonth = new Date(today.getFullYear(), today.getMonth(), 0);
    days += previousMonth.getDate();
  }

  if (months < 0) {
    years -= 1;
    months += 12;
  }

  if (years < 0) return '';

  if (years === 0 && months === 0) {
    return `${Math.max(days, 0)} day${days === 1 ? '' : 's'}`;
  }

  if (years === 0) {
    return `${months} month${months === 1 ? '' : 's'}`;
  }

  return `${years} year${years === 1 ? '' : 's'}${months > 0 ? ` ${months} month${months === 1 ? '' : 's'}` : ''}`;
};

function StudentSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border border-[#e6ebf0] bg-white">
      <div className="border-b border-[#edf1f5] bg-[#f7f8fa] px-4 py-3">
        <h2 className="text-sm font-bold text-slate-800">{title}</h2>
      </div>
      <div className="p-4 md:p-5">{children}</div>
    </section>
  );
}

function StudentField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className={studentLabelClass}>{label}</label>
      {children}
    </div>
  );
}

export default function StudentManagement() {
  const navigate = useNavigate();
  const location = useLocation();
  const { students, setStudents } = useAppStore();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedBatch, setSelectedBatch] = useState('');
  const [batches, setBatches] = useState<Batch[]>([]);
  const [hostels, setHostels] = useState<Hostel[]>([]);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [importResult, setImportResult] = useState<StudentImportResponse | null>(null);
  const [deleteAllConfirm, setDeleteAllConfirm] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const [message, setMessage] = useState('');
  const [selectedStudentIds, setSelectedStudentIds] = useState<number[]>([]);
  const [transferTargetBatch, setTransferTargetBatch] = useState('');
  const [transferringSelected, setTransferringSelected] = useState(false);
  const [transferringBatch, setTransferringBatch] = useState(false);
  const [sendHostelRequestOnSubmit, setSendHostelRequestOnSubmit] = useState(false);
  const [sendToEduPayOnSubmit, setSendToEduPayOnSubmit] = useState(false);

  // Modal states
  const [showModal, setShowModal] = useState(false);
  const [editStudent, setEditStudent] = useState<Student | null>(null);
  const [studentForm, setStudentForm] = useState<StudentFormState>(studentInitialForm);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [studentPhotoPreviewUrl, setStudentPhotoPreviewUrl] = useState('');
  const [studentPhotoDataUrl, setStudentPhotoDataUrl] = useState('');
  const [studentDocuments, setStudentDocuments] = useState<StudentDocument[]>([]);
  const [studentCameraOpen, setStudentCameraOpen] = useState(false);
  const [studentCameraError, setStudentCameraError] = useState('');
  const [sessionOptions, setSessionOptions] = useState<string[]>(DEFAULT_SESSION_OPTIONS);
  const [newSessionValue, setNewSessionValue] = useState('');
  const studentPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const studentDocumentInputRef = useRef<HTMLInputElement | null>(null);
  const studentVideoRef = useRef<HTMLVideoElement | null>(null);
  const studentCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const studentMediaStreamRef = useRef<MediaStream | null>(null);
  const importSectionRef = useRef<HTMLDivElement | null>(null);
  const directorySectionRef = useRef<HTMLDivElement | null>(null);
  const skipNextAddAutoOpenRef = useRef(false);
  const isDedicatedAddView = location.hash === '#add';

  useEffect(() => {
    loadStudents();
    loadBatches();
    loadHostels();
  }, []);

  useEffect(() => {
    const refreshBatchDependencies = () => {
      if (document.visibilityState === 'visible') {
        void loadBatches();
      }
    };

    window.addEventListener('focus', refreshBatchDependencies);
    document.addEventListener('visibilitychange', refreshBatchDependencies);

    return () => {
      window.removeEventListener('focus', refreshBatchDependencies);
      document.removeEventListener('visibilitychange', refreshBatchDependencies);
    };
  }, []);

  useEffect(() => {
    const state = location.state as
      | {
          directoryEditStudent?: Student;
          directoryEditDetails?: Partial<EduPayAdmissionSnapshot>;
        }
      | undefined;

    if (location.hash === '#add') {
      if (skipNextAddAutoOpenRef.current) {
        skipNextAddAutoOpenRef.current = false;
        return;
      }
      if (state?.directoryEditStudent) return;
      setTimeout(() => openAddModal(), 0);
      return;
    }

    if (location.hash === '#bulk-upload') {
      setShowModal(false);
      setEditStudent(null);
      resetStudentForm();
      setTimeout(() => importSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
      return;
    }

    if (location.hash === '#directory') {
      setShowModal(false);
      setEditStudent(null);
      resetStudentForm();
      setTimeout(() => directorySectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    }
  }, [location.hash, location.state]);

  useEffect(() => {
    return () => {
      if (studentPhotoPreviewUrl) {
        URL.revokeObjectURL(studentPhotoPreviewUrl);
      }
      studentDocuments.forEach((document) => URL.revokeObjectURL(document.previewUrl));
      if (studentMediaStreamRef.current) {
        studentMediaStreamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, [studentPhotoPreviewUrl, studentDocuments]);

  useEffect(() => {
    if (!studentForm.dob) {
      if (studentForm.ageAsOfToday) {
        setStudentForm((current) => ({ ...current, ageAsOfToday: '' }));
      }
      return;
    }

    const nextAge = calculateAgeAsOfToday(studentForm.dob);
    if (nextAge !== studentForm.ageAsOfToday) {
      setStudentForm((current) => ({ ...current, ageAsOfToday: nextAge }));
    }
  }, [studentForm.dob, studentForm.ageAsOfToday]);

  const loadStudents = async () => {
    try {
      const response = await apiService.listStudents();
      setStudents(response.data);
      const sessions = response.data
        .map((student) => (typeof student?.academic_session === 'string' ? student.academic_session.trim() : ''))
        .filter(Boolean);
      setSessionOptions(Array.from(new Set([...DEFAULT_SESSION_OPTIONS, ...sessions])).sort((a, b) => a.localeCompare(b)));
    } catch (error) {
      console.error('Failed to load students:', error);
    }
  };

  const loadHostels = async () => {
    try {
      const response = await apiService.listHostels();
      setHostels(response.data);
    } catch (error) {
      console.error('Failed to load hostels:', error);
      setHostels([]);
    }
  };

  const loadBatches = async () => {
    try {
      const response = await apiService.listBatches();
      setBatches(response.data);
    } catch (error) {
      console.error('Failed to load batches:', error);
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      const response = await apiService.downloadStudentTemplate();
      const url = window.URL.createObjectURL(response.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'student_data_template.xlsx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to download template:', error);
      alert('Failed to download template. Please try again.');
    }
  };

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.name.toLowerCase().endsWith('.xlsx')) {
        alert('Please select a valid Excel file (.xlsx)');
        return;
      }
      setUploadedFile(file);
      setImportResult(null);
    }
  };

  const handleImportStudents = async () => {
    if (!uploadedFile) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', uploadedFile);
      const response = await apiService.importStudents(formData);
      setImportResult(response.data);

      if (response.data.imported_count > 0) {
        // Reload students
        await loadStudents();
        setUploadedFile(null);
      }
    } catch (error: any) {
      console.error('Import failed:', error);
      setImportResult({
        imported_count: 0,
        skipped_count: 0,
        errors: [{ error: error.response?.data?.detail || 'Import failed' }],
        message: 'Import error'
      });
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteAllStudents = async () => {
    if (!deleteAllConfirm) return;

    setDeletingAll(true);
    try {
      await apiService.deleteAllStudents(true); // is_admin=true
      setStudents([]);
      setDeleteAllConfirm(false);
      setMessage('All students deleted successfully');
    } catch (error: any) {
      console.error('Failed to delete all students:', error);
      setMessage(error?.response?.data?.detail || 'Failed to delete all students');
    } finally {
      setDeletingAll(false);
    }
  };

  const updateStudentField = <K extends keyof StudentFormState>(key: K, value: StudentFormState[K]) => {
    setStudentForm((current) => ({ ...current, [key]: value }));
  };

  const stopStudentCamera = () => {
    if (studentMediaStreamRef.current) {
      studentMediaStreamRef.current.getTracks().forEach((track) => track.stop());
      studentMediaStreamRef.current = null;
    }
    setStudentCameraOpen(false);
  };

  const resetStudentForm = () => {
    stopStudentCamera();
    setStudentForm(studentInitialForm);
    setSessionOptions(DEFAULT_SESSION_OPTIONS);
    setNewSessionValue('');
    if (studentPhotoPreviewUrl) {
      URL.revokeObjectURL(studentPhotoPreviewUrl);
    }
    setStudentPhotoPreviewUrl('');
    setStudentPhotoDataUrl('');
    studentDocuments.forEach((document) => URL.revokeObjectURL(document.previewUrl));
    setStudentDocuments([]);
    setStudentCameraError('');
  };

  const handleStudentPhotoSelected = (file: File | null) => {
    if (!file) return;
    if (studentPhotoPreviewUrl) {
      URL.revokeObjectURL(studentPhotoPreviewUrl);
    }
    const nextPreviewUrl = URL.createObjectURL(file);
    setStudentPhotoPreviewUrl(nextPreviewUrl);
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setStudentPhotoDataUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
    setStudentCameraError('');
  };

  const handleStudentPhotoInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    handleStudentPhotoSelected(file);
    event.target.value = '';
  };

  const handleStudentCourseChange = (value: StudentCourse) => {
    let nextProgram: StudentProgram = '';

    if (value === 'neet') nextProgram = 'medical';
    if (value === 'jee_main' || value === 'advance') nextProgram = 'non_medical';

    setStudentForm((current) => ({
      ...current,
      course: value,
      program: nextProgram || (value === 'ssb' ? current.program : ''),
      managedBatch: '',
      className: '',
      section: '',
    }));
  };

  const handleAddSessionOption = () => {
    const cleanedSession = newSessionValue.trim();
    if (!cleanedSession) return;
    setSessionOptions((current) => Array.from(new Set([...current, cleanedSession])).sort((a, b) => a.localeCompare(b)));
    updateStudentField('academicYear', cleanedSession);
    setNewSessionValue('');
  };

  const handleStudentProgramChange = (value: StudentProgram) => {
    setStudentForm((current) => ({
      ...current,
      program: value,
      managedBatch: '',
      className: '',
      section: '',
    }));
  };

  const handleManagedBatchChange = (value: string) => {
    setStudentForm((current) => ({
      ...current,
      managedBatch: value,
    }));
  };

  const handleStudentDocumentInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    const nextDocuments = files.map((file, index) => ({
      id: `${file.name}-${file.size}-${Date.now()}-${index}`,
      file,
      previewUrl: URL.createObjectURL(file),
    }));
    setStudentDocuments((current) => [...current, ...nextDocuments]);
    event.target.value = '';
  };

  const handleRemoveStudentDocument = (documentId: string) => {
    setStudentDocuments((current) => {
      const target = current.find((item) => item.id === documentId);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((item) => item.id !== documentId);
    });
  };

  const handlePreviewStudentDocument = (document: StudentDocument) => {
    window.open(document.previewUrl, '_blank', 'noopener,noreferrer');
  };

  const handleOpenStudentCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStudentCameraError('Camera browser mein supported nahi hai.');
      return;
    }

    try {
      setStudentCameraError('');
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      studentMediaStreamRef.current = stream;
      setStudentCameraOpen(true);

      setTimeout(() => {
        if (studentVideoRef.current) {
          studentVideoRef.current.srcObject = stream;
          void studentVideoRef.current.play();
        }
      }, 0);
    } catch {
      setStudentCameraError('Camera open nahi ho paaya. Permission allow karke dobara try karo.');
    }
  };

  const handleCaptureStudentPhoto = () => {
    const video = studentVideoRef.current;
    const canvas = studentCanvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob((blob) => {
      if (!blob) return;
      const capturedFile = new File([blob], `student-photo-${Date.now()}.png`, { type: 'image/png' });
      handleStudentPhotoSelected(capturedFile);
      stopStudentCamera();
    }, 'image/png');
  };

  const openAddModal = () => {
    void loadBatches();
    setEditStudent(null);
    setSendHostelRequestOnSubmit(false);
    setSendToEduPayOnSubmit(false);
    resetStudentForm();
    setShowModal(true);
  };

  const closeStudentForm = () => {
    setShowModal(false);
    setSendHostelRequestOnSubmit(false);
    setSendToEduPayOnSubmit(false);
    resetStudentForm();
    if (isDedicatedAddView) {
      navigate('/students/directory');
    }
  };

  const openEditModal = (student: Student) => {
    openEditModalWithDetails(student);
  };

  const openEditModalWithDetails = (student: Student, details?: Partial<EduPayAdmissionSnapshot>) => {
    void loadBatches();
    setEditStudent(student);
    const [parsedClassName = '', parsedSection = ''] = (student.batch || '').split('|').map((item) => item.trim());
    const nameParts = student.name.trim().split(/\s+/);
    const currentBatchName = details?.managedBatch || student.batch || '';
    const matchedBatchRecord = batches.find(
      (batch) => batch.category !== 'class' && batch.name.trim().toLowerCase() === currentBatchName.trim().toLowerCase(),
    );
    const inferredCourse = inferStudentCourseFromBatch(matchedBatchRecord || currentBatchName);
    const inferredProgram =
      detectStudentProgramFromBatch(matchedBatchRecord || currentBatchName) || deriveProgramFromCourse(inferredCourse);
    const savedPhoto = (student.photoDataUrl as string) || '';
    const savedSession = student.academic_session || '';
    setStudentForm({
      ...studentInitialForm,
      admissionId: details?.admissionId || '',
      academicYear: details?.academicYear || savedSession || studentInitialForm.academicYear,
      course: details?.course || inferredCourse,
      program: details?.program || inferredProgram,
      managedBatch: currentBatchName,
      firstName: details?.firstName || nameParts[0] || '',
      middleName: details?.middleName || (nameParts.length > 2 ? nameParts.slice(1, -1).join(' ') : ''),
      lastName: details?.lastName || (nameParts.length > 1 ? nameParts[nameParts.length - 1] : ''),
      localName: details?.localName || details?.identifier || '',
      ageAsOfToday: details?.ageAsOfToday || calculateAgeAsOfToday(details?.dob || ''),
      dob: details?.dob || '',
      rollNumber: details?.rollNumber || student.roll_number,
      fatherName: details?.fatherName || student.father_name || '',
      fatherMobile: details?.fatherMobile || '',
      fatherOccupation: details?.fatherOccupation || '',
      motherName: details?.motherName || '',
      motherMobile: details?.motherMobile || '',
      motherOccupation: details?.motherOccupation || '',
      className: details?.className || (student.class_name as string) || parsedClassName,
      section: details?.section || (student.section as string) || parsedSection,
      email: details?.email || student.email || '',
      phone: details?.phone || student.phone || '',
      gender: details?.gender || '',
      admissionDate: details?.admissionDate || studentInitialForm.admissionDate,
      feeSchedule: details?.feeSchedule || '',
      tcNumber: details?.tcNumber || '',
      previousSchool: details?.previousSchool || '',
      previousExam: details?.previousExam || '',
      previousBoard: details?.previousBoard || '',
      previousPercentage: details?.previousPercentage || '',
      previousTotalMarks: details?.previousTotalMarks || '',
      previousAverage: details?.previousAverage || '',
      category: details?.category || '',
      subCategory: details?.subCategory || '',
      siblingName: details?.siblingName || '',
      siblingSchool: details?.siblingSchool || '',
      guardianName: details?.guardianName || '',
      guardianRelation: details?.guardianRelation || '',
      guardianMobile: details?.guardianMobile || '',
      guardianAddress: details?.guardianAddress || '',
      emergencyName: details?.emergencyName || '',
      emergencyMobile: details?.emergencyMobile || '',
      priorityContact: details?.priorityContact || studentInitialForm.priorityContact,
      address1: details?.address1 || '',
      address2: details?.address2 || '',
      city: details?.city || '',
      state: details?.state || '',
      country: details?.country || studentInitialForm.country,
      pincode: details?.pincode || '',
      region: details?.region || '',
      referenceName: (student.reference_name as string) || '',
      referenceNumber: (student.reference_number as string) || '',
      referenceRemark: (student.reference_remark as string) || '',
      admissionType: details?.admissionType || studentInitialForm.admissionType,
      specialNeeds: details?.specialNeeds || student.special_needs || '',
      boardingType: details?.boardingType || (student.boarding_type as string) || '',
      pickupEnabled: Boolean(details?.pickupEnabled),
      dropEnabled: Boolean(details?.dropEnabled),
      transportMonth: details?.transportMonth || studentInitialForm.transportMonth,
      transportRoute: details?.transportRoute || '',
      transportStop: details?.transportStop || '',
      availingMessFacility: details?.availingMessFacility || studentInitialForm.availingMessFacility,
      hostelRequired: Boolean(student.hostel_required),
      preferredHostelId: student.preferred_hostel_id ? String(student.preferred_hostel_id) : '',
      hostelRequestNote: (student.hostel_notes as string) || '',
    });
    if (savedSession) {
      setSessionOptions((current) => Array.from(new Set([...current, savedSession])).sort((a, b) => a.localeCompare(b)));
    }
    setStudentPhotoPreviewUrl(savedPhoto);
    setStudentPhotoDataUrl(savedPhoto);
    setStudentDocuments([]);
    setShowModal(true);
  };

  useEffect(() => {
    const state = location.state as
      | {
          directoryEditStudent?: Student;
          directoryEditDetails?: Partial<EduPayAdmissionSnapshot>;
        }
      | undefined;

    if (!state?.directoryEditStudent) return;

    openEditModalWithDetails(state.directoryEditStudent, state.directoryEditDetails);
    skipNextAddAutoOpenRef.current = true;
    navigate({ pathname: location.pathname, hash: location.hash }, { replace: true, state: null });
  }, [location.state, location.pathname, location.hash, navigate]);

  const handleDeleteStudent = async (id: number) => {
    if (!confirm('Are you sure you want to delete this student?')) return;
    try {
      await apiService.deleteStudent(id);
      setMessage('Student deleted successfully');
      loadStudents();
    } catch (error: any) {
      console.error('Failed to delete student:', error);
      setMessage(error?.response?.data?.detail || 'Failed to delete student');
    }
  };

  const toggleStudentSelection = (studentId: number) => {
    setSelectedStudentIds((current) =>
      current.includes(studentId)
        ? current.filter((id) => id !== studentId)
        : [...current, studentId]
    );
  };

  const handleSelectAllFiltered = () => {
    const filteredIds = filteredStudents.map((student) => student.id);
    const areAllFilteredSelected = filteredIds.length > 0 && filteredIds.every((id) => selectedStudentIds.includes(id));

    setSelectedStudentIds((current) => {
      if (areAllFilteredSelected) {
        return current.filter((id) => !filteredIds.includes(id));
      }

      return Array.from(new Set([...current, ...filteredIds]));
    });
  };

  const handleTransferSelectedStudents = async () => {
    if (!transferTargetBatch) {
      setMessage('Please select target batch');
      return;
    }
    if (selectedStudentIds.length === 0) {
      setMessage('Please select at least one student');
      return;
    }

    setTransferringSelected(true);
    try {
      const response = await apiService.transferStudentsToBatch({
        target_batch: transferTargetBatch,
        student_ids: selectedStudentIds,
      });
      setMessage(response.data.message);
      setSelectedStudentIds([]);
      setTransferTargetBatch('');
      await loadStudents();
      await loadBatches();
    } catch (error: any) {
      console.error('Failed to transfer selected students:', error);
      setMessage(error?.response?.data?.detail || 'Failed to transfer selected students');
    } finally {
      setTransferringSelected(false);
    }
  };

  const handleTransferBatchStudents = async () => {
    if (!selectedBatch) {
      setMessage('Please select source batch first');
      return;
    }
    if (!transferTargetBatch) {
      setMessage('Please select target batch');
      return;
    }

    setTransferringBatch(true);
    try {
      const response = await apiService.transferStudentsToBatch({
        target_batch: transferTargetBatch,
        source_batch: selectedBatch,
        transfer_all_from_batch: true,
      });
      setMessage(response.data.message);
      setSelectedStudentIds([]);
      setTransferTargetBatch('');
      await loadStudents();
      await loadBatches();
    } catch (error: any) {
      console.error('Failed to transfer batch students:', error);
      setMessage(error?.response?.data?.detail || 'Failed to transfer batch students');
    } finally {
      setTransferringBatch(false);
    }
  };

  const handleSubmitStudent = async (e: FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const fullName = [studentForm.firstName, studentForm.middleName, studentForm.lastName].filter(Boolean).join(' ').trim();
      const batchName = studentForm.managedBatch.trim() || [studentForm.className, studentForm.section].filter(Boolean).join(' | ').trim() || studentForm.className.trim();
      const buildAdmissionSnapshot = (): EduPayAdmissionSnapshot => ({
        admissionId: studentForm.admissionId.trim(),
        academicYear: studentForm.academicYear,
        course: studentForm.course,
        program: studentForm.program,
        managedBatch: studentForm.managedBatch.trim() || batchName,
        className: studentForm.className.trim(),
        section: studentForm.section.trim(),
        rollNumber: studentForm.rollNumber.trim(),
        firstName: studentForm.firstName.trim(),
        middleName: studentForm.middleName.trim() || undefined,
        lastName: studentForm.lastName.trim() || undefined,
        fullName,
        localName: studentForm.localName.trim() || undefined,
        ageAsOfToday: studentForm.ageAsOfToday.trim() || undefined,
        dob: studentForm.dob,
        gender: studentForm.gender,
        email: studentForm.email.trim(),
        phone: studentForm.phone.trim(),
        admissionDate: studentForm.admissionDate,
        fatherName: studentForm.fatherName.trim(),
        fatherMobile: studentForm.fatherMobile.trim(),
        fatherOccupation: studentForm.fatherOccupation.trim(),
        motherName: studentForm.motherName.trim(),
        motherMobile: studentForm.motherMobile.trim(),
        motherOccupation: studentForm.motherOccupation.trim(),
        guardianName: studentForm.guardianName.trim(),
        guardianRelation: studentForm.guardianRelation.trim(),
        guardianMobile: studentForm.guardianMobile.trim(),
        guardianAddress: studentForm.guardianAddress.trim(),
        address1: studentForm.address1.trim(),
        address2: studentForm.address2.trim(),
        city: studentForm.city.trim(),
        state: studentForm.state.trim(),
        country: studentForm.country.trim(),
        pincode: studentForm.pincode.trim(),
        region: studentForm.region.trim(),
        category: studentForm.category.trim(),
        subCategory: studentForm.subCategory.trim(),
        previousSchool: studentForm.previousSchool.trim(),
        previousBoard: studentForm.previousBoard.trim(),
        previousExam: studentForm.previousExam.trim(),
        previousPercentage: studentForm.previousPercentage.trim(),
        previousTotalMarks: studentForm.previousTotalMarks.trim(),
        previousAverage: studentForm.previousAverage.trim(),
        siblingName: studentForm.siblingName.trim(),
        siblingSchool: studentForm.siblingSchool.trim(),
        emergencyName: studentForm.emergencyName.trim(),
        emergencyMobile: studentForm.emergencyMobile.trim(),
        pickupEnabled: studentForm.pickupEnabled,
        dropEnabled: studentForm.dropEnabled,
        transportMonth: studentForm.transportMonth.trim(),
        transportRoute: studentForm.transportRoute.trim(),
        transportStop: studentForm.transportStop.trim(),
        specialNeeds: studentForm.specialNeeds.trim(),
        admissionType: studentForm.admissionType,
        boardingType: studentForm.boardingType.trim(),
        availingMessFacility: studentForm.availingMessFacility,
        feeSchedule: studentForm.feeSchedule.trim(),
        tcNumber: studentForm.tcNumber.trim(),
        priorityContact: studentForm.priorityContact,
        photoDataUrl: studentPhotoDataUrl || undefined,
      });
      const syncAdmissionSnapshot = (studentId: number, rollNumber: string, queueForEduPay: boolean) => {
        const existingRequest = readEduPayAdmissionRequests().find(
          (item) => item.linkedStudentId === studentId || item.linkedStudentRollNumber === rollNumber,
        );
        upsertEduPayAdmissionRequest({
          source: 'admin_request',
          status: queueForEduPay ? 'pending' : existingRequest?.status || 'processed',
          linkedStudentId: studentId,
          linkedStudentRollNumber: rollNumber,
          details: buildAdmissionSnapshot(),
        });
      };
      const payload: Partial<Student> = {
        name: fullName,
        roll_number: studentForm.rollNumber.trim(),
        father_name: toNullableString(studentForm.fatherName) as unknown as string | undefined,
        batch: batchName,
        class_name: toNullableString(studentForm.className) as unknown as string | undefined,
        section: toNullableString(studentForm.section) as unknown as string | undefined,
        academic_session: toNullableString(studentForm.academicYear) as unknown as string | undefined,
        email: toNullableString(studentForm.email) as unknown as string | undefined,
        phone: toNullableString(studentForm.phone) as unknown as string | undefined,
        reference_name: toNullableString(studentForm.referenceName) as unknown as string | undefined,
        reference_number: toNullableString(studentForm.referenceNumber) as unknown as string | undefined,
        reference_remark: toNullableString(studentForm.referenceRemark) as unknown as string | undefined,
        special_needs: toNullableString(studentForm.specialNeeds) as unknown as string | undefined,
        boarding_type: toNullableString(studentForm.boardingType) as unknown as string | undefined,
        hostel_required: studentForm.hostelRequired,
        preferred_hostel_id: studentForm.hostelRequired && studentForm.preferredHostelId ? Number(studentForm.preferredHostelId) : undefined,
        hostel_notes: studentForm.hostelRequired
          ? (toNullableString(studentForm.hostelRequestNote) as unknown as string | undefined)
          : (null as unknown as string | undefined),
        photoDataUrl: studentPhotoDataUrl || '',
      };

      if (studentForm.course === 'ssb' && !studentForm.program) {
        alert('SSB batch ke liye program Medical ya Non Medical select karna required hai.');
        return;
      }

      if (!payload.name || !payload.roll_number || !payload.batch) {
        alert('Name, roll number, aur batch required hai.');
        return;
      }

      if (studentForm.hostelRequired && !studentForm.preferredHostelId) {
        alert('Hostel required hai to preferred hostel select karna zaroori hai.');
        return;
      }

      if (editStudent) {
        const response = await apiService.updateStudent(editStudent.id, payload);
        if (sendHostelRequestOnSubmit && studentForm.hostelRequired && studentForm.preferredHostelId) {
          await apiService.createStudentHostelRequest(editStudent.id, {
            hostel_id: Number(studentForm.preferredHostelId),
            requested_notes: studentForm.hostelRequestNote.trim() || undefined,
          });
        }
        syncAdmissionSnapshot(response.data.id, payload.roll_number, sendToEduPayOnSubmit);
        setMessage(
          sendHostelRequestOnSubmit && studentForm.hostelRequired
            ? 'Student updated and hostel request sent for approval.'
            : sendToEduPayOnSubmit
              ? 'Student updated and sent to BRAIN OF HIMACHAL snapshot.'
              : 'Student updated successfully'
        );
      } else {
        const response = await apiService.createStudent(payload);
        if (sendHostelRequestOnSubmit && studentForm.hostelRequired && studentForm.preferredHostelId) {
          await apiService.createStudentHostelRequest(response.data.id, {
            hostel_id: Number(studentForm.preferredHostelId),
            requested_notes: studentForm.hostelRequestNote.trim() || undefined,
          });
        }
        syncAdmissionSnapshot(response.data.id, payload.roll_number, sendToEduPayOnSubmit);
        setMessage(
          sendHostelRequestOnSubmit && studentForm.hostelRequired
            ? 'Student saved and hostel request sent for approval.'
            : sendToEduPayOnSubmit
              ? 'Student saved successfully and sent to BRAIN OF HIMACHAL snapshot.'
              : 'Student saved successfully.'
        );
      }
      setShowModal(false);
      setSendHostelRequestOnSubmit(false);
      setSendToEduPayOnSubmit(false);
      resetStudentForm();
      await loadStudents();
      await loadHostels();
      if (isDedicatedAddView) {
        if (!editStudent && sendToEduPayOnSubmit) {
          navigate('/edupay');
        } else {
          navigate('/students/directory');
        }
      }
    } catch (error: any) {
      console.error('Failed to save student:', error);
      alert(error?.response?.data?.detail || 'Failed to save student');
    } finally {
      setSendHostelRequestOnSubmit(false);
      setSendToEduPayOnSubmit(false);
      setIsSubmitting(false);
    }
  };

  const filteredStudents = students.filter((student) => {
    const matchesSearch = student.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          student.roll_number.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesBatch = !selectedBatch || student.batch === selectedBatch;
    return matchesSearch && matchesBatch;
  });

  const existingBatches = Array.from(new Set(students.map((s) => s.batch)));
  const allBatchNames = sortBatchNames(
    Array.from(new Set([...batches.filter((batch) => batch.category !== 'class').map((b) => b.name), ...existingBatches]))
  );
  const regularBatchNamesLower = new Set(
    batches
      .filter((batch) => batch.category !== 'class')
      .map((batch) => batch.name.trim().toLowerCase())
  );
  const classMasterOptions = sortBatchNames(
    Array.from(
      new Set(
        batches
          .filter((batch) => batch.category === 'class')
          .map((batch) => batch.name)
          .filter((name) => !regularBatchNamesLower.has(name.trim().toLowerCase()))
      )
    )
  );
  const selectedStudents = students.filter((student) => selectedStudentIds.includes(student.id));
  const filteredStudentIds = filteredStudents.map((student) => student.id);
  const isAllFilteredSelected = filteredStudentIds.length > 0 && filteredStudentIds.every((id) => selectedStudentIds.includes(id));
  const batchTransferOptions = allBatchNames.filter((batchName) => batchName !== selectedBatch);
  const admissionBatchOptions = sortBatchNames(
    Array.from(
      new Set(
        batches
          .filter((batch) => batch.category !== 'class')
          .filter((batch) => {
            if (studentForm.managedBatch && batch.name === studentForm.managedBatch) {
              return true;
            }

            const normalizedName = normalizeBatchText(batch.name);
            const stream = detectStudentProgramFromBatch(batch);
            const isDropper = normalizedName.includes('dropper');
            const isEleventhOrTwelfth = normalizedName.includes('11') || normalizedName.includes('11th') || normalizedName.includes('12') || normalizedName.includes('12th');

            if (!studentForm.course) return true;

            if (studentForm.course === 'neet') {
              return stream === 'medical' && isDropper;
            }

            if (studentForm.course === 'jee_main') {
              return stream === 'non_medical' && isDropper;
            }

            if (studentForm.course === 'ssb') {
              if (!studentForm.program) return false;
              return stream === studentForm.program && isEleventhOrTwelfth && !isDropper;
            }

            if (studentForm.course === 'advance') {
              return stream === 'non_medical' && (isDropper || isEleventhOrTwelfth);
            }

            return true;
          })
          .map((batch) => batch.name)
      )
    )
  );

  return (
    <div className={`min-h-screen ${isDedicatedAddView && showModal ? 'bg-[#eef3f8]' : 'bg-gray-50'} p-6`}>
      <div className="max-w-7xl mx-auto">
        {!isDedicatedAddView || !showModal ? (
          <>
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Student Management</h1>
          <p className="text-gray-600">Manage student data and import from Excel templates</p>
        </div>
        {message && (
          <div className="mb-6 rounded-lg border border-green-200 bg-green-50 p-4 text-green-800">
            {message}
          </div>
        )}
          <div ref={importSectionRef} className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-gray-800">Import Student Data</h2>
            <button
              onClick={handleDownloadTemplate}
              className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
            >
              <Download className="w-4 h-4 mr-2" />
              Download Template
            </button>
          </div>

          <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center bg-white mb-8">
            <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <div className="mb-4">
              <label htmlFor="file-upload" className="cursor-pointer">
                <span className="text-blue-600 hover:text-blue-800 font-medium">Click to upload</span>
                <span className="text-gray-500"> or drag and drop</span>
              </label>
              <input
                id="file-upload"
                type="file"
                accept=".xlsx"
                onChange={handleFileSelect}
                className="hidden"
              />
            </div>
            <p className="text-sm text-gray-500 mb-4">
              Only `.xlsx` Excel files are supported. Naya template add-student form ke hisaab se hai and supports fields like Admission ID, Course, Program, Batch, Roll No, First Name, Father Name, Email, Phone, Special Needs. `Academic Session` blank hua to system default session auto-fill kar dega.
            </p>
            {uploadedFile && (
              <div className="flex items-center justify-center space-x-2 text-green-600">
                <CheckCircle className="w-4 h-4" />
                <span>{uploadedFile.name}</span>
              </div>
            )}
            {uploadedFile && (
              <div className="mt-6 flex justify-center space-x-4">
                <button
                  onClick={handleImportStudents}
                  disabled={uploading}
                  className="flex items-center px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  <Upload className="w-4 h-4 mr-2" />
                  {uploading ? 'Importing...' : 'Import Students'}
                </button>
              </div>
            )}
          </div>

        {/* Import Results */}
        {importResult && (
          <div className="bg-white rounded-lg shadow-md p-6 mb-8">
            <h3 className="text-lg font-semibold mb-4 flex items-center">
              {importResult.errors.length === 0 ? (
                <CheckCircle className="w-5 h-5 text-green-500 mr-2" />
              ) : (
                <XCircle className="w-5 h-5 text-red-500 mr-2" />
              )}
              Import Results
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div className="bg-green-50 p-4 rounded-lg">
                <div className="text-2xl font-bold text-green-600">{importResult.imported_count}</div>
                <div className="text-sm text-green-800">Imported</div>
              </div>
              <div className="bg-yellow-50 p-4 rounded-lg">
                <div className="text-2xl font-bold text-yellow-600">{importResult.skipped_count}</div>
                <div className="text-sm text-yellow-800">Skipped</div>
              </div>
              <div className="bg-red-50 p-4 rounded-lg">
                <div className="text-2xl font-bold text-red-600">{importResult.errors.length}</div>
                <div className="text-sm text-red-800">Errors</div>
              </div>
            </div>

            {importResult.errors.length > 0 && (
              <div className="mt-4">
                <h4 className="font-medium text-red-800 mb-2">Errors:</h4>
                <div className="bg-red-50 border border-red-200 rounded p-4 max-h-40 overflow-y-auto">
                  {importResult.errors.map((error: any, index: number) => (
                    <div key={index} className="text-sm text-red-700 mb-1">
                      {error.row && `Row ${error.row}: `}{error.roll_no && `${error.roll_no}: `}{error.error}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Student List */}
        <div ref={directorySectionRef} className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-gray-800">Student List ({filteredStudents.length})</h2>
            <div className="flex space-x-2">
              <button
                onClick={openAddModal}
                className="flex items-center px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Student
              </button>
              <button
                onClick={() => setDeleteAllConfirm(true)}
                className="flex items-center px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition"
              >
                <AlertTriangle className="w-4 h-4 mr-2" />
                Delete All
              </button>
              <button
                onClick={loadStudents}
                className="flex items-center px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Refresh
              </button>
            </div>
          </div>

          {/* Filters */}
          <div className="flex gap-4 mb-6">
            <div className="flex-1">
              <input
                type="text"
                placeholder="Search by name or roll number..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div className="w-48">
              <select
                value={selectedBatch}
                onChange={(e) => {
                  setSelectedBatch(e.target.value);
                  setSelectedStudentIds([]);
                }}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">All Batches</option>
                {allBatchNames.map((batch) => (
                  <option key={batch} value={batch}>
                    {batch}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mb-6 rounded-lg border border-blue-100 bg-blue-50 p-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-blue-900">Transfer Students To Another Batch</h3>
                <p className="mt-1 text-sm text-blue-700">
                  Selected students: {selectedStudents.length}
                  {selectedStudents.length > 0 ? ` (${selectedStudents.map((student) => student.name).join(', ')})` : ''}
                </p>
                <p className="mt-1 text-sm text-blue-700">
                  {selectedBatch
                    ? `Current batch "${selectedBatch}" has ${students.filter((student) => student.batch === selectedBatch).length} student(s).`
                    : 'Batch-wise transfer ke liye pehle source batch filter select karo.'}
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div>
                  <label className="mb-1 block text-sm font-medium text-blue-900">Target Batch</label>
                  <select
                    value={transferTargetBatch}
                    onChange={(e) => setTransferTargetBatch(e.target.value)}
                    className="min-w-56 rounded-lg border border-blue-200 bg-white px-4 py-2 focus:border-blue-500 focus:outline-none"
                  >
                    <option value="">Select target batch</option>
                    {batchTransferOptions.map((batch) => (
                      <option key={batch} value={batch}>
                        {batch}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={handleTransferSelectedStudents}
                  disabled={transferringSelected || selectedStudents.length === 0 || !transferTargetBatch}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {transferringSelected ? 'Transferring...' : `Transfer Selected (${selectedStudents.length})`}
                </button>
                <button
                  onClick={handleTransferBatchStudents}
                  disabled={transferringBatch || !selectedBatch || !transferTargetBatch}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {transferringBatch ? 'Transferring Batch...' : selectedBatch ? `Transfer All From ${selectedBatch}` : 'Transfer Whole Batch'}
                </button>
              </div>
            </div>
          </div>

          {/* Student Table */}
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      <input
                        type="checkbox"
                        checked={isAllFilteredSelected}
                        onChange={handleSelectAllFiltered}
                        aria-label="Select all filtered students"
                      />
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      SR.NO
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      ROLL NUMBER
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      STUDENT NAME
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      FATHER NAME
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      BATCH
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      CLASS / SECTION
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      HOSTEL
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      ACTIONS
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredStudents.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-6 py-4 text-center text-gray-500">
                        {searchTerm ? 'No students found matching your search.' : 'No students added yet.'}
                      </td>
                    </tr>
                  ) : (
                    filteredStudents.map((student, index) => (
                      <tr key={student.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          <input
                            type="checkbox"
                            checked={selectedStudentIds.includes(student.id)}
                            onChange={() => toggleStudentSelection(student.id)}
                            aria-label={`Select ${student.name}`}
                          />
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {index + 1}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {student.roll_number}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">{student.name}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {student.father_name || '-'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-blue-100 text-blue-800">
                            {student.batch}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {[String(student.class_name || '').trim(), String(student.section || '').trim()].filter(Boolean).join(' | ') || '-'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {student.assigned_hostel_name ? (
                            <div>
                              <div className="font-medium text-emerald-700">{String(student.assigned_hostel_name)}</div>
                              <div className="text-xs text-gray-500">
                                {String(student.assigned_room_number || '-')} / {String(student.assigned_bed_label || '-')}
                              </div>
                            </div>
                          ) : student.hostel_required ? (
                            <span className={`rounded-full px-2 py-1 text-xs font-semibold ${
                              student.hostel_request_status === 'pending'
                                ? 'bg-amber-100 text-amber-800'
                                : student.hostel_request_status === 'rejected'
                                  ? 'bg-rose-100 text-rose-700'
                                  : 'bg-slate-100 text-slate-600'
                            }`}>
                              {String(student.hostel_request_status || 'requested')}
                            </span>
                          ) : (
                            '-'
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                          <button
                            onClick={() => openEditModal(student)}
                            className="text-blue-600 hover:text-blue-900 mr-4"
                            title="Edit"
                          >
                            <Edit2 size={18} />
                          </button>
                          <button
                            onClick={() => handleDeleteStudent(student.id)}
                            className="text-red-600 hover:text-red-900"
                            title="Delete"
                          >
                            <Trash2 size={18} />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
          </>
        ) : null}

        {/* Modals */}
        {showModal && (
          <div
            className={
              isDedicatedAddView
                ? 'mx-auto max-w-7xl'
                : 'fixed inset-0 z-50 overflow-y-auto bg-slate-950/55 p-4 md:p-6'
            }
          >
            <div
              className={`mx-auto max-w-7xl rounded-3xl bg-[#eef3f8] p-4 md:p-6 ${
                isDedicatedAddView ? '' : 'shadow-2xl'
              }`}
            >
              <div className="mb-5 rounded-xl bg-white px-4 py-4 shadow-sm">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h3 className="text-2xl font-bold text-slate-900">{editStudent ? 'Edit Student' : 'Add Student'}</h3>
                    <p className="mt-1 text-sm text-slate-500">Screenshot-style structured student admission form.</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={closeStudentForm}
                      className="rounded-md border border-[#d8e2ec] bg-white px-4 py-2 text-sm font-semibold text-slate-700"
                    >
                      Cancel
                    </button>
                    {editStudent ? (
                      <button
                        type="submit"
                        form="student-structured-form"
                        onClick={() => {
                          setSendHostelRequestOnSubmit(false);
                          setSendToEduPayOnSubmit(false);
                        }}
                        disabled={isSubmitting}
                        className="rounded-md bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-70"
                      >
                        {isSubmitting ? 'Updating...' : 'Update Student'}
                      </button>
                    ) : null}
                    <button
                      type="submit"
                      form="student-structured-form"
                      onClick={() => {
                        setSendHostelRequestOnSubmit(false);
                        setSendToEduPayOnSubmit(true);
                      }}
                      disabled={isSubmitting}
                      className="rounded-md border border-[#c07a10] bg-[#fff5e8] px-5 py-2.5 text-sm font-semibold text-[#a9680d] hover:bg-[#fde8c7] disabled:opacity-70"
                    >
                      {isSubmitting ? 'Sending...' : editStudent ? 'Send To BRAIN OF HIMACHAL' : 'Send To BRAIN OF HIMACHAL For Fee'}
                    </button>
                    {studentForm.hostelRequired ? (
                      <button
                        type="submit"
                        form="student-structured-form"
                        onClick={() => {
                          setSendHostelRequestOnSubmit(true);
                          setSendToEduPayOnSubmit(false);
                        }}
                        disabled={isSubmitting || !studentForm.preferredHostelId}
                        className="rounded-md border border-emerald-300 bg-emerald-50 px-5 py-2.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-70"
                      >
                        {isSubmitting ? 'Sending...' : 'Save + Send Hostel Request'}
                      </button>
                    ) : null}
                    {!isDedicatedAddView ? (
                      <button
                        type="button"
                        onClick={closeStudentForm}
                        className="rounded-full p-2 text-slate-500 hover:bg-slate-100"
                      >
                        <X className="h-5 w-5" />
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>

              <form id="student-structured-form" onSubmit={handleSubmitStudent} className="space-y-5">
                <StudentSection title="Academic Year">
                  <div className="grid gap-4 md:grid-cols-[1.2fr_1fr_auto]">
                    <StudentField label="Session">
                      <select value={studentForm.academicYear} onChange={(e) => updateStudentField('academicYear', e.target.value)} className={studentInputClass}>
                        {sessionOptions.map((session) => (
                          <option key={session} value={session}>
                            {session}
                          </option>
                        ))}
                      </select>
                    </StudentField>
                    <StudentField label="Add New Session">
                      <input
                        value={newSessionValue}
                        onChange={(e) => setNewSessionValue(e.target.value)}
                        className={studentInputClass}
                        placeholder="e.g. Apr 2028 - Mar 2029"
                      />
                    </StudentField>
                    <div className="flex items-end">
                      <button
                        type="button"
                        onClick={handleAddSessionOption}
                        className="w-full rounded-lg bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-700"
                      >
                        Add Session
                      </button>
                    </div>
                  </div>
                </StudentSection>

                <StudentSection title="Personal Details">
                  <div className="grid gap-4 xl:grid-cols-[1fr_260px]">
                    <div className="grid gap-4 md:grid-cols-2">
                      <StudentField label="Admission ID">
                        <input value={studentForm.admissionId} onChange={(e) => updateStudentField('admissionId', e.target.value)} className={studentInputClass} />
                      </StudentField>
                      <StudentField label="Date of Birth">
                        <input type="date" value={studentForm.dob} onChange={(e) => updateStudentField('dob', e.target.value)} className={studentInputClass} />
                      </StudentField>
                      <StudentField label="First Name *">
                        <input value={studentForm.firstName} onChange={(e) => updateStudentField('firstName', e.target.value)} className={studentInputClass} />
                      </StudentField>
                      <StudentField label="Last Name (Optional)">
                        <input value={studentForm.lastName} onChange={(e) => updateStudentField('lastName', e.target.value)} className={studentInputClass} />
                      </StudentField>
                      <StudentField label="Middle Name">
                        <input value={studentForm.middleName} onChange={(e) => updateStudentField('middleName', e.target.value)} className={studentInputClass} />
                      </StudentField>
                      <StudentField label="Local Name">
                        <input value={studentForm.localName} onChange={(e) => updateStudentField('localName', e.target.value)} className={studentInputClass} />
                      </StudentField>
                      <StudentField label="Age As Of Today">
                        <input value={studentForm.ageAsOfToday} onChange={(e) => updateStudentField('ageAsOfToday', e.target.value)} className={studentInputClass} />
                      </StudentField>
                      <StudentField label="Email">
                        <input type="email" value={studentForm.email} onChange={(e) => updateStudentField('email', e.target.value)} className={studentInputClass} />
                      </StudentField>
                      <StudentField label="Student Phone Number">
                        <input value={studentForm.phone} onChange={(e) => updateStudentField('phone', e.target.value)} className={studentInputClass} />
                      </StudentField>
                      <StudentField label="Gender">
                        <select value={studentForm.gender} onChange={(e) => updateStudentField('gender', e.target.value)} className={studentInputClass}>
                          <option value="">Select gender</option>
                          <option value="male">Male</option>
                          <option value="female">Female</option>
                        </select>
                      </StudentField>
                    </div>

                    <div className="rounded-xl border border-dashed border-[#d9c39a] bg-[#fcf5ea] p-4">
                      <p className="text-sm font-semibold text-slate-800">Student Photo</p>
                      <input ref={studentPhotoInputRef} type="file" accept="image/*" className="hidden" onChange={handleStudentPhotoInputChange} />
                      <div className="mt-4 flex h-44 items-center justify-center overflow-hidden rounded-lg bg-[#f0e4cf] text-xs text-slate-500">
                        {studentPhotoPreviewUrl ? (
                          <img src={studentPhotoPreviewUrl} alt="Student preview" className="h-full w-full object-cover" />
                        ) : (
                          'Image Preview'
                        )}
                      </div>
                      {studentPhotoDataUrl ? <p className="mt-2 text-[11px] font-medium text-emerald-700">Photo selected and ready.</p> : null}
                      <div className="mt-4 space-y-2">
                        <button type="button" onClick={() => studentPhotoInputRef.current?.click()} className="flex w-full items-center justify-center gap-2 rounded-md bg-[#c07a10] px-3 py-2 text-xs font-semibold text-white">
                          <Upload className="h-3.5 w-3.5" />
                          Upload From System
                        </button>
                        <button type="button" onClick={handleOpenStudentCamera} className="flex w-full items-center justify-center gap-2 rounded-md border border-[#c07a10] bg-white px-3 py-2 text-xs font-semibold text-[#a9680d]">
                          <Camera className="h-3.5 w-3.5" />
                          Open Camera
                        </button>
                        {studentPhotoPreviewUrl ? (
                          <button
                            type="button"
                            onClick={() => {
                              if (studentPhotoPreviewUrl) URL.revokeObjectURL(studentPhotoPreviewUrl);
                              setStudentPhotoPreviewUrl('');
                              setStudentPhotoDataUrl('');
                            }}
                            className="flex w-full items-center justify-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Remove Photo
                          </button>
                        ) : null}
                        {studentCameraError ? <p className="text-xs text-rose-600">{studentCameraError}</p> : null}
                      </div>
                    </div>
                  </div>
                </StudentSection>

                <StudentSection title="Academic & Fee Schedule Details">
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    <StudentField label="Date of Admission">
                      <input type="date" value={studentForm.admissionDate} onChange={(e) => updateStudentField('admissionDate', e.target.value)} className={studentInputClass} />
                    </StudentField>
                    <StudentField label="Course *">
                      <select value={studentForm.course} onChange={(e) => handleStudentCourseChange(e.target.value as StudentCourse)} className={studentInputClass}>
                        <option value="">Select course</option>
                        <option value="neet">NEET</option>
                        <option value="jee_main">JEE-MAIN</option>
                        <option value="advance">ADVANCE</option>
                        <option value="ssb">SURE SELECTION BATCH (S.S.B)</option>
                      </select>
                    </StudentField>
                    <StudentField label="Program">
                      <select
                        value={studentForm.program}
                        onChange={(e) => handleStudentProgramChange(e.target.value as StudentProgram)}
                        className={studentInputClass}
                        disabled={studentForm.course === 'neet' || studentForm.course === 'jee_main' || studentForm.course === 'advance'}
                      >
                        <option value="">Select program</option>
                        <option value="medical">Medical</option>
                        <option value="non_medical">Non Medical</option>
                      </select>
                    </StudentField>
                    <StudentField label="Batch From Batch Management *">
                      <select value={studentForm.managedBatch} onChange={(e) => handleManagedBatchChange(e.target.value)} className={studentInputClass} disabled={!studentForm.course || (studentForm.course === 'ssb' && !studentForm.program)}>
                        <option value="">
                          {!studentForm.course
                            ? 'Select course first'
                            : studentForm.course === 'ssb' && !studentForm.program
                              ? 'Select program first'
                              : 'Select matching batch'}
                        </option>
                        {admissionBatchOptions.map((batchName) => (
                          <option key={batchName} value={batchName}>
                            {batchName}
                          </option>
                        ))}
                      </select>
                    </StudentField>
                    <StudentField label="Class">
                      <div className="space-y-2">
                        <select
                          value={classMasterOptions.includes(studentForm.className) ? studentForm.className : ''}
                          onChange={(e) => updateStudentField('className', e.target.value)}
                          className={studentInputClass}
                        >
                          <option value="">Select class from class management</option>
                          {classMasterOptions.map((className) => (
                            <option key={className} value={className}>
                              {className}
                            </option>
                          ))}
                        </select>
                        <input
                          value={studentForm.className}
                          onChange={(e) => updateStudentField('className', e.target.value)}
                          className={studentInputClass}
                          placeholder="6th, 7th, 8th, 9th, 10th..."
                        />
                      </div>
                    </StudentField>
                    <StudentField label="Section">
                      <input
                        value={studentForm.section}
                        onChange={(e) => updateStudentField('section', e.target.value)}
                        className={studentInputClass}
                        placeholder="A, B, C..."
                      />
                    </StudentField>
                    <StudentField label="Roll Number *">
                      <input value={studentForm.rollNumber} onChange={(e) => updateStudentField('rollNumber', e.target.value)} className={studentInputClass} />
                    </StudentField>
                    <StudentField label="Fee Schedule">
                      <input value={studentForm.feeSchedule} onChange={(e) => updateStudentField('feeSchedule', e.target.value)} className={studentInputClass} />
                    </StudentField>
                    <StudentField label="TC Number">
                      <input value={studentForm.tcNumber} onChange={(e) => updateStudentField('tcNumber', e.target.value)} className={studentInputClass} />
                    </StudentField>
                    <div className="lg:col-span-3">
                      <StudentField label="Selected Admission Batch">
                        <input value={studentForm.managedBatch || [studentForm.className, studentForm.section].filter(Boolean).join(' | ')} readOnly className={`${studentInputClass} bg-slate-50`} placeholder="Selected batch ya class yahan auto-fill hoga" />
                      </StudentField>
                    </div>
                    <div className="lg:col-span-3 rounded-xl border border-[#d8e2ec] bg-slate-50 px-4 py-3">
                      <p className="text-sm font-semibold text-slate-800">BRAIN OF HIMACHAL Request</p>
                      <p className="mt-1 text-xs text-slate-500">
                        Yeh form direct admission create nahi karega. `Send To BRAIN OF HIMACHAL For Fee` ke baad request BRAIN OF HIMACHAL review queue mein jayegi, aur fee submit hone ke baad hi student admission hogi.
                      </p>
                    </div>
                  </div>
                  {studentForm.course ? (
                    <div className="mt-4 rounded-xl border border-[#f2dfba] bg-[#fff8ed] px-4 py-3 text-sm text-[#8a5a0a]">
                      {studentForm.course === 'neet' && 'NEET ke liye sirf Medical Dropper batches dikhaye ja rahe hain.'}
                      {studentForm.course === 'jee_main' && 'JEE-MAIN ke liye sirf Non Medical Dropper batches dikhaye ja rahe hain.'}
                      {studentForm.course === 'ssb' && 'S.S.B ke liye 11th/12th Medical ya Non Medical batches dikhaye ja rahe hain.'}
                      {studentForm.course === 'advance' && 'ADVANCE ke liye 11th, 12th aur Dropper Non Medical batches dikhaye ja rahe hain.'}
                    </div>
                  ) : null}
                </StudentSection>

                <StudentSection title="Transport Details">
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    <StudentField label="Select Month">
                      <input value={studentForm.transportMonth} onChange={(e) => updateStudentField('transportMonth', e.target.value)} className={studentInputClass} />
                    </StudentField>
                    <StudentField label="Select Route">
                      <input value={studentForm.transportRoute} onChange={(e) => updateStudentField('transportRoute', e.target.value)} className={studentInputClass} />
                    </StudentField>
                    <StudentField label="Select Stop">
                      <input value={studentForm.transportStop} onChange={(e) => updateStudentField('transportStop', e.target.value)} className={studentInputClass} />
                    </StudentField>
                    <StudentField label="Pick Up">
                      <label className="flex h-[42px] items-center gap-2 rounded-lg border border-[#d8e2ec] bg-white px-3 text-sm text-slate-700">
                        <input type="checkbox" checked={studentForm.pickupEnabled} onChange={(e) => updateStudentField('pickupEnabled', e.target.checked)} />
                        Pick Up Enabled
                      </label>
                    </StudentField>
                    <StudentField label="Drop">
                      <label className="flex h-[42px] items-center gap-2 rounded-lg border border-[#d8e2ec] bg-white px-3 text-sm text-slate-700">
                        <input type="checkbox" checked={studentForm.dropEnabled} onChange={(e) => updateStudentField('dropEnabled', e.target.checked)} />
                        Drop Enabled
                      </label>
                    </StudentField>
                  </div>
                </StudentSection>

                <StudentSection title="Previous School / College Details">
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    <StudentField label="Previous School">
                      <input value={studentForm.previousSchool} onChange={(e) => updateStudentField('previousSchool', e.target.value)} className={studentInputClass} />
                    </StudentField>
                    <StudentField label="Previous Exam">
                      <input value={studentForm.previousExam} onChange={(e) => updateStudentField('previousExam', e.target.value)} className={studentInputClass} />
                    </StudentField>
                    <StudentField label="Board">
                      <input value={studentForm.previousBoard} onChange={(e) => updateStudentField('previousBoard', e.target.value)} className={studentInputClass} />
                    </StudentField>
                    <StudentField label="PCM %">
                      <input value={studentForm.previousPercentage} onChange={(e) => updateStudentField('previousPercentage', e.target.value)} className={studentInputClass} />
                    </StudentField>
                    <StudentField label="Total Marks">
                      <input value={studentForm.previousTotalMarks} onChange={(e) => updateStudentField('previousTotalMarks', e.target.value)} className={studentInputClass} />
                    </StudentField>
                    <StudentField label="Average">
                      <input value={studentForm.previousAverage} onChange={(e) => updateStudentField('previousAverage', e.target.value)} className={studentInputClass} />
                    </StudentField>
                  </div>
                </StudentSection>

                <StudentSection title="Family Details">
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    <StudentField label="Father Name">
                      <input value={studentForm.fatherName} onChange={(e) => updateStudentField('fatherName', e.target.value)} className={studentInputClass} />
                    </StudentField>
                    <StudentField label="Father Mobile Number">
                      <input value={studentForm.fatherMobile} onChange={(e) => updateStudentField('fatherMobile', e.target.value)} className={studentInputClass} />
                    </StudentField>
                    <StudentField label="Father Occupation">
                      <input value={studentForm.fatherOccupation} onChange={(e) => updateStudentField('fatherOccupation', e.target.value)} className={studentInputClass} />
                    </StudentField>
                    <StudentField label="Mother Name">
                      <input value={studentForm.motherName} onChange={(e) => updateStudentField('motherName', e.target.value)} className={studentInputClass} />
                    </StudentField>
                    <StudentField label="Mother Mobile Number">
                      <input value={studentForm.motherMobile} onChange={(e) => updateStudentField('motherMobile', e.target.value)} className={studentInputClass} />
                    </StudentField>
                    <StudentField label="Mother Occupation">
                      <input value={studentForm.motherOccupation} onChange={(e) => updateStudentField('motherOccupation', e.target.value)} className={studentInputClass} />
                    </StudentField>
                    <StudentField label="Category">
                      <input value={studentForm.category} onChange={(e) => updateStudentField('category', e.target.value)} className={studentInputClass} />
                    </StudentField>
                    <StudentField label="Sub Category">
                      <input value={studentForm.subCategory} onChange={(e) => updateStudentField('subCategory', e.target.value)} className={studentInputClass} />
                    </StudentField>
                  </div>
                </StudentSection>

                <StudentSection title="Sibling Details">
                  <div className="grid gap-4 md:grid-cols-2">
                    <StudentField label="Sibling Name">
                      <input value={studentForm.siblingName} onChange={(e) => updateStudentField('siblingName', e.target.value)} className={studentInputClass} />
                    </StudentField>
                    <StudentField label="Sibling School / Working">
                      <input value={studentForm.siblingSchool} onChange={(e) => updateStudentField('siblingSchool', e.target.value)} className={studentInputClass} />
                    </StudentField>
                  </div>
                </StudentSection>

                <StudentSection title="Guardian Details">
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    <StudentField label="Guardian Name">
                      <input value={studentForm.guardianName} onChange={(e) => updateStudentField('guardianName', e.target.value)} className={studentInputClass} />
                    </StudentField>
                    <StudentField label="Guardian Relationship">
                      <input value={studentForm.guardianRelation} onChange={(e) => updateStudentField('guardianRelation', e.target.value)} className={studentInputClass} />
                    </StudentField>
                    <StudentField label="Guardian Mobile Number">
                      <input value={studentForm.guardianMobile} onChange={(e) => updateStudentField('guardianMobile', e.target.value)} className={studentInputClass} />
                    </StudentField>
                    <div className="md:col-span-2">
                      <StudentField label="Guardian Address">
                        <input value={studentForm.guardianAddress} onChange={(e) => updateStudentField('guardianAddress', e.target.value)} className={studentInputClass} />
                      </StudentField>
                    </div>
                  </div>
                </StudentSection>

                <StudentSection title="Emergency Contact Details">
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    <StudentField label="Emergency Contact Name">
                      <input value={studentForm.emergencyName} onChange={(e) => updateStudentField('emergencyName', e.target.value)} className={studentInputClass} />
                    </StudentField>
                    <StudentField label="Emergency Contact Mobile Number">
                      <input value={studentForm.emergencyMobile} onChange={(e) => updateStudentField('emergencyMobile', e.target.value)} className={studentInputClass} />
                    </StudentField>
                  </div>
                </StudentSection>

                <StudentSection title="Communication With School">
                  <div className="grid gap-4 md:grid-cols-3">
                    <StudentField label="Priority To Contact For School Matters">
                      <select value={studentForm.priorityContact} onChange={(e) => updateStudentField('priorityContact', e.target.value as StudentFormState['priorityContact'])} className={studentInputClass}>
                        <option value="father">Father</option>
                        <option value="mother">Mother</option>
                        <option value="guardian">Guardian</option>
                      </select>
                    </StudentField>
                  </div>
                </StudentSection>

                <StudentSection title="Address Details">
                  <div className="grid gap-4">
                    <StudentField label="Address Line 1">
                      <input value={studentForm.address1} onChange={(e) => updateStudentField('address1', e.target.value)} className={studentInputClass} />
                    </StudentField>
                    <StudentField label="Address Line 2">
                      <input value={studentForm.address2} onChange={(e) => updateStudentField('address2', e.target.value)} className={studentInputClass} />
                    </StudentField>
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                      <StudentField label="City">
                        <input value={studentForm.city} onChange={(e) => updateStudentField('city', e.target.value)} className={studentInputClass} />
                      </StudentField>
                      <StudentField label="State">
                        <input value={studentForm.state} onChange={(e) => updateStudentField('state', e.target.value)} className={studentInputClass} />
                      </StudentField>
                      <StudentField label="Country">
                        <input value={studentForm.country} onChange={(e) => updateStudentField('country', e.target.value)} className={studentInputClass} />
                      </StudentField>
                      <StudentField label="Pincode">
                        <input value={studentForm.pincode} onChange={(e) => updateStudentField('pincode', e.target.value)} className={studentInputClass} />
                      </StudentField>
                      <StudentField label="Region">
                        <input value={studentForm.region} onChange={(e) => updateStudentField('region', e.target.value)} className={studentInputClass} />
                      </StudentField>
                    </div>
                  </div>
                </StudentSection>

                <StudentSection title="Reference Details">
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    <StudentField label="Reference Name">
                      <input value={studentForm.referenceName} onChange={(e) => updateStudentField('referenceName', e.target.value)} className={studentInputClass} />
                    </StudentField>
                    <StudentField label="Reference Number">
                      <input value={studentForm.referenceNumber} onChange={(e) => updateStudentField('referenceNumber', e.target.value)} className={studentInputClass} />
                    </StudentField>
                    <StudentField label="Reference Remark">
                      <input value={studentForm.referenceRemark} onChange={(e) => updateStudentField('referenceRemark', e.target.value)} className={studentInputClass} />
                    </StudentField>
                  </div>
                </StudentSection>

                <StudentSection title="Other Info">
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    <StudentField label="Admission Type">
                      <select value={studentForm.admissionType} onChange={(e) => updateStudentField('admissionType', e.target.value as StudentFormState['admissionType'])} className={studentInputClass}>
                        <option value="old">Old</option>
                        <option value="new">New</option>
                      </select>
                    </StudentField>
                    <StudentField label="Boarding Type">
                      <input value={studentForm.boardingType} onChange={(e) => updateStudentField('boardingType', e.target.value)} className={studentInputClass} placeholder="Day boarding / Hostel / Learning center" />
                    </StudentField>
                    <StudentField label="Special Needs / Other Info">
                      <textarea value={studentForm.specialNeeds} onChange={(e) => updateStudentField('specialNeeds', e.target.value)} className={`${studentInputClass} min-h-[42px]`} />
                    </StudentField>
                    <StudentField label="Availing Mess Facility">
                      <select value={studentForm.availingMessFacility} onChange={(e) => updateStudentField('availingMessFacility', e.target.value as StudentFormState['availingMessFacility'])} className={studentInputClass}>
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                      </select>
                    </StudentField>
                    <StudentField label="Hostel Details">
                      <label className="flex h-[42px] items-center gap-2 rounded-lg border border-[#d8e2ec] bg-white px-3 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={studentForm.hostelRequired}
                          onChange={(e) => {
                            updateStudentField('hostelRequired', e.target.checked);
                            if (!e.target.checked) {
                              updateStudentField('preferredHostelId', '');
                              updateStudentField('hostelRequestNote', '');
                            }
                          }}
                        />
                        Hostel Required
                      </label>
                    </StudentField>
                    {studentForm.hostelRequired && (
                      <>
                        <StudentField label="Preferred Hostel">
                          <select value={studentForm.preferredHostelId} onChange={(e) => updateStudentField('preferredHostelId', e.target.value)} className={studentInputClass}>
                            <option value="">Select hostel</option>
                            {hostels.filter((hostel) => hostel.is_active).map((hostel) => (
                              <option key={hostel.id} value={hostel.id}>
                                {hostel.name} | Available {hostel.available_beds}/{hostel.total_capacity}
                              </option>
                            ))}
                          </select>
                        </StudentField>
                        <StudentField label="Hostel Request Note">
                          <textarea
                            value={studentForm.hostelRequestNote}
                            onChange={(e) => updateStudentField('hostelRequestNote', e.target.value)}
                            className={`${studentInputClass} min-h-[42px]`}
                            placeholder="Room preference, medical note, mess note, guardian instructions..."
                          />
                        </StudentField>
                        <div className="md:col-span-2">
                          <button
                            type="submit"
                            form="student-structured-form"
                            onClick={() => {
                              setSendHostelRequestOnSubmit(true);
                              setSendToEduPayOnSubmit(false);
                            }}
                            disabled={isSubmitting || !studentForm.preferredHostelId}
                            className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-70"
                          >
                            {isSubmitting ? 'Sending...' : 'Send Hostel Request'}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </StudentSection>

                <StudentSection title="Add Document">
                  <input ref={studentDocumentInputRef} type="file" multiple className="hidden" onChange={handleStudentDocumentInputChange} />
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-slate-500">Student documents optional hain. Multiple files add kar sakte ho.</p>
                    <button type="button" onClick={() => studentDocumentInputRef.current?.click()} className="inline-flex items-center gap-2 rounded-md border border-[#d58a17] bg-white px-4 py-2 text-sm font-semibold text-[#a9680d]">
                      <Plus className="h-4 w-4" />
                      Add Document
                    </button>
                  </div>
                  {studentDocuments.length ? (
                    <div className="mt-4 space-y-3">
                      {studentDocuments.map((document) => (
                        <div key={document.id} className="flex flex-col gap-3 rounded-lg border border-[#e6ebf0] bg-[#fafbfc] px-4 py-3 md:flex-row md:items-center md:justify-between">
                          <div className="flex items-center gap-3">
                            <div className="rounded-lg bg-white p-2 text-[#a9680d] shadow-sm">
                              <FileText className="h-4 w-4" />
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-slate-800">{document.file.name}</p>
                              <p className="text-xs text-slate-500">{(document.file.size / 1024).toFixed(1)} KB</p>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button type="button" onClick={() => handlePreviewStudentDocument(document)} className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
                              <ExternalLink className="h-3.5 w-3.5" />
                              Preview
                            </button>
                            <button type="button" onClick={() => handleRemoveStudentDocument(document.id)} className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                              <Trash2 className="h-3.5 w-3.5" />
                              Remove
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </StudentSection>
              </form>
            </div>
          </div>
        )}

        {studentCameraOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/70 p-4">
            <div className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-2xl">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Capture Student Photo</h3>
                  <p className="text-sm text-slate-500">Camera se direct student photo capture kar sakte ho.</p>
                </div>
                <button type="button" onClick={stopStudentCamera} className="rounded-full p-2 text-slate-500 hover:bg-slate-100">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="overflow-hidden rounded-2xl bg-slate-950">
                <video ref={studentVideoRef} autoPlay playsInline muted className="h-[420px] w-full object-cover" />
              </div>
              <canvas ref={studentCanvasRef} className="hidden" />
              <div className="mt-4 flex flex-wrap justify-end gap-3">
                <button type="button" onClick={stopStudentCamera} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700">
                  Cancel
                </button>
                <button type="button" onClick={handleCaptureStudentPhoto} className="inline-flex items-center gap-2 rounded-lg bg-[#c07a10] px-4 py-2 text-sm font-semibold text-white">
                  <Camera className="h-4 w-4" />
                  Capture Photo
                </button>
              </div>
            </div>
          </div>
        )}

        {deleteAllConfirm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-lg p-6 max-w-sm w-full">
              <h3 className="text-lg font-semibold mb-3">Confirm delete all students</h3>
              <p className="text-sm text-gray-600 mb-6">
                This action cannot be undone. Are you sure you want to permanently delete all student records?
              </p>
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setDeleteAllConfirm(false)}
                  className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDeleteAllStudents}
                  disabled={deletingAll}
                  className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {deletingAll ? 'Deleting...' : 'Delete All'}
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
