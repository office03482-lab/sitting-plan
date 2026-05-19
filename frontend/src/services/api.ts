import axios, { AxiosInstance } from 'axios';
import type { AxiosProgressEvent } from 'axios';
import type { 
  Student, Room, SeatingPlan, RoomLayout, LoginCredentials, OTPLoginCredentials, Exam,
  Teacher, TimetableEntry, TimetableView, DayOfWeek, Invigilator, RoomInvigilator, InvigilatorWithRooms,
  Supplier, MaterialItem, StockInEntry, StockOutEntry, StudentIssueEntry, InventoryDashboard, InventoryHistoryEntry, InventoryMaterialImportResponse, InventoryReportResponse,
  InventoryCatalogSubject, InventorySet, InventorySubject, InventoryVolume,
  EduPayAssignment, EduPayDashboard, EduPayFeeStructure, EduPayParentPortal, EduPayPayment, EduPayStudent,
  AttendanceHoliday, AttendanceLeave, AttendanceNotification, AttendanceOverview, AttendanceReportResponse,
  AttendanceSettings, AttendanceStaff, AttendanceSubject, AttendanceStudent, StaffAttendanceMarkingResponse,
  StaffAttendanceRecord, StaffDashboard, StudentAttendanceMarkingResponse, StudentAttendanceRecord, StudentBatchTransferResponse, StudentDashboard, TeacherAttendanceContext,
  Batch,
  Hostel, HostelRoom, StudentHostelRequest,
  AuthResponse, RolePowerUser
} from '@types';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@store/auth';
import {
  buildPlanBatchDistribution,
  generatePlannerSeating,
} from './seatingPlanner';

const MAX_GET_RETRIES = 2;
const RETRYABLE_STATUS_CODES = new Set([502, 503, 504]);
const API_TIMEOUT_MS = 60000;
const LONG_RUNNING_IMPORT_TIMEOUT_MS = 10 * 60 * 1000;
const STUDENT_PHOTO_BUCKET = 'student-photos';
const STAFF_PHOTO_BUCKET = 'staff-photos';

const stripTrailingSlash = (value: string) => value.replace(/\/+$/, '');

const getConfiguredApiOrigin = () => {
  const rawValue = String(import.meta.env.VITE_API_URL || '').trim();
  return rawValue ? stripTrailingSlash(rawValue) : '';
};

const isLocalDevelopmentHost = () =>
  typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);

export const getApiBaseUrl = () => {
  const configuredOrigin = getConfiguredApiOrigin();
  if (configuredOrigin) {
    return `${configuredOrigin}/api`;
  }

  if (import.meta.env.DEV) {
    return '/api';
  }

  console.warn('[API] VITE_API_URL is missing in production. Falling back to relative /api.');
  return '/api';
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const toArray = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
export const getRequestErrorMessage = (error: any, fallback: string) => {
  const detail = error?.response?.data?.detail || error?.response?.data?.error;
  if (typeof detail === 'string' && detail.trim()) {
    return detail;
  }

  if (error?.code === 'ECONNABORTED') {
    return 'Request timeout ho gaya. Backend response time bahut slow hai.';
  }

  const message = typeof error?.message === 'string' ? error.message.trim() : '';
  if (message === 'Network Error' || message === 'Failed to fetch') {
    return 'Backend se connection nahi ho paaya. Server chal raha hai ya nahi, aur API URL sahi hai ya nahi check karo.';
  }

  if (error?.request && !error?.response) {
    return 'Request backend tak gaya, lekin koi response nahi mila. Server ya proxy issue ho sakta hai.';
  }

  return message || fallback;
};

const getPersistedUser = () => {
  if (typeof window === 'undefined') return null;
  try {
    const rawUser = window.localStorage.getItem('user');
    return rawUser ? JSON.parse(rawUser) : null;
  } catch {
    return null;
  }
};

class ApiService {
  private api: AxiosInstance;
  private studentIdMap = new Map<number, string>();
  private studentReverseIdMap = new Map<string, number>();
  private teacherIdMap = new Map<number, string>();
  private teacherReverseIdMap = new Map<string, number>();
  private invigilatorIdMap = new Map<number, string>();
  private invigilatorReverseIdMap = new Map<string, number>();
  private examIdMap = new Map<number, string>();
  private seatingPlanIdMap = new Map<number, string>();
  private seatingPlanReverseIdMap = new Map<string, number>();
  private timetableEntryIdMap = new Map<number, string>();
  private timetableEntryReverseIdMap = new Map<string, number>();
  private supplierIdMap = new Map<number, string>();
  private supplierReverseIdMap = new Map<string, number>();
  private inventorySubjectIdMap = new Map<number, string>();
  private inventorySubjectReverseIdMap = new Map<string, number>();
  private inventorySetIdMap = new Map<number, string>();
  private inventorySetReverseIdMap = new Map<string, number>();
  private inventoryVolumeIdMap = new Map<number, string>();
  private inventoryVolumeReverseIdMap = new Map<string, number>();
  private materialIdMap = new Map<number, string>();
  private materialReverseIdMap = new Map<string, number>();
  private stockInIdMap = new Map<number, string>();
  private stockInReverseIdMap = new Map<string, number>();
  private stockOutIdMap = new Map<number, string>();
  private stockOutReverseIdMap = new Map<string, number>();
  private studentIssueIdMap = new Map<number, string>();
  private studentIssueReverseIdMap = new Map<string, number>();

  private getAccessToken() {
    return typeof window === 'undefined' ? null : localStorage.getItem('auth_token');
  }

  private isRefreshExcluded(url?: string) {
    if (!url) return false;
    return [
      '/auth/login-password',
      '/auth/send-otp',
      '/auth/verify-otp',
      '/auth/refresh',
    ].some((path) => url.includes(path));
  }

  private clearClientAuth(redirectToLogin: boolean = true) {
    useAuthStore.getState().logout();
    if (typeof window !== 'undefined' && redirectToLogin && !window.location.pathname.startsWith('/login')) {
      window.location.replace('/login');
    }
  }

  private getCurrentSupabaseSchoolId() {
    const user = useAuthStore.getState().user;
    const directValue = user?.school_id || user?.default_school_id || null;
    if (directValue) {
      return directValue;
    }

    if (typeof window !== 'undefined') {
      try {
        const rawUser = window.localStorage.getItem('user');
        if (rawUser) {
          const parsedUser = JSON.parse(rawUser) as { school_id?: string; default_school_id?: string };
          return parsedUser?.school_id || parsedUser?.default_school_id || null;
        }
      } catch {
        // Ignore malformed persisted auth payload.
      }
    }

    return null;
  }

  private async resolveCurrentSupabaseSchoolId() {
    const storeSchoolId = this.getCurrentSupabaseSchoolId();
    if (storeSchoolId) {
      return storeSchoolId;
    }

    if (typeof window !== 'undefined') {
      try {
        const rawUser = window.localStorage.getItem('user');
        if (rawUser) {
          const parsedUser = JSON.parse(rawUser) as { school_id?: string; default_school_id?: string };
          const persistedSchoolId = parsedUser?.school_id || parsedUser?.default_school_id || null;
          if (persistedSchoolId) {
            return persistedSchoolId;
          }
        }
      } catch {
        // Ignore malformed persisted auth payload.
      }
    }

    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) {
      throw sessionError;
    }

    const profileId = sessionData.session?.user?.id;
    if (!profileId) {
      return null;
    }

    const { data: memberships, error: membershipError } = await supabase
      .from('school_memberships')
      .select('school_id, is_primary')
      .eq('profile_id', profileId)
      .eq('is_active', true)
      .eq('status', 'active');

    if (membershipError) {
      throw membershipError;
    }

    const membershipList = Array.isArray(memberships) ? memberships : [];
    const activeMembership = membershipList.find((item: any) => item.is_primary) || membershipList[0];
    return activeMembership?.school_id || null;
  }

  private async resolveScopedSchoolId(schoolId?: number | string | null) {
    const candidate = String(schoolId ?? '').trim();
    if (candidate && candidate !== '1') {
      return candidate;
    }
    return this.resolveCurrentSupabaseSchoolId();
  }

  private isUuidLike(value: string) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }

  private getLegacyMappedId(kind: 'student' | 'teacher' | 'invigilator', actualId?: string | null) {
    if (!actualId) return 0;

    const reverseMap =
      kind === 'student'
        ? this.studentReverseIdMap
        : kind === 'teacher'
          ? this.teacherReverseIdMap
          : this.invigilatorReverseIdMap;
    const forwardMap =
      kind === 'student' ? this.studentIdMap : kind === 'teacher' ? this.teacherIdMap : this.invigilatorIdMap;

    const existing = reverseMap.get(actualId);
    if (existing) return existing;

    const seed = `${kind}:${actualId}`;
    let hash = 0;
    for (let index = 0; index < seed.length; index += 1) {
      hash = ((hash << 5) - hash + seed.charCodeAt(index)) | 0;
    }

    let legacyId = Math.abs(hash) || 1;
    while (forwardMap.has(legacyId) && forwardMap.get(legacyId) !== actualId) {
      legacyId += 1;
    }

    forwardMap.set(legacyId, actualId);
    reverseMap.set(actualId, legacyId);
    return legacyId;
  }

  private resolveMappedId(kind: 'student' | 'teacher' | 'invigilator', id: string | number) {
    if (typeof id === 'string' && this.isUuidLike(id)) {
      return id;
    }

    const forwardMap =
      kind === 'student' ? this.studentIdMap : kind === 'teacher' ? this.teacherIdMap : this.invigilatorIdMap;
    return forwardMap.get(Number(id)) || String(id);
  }

  private resolveExamId(id: string | number) {
    if (typeof id === 'string' && this.isUuidLike(id)) {
      return id;
    }

    const mappedId = this.examIdMap.get(Number(id));
    if (mappedId && this.isUuidLike(mappedId)) {
      return mappedId;
    }

    return String(id);
  }

  private async resolveExamUuidOrThrow(examId: string | number) {
    const resolvedExamId = this.resolveExamId(examId);
    if (this.isUuidLike(resolvedExamId)) {
      return resolvedExamId;
    }

    const response = await this.listExams();
    const refreshedExam = toArray<Exam>(response.data).find((exam) => String(exam.id) === String(examId));
    if (refreshedExam && typeof refreshedExam.id === 'string' && this.isUuidLike(refreshedExam.id)) {
      return refreshedExam.id;
    }

    throw new Error('Selected exam is using a stale local ID. Reload exams and try again.');
  }

  private getLegacySeatingPlanId(actualId?: string | null) {
    return this.getLegacyInventoryId(this.seatingPlanIdMap, this.seatingPlanReverseIdMap, 'seating-plan', actualId);
  }

  private resolveSeatingPlanId(id: string | number) {
    return this.resolveLegacyInventoryId(this.seatingPlanIdMap, id);
  }

  private getLegacyTimetableEntryId(actualId?: string | null) {
    return this.getLegacyInventoryId(this.timetableEntryIdMap, this.timetableEntryReverseIdMap, 'timetable-entry', actualId);
  }

  private resolveTimetableEntryId(id: string | number) {
    return this.resolveLegacyInventoryId(this.timetableEntryIdMap, id);
  }

  private getLegacyInventoryId(
    forwardMap: Map<number, string>,
    reverseMap: Map<string, number>,
    seedPrefix: string,
    actualId?: string | null,
  ) {
    if (!actualId) return 0;

    const existing = reverseMap.get(actualId);
    if (existing) return existing;

    const seed = `${seedPrefix}:${actualId}`;
    let hash = 0;
    for (let index = 0; index < seed.length; index += 1) {
      hash = ((hash << 5) - hash + seed.charCodeAt(index)) | 0;
    }

    let legacyId = Math.abs(hash) || 1;
    while (forwardMap.has(legacyId) && forwardMap.get(legacyId) !== actualId) {
      legacyId += 1;
    }

    forwardMap.set(legacyId, actualId);
    reverseMap.set(actualId, legacyId);
    return legacyId;
  }

  private resolveLegacyInventoryId(
    forwardMap: Map<number, string>,
    id: string | number,
  ) {
    if (typeof id === 'string' && this.isUuidLike(id)) {
      return id;
    }
    return forwardMap.get(Number(id)) || String(id);
  }

  private compactObject<T extends Record<string, unknown>>(value: T) {
    return Object.fromEntries(
      Object.entries(value).filter(([, entry]) => entry !== undefined)
    ) as T;
  }

  private buildLegacyRoomAssignmentId(roomId: string | number, staffMemberId: string | number) {
    const seed = `room-assignment:${String(roomId)}:${String(staffMemberId)}`;
    let hash = 0;
    for (let index = 0; index < seed.length; index += 1) {
      hash = ((hash << 5) - hash + seed.charCodeAt(index)) | 0;
    }
    return Math.abs(hash) || 1;
  }

  private getRoomAssignmentMetadata(room: any) {
    const assignment = room?.metadata?.invigilator_assignment;
    return assignment && typeof assignment === 'object' ? assignment : null;
  }

  private mapSupabaseRoomAssignmentToLegacy(room: any, staffMember: any): RoomInvigilator {
    const assignmentMetadata = this.getRoomAssignmentMetadata(room) || {};
    return {
      id: this.buildLegacyRoomAssignmentId(room.id, staffMember.id),
      room_id: room.id,
      invigilator_id: this.getLegacyMappedId('invigilator', staffMember.id),
      school_id: 1,
      exam_id: undefined,
      notes: assignmentMetadata.notes || '',
      is_active: assignmentMetadata.is_active !== false,
      created_at: assignmentMetadata.created_at || room.created_at,
      updated_at: assignmentMetadata.updated_at || room.updated_at || room.created_at,
      invigilator: this.mapSupabaseInvigilatorToLegacy(staffMember),
      room: this.mapSupabaseRoomToLegacy(room),
    } as RoomInvigilator;
  }

  private dataUrlToBlob(dataUrl: string) {
    const matches = dataUrl.match(/^data:(.+?);base64,(.+)$/);
    if (!matches) {
      throw new Error('Invalid photo data format');
    }

    const [, mimeType, base64Data] = matches;
    const binary = atob(base64Data);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return {
      blob: new Blob([bytes], { type: mimeType }),
      mimeType,
    };
  }

  private getFileExtensionFromMimeType(mimeType: string) {
    if (mimeType.includes('png')) return 'png';
    if (mimeType.includes('webp')) return 'webp';
    if (mimeType.includes('gif')) return 'gif';
    return 'jpg';
  }

  private async removeStudentPhotoAsset(photoPath?: string | null) {
    if (!photoPath) return;
    const { error } = await supabase.storage.from(STUDENT_PHOTO_BUCKET).remove([photoPath]);
    if (error) {
      console.warn('[Supabase] removeStudentPhotoAsset failed', {
        message: error.message,
        path: photoPath,
      });
    }
  }

  private async persistStudentPhoto(
    schoolId: string,
    rollNumber: string,
    photoDataUrl?: string | null,
    existingPhotoPath?: string | null,
  ) {
    const normalizedPhoto = String(photoDataUrl || '').trim();
    if (!normalizedPhoto) {
      if (existingPhotoPath) {
        await this.removeStudentPhotoAsset(existingPhotoPath);
      }
      return {
        photoUrl: null,
        photoPath: null,
        photoDataUrl: null,
      };
    }

    if (!normalizedPhoto.startsWith('data:')) {
      return {
        photoUrl: normalizedPhoto,
        photoPath: existingPhotoPath || null,
        photoDataUrl: null,
      };
    }

    try {
      const { blob, mimeType } = this.dataUrlToBlob(normalizedPhoto);
      const extension = this.getFileExtensionFromMimeType(mimeType);
      const safeRollNumber = String(rollNumber || 'student')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      const nextPhotoPath = `${schoolId}/${safeRollNumber || 'student'}/${Date.now()}.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from(STUDENT_PHOTO_BUCKET)
        .upload(nextPhotoPath, blob, {
          contentType: mimeType,
          upsert: true,
        });

      if (uploadError) {
        throw new Error(
          `Student photo upload failed. Check Supabase Storage bucket "${STUDENT_PHOTO_BUCKET}" and its policies.`
        );
      }

      if (existingPhotoPath && existingPhotoPath !== nextPhotoPath) {
        await this.removeStudentPhotoAsset(existingPhotoPath);
      }

      const { data } = supabase.storage.from(STUDENT_PHOTO_BUCKET).getPublicUrl(nextPhotoPath);
      return {
        photoUrl: data.publicUrl,
        photoPath: nextPhotoPath,
        photoDataUrl: null,
      };
    } catch (error: any) {
      console.warn('[Supabase] student photo persistence failed', {
        message: error?.message,
      });
      throw error;
    }
  }

  private async removeStaffPhotoAsset(photoPath?: string | null) {
    if (!photoPath) return;
    const { error } = await supabase.storage.from(STAFF_PHOTO_BUCKET).remove([photoPath]);
    if (error) {
      console.warn('[Supabase] removeStaffPhotoAsset failed', {
        message: error.message,
        path: photoPath,
      });
    }
  }

  private async persistStaffPhoto(
    schoolId: string,
    staffSeed: string,
    photoDataUrl?: string | null,
    existingPhotoPath?: string | null,
  ) {
    const normalizedPhoto = String(photoDataUrl || '').trim();
    if (!normalizedPhoto) {
      if (existingPhotoPath) {
        await this.removeStaffPhotoAsset(existingPhotoPath);
      }
      return {
        photoUrl: null,
        photoPath: null,
        photoDataUrl: null,
      };
    }

    if (!normalizedPhoto.startsWith('data:')) {
      return {
        photoUrl: normalizedPhoto,
        photoPath: existingPhotoPath || null,
        photoDataUrl: null,
      };
    }

    try {
      const { blob, mimeType } = this.dataUrlToBlob(normalizedPhoto);
      const extension = this.getFileExtensionFromMimeType(mimeType);
      const safeSeed = String(staffSeed || 'staff')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      const nextPhotoPath = `${schoolId}/${safeSeed || 'staff'}/${Date.now()}.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from(STAFF_PHOTO_BUCKET)
        .upload(nextPhotoPath, blob, {
          contentType: mimeType,
          upsert: true,
        });

      if (uploadError) {
        throw new Error(
          `Staff photo upload failed. Check Supabase Storage bucket "${STAFF_PHOTO_BUCKET}" and its policies.`
        );
      }

      if (existingPhotoPath && existingPhotoPath !== nextPhotoPath) {
        await this.removeStaffPhotoAsset(existingPhotoPath);
      }

      const { data } = supabase.storage.from(STAFF_PHOTO_BUCKET).getPublicUrl(nextPhotoPath);
      return {
        photoUrl: data.publicUrl,
        photoPath: nextPhotoPath,
        photoDataUrl: null,
      };
    } catch (error: any) {
      console.warn('[Supabase] staff photo persistence failed', {
        message: error?.message,
      });
      throw error;
    }
  }

  private logSupabaseQueryError(context: string, error: any, details?: Record<string, unknown>) {
    console.error(`[Supabase] ${context} failed`, {
      message: error?.message,
      code: error?.code,
      details: error?.details,
      hint: error?.hint,
      ...(details || {}),
    });
  }

  private async findSupabaseBatchByName(batchName?: string | null, schoolId?: string) {
    const scopedSchoolId = schoolId || await this.resolveCurrentSupabaseSchoolId();
    const normalizedName = String(batchName || '').trim();

    if (!scopedSchoolId || !normalizedName) {
      return null;
    }

    const { data, error } = await supabase
      .from('batches')
      .select('id, name, category, class_name, section')
      .eq('school_id', scopedSchoolId)
      .ilike('name', normalizedName)
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return data || null;
  }

  private mapSupabaseRoomToLegacy(room: any): Room {
    return {
      id: room.id,
      name: room.name,
      length_feet: Number(room.length_feet ?? 0),
      width_feet: Number(room.width_feet ?? 0),
      desk_length_feet: Number(room.desk_length_feet ?? 0),
      desk_width_feet: Number(room.desk_width_feet ?? 0),
      num_benches: Number(room.num_benches ?? 0),
      capacity: Number(room.exam_capacity ?? room.capacity ?? 0),
      teaching_zone_clearance_feet: Number(room.teaching_zone_clearance_feet ?? 0),
      aisle_width_feet: Number(room.aisle_width_feet ?? 0),
      door_location: (room.door_location || 'left') as Room['door_location'],
      window_location: room.window_location || undefined,
      glare_mitigation: Boolean(room.metadata?.glare_mitigation ?? false),
      is_accessible: Boolean(room.is_accessible),
      is_active: Boolean(room.is_active),
    };
  }

  private mapSupabaseBatchToLegacy(batch: any, studentCount?: number): Batch {
    return {
      id: batch.id,
      name: batch.name,
      category: batch.category,
      syllabus: batch.syllabus || undefined,
      stream: batch.stream || undefined,
      display_order: Number(batch.display_order ?? 0),
      school_id: batch.school_id,
      is_active: Boolean(batch.is_active),
      created_at: batch.created_at,
      updated_at: batch.updated_at,
      student_count: typeof studentCount === 'number' ? studentCount : undefined,
    };
  }

  private mapSupabaseExamToLegacy(exam: any, totalStudents: number, totalBatches: number): Exam {
    return {
      id: typeof exam?.id === 'string' ? exam.id : Number(exam?.id || 0),
      name: exam.name || '',
      school_id: exam.school_id || 1,
      subject: exam.metadata?.subject_text || undefined,
      exam_date: exam.exam_date || undefined,
      duration_minutes: exam.duration_minutes || undefined,
      total_students: totalStudents,
      total_batches: totalBatches,
      is_active: Boolean(exam.is_active),
    } as Exam;
  }

  private mapAnyExamToLegacy(exam: any, totalStudents: number, totalBatches: number): Exam {
    const looksLikeSupabaseExam =
      typeof exam?.id === 'string' ||
      Object.prototype.hasOwnProperty.call(exam || {}, 'exam_code') ||
      Object.prototype.hasOwnProperty.call(exam || {}, 'metadata');

    if (looksLikeSupabaseExam) {
      return this.mapSupabaseExamToLegacy(exam, totalStudents, totalBatches);
    }

    return {
      id: Number(exam?.id || 0),
      name: String(exam?.name || ''),
      school_id: Number(exam?.school_id || 1),
      subject: exam?.subject || undefined,
      exam_date: exam?.exam_date || undefined,
      duration_minutes: exam?.duration_minutes || undefined,
      total_students: Number(exam?.total_students ?? totalStudents ?? 0),
      total_batches: Number(exam?.total_batches ?? totalBatches ?? 0),
      is_active: Boolean(exam?.is_active ?? true),
    } as Exam;
  }

  private mapTimetableEntryToClient(entry: any): TimetableEntry {
    return {
      ...entry,
      id: typeof entry?.id === 'string' ? this.getLegacyTimetableEntryId(entry.id) : Number(entry?.id || 0),
      teacher_id:
        typeof entry?.teacher_id === 'string'
          ? this.getLegacyMappedId('teacher', entry.teacher_id)
          : entry?.teacher_id ?? undefined,
      room_id: entry?.room_id ?? undefined,
      school_id: entry?.school_id ?? 1,
    } as TimetableEntry;
  }

  private mapTimetableViewToClient(entry: any): TimetableView {
    return {
      ...entry,
      id: typeof entry?.id === 'string' ? this.getLegacyTimetableEntryId(entry.id) : Number(entry?.id || 0),
      teacher_id:
        typeof entry?.teacher_id === 'string'
          ? this.getLegacyMappedId('teacher', entry.teacher_id)
          : entry?.teacher_id ?? undefined,
      room_id: entry?.room_id ?? undefined,
    } as TimetableView;
  }

  private mapSupabaseStudentToLegacy(student: any): Student {
    const activeRequest = Array.isArray(student.hostel_requests)
      ? student.hostel_requests.find((item: any) => item.is_active !== false)
      : null;
    const activeAllocation = Array.isArray(student.hostel_allocations)
      ? student.hostel_allocations.find(
          (item: any) => item.is_active !== false && ['active', 'moved'].includes(String(item.allocation_status || ''))
        ) || student.hostel_allocations[0]
      : null;
    const metadata = student.metadata || {};

    return {
      id: this.getLegacyMappedId('student', student.id),
      roll_number: student.roll_number || '',
      name: student.full_name || '',
      photoDataUrl: metadata.photo_url || metadata.photo_data_url || undefined,
      father_name: student.father_name || undefined,
      batch: student.batches?.name || metadata.managed_batch || '',
      class_name: student.class_name || undefined,
      section: student.section || undefined,
      academic_session: student.academic_session || undefined,
      email: student.email || undefined,
      phone: student.phone || undefined,
      reference_name: metadata.reference_name || student.guardian_name || undefined,
      reference_number: metadata.reference_number || student.guardian_phone || undefined,
      reference_remark: metadata.reference_remark || undefined,
      special_needs: student.special_needs || undefined,
      requires_near_exit: Boolean(student.requires_near_exit),
      requires_extra_time: Boolean(student.requires_extra_time),
      boarding_type: student.boarding_type || undefined,
      hostel_required: Boolean(student.hostel_required),
      preferred_hostel_id: metadata.preferred_hostel_id || activeRequest?.hostel_id || undefined,
      hostel_request_status: activeRequest?.status || undefined,
      assigned_hostel_id: activeAllocation?.hostel_id || undefined,
      assigned_hostel_name: activeAllocation?.hostels?.name || undefined,
      assigned_room_id: activeAllocation?.hostel_room_id || undefined,
      assigned_room_number: activeAllocation?.hostel_rooms?.room_number || undefined,
      assigned_bed_label: activeAllocation?.bed_label || undefined,
      hostel_notes: metadata.hostel_notes || activeAllocation?.notes || undefined,
      is_active: Boolean(student.is_active),
      admission_no: student.admission_no || undefined,
      mother_name: student.mother_name || undefined,
      guardian_name: student.guardian_name || undefined,
      guardian_phone: student.guardian_phone || undefined,
      gender: student.gender || undefined,
      date_of_birth: student.date_of_birth || undefined,
      metadata,
    } as Student;
  }

  private mapSupabaseTeacherToLegacy(staffMember: any): Teacher {
    return {
      id: this.getLegacyMappedId('teacher', staffMember.id),
      name: staffMember.full_name || '',
      photoDataUrl: staffMember.metadata?.photo_url || staffMember.metadata?.photo_data_url || undefined,
      subject: staffMember.metadata?.subject || staffMember.department || '',
      school_id: 1,
      email: staffMember.email || undefined,
      phone: staffMember.phone || undefined,
      employee_code: staffMember.employee_code || undefined,
      department: staffMember.department || undefined,
      designation: staffMember.designation || undefined,
      joining_date: staffMember.metadata?.joining_date || undefined,
      shift_timing: staffMember.metadata?.shift_timing || undefined,
      metadata: staffMember.metadata || undefined,
      is_active: Boolean(staffMember.is_active),
      created_at: staffMember.created_at,
      updated_at: staffMember.updated_at,
    } as Teacher;
  }

  private mapSupabaseInvigilatorToLegacy(staffMember: any): Invigilator {
    return {
      id: this.getLegacyMappedId('invigilator', staffMember.id),
      staff_id: staffMember.employee_code || '',
      name: staffMember.full_name || '',
      photoDataUrl: staffMember.metadata?.photo_url || staffMember.metadata?.photo_data_url || undefined,
      school_id: 1,
      email: staffMember.email || undefined,
      phone: staffMember.phone || undefined,
      department: staffMember.department || undefined,
      designation: staffMember.designation || undefined,
      joining_date: staffMember.metadata?.joining_date || undefined,
      shift_timing: staffMember.metadata?.shift_timing || undefined,
      metadata: staffMember.metadata || undefined,
      is_active: Boolean(staffMember.is_active),
      created_at: staffMember.created_at,
      updated_at: staffMember.updated_at,
    } as Invigilator;
  }

  private mapSupabaseHostelToLegacy(hostel: any, rooms: any[] = []): Hostel {
    const normalizedRooms: HostelRoom[] = rooms.map((room) => ({
      id: room.id,
      hostel_id: room.hostel_id,
      room_number: room.room_number,
      total_beds: Number(room.total_beds ?? 0),
      occupied_beds: Number(room.occupied_beds ?? 0),
      available_beds: Math.max(Number(room.total_beds ?? 0) - Number(room.occupied_beds ?? 0), 0),
      is_active: Boolean(room.is_active),
    }));

    const totalCapacity = normalizedRooms.reduce((sum, room) => sum + room.total_beds, 0);
    const occupiedBeds = normalizedRooms.reduce((sum, room) => sum + room.occupied_beds, 0);

    return {
      id: hostel.id,
      name: hostel.name,
      hostel_head: hostel.hostel_head || undefined,
      warden_name: hostel.warden_name || undefined,
      gender_category: hostel.gender_category || undefined,
      address: hostel.address || undefined,
      is_active: Boolean(hostel.is_active),
      total_rooms: normalizedRooms.length,
      total_capacity: totalCapacity,
      occupied_beds: occupiedBeds,
      available_beds: Math.max(totalCapacity - occupiedBeds, 0),
      rooms: normalizedRooms,
    };
  }

  private async listSupabaseHostels(schoolId?: string) {
    const scopedSchoolId = schoolId || await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) {
      return [];
    }

    const { data: hostels, error: hostelsError } = await supabase
      .schema('hostel')
      .from('hostels')
      .select('id, school_id, hostel_code, name, hostel_head, warden_name, gender_category, address, is_active')
      .eq('school_id', scopedSchoolId)
      .order('name', { ascending: true });

    if (hostelsError) {
      this.logSupabaseQueryError('listSupabaseHostels.hostels', hostelsError, { schoolId: scopedSchoolId });
      if (hostelsError.code === '42501' || hostelsError.code === 'PGRST106') {
        return [];
      }
      throw hostelsError;
    }

    const { data: rooms, error: roomsError } = await supabase
      .schema('hostel')
      .from('hostel_rooms')
      .select('id, hostel_id, room_number, total_beds, occupied_beds, is_active')
      .eq('school_id', scopedSchoolId)
      .order('room_number', { ascending: true });

    if (roomsError) {
      this.logSupabaseQueryError('listSupabaseHostels.hostel_rooms', roomsError, { schoolId: scopedSchoolId });
      if (roomsError.code === '42501' || roomsError.code === 'PGRST106') {
        return (hostels || []).map((item: any) => this.mapSupabaseHostelToLegacy(item, []));
      }
      throw roomsError;
    }

    const roomsByHostelId = new Map<string, any[]>();
    for (const room of rooms || []) {
      const key = String(room.hostel_id);
      const existing = roomsByHostelId.get(key) || [];
      existing.push(room);
      roomsByHostelId.set(key, existing);
    }

    return (hostels || []).map((item: any) =>
      this.mapSupabaseHostelToLegacy(item, roomsByHostelId.get(String(item.id)) || [])
    );
  }

  private async getSupabaseBatchStudentCounts(schoolId: string) {
    const { data, error } = await supabase
      .from('students')
      .select('batch_id, class_name, is_active')
      .eq('school_id', schoolId)
      .eq('is_active', true);

    if (error) {
      throw error;
    }

    const batchCounts = new Map<string, number>();
    const classCounts = new Map<string, number>();

    for (const student of data || []) {
      if (student.batch_id) {
        const key = String(student.batch_id);
        batchCounts.set(key, (batchCounts.get(key) || 0) + 1);
      }

      if (student.class_name) {
        const key = String(student.class_name).trim().toLowerCase();
        if (key) {
          classCounts.set(key, (classCounts.get(key) || 0) + 1);
        }
      }
    }

    return { batchCounts, classCounts };
  }

  private slugifyInventoryValue(value?: string | null) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24);
  }

  private createInventoryCode(prefix: string, name?: string | null) {
    const slug = this.slugifyInventoryValue(name) || prefix.toLowerCase();
    const random =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID().slice(0, 8)
        : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    return `${prefix}-${slug}-${random}`.slice(0, 60);
  }

  private normalizeInventoryUnitType(value?: string | null) {
    const normalized = String(value || 'book').trim().toLowerCase();
    if (normalized === 'book') return { dbValue: 'book', uiValue: 'book' };
    if (normalized === 'set') return { dbValue: 'set', uiValue: 'set' };
    if (normalized === 'copy' || normalized === 'notebook') {
      return { dbValue: 'copy', uiValue: 'notebook' };
    }
    return { dbValue: 'unit', uiValue: normalized as MaterialItem['unit_type'] };
  }

  private deriveInventoryVolumeNumber(category: any) {
    const metadataNumber = category?.metadata?.volume_number;
    if (metadataNumber !== undefined && metadataNumber !== null && metadataNumber !== '') {
      return String(metadataNumber);
    }

    const categoryCode = String(category?.category_code || '');
    const categoryCodeMatch = categoryCode.match(/(?:vol|volume)[-_]?(\d+)/i);
    if (categoryCodeMatch?.[1]) {
      return categoryCodeMatch[1];
    }

    const name = String(category?.name || '');
    const nameMatch = name.match(/(\d+)/);
    if (nameMatch?.[1]) {
      return nameMatch[1];
    }

    return '';
  }

  private getInventoryCategoryAncestors(categoryId: string | null | undefined, categoriesById: Map<string, any>) {
    const lineage: any[] = [];
    let currentId = categoryId ? String(categoryId) : null;
    while (currentId) {
      const current = categoriesById.get(currentId);
      if (!current) break;
      lineage.unshift(current);
      currentId = current.parent_category_id ? String(current.parent_category_id) : null;
    }
    return lineage;
  }

  private parseInventoryBatchNames(item: any) {
    const metadataBatchNames = item?.metadata?.batch_names;
    if (Array.isArray(metadataBatchNames)) {
      return metadataBatchNames
        .map((entry: unknown) => String(entry || '').trim())
        .filter(Boolean);
    }

    if (typeof item?.class_name === 'string' && item.class_name.trim()) {
      return item.class_name
        .split(',')
        .map((entry: string) => entry.trim())
        .filter(Boolean);
    }

    return [];
  }

  private mapInventorySupplierToLegacy(supplier: any): Supplier {
    return {
      id: this.getLegacyInventoryId(this.supplierIdMap, this.supplierReverseIdMap, 'inventory-supplier', supplier.id),
      name: supplier.name || '',
      contact_person: supplier.contact_person || undefined,
      phone: supplier.phone || undefined,
      email: supplier.email || undefined,
      address: supplier.address || undefined,
      is_active: Boolean(supplier.is_active),
      created_at: supplier.created_at,
      updated_at: supplier.updated_at,
    };
  }

  private mapInventorySubjectToLegacy(subject: any): InventorySubject {
    return {
      id: this.getLegacyInventoryId(
        this.inventorySubjectIdMap,
        this.inventorySubjectReverseIdMap,
        'inventory-subject',
        subject.id,
      ),
      name: subject.name || '',
      is_active: Boolean(subject.is_active),
    };
  }

  private mapInventorySetToLegacy(inventorySet: any): InventorySet {
    return {
      id: this.getLegacyInventoryId(this.inventorySetIdMap, this.inventorySetReverseIdMap, 'inventory-set', inventorySet.id),
      subject_id: this.getLegacyInventoryId(
        this.inventorySubjectIdMap,
        this.inventorySubjectReverseIdMap,
        'inventory-subject',
        inventorySet.parent_category_id,
      ),
      name: inventorySet.name || '',
      is_active: Boolean(inventorySet.is_active),
    };
  }

  private mapInventoryVolumeToLegacy(volume: any, categoriesById: Map<string, any>): InventoryVolume {
    const inventorySet = volume.parent_category_id ? categoriesById.get(String(volume.parent_category_id)) : null;
    const subject = inventorySet?.parent_category_id
      ? categoriesById.get(String(inventorySet.parent_category_id))
      : null;

    return {
      id: this.getLegacyInventoryId(
        this.inventoryVolumeIdMap,
        this.inventoryVolumeReverseIdMap,
        'inventory-volume',
        volume.id,
      ),
      subject_id: this.getLegacyInventoryId(
        this.inventorySubjectIdMap,
        this.inventorySubjectReverseIdMap,
        'inventory-subject',
        subject?.id,
      ),
      set_id: this.getLegacyInventoryId(
        this.inventorySetIdMap,
        this.inventorySetReverseIdMap,
        'inventory-set',
        inventorySet?.id,
      ),
      volume_number: this.deriveInventoryVolumeNumber(volume),
      name: volume.name || '',
      is_active: Boolean(volume.is_active),
    };
  }

  private mapInventoryMaterialToLegacy(material: any, categoriesById: Map<string, any>): MaterialItem {
    const metadata = material.metadata || {};
    const lineage = this.getInventoryCategoryAncestors(material.category_id, categoriesById);
    const subjectCategory =
      (metadata.subject_category_id && categoriesById.get(String(metadata.subject_category_id))) ||
      lineage[0] ||
      null;
    const setCategory =
      (metadata.set_category_id && categoriesById.get(String(metadata.set_category_id))) ||
      (lineage.length >= 2 ? lineage[1] : null) ||
      null;
    const volumeCategory =
      (metadata.volume_category_id && categoriesById.get(String(metadata.volume_category_id))) ||
      (lineage.length >= 3 ? lineage[2] : null) ||
      null;
    const normalizedUnitType = this.normalizeInventoryUnitType(metadata.original_unit_type || material.unit_type);

    return {
      id: this.getLegacyInventoryId(this.materialIdMap, this.materialReverseIdMap, 'inventory-material', material.id),
      name: material.name || '',
      subject_id: this.getLegacyInventoryId(
        this.inventorySubjectIdMap,
        this.inventorySubjectReverseIdMap,
        'inventory-subject',
        subjectCategory?.id,
      ),
      set_id: this.getLegacyInventoryId(
        this.inventorySetIdMap,
        this.inventorySetReverseIdMap,
        'inventory-set',
        setCategory?.id,
      ),
      volume_id: this.getLegacyInventoryId(
        this.inventoryVolumeIdMap,
        this.inventoryVolumeReverseIdMap,
        'inventory-volume',
        volumeCategory?.id,
      ),
      subject: subjectCategory?.name || undefined,
      set_name: setCategory?.name || undefined,
      volume_name: volumeCategory?.name || undefined,
      volume_number: volumeCategory ? this.deriveInventoryVolumeNumber(volumeCategory) : undefined,
      batch_names: this.parseInventoryBatchNames(material),
      description: material.description || undefined,
      unit_type: normalizedUnitType.uiValue as MaterialItem['unit_type'],
      current_stock: Number(material.current_stock ?? 0),
      low_stock_threshold: Number(material.low_stock_threshold ?? 0),
      is_active: Boolean(material.is_active),
      created_at: material.created_at,
      updated_at: material.updated_at,
    };
  }

  private mapStockInEntryToLegacy(entry: any, materialsById: Map<string, any>, suppliersById: Map<string, any>): StockInEntry {
    const material = entry.material_item_id ? materialsById.get(String(entry.material_item_id)) : null;
    const supplier = entry.supplier_id ? suppliersById.get(String(entry.supplier_id)) : null;
    return {
      id: this.getLegacyInventoryId(this.stockInIdMap, this.stockInReverseIdMap, 'inventory-stock-in', entry.id),
      date: entry.entry_date || entry.created_at || undefined,
      supplier_id: this.getLegacyInventoryId(this.supplierIdMap, this.supplierReverseIdMap, 'inventory-supplier', supplier?.id),
      supplier_name: supplier?.name || undefined,
      material_id: this.getLegacyInventoryId(this.materialIdMap, this.materialReverseIdMap, 'inventory-material', material?.id),
      material_name: material?.name || undefined,
      quantity_received: Number(entry.quantity_received ?? 0),
      entry_type: entry.entry_type || 'purchase',
      added_by: entry.notes?.added_by || undefined,
      notes: entry.notes || undefined,
      created_at: entry.created_at,
    };
  }

  private mapStockOutEntryToLegacy(entry: any, materialsById: Map<string, any>, batchesById: Map<string, any>): StockOutEntry {
    const material = entry.material_item_id ? materialsById.get(String(entry.material_item_id)) : null;
    const batch = entry.batch_id ? batchesById.get(String(entry.batch_id)) : null;
    return {
      id: this.getLegacyInventoryId(this.stockOutIdMap, this.stockOutReverseIdMap, 'inventory-stock-out', entry.id),
      date: entry.entry_date || entry.created_at || undefined,
      batch_id: batch?.id,
      batch_name: batch?.name || undefined,
      material_id: this.getLegacyInventoryId(this.materialIdMap, this.materialReverseIdMap, 'inventory-material', material?.id),
      material_name: material?.name || undefined,
      quantity_issued: Number(entry.quantity_issued ?? 0),
      issued_by: entry.remarks?.issued_by || undefined,
      remarks: entry.remarks || undefined,
      created_at: entry.created_at,
    };
  }

  private mapStudentIssueEntryToLegacy(
    entry: any,
    materialsById: Map<string, any>,
    batchesById: Map<string, any>,
    studentsById: Map<string, any>,
  ): StudentIssueEntry {
    const material = entry.material_item_id ? materialsById.get(String(entry.material_item_id)) : null;
    const batch = entry.batch_id ? batchesById.get(String(entry.batch_id)) : null;
    const student = entry.student_id ? studentsById.get(String(entry.student_id)) : null;
    return {
      id: this.getLegacyInventoryId(
        this.studentIssueIdMap,
        this.studentIssueReverseIdMap,
        'inventory-student-issue',
        entry.id,
      ),
      date: entry.issue_date || entry.created_at || undefined,
      batch_id: batch?.id,
      batch_name: batch?.name || undefined,
      student_id: this.getLegacyMappedId('student', student?.id),
      student_name: student?.full_name || '',
      material_id: this.getLegacyInventoryId(this.materialIdMap, this.materialReverseIdMap, 'inventory-material', material?.id),
      material_name: material?.name || undefined,
      quantity_issued: Number(entry.quantity_issued ?? 0),
      issued_by: entry.remarks?.issued_by || undefined,
      remarks: entry.remarks || undefined,
      created_at: entry.created_at,
    };
  }

  private async fetchInventoryCategories(schoolId: string, includeInactive: boolean = true) {
    let query = supabase
      .schema('inventory')
      .from('material_categories')
      .select('id, school_id, category_code, name, parent_category_id, is_active, created_at, updated_at')
      .eq('school_id', schoolId)
      .order('name', { ascending: true });

    if (!includeInactive) {
      query = query.eq('is_active', true);
    }

    const { data, error } = await query;
    if (error) {
      this.logSupabaseQueryError('fetchInventoryCategories', error, { schoolId });
      throw error;
    }
    return data || [];
  }

  private async recalculateInventoryStocks(schoolId: string, materialIds?: string[]) {
    const uniqueMaterialIds = Array.from(new Set((materialIds || []).filter(Boolean)));
    if (!uniqueMaterialIds.length) {
      return;
    }

    const stockInQuery = supabase
      .schema('inventory')
      .from('stock_in_entries')
      .select('material_item_id, quantity_received')
      .eq('school_id', schoolId)
      .in('material_item_id', uniqueMaterialIds);
    const stockOutQuery = supabase
      .schema('inventory')
      .from('stock_out_entries')
      .select('material_item_id, quantity_issued')
      .eq('school_id', schoolId)
      .in('material_item_id', uniqueMaterialIds);
    const studentIssueQuery = supabase
      .schema('inventory')
      .from('student_issue_entries')
      .select('material_item_id, quantity_issued')
      .eq('school_id', schoolId)
      .in('material_item_id', uniqueMaterialIds);

    const [{ data: stockInRows, error: stockInError }, { data: stockOutRows, error: stockOutError }, { data: issueRows, error: issueError }] =
      await Promise.all([stockInQuery, stockOutQuery, studentIssueQuery]);

    if (stockInError) throw stockInError;
    if (stockOutError) throw stockOutError;
    if (issueError) throw issueError;

    const totals = new Map<string, number>();
    for (const materialId of uniqueMaterialIds) {
      totals.set(materialId, 0);
    }

    for (const row of stockInRows || []) {
      const key = String(row.material_item_id);
      totals.set(key, (totals.get(key) || 0) + Number(row.quantity_received ?? 0));
    }
    for (const row of stockOutRows || []) {
      const key = String(row.material_item_id);
      totals.set(key, (totals.get(key) || 0) - Number(row.quantity_issued ?? 0));
    }
    for (const row of issueRows || []) {
      const key = String(row.material_item_id);
      totals.set(key, (totals.get(key) || 0) - Number(row.quantity_issued ?? 0));
    }

    for (const [materialId, currentStock] of totals.entries()) {
      const { error } = await supabase
        .schema('inventory')
        .from('material_items')
        .update({ current_stock: Math.max(currentStock, 0) })
        .eq('id', materialId)
        .eq('school_id', schoolId);
      if (error) {
        this.logSupabaseQueryError('recalculateInventoryStocks.update', error, { schoolId, materialId });
        throw error;
      }
    }
  }

  private async listSupabaseBatches(category?: string, includeInactive: boolean = true, schoolId?: string) {
    const scopedSchoolId = schoolId || await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) {
      return [];
    }

    let query = supabase
      .from('batches')
      .select('*')
      .eq('school_id', scopedSchoolId)
      .order('display_order', { ascending: true })
      .order('name', { ascending: true });

    if (!includeInactive) {
      query = query.eq('is_active', true);
    }

    if (category) {
      query = query.eq('category', category);
    }

    const [{ data, error }, counts] = await Promise.all([
      query,
      this.getSupabaseBatchStudentCounts(scopedSchoolId),
    ]);

    if (error) {
      throw error;
    }

    return (data || []).map((batch: any) =>
      this.mapSupabaseBatchToLegacy(
        batch,
        batch.category === 'class'
          ? counts.classCounts.get(String(batch.name || '').trim().toLowerCase()) || 0
          : counts.batchCounts.get(String(batch.id)) || 0
      )
    );
  }

  private async getLatestSessionAccessToken() {
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error || !data.session?.access_token) {
        return null;
      }

      useAuthStore.getState().hydrate({
        token: data.session.access_token,
        refreshToken: data.session.refresh_token,
        user: useAuthStore.getState().user,
      });

      return data.session.access_token;
    } catch {
      return null;
    }
  }

  private isDatetimeValidationError(error: any) {
    const status = error?.response?.status;
    if (status !== 422) return false;
    const detail = error?.response?.data?.detail;
    const text = typeof detail === 'string' ? detail : JSON.stringify(detail || '');
    return text.toLowerCase().includes('valid datetime');
  }

  private toDateTimeString(value?: string, endOfDay: boolean = false) {
    if (!value || typeof value !== 'string') return value;
    if (value.includes('T') || value.includes(' ')) return value;
    return `${value}${endOfDay ? 'T23:59:59' : 'T00:00:00'}`;
  }

  constructor() {
    this.api = axios.create({
      baseURL: getApiBaseUrl(),
      timeout: API_TIMEOUT_MS,
    });

    // Ensure multipart uploads do not send a JSON content type header.
    this.api.interceptors.request.use(async (config) => {
      if (config.data instanceof FormData) {
        if (config.headers) {
          delete config.headers['Content-Type'];
          delete config.headers['content-type'];
        }
      }

      const token = this.getAccessToken();
      const currentUser = useAuthStore.getState().user || getPersistedUser();
      config.headers = (config.headers || {}) as any;

      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }

      if (currentUser?.role) {
        config.headers['X-User-Role'] = currentUser.role;
      }

      if (currentUser?.full_name || currentUser?.username || currentUser?.email) {
        config.headers['X-User-Name'] =
          currentUser.full_name || currentUser.username || currentUser.email || 'Authenticated User';
      }

      if (currentUser?.email) {
        config.headers['X-User-Email'] = currentUser.email;
      }

      if (Array.isArray(currentUser?.permissions) && currentUser.permissions.length > 0) {
        config.headers['X-User-Permissions'] = currentUser.permissions.join(',');
      }
      return config;
    });

    // Retry initial GET requests when the backend is still starting up.
    this.api.interceptors.response.use(
      (response) => response,
      async (error) => {
        const config = error.config as
          | (typeof error.config & {
              __retryCount?: number;
              __directFallbackIndex?: number;
              __usingDirectFallback?: boolean;
              __retryAfterRefresh?: boolean;
            })
          | undefined;
        if (error?.response?.status === 401) {
          if (!config || this.isRefreshExcluded(config.url)) {
            return Promise.reject(error);
          }

          if (config.__retryAfterRefresh) {
            return Promise.reject(error);
          }

          const currentToken = this.getAccessToken();
          const latestToken = await this.getLatestSessionAccessToken();
          if (!latestToken || latestToken === currentToken) {
            return Promise.reject(error);
          }

          config.__retryAfterRefresh = true;
          config.headers = config.headers || {};
          config.headers.Authorization = `Bearer ${latestToken}`;
          return this.api.request(config);
        }

        const method = config?.method?.toLowerCase();
        const status = error.response?.status;
        const isNetworkError = !error.response;
        const isRetryableRequest = method === 'get';
        const shouldRetry =
          isRetryableRequest &&
          (isNetworkError || RETRYABLE_STATUS_CODES.has(status));
        const shouldTryDirectFallback =
          (isNetworkError || RETRYABLE_STATUS_CODES.has(status)) &&
          isLocalDevelopmentHost() &&
          Boolean(import.meta.env.DEV);

        if (!config) {
          return Promise.reject(error);
        }

        if (!shouldRetry) {
          return Promise.reject(error);
        }

        config.__retryCount = config.__retryCount || 0;
        if (config.__retryCount >= MAX_GET_RETRIES - 1) {
          return Promise.reject(error);
        }

        config.__retryCount += 1;
        await delay(500 * config.__retryCount);
        try {
          return await this.api.request(config);
        } catch (retryError: any) {
          const retryStatus = retryError?.response?.status;
          const retryNetworkError = !retryError?.response;
          const shouldRetryFallback =
            (retryNetworkError || RETRYABLE_STATUS_CODES.has(retryStatus)) &&
            isLocalDevelopmentHost() &&
            Boolean(import.meta.env.DEV) &&
            shouldTryDirectFallback;

          if (!shouldRetryFallback) {
            return Promise.reject(retryError);
          }
          return Promise.reject(retryError);
        }
      }
    );

    // Remove token requirement for requests
    // this.api.interceptors.request.use((config) => {
    //   const token = localStorage.getItem('auth_token');
    //   if (token) {
    //     config.headers.Authorization = `Bearer ${token}`;
    //   }
    //   return config;
    // });
  }

  // ==================== Authentication ====================

  async sendOTP(email: string) {
    return this.api.post('/auth/send-otp', { email });
  }

  async verifyOTP(credentials: OTPLoginCredentials) {
    return this.api.post<AuthResponse>('/auth/verify-otp', credentials);
  }

  async loginWithPassword(credentials: LoginCredentials) {
    try {
      return await this.api.post<AuthResponse>('/auth/login-password', credentials);
    } catch (error: any) {
      const status = error?.response?.status;
      if (
        status === 404 &&
        isLocalDevelopmentHost() &&
        Boolean(import.meta.env.DEV)
      ) {
        throw new Error('Login endpoint not available. Restart backend and try again.');
      }
      throw error;
    }
  }

  async refreshSession(refreshToken: string) {
    return this.api.post<AuthResponse>('/auth/refresh', { refresh_token: refreshToken });
  }

  async logout() {
    try {
      await supabase.auth.signOut();
      return { data: { success: true } };
    } finally {
      this.clearClientAuth(false);
    }
  }

  async listRoleUsers() {
    return this.api.get<RolePowerUser[]>('/auth/users');
  }

  async createRoleUser(data: {
    username: string;
    password: string;
    full_name: string;
    role: 'admin' | 'store_manager' | 'teacher' | 'viewer';
    user_type: 'teaching' | 'non_teaching';
    permissions: string[];
    email?: string;
  }) {
    return this.api.post<RolePowerUser>('/auth/users', data);
  }

  async updateRoleUser(
    userId: number,
    data: {
      full_name?: string;
      role?: 'admin' | 'store_manager' | 'teacher' | 'viewer';
      user_type?: 'teaching' | 'non_teaching';
      permissions?: string[];
      password?: string;
      is_active?: boolean;
    }
  ) {
    return this.api.put<RolePowerUser>(`/auth/users/${userId}`, data);
  }

  async deleteRoleUser(userId: number) {
    return this.api.delete(`/auth/users/${userId}`);
  }

  // ==================== Students ====================

  async importStudents(
    formData: FormData,
    schoolId?: number | string,
    onUploadProgress?: (progressEvent: AxiosProgressEvent) => void,
  ) {
    const scopedSchoolId = typeof schoolId === 'string'
      ? schoolId
      : await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) throw new Error('No active school membership found.');

    return this.api.post('/students/import', formData, {
      params: { school_id: scopedSchoolId },
      onUploadProgress,
      timeout: LONG_RUNNING_IMPORT_TIMEOUT_MS,
    });
  }

  async createStudent(studentData: Partial<Student>, _schoolId: number = 1) {
    const scopedSchoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) throw new Error('No active school membership found.');

    const requestedBatchName = String((studentData as any).batch || '').trim();
    const matchedBatch = await this.findSupabaseBatchByName(requestedBatchName, scopedSchoolId);
    const persistedPhoto = await this.persistStudentPhoto(
      scopedSchoolId,
      String(studentData.roll_number || ''),
      (studentData as any).photoDataUrl,
      null,
    );
    const metadata = this.compactObject({
      ...(typeof (studentData as any).metadata === 'object' && (studentData as any).metadata ? (studentData as any).metadata : {}),
      managed_batch: requestedBatchName || undefined,
      reference_name: (studentData as any).reference_name || undefined,
      reference_number: (studentData as any).reference_number || undefined,
      reference_remark: (studentData as any).reference_remark || undefined,
      preferred_hostel_id: (studentData as any).preferred_hostel_id || undefined,
      hostel_notes: (studentData as any).hostel_notes || undefined,
      photo_url: persistedPhoto.photoUrl || undefined,
      photo_path: persistedPhoto.photoPath || undefined,
      photo_data_url: persistedPhoto.photoDataUrl || undefined,
    });

    const { data, error } = await supabase
      .from('students')
      .insert({
        school_id: scopedSchoolId,
        batch_id: matchedBatch?.id || null,
        admission_no: (studentData as any).admission_no || null,
        roll_number: studentData.roll_number,
        full_name: (studentData as any).name,
        father_name: studentData.father_name || null,
        mother_name: (studentData as any).mother_name || null,
        email: studentData.email || null,
        phone: studentData.phone || null,
        guardian_name: (studentData as any).guardian_name || (studentData as any).reference_name || null,
        guardian_phone: (studentData as any).guardian_phone || (studentData as any).reference_number || null,
        class_name: studentData.class_name || matchedBatch?.class_name || null,
        section: studentData.section || matchedBatch?.section || null,
        academic_session: (studentData as any).academic_session || null,
        date_of_birth: (studentData as any).date_of_birth || null,
        gender: (studentData as any).gender || null,
        special_needs: studentData.special_needs || null,
        requires_near_exit: Boolean(studentData.requires_near_exit),
        requires_extra_time: Boolean(studentData.requires_extra_time),
        boarding_type: (studentData as any).boarding_type || null,
        hostel_required: Boolean((studentData as any).hostel_required),
        metadata,
        is_active: studentData.is_active ?? true,
      })
      .select(`
        id,
        school_id,
        batch_id,
        admission_no,
        roll_number,
        full_name,
        father_name,
        mother_name,
        email,
        phone,
        guardian_name,
        guardian_phone,
        class_name,
        section,
        academic_session,
        date_of_birth,
        gender,
        special_needs,
        requires_near_exit,
        requires_extra_time,
        boarding_type,
        hostel_required,
        metadata,
        is_active,
        created_at,
        updated_at,
        batches(name)
      `)
      .single();

    if (error) throw error;
    return { data: this.mapSupabaseStudentToLegacy(data) } as { data: Student };
  }

  async downloadStudentTemplate() {
    return this.api.get('/students/template/download', {
      responseType: 'blob',
    });
  }

  async downloadSeatingTemplate() {
    return this.api.get('/seating/template/download', {
      responseType: 'blob',
    });
  }

  async listStudents(_schoolId: number = 1, skip = 0, limit = 10000, batch?: string) {
    const scopedSchoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) {
      return { data: [] } as { data: Student[] };
    }

    const { data, error } = await supabase
      .from('students')
      .select(`
        id,
        school_id,
        batch_id,
        admission_no,
        roll_number,
        full_name,
        father_name,
        mother_name,
        email,
        phone,
        guardian_name,
        guardian_phone,
        class_name,
        section,
        academic_session,
        date_of_birth,
        gender,
        special_needs,
        requires_near_exit,
        requires_extra_time,
        boarding_type,
        hostel_required,
        metadata,
        is_active,
        created_at,
        updated_at,
        batches(name)
      `)
      .eq('school_id', scopedSchoolId)
      .order('full_name', { ascending: true })
      .range(skip, Math.max(skip, skip + limit - 1));

    if (error) {
      this.logSupabaseQueryError('listStudents', error, { schoolId: scopedSchoolId, skip, limit, batch });
      throw error;
    }

    let students = (data || []).map((item: any) => this.mapSupabaseStudentToLegacy(item));
    if (batch) {
      const normalizedBatch = batch.trim().toLowerCase();
      students = students.filter((student) => String(student.batch || '').trim().toLowerCase() === normalizedBatch);
    }
    return { data: students } as { data: Student[] };
  }

  async getStudent(studentId: number) {
    const resolvedId = this.resolveMappedId('student', studentId);
    const { data, error } = await supabase
      .from('students')
      .select(`
        id,
        school_id,
        batch_id,
        admission_no,
        roll_number,
        full_name,
        father_name,
        mother_name,
        email,
        phone,
        guardian_name,
        guardian_phone,
        class_name,
        section,
        academic_session,
        date_of_birth,
        gender,
        special_needs,
        requires_near_exit,
        requires_extra_time,
        boarding_type,
        hostel_required,
        metadata,
        is_active,
        created_at,
        updated_at,
        batches(name)
      `)
      .eq('id', resolvedId)
      .single();

    if (error) {
      this.logSupabaseQueryError('getStudent', error, { studentId, resolvedId });
      throw error;
    }
    return { data: this.mapSupabaseStudentToLegacy(data) } as { data: Student };
  }

  async updateStudent(studentId: number, data: Partial<Student>) {
    const scopedSchoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) throw new Error('No active school membership found.');

    const resolvedId = this.resolveMappedId('student', studentId);
    const { data: existing, error: existingError } = await supabase
      .from('students')
      .select('metadata')
      .eq('id', resolvedId)
      .single();

    if (existingError) throw existingError;

    const requestedBatchName = String((data as any).batch || '').trim();
    const matchedBatch = requestedBatchName ? await this.findSupabaseBatchByName(requestedBatchName, scopedSchoolId) : null;
    const nextRollNumber = String(data.roll_number || '').trim() || String((data as any).rollNumber || '').trim() || '';
    const persistedPhoto = await this.persistStudentPhoto(
      scopedSchoolId,
      nextRollNumber || String(existing?.metadata?.managed_batch || 'student'),
      Object.prototype.hasOwnProperty.call(data, 'photoDataUrl') ? (data as any).photoDataUrl : existing?.metadata?.photo_url || existing?.metadata?.photo_data_url || null,
      existing?.metadata?.photo_path || null,
    );
    const metadata = this.compactObject({
      ...(existing?.metadata || {}),
      ...(typeof (data as any).metadata === 'object' && (data as any).metadata ? (data as any).metadata : {}),
      managed_batch: requestedBatchName || (existing?.metadata?.managed_batch as string | undefined),
      reference_name: (data as any).reference_name ?? existing?.metadata?.reference_name,
      reference_number: (data as any).reference_number ?? existing?.metadata?.reference_number,
      reference_remark: (data as any).reference_remark ?? existing?.metadata?.reference_remark,
      preferred_hostel_id: (data as any).preferred_hostel_id ?? existing?.metadata?.preferred_hostel_id,
      hostel_notes: (data as any).hostel_notes ?? existing?.metadata?.hostel_notes,
      photo_url: persistedPhoto.photoUrl || undefined,
      photo_path: persistedPhoto.photoPath || undefined,
      photo_data_url: persistedPhoto.photoDataUrl || undefined,
    });

    const payload = this.compactObject({
      batch_id: matchedBatch?.id,
      admission_no: (data as any).admission_no ?? undefined,
      roll_number: data.roll_number ?? undefined,
      full_name: (data as any).name ?? undefined,
      father_name: data.father_name ?? undefined,
      mother_name: (data as any).mother_name ?? undefined,
      email: data.email ?? undefined,
      phone: data.phone ?? undefined,
      guardian_name: (data as any).guardian_name ?? (data as any).reference_name ?? undefined,
      guardian_phone: (data as any).guardian_phone ?? (data as any).reference_number ?? undefined,
      class_name: data.class_name ?? matchedBatch?.class_name ?? undefined,
      section: data.section ?? matchedBatch?.section ?? undefined,
      academic_session: (data as any).academic_session ?? undefined,
      date_of_birth: (data as any).date_of_birth ?? undefined,
      gender: (data as any).gender ?? undefined,
      special_needs: data.special_needs ?? undefined,
      requires_near_exit: data.requires_near_exit,
      requires_extra_time: data.requires_extra_time,
      boarding_type: (data as any).boarding_type ?? undefined,
      hostel_required: (data as any).hostel_required,
      metadata,
      is_active: data.is_active,
    });

    const { data: updated, error } = await supabase
      .from('students')
      .update(payload)
      .eq('id', resolvedId)
      .select(`
        id,
        school_id,
        batch_id,
        admission_no,
        roll_number,
        full_name,
        father_name,
        mother_name,
        email,
        phone,
        guardian_name,
        guardian_phone,
        class_name,
        section,
        academic_session,
        date_of_birth,
        gender,
        special_needs,
        requires_near_exit,
        requires_extra_time,
        boarding_type,
        hostel_required,
        metadata,
        is_active,
        created_at,
        updated_at,
        batches(name)
      `)
      .single();

    if (error) throw error;
    return { data: this.mapSupabaseStudentToLegacy(updated) } as { data: Student };
  }

  async deleteStudent(studentId: number) {
    const resolvedId = this.resolveMappedId('student', studentId);
    const { data: existing, error: fetchError } = await supabase
      .from('students')
      .select('metadata')
      .eq('id', resolvedId)
      .maybeSingle();
    if (fetchError) throw fetchError;

    const { error } = await supabase.from('students').delete().eq('id', resolvedId);
    if (error) throw error;
    await this.removeStudentPhotoAsset(existing?.metadata?.photo_path || null);
    return { data: { message: 'Student deleted successfully' } } as { data: { message: string } };
  }

  async deleteAllStudents(isAdmin: boolean = false, _schoolId: number = 1) {
    const scopedSchoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) throw new Error('No active school membership found.');
    const { data: existingRows, error: existingError } = await supabase
      .from('students')
      .select('metadata')
      .eq('school_id', scopedSchoolId);
    if (existingError) throw existingError;
    const { error } = await supabase.from('students').delete().eq('school_id', scopedSchoolId);
    if (error) throw error;
    const photoPaths = (existingRows || [])
      .map((item: any) => item?.metadata?.photo_path)
      .filter(Boolean);
    if (photoPaths.length > 0) {
      const { error: removeError } = await supabase.storage.from(STUDENT_PHOTO_BUCKET).remove(photoPaths);
      if (removeError) {
        console.warn('[Supabase] bulk student photo cleanup failed', { message: removeError.message });
      }
    }
    return { data: { success: true, is_admin: isAdmin } } as { data: { success: boolean; is_admin: boolean } };
  }

  async transferStudentsToBatch(
    data: {
      target_batch: string;
      student_ids?: number[];
      source_batch?: string;
      transfer_all_from_batch?: boolean;
    },
    _schoolId: number = 1
  ) {
    const scopedSchoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) throw new Error('No active school membership found.');

    const targetBatch = await this.findSupabaseBatchByName(data.target_batch, scopedSchoolId);
    if (!targetBatch) {
      throw new Error('Target batch not found');
    }

    let query = supabase.from('students').select('id, metadata').eq('school_id', scopedSchoolId);
    if (Array.isArray(data.student_ids) && data.student_ids.length > 0) {
      query = query.in('id', data.student_ids.map((id) => this.resolveMappedId('student', id)));
    }

    const { data: candidates, error } = await query;
    if (error) throw error;

    const matchingStudents = (candidates || []).filter((item: any) => {
      if (!data.source_batch) return true;
      return String(item.metadata?.managed_batch || '').trim().toLowerCase() === data.source_batch.trim().toLowerCase();
    });

    if (!matchingStudents.length) {
      return {
        data: {
          transferred_count: 0,
          source_batch: data.source_batch,
          target_batch: data.target_batch,
          message: 'No matching students found',
        },
      } as { data: StudentBatchTransferResponse };
    }

    const studentIds = matchingStudents.map((item: any) => item.id);
    const { error: updateError } = await supabase
      .from('students')
      .update({
        batch_id: targetBatch.id,
        class_name: targetBatch.class_name || null,
        section: targetBatch.section || null,
      })
      .in('id', studentIds);

    if (updateError) throw updateError;

    for (const student of matchingStudents) {
      await supabase
        .from('students')
        .update({
          metadata: {
            ...(student.metadata || {}),
            managed_batch: targetBatch.name,
          },
        })
        .eq('id', student.id);
    }

    return {
      data: {
        transferred_count: studentIds.length,
        source_batch: data.source_batch,
        target_batch: targetBatch.name,
        message: `Transferred ${studentIds.length} student(s)`,
      },
    } as { data: StudentBatchTransferResponse };
  }

  async listHostels(_schoolId: number = 1) {
    const data = await this.listSupabaseHostels();
    return { data } as { data: Hostel[] };
  }

  async createHostel(
    data: {
      name: string;
      hostel_head?: string;
      warden_name?: string;
      gender_category?: string;
      address?: string;
      is_active?: boolean;
      total_rooms?: number;
      rooms?: Array<{ room_number: string; total_beds: number }>;
    },
    _schoolId: number = 1
  ) {
    const scopedSchoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) throw new Error('No active school membership found.');

    const hostelCode =
      data.name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 24) || `HOSTEL_${Date.now()}`;

    const { data: createdHostel, error } = await supabase
      .schema('hostel')
      .from('hostels')
      .insert({
        school_id: scopedSchoolId,
        hostel_code: hostelCode,
        name: data.name,
        hostel_head: data.hostel_head || null,
        warden_name: data.warden_name || null,
        gender_category: data.gender_category || null,
        address: data.address || null,
        is_active: data.is_active ?? true,
      })
      .select()
      .single();

    if (error) {
      this.logSupabaseQueryError('createHostel.hostels', error, { schoolId: scopedSchoolId, hostelCode });
      throw error;
    }

    if (Array.isArray(data.rooms) && data.rooms.length > 0) {
      const { error: roomError } = await supabase.schema('hostel').from('hostel_rooms').insert(
        data.rooms.map((room) => ({
          school_id: scopedSchoolId,
          hostel_id: createdHostel.id,
          room_number: room.room_number,
          total_beds: room.total_beds,
          occupied_beds: 0,
          is_active: true,
        })),
      );
      if (roomError) {
        this.logSupabaseQueryError('createHostel.hostel_rooms', roomError, { schoolId: scopedSchoolId, hostelId: createdHostel.id });
        throw roomError;
      }
    }

    const hostels = await this.listSupabaseHostels(scopedSchoolId);
    return { data: hostels.find((item) => item.id === createdHostel.id) as Hostel } as { data: Hostel };
  }

  async updateHostel(hostelId: string | number, data: Partial<Hostel>, _schoolId: number = 1) {
    const { error } = await supabase
      .schema('hostel')
      .from('hostels')
      .update({
        name: data.name,
        hostel_head: data.hostel_head ?? null,
        warden_name: data.warden_name ?? null,
        gender_category: data.gender_category ?? null,
        address: data.address ?? null,
        is_active: data.is_active,
      })
      .eq('id', hostelId);

    if (error) {
      this.logSupabaseQueryError('updateHostel', error, { hostelId });
      throw error;
    }

    const hostels = await this.listSupabaseHostels();
    return { data: hostels.find((item) => String(item.id) === String(hostelId)) as Hostel } as { data: Hostel };
  }

  async deleteHostel(hostelId: string | number, _schoolId: number = 1) {
    const { error } = await supabase.schema('hostel').from('hostels').delete().eq('id', hostelId);
    if (error) {
      this.logSupabaseQueryError('deleteHostel', error, { hostelId });
      throw error;
    }
    return { data: { message: 'Hostel deleted successfully' } } as { data: { message: string } };
  }

  async addHostelRoom(hostelId: string | number, data: { room_number: string; total_beds: number }, _schoolId: number = 1) {
    const scopedSchoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) throw new Error('No active school membership found.');

    const { data: room, error } = await supabase
      .schema('hostel')
      .from('hostel_rooms')
      .insert({
        school_id: scopedSchoolId,
        hostel_id: hostelId,
        room_number: data.room_number,
        total_beds: data.total_beds,
        occupied_beds: 0,
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      this.logSupabaseQueryError('addHostelRoom', error, { schoolId: scopedSchoolId, hostelId });
      throw error;
    }

    return {
      data: {
        id: room.id,
        hostel_id: room.hostel_id,
        room_number: room.room_number,
        total_beds: Number(room.total_beds ?? 0),
        occupied_beds: Number(room.occupied_beds ?? 0),
        available_beds: Math.max(Number(room.total_beds ?? 0) - Number(room.occupied_beds ?? 0), 0),
        is_active: Boolean(room.is_active),
      } as HostelRoom,
    } as { data: HostelRoom };
  }

  async listStudentHostelRequests(schoolId: number = 1, statusFilter?: string) {
    const scopedSchoolId = schoolId && String(schoolId) !== '1'
      ? String(schoolId)
      : await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) throw new Error('No active school membership found.');

    return this.api.get<StudentHostelRequest[]>('/students/hostel-requests', {
      params: { school_id: scopedSchoolId, status_filter: statusFilter },
    });
  }

  async createStudentHostelRequest(studentId: number, data: { hostel_id: number; requested_notes?: string }, _schoolId: number = 1) {
    const scopedSchoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) throw new Error('No active school membership found.');
    return this.api.post<StudentHostelRequest>(`/students/${studentId}/hostel-request`, data, {
      params: { school_id: scopedSchoolId },
    });
  }

  async approveStudentHostelRequest(requestId: string | number, data: { hostel_id?: number | string; room_id?: number | string; reviewed_by?: string; review_notes?: string }, _schoolId: number = 1) {
    const scopedSchoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) throw new Error('No active school membership found.');
    return this.api.post<StudentHostelRequest>(`/students/hostel-requests/${requestId}/approve`, data, {
      params: { school_id: scopedSchoolId },
    });
  }

  async moveStudentHostelAllocation(requestId: string | number, data: { hostel_id?: number | string; room_id?: number | string; reviewed_by?: string; review_notes?: string }, _schoolId: number = 1) {
    const scopedSchoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) throw new Error('No active school membership found.');
    return this.api.post<StudentHostelRequest>(`/students/hostel-requests/${requestId}/move`, data, {
      params: { school_id: scopedSchoolId },
    });
  }

  async rejectStudentHostelRequest(requestId: string | number, data: { reviewed_by?: string; review_notes?: string }, _schoolId: number = 1) {
    const scopedSchoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) throw new Error('No active school membership found.');
    return this.api.post<StudentHostelRequest>(`/students/hostel-requests/${requestId}/reject`, data, {
      params: { school_id: scopedSchoolId },
    });
  }

  // ==================== Rooms ====================

  async createRoom(roomData: Partial<Room>, _schoolId: number = 1) {
    const scopedSchoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) throw new Error('No active school membership found.');

    const roomCode =
      (roomData.name || 'ROOM').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 24) || `ROOM_${Date.now()}`;

    const { data, error } = await supabase
      .from('rooms')
      .insert({
        school_id: scopedSchoolId,
        room_code: roomCode,
        name: roomData.name,
        room_type: 'classroom',
        capacity: Number(roomData.capacity ?? 0),
        exam_capacity: Number(roomData.capacity ?? 0),
        length_feet: roomData.length_feet ?? null,
        width_feet: roomData.width_feet ?? null,
        desk_length_feet: roomData.desk_length_feet ?? null,
        desk_width_feet: roomData.desk_width_feet ?? null,
        num_benches: roomData.num_benches ?? null,
        teaching_zone_clearance_feet: roomData.teaching_zone_clearance_feet ?? null,
        aisle_width_feet: roomData.aisle_width_feet ?? null,
        door_location: roomData.door_location ?? null,
        window_location: roomData.window_location ?? null,
        is_accessible: roomData.is_accessible ?? false,
        is_exam_room: true,
        is_active: roomData.is_active ?? true,
        metadata: { glare_mitigation: roomData.glare_mitigation ?? false },
      })
      .select()
      .single();

    if (error) throw error;
    return { data: this.mapSupabaseRoomToLegacy(data) } as { data: Room };
  }

  async listRooms(_schoolId: number = 1) {
    const scopedSchoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) {
      return { data: [] } as { data: Room[] };
    }
    const { data, error } = await supabase
      .from('rooms')
      .select('*')
      .eq('school_id', scopedSchoolId)
      .order('name', { ascending: true });
    if (error) throw error;
    return { data: (data || []).map((room: any) => this.mapSupabaseRoomToLegacy(room)) } as { data: Room[] };
  }

  async getRoom(roomId: number) {
    return this.api.get<Room>(`/rooms/${roomId}`);
  }

  async updateRoom(roomId: string | number, data: Partial<Room>, _schoolId: number = 1) {
    const { data: updated, error } = await supabase
      .from('rooms')
      .update({
        name: data.name,
        capacity: data.capacity,
        exam_capacity: data.capacity,
        length_feet: data.length_feet,
        width_feet: data.width_feet,
        desk_length_feet: data.desk_length_feet,
        desk_width_feet: data.desk_width_feet,
        num_benches: data.num_benches,
        teaching_zone_clearance_feet: data.teaching_zone_clearance_feet,
        aisle_width_feet: data.aisle_width_feet,
        door_location: data.door_location,
        window_location: data.window_location,
        is_accessible: data.is_accessible,
        is_active: data.is_active,
        metadata: { glare_mitigation: data.glare_mitigation ?? false },
      })
      .eq('id', roomId)
      .select()
      .single();

    if (error) throw error;
    return { data: this.mapSupabaseRoomToLegacy(updated) } as { data: Room };
  }

  async deleteRoom(roomId: string | number, _schoolId: number = 1) {
    const { error } = await supabase.from('rooms').delete().eq('id', roomId);
    if (error) throw error;
    return { data: { message: 'Room deleted successfully' } } as { data: { message: string } };
  }

  async deleteAllRooms(isAdmin: boolean = false, _schoolId: number = 1) {
    return this.api.delete('/rooms', {
      params: { is_admin: isAdmin },
    });
  }

  // ==================== Seating Plans ====================

  async generateSeatingPlans(examId: string | number, roomIds: Array<string | number>, planType?: 'strict' | 'compact' | 'all_in_one', batches?: string[], invigilatorAssignments?: {[roomId: string]: number | null}, generatedDate?: string, batchConflictGroups?: string[][]) {
    const scopedSchoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) throw new Error('No active school membership found.');

    const resolvedExamId = await this.resolveExamUuidOrThrow(examId);
    const [roomsResponse, studentsResponse] = await Promise.all([
      this.listRooms(),
      this.listStudents(1, 0, 10000),
    ]);

    const targetRooms = toArray<Room>(roomsResponse.data).filter((room) => roomIds.some((roomId) => String(roomId) === String(room.id)));
    if (targetRooms.length === 0) {
      throw new Error('Selected rooms not found');
    }

    const eligibleStudents = toArray<Student>(studentsResponse.data).filter((student) =>
      !batches?.length || batches.includes(String(student.batch || '').trim())
    );
    if (eligibleStudents.length === 0) {
      throw new Error('No students found for the selected batches');
    }

    const generation = generatePlannerSeating(eligibleStudents, targetRooms, batchConflictGroups);
    const createdAt = generatedDate || new Date().toISOString();
    const { data: examRow, error: examError } = await supabase
      .schema('exam')
      .from('exams')
      .select('*')
      .eq('id', resolvedExamId)
      .eq('school_id', scopedSchoolId)
      .single();

    if (examError || !examRow) {
      throw examError || new Error('Exam not found');
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const generatedByProfileId = sessionData.session?.user?.id || null;

    const insertPayload = generation.map(({ room, result, layout }) => {
      const distribution = buildPlanBatchDistribution(layout);
      return {
        school_id: scopedSchoolId,
        exam_id: resolvedExamId,
        room_id: room.id,
        generated_by_profile_id: generatedByProfileId,
        plan_name: `${room.name} - Batches: ${Object.keys(distribution).join(', ')} - All-in-One Plan`,
        plan_type: 'strict',
        status: 'draft',
        algorithm_version: 'supabase-1.0',
        students_assigned: layout.occupied,
        is_valid: result.validity,
        validation_errors: result.validity ? [] : ['Some students could not be assigned.'],
        batch_distribution: distribution,
        plan_metadata: {
          ui_plan_type: planType || 'all_in_one',
          generated_date: createdAt,
          selected_batches: batches || [],
          exam_name: examRow.name,
          exam_subject: examRow.metadata?.subject_text || null,
          room_name: room.name,
          layout,
          assignment: result.assignment,
          unassigned_student_ids: result.unassigned,
          invigilator_id: invigilatorAssignments?.[String(room.id)] || null,
        },
        is_active: true,
        created_at: createdAt,
      };
    });

    const { data: createdPlans, error: insertError } = await supabase
      .schema('exam')
      .from('seating_plans')
      .insert(insertPayload)
      .select('*');

    if (insertError) throw insertError;

    if (invigilatorAssignments) {
      for (const roomId of Object.keys(invigilatorAssignments)) {
        const invigilatorId = invigilatorAssignments[roomId];
        if (!invigilatorId) continue;
        const resolvedStaffMemberId = this.resolveMappedId('invigilator', invigilatorId);
        await supabase
          .schema('exam')
          .from('invigilator_assignments')
          .update({ is_active: false })
          .eq('school_id', scopedSchoolId)
          .eq('exam_id', resolvedExamId)
          .eq('room_id', roomId)
          .eq('is_active', true);

        const { error: invigilatorAssignmentError } = await supabase
          .schema('exam')
          .from('invigilator_assignments')
          .insert({
            school_id: scopedSchoolId,
            exam_id: resolvedExamId,
            room_id: roomId,
            staff_member_id: resolvedStaffMemberId,
            assigned_by_profile_id: generatedByProfileId,
            assignment_role: 'invigilator',
            notes: null,
            is_active: true,
          });

        if (invigilatorAssignmentError) {
          console.warn('[Supabase] invigilator assignment insert failed', invigilatorAssignmentError);
        }
      }
    }

    const generatedPlanIds = toArray<any>(createdPlans).map((plan) => this.getLegacySeatingPlanId(plan.id));
    return {
      data: {
        message: `Generated ${generatedPlanIds.length} seating plan(s)`,
        generated_plan_type: planType || 'all_in_one',
        plan_ids: generatedPlanIds,
        selected_student_count: eligibleStudents.length,
        unassigned_count: generation.reduce((sum, item) => sum + item.result.unassigned.length, 0),
        plans: generation.map(({ room }, index) => ({
          room_id: room.id,
          plan_ids: [generatedPlanIds[index]],
          all_in_one_id: generatedPlanIds[index],
          plan_a_id: null,
          plan_b_id: null,
        })),
      },
    };
  }

  async listPlans(roomId: number, examId?: string | number) {
    const response = await this.listAllPlans(examId);
    return {
      data: toArray<SeatingPlan>(response.data).filter((plan) => String(plan.room_id) === String(roomId)),
    } as { data: SeatingPlan[] };
  }

  async listAllPlans(examId?: string | number) {
    const preferredSchoolId = this.getCurrentSupabaseSchoolId();
    const response = await this.api.get('/seating/plans', {
      params: {
        ...(preferredSchoolId ? { school_id: preferredSchoolId } : {}),
        ...(examId !== undefined ? { exam_id: await this.resolveExamUuidOrThrow(examId) } : {}),
      },
    });
    return {
      data: toArray<any>(response.data).map((plan) => ({
        ...plan,
        id: typeof plan?.id === 'string' ? this.getLegacySeatingPlanId(plan.id) : Number(plan?.id || 0),
        exam_id: typeof plan?.exam_id === 'string' ? plan.exam_id : Number(plan?.exam_id || 0),
      })),
    } as { data: SeatingPlan[] };
  }

  async getPlanLayout(planId: number) {
    const response = await this.api.get(`/seating/${planId}/layout`);
    return { data: response.data as RoomLayout } as { data: RoomLayout };
  }

  async finalizePlan(planId: number) {
    const resolvedPlanId = this.resolveSeatingPlanId(planId);
    const { data, error } = await supabase
      .schema('exam')
      .from('seating_plans')
      .update({ status: 'finalized' })
      .eq('id', resolvedPlanId)
      .select('*')
      .single();

    if (error) throw error;
    return { data } as { data: any };
  }

  async deleteSeatingPlan(planId: number) {
    const scopedSchoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) throw new Error('No active school membership found.');

    const resolvedPlanId = this.resolveSeatingPlanId(planId);
    const { error } = await supabase
      .schema('exam')
      .from('seating_plans')
      .delete()
      .eq('id', resolvedPlanId)
      .eq('school_id', scopedSchoolId);

    if (error) throw error;
    return { data: { message: 'Seating plan deleted successfully' } } as { data: { message: string } };
  }

  async deleteAllSeatingPlans(isAdmin: boolean = false, _schoolId: number = 1) {
    if (!isAdmin) {
      throw new Error('Only administrators can delete all seating plans');
    }
    const scopedSchoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) throw new Error('No active school membership found.');

    const { error } = await supabase
      .schema('exam')
      .from('seating_plans')
      .delete()
      .eq('school_id', scopedSchoolId);
    if (error) throw error;
    return { data: { message: 'All seating plans deleted successfully' } } as { data: { message: string } };
  }

  async importSeatingPlan(formData: FormData, examId?: string | number) {
    return this.api.post('/seating/import', formData, {
      params: examId !== undefined ? { exam_id: examId } : undefined,
    });
  }

  // ==================== Exams ====================

  async listExams(_schoolId: number = 1) {
    const preferredSchoolId = this.getCurrentSupabaseSchoolId();
    const response = await this.api.get('/exams', {
      params: preferredSchoolId ? { school_id: preferredSchoolId } : undefined,
    });
    return { data: toArray<any>(response.data).map((exam) => this.mapAnyExamToLegacy(exam, 0, 0)) } as { data: Exam[] };
  }

  private serializeExamPayload(examData: Partial<Exam> & Record<string, any>) {
    const normalizedName = String(examData.name || examData.exam_name || '').trim();
    const normalizedExamDate = String(examData.exam_date || '').trim();

    if (!normalizedName) throw new Error('Exam name is required');
    if (!normalizedExamDate) throw new Error('Exam date is required');

    const payload: Record<string, any> = {
      name: normalizedName,
      exam_date: normalizedExamDate,
    };

    if ('subject' in examData) {
      payload.subject = String(examData.subject || '').trim() || null;
    }
    if ('duration_minutes' in examData) {
      const parsedDuration = Number(examData.duration_minutes);
      payload.duration_minutes = Number.isFinite(parsedDuration) && parsedDuration > 0 ? parsedDuration : null;
    }
    if ('exam_type' in examData && examData.exam_type) {
      payload.exam_type = String(examData.exam_type).trim();
    }
    if ('status' in examData && examData.status) {
      payload.status = String(examData.status).trim();
    }
    if ('is_active' in examData) {
      payload.is_active = Boolean(examData.is_active);
    }

    return payload;
  }

  async createExam(examData: Partial<Exam>, _schoolId: number = 1) {
    const payload = this.serializeExamPayload(examData as Partial<Exam> & Record<string, any>);
    const preferredSchoolId = this.getCurrentSupabaseSchoolId();
    const response = await this.api.post('/exams', payload, {
      params: preferredSchoolId ? { school_id: preferredSchoolId } : undefined,
    });
    return { data: this.mapAnyExamToLegacy(response.data, 0, 0) } as { data: Exam };
  }

  async updateExam(examId: string | number, examData: Partial<Exam>, _schoolId: number = 1) {
    const payload = this.serializeExamPayload(examData as Partial<Exam> & Record<string, any>);
    const preferredSchoolId = this.getCurrentSupabaseSchoolId();
    const resolvedExamId = await this.resolveExamUuidOrThrow(examId);
    const response = await this.api.put(`/exams/${resolvedExamId}`, payload, {
      params: preferredSchoolId ? { school_id: preferredSchoolId } : undefined,
    });
    return { data: this.mapAnyExamToLegacy(response.data, 0, 0) } as { data: Exam };
  }

  async deleteExam(examId: string | number, _schoolId: number = 1) {
    const preferredSchoolId = this.getCurrentSupabaseSchoolId();
    const resolvedExamId = await this.resolveExamUuidOrThrow(examId);
    return this.api.delete(`/exams/${resolvedExamId}`, {
      params: preferredSchoolId ? { school_id: preferredSchoolId } : undefined,
    });
  }

  // ==================== Reports ====================

  async exportPDF(planId: number) {
    const resolvedPlanId = this.resolveSeatingPlanId(planId);
    return this.api.get(`/reports/pdf/${resolvedPlanId}`, {
      responseType: 'blob',
    });
  }

  async exportExcel(planId: number) {
    const resolvedPlanId = this.resolveSeatingPlanId(planId);
    return this.api.get(`/reports/excel/${resolvedPlanId}`, {
      responseType: 'blob',
    });
  }

  async exportAllRoomsExcel(examId: string | number, planType?: 'strict' | 'compact' | 'all_in_one') {
    const resolvedExamId = await this.resolveExamUuidOrThrow(examId);
    return this.api.get(`/reports/excel/all-rooms/${resolvedExamId}`, {
      params: { plan_type: planType },
      responseType: 'blob',
    });
  }

  // ==================== Teachers ====================

  async createTeacher(teacherData: Partial<Teacher>, _schoolId: number = 1) {
    const scopedSchoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) throw new Error('No active school membership found.');

    const employeeCode = `TCH-${Date.now().toString().slice(-8)}`;
    const persistedPhoto = await this.persistStaffPhoto(
      scopedSchoolId,
      teacherData.name || employeeCode,
      (teacherData as any).photoDataUrl,
      null,
    );
    const incomingMetadata =
      typeof (teacherData as any).metadata === 'object' && (teacherData as any).metadata
        ? { ...((teacherData as any).metadata as Record<string, unknown>) }
        : {};
    const { data, error } = await supabase
      .from('staff_members')
      .insert({
        school_id: scopedSchoolId,
        employee_code: employeeCode,
        full_name: teacherData.name,
        email: teacherData.email || null,
        phone: teacherData.phone || null,
        staff_type: 'teaching',
        department: teacherData.subject || null,
        designation: (teacherData as any).designation || 'Teacher',
        employment_status: teacherData.is_active === false ? 'inactive' : 'active',
        is_active: teacherData.is_active ?? true,
        metadata: {
          ...incomingMetadata,
          subject: teacherData.subject || null,
          joining_date: (teacherData as any).joining_date || incomingMetadata.joining_date || null,
          shift_timing: (teacherData as any).shift_timing || incomingMetadata.shift_timing || null,
          photo_url: persistedPhoto.photoUrl || undefined,
          photo_path: persistedPhoto.photoPath || undefined,
          photo_data_url: persistedPhoto.photoDataUrl || undefined,
        },
      })
      .select('*')
      .single();

    if (error) throw error;
    return { data: this.mapSupabaseTeacherToLegacy(data) } as { data: Teacher };
  }

  async listTeachers(_schoolId: number = 1, skip = 0, limit = 10000) {
    const scopedSchoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) {
      return { data: [] } as { data: Teacher[] };
    }

    const { data, error } = await supabase
      .from('staff_members')
      .select('*')
      .eq('school_id', scopedSchoolId)
      .eq('staff_type', 'teaching')
      .order('full_name', { ascending: true })
      .range(skip, Math.max(skip, skip + limit - 1));

    if (error) throw error;
    return { data: (data || []).map((item: any) => this.mapSupabaseTeacherToLegacy(item)) } as { data: Teacher[] };
  }

  async getTeacher(teacherId: number) {
    const resolvedId = this.resolveMappedId('teacher', teacherId);
    const { data, error } = await supabase.from('staff_members').select('*').eq('id', resolvedId).single();
    if (error) throw error;
    return { data: this.mapSupabaseTeacherToLegacy(data) } as { data: Teacher };
  }

  async updateTeacher(teacherId: number, data: Partial<Teacher>) {
    const resolvedId = this.resolveMappedId('teacher', teacherId);
    const scopedSchoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) throw new Error('No active school membership found.');

    const { data: existing, error: existingError } = await supabase
      .from('staff_members')
      .select('employee_code, metadata, full_name, email, phone, department, designation, is_active')
      .eq('id', resolvedId)
      .eq('school_id', scopedSchoolId)
      .single();
    if (existingError) throw existingError;
    const persistedPhoto = await this.persistStaffPhoto(
      scopedSchoolId,
      data.name || existing.employee_code || String(teacherId),
      Object.prototype.hasOwnProperty.call(data, 'photoDataUrl')
        ? (data as any).photoDataUrl
        : existing?.metadata?.photo_url || existing?.metadata?.photo_data_url || null,
      existing?.metadata?.photo_path || null,
    );
    const incomingMetadata =
      typeof (data as any).metadata === 'object' && (data as any).metadata
        ? { ...((data as any).metadata as Record<string, unknown>) }
        : {};
    const payload = this.compactObject({
      full_name: data.name ?? existing.full_name,
      email: data.email ?? existing.email ?? null,
      phone: data.phone ?? existing.phone ?? null,
      department: data.subject ?? existing.department ?? null,
      designation: (data as any).designation ?? existing.designation ?? 'Teacher',
      employment_status: data.is_active === false ? 'inactive' : 'active',
      is_active: data.is_active ?? existing.is_active,
      metadata: {
        ...existing?.metadata,
        ...incomingMetadata,
        subject: data.subject ?? existing?.metadata?.subject ?? existing.department ?? null,
        joining_date: (data as any).joining_date ?? incomingMetadata.joining_date ?? existing?.metadata?.joining_date,
        shift_timing: (data as any).shift_timing ?? incomingMetadata.shift_timing ?? existing?.metadata?.shift_timing,
        photo_url: persistedPhoto.photoUrl || undefined,
        photo_path: persistedPhoto.photoPath || undefined,
        photo_data_url: persistedPhoto.photoDataUrl || undefined,
      },
    });
    const { data: updated, error } = await supabase
      .from('staff_members')
      .update(payload)
      .eq('id', resolvedId)
      .eq('school_id', scopedSchoolId)
      .select('*')
      .single();

    if (error) throw error;
    return { data: this.mapSupabaseTeacherToLegacy(updated) } as { data: Teacher };
  }

  async deleteTeacher(teacherId: number) {
    const resolvedId = this.resolveMappedId('teacher', teacherId);
    const { data: existing, error: existingError } = await supabase
      .from('staff_members')
      .select('metadata')
      .eq('id', resolvedId)
      .maybeSingle();
    if (existingError) throw existingError;
    const { error } = await supabase.from('staff_members').delete().eq('id', resolvedId);
    if (error) throw error;
    await this.removeStaffPhotoAsset(existing?.metadata?.photo_path || null);
    return { data: { message: 'Teacher deleted successfully' } } as { data: { message: string } };
  }

  // ==================== Timetable ====================

  async checkTimetableConflict(data: {
    teacher_id: number;
    day_of_week: DayOfWeek;
    start_time: string;
    end_time: string;
    exclude_entry_id?: number;
  }) {
    const scopedSchoolId = this.getCurrentSupabaseSchoolId();
    return this.api.post('/timetable/check-conflict', {
      ...data,
      teacher_id: this.resolveMappedId('teacher', data.teacher_id),
      exclude_entry_id: data.exclude_entry_id ? this.resolveTimetableEntryId(data.exclude_entry_id) : undefined,
    }, {
      params: scopedSchoolId ? { school_id: scopedSchoolId } : undefined,
    });
  }

  async createTimetableEntry(entryData: Partial<TimetableEntry>, schoolId: number = 1) {
    const scopedSchoolId = this.getCurrentSupabaseSchoolId() || schoolId;
    const response = await this.api.post('/timetable', {
      ...entryData,
      teacher_id: entryData.teacher_id ? this.resolveMappedId('teacher', entryData.teacher_id) : undefined,
    }, {
      params: { school_id: scopedSchoolId },
    });
    return { data: this.mapTimetableEntryToClient(response.data) } as { data: TimetableEntry };
  }

  async listTimetableEntries(params?: {
    day_of_week?: DayOfWeek;
    teacher_id?: string | number;
    class_name?: string;
    room_id?: string | number;
    school_id?: string | number;
  }) {
    const scopedSchoolId = this.getCurrentSupabaseSchoolId() || params?.school_id;
    const response = await this.api.get('/timetable', {
      params: {
        ...params,
        school_id: scopedSchoolId,
        teacher_id: params?.teacher_id ? this.resolveMappedId('teacher', params.teacher_id) : undefined,
      },
    });
    return { data: toArray<any>(response.data).map((item) => this.mapTimetableViewToClient(item)) } as { data: TimetableView[] };
  }

  async exportTimetableReport(params: {
    export_format: 'excel' | 'pdf';
    view_by: 'day' | 'teacher' | 'room' | 'batch';
    session_mode_filter?: 'all' | 'offline' | 'online' | 'merged';
    school_id?: string | number;
    day_of_week?: DayOfWeek;
    teacher_id?: string | number;
    room_id?: string | number;
    batch_name?: string;
  }) {
    const scopedSchoolId = this.getCurrentSupabaseSchoolId() || params.school_id;
    return this.api.get('/timetable/export', {
      params: {
        ...params,
        school_id: scopedSchoolId,
        teacher_id: params.teacher_id ? this.resolveMappedId('teacher', params.teacher_id) : undefined,
      },
      responseType: 'blob',
    });
  }

  async getTimetableEntry(entryId: number) {
    const response = await this.api.get(`/timetable/${this.resolveTimetableEntryId(entryId)}`);
    return { data: this.mapTimetableEntryToClient(response.data) } as { data: TimetableEntry };
  }

  async updateTimetableEntry(entryId: number, data: Partial<TimetableEntry>) {
    const response = await this.api.put(`/timetable/${this.resolveTimetableEntryId(entryId)}`, {
      ...data,
      teacher_id: data.teacher_id ? this.resolveMappedId('teacher', data.teacher_id) : undefined,
    });
    return { data: this.mapTimetableEntryToClient(response.data) } as { data: TimetableEntry };
  }

  async deleteTimetableEntry(entryId: number) {
    return this.api.delete(`/timetable/${this.resolveTimetableEntryId(entryId)}`);
  }

  async deleteAllTimetableEntries(schoolId: number = 1, isAdmin: boolean = true) {
    const scopedSchoolId = this.getCurrentSupabaseSchoolId() || schoolId;
    return this.api.delete(`/timetable`, { params: { school_id: scopedSchoolId, is_admin: isAdmin } });
  }

  // ==================== Settings ====================

  async getSettings() {
    return this.api.get('/settings');
  }

  async updateSettings(settings: any) {
    return this.api.put('/settings', settings);
  }

  async resetSettings() {
    return this.api.post('/settings/reset');
  }

  // ==================== Batch Management ====================

  async listBatches(_schoolId: number = 1, isActive?: boolean, category?: string) {
    const batches = await this.listSupabaseBatches(category, isActive !== false);
    const filtered = isActive === undefined ? batches : batches.filter((batch) => batch.is_active === isActive);
    return { data: filtered } as { data: Batch[] };
  }

  async getBatch(batchId: string | number, _schoolId: number = 1) {
    const batches = await this.listSupabaseBatches(undefined, true);
    const batch = batches.find((item) => String(item.id) === String(batchId));
    if (!batch) {
      throw new Error('Batch not found');
    }
    return { data: batch } as { data: Batch };
  }

  async createBatch(data: { name: string; category?: string; syllabus?: string; display_order?: number; is_active?: boolean }, _schoolId: number = 1) {
    const scopedSchoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) throw new Error('No active school membership found.');

    const normalizedName = data.name.trim();
    const batchCode =
      normalizedName.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 32) || `BATCH_${Date.now()}`;

    const category = data.category || 'batch';

    const { data: created, error } = await supabase
      .from('batches')
      .insert({
        school_id: scopedSchoolId,
        batch_code: batchCode,
        name: normalizedName,
        category,
        class_name: category === 'class' ? normalizedName : null,
        syllabus: data.syllabus || null,
        stream: data.syllabus?.split('|')[0]?.trim() || null,
        display_order: Number(data.display_order ?? 0),
        is_active: data.is_active ?? true,
      })
      .select()
      .single();

    if (error) throw error;

    const batches = await this.listSupabaseBatches(category, true, scopedSchoolId);
    return { data: batches.find((item) => String(item.id) === String(created.id)) as Batch } as { data: Batch };
  }

  async updateBatch(batchId: string | number, data: { name?: string; category?: string; syllabus?: string; display_order?: number; is_active?: boolean }, _schoolId: number = 1) {
    const existing = await this.getBatch(batchId);
    const nextName = data.name?.trim() || existing.data.name;
    const nextCategory = data.category || existing.data.category || 'batch';

    const { data: updated, error } = await supabase
      .from('batches')
      .update({
        name: nextName,
        category: nextCategory,
        class_name: nextCategory === 'class' ? nextName : null,
        syllabus: data.syllabus ?? existing.data.syllabus ?? null,
        stream: (data.syllabus ?? existing.data.syllabus)?.split('|')[0]?.trim() || null,
        display_order: data.display_order ?? existing.data.display_order ?? 0,
        is_active: data.is_active ?? existing.data.is_active,
      })
      .eq('id', batchId)
      .select()
      .single();

    if (error) throw error;

    const batches = await this.listSupabaseBatches(nextCategory, true);
    return { data: batches.find((item) => String(item.id) === String(updated.id)) as Batch } as { data: Batch };
  }

  async reorderBatches(items: Array<{ batch_id: string | number; display_order: number }>, _schoolId: number = 1, category?: string) {
    for (const item of items) {
      const { error } = await supabase
        .from('batches')
        .update({ display_order: item.display_order })
        .eq('id', item.batch_id);

      if (error) throw error;
    }

    const batches = await this.listSupabaseBatches(category, true);
    return { data: batches } as { data: Batch[] };
  }

  async deleteBatch(batchId: string | number, _schoolId: number = 1) {
    const batch = await this.getBatch(batchId);
    if ((batch.data.student_count || 0) > 0) {
      throw new Error('This batch contains students. Please reassign them before deleting.');
    }

    const { error } = await supabase.from('batches').delete().eq('id', batchId);
    if (error) throw error;
    return { data: { message: 'Batch deleted successfully' } } as { data: { message: string } };
  }

  async deleteAllBatches(_schoolId: number = 1, category?: string) {
    const batches = await this.listSupabaseBatches(category, true);
    const blocked = batches.find((batch) => (batch.student_count || 0) > 0);
    if (blocked) {
      throw new Error('Some batches contain students. Please reassign them before deleting.');
    }

    if (!batches.length) {
      return { data: { success: true, deleted_count: 0 } } as { data: { success: boolean; deleted_count: number } };
    }

    const ids = batches.map((batch) => batch.id);
    const { error } = await supabase.from('batches').delete().in('id', ids);
    if (error) throw error;
    return { data: { success: true, deleted_count: ids.length } } as { data: { success: boolean; deleted_count: number } };
  }

  // ==================== Invigilators ====================

  async createInvigilator(invigilatorData: any, _schoolId: number = 1) {
    const scopedSchoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) throw new Error('No active school membership found.');

    const employeeCode = invigilatorData.staff_id || `STF-${Date.now().toString().slice(-8)}`;
    const persistedPhoto = await this.persistStaffPhoto(
      scopedSchoolId,
      invigilatorData.name || employeeCode,
      invigilatorData.photoDataUrl,
      null,
    );
    const incomingMetadata =
      typeof invigilatorData?.metadata === 'object' && invigilatorData?.metadata
        ? { ...(invigilatorData.metadata as Record<string, unknown>) }
        : {};
    const { data, error } = await supabase
      .from('staff_members')
      .insert({
        school_id: scopedSchoolId,
        employee_code: employeeCode,
        full_name: invigilatorData.name,
        email: invigilatorData.email || null,
        phone: invigilatorData.phone || null,
        staff_type: invigilatorData.staff_type || 'non_teaching',
        department: invigilatorData.department || null,
        designation: invigilatorData.designation || null,
        employment_status: invigilatorData.is_active === false ? 'inactive' : 'active',
        is_active: invigilatorData.is_active ?? true,
        metadata: {
          ...incomingMetadata,
          source: 'invigilator',
          joining_date: invigilatorData.joining_date || incomingMetadata.joining_date || null,
          shift_timing: invigilatorData.shift_timing || incomingMetadata.shift_timing || null,
          photo_url: persistedPhoto.photoUrl || undefined,
          photo_path: persistedPhoto.photoPath || undefined,
          photo_data_url: persistedPhoto.photoDataUrl || undefined,
        },
      })
      .select('*')
      .single();

    if (error) throw error;
    return { data: this.mapSupabaseInvigilatorToLegacy(data) } as { data: Invigilator };
  }

  async listInvigilators(_schoolId: number = 1, isActive?: boolean, skip = 0, limit = 10000) {
    const scopedSchoolId = this.getCurrentSupabaseSchoolId();
    if (!scopedSchoolId) {
      return { data: [] } as { data: Invigilator[] };
    }

    let query = supabase
      .from('staff_members')
      .select('*')
      .eq('school_id', scopedSchoolId)
      .neq('staff_type', 'teaching')
      .order('full_name', { ascending: true })
      .range(skip, Math.max(skip, skip + limit - 1));

    if (isActive !== undefined) {
      query = query.eq('is_active', isActive);
    }

    const { data, error } = await query;
    if (error) throw error;
    return { data: (data || []).map((item: any) => this.mapSupabaseInvigilatorToLegacy(item)) } as { data: Invigilator[] };
  }

  async getInvigilator(invigilatorId: number) {
    const resolvedId = this.resolveMappedId('invigilator', invigilatorId);
    const { data, error } = await supabase.from('staff_members').select('*').eq('id', resolvedId).single();
    if (error) throw error;
    return {
      data: {
        ...this.mapSupabaseInvigilatorToLegacy(data),
        room_assignments: [],
      },
    } as { data: InvigilatorWithRooms };
  }

  async updateInvigilator(invigilatorId: number, data: Partial<Invigilator>) {
    const resolvedId = this.resolveMappedId('invigilator', invigilatorId);
    const scopedSchoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) throw new Error('No active school membership found.');

    const { data: existing, error: existingError } = await supabase
      .from('staff_members')
      .select('employee_code, metadata, full_name, email, phone, department, designation, is_active')
      .eq('id', resolvedId)
      .eq('school_id', scopedSchoolId)
      .single();
    if (existingError) throw existingError;
    const persistedPhoto = await this.persistStaffPhoto(
      scopedSchoolId,
      data.name || existing.employee_code || String(invigilatorId),
      Object.prototype.hasOwnProperty.call(data, 'photoDataUrl')
        ? (data as any).photoDataUrl
        : existing?.metadata?.photo_url || existing?.metadata?.photo_data_url || null,
      existing?.metadata?.photo_path || null,
    );
    const incomingMetadata =
      typeof (data as any).metadata === 'object' && (data as any).metadata
        ? { ...((data as any).metadata as Record<string, unknown>) }
        : {};
    const payload = this.compactObject({
      employee_code: data.staff_id ?? existing.employee_code,
      full_name: data.name ?? existing.full_name,
      email: data.email ?? existing.email ?? null,
      phone: data.phone ?? existing.phone ?? null,
      department: data.department ?? existing.department ?? null,
      designation: data.designation ?? existing.designation ?? null,
      employment_status: data.is_active === false ? 'inactive' : 'active',
      is_active: data.is_active ?? existing.is_active,
      metadata: {
        ...existing?.metadata,
        ...incomingMetadata,
        joining_date: (data as any).joining_date ?? incomingMetadata.joining_date ?? existing?.metadata?.joining_date,
        shift_timing: (data as any).shift_timing ?? incomingMetadata.shift_timing ?? existing?.metadata?.shift_timing,
        photo_url: persistedPhoto.photoUrl || undefined,
        photo_path: persistedPhoto.photoPath || undefined,
        photo_data_url: persistedPhoto.photoDataUrl || undefined,
      },
    });
    const { data: updated, error } = await supabase
      .from('staff_members')
      .update(payload)
      .eq('id', resolvedId)
      .eq('school_id', scopedSchoolId)
      .select('*')
      .single();

    if (error) throw error;
    return { data: this.mapSupabaseInvigilatorToLegacy(updated) } as { data: Invigilator };
  }

  async deleteInvigilator(invigilatorId: number) {
    const resolvedId = this.resolveMappedId('invigilator', invigilatorId);
    const { data: existing, error: existingError } = await supabase
      .from('staff_members')
      .select('metadata')
      .eq('id', resolvedId)
      .maybeSingle();
    if (existingError) throw existingError;
    const { error } = await supabase.from('staff_members').delete().eq('id', resolvedId);
    if (error) throw error;
    await this.removeStaffPhotoAsset(existing?.metadata?.photo_path || null);
    return { data: { message: 'Staff member deleted successfully' } } as { data: { message: string } };
  }

  // Room Assignment Methods
  async assignInvigilatorToRoom(assignment: any, _schoolId: number = 1) {
    const scopedSchoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) throw new Error('No active school membership found.');

    const roomId = String(assignment.room_id || '').trim();
    if (!roomId) {
      throw new Error('Please select room');
    }

    const staffMemberId = this.resolveMappedId('invigilator', assignment.invigilator_id);
    const timestamp = new Date().toISOString();

    const [{ data: room, error: roomError }, { data: staffMember, error: staffError }] = await Promise.all([
      supabase
        .from('rooms')
        .select('*')
        .eq('id', roomId)
        .eq('school_id', scopedSchoolId)
        .single(),
      supabase
        .from('staff_members')
        .select('*')
        .eq('id', staffMemberId)
        .eq('school_id', scopedSchoolId)
        .single(),
    ]);

    if (roomError || !room) {
      throw roomError || new Error('Room not found');
    }
    if (staffError || !staffMember) {
      throw staffError || new Error('Invigilator not found');
    }

    const { data: existingRooms, error: existingRoomsError } = await supabase
      .from('rooms')
      .select('id, name, metadata')
      .eq('school_id', scopedSchoolId);

    if (existingRoomsError) {
      throw existingRoomsError;
    }

    const duplicateAssignmentRoom = (existingRooms || []).find((item: any) => {
      if (String(item.id) === roomId) return false;
      const activeAssignment = this.getRoomAssignmentMetadata(item);
      return activeAssignment?.is_active !== false && String(activeAssignment?.staff_member_id || '') === String(staffMember.id);
    });

    if (duplicateAssignmentRoom) {
      throw new Error(`${staffMember.full_name || 'Selected staff'} is already assigned to ${duplicateAssignmentRoom.name || `Room ${duplicateAssignmentRoom.id}`}`);
    }

    const currentMetadata =
      room.metadata && typeof room.metadata === 'object' ? { ...(room.metadata as Record<string, unknown>) } : {};
    const previousAssignment = this.getRoomAssignmentMetadata(room);
    const nextMetadata = {
      ...currentMetadata,
      invigilator_assignment: {
        staff_member_id: staffMember.id,
        notes: assignment.notes || '',
        is_active: true,
        created_at: previousAssignment?.created_at || timestamp,
        updated_at: timestamp,
      },
    };

    const { data: updatedRoom, error: updateError } = await supabase
      .from('rooms')
      .update({ metadata: nextMetadata })
      .eq('id', roomId)
      .eq('school_id', scopedSchoolId)
      .select('*')
      .single();

    if (updateError || !updatedRoom) {
      throw updateError || new Error('Failed to save room assignment');
    }

    return { data: this.mapSupabaseRoomAssignmentToLegacy(updatedRoom, staffMember) } as { data: RoomInvigilator };
  }

  async getRoomInvigilators(roomId: string | number) {
    const assignments = await this.listRoomAssignments(1, typeof roomId === 'number' ? roomId : undefined, undefined, true, roomId);
    return { data: assignments.data.map((item) => item.invigilator).filter(Boolean) as Invigilator[] } as { data: Invigilator[] };
  }

  async listRoomAssignments(_schoolId: number = 1, roomId?: number, invigilatorId?: number, isActive = true, rawRoomId?: string | number) {
    const scopedSchoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) {
      return { data: [] } as { data: RoomInvigilator[] };
    }

    const { data: rooms, error: roomsError } = await supabase
      .from('rooms')
      .select('*')
      .eq('school_id', scopedSchoolId)
      .order('name', { ascending: true });

    if (roomsError) throw roomsError;

    const targetRoomId = rawRoomId !== undefined ? String(rawRoomId) : roomId !== undefined ? String(roomId) : null;
    const roomAssignmentRows = (rooms || []).filter((room: any) => {
      const assignmentMetadata = this.getRoomAssignmentMetadata(room);
      if (!assignmentMetadata) return false;
      if (targetRoomId && String(room.id) !== targetRoomId) return false;
      if (isActive && assignmentMetadata.is_active === false) return false;
      return true;
    });

    if (!roomAssignmentRows.length) {
      return { data: [] } as { data: RoomInvigilator[] };
    }

    const uniqueStaffIds = Array.from(
      new Set(
        roomAssignmentRows
          .map((room: any) => this.getRoomAssignmentMetadata(room)?.staff_member_id)
          .filter(Boolean)
      )
    );

    const { data: staffMembers, error: staffError } = await supabase
      .from('staff_members')
      .select('*')
      .eq('school_id', scopedSchoolId)
      .in('id', uniqueStaffIds);

    if (staffError) throw staffError;

    const staffById = new Map((staffMembers || []).map((item: any) => [String(item.id), item]));
    const assignments = roomAssignmentRows
      .map((room: any) => {
        const assignmentMetadata = this.getRoomAssignmentMetadata(room);
        const staffMember = staffById.get(String(assignmentMetadata?.staff_member_id || ''));
        if (!staffMember) return null;
        const mapped = this.mapSupabaseRoomAssignmentToLegacy(room, staffMember);
        if (invigilatorId !== undefined && mapped.invigilator_id !== invigilatorId) {
          return null;
        }
        return mapped;
      })
      .filter(Boolean) as RoomInvigilator[];

    return { data: assignments } as { data: RoomInvigilator[] };
  }

  async updateRoomAssignment(assignmentId: number, data: Partial<RoomInvigilator>) {
    const scopedSchoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) throw new Error('No active school membership found.');

    const { data: rooms, error: roomsError } = await supabase
      .from('rooms')
      .select('*')
      .eq('school_id', scopedSchoolId);

    if (roomsError) throw roomsError;

    const room = (rooms || []).find((item: any) => {
      const assignmentMetadata = this.getRoomAssignmentMetadata(item);
      if (!assignmentMetadata?.staff_member_id) return false;
      return this.buildLegacyRoomAssignmentId(item.id, assignmentMetadata.staff_member_id) === assignmentId;
    });

    if (!room) {
      throw new Error('Assignment not found');
    }

    const existingAssignment = this.getRoomAssignmentMetadata(room);
    if (!existingAssignment?.staff_member_id) {
      throw new Error('Assignment not found');
    }

    const nextStaffMemberId = data.invigilator_id !== undefined
      ? this.resolveMappedId('invigilator', data.invigilator_id)
      : existingAssignment.staff_member_id;

    const { data: staffMember, error: staffError } = await supabase
      .from('staff_members')
      .select('*')
      .eq('id', nextStaffMemberId)
      .eq('school_id', scopedSchoolId)
      .single();

    if (staffError || !staffMember) {
      throw staffError || new Error('Invigilator not found');
    }

    const duplicateAssignmentRoom = (rooms || []).find((item: any) => {
      if (String(item.id) === String(room.id)) return false;
      const activeAssignment = this.getRoomAssignmentMetadata(item);
      return activeAssignment?.is_active !== false && String(activeAssignment?.staff_member_id || '') === String(staffMember.id);
    });

    if (duplicateAssignmentRoom) {
      throw new Error(`${staffMember.full_name || 'Selected staff'} is already assigned to ${duplicateAssignmentRoom.name || `Room ${duplicateAssignmentRoom.id}`}`);
    }

    const currentMetadata =
      room.metadata && typeof room.metadata === 'object' ? { ...(room.metadata as Record<string, unknown>) } : {};
    const nextMetadata = {
      ...currentMetadata,
      invigilator_assignment: {
        staff_member_id: staffMember.id,
        notes: data.notes ?? existingAssignment.notes ?? '',
        is_active: data.is_active ?? existingAssignment.is_active ?? true,
        created_at: existingAssignment.created_at || room.created_at,
        updated_at: new Date().toISOString(),
      },
    };

    const { data: updatedRoom, error: updateError } = await supabase
      .from('rooms')
      .update({ metadata: nextMetadata })
      .eq('id', room.id)
      .eq('school_id', scopedSchoolId)
      .select('*')
      .single();

    if (updateError || !updatedRoom) {
      throw updateError || new Error('Failed to update assignment');
    }

    return { data: this.mapSupabaseRoomAssignmentToLegacy(updatedRoom, staffMember) } as { data: RoomInvigilator };
  }

  async deleteRoomAssignment(assignmentId: number) {
    const scopedSchoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) throw new Error('No active school membership found.');

    const { data: rooms, error: roomsError } = await supabase
      .from('rooms')
      .select('*')
      .eq('school_id', scopedSchoolId);

    if (roomsError) throw roomsError;

    const room = (rooms || []).find((item: any) => {
      const assignmentMetadata = this.getRoomAssignmentMetadata(item);
      if (!assignmentMetadata?.staff_member_id) return false;
      return this.buildLegacyRoomAssignmentId(item.id, assignmentMetadata.staff_member_id) === assignmentId;
    });

    if (!room) {
      throw new Error('Assignment not found');
    }

    const currentMetadata =
      room.metadata && typeof room.metadata === 'object' ? { ...(room.metadata as Record<string, unknown>) } : {};
    const existingAssignment = this.getRoomAssignmentMetadata(room);
    const nextMetadata = {
      ...currentMetadata,
      invigilator_assignment: {
        ...(existingAssignment || {}),
        is_active: false,
        updated_at: new Date().toISOString(),
      },
    };

    const { error } = await supabase
      .from('rooms')
      .update({ metadata: nextMetadata })
      .eq('id', room.id)
      .eq('school_id', scopedSchoolId);

    if (error) throw error;
    return { data: { message: 'Invigilator assignment removed from room' } } as { data: { message: string } };
  }

  async deleteAllRoomAssignments(_schoolId: number = 1) {
    const scopedSchoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) throw new Error('No active school membership found.');

    const { data: rooms, error: roomsError } = await supabase
      .from('rooms')
      .select('*')
      .eq('school_id', scopedSchoolId);

    if (roomsError) throw roomsError;

    const assignedRooms = (rooms || []).filter((room: any) => this.getRoomAssignmentMetadata(room)?.is_active !== false && this.getRoomAssignmentMetadata(room)?.staff_member_id);
    if (!assignedRooms.length) {
      return { data: { message: 'No active invigilator assignments found', deleted_count: 0 } } as { data: { message: string; deleted_count: number } };
    }

    for (const room of assignedRooms) {
      const currentMetadata =
        room.metadata && typeof room.metadata === 'object' ? { ...(room.metadata as Record<string, unknown>) } : {};
      const existingAssignment = this.getRoomAssignmentMetadata(room);
      const nextMetadata = {
        ...currentMetadata,
        invigilator_assignment: {
          ...(existingAssignment || {}),
          is_active: false,
          updated_at: new Date().toISOString(),
        },
      };

      const { error } = await supabase
        .from('rooms')
        .update({ metadata: nextMetadata })
        .eq('id', room.id)
        .eq('school_id', scopedSchoolId);

      if (error) throw error;
    }

    return {
      data: {
        message: 'All invigilator assignments removed successfully',
        deleted_count: assignedRooms.length,
      },
    } as { data: { message: string; deleted_count: number } };
  }

  // ==================== Inventory ====================

  async listSuppliers(params?: { school_id?: number; search?: string; is_active?: boolean }) {
    const schoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!schoolId) return { data: [] as Supplier[] };

    let query = supabase
      .schema('inventory')
      .from('suppliers')
      .select('id, name, contact_person, phone, email, address, is_active, created_at, updated_at')
      .eq('school_id', schoolId)
      .order('name', { ascending: true });

    if (params?.is_active !== undefined) {
      query = query.eq('is_active', params.is_active);
    }
    if (params?.search) {
      query = query.ilike('name', `%${params.search.trim()}%`);
    }

    const { data, error } = await query;
    if (error) {
      this.logSupabaseQueryError('listSuppliers', error, { schoolId, params });
      throw error;
    }

    return { data: (data || []).map((item: any) => this.mapInventorySupplierToLegacy(item)) } as { data: Supplier[] };
  }

  async createSupplier(data: Partial<Supplier>, _schoolId: number = 1) {
    const scopedSchoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) throw new Error('Active school not found');

    const payload = {
      school_id: scopedSchoolId,
      supplier_code: this.createInventoryCode('SUP', data.name),
      name: String(data.name || '').trim(),
      contact_person: data.contact_person || null,
      phone: data.phone || null,
      email: data.email || null,
      address: data.address || null,
      is_active: data.is_active ?? true,
      metadata: { source: 'frontend_inventory_module' },
    };

    const { data: created, error } = await supabase
      .schema('inventory')
      .from('suppliers')
      .insert(payload)
      .select('id, name, contact_person, phone, email, address, is_active, created_at, updated_at')
      .single();

    if (error) {
      this.logSupabaseQueryError('createSupplier', error, { schoolId: scopedSchoolId, payload });
      throw error;
    }

    return { data: this.mapInventorySupplierToLegacy(created) } as { data: Supplier };
  }

  async updateSupplier(supplierId: string | number, data: Partial<Supplier>, _schoolId: number = 1) {
    const scopedSchoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) throw new Error('Active school not found');
    const resolvedId = this.resolveLegacyInventoryId(this.supplierIdMap, supplierId);

    const payload = this.compactObject({
      name: data.name ? String(data.name).trim() : undefined,
      contact_person: data.contact_person ?? undefined,
      phone: data.phone ?? undefined,
      email: data.email ?? undefined,
      address: data.address ?? undefined,
      is_active: data.is_active,
    });

    const { data: updated, error } = await supabase
      .schema('inventory')
      .from('suppliers')
      .update(payload)
      .eq('id', resolvedId)
      .eq('school_id', scopedSchoolId)
      .select('id, name, contact_person, phone, email, address, is_active, created_at, updated_at')
      .single();

    if (error) {
      this.logSupabaseQueryError('updateSupplier', error, { schoolId: scopedSchoolId, supplierId: resolvedId, payload });
      throw error;
    }

    return { data: this.mapInventorySupplierToLegacy(updated) } as { data: Supplier };
  }

  async deleteSupplier(supplierId: string | number, _schoolId: number = 1) {
    const scopedSchoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) throw new Error('Active school not found');
    const resolvedId = this.resolveLegacyInventoryId(this.supplierIdMap, supplierId);
    const { error } = await supabase
      .schema('inventory')
      .from('suppliers')
      .delete()
      .eq('id', resolvedId)
      .eq('school_id', scopedSchoolId);
    if (error) {
      this.logSupabaseQueryError('deleteSupplier', error, { schoolId: scopedSchoolId, supplierId: resolvedId });
      throw error;
    }
    return { data: { message: 'Supplier deleted successfully' } } as { data: { message: string } };
  }

  async listInventorySubjects(params?: { school_id?: number; is_active?: boolean }) {
    const schoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!schoolId) return { data: [] as InventorySubject[] };
    let categories = await this.fetchInventoryCategories(schoolId, params?.is_active !== false);
    categories = categories.filter((item: any) => !item.parent_category_id);
    if (params?.is_active !== undefined) {
      categories = categories.filter((item: any) => Boolean(item.is_active) === params.is_active);
    }
    return { data: categories.map((item: any) => this.mapInventorySubjectToLegacy(item)) } as { data: InventorySubject[] };
  }

  async createInventorySubject(data: Partial<InventorySubject>, _schoolId: number = 1) {
    const scopedSchoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) throw new Error('Active school not found');
    const payload = {
      school_id: scopedSchoolId,
      category_code: this.createInventoryCode('SUB', data.name),
      name: String(data.name || '').trim(),
      parent_category_id: null,
      is_active: data.is_active ?? true,
    };
    const { data: created, error } = await supabase
      .schema('inventory')
      .from('material_categories')
      .insert(payload)
      .select('id, category_code, name, parent_category_id, is_active')
      .single();
    if (error) {
      this.logSupabaseQueryError('createInventorySubject', error, { schoolId: scopedSchoolId, payload });
      throw error;
    }
    return { data: this.mapInventorySubjectToLegacy(created) } as { data: InventorySubject };
  }

  async updateInventorySubject(subjectId: string | number, data: Partial<InventorySubject>, _schoolId: number = 1) {
    const scopedSchoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) throw new Error('Active school not found');
    const resolvedId = this.resolveLegacyInventoryId(this.inventorySubjectIdMap, subjectId);
    const { data: updated, error } = await supabase
      .schema('inventory')
      .from('material_categories')
      .update(this.compactObject({ name: data.name ? String(data.name).trim() : undefined, is_active: data.is_active }))
      .eq('id', resolvedId)
      .eq('school_id', scopedSchoolId)
      .select('id, category_code, name, parent_category_id, is_active')
      .single();
    if (error) {
      this.logSupabaseQueryError('updateInventorySubject', error, { schoolId: scopedSchoolId, subjectId: resolvedId });
      throw error;
    }
    return { data: this.mapInventorySubjectToLegacy(updated) } as { data: InventorySubject };
  }

  async deleteInventorySubject(subjectId: string | number, _schoolId: number = 1) {
    const scopedSchoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) throw new Error('Active school not found');
    const resolvedId = this.resolveLegacyInventoryId(this.inventorySubjectIdMap, subjectId);
    const { data: childCategories, error: childError } = await supabase
      .schema('inventory')
      .from('material_categories')
      .select('id')
      .eq('school_id', scopedSchoolId)
      .eq('parent_category_id', resolvedId)
      .limit(1);
    if (childError) throw childError;
    if ((childCategories || []).length > 0) {
      throw new Error('Delete linked sets first');
    }
    const { error } = await supabase
      .schema('inventory')
      .from('material_categories')
      .delete()
      .eq('id', resolvedId)
      .eq('school_id', scopedSchoolId);
    if (error) {
      this.logSupabaseQueryError('deleteInventorySubject', error, { schoolId: scopedSchoolId, subjectId: resolvedId });
      throw error;
    }
    return { data: { message: 'Subject deleted successfully' } } as { data: { message: string } };
  }

  async listInventorySets(params?: { school_id?: number; subject_id?: string | number; is_active?: boolean }) {
    const schoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!schoolId) return { data: [] as InventorySet[] };
    const categories = await this.fetchInventoryCategories(schoolId, params?.is_active !== false);
    const requestedSubjectId = params?.subject_id
      ? this.resolveLegacyInventoryId(this.inventorySubjectIdMap, params.subject_id)
      : null;
    const rootIds = new Set(
      categories.filter((item: any) => !item.parent_category_id).map((item: any) => String(item.id))
    );
    let sets = categories.filter((item: any) => item.parent_category_id && rootIds.has(String(item.parent_category_id)));
    if (requestedSubjectId) {
      sets = sets.filter((item: any) => String(item.parent_category_id) === requestedSubjectId);
    }
    if (params?.is_active !== undefined) {
      sets = sets.filter((item: any) => Boolean(item.is_active) === params.is_active);
    }
    return { data: sets.map((item: any) => this.mapInventorySetToLegacy(item)) } as { data: InventorySet[] };
  }

  async createInventorySet(data: Partial<InventorySet>, _schoolId: number = 1) {
    const scopedSchoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) throw new Error('Active school not found');
    const subjectId = data.subject_id
      ? this.resolveLegacyInventoryId(this.inventorySubjectIdMap, data.subject_id)
      : null;
    if (!subjectId) throw new Error('Subject is required');
    const payload = {
      school_id: scopedSchoolId,
      category_code: this.createInventoryCode('SET', data.name),
      name: String(data.name || '').trim(),
      parent_category_id: subjectId,
      is_active: data.is_active ?? true,
    };
    const { data: created, error } = await supabase
      .schema('inventory')
      .from('material_categories')
      .insert(payload)
      .select('id, category_code, name, parent_category_id, is_active')
      .single();
    if (error) {
      this.logSupabaseQueryError('createInventorySet', error, { schoolId: scopedSchoolId, payload });
      throw error;
    }
    return { data: this.mapInventorySetToLegacy(created) } as { data: InventorySet };
  }

  async updateInventorySet(setId: string | number, data: Partial<InventorySet>, _schoolId: number = 1) {
    const scopedSchoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) throw new Error('Active school not found');
    const resolvedId = this.resolveLegacyInventoryId(this.inventorySetIdMap, setId);
    const payload = this.compactObject({
      name: data.name ? String(data.name).trim() : undefined,
      parent_category_id: data.subject_id ? this.resolveLegacyInventoryId(this.inventorySubjectIdMap, data.subject_id) : undefined,
      is_active: data.is_active,
    });
    const { data: updated, error } = await supabase
      .schema('inventory')
      .from('material_categories')
      .update(payload)
      .eq('id', resolvedId)
      .eq('school_id', scopedSchoolId)
      .select('id, category_code, name, parent_category_id, is_active')
      .single();
    if (error) {
      this.logSupabaseQueryError('updateInventorySet', error, { schoolId: scopedSchoolId, setId: resolvedId, payload });
      throw error;
    }
    return { data: this.mapInventorySetToLegacy(updated) } as { data: InventorySet };
  }

  async deleteInventorySet(setId: string | number, _schoolId: number = 1) {
    const scopedSchoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) throw new Error('Active school not found');
    const resolvedId = this.resolveLegacyInventoryId(this.inventorySetIdMap, setId);
    const { data: childCategories, error: childError } = await supabase
      .schema('inventory')
      .from('material_categories')
      .select('id')
      .eq('school_id', scopedSchoolId)
      .eq('parent_category_id', resolvedId)
      .limit(1);
    if (childError) throw childError;
    if ((childCategories || []).length > 0) {
      throw new Error('Delete linked volumes first');
    }
    const { error } = await supabase
      .schema('inventory')
      .from('material_categories')
      .delete()
      .eq('id', resolvedId)
      .eq('school_id', scopedSchoolId);
    if (error) {
      this.logSupabaseQueryError('deleteInventorySet', error, { schoolId: scopedSchoolId, setId: resolvedId });
      throw error;
    }
    return { data: { message: 'Set deleted successfully' } } as { data: { message: string } };
  }

  async listInventoryVolumes(params?: { school_id?: number; subject_id?: string | number; set_id?: string | number; is_active?: boolean }) {
    const schoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!schoolId) return { data: [] as InventoryVolume[] };
    const categories = await this.fetchInventoryCategories(schoolId, params?.is_active !== false);
    const categoriesById = new Map((categories || []).map((item: any) => [String(item.id), item]));
    const setIds = new Set(
      categories
        .filter((item: any) => item.parent_category_id && categoriesById.get(String(item.parent_category_id))?.parent_category_id == null)
        .map((item: any) => String(item.id))
    );
    let volumes = categories.filter((item: any) => item.parent_category_id && setIds.has(String(item.parent_category_id)));
    if (params?.set_id) {
      const resolvedSetId = this.resolveLegacyInventoryId(this.inventorySetIdMap, params.set_id);
      volumes = volumes.filter((item: any) => String(item.parent_category_id) === resolvedSetId);
    }
    if (params?.subject_id) {
      const resolvedSubjectId = this.resolveLegacyInventoryId(this.inventorySubjectIdMap, params.subject_id);
      volumes = volumes.filter((item: any) => {
        const inventorySet = categoriesById.get(String(item.parent_category_id));
        return inventorySet && String(inventorySet.parent_category_id) === resolvedSubjectId;
      });
    }
    if (params?.is_active !== undefined) {
      volumes = volumes.filter((item: any) => Boolean(item.is_active) === params.is_active);
    }
    return {
      data: volumes.map((item: any) => this.mapInventoryVolumeToLegacy(item, categoriesById)),
    } as { data: InventoryVolume[] };
  }

  async createInventoryVolume(data: Partial<InventoryVolume>, _schoolId: number = 1) {
    const scopedSchoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) throw new Error('Active school not found');
    const setId = data.set_id ? this.resolveLegacyInventoryId(this.inventorySetIdMap, data.set_id) : null;
    if (!setId) throw new Error('Set is required');
    const volumeNumber = String((data as any).volume_number || '').trim();
    const name = String(data.name || `Volume ${volumeNumber}`).trim();
    const payload = {
      school_id: scopedSchoolId,
      category_code: this.createInventoryCode(`VOL${volumeNumber || '1'}`, name),
      name,
      parent_category_id: setId,
      is_active: data.is_active ?? true,
    };
    const { data: created, error } = await supabase
      .schema('inventory')
      .from('material_categories')
      .insert(payload)
      .select('id, category_code, name, parent_category_id, is_active')
      .single();
    if (error) {
      this.logSupabaseQueryError('createInventoryVolume', error, { schoolId: scopedSchoolId, payload });
      throw error;
    }
    const categories = await this.fetchInventoryCategories(scopedSchoolId, true);
    const categoriesById = new Map((categories || []).map((item: any) => [String(item.id), item]));
    return { data: this.mapInventoryVolumeToLegacy(created, categoriesById) } as { data: InventoryVolume };
  }

  async updateInventoryVolume(volumeId: string | number, data: Partial<InventoryVolume>, _schoolId: number = 1) {
    const scopedSchoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) throw new Error('Active school not found');
    const resolvedId = this.resolveLegacyInventoryId(this.inventoryVolumeIdMap, volumeId);
    const payload = this.compactObject({
      name: data.name ? String(data.name).trim() : undefined,
      parent_category_id: data.set_id ? this.resolveLegacyInventoryId(this.inventorySetIdMap, data.set_id) : undefined,
      is_active: data.is_active,
    });
    const { data: updated, error } = await supabase
      .schema('inventory')
      .from('material_categories')
      .update(payload)
      .eq('id', resolvedId)
      .eq('school_id', scopedSchoolId)
      .select('id, category_code, name, parent_category_id, is_active')
      .single();
    if (error) {
      this.logSupabaseQueryError('updateInventoryVolume', error, { schoolId: scopedSchoolId, volumeId: resolvedId, payload });
      throw error;
    }
    const categories = await this.fetchInventoryCategories(scopedSchoolId, true);
    const categoriesById = new Map((categories || []).map((item: any) => [String(item.id), item]));
    categoriesById.set(String(updated.id), updated);
    return { data: this.mapInventoryVolumeToLegacy(updated, categoriesById) } as { data: InventoryVolume };
  }

  async deleteInventoryVolume(volumeId: string | number, _schoolId: number = 1) {
    const scopedSchoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) throw new Error('Active school not found');
    const resolvedId = this.resolveLegacyInventoryId(this.inventoryVolumeIdMap, volumeId);
    const { error } = await supabase
      .schema('inventory')
      .from('material_categories')
      .delete()
      .eq('id', resolvedId)
      .eq('school_id', scopedSchoolId);
    if (error) {
      this.logSupabaseQueryError('deleteInventoryVolume', error, { schoolId: scopedSchoolId, volumeId: resolvedId });
      throw error;
    }
    return { data: { message: 'Volume deleted successfully' } } as { data: { message: string } };
  }

  async getInventoryCatalog(params?: { school_id?: number; include_inactive?: boolean }) {
    const schoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!schoolId) return { data: [] as InventoryCatalogSubject[] };
    const includeInactive = params?.include_inactive ?? false;
    const categories = await this.fetchInventoryCategories(schoolId, includeInactive);
    const categoriesById = new Map((categories || []).map((item: any) => [String(item.id), item]));
    const subjects = categories.filter((item: any) => !item.parent_category_id);
    const sets = categories.filter((item: any) => item.parent_category_id && categoriesById.get(String(item.parent_category_id))?.parent_category_id == null);
    const volumes = categories.filter((item: any) => item.parent_category_id && categoriesById.get(String(item.parent_category_id))?.parent_category_id);

    const data = subjects.map((subject: any) => {
      const subjectSets = sets.filter((item: any) => String(item.parent_category_id) === String(subject.id));
      const legacySets = subjectSets.map((item: any) => this.mapInventorySetToLegacy(item));
      const legacyVolumes = volumes
        .filter((volume: any) => {
          const inventorySet = categoriesById.get(String(volume.parent_category_id));
          return inventorySet && String(inventorySet.parent_category_id) === String(subject.id);
        })
        .map((item: any) => this.mapInventoryVolumeToLegacy(item, categoriesById));

      return {
        subject: this.mapInventorySubjectToLegacy(subject),
        sets: legacySets,
        volumes: legacyVolumes,
      };
    });

    return { data } as { data: InventoryCatalogSubject[] };
  }

  async listMaterials(params?: { school_id?: number; search?: string; subject?: string; batch_name?: string; is_active?: boolean }) {
    const schoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!schoolId) return { data: [] as MaterialItem[] };

    let query = supabase
      .schema('inventory')
      .from('material_items')
      .select('id, category_id, name, unit_type, class_name, description, low_stock_threshold, current_stock, metadata, is_active, created_at, updated_at')
      .eq('school_id', schoolId)
      .order('name', { ascending: true });

    if (params?.is_active !== undefined) {
      query = query.eq('is_active', params.is_active);
    }

    const [{ data: materials, error: materialsError }, categories] = await Promise.all([
      query,
      this.fetchInventoryCategories(schoolId, true),
    ]);

    if (materialsError) {
      this.logSupabaseQueryError('listMaterials', materialsError, { schoolId, params });
      throw materialsError;
    }

    const categoriesById = new Map((categories || []).map((item: any) => [String(item.id), item]));
    let normalized = (materials || []).map((item: any) => this.mapInventoryMaterialToLegacy(item, categoriesById));

    if (params?.search) {
      const search = params.search.trim().toLowerCase();
      normalized = normalized.filter((item) =>
        [item.name, item.subject, item.set_name, item.volume_name, item.description]
          .some((value) => String(value || '').toLowerCase().includes(search))
      );
    }
    if (params?.subject) {
      const subject = params.subject.trim().toLowerCase();
      normalized = normalized.filter((item) => String(item.subject || '').toLowerCase() === subject);
    }
    if (params?.batch_name) {
      const batchName = params.batch_name.trim().toLowerCase();
      normalized = normalized.filter((item) =>
        (item.batch_names || []).some((name) => String(name).toLowerCase() === batchName)
      );
    }

    return { data: normalized } as { data: MaterialItem[] };
  }

  async createMaterial(data: Partial<MaterialItem>, _schoolId: number = 1) {
    const scopedSchoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) throw new Error('Active school not found');

    const subjectCategoryId = data.subject_id
      ? this.resolveLegacyInventoryId(this.inventorySubjectIdMap, data.subject_id)
      : null;
    const setCategoryId = data.set_id
      ? this.resolveLegacyInventoryId(this.inventorySetIdMap, data.set_id)
      : null;
    const volumeCategoryId = data.volume_id
      ? this.resolveLegacyInventoryId(this.inventoryVolumeIdMap, data.volume_id)
      : null;
    const normalizedUnitType = this.normalizeInventoryUnitType(data.unit_type);

    const payload = {
      school_id: scopedSchoolId,
      category_id: volumeCategoryId || setCategoryId || subjectCategoryId,
      item_code: this.createInventoryCode('MAT', data.name),
      name: String(data.name || '').trim(),
      unit_type: normalizedUnitType.dbValue,
      class_name: (data.batch_names || []).join(', ') || null,
      description: data.description || null,
      low_stock_threshold: Number(data.low_stock_threshold ?? 10),
      current_stock: 0,
      unit_price: 0,
      metadata: {
        subject_category_id: subjectCategoryId,
        set_category_id: setCategoryId,
        volume_category_id: volumeCategoryId,
        batch_names: data.batch_names || [],
        original_unit_type: data.unit_type,
        source: 'frontend_inventory_module',
      },
      is_active: data.is_active ?? true,
    };

    const { data: created, error } = await supabase
      .schema('inventory')
      .from('material_items')
      .insert(payload)
      .select('id, category_id, name, unit_type, class_name, description, low_stock_threshold, current_stock, metadata, is_active, created_at, updated_at')
      .single();

    if (error) {
      this.logSupabaseQueryError('createMaterial', error, { schoolId: scopedSchoolId, payload });
      throw error;
    }

    const categories = await this.fetchInventoryCategories(scopedSchoolId, true);
    const categoriesById = new Map((categories || []).map((item: any) => [String(item.id), item]));
    return { data: this.mapInventoryMaterialToLegacy(created, categoriesById) } as { data: MaterialItem };
  }

  async updateMaterial(materialId: string | number, data: Partial<MaterialItem>, _schoolId: number = 1) {
    const scopedSchoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) throw new Error('Active school not found');
    const resolvedId = this.resolveLegacyInventoryId(this.materialIdMap, materialId);
    const existing = await supabase
      .schema('inventory')
      .from('material_items')
      .select('metadata')
      .eq('id', resolvedId)
      .eq('school_id', scopedSchoolId)
      .maybeSingle();
    if (existing.error) throw existing.error;
    const existingMetadata = existing.data?.metadata || {};
    const subjectCategoryId = data.subject_id
      ? this.resolveLegacyInventoryId(this.inventorySubjectIdMap, data.subject_id)
      : existingMetadata.subject_category_id || null;
    const setCategoryId = data.set_id
      ? this.resolveLegacyInventoryId(this.inventorySetIdMap, data.set_id)
      : existingMetadata.set_category_id || null;
    const volumeCategoryId = data.volume_id
      ? this.resolveLegacyInventoryId(this.inventoryVolumeIdMap, data.volume_id)
      : existingMetadata.volume_category_id || null;
    const normalizedUnitType = this.normalizeInventoryUnitType(data.unit_type || existingMetadata.original_unit_type);

    const payload = this.compactObject({
      category_id: volumeCategoryId || setCategoryId || subjectCategoryId || undefined,
      name: data.name ? String(data.name).trim() : undefined,
      unit_type: normalizedUnitType.dbValue,
      class_name: data.batch_names ? data.batch_names.join(', ') : undefined,
      description: data.description ?? undefined,
      low_stock_threshold: data.low_stock_threshold !== undefined ? Number(data.low_stock_threshold) : undefined,
      metadata: {
        ...existingMetadata,
        subject_category_id: subjectCategoryId,
        set_category_id: setCategoryId,
        volume_category_id: volumeCategoryId,
        batch_names: data.batch_names ?? existingMetadata.batch_names ?? [],
        original_unit_type: data.unit_type || existingMetadata.original_unit_type || normalizedUnitType.uiValue,
      },
      is_active: data.is_active,
    });

    const { data: updated, error } = await supabase
      .schema('inventory')
      .from('material_items')
      .update(payload)
      .eq('id', resolvedId)
      .eq('school_id', scopedSchoolId)
      .select('id, category_id, name, unit_type, class_name, description, low_stock_threshold, current_stock, metadata, is_active, created_at, updated_at')
      .single();

    if (error) {
      this.logSupabaseQueryError('updateMaterial', error, { schoolId: scopedSchoolId, materialId: resolvedId, payload });
      throw error;
    }

    const categories = await this.fetchInventoryCategories(scopedSchoolId, true);
    const categoriesById = new Map((categories || []).map((item: any) => [String(item.id), item]));
    return { data: this.mapInventoryMaterialToLegacy(updated, categoriesById) } as { data: MaterialItem };
  }

  async deleteMaterial(materialId: string | number, _schoolId: number = 1) {
    const scopedSchoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) throw new Error('Active school not found');
    const resolvedId = this.resolveLegacyInventoryId(this.materialIdMap, materialId);
    const { error } = await supabase
      .schema('inventory')
      .from('material_items')
      .delete()
      .eq('id', resolvedId)
      .eq('school_id', scopedSchoolId);
    if (error) {
      this.logSupabaseQueryError('deleteMaterial', error, { schoolId: scopedSchoolId, materialId: resolvedId });
      throw error;
    }
    return { data: { message: 'Material deleted successfully' } } as { data: { message: string } };
  }

  async downloadInventoryMaterialTemplate() {
    return this.api.get('/inventory/materials/template/download', {
      responseType: 'blob',
    });
  }

  async importInventoryMaterials(formData: FormData, schoolId: number = 1) {
    const resolvedSchoolId = await this.resolveCurrentSupabaseSchoolId();
    return this.api.post<InventoryMaterialImportResponse>('/inventory/materials/import', formData, {
      params: { school_id: resolvedSchoolId || schoolId },
    });
  }

  async listStockIn(params?: { school_id?: number; supplier_id?: string | number; material_id?: string | number }) {
    const schoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!schoolId) return { data: [] as StockInEntry[] };

    let query = supabase
      .schema('inventory')
      .from('stock_in_entries')
      .select('id, material_item_id, supplier_id, entry_date, quantity_received, entry_type, notes, created_at')
      .eq('school_id', schoolId)
      .order('entry_date', { ascending: false });

    if (params?.supplier_id) {
      query = query.eq('supplier_id', this.resolveLegacyInventoryId(this.supplierIdMap, params.supplier_id));
    }
    if (params?.material_id) {
      query = query.eq('material_item_id', this.resolveLegacyInventoryId(this.materialIdMap, params.material_id));
    }

    const [{ data: rows, error }, materialsResponse, suppliersResponse] = await Promise.all([
      query,
      this.listMaterials({ is_active: undefined }),
      this.listSuppliers({ is_active: undefined }),
    ]);

    if (error) {
      this.logSupabaseQueryError('listStockIn', error, { schoolId, params });
      throw error;
    }

    const normalizedMaterialsByUuid = new Map<string, any>();
    for (const item of materialsResponse.data || []) {
      normalizedMaterialsByUuid.set(String(this.resolveLegacyInventoryId(this.materialIdMap, item.id)), item);
    }
    const normalizedSuppliersByUuid = new Map<string, any>();
    for (const item of suppliersResponse.data || []) {
      normalizedSuppliersByUuid.set(String(this.resolveLegacyInventoryId(this.supplierIdMap, item.id)), item);
    }

    return {
      data: (rows || []).map((item: any) => this.mapStockInEntryToLegacy(item, normalizedMaterialsByUuid, normalizedSuppliersByUuid)),
    } as { data: StockInEntry[] };
  }

  async createStockIn(data: Partial<StockInEntry>, _schoolId: number = 1) {
    const scopedSchoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) throw new Error('Active school not found');
    const materialId = data.material_id
      ? this.resolveLegacyInventoryId(this.materialIdMap, data.material_id)
      : null;
    if (!materialId) throw new Error('Material is required');

    const payload = {
      school_id: scopedSchoolId,
      material_item_id: materialId,
      supplier_id: data.supplier_id ? this.resolveLegacyInventoryId(this.supplierIdMap, data.supplier_id) : null,
      entry_date: String(data.date || '').slice(0, 10),
      quantity_received: Number(data.quantity_received ?? 0),
      unit_price: 0,
      entry_type: data.entry_type || 'purchase',
      notes: data.notes || null,
    };

    const { data: created, error } = await supabase
      .schema('inventory')
      .from('stock_in_entries')
      .insert(payload)
      .select('id, material_item_id, supplier_id, entry_date, quantity_received, entry_type, notes, created_at')
      .single();

    if (error) {
      this.logSupabaseQueryError('createStockIn', error, { schoolId: scopedSchoolId, payload });
      throw error;
    }

    await this.recalculateInventoryStocks(scopedSchoolId, [materialId]);
    const [materialsResponse, suppliersResponse] = await Promise.all([
      this.listMaterials({ is_active: undefined }),
      this.listSuppliers({ is_active: undefined }),
    ]);
    const materialsByUuid = new Map<string, any>();
    for (const item of materialsResponse.data || []) {
      materialsByUuid.set(String(this.resolveLegacyInventoryId(this.materialIdMap, item.id)), item);
    }
    const suppliersByUuid = new Map<string, any>();
    for (const item of suppliersResponse.data || []) {
      suppliersByUuid.set(String(this.resolveLegacyInventoryId(this.supplierIdMap, item.id)), item);
    }
    return { data: this.mapStockInEntryToLegacy(created, materialsByUuid, suppliersByUuid) } as { data: StockInEntry };
  }

  async deleteStockIn(entryId: string | number, _schoolId: number = 1) {
    const scopedSchoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) throw new Error('Active school not found');
    const resolvedId = this.resolveLegacyInventoryId(this.stockInIdMap, entryId);
    const existing = await supabase
      .schema('inventory')
      .from('stock_in_entries')
      .select('material_item_id')
      .eq('id', resolvedId)
      .eq('school_id', scopedSchoolId)
      .maybeSingle();
    if (existing.error) throw existing.error;
    const materialId = existing.data?.material_item_id ? String(existing.data.material_item_id) : null;
    const { error } = await supabase
      .schema('inventory')
      .from('stock_in_entries')
      .delete()
      .eq('id', resolvedId)
      .eq('school_id', scopedSchoolId);
    if (error) {
      this.logSupabaseQueryError('deleteStockIn', error, { schoolId: scopedSchoolId, entryId: resolvedId });
      throw error;
    }
    if (materialId) {
      await this.recalculateInventoryStocks(scopedSchoolId, [materialId]);
    }
    return { data: { message: 'Stock-in entry deleted successfully' } } as { data: { message: string } };
  }

  async listStockOut(params?: { school_id?: number; batch_id?: string | number; material_id?: string | number }) {
    const schoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!schoolId) return { data: [] as StockOutEntry[] };

    let query = supabase
      .schema('inventory')
      .from('stock_out_entries')
      .select('id, material_item_id, batch_id, entry_date, quantity_issued, remarks, created_at')
      .eq('school_id', schoolId)
      .order('entry_date', { ascending: false });

    if (params?.batch_id) {
      query = query.eq('batch_id', params.batch_id);
    }
    if (params?.material_id) {
      query = query.eq('material_item_id', this.resolveLegacyInventoryId(this.materialIdMap, params.material_id));
    }

    const [{ data: rows, error }, materialsResponse, batchesResponse] = await Promise.all([
      query,
      this.listMaterials({ is_active: undefined }),
      this.listBatches(),
    ]);

    if (error) {
      this.logSupabaseQueryError('listStockOut', error, { schoolId, params });
      throw error;
    }

    const materialsByUuid = new Map<string, any>();
    for (const item of materialsResponse.data || []) {
      materialsByUuid.set(String(this.resolveLegacyInventoryId(this.materialIdMap, item.id)), item);
    }
    const batchesById = new Map((batchesResponse.data || []).map((item: any) => [String(item.id), item]));

    return {
      data: (rows || []).map((item: any) => this.mapStockOutEntryToLegacy(item, materialsByUuid, batchesById)),
    } as { data: StockOutEntry[] };
  }

  async createStockOut(data: any, _schoolId: number = 1) {
    const scopedSchoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) throw new Error('Active school not found');
    const materialId = data.material_id ? this.resolveLegacyInventoryId(this.materialIdMap, data.material_id) : null;
    if (!materialId) throw new Error('Material is required');
    const batchIds = Array.isArray(data.batch_ids) ? data.batch_ids.filter(Boolean).map(String) : [];
    if (!batchIds.length) throw new Error('At least one batch is required');

    const payload = batchIds.map((batchId: string) => ({
      school_id: scopedSchoolId,
      material_item_id: materialId,
      batch_id: batchId,
      entry_date: String(data.date || '').slice(0, 10),
      quantity_issued: Number(data.quantity_issued ?? 0),
      remarks: data.remarks || null,
    }));

    const { data: createdRows, error } = await supabase
      .schema('inventory')
      .from('stock_out_entries')
      .insert(payload)
      .select('id, material_item_id, batch_id, entry_date, quantity_issued, remarks, created_at');

    if (error) {
      this.logSupabaseQueryError('createStockOut', error, { schoolId: scopedSchoolId, payload });
      throw error;
    }

    await this.recalculateInventoryStocks(scopedSchoolId, [materialId]);
    const [materialsResponse, batchesResponse] = await Promise.all([
      this.listMaterials({ is_active: undefined }),
      this.listBatches(),
    ]);
    const materialsByUuid = new Map<string, any>();
    for (const item of materialsResponse.data || []) {
      materialsByUuid.set(String(this.resolveLegacyInventoryId(this.materialIdMap, item.id)), item);
    }
    const batchesById = new Map((batchesResponse.data || []).map((item: any) => [String(item.id), item]));
    const firstRow = (createdRows || [])[0];
    return { data: this.mapStockOutEntryToLegacy(firstRow, materialsByUuid, batchesById) } as { data: StockOutEntry };
  }

  async deleteStockOut(entryId: string | number, _schoolId: number = 1) {
    const scopedSchoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) throw new Error('Active school not found');
    const resolvedId = this.resolveLegacyInventoryId(this.stockOutIdMap, entryId);
    const existing = await supabase
      .schema('inventory')
      .from('stock_out_entries')
      .select('material_item_id')
      .eq('id', resolvedId)
      .eq('school_id', scopedSchoolId)
      .maybeSingle();
    if (existing.error) throw existing.error;
    const materialId = existing.data?.material_item_id ? String(existing.data.material_item_id) : null;
    const { error } = await supabase
      .schema('inventory')
      .from('stock_out_entries')
      .delete()
      .eq('id', resolvedId)
      .eq('school_id', scopedSchoolId);
    if (error) {
      this.logSupabaseQueryError('deleteStockOut', error, { schoolId: scopedSchoolId, entryId: resolvedId });
      throw error;
    }
    if (materialId) {
      await this.recalculateInventoryStocks(scopedSchoolId, [materialId]);
    }
    return { data: { message: 'Distribution entry deleted successfully' } } as { data: { message: string } };
  }

  async listStudentIssues(params?: { school_id?: number; batch_id?: string | number; student_id?: string | number; material_id?: string | number }) {
    const schoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!schoolId) return { data: [] as StudentIssueEntry[] };

    let query = supabase
      .schema('inventory')
      .from('student_issue_entries')
      .select('id, material_item_id, student_id, batch_id, issue_date, quantity_issued, remarks, created_at')
      .eq('school_id', schoolId)
      .order('issue_date', { ascending: false });

    if (params?.batch_id) {
      query = query.eq('batch_id', params.batch_id);
    }
    if (params?.student_id) {
      query = query.eq('student_id', this.resolveMappedId('student', params.student_id));
    }
    if (params?.material_id) {
      query = query.eq('material_item_id', this.resolveLegacyInventoryId(this.materialIdMap, params.material_id));
    }

    const [{ data: rows, error }, materialsResponse, batchesResponse, studentsResponse] = await Promise.all([
      query,
      this.listMaterials({ is_active: undefined }),
      this.listBatches(),
      this.listStudents(),
    ]);

    if (error) {
      this.logSupabaseQueryError('listStudentIssues', error, { schoolId, params });
      throw error;
    }

    const materialsByUuid = new Map<string, any>();
    for (const item of materialsResponse.data || []) {
      materialsByUuid.set(String(this.resolveLegacyInventoryId(this.materialIdMap, item.id)), item);
    }
    const batchesById = new Map((batchesResponse.data || []).map((item: any) => [String(item.id), item]));
    const studentsByUuid = new Map<string, any>();
    for (const item of studentsResponse.data || []) {
      studentsByUuid.set(String(this.resolveMappedId('student', item.id)), item);
    }

    return {
      data: (rows || []).map((item: any) => this.mapStudentIssueEntryToLegacy(item, materialsByUuid, batchesById, studentsByUuid)),
    } as { data: StudentIssueEntry[] };
  }

  async createStudentIssues(data: {
    date: string;
    batch_id?: string | number;
    student_ids: number[];
    material_id: string | number;
    quantity_issued: number;
    issued_by?: string;
    remarks?: string;
  }, _schoolId: number = 1) {
    const scopedSchoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) throw new Error('Active school not found');
    const materialId = this.resolveLegacyInventoryId(this.materialIdMap, data.material_id);
    const batchId = data.batch_id ? String(data.batch_id) : null;
    const studentIds = (data.student_ids || []).map((studentId) => this.resolveMappedId('student', studentId));
    const payload = studentIds.map((studentId) => ({
      school_id: scopedSchoolId,
      material_item_id: materialId,
      student_id: studentId,
      batch_id: batchId,
      issue_date: String(data.date || '').slice(0, 10),
      quantity_issued: Number(data.quantity_issued ?? 0),
      remarks: data.remarks || null,
    }));

    const { data: createdRows, error } = await supabase
      .schema('inventory')
      .from('student_issue_entries')
      .insert(payload)
      .select('id, material_item_id, student_id, batch_id, issue_date, quantity_issued, remarks, created_at');

    if (error) {
      this.logSupabaseQueryError('createStudentIssues', error, { schoolId: scopedSchoolId, payload });
      throw error;
    }

    await this.recalculateInventoryStocks(scopedSchoolId, [materialId]);
    const [materialsResponse, batchesResponse, studentsResponse] = await Promise.all([
      this.listMaterials({ is_active: undefined }),
      this.listBatches(),
      this.listStudents(),
    ]);
    const materialsByUuid = new Map<string, any>();
    for (const item of materialsResponse.data || []) {
      materialsByUuid.set(String(this.resolveLegacyInventoryId(this.materialIdMap, item.id)), item);
    }
    const batchesById = new Map((batchesResponse.data || []).map((item: any) => [String(item.id), item]));
    const studentsByUuid = new Map<string, any>();
    for (const item of studentsResponse.data || []) {
      studentsByUuid.set(String(this.resolveMappedId('student', item.id)), item);
    }
    const firstRow = (createdRows || [])[0];
    return { data: this.mapStudentIssueEntryToLegacy(firstRow, materialsByUuid, batchesById, studentsByUuid) } as { data: StudentIssueEntry };
  }

  async deleteStudentIssue(entryId: string | number, _schoolId: number = 1) {
    const scopedSchoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) throw new Error('Active school not found');
    const resolvedId = this.resolveLegacyInventoryId(this.studentIssueIdMap, entryId);
    const existing = await supabase
      .schema('inventory')
      .from('student_issue_entries')
      .select('material_item_id')
      .eq('id', resolvedId)
      .eq('school_id', scopedSchoolId)
      .maybeSingle();
    if (existing.error) throw existing.error;
    const materialId = existing.data?.material_item_id ? String(existing.data.material_item_id) : null;
    const { error } = await supabase
      .schema('inventory')
      .from('student_issue_entries')
      .delete()
      .eq('id', resolvedId)
      .eq('school_id', scopedSchoolId);
    if (error) {
      this.logSupabaseQueryError('deleteStudentIssue', error, { schoolId: scopedSchoolId, entryId: resolvedId });
      throw error;
    }
    if (materialId) {
      await this.recalculateInventoryStocks(scopedSchoolId, [materialId]);
    }
    return { data: { message: 'Student issue entry deleted successfully' } } as { data: { message: string } };
  }

  async getInventoryDashboard(_schoolId: number = 1) {
    const [materials, suppliers, stockIn, stockOut, studentIssues] = await Promise.all([
      this.listMaterials({ is_active: undefined }),
      this.listSuppliers({ is_active: undefined }),
      this.listStockIn(),
      this.listStockOut(),
      this.listStudentIssues(),
    ]);

    const recentActivity: InventoryHistoryEntry[] = [
      ...stockIn.data.slice(0, 10).map((item) => ({
        id: item.id,
        action: 'stock_in',
        quantity: item.quantity_received,
        date: item.date,
        actor: item.added_by,
        notes: item.notes || item.material_name,
      })),
      ...stockOut.data.slice(0, 10).map((item) => ({
        id: item.id,
        action: 'stock_out',
        quantity: item.quantity_issued,
        date: item.date,
        actor: item.issued_by,
        notes: item.remarks || item.material_name,
      })),
      ...studentIssues.data.slice(0, 10).map((item) => ({
        id: item.id,
        action: 'student_issue',
        quantity: item.quantity_issued,
        date: item.date,
        actor: item.issued_by,
        notes: `${item.student_name} - ${item.material_name || ''}`.trim(),
      })),
    ]
      .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())
      .slice(0, 12);

    return {
      data: {
        total_materials: materials.data.length,
        total_suppliers: suppliers.data.length,
        total_stock_in: stockIn.data.reduce((sum, item) => sum + Number(item.quantity_received || 0), 0),
        total_stock_out:
          stockOut.data.reduce((sum, item) => sum + Number(item.quantity_issued || 0), 0) +
          studentIssues.data.reduce((sum, item) => sum + Number(item.quantity_issued || 0), 0),
        low_stock_items: materials.data.filter(
          (item) => Number(item.current_stock || 0) <= Number(item.low_stock_threshold || 0)
        ),
        recent_activity: recentActivity,
      } as InventoryDashboard,
    } as { data: InventoryDashboard };
  }

  async getMaterialHistory(materialId: string | number, _schoolId: number = 1) {
    const [stockIn, stockOut, studentIssues] = await Promise.all([
      this.listStockIn({ material_id: materialId }),
      this.listStockOut({ material_id: materialId }),
      this.listStudentIssues({ material_id: materialId }),
    ]);

    const rows: InventoryHistoryEntry[] = [
      ...stockIn.data.map((item) => ({
        id: item.id,
        action: 'stock_in',
        quantity: item.quantity_received,
        date: item.date,
        actor: item.added_by,
        notes: item.notes || item.supplier_name,
      })),
      ...stockOut.data.map((item) => ({
        id: item.id,
        action: 'stock_out',
        quantity: item.quantity_issued,
        date: item.date,
        actor: item.issued_by,
        notes: item.remarks || item.batch_name,
      })),
      ...studentIssues.data.map((item) => ({
        id: item.id,
        action: 'student_issue',
        quantity: item.quantity_issued,
        date: item.date,
        actor: item.issued_by,
        notes: item.student_name,
      })),
    ].sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());

    return { data: rows } as { data: InventoryHistoryEntry[] };
  }

  async getInventoryReport(params: {
    report_type: string;
    school_id?: number;
    date_from?: string;
    date_to?: string;
    supplier_id?: string | number;
    batch_id?: string | number;
    student_id?: string | number;
    material_id?: string | number;
  }) {
    const [materials, stockIn, stockOut, studentIssues] = await Promise.all([
      this.listMaterials({ is_active: undefined }),
      this.listStockIn({ supplier_id: params.supplier_id, material_id: params.material_id }),
      this.listStockOut({ batch_id: params.batch_id, material_id: params.material_id }),
      this.listStudentIssues({ batch_id: params.batch_id, student_id: params.student_id, material_id: params.material_id }),
    ]);

    const dateFrom = params.date_from ? new Date(params.date_from).getTime() : null;
    const dateTo = params.date_to ? new Date(params.date_to).getTime() : null;
    const inRange = (value?: string) => {
      if (!value) return true;
      const time = new Date(value).getTime();
      if (Number.isNaN(time)) return true;
      if (dateFrom && time < dateFrom) return false;
      if (dateTo && time > dateTo) return false;
      return true;
    };

    let rows: Array<Record<string, string | number | null>> = [];
    if (params.report_type === 'stock_in') {
      rows = stockIn.data
        .filter((item) => inRange(item.date))
        .map((item) => ({
          date: item.date || '',
          supplier: item.supplier_name || '',
          material: item.material_name || '',
          quantity_received: item.quantity_received,
          entry_type: item.entry_type,
          notes: item.notes || '',
        }));
    } else if (params.report_type === 'batch_distribution') {
      rows = stockOut.data
        .filter((item) => inRange(item.date))
        .map((item) => ({
          date: item.date || '',
          batch: item.batch_name || '',
          material: item.material_name || '',
          quantity_issued: item.quantity_issued,
          issued_by: item.issued_by || '',
          remarks: item.remarks || '',
        }));
    } else if (params.report_type === 'low_stock') {
      rows = materials.data
        .filter((item) => Number(item.current_stock || 0) <= Number(item.low_stock_threshold || 0))
        .map((item) => ({
          material: item.name,
          subject: item.subject || '',
          set_name: item.set_name || '',
          current_stock: Number(item.current_stock || 0),
          low_stock_threshold: Number(item.low_stock_threshold || 0),
        }));
    } else {
      rows = materials.data.map((item) => ({
        material: item.name,
        subject: item.subject || '',
        set_name: item.set_name || '',
        volume: item.volume_name || item.volume_number || '',
        current_stock: Number(item.current_stock || 0),
        low_stock_threshold: Number(item.low_stock_threshold || 0),
        unit_type: item.unit_type,
      }));
    }

    return {
      data: {
        title:
          params.report_type === 'stock_in'
            ? 'Stock In Report'
            : params.report_type === 'batch_distribution'
              ? 'Batch Distribution Report'
              : params.report_type === 'low_stock'
                ? 'Low Stock Report'
                : 'Current Inventory Report',
        generated_at: new Date().toISOString(),
        rows: rows.map((values) => ({ values })),
        summary: {
          total_records: rows.length,
          stock_in_count: stockIn.data.length,
          stock_out_count: stockOut.data.length,
          student_issue_count: studentIssues.data.length,
        },
        total_records: rows.length,
      } as InventoryReportResponse & { total_records: number },
    } as { data: InventoryReportResponse & { total_records: number } };
  }

  async exportInventoryReport(params: {
    report_type: string;
    export_format: 'excel' | 'pdf';
    school_id?: number;
    date_from?: string;
    date_to?: string;
    supplier_id?: number;
    batch_id?: number;
    student_id?: number;
    material_id?: number;
  }) {
    return this.api.get('/inventory/reports/export', {
      params,
      responseType: 'blob',
    });
  }

  // ==================== EduPay ====================

  async getEduPayDashboard(schoolId: number = 1) {
    const scopedSchoolId = schoolId && String(schoolId) !== '1'
      ? String(schoolId)
      : await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) {
      throw new Error('Active school context is required to load EduPay dashboard');
    }
    return this.api.get<EduPayDashboard>('/edupay/dashboard', {
      params: { school_id: scopedSchoolId },
    });
  }

  async listEduPayStudents(schoolId: number = 1) {
    const scopedSchoolId = schoolId && String(schoolId) !== '1'
      ? String(schoolId)
      : await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) {
      throw new Error('Active school context is required to load EduPay students');
    }
    return this.api.get<EduPayStudent[]>('/edupay/students', {
      params: { school_id: scopedSchoolId },
    });
  }

  async createEduPayStudent(
    data: {
      admission_no: string;
      full_name: string;
      class_name: string;
      batch_name?: string;
      email?: string;
      phone?: string;
      parent_name: string;
      parent_mobile: string;
      parent_email?: string;
      parent_relation?: string;
    },
    schoolId: number | string = 1
  ) {
    const scopedSchoolId = schoolId && String(schoolId) !== '1'
      ? String(schoolId)
      : await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) {
      throw new Error('Active school context is required to create an EduPay student');
    }
    return this.api.post<EduPayStudent>('/edupay/students', data, {
      params: { school_id: scopedSchoolId },
    });
  }

  async listEduPayFeeStructures(schoolId: number = 1) {
    const scopedSchoolId = schoolId && String(schoolId) !== '1'
      ? String(schoolId)
      : await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) {
      throw new Error('Active school context is required to load EduPay fee structures');
    }
    return this.api.get<EduPayFeeStructure[]>('/edupay/fee-structures', {
      params: { school_id: scopedSchoolId },
    });
  }

  async createEduPayFeeStructure(
    data: {
      name: string;
      fee_type: string;
      class_name?: string;
      installment_plan: 'monthly' | 'quarterly' | 'yearly';
      total_amount: number;
      discount_amount?: number;
      late_fee_rule?: string;
      description?: string;
      is_active?: boolean;
    },
    schoolId: number | string = 1
  ) {
    const scopedSchoolId = schoolId && String(schoolId) !== '1'
      ? String(schoolId)
      : await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) {
      throw new Error('Active school context is required to create an EduPay fee structure');
    }
    return this.api.post<EduPayFeeStructure>('/edupay/fee-structures', data, {
      params: { school_id: scopedSchoolId },
    });
  }

  async listEduPayAssignments(params?: {
    school_id?: number | string;
    status?: 'paid' | 'pending' | 'overdue';
    student_id?: number;
  }) {
    const scopedSchoolId =
      params?.school_id && String(params.school_id) !== '1'
        ? String(params.school_id)
        : await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) {
      throw new Error('Active school context is required to load EduPay assignments');
    }
    return this.api.get<EduPayAssignment[]>('/edupay/assignments', {
      params: {
        ...params,
        school_id: scopedSchoolId,
      },
    });
  }

  async listEduPayPayments(schoolId: number = 1) {
    const scopedSchoolId = schoolId && String(schoolId) !== '1'
      ? String(schoolId)
      : await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) {
      throw new Error('Active school context is required to load EduPay payments');
    }
    return this.api.get<EduPayPayment[]>('/edupay/payments', {
      params: { school_id: scopedSchoolId },
    });
  }

  async createEduPayPayment(
    data: {
      assignment_id: number;
      amount: number;
      method: 'upi' | 'card' | 'net_banking' | 'wallet' | 'cash';
      payment_date?: string;
      transaction_reference?: string;
    },
    schoolId: number | string = 1
  ) {
    const scopedSchoolId = schoolId && String(schoolId) !== '1'
      ? String(schoolId)
      : await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) {
      throw new Error('Active school context is required to create an EduPay payment');
    }
    return this.api.post<EduPayPayment>('/edupay/payments', data, {
      params: { school_id: scopedSchoolId },
    });
  }

  async getEduPayParentPortal(schoolId: number | string = 1, parentId?: number) {
    const scopedSchoolId = schoolId && String(schoolId) !== '1'
      ? String(schoolId)
      : await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) {
      throw new Error('Active school context is required to load the EduPay parent portal');
    }
    return this.api.get<EduPayParentPortal>('/edupay/parent-portal', {
      params: { school_id: scopedSchoolId, parent_id: parentId },
    });
  }

  // ==================== Attendance ====================

  async getAttendanceOverview(schoolId: number | string = 1) {
    const scopedSchoolId = await this.resolveScopedSchoolId(schoolId);
    if (!scopedSchoolId) {
      throw new Error('Active school context is required to load attendance overview');
    }
    return this.api.get<AttendanceOverview>('/attendance/overview', {
      params: { school_id: scopedSchoolId },
    });
  }

  async listAttendanceStudents(params?: { school_id?: number | string; skip?: number; limit?: number; search?: string }) {
    const scopedSchoolId = await this.resolveScopedSchoolId(params?.school_id);
    if (!scopedSchoolId) {
      throw new Error('Active school context is required to load attendance students');
    }
    return this.api.get<AttendanceStudent[]>('/attendance/students', {
      params: {
        ...params,
        school_id: scopedSchoolId,
      },
    });
  }

  async createAttendanceStudent(
    data: {
      name: string;
      class_name: string;
      section: string;
      roll_no: string;
      parent_contact?: string;
    },
    schoolId: number | string = 1
  ) {
    const scopedSchoolId = await this.resolveScopedSchoolId(schoolId);
    if (!scopedSchoolId) {
      throw new Error('Active school context is required to create attendance students');
    }
    return this.api.post<AttendanceStudent>('/attendance/students', data, {
      params: { school_id: scopedSchoolId },
    });
  }

  async listAttendanceStaff(params?: { school_id?: number | string; skip?: number; limit?: number; search?: string }) {
    const scopedSchoolId = await this.resolveScopedSchoolId(params?.school_id);
    if (!scopedSchoolId) {
      throw new Error('Active school context is required to load attendance staff');
    }
    return this.api.get<AttendanceStaff[]>('/attendance/staff', {
      params: {
        ...params,
        school_id: scopedSchoolId,
      },
    });
  }

  async createAttendanceStaff(
    data: {
      staff_id: string;
      name: string;
      department: string;
      designation?: string;
      shift?: string;
      email?: string;
      phone?: string;
    },
    schoolId: number | string = 1
  ) {
    const scopedSchoolId = await this.resolveScopedSchoolId(schoolId);
    if (!scopedSchoolId) {
      throw new Error('Active school context is required to create attendance staff');
    }
    return this.api.post<AttendanceStaff>('/attendance/staff', data, {
      params: { school_id: scopedSchoolId },
    });
  }

  async listAttendanceSubjects(schoolId: number | string = 1) {
    const scopedSchoolId = await this.resolveScopedSchoolId(schoolId);
    if (!scopedSchoolId) {
      throw new Error('Active school context is required to load attendance subjects');
    }
    return this.api.get<AttendanceSubject[]>('/attendance/subjects', {
      params: { school_id: scopedSchoolId },
    });
  }

  async createAttendanceSubject(
    data: { name: string; class_name: string; section: string },
    schoolId: number | string = 1
  ) {
    const scopedSchoolId = await this.resolveScopedSchoolId(schoolId);
    if (!scopedSchoolId) {
      throw new Error('Active school context is required to create attendance subjects');
    }
    return this.api.post<AttendanceSubject>('/attendance/subjects', data, {
      params: { school_id: scopedSchoolId },
    });
  }

  async getTeacherAttendanceContext(params?: {
    target_date?: string;
    current_time?: string;
    school_id?: number | string;
  }) {
    const scopedSchoolId = await this.resolveScopedSchoolId(params?.school_id);
    if (!scopedSchoolId) {
      throw new Error('Active school context is required to load teacher attendance context');
    }
    return this.api.get<TeacherAttendanceContext>('/attendance/teacher-current-class', {
      params: {
        ...params,
        school_id: scopedSchoolId,
      },
    });
  }

  async getBatchAttendanceContext(params: {
    class_name: string;
    section: string;
    target_date?: string;
    current_time?: string;
    school_id?: number | string;
  }) {
    const scopedSchoolId = await this.resolveScopedSchoolId(params?.school_id);
    if (!scopedSchoolId) {
      throw new Error('Active school context is required to load batch attendance context');
    }
    return this.api.get<TeacherAttendanceContext>('/attendance/batch-current-class', {
      params: {
        ...params,
        school_id: scopedSchoolId,
      },
    });
  }

  async getStudentAttendanceMarking(params: {
    date: string;
    class_name: string;
    section: string;
    subject_id: number;
    search?: string;
    school_id?: number | string;
  }) {
    const scopedSchoolId = await this.resolveScopedSchoolId(params?.school_id);
    if (!scopedSchoolId) {
      throw new Error('Active school context is required to load student attendance marking');
    }
    const scopedParams = { ...params, school_id: scopedSchoolId };
    try {
      return await this.api.get<StudentAttendanceMarkingResponse>('/attendance/student-marking', { params: scopedParams });
    } catch (error: any) {
      if (!this.isDatetimeValidationError(error)) throw error;
      const retryParams = { ...scopedParams, date: this.toDateTimeString(params.date) || params.date };
      return this.api.get<StudentAttendanceMarkingResponse>('/attendance/student-marking', { params: retryParams });
    }
  }

  async saveStudentAttendance(
    data: {
      date: string;
      subject_id: number;
      marked_by?: string;
      entries: Array<{ student_id: number; status: 'present' | 'absent' | 'late'; absence_reason?: string }>;
    },
    schoolId: number | string = 1
  ) {
    const scopedSchoolId = await this.resolveScopedSchoolId(schoolId);
    if (!scopedSchoolId) {
      throw new Error('Active school context is required to save student attendance');
    }
    try {
      return await this.api.post('/attendance/student-marking', data, {
        params: { school_id: scopedSchoolId },
      });
    } catch (error: any) {
      if (!this.isDatetimeValidationError(error)) throw error;
      const retryData = { ...data, date: this.toDateTimeString(data.date) || data.date };
      return this.api.post('/attendance/student-marking', retryData, {
        params: { school_id: scopedSchoolId },
      });
    }
  }

  async listStudentAttendanceRecords(params?: {
    school_id?: number | string;
    class_name?: string;
    section?: string;
    student_name?: string;
    date_from?: string;
    date_to?: string;
    skip?: number;
    limit?: number;
  }) {
    const scopedSchoolId = await this.resolveScopedSchoolId(params?.school_id);
    if (!scopedSchoolId) {
      throw new Error('Active school context is required to load student attendance records');
    }
    const scopedParams = {
      ...params,
      school_id: scopedSchoolId,
    };
    try {
      return await this.api.get<StudentAttendanceRecord[]>('/attendance/student-records', { params: scopedParams });
    } catch (error: any) {
      if (!this.isDatetimeValidationError(error) || !params) throw error;
      const retryParams = {
        ...scopedParams,
        date_from: this.toDateTimeString(params.date_from),
        date_to: this.toDateTimeString(params.date_to, true),
      };
      return this.api.get<StudentAttendanceRecord[]>('/attendance/student-records', { params: retryParams });
    }
  }

  async deleteStudentAttendanceRecord(recordId: number | string, schoolId: number | string = 1) {
    const scopedSchoolId = await this.resolveScopedSchoolId(schoolId);
    if (!scopedSchoolId) {
      throw new Error('Active school context is required to delete student attendance records');
    }
    return this.api.delete(`/attendance/student-records/${recordId}`, {
      params: { school_id: scopedSchoolId },
    });
  }

  async deleteAllStudentAttendanceRecords(params?: {
    school_id?: number | string;
    class_name?: string;
    section?: string;
    student_name?: string;
    date_from?: string;
    date_to?: string;
  }) {
    const scopedSchoolId = await this.resolveScopedSchoolId(params?.school_id);
    if (!scopedSchoolId) {
      throw new Error('Active school context is required to delete student attendance records');
    }
    return this.api.delete('/attendance/student-records', {
      params: {
        ...params,
        school_id: scopedSchoolId,
      },
    });
  }

  async getStudentAttendanceDashboard(studentId: number | string, schoolId: number | string = 1) {
    const scopedSchoolId = await this.resolveScopedSchoolId(schoolId);
    if (!scopedSchoolId) {
      throw new Error('Active school context is required to load student attendance dashboard');
    }
    return this.api.get<StudentDashboard>(`/attendance/student-dashboard/${studentId}`, {
      params: { school_id: scopedSchoolId },
    });
  }

  async getStaffAttendanceMarking(params: {
    date: string;
    department: string;
    search?: string;
    school_id?: number | string;
  }) {
    const scopedSchoolId = await this.resolveScopedSchoolId(params?.school_id);
    if (!scopedSchoolId) {
      throw new Error('Active school context is required to load staff attendance marking');
    }
    const scopedParams = { ...params, school_id: scopedSchoolId };
    try {
      return await this.api.get<StaffAttendanceMarkingResponse>('/attendance/staff-marking', { params: scopedParams });
    } catch (error: any) {
      if (!this.isDatetimeValidationError(error)) throw error;
      const retryParams = { ...scopedParams, date: this.toDateTimeString(params.date) || params.date };
      return this.api.get<StaffAttendanceMarkingResponse>('/attendance/staff-marking', { params: retryParams });
    }
  }

  async saveStaffAttendance(
    data: {
      date: string;
      marked_by?: string;
      entries: Array<{
        staff_member_id: number;
        status: 'present' | 'absent' | 'late' | 'half_day';
        check_in?: string;
        check_out?: string;
      }>;
    },
    schoolId: number | string = 1
  ) {
    const scopedSchoolId = await this.resolveScopedSchoolId(schoolId);
    if (!scopedSchoolId) {
      throw new Error('Active school context is required to save staff attendance');
    }
    try {
      return await this.api.post('/attendance/staff-marking', data, {
        params: { school_id: scopedSchoolId },
      });
    } catch (error: any) {
      if (!this.isDatetimeValidationError(error)) throw error;
      const retryData = { ...data, date: this.toDateTimeString(data.date) || data.date };
      return this.api.post('/attendance/staff-marking', retryData, {
        params: { school_id: scopedSchoolId },
      });
    }
  }

  async listStaffAttendanceRecords(params?: {
    school_id?: number | string;
    department?: string;
    staff_name?: string;
    date_from?: string;
    date_to?: string;
    skip?: number;
    limit?: number;
  }) {
    const scopedSchoolId = await this.resolveScopedSchoolId(params?.school_id);
    if (!scopedSchoolId) {
      throw new Error('Active school context is required to load staff attendance records');
    }
    const scopedParams = {
      ...params,
      school_id: scopedSchoolId,
    };
    try {
      return await this.api.get<StaffAttendanceRecord[]>('/attendance/staff-records', { params: scopedParams });
    } catch (error: any) {
      if (!this.isDatetimeValidationError(error) || !params) throw error;
      const retryParams = {
        ...scopedParams,
        date_from: this.toDateTimeString(params.date_from),
        date_to: this.toDateTimeString(params.date_to, true),
      };
      return this.api.get<StaffAttendanceRecord[]>('/attendance/staff-records', { params: retryParams });
    }
  }

  async deleteStaffAttendanceRecord(recordId: number | string, schoolId: number | string = 1) {
    const scopedSchoolId = await this.resolveScopedSchoolId(schoolId);
    if (!scopedSchoolId) {
      throw new Error('Active school context is required to delete staff attendance records');
    }
    return this.api.delete(`/attendance/staff-records/${recordId}`, {
      params: { school_id: scopedSchoolId },
    });
  }

  async deleteAllStaffAttendanceRecords(params?: {
    school_id?: number | string;
    department?: string;
    staff_name?: string;
    date_from?: string;
    date_to?: string;
  }) {
    const scopedSchoolId = await this.resolveScopedSchoolId(params?.school_id);
    if (!scopedSchoolId) {
      throw new Error('Active school context is required to delete staff attendance records');
    }
    return this.api.delete('/attendance/staff-records', {
      params: {
        ...params,
        school_id: scopedSchoolId,
      },
    });
  }

  async getStaffAttendanceDashboard(params?: {
    school_id?: number | string;
    department?: string;
    date_from?: string;
    date_to?: string;
  }) {
    const scopedSchoolId = await this.resolveScopedSchoolId(params?.school_id);
    if (!scopedSchoolId) {
      throw new Error('Active school context is required to load staff attendance dashboard');
    }
    const scopedParams = {
      ...params,
      school_id: scopedSchoolId,
    };
    try {
      return await this.api.get<StaffDashboard>('/attendance/staff-dashboard', { params: scopedParams });
    } catch (error: any) {
      if (!this.isDatetimeValidationError(error) || !params) throw error;
      const retryParams = {
        ...scopedParams,
        date_from: this.toDateTimeString(params.date_from),
        date_to: this.toDateTimeString(params.date_to, true),
      };
      return this.api.get<StaffDashboard>('/attendance/staff-dashboard', { params: retryParams });
    }
  }

  async listAttendanceLeaves(params?: { school_id?: number | string; status?: 'pending' | 'approved' | 'rejected' }) {
    const scopedSchoolId = await this.resolveScopedSchoolId(params?.school_id);
    if (!scopedSchoolId) {
      throw new Error('Active school context is required to load attendance leaves');
    }
    return this.api.get<AttendanceLeave[]>('/attendance/leaves', {
      params: {
        ...params,
        school_id: scopedSchoolId,
      },
    });
  }

  async createAttendanceLeave(
    data: {
      staff_member_id: number;
      leave_type: 'casual' | 'sick' | 'paid' | 'emergency';
      from_date: string;
      to_date: string;
      reason?: string;
    },
    schoolId: number | string = 1
  ) {
    const scopedSchoolId = await this.resolveScopedSchoolId(schoolId);
    if (!scopedSchoolId) {
      throw new Error('Active school context is required to create attendance leave');
    }
    try {
      return await this.api.post<AttendanceLeave>('/attendance/leaves', data, {
        params: { school_id: scopedSchoolId },
      });
    } catch (error: any) {
      if (!this.isDatetimeValidationError(error)) throw error;
      const retryData = {
        ...data,
        from_date: this.toDateTimeString(data.from_date) || data.from_date,
        to_date: this.toDateTimeString(data.to_date, true) || data.to_date,
      };
      return this.api.post<AttendanceLeave>('/attendance/leaves', retryData, {
        params: { school_id: scopedSchoolId },
      });
    }
  }

  async decideAttendanceLeave(
    leaveId: number,
    data: { status: 'approved' | 'rejected'; approved_by: string },
    schoolId: number | string = 1
  ) {
    const scopedSchoolId = await this.resolveScopedSchoolId(schoolId);
    if (!scopedSchoolId) {
      throw new Error('Active school context is required to decide attendance leave');
    }
    return this.api.post<AttendanceLeave>(`/attendance/leaves/${leaveId}/decision`, data, {
      params: { school_id: scopedSchoolId },
    });
  }

  async deleteAttendanceLeave(leaveId: number | string, schoolId: number | string = 1) {
    const scopedSchoolId = await this.resolveScopedSchoolId(schoolId);
    if (!scopedSchoolId) {
      throw new Error('Active school context is required to delete attendance leave');
    }
    return this.api.delete(`/attendance/leaves/${leaveId}`, {
      params: { school_id: scopedSchoolId },
    });
  }

  async deleteAllAttendanceLeaves(params?: { school_id?: number | string; status?: 'pending' | 'approved' | 'rejected' }) {
    const scopedSchoolId = await this.resolveScopedSchoolId(params?.school_id);
    if (!scopedSchoolId) {
      throw new Error('Active school context is required to delete attendance leaves');
    }
    return this.api.delete('/attendance/leaves', {
      params: {
        ...params,
        school_id: scopedSchoolId,
      },
    });
  }

  async listAttendanceNotifications(schoolId: number | string = 1) {
    const scopedSchoolId = await this.resolveScopedSchoolId(schoolId);
    if (!scopedSchoolId) {
      throw new Error('Active school context is required to load attendance notifications');
    }
    return this.api.get<AttendanceNotification[]>('/attendance/notifications', {
      params: { school_id: scopedSchoolId },
    });
  }

  async deleteAttendanceNotification(notificationId: number | string, schoolId: number | string = 1) {
    const scopedSchoolId = await this.resolveScopedSchoolId(schoolId);
    if (!scopedSchoolId) {
      throw new Error('Active school context is required to delete attendance notifications');
    }
    return this.api.delete(`/attendance/notifications/${notificationId}`, {
      params: { school_id: scopedSchoolId },
    });
  }

  async deleteAllAttendanceNotifications(schoolId: number | string = 1) {
    const scopedSchoolId = await this.resolveScopedSchoolId(schoolId);
    if (!scopedSchoolId) {
      throw new Error('Active school context is required to delete attendance notifications');
    }
    return this.api.delete('/attendance/notifications', {
      params: { school_id: scopedSchoolId },
    });
  }

  async listAttendanceHolidays(schoolId: number | string = 1) {
    const scopedSchoolId = await this.resolveScopedSchoolId(schoolId);
    if (!scopedSchoolId) {
      throw new Error('Active school context is required to load attendance holidays');
    }
    return this.api.get<AttendanceHoliday[]>('/attendance/holidays', {
      params: { school_id: scopedSchoolId },
    });
  }

  async deleteAttendanceHoliday(holidayId: number | string, schoolId: number | string = 1) {
    const scopedSchoolId = await this.resolveScopedSchoolId(schoolId);
    if (!scopedSchoolId) {
      throw new Error('Active school context is required to delete attendance holidays');
    }
    return this.api.delete(`/attendance/holidays/${holidayId}`, {
      params: { school_id: scopedSchoolId },
    });
  }

  async deleteAllAttendanceHolidays(schoolId: number | string = 1) {
    const scopedSchoolId = await this.resolveScopedSchoolId(schoolId);
    if (!scopedSchoolId) {
      throw new Error('Active school context is required to delete attendance holidays');
    }
    return this.api.delete('/attendance/holidays', {
      params: { school_id: scopedSchoolId },
    });
  }

  async createAttendanceHoliday(
    data: { title: string; holiday_date: string; description?: string },
    schoolId: number | string = 1
  ) {
    const scopedSchoolId = await this.resolveScopedSchoolId(schoolId);
    if (!scopedSchoolId) {
      throw new Error('Active school context is required to create attendance holidays');
    }
    try {
      return await this.api.post<AttendanceHoliday>('/attendance/holidays', data, {
        params: { school_id: scopedSchoolId },
      });
    } catch (error: any) {
      if (!this.isDatetimeValidationError(error)) throw error;
      const retryData = {
        ...data,
        holiday_date: this.toDateTimeString(data.holiday_date) || data.holiday_date,
      };
      return this.api.post<AttendanceHoliday>('/attendance/holidays', retryData, {
        params: { school_id: scopedSchoolId },
      });
    }
  }

  async getAttendanceSettings(schoolId: number | string = 1) {
    const scopedSchoolId = await this.resolveScopedSchoolId(schoolId);
    if (!scopedSchoolId) {
      throw new Error('Active school context is required to load attendance settings');
    }
    return this.api.get<AttendanceSettings>('/attendance/settings', {
      params: { school_id: scopedSchoolId },
    });
  }

  async updateAttendanceSettings(
    data: { minimum_attendance_threshold: number; working_hours_start: string; working_hours_end: string },
    schoolId: number | string = 1
  ) {
    const scopedSchoolId = await this.resolveScopedSchoolId(schoolId);
    if (!scopedSchoolId) {
      throw new Error('Active school context is required to update attendance settings');
    }
    return this.api.put<AttendanceSettings>('/attendance/settings', data, {
      params: { school_id: scopedSchoolId },
    });
  }

  async getAttendanceReportData(params: {
    report_type: 'student_summary' | 'staff_summary' | 'leave_summary';
    school_id?: number | string;
    batch_names?: string;
    department?: string;
    date_from?: string;
    date_to?: string;
  }) {
    const scopedSchoolId = await this.resolveScopedSchoolId(params?.school_id);
    if (!scopedSchoolId) {
      throw new Error('Active school context is required to load attendance report data');
    }
    const scopedParams = {
      ...params,
      school_id: scopedSchoolId,
    };
    try {
      return await this.api.get<AttendanceReportResponse>('/attendance/reports/data', { params: scopedParams });
    } catch (error: any) {
      if (!this.isDatetimeValidationError(error)) throw error;
      const retryParams = {
        ...scopedParams,
        date_from: this.toDateTimeString(params.date_from),
        date_to: this.toDateTimeString(params.date_to, true),
      };
      return this.api.get<AttendanceReportResponse>('/attendance/reports/data', { params: retryParams });
    }
  }

async exportAttendanceReport(params: {
    report_type: 'student_summary' | 'staff_summary' | 'leave_summary';
    export_format: 'excel' | 'pdf';
    school_id?: number | string;
    batch_names?: string;
    department?: string;
    date_from?: string;
    date_to?: string;
  }) {
    const scopedSchoolId = await this.resolveScopedSchoolId(params?.school_id);
    if (!scopedSchoolId) {
      throw new Error('Active school context is required to export attendance reports');
    }
    const scopedParams = {
      ...params,
      school_id: scopedSchoolId,
    };
    try {
      return await this.api.get('/attendance/reports/export', {
        params: scopedParams,
        responseType: 'blob',
      });
    } catch (error: any) {
      if (!this.isDatetimeValidationError(error)) throw error;
      const retryParams = {
        ...scopedParams,
        date_from: this.toDateTimeString(params.date_from),
        date_to: this.toDateTimeString(params.date_to, true),
      };
      return this.api.get('/attendance/reports/export', {
        params: retryParams,
        responseType: 'blob',
      });
    }
  }

  async listIntegratedStudents(params?: { school_id?: number | string; skip?: number; limit?: number; search?: string; batch?: string }) {
    const scopedSchoolId = await this.resolveScopedSchoolId(params?.school_id);
    if (!scopedSchoolId) {
      throw new Error('Active school context is required to load integrated attendance students');
    }
    const scopedParams = {
      ...params,
      school_id: scopedSchoolId,
    };
    try {
      return await this.api.get<AttendanceStudent[]>('/attendance/integrated-students', { params: scopedParams });
    } catch (error) {
      console.warn('[API] listIntegratedStudents fallback activated', error);
      const studentsResponse = await this.listStudents(1, params?.skip || 0, params?.limit || 500, params?.batch);
      const searchTerm = String(params?.search || '').trim().toLowerCase();
      const normalized = toArray<Student>(studentsResponse.data)
        .filter((student) => {
          if (!searchTerm) return true;
          return [student.name, student.roll_number, student.father_name, student.batch]
            .some((value) => String(value || '').toLowerCase().includes(searchTerm));
        })
        .map((student) => ({
          id: Number(student.id || 0),
          name: String(student.name || ''),
          class_name: String(student.class_name || student.batch || 'General'),
          section: String(student.section || 'A'),
          roll_no: String(student.roll_number || ''),
          parent_contact: String(student.phone || ''),
          is_active: Boolean(student.is_active ?? true),
        }));
      return { data: normalized } as { data: AttendanceStudent[] };
    }
  }

  async listIntegratedStaff(params?: { school_id?: number | string; skip?: number; limit?: number; search?: string; department?: string; source?: 'teachers' | 'invigilators' | 'all' }) {
    const scopedSchoolId = await this.resolveScopedSchoolId(params?.school_id);
    if (!scopedSchoolId) {
      throw new Error('Active school context is required to load integrated attendance staff');
    }
    const scopedParams = {
      ...params,
      school_id: scopedSchoolId,
    };
    try {
      return await this.api.get<AttendanceStaff[]>('/attendance/integrated-staff', { params: scopedParams });
    } catch (error) {
      console.warn('[API] listIntegratedStaff fallback activated', error);
      const source = params?.source || 'all';
      const searchTerm = String(params?.search || '').trim().toLowerCase();
      const departmentFilter = String(params?.department || '').trim().toLowerCase();
      const [teachersResponse, invigilatorsResponse] = await Promise.all([
        source === 'invigilators' ? Promise.resolve({ data: [] as Teacher[] }) : this.listTeachers(1, params?.skip || 0, params?.limit || 500),
        source === 'teachers' ? Promise.resolve({ data: [] as Invigilator[] }) : this.listInvigilators(1),
      ]);

      const mappedTeachers = toArray<Teacher>(teachersResponse.data).map((teacher) => ({
        id: Number(teacher.id || 0),
        staff_id: teacher.employee_code || `TCH-${teacher.id}`,
        name: String(teacher.name || ''),
        department: String(teacher.subject || teacher.department || 'Academics'),
        designation: teacher.designation || 'Teacher',
        email: teacher.email,
        phone: teacher.phone,
      }));
      const mappedInvigilators = toArray<Invigilator>(invigilatorsResponse.data).map((invigilator) => ({
        id: Number(invigilator.id || 0),
        staff_id: String(invigilator.staff_id || ''),
        name: String(invigilator.name || ''),
        department: String(invigilator.department || invigilator.designation || 'Staff'),
        designation: invigilator.designation,
        email: invigilator.email,
        phone: invigilator.phone,
      }));

      const filtered = [...mappedTeachers, ...mappedInvigilators].filter((staff) => {
        const matchesSearch = !searchTerm || [staff.name, staff.staff_id, staff.department, staff.designation]
          .some((value) => String(value || '').toLowerCase().includes(searchTerm));
        const matchesDepartment = !departmentFilter || String(staff.department || '').toLowerCase().includes(departmentFilter);
        return matchesSearch && matchesDepartment;
      });

      return { data: filtered } as { data: AttendanceStaff[] };
    }
  }

  async getIntegratedAttendanceOverview(schoolId: number | string = 1) {
    const scopedSchoolId = await this.resolveScopedSchoolId(schoolId);
    if (!scopedSchoolId) {
      throw new Error('Active school context is required to load integrated attendance overview');
    }
    try {
      return await this.api.get('/attendance/integrated-overview', {
        params: { school_id: scopedSchoolId },
      });
    } catch (error) {
      console.warn('[API] getIntegratedAttendanceOverview fallback activated', error);
      const [studentsResponse, teachersResponse, invigilatorsResponse] = await Promise.all([
        this.listStudents(),
        this.listTeachers(),
        this.listInvigilators(1),
      ]);
      const students = toArray<Student>(studentsResponse.data);
      const teachers = toArray<Teacher>(teachersResponse.data);
      const invigilators = toArray<Invigilator>(invigilatorsResponse.data);
      const classOptions = Array.from(new Set(students.map((student) => String(student.class_name || '').trim()).filter(Boolean))).sort();
      const sectionOptions = Array.from(new Set(students.map((student) => String(student.section || '').trim()).filter(Boolean))).sort();
      const departmentOptions = Array.from(
        new Set(
          [...teachers.map((teacher) => teacher.subject || teacher.department), ...invigilators.map((item) => item.department || item.designation)]
            .map((value) => String(value || '').trim())
            .filter(Boolean)
        )
      ).sort();
      return {
        data: {
          student_count: students.length,
          staff_count: teachers.length + invigilators.length,
          class_options: classOptions,
          section_options: sectionOptions,
          subject_options: [],
          department_options: departmentOptions,
          notifications: [],
          holidays: [],
          settings: {
            minimum_attendance_threshold: 75,
            working_hours_start: '09:00',
            working_hours_end: '17:00',
            updated_at: new Date().toISOString(),
          },
        },
      };
    }
  }
}

export const apiService = new ApiService();
