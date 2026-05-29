export type EduPayAdmissionCourse = '' | 'neet' | 'jee_main' | 'advance' | 'ssb';
export type EduPayAdmissionProgram = '' | 'medical' | 'non_medical';
export type EduPayAdmissionRequestStatus = 'pending' | 'processed';
export type EduPayPaymentMode =
  | 'cash'
  | 'upi'
  | 'card'
  | 'net_banking'
  | 'cheque'
  | 'wallet';

export type EduPayInstallmentPlanDraft = {
  id: string;
  label: string;
  amount: number;
  dueDate?: string;
  isPaid?: boolean;
};

export type EduPayFinancePlan = {
  totalFee: number;
  bookingAmount: number;
  scholarshipAmount: number;
  netFee: number;
  remainingAfterBooking: number;
  installmentCount: 1 | 2 | 3;
  installments: EduPayInstallmentPlanDraft[];
  preferredPaymentMode: EduPayPaymentMode;
  nextPaymentDate?: string;
  notes?: string;
};

export type EduPayAdmissionSnapshot = {
  admissionId: string;
  academicYear: string;
  course: EduPayAdmissionCourse;
  program: EduPayAdmissionProgram;
  managedBatch: string;
  className: string;
  section: string;
  rollNumber: string;
  firstName: string;
  middleName?: string;
  lastName?: string;
  fullName: string;
  localName?: string;
  ageAsOfToday?: string;
  dob?: string;
  gender?: string;
  email?: string;
  phone?: string;
  admissionDate?: string;
  fatherName?: string;
  fatherMobile?: string;
  fatherOccupation?: string;
  motherName?: string;
  motherMobile?: string;
  motherOccupation?: string;
  guardianName?: string;
  guardianRelation?: string;
  guardianMobile?: string;
  guardianAddress?: string;
  address1?: string;
  address2?: string;
  city?: string;
  state?: string;
  country?: string;
  pincode?: string;
  region?: string;
  category?: string;
  subCategory?: string;
  previousSchool?: string;
  previousBoard?: string;
  previousExam?: string;
  previousPercentage?: string;
  previousTotalMarks?: string;
  previousAverage?: string;
  siblingName?: string;
  siblingSchool?: string;
  emergencyName?: string;
  emergencyMobile?: string;
  pickupEnabled?: boolean;
  dropEnabled?: boolean;
  transportMonth?: string;
  transportRoute?: string;
  transportStop?: string;
  specialNeeds?: string;
  admissionType?: 'old' | 'new';
  boardingType?: string;
  availingMessFacility?: 'yes' | 'no';
  institute?: string;
  board?: string;
  identifier?: string;
  feeSchedule?: string;
  tcNumber?: string;
  priorityContact?: 'father' | 'mother' | 'guardian';
  photoDataUrl?: string;
  preferredFeeStructureId?: number | null;
  preferredFeeStructureName?: string;
  financePlan?: EduPayFinancePlan;
};

export type EduPayAdmissionRequest = {
  id: string;
  source: 'admin_request';
  status: EduPayAdmissionRequestStatus;
  linkedStudentId?: string | number;
  linkedStudentRollNumber?: string;
  processedEduPayStudentId?: number;
  createdAt: string;
  updatedAt: string;
  details: EduPayAdmissionSnapshot;
};

export type EduPayStudentProfile = {
  id: string;
  source: 'admin_request' | 'edupay_direct';
  edupayStudentId?: number;
  admissionNo: string;
  requestId?: string;
  createdAt: string;
  updatedAt: string;
  details: EduPayAdmissionSnapshot;
};

export type EduPayPaymentLinkRecord = {
  id: string;
  studentProfileId?: string;
  studentName: string;
  admissionNo: string;
  amount: number;
  linkCode: string;
  status: 'pending' | 'sent' | 'paid';
  createdAt: string;
  dueDate?: string;
};

export type EduPayPageTransactionRecord = {
  id: string;
  studentProfileId?: string;
  studentName: string;
  admissionNo: string;
  amount: number;
  mode: EduPayPaymentMode;
  reference?: string;
  status: 'received' | 'pending' | 'failed';
  createdAt: string;
  notes?: string;
};

const EDUPAY_ADMISSION_REQUESTS_KEY = 'edupay-admission-requests';
const EDUPAY_STUDENT_PROFILES_KEY = 'edupay-student-profiles';
const EDUPAY_PAYMENT_LINKS_KEY = 'edupay-payment-links';
const EDUPAY_PAGE_TRANSACTIONS_KEY = 'edupay-page-transactions';

const parseJson = <T,>(value: string | null, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

export const readEduPayAdmissionRequests = () => {
  if (typeof window === 'undefined') return [] as EduPayAdmissionRequest[];
  const parsed = parseJson<unknown>(window.localStorage.getItem(EDUPAY_ADMISSION_REQUESTS_KEY), []);
  return Array.isArray(parsed) ? (parsed as EduPayAdmissionRequest[]) : [];
};

const writeEduPayAdmissionRequests = (records: EduPayAdmissionRequest[]) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(EDUPAY_ADMISSION_REQUESTS_KEY, JSON.stringify(records));
};

export const upsertEduPayAdmissionRequest = (
  draft: Omit<EduPayAdmissionRequest, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
) => {
  const current = readEduPayAdmissionRequests();
  const now = new Date().toISOString();
  const existing = current.find((item) =>
    draft.id
      ? item.id === draft.id
      : ((draft.linkedStudentId != null && String(draft.linkedStudentId).trim()) && String(item.linkedStudentId ?? '') === String(draft.linkedStudentId)) ||
        (!!draft.linkedStudentRollNumber && item.linkedStudentRollNumber === draft.linkedStudentRollNumber) ||
        (!!draft.details.admissionId && item.details.admissionId === draft.details.admissionId),
  );

  const nextRecord: EduPayAdmissionRequest = existing
    ? {
        ...existing,
        ...draft,
        id: existing.id,
        status: existing.status,
        processedEduPayStudentId: existing.processedEduPayStudentId,
        createdAt: existing.createdAt,
        updatedAt: now,
      }
    : {
        ...draft,
        id: draft.id || `adm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: now,
        updatedAt: now,
      };

  const filtered = current.filter((item) => item.id !== nextRecord.id);
  writeEduPayAdmissionRequests([nextRecord, ...filtered]);
  return nextRecord;
};

export const markEduPayAdmissionRequestProcessed = (requestId: string, edupayStudentId?: number) => {
  const current = readEduPayAdmissionRequests();
  const next = current.map((item) =>
    item.id === requestId
      ? {
          ...item,
          status: 'processed' as const,
          processedEduPayStudentId: edupayStudentId,
          updatedAt: new Date().toISOString(),
        }
      : item,
  );
  writeEduPayAdmissionRequests(next);
};

export const readEduPayStudentProfiles = () => {
  if (typeof window === 'undefined') return [] as EduPayStudentProfile[];
  const parsed = parseJson<unknown>(window.localStorage.getItem(EDUPAY_STUDENT_PROFILES_KEY), []);
  return Array.isArray(parsed) ? (parsed as EduPayStudentProfile[]) : [];
};

const writeEduPayStudentProfiles = (records: EduPayStudentProfile[]) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(EDUPAY_STUDENT_PROFILES_KEY, JSON.stringify(records));
};

export const upsertEduPayStudentProfile = (
  draft: Omit<EduPayStudentProfile, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
) => {
  const current = readEduPayStudentProfiles();
  const now = new Date().toISOString();
  const existing = current.find((item) =>
    (typeof draft.edupayStudentId === 'number' && item.edupayStudentId === draft.edupayStudentId) ||
    (!!draft.admissionNo && item.admissionNo === draft.admissionNo) ||
    (!!draft.requestId && item.requestId === draft.requestId),
  );

  const nextRecord: EduPayStudentProfile = existing
    ? {
        ...existing,
        ...draft,
        id: existing.id,
        createdAt: existing.createdAt,
        updatedAt: now,
      }
    : {
        ...draft,
        id: draft.id || `profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: now,
        updatedAt: now,
      };

  const filtered = current.filter((item) => item.id !== nextRecord.id);
  writeEduPayStudentProfiles([nextRecord, ...filtered]);
  return nextRecord;
};

export const getEduPayStudentProfile = (edupayStudentId?: number, admissionNo?: string) => {
  return readEduPayStudentProfiles().find(
    (item) =>
      (typeof edupayStudentId === 'number' && item.edupayStudentId === edupayStudentId) ||
      (!!admissionNo && item.admissionNo === admissionNo),
  );
};

export const readEduPayPaymentLinks = () => {
  if (typeof window === 'undefined') return [] as EduPayPaymentLinkRecord[];
  const parsed = parseJson<unknown>(window.localStorage.getItem(EDUPAY_PAYMENT_LINKS_KEY), []);
  return Array.isArray(parsed) ? (parsed as EduPayPaymentLinkRecord[]) : [];
};

const writeEduPayPaymentLinks = (records: EduPayPaymentLinkRecord[]) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(EDUPAY_PAYMENT_LINKS_KEY, JSON.stringify(records));
};

export const upsertEduPayPaymentLink = (record: EduPayPaymentLinkRecord) => {
  const current = readEduPayPaymentLinks();
  const filtered = current.filter((item) => item.id !== record.id);
  writeEduPayPaymentLinks([record, ...filtered]);
};

export const readEduPayPageTransactions = () => {
  if (typeof window === 'undefined') return [] as EduPayPageTransactionRecord[];
  const parsed = parseJson<unknown>(window.localStorage.getItem(EDUPAY_PAGE_TRANSACTIONS_KEY), []);
  return Array.isArray(parsed) ? (parsed as EduPayPageTransactionRecord[]) : [];
};

const writeEduPayPageTransactions = (records: EduPayPageTransactionRecord[]) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(EDUPAY_PAGE_TRANSACTIONS_KEY, JSON.stringify(records));
};

export const appendEduPayPageTransaction = (record: EduPayPageTransactionRecord) => {
  const current = readEduPayPageTransactions();
  writeEduPayPageTransactions([record, ...current]);
};

export const clearEduPayWorkspaceData = () => {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(EDUPAY_ADMISSION_REQUESTS_KEY);
  window.localStorage.removeItem(EDUPAY_STUDENT_PROFILES_KEY);
  window.localStorage.removeItem(EDUPAY_PAYMENT_LINKS_KEY);
  window.localStorage.removeItem(EDUPAY_PAGE_TRANSACTIONS_KEY);
};
