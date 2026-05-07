export type StaffDirectoryStaffType = 'teaching' | 'non_teaching';

export type StaffDirectoryDetails = {
  dob?: string;
  primaryMobile?: string;
  whatsappNumber?: string;
  gender?: string;
  maritalStatus?: string;
  schoolName?: string;
  fatherName?: string;
  fatherContact?: string;
  motherName?: string;
  motherContact?: string;
  spouseName?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  country?: string;
  pinCode?: string;
  aadhaarNumber?: string;
  panNumber?: string;
  bloodGroup?: string;
  emergencyContactName?: string;
  emergencyContactNumber?: string;
  emergencyRelation?: string;
  monthlySalary?: string;
  accountNumber?: string;
  ifscCode?: string;
  bankName?: string;
  notes?: string;
};

export type StaffDirectoryRecord = {
  id: string;
  backendId?: number;
  backendType: StaffDirectoryStaffType;
  staffType: StaffDirectoryStaffType;
  photoDataUrl?: string;
  category: string;
  firstName: string;
  middleName?: string;
  lastName?: string;
  fullName: string;
  employeeId?: string;
  subject?: string;
  department?: string;
  designation?: string;
  phone?: string;
  email?: string;
  joiningDate?: string;
  shiftTiming?: string;
  isActive: boolean;
  createdAt: string;
  details?: StaffDirectoryDetails;
};

export type StaffDirectoryDuplicateGroup = {
  normalizedName: string;
  fullName: string;
  records: StaffDirectoryRecord[];
};

export const STAFF_ADDED_TEACHER_IDS_KEY = 'staff_add_teacher_ids';
export const STAFF_ADDED_INVIGILATOR_IDS_KEY = 'staff_add_invigilator_ids';
export const STAFF_DIRECTORY_RECORDS_KEY = 'staff_directory_records';

const parseJson = <T,>(value: string | null, fallback: T): T => {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

export const readStoredIds = (storageKey: string) => {
  if (typeof window === 'undefined') return [] as number[];
  const parsed = parseJson<unknown>(window.localStorage.getItem(storageKey), []);
  return Array.isArray(parsed)
    ? parsed.map((item) => Number(item)).filter((item) => Number.isFinite(item))
    : [];
};

export const storeEntityId = (storageKey: string, id: number) => {
  if (typeof window === 'undefined' || !Number.isFinite(id)) return;
  const nextIds = Array.from(new Set([...readStoredIds(storageKey), id]));
  window.localStorage.setItem(storageKey, JSON.stringify(nextIds));
};

export const removeStoredEntityId = (storageKey: string, id?: number) => {
  if (typeof window === 'undefined' || !Number.isFinite(id)) return;
  const nextIds = readStoredIds(storageKey).filter((item) => item !== id);
  window.localStorage.setItem(storageKey, JSON.stringify(nextIds));
};

export const readStaffDirectoryRecords = () => {
  if (typeof window === 'undefined') return [] as StaffDirectoryRecord[];
  const parsed = parseJson<unknown>(window.localStorage.getItem(STAFF_DIRECTORY_RECORDS_KEY), []);
  return Array.isArray(parsed) ? (parsed as StaffDirectoryRecord[]) : [];
};

export const writeStaffDirectoryRecords = (records: StaffDirectoryRecord[]) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STAFF_DIRECTORY_RECORDS_KEY, JSON.stringify(records));
};

export const normalizeStaffDirectoryName = (value: string) =>
  value.trim().replace(/\s+/g, ' ').toLowerCase();

export const findStaffDirectoryNameMatches = (
  records: StaffDirectoryRecord[],
  fullName: string,
  excludeId?: string
) => {
  const normalizedName = normalizeStaffDirectoryName(fullName);
  if (!normalizedName) return [] as StaffDirectoryRecord[];

  return records.filter((record) => {
    if (excludeId && record.id === excludeId) return false;
    return normalizeStaffDirectoryName(record.fullName) === normalizedName;
  });
};

export const getStaffDirectoryDuplicateGroups = (records: StaffDirectoryRecord[]) => {
  const groups = new Map<string, StaffDirectoryRecord[]>();

  records.forEach((record) => {
    const normalizedName = normalizeStaffDirectoryName(record.fullName);
    if (!normalizedName) return;
    const current = groups.get(normalizedName) || [];
    current.push(record);
    groups.set(normalizedName, current);
  });

  return Array.from(groups.entries())
    .filter(([, groupRecords]) => groupRecords.length > 1)
    .map(([normalizedName, groupRecords]) => ({
      normalizedName,
      fullName: groupRecords[0]?.fullName || normalizedName,
      records: groupRecords.sort((a, b) => a.staffType.localeCompare(b.staffType) || a.fullName.localeCompare(b.fullName)),
    })) as StaffDirectoryDuplicateGroup[];
};

export const upsertStaffDirectoryRecord = (record: StaffDirectoryRecord) => {
  const current = readStaffDirectoryRecords();
  const index = current.findIndex((item) =>
    record.backendId && item.backendId
      ? item.backendId === record.backendId && item.backendType === record.backendType
      : item.id === record.id
  );

  if (index >= 0) {
    const next = [...current];
    next[index] = record;
    writeStaffDirectoryRecords(next);
    return;
  }

  writeStaffDirectoryRecords([record, ...current]);
};

export const removeStaffDirectoryRecord = (recordId: string) => {
  const current = readStaffDirectoryRecords();
  writeStaffDirectoryRecords(current.filter((item) => item.id !== recordId));
};

export const clearStaffDirectoryRecords = () => {
  writeStaffDirectoryRecords([]);
};
