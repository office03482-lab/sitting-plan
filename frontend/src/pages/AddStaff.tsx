import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent, ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Upload, Camera, Plus, FileText, Trash2, ExternalLink, X } from 'lucide-react';
import { apiService } from '@services/api';
import { useAuthStore } from '@store/auth';
import {
  findStaffDirectoryNameMatches,
  type StaffDirectoryRecord,
} from '@utils/staffDirectory';

type StaffType = 'teaching' | 'non_teaching';

type StaffDocument = {
  id: string;
  file: File;
  previewUrl: string;
};

type StaffFormState = {
  staffType: StaffType;
  staffCategory: string;
  firstName: string;
  middleName: string;
  lastName: string;
  dob: string;
  primaryMobile: string;
  whatsappNumber: string;
  email: string;
  gender: string;
  maritalStatus: string;
  employeeId: string;
  joiningDate: string;
  subject: string;
  department: string;
  designation: string;
  shiftTiming: string;
  schoolName: string;
  fatherName: string;
  fatherContact: string;
  motherName: string;
  motherContact: string;
  spouseName: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  country: string;
  pinCode: string;
  aadhaarNumber: string;
  panNumber: string;
  bloodGroup: string;
  emergencyContactName: string;
  emergencyContactNumber: string;
  emergencyRelation: string;
  monthlySalary: string;
  accountNumber: string;
  ifscCode: string;
  bankName: string;
  notes: string;
  isActive: boolean;
};

const initialForm: StaffFormState = {
  staffType: 'teaching',
  staffCategory: 'Teacher',
  firstName: '',
  middleName: '',
  lastName: '',
  dob: '',
  primaryMobile: '',
  whatsappNumber: '',
  email: '',
  gender: '',
  maritalStatus: '',
  employeeId: '',
  joiningDate: '',
  subject: '',
  department: '',
  designation: '',
  shiftTiming: '',
  schoolName: 'Dr. Girish App',
  fatherName: '',
  fatherContact: '',
  motherName: '',
  motherContact: '',
  spouseName: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  country: 'India',
  pinCode: '',
  aadhaarNumber: '',
  panNumber: '',
  bloodGroup: '',
  emergencyContactName: '',
  emergencyContactNumber: '',
  emergencyRelation: '',
  monthlySalary: '',
  accountNumber: '',
  ifscCode: '',
  bankName: '',
  notes: '',
  isActive: true,
};

const inputClass =
  'w-full rounded-lg border border-[#d8e2ec] bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-[#d58a17] focus:ring-2 focus:ring-[#f7d9a8]';
const labelClass = 'mb-1.5 block text-[12px] font-semibold text-slate-700';

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-[#e6ebf0] bg-white">
      <div className="border-b border-[#edf1f5] bg-[#f7f8fa] px-4 py-3">
        <h2 className="text-sm font-bold text-slate-800">{title}</h2>
      </div>
      <div className="p-4 md:p-5">{children}</div>
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className={labelClass}>{label}</label>
      {children}
    </div>
  );
}

const teachingCategoryOptions = ['Teacher', 'Coordinator', 'HOD', 'Principal', 'Academic Head', 'Counsellor', 'Director', 'Managing Director'];
const nonTeachingCategoryOptions = [
  'Non-Teaching Staff',
  'Director',
  'Managing Director',
  'Peon',
  'Driver',
  'Discipline Officer',
  'Guard',
  'Reception',
  'Office Staff',
  'Librarian',
  'Lab Assistant',
  'Housekeeping',
  'Other',
];

const toFormState = (record: StaffDirectoryRecord): StaffFormState => ({
  ...initialForm,
  staffType: record.staffType,
  staffCategory: record.category || (record.staffType === 'teaching' ? teachingCategoryOptions[0] : nonTeachingCategoryOptions[0]),
  firstName: record.firstName || '',
  middleName: record.middleName || '',
  lastName: record.lastName || '',
  dob: record.details?.dob || '',
  primaryMobile: record.details?.primaryMobile || record.phone || '',
  whatsappNumber: record.details?.whatsappNumber || '',
  email: record.email || '',
  gender: record.details?.gender || '',
  maritalStatus: record.details?.maritalStatus || '',
  employeeId: record.employeeId || '',
  joiningDate: record.joiningDate || '',
  subject: record.subject || '',
  department: record.department || '',
  designation: record.designation || '',
  shiftTiming: record.shiftTiming || '',
  schoolName: record.details?.schoolName || initialForm.schoolName,
  fatherName: record.details?.fatherName || '',
  fatherContact: record.details?.fatherContact || '',
  motherName: record.details?.motherName || '',
  motherContact: record.details?.motherContact || '',
  spouseName: record.details?.spouseName || '',
  addressLine1: record.details?.addressLine1 || '',
  addressLine2: record.details?.addressLine2 || '',
  city: record.details?.city || '',
  state: record.details?.state || '',
  country: record.details?.country || initialForm.country,
  pinCode: record.details?.pinCode || '',
  aadhaarNumber: record.details?.aadhaarNumber || '',
  panNumber: record.details?.panNumber || '',
  bloodGroup: record.details?.bloodGroup || '',
  emergencyContactName: record.details?.emergencyContactName || '',
  emergencyContactNumber: record.details?.emergencyContactNumber || '',
  emergencyRelation: record.details?.emergencyRelation || '',
  monthlySalary: record.details?.monthlySalary || '',
  accountNumber: record.details?.accountNumber || '',
  ifscCode: record.details?.ifscCode || '',
  bankName: record.details?.bankName || '',
  notes: record.details?.notes || '',
  isActive: record.isActive,
});

export default function AddStaff() {
  const navigate = useNavigate();
  const location = useLocation();
  const currentSchoolId = useAuthStore((state) => state.user?.school_id || 1);
  const navigationState = location.state as { editingRecord?: StaffDirectoryRecord; staffType?: StaffType; returnStaffType?: StaffType } | null;
  const [formData, setFormData] = useState<StaffFormState>(initialForm);
  const [editingRecord, setEditingRecord] = useState<StaffDirectoryRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error'>('success');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState('');
  const [photoDataUrl, setPhotoDataUrl] = useState('');
  const [documents, setDocuments] = useState<StaffDocument[]>([]);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const documentInputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  const fullName = useMemo(
    () => [formData.firstName, formData.middleName, formData.lastName].filter(Boolean).join(' ').trim(),
    [formData.firstName, formData.middleName, formData.lastName]
  );
  const categoryOptions = formData.staffType === 'teaching' ? teachingCategoryOptions : nonTeachingCategoryOptions;

  const loadLiveDirectoryRecords = async (): Promise<StaffDirectoryRecord[]> => {
    const [teachersRes, invigilatorsRes] = await Promise.all([
      apiService.listTeachers(currentSchoolId, 0, 1000),
      apiService.listInvigilators(currentSchoolId, undefined, 0, 1000),
    ]);

    const teacherRecords = (teachersRes.data || []).map((teacher: any) => ({
      id: `teaching:${teacher.id}`,
      backendId: teacher.id,
      backendType: 'teaching' as const,
      staffType: 'teaching' as const,
      category: '',
      firstName: '',
      isActive: true,
      createdAt: '',
      fullName: String(teacher.name || '').trim(),
    }));
    const invigilatorRecords = (invigilatorsRes.data || []).map((staff: any) => ({
      id: `non_teaching:${staff.id}`,
      backendId: staff.id,
      backendType: 'non_teaching' as const,
      staffType: 'non_teaching' as const,
      category: '',
      firstName: '',
      isActive: true,
      createdAt: '',
      fullName: String(staff.name || '').trim(),
    }));

    return [...teacherRecords, ...invigilatorRecords];
  };

  const syncCategoryForType = (staffType: StaffType) => {
    const defaultCategory = staffType === 'teaching' ? teachingCategoryOptions[0] : nonTeachingCategoryOptions[0];
    updateField('staffCategory', defaultCategory);
  };

  const updateField = <K extends keyof StaffFormState>(key: K, value: StaffFormState[K]) => {
    setFormData((current) => ({ ...current, [key]: value }));
  };

  const stopCamera = () => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    setCameraOpen(false);
  };

  useEffect(() => {
    return () => {
      if (photoPreviewUrl) {
        URL.revokeObjectURL(photoPreviewUrl);
      }
      documents.forEach((document) => URL.revokeObjectURL(document.previewUrl));
      stopCamera();
    };
  }, [photoPreviewUrl, documents]);

  useEffect(() => {
    const state = navigationState;
    if (!state?.editingRecord) return;

    setEditingRecord(state.editingRecord);
    setFormData(toFormState(state.editingRecord));
    setPhotoPreviewUrl(state.editingRecord.photoDataUrl || '');
    setPhotoDataUrl(state.editingRecord.photoDataUrl || '');
    navigate(location.pathname, {
      replace: true,
      state: { returnStaffType: state.returnStaffType || state.editingRecord.staffType },
    });
  }, [location.pathname, navigate, navigationState]);

  const resetForm = (staffType: StaffType = formData.staffType) => {
    setFormData({
      ...initialForm,
      staffType,
      staffCategory: staffType === 'teaching' ? teachingCategoryOptions[0] : nonTeachingCategoryOptions[0],
    });
    setMessage('');
    setCameraError('');
    if (photoPreviewUrl) {
      URL.revokeObjectURL(photoPreviewUrl);
    }
    setPhotoFile(null);
    setPhotoPreviewUrl('');
    setPhotoDataUrl('');
    documents.forEach((document) => URL.revokeObjectURL(document.previewUrl));
    setDocuments([]);
  };

  const handlePhotoSelected = (file: File | null) => {
    if (!file) return;
    if (photoPreviewUrl) {
      URL.revokeObjectURL(photoPreviewUrl);
    }
    const nextPreviewUrl = URL.createObjectURL(file);
    setPhotoFile(file);
    setPhotoPreviewUrl(nextPreviewUrl);
    setCameraError('');
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setPhotoDataUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handlePhotoInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    handlePhotoSelected(file);
    event.target.value = '';
  };

  const handleDocumentInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    const nextDocuments = files.map((file, index) => ({
      id: `${file.name}-${file.size}-${Date.now()}-${index}`,
      file,
      previewUrl: URL.createObjectURL(file),
    }));

    setDocuments((current) => [...current, ...nextDocuments]);
    event.target.value = '';
  };

  const handleRemoveDocument = (documentId: string) => {
    setDocuments((current) => {
      const target = current.find((item) => item.id === documentId);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return current.filter((item) => item.id !== documentId);
    });
  };

  const handlePreviewDocument = (document: StaffDocument) => {
    window.open(document.previewUrl, '_blank', 'noopener,noreferrer');
  };

  const handleOpenCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera browser mein supported nahi hai.');
      return;
    }

    try {
      setCameraError('');
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      mediaStreamRef.current = stream;
      setCameraOpen(true);

      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      }, 0);
    } catch {
      setCameraError('Camera open nahi ho paaya. Permission allow karke dobara try karo.');
    }
  };

  const handleCapturePhoto = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob((blob) => {
      if (!blob) return;
      const capturedFile = new File([blob], `staff-photo-${Date.now()}.png`, { type: 'image/png' });
      handlePhotoSelected(capturedFile);
      stopCamera();
    }, 'image/png');
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage('');

    if (!formData.firstName.trim()) {
      setMessageType('error');
      setMessage('Name required hai. First name bharna zaroori hai.');
      return;
    }

    if (formData.staffType === 'teaching' && !formData.subject.trim()) {
      setMessageType('error');
      setMessage('Teaching staff ke liye subject required hai.');
      return;
    }

    if (formData.staffType === 'non_teaching' && !formData.employeeId.trim()) {
      setMessageType('error');
      setMessage('Non-teaching staff ke liye employee ID required hai.');
      return;
    }

    const duplicateNameMatches = findStaffDirectoryNameMatches(
      await loadLiveDirectoryRecords(),
      fullName,
      editingRecord?.id
    );
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

      if (formData.staffType === 'teaching') {
        if (editingRecord?.backendId && editingRecord.backendType === 'teaching') {
          await apiService.updateTeacher(editingRecord.backendId, {
            name: fullName,
            subject: formData.subject.trim(),
            email: formData.email.trim() || undefined,
            phone: formData.primaryMobile.trim() || undefined,
            designation: formData.designation.trim() || formData.staffCategory || 'Teacher',
            joining_date: formData.joiningDate || undefined,
            shift_timing: formData.shiftTiming.trim() || undefined,
            is_active: formData.isActive,
            photoDataUrl: photoDataUrl || undefined,
            metadata: {
              category: formData.staffCategory,
              designation: formData.designation.trim() || formData.staffCategory || 'Teacher',
              joining_date: formData.joiningDate || undefined,
              shift_timing: formData.shiftTiming.trim() || undefined,
              directory_details: {
                dob: formData.dob || undefined,
                primaryMobile: formData.primaryMobile.trim() || undefined,
                whatsappNumber: formData.whatsappNumber.trim() || undefined,
                gender: formData.gender || undefined,
                maritalStatus: formData.maritalStatus || undefined,
                schoolName: formData.schoolName.trim() || undefined,
                fatherName: formData.fatherName.trim() || undefined,
                fatherContact: formData.fatherContact.trim() || undefined,
                motherName: formData.motherName.trim() || undefined,
                motherContact: formData.motherContact.trim() || undefined,
                spouseName: formData.spouseName.trim() || undefined,
                addressLine1: formData.addressLine1.trim() || undefined,
                addressLine2: formData.addressLine2.trim() || undefined,
                city: formData.city.trim() || undefined,
                state: formData.state.trim() || undefined,
                country: formData.country.trim() || undefined,
                pinCode: formData.pinCode.trim() || undefined,
                aadhaarNumber: formData.aadhaarNumber.trim() || undefined,
                panNumber: formData.panNumber.trim() || undefined,
                bloodGroup: formData.bloodGroup.trim() || undefined,
                emergencyContactName: formData.emergencyContactName.trim() || undefined,
                emergencyContactNumber: formData.emergencyContactNumber.trim() || undefined,
                emergencyRelation: formData.emergencyRelation.trim() || undefined,
                monthlySalary: formData.monthlySalary.trim() || undefined,
                accountNumber: formData.accountNumber.trim() || undefined,
                ifscCode: formData.ifscCode.trim() || undefined,
                bankName: formData.bankName.trim() || undefined,
                notes: formData.notes.trim() || undefined,
              },
            },
          });
        } else {
          await apiService.createTeacher({
            name: fullName,
            subject: formData.subject.trim(),
            email: formData.email.trim() || undefined,
            phone: formData.primaryMobile.trim() || undefined,
            designation: formData.designation.trim() || formData.staffCategory || 'Teacher',
            joining_date: formData.joiningDate || undefined,
            shift_timing: formData.shiftTiming.trim() || undefined,
            is_active: formData.isActive,
            photoDataUrl: photoDataUrl || undefined,
            metadata: {
              category: formData.staffCategory,
              designation: formData.designation.trim() || formData.staffCategory || 'Teacher',
              joining_date: formData.joiningDate || undefined,
              shift_timing: formData.shiftTiming.trim() || undefined,
              directory_details: {
                dob: formData.dob || undefined,
                primaryMobile: formData.primaryMobile.trim() || undefined,
                whatsappNumber: formData.whatsappNumber.trim() || undefined,
                gender: formData.gender || undefined,
                maritalStatus: formData.maritalStatus || undefined,
                schoolName: formData.schoolName.trim() || undefined,
                fatherName: formData.fatherName.trim() || undefined,
                fatherContact: formData.fatherContact.trim() || undefined,
                motherName: formData.motherName.trim() || undefined,
                motherContact: formData.motherContact.trim() || undefined,
                spouseName: formData.spouseName.trim() || undefined,
                addressLine1: formData.addressLine1.trim() || undefined,
                addressLine2: formData.addressLine2.trim() || undefined,
                city: formData.city.trim() || undefined,
                state: formData.state.trim() || undefined,
                country: formData.country.trim() || undefined,
                pinCode: formData.pinCode.trim() || undefined,
                aadhaarNumber: formData.aadhaarNumber.trim() || undefined,
                panNumber: formData.panNumber.trim() || undefined,
                bloodGroup: formData.bloodGroup.trim() || undefined,
                emergencyContactName: formData.emergencyContactName.trim() || undefined,
                emergencyContactNumber: formData.emergencyContactNumber.trim() || undefined,
                emergencyRelation: formData.emergencyRelation.trim() || undefined,
                monthlySalary: formData.monthlySalary.trim() || undefined,
                accountNumber: formData.accountNumber.trim() || undefined,
                ifscCode: formData.ifscCode.trim() || undefined,
                bankName: formData.bankName.trim() || undefined,
                notes: formData.notes.trim() || undefined,
              },
            },
          }, currentSchoolId);
        }
      } else {
        if (editingRecord?.backendId && editingRecord.backendType === 'non_teaching') {
          await apiService.updateInvigilator(editingRecord.backendId, {
            staff_id: formData.employeeId.trim() || undefined,
            name: fullName,
            email: formData.email.trim() || undefined,
            phone: formData.primaryMobile.trim() || undefined,
            department: formData.department.trim() || formData.staffCategory,
            designation: formData.designation.trim() || formData.staffCategory,
            joining_date: formData.joiningDate || undefined,
            shift_timing: formData.shiftTiming.trim() || undefined,
            is_active: formData.isActive,
            photoDataUrl: photoDataUrl || undefined,
            metadata: {
              category: formData.staffCategory,
              joining_date: formData.joiningDate || undefined,
              shift_timing: formData.shiftTiming.trim() || undefined,
              directory_details: {
                dob: formData.dob || undefined,
                primaryMobile: formData.primaryMobile.trim() || undefined,
                whatsappNumber: formData.whatsappNumber.trim() || undefined,
                gender: formData.gender || undefined,
                maritalStatus: formData.maritalStatus || undefined,
                schoolName: formData.schoolName.trim() || undefined,
                fatherName: formData.fatherName.trim() || undefined,
                fatherContact: formData.fatherContact.trim() || undefined,
                motherName: formData.motherName.trim() || undefined,
                motherContact: formData.motherContact.trim() || undefined,
                spouseName: formData.spouseName.trim() || undefined,
                addressLine1: formData.addressLine1.trim() || undefined,
                addressLine2: formData.addressLine2.trim() || undefined,
                city: formData.city.trim() || undefined,
                state: formData.state.trim() || undefined,
                country: formData.country.trim() || undefined,
                pinCode: formData.pinCode.trim() || undefined,
                aadhaarNumber: formData.aadhaarNumber.trim() || undefined,
                panNumber: formData.panNumber.trim() || undefined,
                bloodGroup: formData.bloodGroup.trim() || undefined,
                emergencyContactName: formData.emergencyContactName.trim() || undefined,
                emergencyContactNumber: formData.emergencyContactNumber.trim() || undefined,
                emergencyRelation: formData.emergencyRelation.trim() || undefined,
                monthlySalary: formData.monthlySalary.trim() || undefined,
                accountNumber: formData.accountNumber.trim() || undefined,
                ifscCode: formData.ifscCode.trim() || undefined,
                bankName: formData.bankName.trim() || undefined,
                notes: formData.notes.trim() || undefined,
              },
            },
          });
        } else {
          await apiService.createInvigilator({
            staff_id: formData.employeeId.trim(),
            name: fullName,
            email: formData.email.trim() || undefined,
            phone: formData.primaryMobile.trim() || undefined,
            department: formData.department.trim() || formData.staffCategory,
            designation: formData.designation.trim() || formData.staffCategory,
            joining_date: formData.joiningDate || undefined,
            shift_timing: formData.shiftTiming.trim() || undefined,
            is_active: formData.isActive,
            photoDataUrl: photoDataUrl || undefined,
            metadata: {
              category: formData.staffCategory,
              joining_date: formData.joiningDate || undefined,
              shift_timing: formData.shiftTiming.trim() || undefined,
              directory_details: {
                dob: formData.dob || undefined,
                primaryMobile: formData.primaryMobile.trim() || undefined,
                whatsappNumber: formData.whatsappNumber.trim() || undefined,
                gender: formData.gender || undefined,
                maritalStatus: formData.maritalStatus || undefined,
                schoolName: formData.schoolName.trim() || undefined,
                fatherName: formData.fatherName.trim() || undefined,
                fatherContact: formData.fatherContact.trim() || undefined,
                motherName: formData.motherName.trim() || undefined,
                motherContact: formData.motherContact.trim() || undefined,
                spouseName: formData.spouseName.trim() || undefined,
                addressLine1: formData.addressLine1.trim() || undefined,
                addressLine2: formData.addressLine2.trim() || undefined,
                city: formData.city.trim() || undefined,
                state: formData.state.trim() || undefined,
                country: formData.country.trim() || undefined,
                pinCode: formData.pinCode.trim() || undefined,
                aadhaarNumber: formData.aadhaarNumber.trim() || undefined,
                panNumber: formData.panNumber.trim() || undefined,
                bloodGroup: formData.bloodGroup.trim() || undefined,
                emergencyContactName: formData.emergencyContactName.trim() || undefined,
                emergencyContactNumber: formData.emergencyContactNumber.trim() || undefined,
                emergencyRelation: formData.emergencyRelation.trim() || undefined,
                monthlySalary: formData.monthlySalary.trim() || undefined,
                accountNumber: formData.accountNumber.trim() || undefined,
                ifscCode: formData.ifscCode.trim() || undefined,
                bankName: formData.bankName.trim() || undefined,
                notes: formData.notes.trim() || undefined,
              },
            },
          }, currentSchoolId);
        }
      }

      setMessageType('success');
      setMessage(
        editingRecord
          ? 'Staff full details updated successfully.'
          : formData.staffType === 'teaching'
            ? 'Teaching staff added successfully. Ab yeh Invigilator Management mein available staff ke andar dikhega.'
            : 'Non-teaching staff added successfully. Ab yeh Invigilator Management mein available staff ke andar dikhega.'
      );
      if (editingRecord) {
        navigate('/staff/directory', { state: { staffType: formData.staffType } });
      } else {
        resetForm(formData.staffType);
      }
    } catch (error: any) {
      const detail = error?.response?.data?.detail;
      setMessageType('error');
      setMessage(typeof detail === 'string' ? detail : 'Staff save nahi ho paya.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#eef3f8] p-4 md:p-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-5 rounded-xl bg-white px-4 py-4 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">{editingRecord ? 'Edit Staff' : 'Add Staff'}</h1>
              <p className="mt-1 text-sm text-slate-500">
                {editingRecord
                  ? 'Yahan aap staff ki poori filled details edit kar sakte ho.'
                  : 'Teaching, non-teaching, peon, driver, guard aur other staff categories ke liye ek hi structured form.'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  updateField('staffType', 'teaching');
                  syncCategoryForType('teaching');
                }}
                className={`rounded-md px-4 py-2 text-sm font-semibold ${
                  formData.staffType === 'teaching' ? 'bg-[#c07a10] text-white' : 'bg-[#f5f7fa] text-slate-700'
                }`}
              >
                Teaching Staff
              </button>
              <button
                type="button"
                onClick={() => {
                  updateField('staffType', 'non_teaching');
                  syncCategoryForType('non_teaching');
                }}
                className={`rounded-md px-4 py-2 text-sm font-semibold ${
                  formData.staffType === 'non_teaching' ? 'bg-[#c07a10] text-white' : 'bg-[#f5f7fa] text-slate-700'
                }`}
              >
                Non-Teaching Staff
              </button>
              <button
                type="button"
                onClick={() =>
                  navigate('/staff/directory', {
                    state: { staffType: navigationState?.returnStaffType || navigationState?.staffType || formData.staffType },
                  })
                }
                className="rounded-md border border-[#d8e2ec] bg-white px-4 py-2 text-sm font-semibold text-slate-700"
              >
                Staff Directory
              </button>
              <button
                type="button"
                onClick={() => navigate('/staff/bulk-upload')}
                className="rounded-md border border-[#d8e2ec] bg-white px-4 py-2 text-sm font-semibold text-slate-700"
              >
                Bulk Upload
              </button>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <Section title="Personal Details">
            <div className="grid gap-4 xl:grid-cols-[1fr_260px]">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Name / First Name *">
                  <input value={formData.firstName} onChange={(e) => updateField('firstName', e.target.value)} className={inputClass} />
                </Field>
                <Field label="Last Name">
                  <input value={formData.lastName} onChange={(e) => updateField('lastName', e.target.value)} className={inputClass} />
                </Field>
                <Field label="Middle Name">
                  <input value={formData.middleName} onChange={(e) => updateField('middleName', e.target.value)} className={inputClass} />
                </Field>
                <Field label="Date of Birth">
                  <input type="date" value={formData.dob} onChange={(e) => updateField('dob', e.target.value)} className={inputClass} />
                </Field>
                <Field label="Primary Mobile Number">
                  <input value={formData.primaryMobile} onChange={(e) => updateField('primaryMobile', e.target.value)} className={inputClass} />
                </Field>
                <Field label="WhatsApp Number">
                  <input value={formData.whatsappNumber} onChange={(e) => updateField('whatsappNumber', e.target.value)} className={inputClass} />
                </Field>
                <Field label="Email">
                  <input type="email" value={formData.email} onChange={(e) => updateField('email', e.target.value)} className={inputClass} />
                </Field>
                <Field label="Gender">
                  <select value={formData.gender} onChange={(e) => updateField('gender', e.target.value)} className={inputClass}>
                    <option value="">Select gender</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </select>
                </Field>
                <Field label="Marital Status">
                  <select value={formData.maritalStatus} onChange={(e) => updateField('maritalStatus', e.target.value)} className={inputClass}>
                    <option value="">Select status</option>
                    <option value="single">Single</option>
                    <option value="married">Married</option>
                    <option value="divorced">Divorced</option>
                  </select>
                </Field>
              </div>

              <div className="rounded-xl border border-dashed border-[#d9c39a] bg-[#fcf5ea] p-4">
                <p className="text-sm font-semibold text-slate-800">Staff Photo</p>
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handlePhotoInputChange}
                />
                <div className="mt-4 flex h-44 items-center justify-center overflow-hidden rounded-lg bg-[#f0e4cf] p-2 text-xs text-slate-500">
                  {photoPreviewUrl ? (
                    <img src={photoPreviewUrl} alt="Staff preview" className="h-full w-full rounded-md object-contain" />
                  ) : (
                    'Image Preview'
                  )}
                </div>
                <div className="mt-4 space-y-2">
                  <button
                    type="button"
                    onClick={() => photoInputRef.current?.click()}
                    className="flex w-full items-center justify-center gap-2 rounded-md bg-[#c07a10] px-3 py-2 text-xs font-semibold text-white"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    Upload From System
                  </button>
                  <button
                    type="button"
                    onClick={handleOpenCamera}
                    className="flex w-full items-center justify-center gap-2 rounded-md border border-[#c07a10] bg-white px-3 py-2 text-xs font-semibold text-[#a9680d]"
                  >
                    <Camera className="h-3.5 w-3.5" />
                    Open Camera
                  </button>
                  {photoFile ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (photoPreviewUrl) {
                          URL.revokeObjectURL(photoPreviewUrl);
                        }
                        setPhotoFile(null);
                        setPhotoPreviewUrl('');
                        setPhotoDataUrl('');
                      }}
                      className="flex w-full items-center justify-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Remove Photo
                    </button>
                  ) : null}
                  {cameraError ? <p className="text-xs text-rose-600">{cameraError}</p> : null}
                </div>
              </div>
            </div>
          </Section>

          <Section title="Qualifications And Institute Details">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <Field label="Employee ID">
                <input value={formData.employeeId} onChange={(e) => updateField('employeeId', e.target.value)} className={inputClass} />
              </Field>
              <Field label="Joining Date">
                <input type="date" value={formData.joiningDate} onChange={(e) => updateField('joiningDate', e.target.value)} className={inputClass} />
              </Field>
              <Field label="School / Institute">
                <input value={formData.schoolName} onChange={(e) => updateField('schoolName', e.target.value)} className={inputClass} />
              </Field>
              <Field label="Staff Type *">
                <select
                  value={formData.staffType}
                  onChange={(e) => {
                    const nextType = e.target.value as StaffType;
                    updateField('staffType', nextType);
                    syncCategoryForType(nextType);
                  }}
                  className={inputClass}
                >
                  <option value="teaching">Teaching</option>
                  <option value="non_teaching">Non-Teaching</option>
                </select>
              </Field>
              <Field label="Staff Category">
                <select value={formData.staffCategory} onChange={(e) => updateField('staffCategory', e.target.value)} className={inputClass}>
                  {categoryOptions.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </Field>
              <Field label={formData.staffType === 'teaching' ? 'Subject *' : 'Department'}>
                <input
                  value={formData.staffType === 'teaching' ? formData.subject : formData.department}
                  onChange={(e) =>
                    formData.staffType === 'teaching'
                      ? updateField('subject', e.target.value)
                      : updateField('department', e.target.value)
                  }
                  className={inputClass}
                />
              </Field>
              <Field label="Designation">
                <input
                  value={formData.designation}
                  onChange={(e) => updateField('designation', e.target.value)}
                  className={inputClass}
                  placeholder={formData.staffCategory}
                />
              </Field>
              <Field label="Shift Timing">
                <input value={formData.shiftTiming} onChange={(e) => updateField('shiftTiming', e.target.value)} className={inputClass} placeholder="e.g. 8 AM - 3 PM" />
              </Field>
              <Field label="Notes">
                <textarea value={formData.notes} onChange={(e) => updateField('notes', e.target.value)} className={`${inputClass} min-h-[42px]`} />
              </Field>
            </div>
          </Section>

          <Section title="Family Details">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <Field label="Father Name">
                <input value={formData.fatherName} onChange={(e) => updateField('fatherName', e.target.value)} className={inputClass} />
              </Field>
              <Field label="Father Contact Number">
                <input value={formData.fatherContact} onChange={(e) => updateField('fatherContact', e.target.value)} className={inputClass} />
              </Field>
              <Field label="Mother Name">
                <input value={formData.motherName} onChange={(e) => updateField('motherName', e.target.value)} className={inputClass} />
              </Field>
              <Field label="Mother Contact Number">
                <input value={formData.motherContact} onChange={(e) => updateField('motherContact', e.target.value)} className={inputClass} />
              </Field>
              <Field label="Spouse Name">
                <input value={formData.spouseName} onChange={(e) => updateField('spouseName', e.target.value)} className={inputClass} />
              </Field>
            </div>
          </Section>

          <Section title="Identification">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <Field label="Aadhaar Number">
                <input value={formData.aadhaarNumber} onChange={(e) => updateField('aadhaarNumber', e.target.value)} className={inputClass} />
              </Field>
              <Field label="PAN Number">
                <input value={formData.panNumber} onChange={(e) => updateField('panNumber', e.target.value)} className={inputClass} />
              </Field>
              <Field label="Blood Group">
                <input value={formData.bloodGroup} onChange={(e) => updateField('bloodGroup', e.target.value)} className={inputClass} />
              </Field>
            </div>
          </Section>

          <Section title="Address Details">
            <div className="grid gap-4">
              <Field label="Address Line 1">
                <input value={formData.addressLine1} onChange={(e) => updateField('addressLine1', e.target.value)} className={inputClass} />
              </Field>
              <Field label="Address Line 2">
                <input value={formData.addressLine2} onChange={(e) => updateField('addressLine2', e.target.value)} className={inputClass} />
              </Field>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Field label="City">
                  <input value={formData.city} onChange={(e) => updateField('city', e.target.value)} className={inputClass} />
                </Field>
                <Field label="State">
                  <input value={formData.state} onChange={(e) => updateField('state', e.target.value)} className={inputClass} />
                </Field>
                <Field label="Country">
                  <input value={formData.country} onChange={(e) => updateField('country', e.target.value)} className={inputClass} />
                </Field>
                <Field label="Pin Code">
                  <input value={formData.pinCode} onChange={(e) => updateField('pinCode', e.target.value)} className={inputClass} />
                </Field>
              </div>
            </div>
          </Section>

          <Section title="Emergency Details">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Field label="Emergency Contact Name">
                <input value={formData.emergencyContactName} onChange={(e) => updateField('emergencyContactName', e.target.value)} className={inputClass} />
              </Field>
              <Field label="Emergency Contact Number">
                <input value={formData.emergencyContactNumber} onChange={(e) => updateField('emergencyContactNumber', e.target.value)} className={inputClass} />
              </Field>
              <Field label="Relation">
                <input value={formData.emergencyRelation} onChange={(e) => updateField('emergencyRelation', e.target.value)} className={inputClass} />
              </Field>
              <Field label="Active Status">
                <label className="flex h-[42px] items-center gap-2 rounded-lg border border-[#d8e2ec] bg-white px-3 text-sm text-slate-700">
                  <input type="checkbox" checked={formData.isActive} onChange={(e) => updateField('isActive', e.target.checked)} />
                  Active Staff
                </label>
              </Field>
            </div>
          </Section>

          <Section title="Salary Details">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Field label="Monthly Salary">
                <input value={formData.monthlySalary} onChange={(e) => updateField('monthlySalary', e.target.value)} className={inputClass} />
              </Field>
              <Field label="Account Number">
                <input value={formData.accountNumber} onChange={(e) => updateField('accountNumber', e.target.value)} className={inputClass} />
              </Field>
              <Field label="IFSC Code">
                <input value={formData.ifscCode} onChange={(e) => updateField('ifscCode', e.target.value)} className={inputClass} />
              </Field>
              <Field label="Bank Name">
                <input value={formData.bankName} onChange={(e) => updateField('bankName', e.target.value)} className={inputClass} />
              </Field>
            </div>
          </Section>

          <Section title="Add Documents">
            <input
              ref={documentInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleDocumentInputChange}
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-slate-500">Document picker ab working hai. Multiple files add kar sakte ho.</p>
              <button
                type="button"
                onClick={() => documentInputRef.current?.click()}
                className="inline-flex items-center gap-2 rounded-md border border-[#d58a17] bg-white px-4 py-2 text-sm font-semibold text-[#a9680d]"
              >
                <Plus className="h-4 w-4" />
                Add Document
              </button>
            </div>
            {documents.length ? (
              <div className="mt-4 space-y-3">
                {documents.map((document) => (
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
                      <button
                        type="button"
                        onClick={() => handlePreviewDocument(document)}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        Preview
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemoveDocument(document.id)}
                        className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </Section>

          {message ? (
            <div className={`rounded-lg px-4 py-3 text-sm font-medium ${messageType === 'success' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-700'}`}>
              {message}
            </div>
          ) : null}

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => resetForm(formData.staffType)}
              className="rounded-md border border-[#d8e2ec] bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Clear
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-[#c07a10] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#aa6d10] disabled:opacity-70"
            >
              {saving ? 'Saving...' : editingRecord ? 'Update Full Details' : 'Add Staff'}
            </button>
          </div>
        </form>
      </div>

      {cameraOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-4 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">Capture Staff Photo</h3>
              <button type="button" onClick={stopCamera} className="rounded-full p-2 text-slate-500 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="overflow-hidden rounded-xl bg-slate-950">
              <video ref={videoRef} autoPlay playsInline muted className="h-[360px] w-full object-cover" />
            </div>
            <canvas ref={canvasRef} className="hidden" />
            <div className="mt-4 flex justify-end gap-3">
              <button
                type="button"
                onClick={stopCamera}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCapturePhoto}
                className="rounded-md bg-[#c07a10] px-4 py-2 text-sm font-semibold text-white"
              >
                Capture Photo
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
