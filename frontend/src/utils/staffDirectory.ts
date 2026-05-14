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
