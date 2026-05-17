// @ts-nocheck
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode, type SelectHTMLAttributes } from 'react';
import {
  Bell,
  ChevronDown,
  Camera,
  CreditCard,
  Download,
  IndianRupee,
  Landmark,
  Search,
  ShieldCheck,
  Smartphone,
  Receipt,
  Wallet,
  BarChart3,
  FileClock,
  Trash2,
  Upload,
  UsersRound,
  Users,
} from 'lucide-react';

import { Alert } from '@components/Alert';
import { LoadingSpinner } from '@components/LoadingSpinner';
import { apiService } from '@services/api';
import {
  appendEduPayPageTransaction,
  clearEduPayWorkspaceData,
  getEduPayStudentProfile,
  markEduPayAdmissionRequestProcessed,
  readEduPayPageTransactions,
  readEduPayPaymentLinks,
  readEduPayAdmissionRequests,
  readEduPayStudentProfiles,
  upsertEduPayPaymentLink,
  upsertEduPayStudentProfile,
  type EduPayAdmissionRequest,
  type EduPayAdmissionSnapshot,
  type EduPayFinancePlan,
  type EduPayInstallmentPlanDraft,
  type EduPayPaymentLinkRecord,
  type EduPayPageTransactionRecord,
  type EduPayPaymentMode,
} from '@utils/eduPayAdmissions';
import type {
  EduPayAssignment,
  EduPayAssignmentStatus,
  EduPayDashboard,
  EduPayFeeStructure,
  EduPayInstallmentPlan,
  EduPayParentPortal,
  EduPayPayment,
  EduPayPaymentMethod,
  EduPayStudent,
} from '@types';

type TabKey = 'overview' | 'students' | 'fees' | 'payments' | 'parent';

type EduPayStudentMeta = {
  institute: string;
  board: string;
  academicYear: string;
  isNewAdmission: 'yes' | 'no';
  identifier: string;
  grade: string;
};

type AdmissionMode = 'request' | 'direct';
type StudentWorkspaceView = 'admission' | 'ledger';
type PaymentWorkspaceView = 'collector' | 'links' | 'transactions';
type AdmissionDeskStep = 'details' | 'finance_payment';
type PlannerPaymentOption = {
  id: string;
  studentProfileId: string;
  studentName: string;
  admissionNo: string;
  installmentLabel: string;
  amountDue: number;
  dueDate?: string;
};

type EduPaySideItem = {
  id: string;
  label: string;
  icon?: typeof Users;
  tab?: TabKey;
  children?: Array<{
    id: string;
    label: string;
    tab: TabKey;
    studentView?: StudentWorkspaceView;
    paymentView?: PaymentWorkspaceView;
  }>;
};

const eduPaySideItems: EduPaySideItem[] = [
  {
    id: 'students',
    label: 'Students',
    icon: UsersRound,
    children: [
      { id: 'student-admission', label: 'Admission Desk', tab: 'students', studentView: 'admission' },
      { id: 'student-ledger', label: 'Student Ledger', tab: 'students', studentView: 'ledger' },
    ],
  },
  { id: 'installments', label: 'Installments', icon: Receipt, tab: 'fees' },
  { id: 'payments', label: 'Payments', icon: CreditCard, tab: 'payments' },
  { id: 'settlements', label: 'Settlements', icon: Wallet, tab: 'overview' },
  {
    id: 'pay',
    label: 'Pay',
    icon: CreditCard,
    children: [
      { id: 'payment-links', label: 'Payment Links', tab: 'payments', paymentView: 'links' },
      { id: 'page-transactions', label: 'Page Transactions', tab: 'payments', paymentView: 'transactions' },
    ],
  },
  { id: 'overdue', label: 'Overdue', icon: Bell, tab: 'payments' },
  { id: 'reports', label: 'Reports', icon: BarChart3, tab: 'overview' },
  { id: 'users', label: 'Users', icon: Users, tab: 'parent' },
];

const initialStudentForm = {
  admission_no: '',
  full_name: '',
  institute: '',
  board: '',
  class_name: '',
  academic_year: '2026-2027',
  is_new_admission: 'yes' as 'yes' | 'no',
  identifier: '',
  course: '' as '' | 'neet' | 'jee_main' | 'advance' | 'ssb',
  program: '' as '' | 'medical' | 'non_medical',
  dob: '',
  gender: '',
  batch_name: '',
  email: '',
  phone: '',
  parent_name: '',
  parent_mobile: '',
  parent_email: '',
  parent_relation: 'parent',
  address1: '',
  city: '',
  state: '',
  country: 'India',
  pincode: '',
  selected_fee_structure_id: '',
};

const BATCH_FEE_PRESETS: Array<{ match: string; amount: number }> = [
  { match: 'foundation 7th', amount: 40000 },
  { match: 'foundation 8th', amount: 44000 },
  { match: 'foundation 9th', amount: 48000 },
  { match: 'foundation 10th', amount: 52000 },
  { match: '10th ssb', amount: 48000 },
  { match: '11th ssb medical', amount: 120000 },
  { match: '11th ssb non-medical', amount: 120000 },
  { match: '11th newton med', amount: 85000 },
  { match: '11th newton non-med', amount: 85000 },
  { match: '12th ssb medical', amount: 120000 },
  { match: '12th ssb non-medical', amount: 120000 },
  { match: '12th newton med', amount: 85000 },
  { match: '12th newton non-med', amount: 85000 },
  { match: 'dropper medical', amount: 120000 },
  { match: 'dropper non medical', amount: 120000 },
];

const normalizeFeeKey = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const getBatchPresetFee = ({
  batchName = '',
  className = '',
  course = '',
  program = '',
}: {
  batchName?: string;
  className?: string;
  course?: string;
  program?: string;
}) => {
  const normalizedBatch = normalizeFeeKey(batchName);
  const normalizedClass = normalizeFeeKey(className);
  const normalizedCourse = normalizeFeeKey(course);
  const normalizedProgram = normalizeFeeKey(program.replace('_', ' '));
  const combined = [normalizedBatch, normalizedClass, normalizedCourse, normalizedProgram].filter(Boolean).join(' ');

  const rawMatch = BATCH_FEE_PRESETS.find((item) => combined.includes(item.match));
  if (rawMatch) return rawMatch.amount;

  const isDropper = combined.includes('dropper');
  const is11th = combined.includes('11th');
  const is12th = combined.includes('12th');
  const is10th = combined.includes('10th');
  const is7th = combined.includes('7th');
  const is8th = combined.includes('8th');
  const is9th = combined.includes('9th');
  const isFoundation = combined.includes('foundation');
  const isMedical = combined.includes('medical') && !combined.includes('non medical');
  const isNonMedical = combined.includes('non medical') || combined.includes('non med');
  const isNeet = normalizedCourse === 'neet' || combined.includes('neet');
  const isJee = normalizedCourse === 'jee main' || combined.includes('jee');
  const isAdvance = normalizedCourse === 'advance' || combined.includes('advance');
  const isSsb = normalizedCourse === 's s b' || combined.includes('ssb') || combined.includes('sure selection');

  if (isFoundation) {
    if (is7th) return 40000;
    if (is8th) return 44000;
    if (is9th) return 48000;
    if (is10th) return 52000;
  }

  if (isSsb) {
    if (is10th) return 48000;
    if (is11th || is12th) return 120000;
  }

  if (isNeet) {
    if (isDropper) return 120000;
    if ((is11th || is12th) && isMedical) return 85000;
  }

  if (isJee || isAdvance) {
    if (isDropper) return 120000;
    if (is11th || is12th) return 85000;
  }

  if (isDropper && isMedical) return 120000;
  if (isDropper && isNonMedical) return 120000;
  if ((is11th || is12th) && isMedical) return 85000;
  if ((is11th || is12th) && isNonMedical) return 85000;

  return 0;
};

const buildFinancePlan = ({
  totalFee,
  bookingAmount,
  scholarshipAmount,
  installmentCount,
  nextPaymentDate,
  preferredPaymentMode,
  manualInstallments,
}: {
  totalFee: number;
  bookingAmount: number;
  scholarshipAmount: number;
  installmentCount: 1 | 2 | 3;
  nextPaymentDate?: string;
  preferredPaymentMode: EduPayPaymentMode;
  manualInstallments?: number[];
}): EduPayFinancePlan => {
  const safeTotal = Math.max(totalFee, 0);
  const safeScholarship = Math.max(Math.min(scholarshipAmount, safeTotal), 0);
  const netFee = Math.max(safeTotal - safeScholarship, 0);
  const safeBooking = Math.max(Math.min(bookingAmount, netFee), 0);
  const remainingAfterBooking = Math.max(netFee - safeBooking, 0);

  const defaults = Array.from({ length: installmentCount }, (_, index) => {
    const raw = Math.floor((remainingAfterBooking / installmentCount) * 100) / 100;
    if (index === installmentCount - 1) {
      const used = Number((raw * (installmentCount - 1)).toFixed(2));
      return Number((remainingAfterBooking - used).toFixed(2));
    }
    return Number(raw.toFixed(2));
  });

  const installments: EduPayInstallmentPlanDraft[] = defaults.map((amount, index) => ({
    id: `inst-${index + 1}`,
    label: `Installment ${index + 1}`,
    amount: Number((manualInstallments?.[index] ?? amount).toFixed(2)),
    dueDate: nextPaymentDate || '',
    isPaid: false,
  }));

  return {
    totalFee: safeTotal,
    bookingAmount: safeBooking,
    scholarshipAmount: safeScholarship,
    netFee,
    remainingAfterBooking,
    installmentCount,
    installments,
    preferredPaymentMode,
    nextPaymentDate,
  };
};

const initialFeeForm = {
  name: '',
  fee_type: 'tuition',
  class_name: '',
  installment_plan: 'monthly' as EduPayInstallmentPlan,
  total_amount: 0,
  discount_amount: 0,
  late_fee_rule: '',
  description: '',
};

const initialPaymentForm = {
  assignment_id: '',
  amount: 0,
  method: 'upi' as EduPayPaymentMethod,
  transaction_reference: '',
};

const sectionClass = 'rounded-[1.35rem] border border-slate-200 bg-white p-4 shadow-[0_12px_30px_rgba(15,23,42,0.05)]';
const inputClass =
  'w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-900 focus:ring-4 focus:ring-slate-200/70';
const selectClass =
  'w-full appearance-none rounded-2xl border border-slate-300 bg-white px-4 py-3 pr-11 text-sm font-medium text-slate-900 outline-none transition focus:border-slate-900 focus:ring-4 focus:ring-slate-200/70';
const edupayStudentMetaStorageKey = 'edupay-student-metadata';
const edupayCleanupVersionKey = 'edupay-cleanup-version';
const edupayCleanupVersion = 'cleanup-v2';

function readEduPayStudentMeta(): Record<string, EduPayStudentMeta> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(edupayStudentMetaStorageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeEduPayStudentMeta(meta: Record<string, EduPayStudentMeta>) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(edupayStudentMetaStorageKey, JSON.stringify(meta));
}

function clearEduPayStudentMeta() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(edupayStudentMetaStorageKey);
}

function studentMetaKey(student: Pick<EduPayStudent, 'id' | 'admission_no'>) {
  return `student-${student.id}-${student.admission_no}`;
}

function formatCurrency(value: number) {
  return `Rs ${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function ensureArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function formatDate(value?: string) {
  if (!value) return 'N/A';
  return new Date(value).toLocaleDateString();
}

function buildAutoPaymentReference(mode: EduPayPaymentMode, admissionNo: string) {
  const prefixMap: Record<EduPayPaymentMode, string> = {
    upi: 'UPI',
    card: 'CARD',
    net_banking: 'NET',
    cheque: 'CHQ',
    wallet: 'WALLET',
    cash: 'CASH',
  };
  const prefix = prefixMap[mode] || 'PAY';
  const safeAdmission = admissionNo.trim().replace(/[^a-z0-9]/gi, '').toUpperCase() || 'STUDENT';
  return `${prefix}-${safeAdmission}-${Date.now().toString().slice(-6)}`;
}

function statusClass(status: EduPayAssignmentStatus) {
  if (status === 'paid') return 'bg-emerald-100 text-emerald-700 border border-emerald-200';
  if (status === 'overdue') return 'bg-rose-100 text-rose-700 border border-rose-200';
  return 'bg-amber-100 text-amber-700 border border-amber-200';
}

export default function FeeManagement() {
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [expandedEduPaySections, setExpandedEduPaySections] = useState<string[]>(['pay']);
  const [studentWorkspaceView, setStudentWorkspaceView] = useState<StudentWorkspaceView>('admission');
  const [paymentWorkspaceView, setPaymentWorkspaceView] = useState<PaymentWorkspaceView>('collector');
  const [admissionDeskStep, setAdmissionDeskStep] = useState<AdmissionDeskStep>('details');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [alert, setAlert] = useState<{ type: 'success' | 'error' | 'warning' | 'info'; message: string } | null>(null);

  const [dashboard, setDashboard] = useState<EduPayDashboard | null>(null);
  const [students, setStudents] = useState<EduPayStudent[]>([]);
  const [feeStructures, setFeeStructures] = useState<EduPayFeeStructure[]>([]);
  const [assignments, setAssignments] = useState<EduPayAssignment[]>([]);
  const [payments, setPayments] = useState<EduPayPayment[]>([]);
  const [parentPortal, setParentPortal] = useState<EduPayParentPortal | null>(null);

  const [studentForm, setStudentForm] = useState(initialStudentForm);
  const [feeForm, setFeeForm] = useState(initialFeeForm);
  const [paymentForm, setPaymentForm] = useState(initialPaymentForm);
  const [studentSearch, setStudentSearch] = useState('');
  const [admissionMode, setAdmissionMode] = useState<AdmissionMode>('request');
  const [selectedAdmissionRequestId, setSelectedAdmissionRequestId] = useState('');
  const [admissionRequests, setAdmissionRequests] = useState<EduPayAdmissionRequest[]>(() => ensureArray<EduPayAdmissionRequest>(readEduPayAdmissionRequests()));
  const [studentMetaMap, setStudentMetaMap] = useState<Record<string, EduPayStudentMeta>>(() => readEduPayStudentMeta());
  const [instituteFilter, setInstituteFilter] = useState('all');
  const [boardFilter, setBoardFilter] = useState('all');
  const [gradeFilter, setGradeFilter] = useState('all');
  const [academicYearFilter, setAcademicYearFilter] = useState('all');
  const [admissionFilter, setAdmissionFilter] = useState('all');
  const [totalFeeInput, setTotalFeeInput] = useState(0);
  const [bookingAmountInput, setBookingAmountInput] = useState(20000);
  const [scholarshipAmountInput, setScholarshipAmountInput] = useState(0);
  const [installmentCountInput, setInstallmentCountInput] = useState<1 | 2 | 3>(2);
  const [nextPaymentDateInput, setNextPaymentDateInput] = useState('');
  const [preferredPaymentModeInput, setPreferredPaymentModeInput] = useState<EduPayPaymentMode>('upi');
  const [installmentAmountsInput, setInstallmentAmountsInput] = useState<number[]>([0, 0, 0]);
  const [installmentValuesTouched, setInstallmentValuesTouched] = useState(false);
  const [bookingReceivedAmountInput, setBookingReceivedAmountInput] = useState(20000);
  const [bookingReceivedModeInput, setBookingReceivedModeInput] = useState<EduPayPaymentMode>('upi');
  const [bookingReceivedReferenceInput, setBookingReceivedReferenceInput] = useState('');
  const [bookingReceivedDateInput, setBookingReceivedDateInput] = useState(new Date().toISOString().slice(0, 10));
  const [paymentLinks, setPaymentLinks] = useState<EduPayPaymentLinkRecord[]>(() => ensureArray<EduPayPaymentLinkRecord>(readEduPayPaymentLinks()));
  const [pageTransactions, setPageTransactions] = useState<EduPayPageTransactionRecord[]>(() => ensureArray<EduPayPageTransactionRecord>(readEduPayPageTransactions()));
  const [studentPhotoPreviewUrl, setStudentPhotoPreviewUrl] = useState('');
  const studentPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const studentCameraInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const appliedVersion = window.localStorage.getItem(edupayCleanupVersionKey);
    if (appliedVersion === edupayCleanupVersion) return;

    clearEduPayWorkspaceData();
    clearEduPayStudentMeta();
    window.localStorage.setItem(edupayCleanupVersionKey, edupayCleanupVersion);

    setAdmissionRequests([]);
    setStudentMetaMap({});
    setPaymentLinks([]);
    setPageTransactions([]);
    setStudents([]);
    setAssignments([]);
    setPayments([]);
    setDashboard(null);
    setParentPortal(null);
    setPaymentForm(initialPaymentForm);
  }, []);

  const currentWorkspaceMeta = useMemo(() => {
    if (activeTab === 'students') {
      return studentWorkspaceView === 'ledger'
        ? {
            label: 'BRAIN OF HIMACHAL Ledger',
            title: 'Student ledger and fee visibility',
            description: 'Student listing, payment status, filters, and fee-side tracking ko yahan se monitor karo.',
          }
        : {
            label: 'BRAIN OF HIMACHAL Admission',
            title: 'Admission desk and fee onboarding',
            description: 'Admin requests review karo ya direct BRAIN OF HIMACHAL admission process yahin se start karo.',
          };
    }

    if (activeTab === 'fees') {
      return {
        label: 'BRAIN OF HIMACHAL Plans',
        title: 'Fee structure and installment planning',
        description: 'Class-wise fee plans, discounts, and installment schedules ko manage karo.',
      };
    }

    if (activeTab === 'payments') {
      if (paymentWorkspaceView === 'links') {
        return {
          label: 'Payment Links',
          title: 'Payment links and student reminders',
          description: 'Link create karo, message share karo, aur pending payment follow-up manage karo.',
        };
      }

      if (paymentWorkspaceView === 'transactions') {
        return {
          label: 'Page Transactions',
          title: 'Page transactions and received payments',
          description: 'Collected payments, received entries, aur manual transaction log ko yahan review karo.',
        };
      }

      return {
        label: 'BRAIN OF HIMACHAL Payments',
        title: 'Payment collection workspace',
        description: 'Receipts, pending dues, payment entries, aur verification state ko track karo.',
      };
    }

    if (activeTab === 'parent') {
      return {
        label: 'BRAIN OF HIMACHAL Parent Portal',
        title: 'Parent portal and child fee summary',
        description: 'Parent view, child-wise dues, aur payment history ko review karo.',
      };
    }

    return {
      label: 'BRAIN OF HIMACHAL Dashboard',
      title: 'BRAIN OF HIMACHAL Dashboard',
      description: 'Institute dashboard, collections, reminders, aur payment insights ek hi jagah par connected hain.',
    };
  }, [activeTab, studentWorkspaceView, paymentWorkspaceView]);

  const loadEduPayData = async (initial = false) => {
    try {
      initial ? setLoading(true) : setRefreshing(true);
      const [dashboardRes, studentsRes, structuresRes, assignmentsRes, paymentsRes, parentResult] = await Promise.allSettled([
        apiService.getEduPayDashboard(),
        apiService.listEduPayStudents(),
        apiService.listEduPayFeeStructures(),
        apiService.listEduPayAssignments(),
        apiService.listEduPayPayments(),
        apiService
          .getEduPayParentPortal()
          .catch((error) => {
            console.warn('EduPay parent portal unavailable', error);
            return null;
          }),
      ]);

      setDashboard(dashboardRes.status === 'fulfilled' ? dashboardRes.value.data : null);
      setStudents(studentsRes.status === 'fulfilled' ? ensureArray<EduPayStudent>(studentsRes.value.data) : []);
      setFeeStructures(structuresRes.status === 'fulfilled' ? ensureArray<EduPayFeeStructure>(structuresRes.value.data) : []);
      setAssignments(assignmentsRes.status === 'fulfilled' ? ensureArray<EduPayAssignment>(assignmentsRes.value.data) : []);
      setPayments(paymentsRes.status === 'fulfilled' ? ensureArray<EduPayPayment>(paymentsRes.value.data) : []);
      setParentPortal(parentResult.status === 'fulfilled' ? parentResult.value?.data ?? null : null);

      const failedSections = [
        dashboardRes.status !== 'fulfilled' ? 'dashboard' : null,
        studentsRes.status !== 'fulfilled' ? 'students' : null,
        structuresRes.status !== 'fulfilled' ? 'fee structures' : null,
        assignmentsRes.status !== 'fulfilled' ? 'assignments' : null,
        paymentsRes.status !== 'fulfilled' ? 'payments' : null,
      ].filter(Boolean);

      setAlert(
        failedSections.length
          ? {
              type: 'error',
              message: `BRAIN OF HIMACHAL ke kuch sections load nahi ho paaye: ${failedSections.join(', ')}.`,
            }
          : null
      );
    } catch (error: any) {
      console.error('Failed to load EduPay data', error);
      setAlert({
        type: 'error',
        message:
          error?.response?.data?.detail ||
          error?.response?.data?.error ||
          'BRAIN OF HIMACHAL data load nahi ho paya.',
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadEduPayData(true);
    refreshAdmissionRequestState();
  }, []);

  useEffect(() => {
    setPaymentLinks(ensureArray<EduPayPaymentLinkRecord>(readEduPayPaymentLinks()));
    setPageTransactions(ensureArray<EduPayPageTransactionRecord>(readEduPayPageTransactions()));
  }, [activeTab, paymentWorkspaceView]);

  const refreshAdmissionRequestState = () => {
    setAdmissionRequests(ensureArray<EduPayAdmissionRequest>(readEduPayAdmissionRequests()));
  };

  const buildAdmissionSnapshot = (): EduPayAdmissionSnapshot => ({
    admissionId: studentForm.admission_no.trim(),
    academicYear: studentForm.academic_year.trim(),
    course: studentForm.course,
    program: studentForm.program,
    managedBatch: studentForm.batch_name.trim(),
    className: studentForm.class_name.trim(),
    section: '',
    rollNumber: studentForm.identifier.trim(),
    firstName: studentForm.full_name.trim().split(/\s+/)[0] || '',
    middleName: studentForm.full_name.trim().split(/\s+/).slice(1, -1).join(' '),
    lastName: studentForm.full_name.trim().split(/\s+/).length > 1 ? studentForm.full_name.trim().split(/\s+/).slice(-1)[0] : '',
    fullName: studentForm.full_name.trim(),
    dob: studentForm.dob,
    gender: studentForm.gender,
    email: studentForm.email.trim(),
    phone: studentForm.phone.trim(),
    fatherName: studentForm.parent_name.trim(),
    fatherMobile: studentForm.parent_mobile.trim(),
    address1: studentForm.address1.trim(),
    city: studentForm.city.trim(),
    state: studentForm.state.trim(),
    country: studentForm.country.trim(),
    pincode: studentForm.pincode.trim(),
    admissionType: studentForm.is_new_admission === 'yes' ? 'new' : 'old',
    institute: studentForm.institute.trim(),
    board: studentForm.board.trim(),
    identifier: studentForm.identifier.trim(),
    preferredFeeStructureId: studentForm.selected_fee_structure_id ? Number(studentForm.selected_fee_structure_id) : null,
    preferredFeeStructureName:
      feeStructures.find((item) => item.id === Number(studentForm.selected_fee_structure_id))?.name || '',
    financePlan: buildFinancePlan({
      totalFee: totalFeeInput,
      bookingAmount: bookingAmountInput,
      scholarshipAmount: scholarshipAmountInput,
      installmentCount: installmentCountInput,
      nextPaymentDate: nextPaymentDateInput,
      preferredPaymentMode: preferredPaymentModeInput,
      manualInstallments: installmentAmountsInput,
    }),
  });

  const resetAdmissionDraftState = () => {
    setStudentForm(initialStudentForm);
    setSelectedAdmissionRequestId('');
    setAdmissionDeskStep('details');
    setTotalFeeInput(0);
    setBookingAmountInput(20000);
    setScholarshipAmountInput(0);
    setInstallmentCountInput(2);
    setNextPaymentDateInput('');
    setPreferredPaymentModeInput('upi');
    setInstallmentAmountsInput([0, 0, 0]);
    setInstallmentValuesTouched(false);
    setBookingReceivedAmountInput(20000);
    setBookingReceivedModeInput('upi');
    setBookingReceivedReferenceInput('');
    setBookingReceivedDateInput(new Date().toISOString().slice(0, 10));
    setStudentPhotoPreviewUrl('');
  };

  const validateAdmissionDetails = () => {
    if (!studentForm.admission_no.trim()) return 'Admission No required hai.';
    if (!studentForm.full_name.trim()) return 'Student Name required hai.';
    if (!studentForm.institute.trim()) return 'Institute required hai.';
    if (!studentForm.board.trim()) return 'Board required hai.';
    if (!studentForm.class_name.trim()) return 'Class required hai.';
    if (!studentForm.parent_name.trim()) return 'Parent Name required hai.';
    if (!studentForm.parent_mobile.trim()) return 'Parent Mobile required hai.';
    return '';
  };

  const handleEduPayPhotoInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      setStudentPhotoPreviewUrl(typeof reader.result === 'string' ? reader.result : '');
    };
    reader.readAsDataURL(file);
    event.target.value = '';
  };

  const applyAdmissionRequestToForm = (request: EduPayAdmissionRequest) => {
    const details = request.details;
    setStudentForm({
      admission_no: details.admissionId || details.rollNumber || '',
      full_name: details.fullName || [details.firstName, details.middleName, details.lastName].filter(Boolean).join(' '),
      institute: details.institute || '',
      board: details.board || '',
      class_name: details.className || '',
      academic_year: details.academicYear || '2026-2027',
      is_new_admission: details.admissionType === 'old' ? 'no' : 'yes',
      identifier: details.identifier || details.rollNumber || '',
      course: details.course || '',
      program: details.program || '',
      dob: details.dob || '',
      gender: details.gender || '',
      batch_name: details.managedBatch || '',
      email: details.email || '',
      phone: details.phone || '',
      parent_name: details.fatherName || details.guardianName || '',
      parent_mobile: details.fatherMobile || details.guardianMobile || '',
      parent_email: details.email || '',
      parent_relation: details.priorityContact || 'parent',
      address1: details.address1 || '',
      city: details.city || '',
      state: details.state || '',
      country: details.country || 'India',
      pincode: details.pincode || '',
      selected_fee_structure_id: details.preferredFeeStructureId ? String(details.preferredFeeStructureId) : '',
    });
    const finance = details.financePlan;
    setTotalFeeInput(
      finance?.totalFee ??
        getBatchPresetFee({
          batchName: details.managedBatch || '',
          className: details.className || '',
          course: details.course || '',
          program: details.program || '',
        }),
    );
    setBookingAmountInput(finance?.bookingAmount ?? 20000);
    setScholarshipAmountInput(finance?.scholarshipAmount ?? 0);
    setInstallmentCountInput(finance?.installmentCount ?? 2);
    setNextPaymentDateInput(finance?.nextPaymentDate ?? '');
    setPreferredPaymentModeInput(finance?.preferredPaymentMode ?? 'upi');
    setInstallmentAmountsInput([
      finance?.installments?.[0]?.amount ?? 0,
      finance?.installments?.[1]?.amount ?? 0,
      finance?.installments?.[2]?.amount ?? 0,
    ]);
    setInstallmentValuesTouched(Boolean(finance?.installments?.some((item) => (item?.amount ?? 0) > 0)));
    setSelectedAdmissionRequestId(request.id);
    setAdmissionDeskStep('details');
  };

  const selectedAdmissionRequest = useMemo(
    () => admissionRequests.find((item) => item.id === selectedAdmissionRequestId) || null,
    [admissionRequests, selectedAdmissionRequestId],
  );

  const pendingAdmissionRequests = useMemo(
    () => admissionRequests.filter((item) => item.status === 'pending'),
    [admissionRequests],
  );

  const currentBatchPresetFee = useMemo(
    () =>
      getBatchPresetFee({
        batchName: studentForm.batch_name,
        className: studentForm.class_name,
        course: studentForm.course,
        program: studentForm.program,
      }),
    [studentForm.batch_name, studentForm.class_name, studentForm.course, studentForm.program],
  );

  const visibleEduPayStudents = useMemo(
    () => students.filter((student) => Boolean(getEduPayStudentProfile(student.id, student.admission_no))),
    [students],
  );

  useEffect(() => {
    if (currentBatchPresetFee > 0) {
      setTotalFeeInput(currentBatchPresetFee);
      return;
    }

    if (admissionDeskStep === 'details') {
      setTotalFeeInput(0);
    }
  }, [admissionDeskStep, currentBatchPresetFee]);

  const financePlanPreview = useMemo(
    () =>
      buildFinancePlan({
        totalFee: totalFeeInput,
        bookingAmount: bookingAmountInput,
        scholarshipAmount: scholarshipAmountInput,
        installmentCount: installmentCountInput,
        nextPaymentDate: nextPaymentDateInput,
        preferredPaymentMode: preferredPaymentModeInput,
        manualInstallments: installmentAmountsInput,
      }),
    [
      totalFeeInput,
      bookingAmountInput,
      scholarshipAmountInput,
      installmentCountInput,
      nextPaymentDateInput,
      preferredPaymentModeInput,
      installmentAmountsInput,
    ],
  );

  useEffect(() => {
    if (admissionDeskStep !== 'finance_payment') return;

    if (installmentValuesTouched) return;

    setInstallmentAmountsInput(Array.from({ length: 3 }, (_, index) => financePlanPreview.installments[index]?.amount ?? 0));
  }, [admissionDeskStep, installmentCountInput, financePlanPreview.installments, installmentValuesTouched]);

  useEffect(() => {
    if (admissionDeskStep !== 'finance_payment') return;

    if (bookingReceivedModeInput === 'cash') return;

    setBookingReceivedReferenceInput((current) => {
      if (current.trim().length > 0 && !current.startsWith('CASH-')) {
        return current;
      }
      return buildAutoPaymentReference(bookingReceivedModeInput, studentForm.admission_no);
    });
  }, [admissionDeskStep, bookingReceivedModeInput, studentForm.admission_no]);

  const getStudentMeta = (student: EduPayStudent): EduPayStudentMeta => {
    const profile = getEduPayStudentProfile(student.id, student.admission_no);
    if (profile) {
      return {
        institute: profile.details.institute || '',
        board: profile.details.board || '',
        academicYear: profile.details.academicYear || '',
        isNewAdmission: profile.details.admissionType === 'old' ? 'no' : 'yes',
        identifier: profile.details.identifier || profile.details.rollNumber || '',
        grade: profile.details.className || student.class_name || '',
      };
    }

    return (
      studentMetaMap[studentMetaKey(student)] || {
        institute: '',
        board: '',
        academicYear: '',
        isNewAdmission: 'yes',
        identifier: '',
        grade: student.class_name || '',
      }
    );
  };

  const instituteOptions = useMemo(
    () =>
      Array.from(
        new Set(
          students
            .filter((student) => Boolean(getEduPayStudentProfile(student.id, student.admission_no)))
            .map((student) => getStudentMeta(student).institute)
            .filter((value) => value.trim().length > 0),
        ),
      ).sort(),
    [students, studentMetaMap],
  );

  const boardOptions = useMemo(
    () =>
      Array.from(
        new Set(
          students
            .filter((student) => Boolean(getEduPayStudentProfile(student.id, student.admission_no)))
            .map((student) => getStudentMeta(student).board)
            .filter((value) => value.trim().length > 0),
        ),
      ).sort(),
    [students, studentMetaMap],
  );

  const gradeOptions = useMemo(
    () =>
      Array.from(
        new Set(
          students
            .filter((student) => Boolean(getEduPayStudentProfile(student.id, student.admission_no)))
            .map((student) => getStudentMeta(student).grade || student.class_name)
            .filter((value) => value.trim().length > 0),
        ),
      ).sort(),
    [students, studentMetaMap],
  );

  const academicYearOptions = useMemo(
    () =>
      Array.from(
        new Set(
          students
            .filter((student) => Boolean(getEduPayStudentProfile(student.id, student.admission_no)))
            .map((student) => getStudentMeta(student).academicYear)
            .filter((value) => value.trim().length > 0),
        ),
      ).sort(),
    [students, studentMetaMap],
  );

  const filteredStudents = useMemo(() => {
    const query = studentSearch.trim().toLowerCase();
    return visibleEduPayStudents.filter((student) => {
      const meta = getStudentMeta(student);
      const searchable = [
        student.full_name,
        student.class_name,
        student.batch_name,
        student.parent_name,
        student.parent_mobile,
        student.admission_no,
        student.status,
        meta.institute,
        meta.board,
        meta.academicYear,
        meta.identifier,
        meta.grade,
      ]
        .join(' ')
        .toLowerCase();

      if (query && !searchable.includes(query)) return false;
      if (instituteFilter !== 'all' && meta.institute !== instituteFilter) return false;
      if (boardFilter !== 'all' && meta.board !== boardFilter) return false;
      if (gradeFilter !== 'all' && (meta.grade || student.class_name) !== gradeFilter) return false;
      if (academicYearFilter !== 'all' && meta.academicYear !== academicYearFilter) return false;
      if (admissionFilter !== 'all' && meta.isNewAdmission !== admissionFilter) return false;

      return true;
    });
  }, [studentSearch, visibleEduPayStudents, studentMetaMap, instituteFilter, boardFilter, gradeFilter, academicYearFilter, admissionFilter]);

  const plannerPaymentOptions = useMemo(() => {
    const profiles = ensureArray(readEduPayStudentProfiles());

    return profiles.flatMap((profile) => {
      const financePlan = profile.details.financePlan;
      if (!financePlan?.installments?.length) return [];

      const paidInstallmentTotal = pageTransactions
        .filter(
          (txn) =>
            txn.studentProfileId === profile.id &&
            txn.status === 'received' &&
            txn.notes !== 'Booking amount received during admission',
        )
        .reduce((sum, txn) => sum + txn.amount, 0);

      let remainingPaid = paidInstallmentTotal;

      return financePlan.installments.flatMap((installment, index) => {
        const installmentAmount = installment.amount || 0;
        if (installmentAmount <= 0) return [];

        if (remainingPaid >= installmentAmount) {
          remainingPaid -= installmentAmount;
          return [];
        }

        const outstanding = Number((installmentAmount - Math.max(remainingPaid, 0)).toFixed(2));
        remainingPaid = 0;

        return [
          {
            id: `plan-${profile.id}-${index + 1}`,
            studentProfileId: profile.id,
            studentName: profile.details.fullName || profile.admissionNo,
            admissionNo: profile.admissionNo,
            installmentLabel: installment.label || `Installment ${index + 1}`,
            amountDue: outstanding,
            dueDate: installment.dueDate || financePlan.nextPaymentDate,
          },
        ];
      });
    });
  }, [pageTransactions]);

  const dashboardCards = useMemo(() => {
    const collected = pageTransactions
      .filter((txn) => txn.status === 'received')
      .reduce((sum, txn) => sum + txn.amount, 0);
    const pending = paymentLinks
      .filter((link) => link.status !== 'paid')
      .reduce((sum, link) => sum + link.amount, 0);
    const paymentMethodCounts = pageTransactions
      .filter((txn) => txn.status === 'received')
      .reduce<Record<string, { amount: number; count: number }>>((acc, txn) => {
        const key = txn.mode;
        const current = acc[key] || { amount: 0, count: 0 };
        acc[key] = { amount: current.amount + txn.amount, count: current.count + 1 };
        return acc;
      }, {});
    const paymentMethodSplit = Object.entries(paymentMethodCounts).map(([method, value]) => ({
      method,
      percentage: collected > 0 ? Math.round((value.amount / collected) * 100) : 0,
    }));
    const trendMap = pageTransactions
      .filter((txn) => txn.status === 'received')
      .reduce<Record<string, number>>((acc, txn) => {
        const month = new Date(txn.createdAt).toLocaleDateString('en-US', { month: 'short' });
        acc[month] = (acc[month] || 0) + txn.amount;
        return acc;
      }, {});
    const collectionTrend = Object.entries(trendMap).map(([month, amount]) => ({ month, amount }));

    return {
      activeStudents: visibleEduPayStudents.length,
      queuedReminders: paymentLinks.filter((link) => link.status === 'pending').length,
      collected,
      pending,
      overdue: 0,
      upcomingDues: plannerPaymentOptions.length,
      paymentMethodSplit,
      collectionTrend,
      reminders: paymentLinks
        .filter((link) => link.status === 'pending')
        .slice(0, 5)
        .map((link) => ({
          title: `${link.studentName} payment pending`,
          channel: 'payment link',
          audience: link.admissionNo || 'student',
          scheduled_for: link.dueDate || link.createdAt,
        })),
    };
  }, [pageTransactions, paymentLinks, plannerPaymentOptions, visibleEduPayStudents]);

  const pendingAssignments = useMemo(
    () => assignments.filter((assignment) => assignment.status !== 'paid'),
    [assignments]
  );

  useEffect(() => {
    const selectedPlannerPayment = plannerPaymentOptions.find((item) => item.id === paymentForm.assignment_id);
    if (selectedPlannerPayment) {
      setPaymentForm((current) => ({
        ...current,
        amount: selectedPlannerPayment.amountDue,
      }));
      return;
    }

    const selectedAssignment = assignments.find((assignment) => assignment.id === Number(paymentForm.assignment_id));
    if (!selectedAssignment) return;
    const outstanding = Math.max(selectedAssignment.amount_due + selectedAssignment.late_fee_applied - selectedAssignment.amount_paid, 0);
    setPaymentForm((current) => ({
      ...current,
      amount: outstanding,
    }));
  }, [paymentForm.assignment_id, assignments, plannerPaymentOptions]);

  const handleProceedToFinance = () => {
    const validationMessage = validateAdmissionDetails();
    if (validationMessage) {
      setAlert({ type: 'error', message: validationMessage });
      return;
    }

    if (currentBatchPresetFee > 0) {
      setTotalFeeInput(currentBatchPresetFee);
    }
    setBookingReceivedAmountInput(financePlanPreview.bookingAmount || bookingAmountInput || 20000);
    setBookingReceivedModeInput(preferredPaymentModeInput);
    setAdmissionDeskStep('finance_payment');
    setAlert({
      type: 'success',
      message: 'Student details save ho gayi hain. Ab fee planner aur booking payment complete karo.',
    });
  };

  const handleCreateStudent = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const validationMessage = validateAdmissionDetails();
      if (validationMessage) {
        setAlert({ type: 'error', message: validationMessage });
        return;
      }

      if (admissionDeskStep !== 'finance_payment') {
        setAlert({ type: 'error', message: 'Pehle Save & Proceed se fee planner aur payment step open karo.' });
        return;
      }

      const bookingReceivedAmount = Number(bookingReceivedAmountInput) || 0;
      if (bookingReceivedAmount <= 0) {
        setAlert({ type: 'error', message: 'Booking amount receive karna zaroori hai admission save se pehle.' });
        return;
      }

      if (bookingReceivedModeInput === 'cash' && !bookingReceivedReferenceInput.trim()) {
        setAlert({ type: 'error', message: 'Cash payment ke liye manual receipt/reference number bharna zaroori hai.' });
        return;
      }

      const response = await apiService.createEduPayStudent({
        admission_no: studentForm.admission_no,
        full_name: studentForm.full_name,
        class_name: studentForm.class_name,
        batch_name: studentForm.batch_name || undefined,
        email: studentForm.email || undefined,
        phone: studentForm.phone || undefined,
        parent_name: studentForm.parent_name,
        parent_mobile: studentForm.parent_mobile,
        parent_email: studentForm.parent_email || undefined,
        parent_relation: studentForm.parent_relation || 'parent',
      });
      const createdStudent = response.data;
      const nextMetaMap = {
        ...studentMetaMap,
        [studentMetaKey(createdStudent)]: {
          institute: studentForm.institute.trim(),
          board: studentForm.board.trim(),
          academicYear: studentForm.academic_year.trim(),
          isNewAdmission: studentForm.is_new_admission,
          identifier: studentForm.identifier.trim(),
          grade: studentForm.class_name.trim(),
        },
      };
      setStudentMetaMap(nextMetaMap);
      writeEduPayStudentMeta(nextMetaMap);

      upsertEduPayStudentProfile({
        source: selectedAdmissionRequestId ? 'admin_request' : 'edupay_direct',
        edupayStudentId: createdStudent.id,
        admissionNo: createdStudent.admission_no,
        requestId: selectedAdmissionRequestId || undefined,
        details: buildAdmissionSnapshot(),
      });

      const profile = getEduPayStudentProfile(createdStudent.id, createdStudent.admission_no);
      appendEduPayPageTransaction({
        id: `txn-booking-${createdStudent.id}-${Date.now()}`,
        studentProfileId: profile?.id,
        studentName: createdStudent.full_name,
        admissionNo: createdStudent.admission_no,
        amount: bookingReceivedAmount,
        mode: bookingReceivedModeInput,
        reference: bookingReceivedReferenceInput || `BOOKING-${createdStudent.id}`,
        status: 'received',
        createdAt: bookingReceivedDateInput || new Date().toISOString(),
        notes: 'Booking amount received during admission',
      });

      const remainingPaymentAmount = Math.max(financePlanPreview.remainingAfterBooking, 0);
      if (remainingPaymentAmount > 0) {
        const paymentLinkRecord: EduPayPaymentLinkRecord = {
          id: `link-${createdStudent.id}-${Date.now()}`,
          studentProfileId: profile?.id,
          studentName: createdStudent.full_name,
          admissionNo: createdStudent.admission_no,
          amount: remainingPaymentAmount,
          linkCode: `PAY-${createdStudent.id}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
          status: 'pending',
          createdAt: new Date().toISOString(),
          dueDate: nextPaymentDateInput || undefined,
        };
        upsertEduPayPaymentLink(paymentLinkRecord);
        setPaymentLinks(ensureArray<EduPayPaymentLinkRecord>(readEduPayPaymentLinks()));
      }

      if (selectedAdmissionRequestId) {
        markEduPayAdmissionRequestProcessed(selectedAdmissionRequestId, createdStudent.id);
        refreshAdmissionRequestState();
      }

      setPageTransactions(ensureArray<EduPayPageTransactionRecord>(readEduPayPageTransactions()));
      resetAdmissionDraftState();
      setAdmissionMode('request');
      setPaymentWorkspaceView('collector');
      setAlert({ type: 'success', message: 'Booking payment receive hone ke baad student admission save ho gayi.' });
      await loadEduPayData();
    } catch (error: any) {
      setAlert({
        type: 'error',
        message: error?.response?.data?.detail || 'Student save nahi ho paya.',
      });
    }
  };

  const handleCreateFeeStructure = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      await apiService.createEduPayFeeStructure({
        ...feeForm,
        class_name: feeForm.class_name || undefined,
        discount_amount: Number(feeForm.discount_amount) || 0,
        late_fee_rule: feeForm.late_fee_rule || undefined,
        description: feeForm.description || undefined,
        total_amount: Number(feeForm.total_amount),
      });
      setFeeForm(initialFeeForm);
      setAlert({ type: 'success', message: 'Fee structure aur assignments create ho gaye.' });
      await loadEduPayData();
    } catch (error: any) {
      setAlert({
        type: 'error',
        message: error?.response?.data?.detail || 'Fee structure save nahi ho paya.',
      });
    }
  };

  const handleCreatePayment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const selectedPlannerPayment = plannerPaymentOptions.find((item) => item.id === paymentForm.assignment_id);
      if (selectedPlannerPayment) {
        appendEduPayPageTransaction({
          id: `txn-plan-${selectedPlannerPayment.studentProfileId}-${Date.now()}`,
          studentProfileId: selectedPlannerPayment.studentProfileId,
          studentName: selectedPlannerPayment.studentName,
          admissionNo: selectedPlannerPayment.admissionNo,
          amount: Number(paymentForm.amount),
          mode: paymentForm.method as EduPayPaymentMode,
          reference:
            paymentForm.transaction_reference ||
            buildAutoPaymentReference(paymentForm.method as EduPayPaymentMode, selectedPlannerPayment.admissionNo),
          status: 'received',
          createdAt: new Date().toISOString(),
          notes: selectedPlannerPayment.installmentLabel,
        });
        setPageTransactions(ensureArray<EduPayPageTransactionRecord>(readEduPayPageTransactions()));
        setPaymentForm(initialPaymentForm);
        setAlert({ type: 'success', message: `${selectedPlannerPayment.installmentLabel} payment record save ho gaya.` });
        return;
      }

      const response = await apiService.createEduPayPayment({
        assignment_id: Number(paymentForm.assignment_id),
        amount: Number(paymentForm.amount),
        method: paymentForm.method,
        transaction_reference: paymentForm.transaction_reference || undefined,
      });
      const matchedStudent = students.find((student) => student.full_name === response.data.student_name);
      appendEduPayPageTransaction({
        id: `txn-${response.data.id}-${Date.now()}`,
        studentProfileId: matchedStudent ? getEduPayStudentProfile(matchedStudent.id, matchedStudent.admission_no)?.id : undefined,
        studentName: response.data.student_name,
        admissionNo: matchedStudent?.admission_no || '',
        amount: response.data.amount,
        mode: response.data.method as EduPayPaymentMode,
        reference: response.data.transaction_reference || response.data.receipt_number,
        status: 'received',
        createdAt: response.data.payment_date,
        notes: response.data.receipt_number,
      });
      const matchingLink = ensureArray<EduPayPaymentLinkRecord>(readEduPayPaymentLinks()).find(
        (link) => link.studentName === response.data.student_name && link.status !== 'paid',
      );
      if (matchingLink) {
        upsertEduPayPaymentLink({ ...matchingLink, status: 'paid' });
      }
      setPaymentLinks(ensureArray<EduPayPaymentLinkRecord>(readEduPayPaymentLinks()));
      setPageTransactions(ensureArray<EduPayPageTransactionRecord>(readEduPayPageTransactions()));
      setPaymentForm(initialPaymentForm);
      setAlert({ type: 'success', message: 'Payment record save ho gaya aur receipt generate ho gayi.' });
      await loadEduPayData();
    } catch (error: any) {
      setAlert({
        type: 'error',
        message: error?.response?.data?.detail || 'Payment save nahi ho paya.',
      });
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50">
        <LoadingSpinner message="BRAIN OF HIMACHAL workspace load ho raha hai..." />
      </div>
    );
  }

  return (
    <div className="font-body min-h-screen bg-[linear-gradient(180deg,#f6f8fb_0%,#eef3f8_100%)] text-slate-900">
      <div className="mx-auto max-w-[1550px] p-4 md:p-6 xl:p-8">
        <div className="xl:pr-[314px]">
          <div>
            <section className="rounded-[2rem] border border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(15,23,42,0.06),_transparent_30%),linear-gradient(180deg,_#ffffff_0%,_#f8fafc_100%)] p-6 shadow-[0_30px_80px_rgba(15,23,42,0.08)]">
              <div className="grid gap-6 lg:grid-cols-[1.35fr_0.65fr]">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-slate-100 px-3 py-1 text-xs uppercase tracking-[0.28em] text-slate-700">
                    <Landmark className="h-3.5 w-3.5" />
                    {currentWorkspaceMeta.label}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-[1.2rem] border border-slate-200 bg-slate-950 p-3 text-white">
                    <p className="text-xs text-slate-500">Active students</p>
                    <p className="font-body mt-2 text-2xl font-bold text-white">{dashboardCards.activeStudents}</p>
                    <p className="mt-1 text-xs text-slate-300">Institute side registry</p>
                  </div>
                  <div className="rounded-[1.2rem] border border-slate-200 bg-white p-3">
                    <p className="text-xs text-slate-500">Queued reminders</p>
                    <p className="font-body mt-2 text-2xl font-bold text-slate-900">{dashboardCards.queuedReminders}</p>
                    <p className="mt-1 text-xs text-slate-500">WhatsApp and email nudges</p>
                  </div>
                </div>
              </div>

            </section>

            {alert ? (
              <div className="mt-6">
                <Alert message={alert.message} type={alert.type} onClose={() => setAlert(null)} />
              </div>
            ) : null}

            {activeTab === 'overview' ? (
              <div className="mt-6 grid gap-6">
            <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Collected" value={formatCurrency(dashboardCards.collected)} icon={IndianRupee} />
              <StatCard label="Pending" value={formatCurrency(dashboardCards.pending)} icon={Users} />
              <StatCard label="Overdue" value={formatCurrency(dashboardCards.overdue)} icon={Bell} />
              <StatCard label="Upcoming Dues" value={`${dashboardCards.upcomingDues}`} icon={CreditCard} />
            </section>

            <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
              <div className={sectionClass}>
                <h2 className="font-body text-xl font-bold text-slate-900">Collection trend</h2>
                <div className="mt-6 grid grid-cols-6 items-end gap-2">
                  {dashboardCards.collectionTrend.length ? dashboardCards.collectionTrend.map((point) => {
                    const maxAmount = Math.max(...dashboardCards.collectionTrend.map((item) => item.amount), 1);
                    const height = Math.max((point.amount / maxAmount) * 100, 8);
                    return (
                      <div key={point.month} className="flex flex-col items-center gap-2">
                        <div className="flex h-44 w-full items-end justify-center rounded-[1.25rem] bg-slate-100 px-2 py-2">
                          <div
                            className="w-full rounded-[1.25rem] bg-gradient-to-t from-sky-500 via-cyan-400 to-emerald-300"
                            style={{ height: `${height}%` }}
                          />
                        </div>
                        <div className="text-center">
                          <p className="text-[11px] text-slate-400">{point.month}</p>
                          <p className="mt-1 text-[11px] text-slate-500">{formatCurrency(point.amount)}</p>
                        </div>
                      </div>
                    );
                  }) : (
                    <div className="col-span-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                      Abhi tak current BRAIN OF HIMACHAL flow ka collection data nahi hai.
                    </div>
                  )}
                </div>
              </div>

              <div className="grid gap-4">
                <div className={sectionClass}>
                  <h2 className="font-body text-xl font-bold text-slate-900">Payment method split</h2>
                  <div className="mt-5 space-y-3">
                    {dashboardCards.paymentMethodSplit.length ? dashboardCards.paymentMethodSplit.map((item) => (
                      <div key={item.method}>
                        <div className="mb-2 flex items-center justify-between text-xs">
                          <span className="text-slate-700 capitalize">{item.method.replace('_', ' ')}</span>
                          <span className="text-slate-500">{item.percentage}%</span>
                        </div>
                        <div className="h-2.5 rounded-full bg-slate-100">
                          <div className="h-2.5 rounded-full bg-gradient-to-r from-sky-500 to-emerald-400" style={{ width: `${item.percentage}%` }} />
                        </div>
                      </div>
                    )) : (
                      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500">
                        Payment method split current workspace mein abhi available nahi hai.
                      </div>
                    )}
                  </div>
                </div>

                <div className={sectionClass}>
                  <h2 className="font-body text-xl font-bold text-slate-900">Reminder queue</h2>
                  <div className="mt-5 space-y-2.5">
                    {dashboardCards.reminders.length ? dashboardCards.reminders.map((item) => (
                      <div key={`${item.title}-${item.scheduled_for}`} className="rounded-[1rem] border border-slate-200 bg-slate-50 p-3">
                        <p className="text-xs font-semibold text-slate-900">{item.title}</p>
                        <p className="mt-1 text-xs text-slate-500">{item.channel}</p>
                        <p className="mt-2 text-xs text-slate-700">{item.audience}</p>
                        <p className="mt-1 text-xs text-sky-700">{item.scheduled_for}</p>
                      </div>
                    )) : (
                      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-sm text-slate-500">
                        Reminder queue clean hai. Koi pending BRAIN OF HIMACHAL reminder nahi hai.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </section>
              </div>
            ) : null}

            {activeTab === 'students' ? (
              <div className="mt-6 space-y-6">
            <section className={`${sectionClass} p-5 md:p-6`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-display text-2xl font-semibold text-slate-900">BRAIN OF HIMACHAL admission desk</h2>
                  <p className="mt-2 text-sm text-slate-500">Admin request review, direct admission, aur student ledger ko yahan se clearly manage karo.</p>
                </div>
                <div className="flex flex-wrap gap-2 rounded-full border border-slate-200 bg-slate-50 p-1">
                  <button
                    type="button"
                    onClick={() => setStudentWorkspaceView('admission')}
                    className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                      studentWorkspaceView === 'admission' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                    }`}
                  >
                    Admission Desk
                  </button>
                  <button
                    type="button"
                    onClick={() => setStudentWorkspaceView('ledger')}
                    className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                      studentWorkspaceView === 'ledger' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                    }`}
                  >
                    Student Ledger
                  </button>
                </div>
              </div>
            </section>

              {studentWorkspaceView === 'admission' ? (
                <div className="grid gap-6 xl:grid-cols-[0.78fr_1.22fr]">
                  <section className={sectionClass}>
              <div className="mb-6 flex flex-wrap gap-2 rounded-full border border-slate-200 bg-slate-50 p-1">
                <button
                  type="button"
                  onClick={() => setAdmissionMode('request')}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                    admissionMode === 'request' ? 'bg-slate-900 text-white' : 'text-slate-600'
                  }`}
                >
                  Review Requests
                </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAdmissionMode('direct');
                        resetAdmissionDraftState();
                      }}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                    admissionMode === 'direct' ? 'bg-slate-900 text-white' : 'text-slate-600'
                  }`}
                >
                  Start Direct Admission
                </button>
              </div>

              {admissionMode === 'request' ? (
                <div>
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Pending Admission Requests</h3>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                      {pendingAdmissionRequests.length} pending
                    </span>
                  </div>
                  <div className="max-h-72 space-y-3 overflow-y-auto">
                    {pendingAdmissionRequests.length ? pendingAdmissionRequests.map((request) => (
                      <button
                        key={request.id}
                        type="button"
                        onClick={() => applyAdmissionRequestToForm(request)}
                        className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                          selectedAdmissionRequestId === request.id
                            ? 'border-slate-900 bg-slate-50'
                            : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold text-slate-900">{request.details.fullName || 'Unnamed Student'}</p>
                            <p className="mt-1 text-xs text-slate-500">
                              {request.details.className || '-'} | {request.details.managedBatch || '-'} | {request.details.academicYear || '-'}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              Adm: {request.details.admissionId || '-'} | Roll: {request.details.rollNumber || '-'}
                            </p>
                          </div>
                          <span className="rounded-full bg-amber-100 px-3 py-1 text-[11px] font-semibold text-amber-700">
                            Pending
                          </span>
                        </div>
                      </button>
                    )) : (
                      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                        Admin-side Add Student se request aayegi to yahan dikhegi.
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-emerald-300 bg-emerald-50 px-4 py-4 text-sm text-emerald-800">
                  Direct BRAIN OF HIMACHAL admission mode active hai. Yahan full admission summary bhar kar student aur payment flow start kar sakte ho.
                </div>
              )}

              {selectedAdmissionRequest ? (
                <div className="mt-6 rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Selected Request Snapshot</h3>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <div className="rounded-xl bg-white px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Student</p>
                      <p className="mt-1 text-sm font-semibold text-slate-900">{selectedAdmissionRequest.details.fullName}</p>
                      <p className="mt-1 text-xs text-slate-500">{selectedAdmissionRequest.details.admissionId || '-'} / {selectedAdmissionRequest.details.rollNumber || '-'}</p>
                    </div>
                    <div className="rounded-xl bg-white px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Academic</p>
                      <p className="mt-1 text-sm font-semibold text-slate-900">{selectedAdmissionRequest.details.className || '-'} / {selectedAdmissionRequest.details.managedBatch || '-'}</p>
                      <p className="mt-1 text-xs text-slate-500">{selectedAdmissionRequest.details.course || '-'} / {selectedAdmissionRequest.details.program || '-'}</p>
                    </div>
                    <div className="rounded-xl bg-white px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Parent</p>
                      <p className="mt-1 text-sm font-semibold text-slate-900">{selectedAdmissionRequest.details.fatherName || selectedAdmissionRequest.details.guardianName || '-'}</p>
                      <p className="mt-1 text-xs text-slate-500">{selectedAdmissionRequest.details.fatherMobile || selectedAdmissionRequest.details.guardianMobile || '-'}</p>
                    </div>
                    <div className="rounded-xl bg-white px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Address</p>
                      <p className="mt-1 text-sm font-semibold text-slate-900">
                        {[selectedAdmissionRequest.details.address1, selectedAdmissionRequest.details.city, selectedAdmissionRequest.details.state].filter(Boolean).join(', ') || '-'}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">{selectedAdmissionRequest.details.country || 'India'}</p>
                    </div>
                  </div>
                </div>
              ) : null}
                  </section>

                  <section className={sectionClass}>
              <form onSubmit={handleCreateStudent} className="space-y-5">
                <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Personal Details</p>
                  <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_260px]">
                    <div className="grid gap-4 md:grid-cols-2">
                      <FieldGroup label="Admission No">
                        <input required value={studentForm.admission_no} onChange={(e) => setStudentForm({ ...studentForm, admission_no: e.target.value })} className={inputClass} placeholder="Admission no" />
                      </FieldGroup>
                      <FieldGroup label="Date Of Birth">
                        <input type="date" value={studentForm.dob} onChange={(e) => setStudentForm({ ...studentForm, dob: e.target.value })} className={inputClass} />
                      </FieldGroup>
                      <FieldGroup label="Student Name">
                        <input required value={studentForm.full_name} onChange={(e) => setStudentForm({ ...studentForm, full_name: e.target.value })} className={inputClass} placeholder="Student name" />
                      </FieldGroup>
                      <FieldGroup label="Gender">
                        <SelectField value={studentForm.gender} onChange={(e) => setStudentForm({ ...studentForm, gender: e.target.value })}>
                          <option value="">Gender</option>
                          <option value="male">Male</option>
                          <option value="female">Female</option>
                          <option value="other">Other</option>
                        </SelectField>
                      </FieldGroup>
                      <FieldGroup label="Institute">
                        <input required value={studentForm.institute} onChange={(e) => setStudentForm({ ...studentForm, institute: e.target.value })} className={inputClass} placeholder="Institute" />
                      </FieldGroup>
                      <FieldGroup label="Board">
                        <input required value={studentForm.board} onChange={(e) => setStudentForm({ ...studentForm, board: e.target.value })} className={inputClass} placeholder="Board" />
                      </FieldGroup>
                      <FieldGroup label="Student Email">
                        <input value={studentForm.email} onChange={(e) => setStudentForm({ ...studentForm, email: e.target.value })} className={inputClass} placeholder="Student email" />
                      </FieldGroup>
                      <FieldGroup label="Student Phone">
                        <input value={studentForm.phone} onChange={(e) => setStudentForm({ ...studentForm, phone: e.target.value })} className={inputClass} placeholder="Student phone" />
                      </FieldGroup>
                      <FieldGroup label="Identifier / Roll Ref" className="md:col-span-2">
                        <input value={studentForm.identifier} onChange={(e) => setStudentForm({ ...studentForm, identifier: e.target.value })} className={inputClass} placeholder="Identifier / Enrollment code" />
                      </FieldGroup>
                    </div>

                    <div className="rounded-xl border border-dashed border-[#d9c39a] bg-[#fcf5ea] p-4">
                      <p className="text-sm font-semibold text-slate-800">Student Photo</p>
                      <input ref={studentPhotoInputRef} type="file" accept="image/*" className="hidden" onChange={handleEduPayPhotoInputChange} />
                      <input ref={studentCameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleEduPayPhotoInputChange} />
                      <div className="mt-4 flex h-44 items-center justify-center overflow-hidden rounded-lg bg-[#f0e4cf] text-xs text-slate-500">
                        {studentPhotoPreviewUrl ? <img src={studentPhotoPreviewUrl} alt="Student preview" className="h-full w-full object-cover" /> : 'Image Preview'}
                      </div>
                      <div className="mt-4 space-y-2">
                        <button type="button" onClick={() => studentPhotoInputRef.current?.click()} className="flex w-full items-center justify-center gap-2 rounded-md bg-[#c07a10] px-3 py-2 text-xs font-semibold text-white">
                          <Upload className="h-3.5 w-3.5" />
                          Upload From System
                        </button>
                        <button type="button" onClick={() => studentCameraInputRef.current?.click()} className="flex w-full items-center justify-center gap-2 rounded-md border border-[#c07a10] bg-white px-3 py-2 text-xs font-semibold text-[#a9680d]">
                          <Camera className="h-3.5 w-3.5" />
                          Open Camera
                        </button>
                        {studentPhotoPreviewUrl ? (
                          <button type="button" onClick={() => setStudentPhotoPreviewUrl('')} className="flex w-full items-center justify-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                            <Trash2 className="h-3.5 w-3.5" />
                            Remove Photo
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Academic & Fee Schedule Details</p>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <FieldGroup label="Class">
                      <input required value={studentForm.class_name} onChange={(e) => setStudentForm({ ...studentForm, class_name: e.target.value })} className={inputClass} placeholder="Class" />
                    </FieldGroup>
                    <FieldGroup label="Batch">
                      <input value={studentForm.batch_name} onChange={(e) => setStudentForm({ ...studentForm, batch_name: e.target.value })} className={inputClass} placeholder="Batch" />
                    </FieldGroup>
                    <div className="md:col-span-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm">
                      <p className="font-semibold text-emerald-900">
                        {currentBatchPresetFee > 0
                          ? `Auto batch fee detected: ${formatCurrency(currentBatchPresetFee)}`
                          : 'Is batch ke liye preset fee detect nahi hui. Batch name ko preset naming ke hisaab se rakho.'}
                      </p>
                      <p className="mt-1 text-emerald-700">
                        Fee planner step mein isi batch fee se `Net Fee` aur `Remaining After Booking` automatically calculate honge.
                      </p>
                    </div>
                    <FieldGroup label="Academic Year">
                      <SelectField value={studentForm.academic_year} onChange={(e) => setStudentForm({ ...studentForm, academic_year: e.target.value })}>
                        <option value="2025-2026">2025-2026</option>
                        <option value="2026-2027">2026-2027</option>
                        <option value="2027-2028">2027-2028</option>
                      </SelectField>
                    </FieldGroup>
                    <FieldGroup label="Admission Type">
                      <SelectField value={studentForm.is_new_admission} onChange={(e) => setStudentForm({ ...studentForm, is_new_admission: e.target.value as 'yes' | 'no' })}>
                        <option value="yes">New admission</option>
                        <option value="no">Existing student</option>
                      </SelectField>
                    </FieldGroup>
                    <FieldGroup label="Course">
                      <SelectField value={studentForm.course} onChange={(e) => setStudentForm({ ...studentForm, course: e.target.value as typeof studentForm.course })}>
                        <option value="">Course</option>
                        <option value="neet">NEET</option>
                        <option value="jee_main">JEE-MAIN</option>
                        <option value="advance">ADVANCE</option>
                        <option value="ssb">S.S.B</option>
                      </SelectField>
                    </FieldGroup>
                    <FieldGroup label="Program">
                      <SelectField value={studentForm.program} onChange={(e) => setStudentForm({ ...studentForm, program: e.target.value as typeof studentForm.program })}>
                        <option value="">Program</option>
                        <option value="medical">Medical</option>
                        <option value="non_medical">Non Medical</option>
                      </SelectField>
                    </FieldGroup>
                  </div>
                </div>

                {admissionDeskStep === 'finance_payment' ? (
                <div className="rounded-[1.5rem] border border-emerald-200 bg-emerald-50/60 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Fee Planner</p>
                      <p className="mt-1 text-sm text-emerald-900">Batch preset fee ke saath booking, scholarship, aur manual installments plan karo.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setTotalFeeInput(currentBatchPresetFee)}
                      className="rounded-full border border-emerald-300 bg-white px-4 py-2 text-xs font-semibold text-emerald-700"
                    >
                      Re-Apply Batch Preset
                    </button>
                  </div>
                  <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <FieldGroup label="Total Fee">
                      <input
                        type="number"
                        min="0"
                        value={totalFeeInput}
                        onChange={(e) => {
                          setTotalFeeInput(Number(e.target.value) || 0);
                          setInstallmentValuesTouched(false);
                        }}
                        className={inputClass}
                      />
                    </FieldGroup>
                    <FieldGroup label="Booking Amount">
                      <input
                        type="number"
                        min="0"
                        value={bookingAmountInput}
                        onChange={(e) => {
                          setBookingAmountInput(Number(e.target.value) || 0);
                          setInstallmentValuesTouched(false);
                        }}
                        className={inputClass}
                      />
                    </FieldGroup>
                    <FieldGroup label="Scholarship / Discount">
                      <input
                        type="number"
                        min="0"
                        value={scholarshipAmountInput}
                        onChange={(e) => {
                          setScholarshipAmountInput(Number(e.target.value) || 0);
                          setInstallmentValuesTouched(false);
                        }}
                        className={inputClass}
                      />
                    </FieldGroup>
                    <FieldGroup label="Installment Count">
                      <SelectField
                        value={String(installmentCountInput)}
                        onChange={(e) => {
                          setInstallmentCountInput(Number(e.target.value) as 1 | 2 | 3);
                          setInstallmentValuesTouched(false);
                        }}
                      >
                        <option value="1">1 Installment</option>
                        <option value="2">2 Installments</option>
                        <option value="3">3 Installments</option>
                      </SelectField>
                    </FieldGroup>
                    <FieldGroup label="Preferred Payment Mode">
                      <SelectField value={preferredPaymentModeInput} onChange={(e) => setPreferredPaymentModeInput(e.target.value as EduPayPaymentMode)}>
                        <option value="upi">UPI</option>
                        <option value="cash">Cash</option>
                        <option value="card">Card</option>
                        <option value="net_banking">Net Banking</option>
                        <option value="cheque">Cheque</option>
                        <option value="wallet">Wallet</option>
                      </SelectField>
                    </FieldGroup>
                    <FieldGroup label="Next Payment Date">
                      <input type="date" value={nextPaymentDateInput} onChange={(e) => setNextPaymentDateInput(e.target.value)} className={inputClass} />
                    </FieldGroup>
                    <div className="rounded-2xl border border-emerald-200 bg-white p-4">
                      <p className="text-xs uppercase tracking-[0.16em] text-emerald-600">Net Fee</p>
                      <p className="mt-2 text-xl font-bold text-slate-900">{formatCurrency(financePlanPreview.netFee)}</p>
                    </div>
                    <div className="rounded-2xl border border-emerald-200 bg-white p-4">
                      <p className="text-xs uppercase tracking-[0.16em] text-emerald-600">Remaining After Booking</p>
                      <p className="mt-2 text-xl font-bold text-slate-900">{formatCurrency(financePlanPreview.remainingAfterBooking)}</p>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    {Array.from({ length: installmentCountInput }, (_, index) => (
                      <FieldGroup key={`inst-${index + 1}`} label={`Installment ${index + 1}`}>
                        <input
                          type="number"
                          min="0"
                          value={
                            installmentAmountsInput[index] && installmentAmountsInput[index] > 0
                              ? installmentAmountsInput[index]
                              : financePlanPreview.installments[index]?.amount ?? 0
                          }
                           onChange={(e) =>
                            {
                              setInstallmentValuesTouched(true);
                              setInstallmentAmountsInput((current) => {
                                const next = [...current];
                                next[index] = Number(e.target.value) || 0;
                                return next;
                              });
                            }
                          }
                          className={inputClass}
                        />
                      </FieldGroup>
                    ))}
                  </div>
                </div>
                ) : (
                  <div className="rounded-[1.5rem] border border-dashed border-amber-300 bg-amber-50 px-4 py-4 text-sm text-amber-900">
                    Save & Proceed To Fee Planner dabane ke baad yahan fee planner detail open hogi.
                  </div>
                )}

                {admissionDeskStep === 'finance_payment' ? (
                  <div className="rounded-[1.5rem] border border-sky-200 bg-sky-50 p-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Booking Payment</p>
                      <p className="mt-1 text-sm text-sky-900">Student tab tak save nahi hoga jab tak booking amount receive mark nahi hota.</p>
                    </div>
                    <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                      <FieldGroup label="Booking Amount Received">
                        <input type="number" min="0" value={bookingReceivedAmountInput} onChange={(e) => setBookingReceivedAmountInput(Number(e.target.value) || 0)} className={inputClass} />
                      </FieldGroup>
                      <FieldGroup label="Payment Mode">
                        <SelectField
                          value={bookingReceivedModeInput}
                          onChange={(e) => {
                            const nextMode = e.target.value as EduPayPaymentMode;
                            setBookingReceivedModeInput(nextMode);
                            if (nextMode === 'cash') {
                              setBookingReceivedReferenceInput('');
                            }
                          }}
                        >
                          <option value="upi">UPI</option>
                          <option value="cash">Cash</option>
                          <option value="card">Card</option>
                          <option value="net_banking">Net Banking</option>
                          <option value="cheque">Cheque</option>
                          <option value="wallet">Wallet</option>
                        </SelectField>
                      </FieldGroup>
                      <FieldGroup label={bookingReceivedModeInput === 'cash' ? 'Cash Receipt / Reference No' : 'Auto Payment Reference'}>
                        <input
                          value={bookingReceivedReferenceInput}
                          onChange={(e) => setBookingReceivedReferenceInput(e.target.value)}
                          readOnly={bookingReceivedModeInput !== 'cash'}
                          className={`${inputClass} ${bookingReceivedModeInput !== 'cash' ? 'bg-slate-100 text-slate-600' : ''}`}
                          placeholder={bookingReceivedModeInput === 'cash' ? 'Enter manual cash receipt no' : 'Auto-generated payment reference'}
                        />
                      </FieldGroup>
                      <FieldGroup label="Received Date">
                        <input type="date" value={bookingReceivedDateInput} onChange={(e) => setBookingReceivedDateInput(e.target.value)} className={inputClass} />
                      </FieldGroup>
                    </div>
                    <div className="mt-4 rounded-2xl border border-sky-200 bg-white px-4 py-3 text-sm">
                      <p className="font-semibold text-sky-900">
                        {bookingReceivedModeInput === 'cash'
                          ? 'Cash payment selected: manual receipt/reference number bhar kar admission save karo.'
                          : `Payment mode ${bookingReceivedModeInput.replace('_', ' ')} selected: reference number automatically generate ho gaya hai.`}
                      </p>
                    </div>
                  </div>
                ) : null}

                <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Family Details</p>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <FieldGroup label="Parent Name">
                      <input required value={studentForm.parent_name} onChange={(e) => setStudentForm({ ...studentForm, parent_name: e.target.value })} className={inputClass} placeholder="Parent name" />
                    </FieldGroup>
                    <FieldGroup label="Parent Mobile">
                      <input required value={studentForm.parent_mobile} onChange={(e) => setStudentForm({ ...studentForm, parent_mobile: e.target.value })} className={inputClass} placeholder="Parent mobile" />
                    </FieldGroup>
                    <FieldGroup label="Parent Email">
                      <input value={studentForm.parent_email} onChange={(e) => setStudentForm({ ...studentForm, parent_email: e.target.value })} className={inputClass} placeholder="Parent email" />
                    </FieldGroup>
                    <FieldGroup label="Parent Relation">
                      <SelectField value={studentForm.parent_relation} onChange={(e) => setStudentForm({ ...studentForm, parent_relation: e.target.value })}>
                        <option value="parent">Parent</option>
                        <option value="father">Father</option>
                        <option value="mother">Mother</option>
                        <option value="guardian">Guardian</option>
                      </SelectField>
                    </FieldGroup>
                  </div>
                </div>

                <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Guardian Details</p>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <FieldGroup label="Guardian Name">
                      <input value={studentForm.parent_name} onChange={(e) => setStudentForm({ ...studentForm, parent_name: e.target.value })} className={inputClass} placeholder="Guardian name" />
                    </FieldGroup>
                    <FieldGroup label="Guardian Mobile Number">
                      <input value={studentForm.parent_mobile} onChange={(e) => setStudentForm({ ...studentForm, parent_mobile: e.target.value })} className={inputClass} placeholder="Guardian mobile" />
                    </FieldGroup>
                    <FieldGroup label="Guardian Email">
                      <input value={studentForm.parent_email} onChange={(e) => setStudentForm({ ...studentForm, parent_email: e.target.value })} className={inputClass} placeholder="Guardian email" />
                    </FieldGroup>
                    <FieldGroup label="Guardian Relationship">
                      <SelectField value={studentForm.parent_relation} onChange={(e) => setStudentForm({ ...studentForm, parent_relation: e.target.value })}>
                        <option value="parent">Parent</option>
                        <option value="father">Father</option>
                        <option value="mother">Mother</option>
                        <option value="guardian">Guardian</option>
                      </SelectField>
                    </FieldGroup>
                  </div>
                </div>

                <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Emergency Contact Details</p>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <FieldGroup label="Emergency Contact Name">
                      <input value={studentForm.parent_name} onChange={(e) => setStudentForm({ ...studentForm, parent_name: e.target.value })} className={inputClass} placeholder="Emergency contact name" />
                    </FieldGroup>
                    <FieldGroup label="Emergency Contact Mobile Number">
                      <input value={studentForm.parent_mobile} onChange={(e) => setStudentForm({ ...studentForm, parent_mobile: e.target.value })} className={inputClass} placeholder="Emergency mobile number" />
                    </FieldGroup>
                  </div>
                </div>

                <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Address Details</p>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <FieldGroup label="Address Line 1" className="md:col-span-2">
                      <input value={studentForm.address1} onChange={(e) => setStudentForm({ ...studentForm, address1: e.target.value })} className={inputClass} placeholder="Address line 1" />
                    </FieldGroup>
                    <FieldGroup label="City">
                      <input value={studentForm.city} onChange={(e) => setStudentForm({ ...studentForm, city: e.target.value })} className={inputClass} placeholder="City" />
                    </FieldGroup>
                    <FieldGroup label="State">
                      <input value={studentForm.state} onChange={(e) => setStudentForm({ ...studentForm, state: e.target.value })} className={inputClass} placeholder="State" />
                    </FieldGroup>
                    <FieldGroup label="Country">
                      <input value={studentForm.country} onChange={(e) => setStudentForm({ ...studentForm, country: e.target.value })} className={inputClass} placeholder="Country" />
                    </FieldGroup>
                    <FieldGroup label="Pincode">
                      <input value={studentForm.pincode} onChange={(e) => setStudentForm({ ...studentForm, pincode: e.target.value })} className={inputClass} placeholder="Pincode" />
                    </FieldGroup>
                  </div>
                </div>

                <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Other Info</p>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <FieldGroup label="Admission Type">
                      <SelectField value={studentForm.is_new_admission} onChange={(e) => setStudentForm({ ...studentForm, is_new_admission: e.target.value as 'yes' | 'no' })}>
                        <option value="yes">New admission</option>
                        <option value="no">Existing student</option>
                      </SelectField>
                    </FieldGroup>
                    <FieldGroup label="Special Notes">
                      <input value={studentForm.identifier} onChange={(e) => setStudentForm({ ...studentForm, identifier: e.target.value })} className={inputClass} placeholder="Optional notes / identifier" />
                    </FieldGroup>
                  </div>
                </div>

                <p className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs text-sky-800">
                  Student details ke baad fee planner aur booking payment complete hogi. Booking receive hone ke baad hi student database mein save hoga.
                </p>
                <div className="flex flex-wrap gap-3">
                  {admissionDeskStep === 'details' ? (
                    <button type="button" onClick={handleProceedToFinance} className="rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 md:w-max">
                      Save & Proceed To Fee Planner
                    </button>
                  ) : (
                    <>
                      <button type="button" onClick={() => setAdmissionDeskStep('details')} className="rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100">
                        Edit Student Details
                      </button>
                      <button className="rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 md:w-max">
                        Process Booking Payment & Save Admission
                      </button>
                    </>
                  )}
                </div>
              </form>
                  </section>
                </div>
              ) : null}

              {studentWorkspaceView === 'ledger' ? (
            <section className={sectionClass}>
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h2 className="font-display text-2xl font-semibold text-slate-900">Student ledger</h2>
                    <p className="mt-2 text-sm text-slate-500">Admission + payment columns with filter-based listing.</p>
                  </div>
                  <div className="relative w-full max-w-sm">
                    <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <input value={studentSearch} onChange={(e) => setStudentSearch(e.target.value)} className="w-full rounded-full border border-slate-300 bg-white py-3 pl-11 pr-4 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-900 focus:ring-4 focus:ring-slate-200/70" placeholder="Search students" />
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                  <SelectField value={instituteFilter} onChange={(e) => setInstituteFilter(e.target.value)}>
                    <option value="all">Institute</option>
                    {instituteOptions.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </SelectField>
                  <SelectField value={boardFilter} onChange={(e) => setBoardFilter(e.target.value)}>
                    <option value="all">Board</option>
                    {boardOptions.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </SelectField>
                  <SelectField value={gradeFilter} onChange={(e) => setGradeFilter(e.target.value)}>
                    <option value="all">Grade</option>
                    {gradeOptions.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </SelectField>
                  <SelectField value={academicYearFilter} onChange={(e) => setAcademicYearFilter(e.target.value)}>
                    <option value="all">Academic Year</option>
                    {academicYearOptions.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </SelectField>
                  <SelectField value={admissionFilter} onChange={(e) => setAdmissionFilter(e.target.value)}>
                    <option value="all">New Admission?</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </SelectField>
                </div>
              </div>

              <div className="mt-6 overflow-hidden rounded-[1.5rem] border border-slate-200">
                <div className="overflow-x-auto">
                <div className="grid min-w-[1180px] grid-cols-[1.25fr_1fr_0.85fr_0.8fr_0.95fr_0.9fr_0.9fr_0.85fr_0.95fr_0.95fr_0.9fr] gap-4 bg-slate-50 px-4 py-3 text-xs uppercase tracking-[0.18em] text-slate-500">
                  <span>Student</span>
                  <span>Institute</span>
                  <span>Board</span>
                  <span>Grade</span>
                  <span>Identifier</span>
                  <span>Academic Year</span>
                  <span>New Admission</span>
                  <span>Total Amount</span>
                  <span>Amount Paid</span>
                  <span>Created At</span>
                  <span>Status</span>
                </div>
                <div className="divide-y divide-slate-100">
                  {filteredStudents.map((student) => {
                    const meta = getStudentMeta(student);
                    return (
                    <div key={student.id} className="grid min-w-[1180px] grid-cols-[1.25fr_1fr_0.85fr_0.8fr_0.95fr_0.9fr_0.9fr_0.85fr_0.95fr_0.95fr_0.9fr] gap-4 px-4 py-4 text-sm text-slate-700">
                      <div>
                        <p className="font-medium text-slate-900">{student.full_name}</p>
                        <p className="mt-1 text-xs text-slate-500">{student.admission_no}</p>
                      </div>
                      <span>{meta.institute || '-'}</span>
                      <span>{meta.board || '-'}</span>
                      <span>{meta.grade || student.class_name}</span>
                      <span>{meta.identifier || '-'}</span>
                      <span>{meta.academicYear || '-'}</span>
                      <span className="capitalize">{meta.isNewAdmission === 'yes' ? 'Yes' : 'No'}</span>
                      <span>{formatCurrency(student.total_due)}</span>
                      <span>{formatCurrency(student.total_paid)}</span>
                      <span>{formatDate(student.created_at)}</span>
                      <span className={`inline-flex max-w-max rounded-full px-3 py-1 text-xs ${statusClass(student.status)}`}>
                        {student.status}
                      </span>
                    </div>
                  )})}
                </div>
                </div>
              </div>
            </section>
              ) : null}
              </div>
            ) : null}

            {activeTab === 'fees' ? (
              <div className="mt-6 grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
            <section className={sectionClass}>
              <div className="mb-6 rounded-[1.5rem] border border-amber-200 bg-amber-50 p-4">
                <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-700">Batch Fee Reference</h3>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {BATCH_FEE_PRESETS.map((preset) => (
                    <div key={preset.match} className="rounded-xl border border-amber-200 bg-white px-4 py-3 text-sm text-slate-700">
                      <p className="font-semibold text-slate-900">{preset.match.toUpperCase()}</p>
                      <p className="mt-1 text-amber-700">{formatCurrency(preset.amount)}</p>
                    </div>
                  ))}
                </div>
              </div>
              <h2 className="font-display text-2xl font-semibold text-slate-900">Create fee structure</h2>
              <form onSubmit={handleCreateFeeStructure} className="mt-6 grid gap-4">
                <input required value={feeForm.name} onChange={(e) => setFeeForm({ ...feeForm, name: e.target.value })} className={inputClass} placeholder="Plan name" />
                <div className="grid gap-4 md:grid-cols-2">
                  <input required value={feeForm.fee_type} onChange={(e) => setFeeForm({ ...feeForm, fee_type: e.target.value })} className={inputClass} placeholder="Fee type" />
                  <input value={feeForm.class_name} onChange={(e) => setFeeForm({ ...feeForm, class_name: e.target.value })} className={inputClass} placeholder="Assign class (optional)" />
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <SelectField value={feeForm.installment_plan} onChange={(e) => setFeeForm({ ...feeForm, installment_plan: e.target.value as EduPayInstallmentPlan })}>
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="yearly">Yearly</option>
                  </SelectField>
                  <input required type="number" min="1" value={feeForm.total_amount} onChange={(e) => setFeeForm({ ...feeForm, total_amount: Number(e.target.value) })} className={inputClass} placeholder="Total amount" />
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <input type="number" min="0" value={feeForm.discount_amount} onChange={(e) => setFeeForm({ ...feeForm, discount_amount: Number(e.target.value) })} className={inputClass} placeholder="Discount" />
                  <input value={feeForm.late_fee_rule} onChange={(e) => setFeeForm({ ...feeForm, late_fee_rule: e.target.value })} className={inputClass} placeholder="Late fee rule" />
                </div>
                <textarea value={feeForm.description} onChange={(e) => setFeeForm({ ...feeForm, description: e.target.value })} className={`${inputClass} min-h-24`} placeholder="Description" />
                <button className="rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800">
                  Save fee plan
                </button>
              </form>
            </section>

            <section className="grid gap-6">
              {feeStructures.map((plan) => (
                <article key={plan.id} className={sectionClass}>
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <p className="font-display text-2xl font-semibold text-slate-900">{plan.name}</p>
                      <p className="mt-2 text-sm text-slate-500">
                        {plan.fee_type} plan for {plan.class_name || 'all classes'}
                      </p>
                    </div>
                    <span className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                      {plan.installment_plan}
                    </span>
                  </div>
                  <div className="mt-5 grid gap-4 md:grid-cols-4">
                    <SmallMetric label="Amount" value={formatCurrency(plan.total_amount)} />
                    <SmallMetric label="Discount" value={formatCurrency(plan.discount_amount)} />
                    <SmallMetric label="Assigned" value={`${plan.assigned_students}`} />
                    <SmallMetric label="Late Fee" value={plan.late_fee_rule || 'Not set'} />
                  </div>
                </article>
              ))}
            </section>
              </div>
            ) : null}

            {activeTab === 'payments' ? (
              <div className="mt-6 space-y-6">
            <section className={`${sectionClass} p-5 md:p-6`}>
              <div className="flex flex-wrap gap-2 rounded-full border border-slate-200 bg-slate-50 p-1">
                <button
                  type="button"
                  onClick={() => setPaymentWorkspaceView('collector')}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                    paymentWorkspaceView === 'collector' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                  }`}
                >
                  Payment Collector
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentWorkspaceView('links')}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                    paymentWorkspaceView === 'links' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                  }`}
                >
                  Payment Links
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentWorkspaceView('transactions')}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                    paymentWorkspaceView === 'transactions' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                  }`}
                >
                  Page Transactions
                </button>
              </div>
            </section>

              {paymentWorkspaceView === 'collector' ? (
              <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
            <section className={sectionClass}>
              <h2 className="font-display text-2xl font-semibold text-slate-900">Record payment</h2>
              <form onSubmit={handleCreatePayment} className="mt-6 grid gap-4">
                <SelectField required value={paymentForm.assignment_id} onChange={(e) => setPaymentForm({ ...paymentForm, assignment_id: e.target.value })}>
                  <option value="">Select pending installment</option>
                  {plannerPaymentOptions.map((plannerItem) => (
                    <option key={plannerItem.id} value={plannerItem.id}>
                      {plannerItem.studentName} - {plannerItem.installmentLabel} ({formatCurrency(plannerItem.amountDue)})
                    </option>
                  ))}
                  {pendingAssignments.map((assignment) => {
                    const outstanding = Math.max(
                      assignment.amount_due + assignment.late_fee_applied - assignment.amount_paid,
                      0
                    );
                    return (
                      <option key={assignment.id} value={assignment.id}>
                        {assignment.student_name} - {assignment.fee_structure_name} - {assignment.installment_label} ({formatCurrency(outstanding)})
                      </option>
                    );
                  })}
                </SelectField>
                <div className="grid gap-4 md:grid-cols-2">
                  <input required type="number" min="1" step="0.01" value={paymentForm.amount} onChange={(e) => setPaymentForm({ ...paymentForm, amount: Number(e.target.value) })} className={inputClass} placeholder="Amount" />
                  <SelectField value={paymentForm.method} onChange={(e) => setPaymentForm({ ...paymentForm, method: e.target.value as EduPayPaymentMethod })}>
                    <option value="upi">UPI</option>
                    <option value="card">Card</option>
                    <option value="net_banking">Net Banking</option>
                    <option value="wallet">Wallet</option>
                    <option value="cash">Cash</option>
                  </SelectField>
                </div>
                <input value={paymentForm.transaction_reference} onChange={(e) => setPaymentForm({ ...paymentForm, transaction_reference: e.target.value })} className={inputClass} placeholder="Transaction reference" />
                <button className="rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800">
                  Save payment
                </button>
              </form>
            </section>

            <section className={sectionClass}>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="font-display text-2xl font-semibold text-slate-900">Payment tracker</h2>
                  <p className="mt-2 text-sm text-slate-500">Receipts, methods, and verification state.</p>
                </div>
                <button className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100">
                  <span className="inline-flex items-center gap-2"><Download className="h-4 w-4" />Export</span>
                </button>
              </div>
              <div className="mt-6 overflow-hidden rounded-[1.5rem] border border-slate-200">
                <div className="grid grid-cols-[1.1fr_0.7fr_0.8fr_0.9fr_1fr] gap-4 bg-slate-50 px-4 py-3 text-xs uppercase tracking-[0.22em] text-slate-500">
                  <span>Student</span>
                  <span>Amount</span>
                  <span>Method</span>
                  <span>Date</span>
                  <span>Receipt</span>
                </div>
                <div className="divide-y divide-slate-100">
                  {payments.map((payment) => (
                    <div key={payment.id} className="grid grid-cols-[1.1fr_0.7fr_0.8fr_0.9fr_1fr] gap-4 px-4 py-4 text-sm text-slate-700">
                      <span>{payment.student_name}</span>
                      <span>{formatCurrency(payment.amount)}</span>
                      <span className="capitalize">{payment.method.replace('_', ' ')}</span>
                      <span>{formatDate(payment.payment_date)}</span>
                      <div>
                        <p>{payment.receipt_number}</p>
                        <p className="mt-1 text-xs text-slate-500">{payment.verification_status}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
              </div>
              ) : null}

              {paymentWorkspaceView === 'links' ? (
                <section className={sectionClass}>
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <h2 className="font-display text-2xl font-semibold text-slate-900">Payment links</h2>
                      <p className="mt-2 text-sm text-slate-500">Booking amount ya next due ke liye student ko share karne wale links.</p>
                    </div>
                  </div>
                  <div className="mt-6 overflow-hidden rounded-[1.5rem] border border-slate-200">
                    <div className="grid grid-cols-[1.2fr_0.8fr_0.9fr_0.8fr_0.9fr] gap-4 bg-slate-50 px-4 py-3 text-xs uppercase tracking-[0.2em] text-slate-500">
                      <span>Student</span>
                      <span>Amount</span>
                      <span>Link Code</span>
                      <span>Status</span>
                      <span>Due Date</span>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {paymentLinks.length ? paymentLinks.map((link) => (
                        <div key={link.id} className="grid grid-cols-[1.2fr_0.8fr_0.9fr_0.8fr_0.9fr] gap-4 px-4 py-4 text-sm text-slate-700">
                          <div>
                            <p className="font-medium text-slate-900">{link.studentName}</p>
                            <p className="mt-1 text-xs text-slate-500">{link.admissionNo || 'No admission no'}</p>
                          </div>
                          <span>{formatCurrency(link.amount)}</span>
                          <span>{link.linkCode}</span>
                          <span className="capitalize">{link.status}</span>
                          <span>{formatDate(link.dueDate)}</span>
                        </div>
                      )) : (
                        <div className="px-4 py-8 text-sm text-slate-500">Admission desk se save hone ke baad payment link records yahan dikhenge.</div>
                      )}
                    </div>
                  </div>
                </section>
              ) : null}

              {paymentWorkspaceView === 'transactions' ? (
                <section className={sectionClass}>
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <h2 className="font-display text-2xl font-semibold text-slate-900">Page transactions</h2>
                      <p className="mt-2 text-sm text-slate-500">Received payments aur manual transaction records.</p>
                    </div>
                  </div>
                  <div className="mt-6 overflow-hidden rounded-[1.5rem] border border-slate-200">
                    <div className="grid grid-cols-[1.2fr_0.8fr_0.8fr_1fr_0.8fr_1fr] gap-4 bg-slate-50 px-4 py-3 text-xs uppercase tracking-[0.2em] text-slate-500">
                      <span>Student</span>
                      <span>Amount</span>
                      <span>Mode</span>
                      <span>Reference</span>
                      <span>Status</span>
                      <span>Date</span>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {pageTransactions.length ? pageTransactions.map((txn) => (
                        <div key={txn.id} className="grid grid-cols-[1.2fr_0.8fr_0.8fr_1fr_0.8fr_1fr] gap-4 px-4 py-4 text-sm text-slate-700">
                          <div>
                            <p className="font-medium text-slate-900">{txn.studentName}</p>
                            <p className="mt-1 text-xs text-slate-500">{txn.admissionNo || 'No admission no'}</p>
                          </div>
                          <span>{formatCurrency(txn.amount)}</span>
                          <span className="capitalize">{txn.mode.replace('_', ' ')}</span>
                          <span>{txn.reference || '-'}</span>
                          <span className="capitalize">{txn.status}</span>
                          <span>{formatDate(txn.createdAt)}</span>
                        </div>
                      )) : (
                        <div className="px-4 py-8 text-sm text-slate-500">Payment records yahan transaction log ki tarah dikhेंगे.</div>
                      )}
                    </div>
                  </div>
                </section>
              ) : null}
              </div>
            ) : null}

            {activeTab === 'parent' && parentPortal ? (
              <div className="mt-6 grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
            <section className={sectionClass}>
              <div className="flex items-center gap-3">
                <div className="rounded-2xl border border-slate-200 bg-slate-100 p-3">
                  <Smartphone className="h-5 w-5 text-slate-700" />
                </div>
                <div>
                  <h2 className="font-display text-2xl font-semibold text-slate-900">Parent portal</h2>
                  <p className="mt-1 text-sm text-slate-500">OTP-ready parent summary preview</p>
                </div>
              </div>
              <div className="mt-6 rounded-[1.5rem] border border-slate-200 bg-[linear-gradient(135deg,#0f172a_0%,#1e293b_100%)] p-5 text-white">
                <p className="text-sm text-slate-300">{parentPortal.parent.full_name}</p>
                <p className="font-display mt-2 text-2xl font-semibold text-white">{parentPortal.parent.mobile_number}</p>
                <p className="mt-2 text-sm text-slate-300">{parentPortal.parent.email || 'No email added'}</p>
              </div>
              <div className="mt-5 space-y-4">
                {parentPortal.children.map((child) => (
                  <div key={child.student_id} className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{child.student_name}</p>
                        <p className="mt-1 text-sm text-slate-500">{child.class_name}</p>
                      </div>
                      <span className={`inline-flex rounded-full px-3 py-1 text-xs ${statusClass(child.status)}`}>{child.status}</span>
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <SmallMetric label="Due amount" value={formatCurrency(child.due_amount)} />
                      <SmallMetric label="Next due" value={formatDate(child.next_due_date)} />
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="grid gap-6">
              <div className={sectionClass}>
                <h2 className="font-display text-2xl font-semibold text-slate-900">Payment history</h2>
                <div className="mt-6 space-y-3">
                  {parentPortal.payment_history.map((payment) => (
                    <div key={payment.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{payment.student_name}</p>
                          <p className="mt-1 text-sm text-slate-500">{payment.receipt_number}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-700">
                          <span>{formatCurrency(payment.amount)}</span>
                          <span className="capitalize">{payment.method.replace('_', ' ')}</span>
                          <span>{formatDate(payment.payment_date)}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className={sectionClass}>
                <div className="flex items-center gap-3">
                  <ShieldCheck className="h-5 w-5 text-slate-700" />
                  <h2 className="font-display text-2xl font-semibold text-slate-900">Security</h2>
                </div>
                <div className="mt-6 grid gap-3">
                  {[
                    'JWT authentication for protected endpoints',
                    'Password hashing and session timeout ready flow',
                    'Role-based institute actions',
                    'Validated request payloads on every create action',
                  ].map((item) => (
                    <div key={item} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            </section>
              </div>
            ) : null}
          </div>

          <aside className="hidden xl:block">
            <div className="fixed right-8 top-6 z-20 w-[290px] overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-[0_20px_50px_rgba(15,23,42,0.08)]">
              <div className="border-b border-slate-100 px-5 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-slate-400">BRAIN OF HIMACHAL Panel</p>
                <p className="mt-2 text-lg font-semibold text-slate-900">Secondary Navigation</p>
              </div>

              <div className="max-h-[calc(100vh-3rem)] overflow-y-auto px-3 py-3">
                {eduPaySideItems.map((item) => {
                  const Icon = item.icon || Landmark;
                  const isExpandable = Boolean(item.children?.length);
                  const isExpanded = expandedEduPaySections.includes(item.id);
                  const isActive =
                    item.tab === activeTab ||
                    item.children?.some(
                      (child) =>
                        child.tab === activeTab &&
                        (!child.studentView || child.studentView === studentWorkspaceView) &&
                        (!child.paymentView || child.paymentView === paymentWorkspaceView),
                    );

                  if (isExpandable) {
                    return (
                      <div key={item.id} className="mb-2 overflow-hidden rounded-2xl border border-slate-100">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedEduPaySections((current) =>
                              current.includes(item.id)
                                ? current.filter((entry) => entry !== item.id)
                                : [...current, item.id],
                            )
                          }
                          className={`flex w-full items-center justify-between px-4 py-3 text-left transition ${
                            isActive ? 'bg-slate-50 text-slate-900' : 'bg-white text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          <span className="flex items-center gap-3">
                            <span className="rounded-xl bg-slate-100 p-2 text-slate-600">
                              <Icon className="h-4 w-4" />
                            </span>
                            <span className="text-sm font-medium">{item.label}</span>
                          </span>
                          <ChevronDown className={`h-4 w-4 transition ${isExpanded ? 'rotate-180' : ''}`} />
                        </button>

                        {isExpanded ? (
                          <div className="border-t border-slate-100 bg-slate-50/60 px-4 py-2">
                            {item.children?.map((child) => (
                              <button
                                key={child.id}
                                type="button"
                                onClick={() => {
                                  setActiveTab(child.tab);
                                  if (child.studentView) {
                                    setStudentWorkspaceView(child.studentView);
                                  }
                                  if (child.paymentView) {
                                    setPaymentWorkspaceView(child.paymentView);
                                  }
                                }}
                                className={`mb-1 block w-full rounded-xl px-3 py-2 text-left text-sm transition last:mb-0 ${
                                  activeTab === child.tab &&
                                  (!child.studentView || child.studentView === studentWorkspaceView) &&
                                  (!child.paymentView || child.paymentView === paymentWorkspaceView)
                                    ? 'bg-white font-semibold text-slate-900 shadow-sm'
                                    : 'text-slate-600 hover:bg-white hover:text-slate-900'
                                }`}
                              >
                                {child.label}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    );
                  }

                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        if (item.tab) {
                          setActiveTab(item.tab);
                          if (item.tab === 'payments') {
                            setPaymentWorkspaceView('collector');
                          }
                          if (item.tab === 'students') {
                            setStudentWorkspaceView('admission');
                          }
                        }
                      }}
                      className={`mb-2 flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition ${
                        isActive
                          ? 'bg-gradient-to-r from-blue-50 to-slate-50 text-slate-900 shadow-sm'
                          : 'bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <span className="rounded-xl bg-slate-100 p-2 text-slate-600">
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="text-sm font-medium">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: typeof IndianRupee;
}) {
  return (
    <article className="rounded-[1.25rem] border border-slate-200 bg-white p-4 shadow-[0_12px_30px_rgba(15,23,42,0.05)]">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-slate-500">{label}</p>
          <p className="font-body mt-2 text-2xl font-bold text-slate-900">{value}</p>
        </div>
        <div className="rounded-[1rem] border border-slate-200 bg-slate-100 p-2.5">
          <Icon className="h-4 w-4 text-slate-700" />
        </div>
      </div>
    </article>
  );
}

function SmallMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{label}</p>
      <p className="mt-2 text-sm text-slate-900">{value}</p>
    </div>
  );
}

function FieldGroup({
  label,
  children,
  className = '',
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
        {label}
      </label>
      {children}
    </div>
  );
}

function SelectField({
  children,
  className = '',
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select {...props} className={`${selectClass} ${className}`.trim()}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
    </div>
  );
}
