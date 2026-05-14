import axios, { AxiosInstance } from 'axios';
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

const MAX_GET_RETRIES = 2;
const RETRYABLE_STATUS_CODES = new Set([502, 503, 504]);
const API_TIMEOUT_MS = 60000;
const DIRECT_API_FALLBACKS = [
  'http://127.0.0.1:8000/api',
  'http://127.0.0.1:8010/api',
];

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class ApiService {
  private api: AxiosInstance;
  private studentIdMap = new Map<number, string>();
  private studentReverseIdMap = new Map<string, number>();
  private teacherIdMap = new Map<number, string>();
  private teacherReverseIdMap = new Map<string, number>();
  private invigilatorIdMap = new Map<number, string>();
  private invigilatorReverseIdMap = new Map<string, number>();

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
    return user?.school_id || user?.default_school_id || null;
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

  private compactObject<T extends Record<string, unknown>>(value: T) {
    return Object.fromEntries(
      Object.entries(value).filter(([, entry]) => entry !== undefined)
    ) as T;
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
      subject: staffMember.metadata?.subject || staffMember.department || '',
      school_id: 1,
      email: staffMember.email || undefined,
      phone: staffMember.phone || undefined,
      is_active: Boolean(staffMember.is_active),
      created_at: staffMember.created_at,
      updated_at: staffMember.updated_at,
    };
  }

  private mapSupabaseInvigilatorToLegacy(staffMember: any): Invigilator {
    return {
      id: this.getLegacyMappedId('invigilator', staffMember.id),
      staff_id: staffMember.employee_code || '',
      name: staffMember.full_name || '',
      school_id: 1,
      email: staffMember.email || undefined,
      phone: staffMember.phone || undefined,
      department: staffMember.department || undefined,
      designation: staffMember.designation || undefined,
      is_active: Boolean(staffMember.is_active),
      created_at: staffMember.created_at,
      updated_at: staffMember.updated_at,
    };
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
      baseURL: "/api",
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
      const currentUser = useAuthStore.getState().user;
      config.headers = config.headers || {};

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
          typeof window !== 'undefined' &&
          ['localhost', '127.0.0.1'].includes(window.location.hostname) &&
          (config?.__directFallbackIndex ?? 0) < DIRECT_API_FALLBACKS.length;

        if (!config) {
          return Promise.reject(error);
        }

        if (!shouldRetry && shouldTryDirectFallback) {
          const fallbackIndex = config.__directFallbackIndex ?? 0;
          config.__directFallbackIndex = fallbackIndex + 1;
          config.__usingDirectFallback = true;
          config.baseURL = DIRECT_API_FALLBACKS[fallbackIndex];
          await delay(300);
          return this.api.request(config);
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
            typeof window !== 'undefined' &&
            ['localhost', '127.0.0.1'].includes(window.location.hostname) &&
            (config.__directFallbackIndex ?? 0) < DIRECT_API_FALLBACKS.length;

          if (!shouldRetryFallback) {
            return Promise.reject(retryError);
          }

          const fallbackIndex = config.__directFallbackIndex ?? 0;
          config.__directFallbackIndex = fallbackIndex + 1;
          config.__usingDirectFallback = true;
          config.baseURL = DIRECT_API_FALLBACKS[fallbackIndex];
          await delay(300);
          return this.api.request(config);
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
        typeof window !== 'undefined' &&
        ['localhost', '127.0.0.1'].includes(window.location.hostname)
      ) {
        for (const baseURL of DIRECT_API_FALLBACKS) {
          try {
            const response = await axios.post<AuthResponse>(`${baseURL}/auth/login-password`, credentials);
            return response;
          } catch {
            // Try next direct URL.
          }
        }
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

  async importStudents(formData: FormData, schoolId: number = 1) {
    return this.api.post('/students/import', formData, {
      params: { school_id: schoolId },
    });
  }

  async createStudent(studentData: Partial<Student>, _schoolId: number = 1) {
    const scopedSchoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) throw new Error('No active school membership found.');

    const requestedBatchName = String((studentData as any).batch || '').trim();
    const matchedBatch = await this.findSupabaseBatchByName(requestedBatchName, scopedSchoolId);
    const metadata = this.compactObject({
      ...(typeof (studentData as any).metadata === 'object' && (studentData as any).metadata ? (studentData as any).metadata : {}),
      managed_batch: requestedBatchName || undefined,
      reference_name: (studentData as any).reference_name || undefined,
      reference_number: (studentData as any).reference_number || undefined,
      reference_remark: (studentData as any).reference_remark || undefined,
      preferred_hostel_id: (studentData as any).preferred_hostel_id || undefined,
      hostel_notes: (studentData as any).hostel_notes || undefined,
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
    const metadata = this.compactObject({
      ...(existing?.metadata || {}),
      ...(typeof (data as any).metadata === 'object' && (data as any).metadata ? (data as any).metadata : {}),
      managed_batch: requestedBatchName || (existing?.metadata?.managed_batch as string | undefined),
      reference_name: (data as any).reference_name ?? existing?.metadata?.reference_name,
      reference_number: (data as any).reference_number ?? existing?.metadata?.reference_number,
      reference_remark: (data as any).reference_remark ?? existing?.metadata?.reference_remark,
      preferred_hostel_id: (data as any).preferred_hostel_id ?? existing?.metadata?.preferred_hostel_id,
      hostel_notes: (data as any).hostel_notes ?? existing?.metadata?.hostel_notes,
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
    const { error } = await supabase.from('students').delete().eq('id', resolvedId);
    if (error) throw error;
    return { data: { message: 'Student deleted successfully' } } as { data: { message: string } };
  }

  async deleteAllStudents(isAdmin: boolean = false, _schoolId: number = 1) {
    const scopedSchoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) throw new Error('No active school membership found.');
    const { error } = await supabase.from('students').delete().eq('school_id', scopedSchoolId);
    if (error) throw error;
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
    return this.api.get<StudentHostelRequest[]>('/students/hostel-requests', {
      params: { school_id: schoolId, status_filter: statusFilter },
    });
  }

  async createStudentHostelRequest(studentId: number, data: { hostel_id: number; requested_notes?: string }, _schoolId: number = 1) {
    return this.api.post<StudentHostelRequest>(`/students/${studentId}/hostel-request`, data, {
      params: { school_id: _schoolId },
    });
  }

  async approveStudentHostelRequest(requestId: string | number, data: { hostel_id?: number | string; room_id?: number | string; reviewed_by?: string; review_notes?: string }, _schoolId: number = 1) {
    return this.api.post<StudentHostelRequest>(`/students/hostel-requests/${requestId}/approve`, data, {
      params: { school_id: _schoolId },
    });
  }

  async moveStudentHostelAllocation(requestId: string | number, data: { hostel_id?: number | string; room_id?: number | string; reviewed_by?: string; review_notes?: string }, _schoolId: number = 1) {
    return this.api.post<StudentHostelRequest>(`/students/hostel-requests/${requestId}/move`, data, {
      params: { school_id: _schoolId },
    });
  }

  async rejectStudentHostelRequest(requestId: string | number, data: { reviewed_by?: string; review_notes?: string }, _schoolId: number = 1) {
    return this.api.post<StudentHostelRequest>(`/students/hostel-requests/${requestId}/reject`, data, {
      params: { school_id: _schoolId },
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

  async deleteAllRooms(isAdmin: boolean = false, schoolId: number = 1) {
    return this.api.delete('/rooms', {
      params: { school_id: schoolId, is_admin: isAdmin },
    });
  }

  // ==================== Seating Plans ====================

  async generateSeatingPlans(examId: number, roomIds: Array<string | number>, planType?: 'strict' | 'compact' | 'all_in_one', batches?: string[], invigilatorAssignments?: {[roomId: string]: number | null}, generatedDate?: string, batchConflictGroups?: string[][]) {
    return this.api.post('/seating/generate', {
      exam_id: examId,
      room_ids: roomIds,
      batches,
      batch_conflict_groups: batchConflictGroups,
      plan_type: planType,
      generated_date: generatedDate,
      invigilator_assignments: invigilatorAssignments,
    });
  }

  async listPlans(roomId: number, examId?: number) {
    return this.api.get<SeatingPlan[]>(`/seating/plans/${roomId}`, {
      params: { exam_id: examId },
    });
  }

  async listAllPlans(examId?: number) {
    return this.api.get<SeatingPlan[]>('/seating/plans', {
      params: { exam_id: examId },
    });
  }

  async getPlanLayout(planId: number) {
    return this.api.get<RoomLayout>(`/seating/${planId}/layout`);
  }

  async finalizePlan(planId: number) {
    return this.api.post(`/seating/${planId}/finalize`);
  }

  async deleteSeatingPlan(planId: number) {
    return this.api.delete(`/seating/${planId}`);
  }

  async deleteAllSeatingPlans(isAdmin: boolean = false, schoolId: number = 1) {
    return this.api.delete('/seating', {
      params: { school_id: schoolId, is_admin: isAdmin },
    });
  }

  async importSeatingPlan(formData: FormData, examId?: number) {
    return this.api.post('/seating/import', formData, {
      params: { exam_id: examId },
    });
  }

  // ==================== Exams ====================

  async listExams(schoolId: number = 1) {
    return this.api.get<Exam[]>('/exams', {
      params: { school_id: schoolId },
    });
  }

  async createExam(examData: Partial<Exam>, schoolId: number = 1) {
    return this.api.post<Exam>('/exams', examData, {
      params: { school_id: schoolId },
    });
  }

  async updateExam(examId: number, examData: Partial<Exam>, schoolId: number = 1) {
    return this.api.put<Exam>(`/exams/${examId}`, examData, {
      params: { school_id: schoolId },
    });
  }

  async deleteExam(examId: number, schoolId: number = 1) {
    return this.api.delete(`/exams/${examId}`, {
      params: { school_id: schoolId },
    });
  }

  // ==================== Reports ====================

  async exportPDF(planId: number) {
    return this.api.get(`/reports/pdf/${planId}`, {
      responseType: 'blob',
    });
  }

  async exportExcel(planId: number) {
    return this.api.get(`/reports/excel/${planId}`, {
      responseType: 'blob',
    });
  }

  async exportAllRoomsExcel(examId: number, planType?: 'strict' | 'compact' | 'all_in_one') {
    return this.api.get(`/reports/excel/all-rooms/${examId}`, {
      params: { plan_type: planType },
      responseType: 'blob',
    });
  }

  // ==================== Teachers ====================

  async createTeacher(teacherData: Partial<Teacher>, _schoolId: number = 1) {
    const scopedSchoolId = await this.resolveCurrentSupabaseSchoolId();
    if (!scopedSchoolId) throw new Error('No active school membership found.');

    const employeeCode = `TCH-${Date.now().toString().slice(-8)}`;
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
        designation: 'Teacher',
        employment_status: teacherData.is_active === false ? 'inactive' : 'active',
        is_active: teacherData.is_active ?? true,
        metadata: {
          subject: teacherData.subject || null,
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
    const { data: updated, error } = await supabase
      .from('staff_members')
      .update({
        full_name: data.name,
        email: data.email ?? null,
        phone: data.phone ?? null,
        department: data.subject ?? null,
        designation: 'Teacher',
        employment_status: data.is_active === false ? 'inactive' : 'active',
        is_active: data.is_active,
        metadata: {
          subject: data.subject ?? null,
        },
      })
      .eq('id', resolvedId)
      .select('*')
      .single();

    if (error) throw error;
    return { data: this.mapSupabaseTeacherToLegacy(updated) } as { data: Teacher };
  }

  async deleteTeacher(teacherId: number) {
    const resolvedId = this.resolveMappedId('teacher', teacherId);
    const { error } = await supabase.from('staff_members').delete().eq('id', resolvedId);
    if (error) throw error;
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
    return this.api.post('/timetable/check-conflict', data);
  }

  async createTimetableEntry(entryData: Partial<TimetableEntry>, schoolId: number = 1) {
    return this.api.post<TimetableEntry>('/timetable', entryData, {
      params: { school_id: schoolId },
    });
  }

  async listTimetableEntries(params?: {
    day_of_week?: DayOfWeek;
    teacher_id?: number;
    class_name?: string;
    room_id?: number;
    school_id?: number;
  }) {
    return this.api.get<TimetableView[]>('/timetable', { params });
  }

  async exportTimetableReport(params: {
    export_format: 'excel' | 'pdf';
    view_by: 'day' | 'teacher' | 'room' | 'batch';
    session_mode_filter?: 'all' | 'offline' | 'online' | 'merged';
    school_id?: number;
    day_of_week?: DayOfWeek;
    teacher_id?: number;
    room_id?: number;
    batch_name?: string;
  }) {
    return this.api.get('/timetable/export', {
      params,
      responseType: 'blob',
    });
  }

  async getTimetableEntry(entryId: number) {
    return this.api.get<TimetableEntry>(`/timetable/${entryId}`);
  }

  async updateTimetableEntry(entryId: number, data: Partial<TimetableEntry>) {
    return this.api.put<TimetableEntry>(`/timetable/${entryId}`, data);
  }

  async deleteTimetableEntry(entryId: number) {
    return this.api.delete(`/timetable/${entryId}`);
  }

  async deleteAllTimetableEntries(schoolId: number = 1, isAdmin: boolean = true) {
    return this.api.delete(`/timetable`, { params: { school_id: schoolId, is_admin: isAdmin } });
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

    const { data, error } = await supabase
      .from('staff_members')
      .insert({
        school_id: scopedSchoolId,
        employee_code: invigilatorData.staff_id || `STF-${Date.now().toString().slice(-8)}`,
        full_name: invigilatorData.name,
        email: invigilatorData.email || null,
        phone: invigilatorData.phone || null,
        staff_type: invigilatorData.staff_type || 'non_teaching',
        department: invigilatorData.department || null,
        designation: invigilatorData.designation || null,
        employment_status: invigilatorData.is_active === false ? 'inactive' : 'active',
        is_active: invigilatorData.is_active ?? true,
        metadata: {
          source: 'invigilator',
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
    const { data: updated, error } = await supabase
      .from('staff_members')
      .update({
        employee_code: data.staff_id,
        full_name: data.name,
        email: data.email ?? null,
        phone: data.phone ?? null,
        department: data.department ?? null,
        designation: data.designation ?? null,
        employment_status: data.is_active === false ? 'inactive' : 'active',
        is_active: data.is_active,
      })
      .eq('id', resolvedId)
      .select('*')
      .single();

    if (error) throw error;
    return { data: this.mapSupabaseInvigilatorToLegacy(updated) } as { data: Invigilator };
  }

  async deleteInvigilator(invigilatorId: number) {
    const resolvedId = this.resolveMappedId('invigilator', invigilatorId);
    const { error } = await supabase.from('staff_members').delete().eq('id', resolvedId);
    if (error) throw error;
    return { data: { message: 'Staff member deleted successfully' } } as { data: { message: string } };
  }

  // Room Assignment Methods
  async assignInvigilatorToRoom(assignment: any, schoolId: number = 1) {
    return this.api.post<RoomInvigilator>('/invigilators/room-assignment', assignment, {
      params: { school_id: schoolId },
    });
  }

  async getRoomInvigilators(roomId: string | number) {
    return this.api.get<Invigilator[]>(`/invigilators/room/${roomId}/invigilators`);
  }

  async listRoomAssignments(schoolId: number = 1, roomId?: number, invigilatorId?: number, isActive = true) {
    const params: any = { school_id: schoolId, is_active: isActive };
    if (roomId) params.room_id = roomId;
    if (invigilatorId) params.invigilator_id = invigilatorId;
    return this.api.get<RoomInvigilator[]>('/invigilators/room-assignments', { params });
  }

  async updateRoomAssignment(assignmentId: number, data: Partial<RoomInvigilator>) {
    return this.api.put<RoomInvigilator>(`/invigilators/assignments/${assignmentId}`, data);
  }

  async deleteRoomAssignment(assignmentId: number) {
    return this.api.delete(`/invigilators/assignments/${assignmentId}`);
  }

  async deleteAllRoomAssignments(schoolId: number = 1) {
    return this.api.delete('/invigilators/assignments', { params: { school_id: schoolId } });
  }

  // ==================== Inventory ====================

  async listSuppliers(params?: { school_id?: number; search?: string; is_active?: boolean }) {
    return this.api.get<Supplier[]>('/inventory/suppliers', { params });
  }

  async createSupplier(data: Partial<Supplier>, schoolId: number = 1) {
    return this.api.post<Supplier>('/inventory/suppliers', data, { params: { school_id: schoolId } });
  }

  async updateSupplier(supplierId: number, data: Partial<Supplier>, schoolId: number = 1) {
    return this.api.put<Supplier>(`/inventory/suppliers/${supplierId}`, data, { params: { school_id: schoolId } });
  }

  async deleteSupplier(supplierId: number, schoolId: number = 1) {
    return this.api.delete(`/inventory/suppliers/${supplierId}`, { params: { school_id: schoolId } });
  }

  async listInventorySubjects(params?: { school_id?: number; is_active?: boolean }) {
    return this.api.get<InventorySubject[]>('/inventory/subjects', { params });
  }

  async createInventorySubject(data: Partial<InventorySubject>, schoolId: number = 1) {
    return this.api.post<InventorySubject>('/inventory/subjects', data, { params: { school_id: schoolId } });
  }

  async updateInventorySubject(subjectId: number, data: Partial<InventorySubject>, schoolId: number = 1) {
    return this.api.put<InventorySubject>(`/inventory/subjects/${subjectId}`, data, { params: { school_id: schoolId } });
  }

  async deleteInventorySubject(subjectId: number, schoolId: number = 1) {
    return this.api.delete(`/inventory/subjects/${subjectId}`, { params: { school_id: schoolId } });
  }

  async listInventorySets(params?: { school_id?: number; subject_id?: number; is_active?: boolean }) {
    return this.api.get<InventorySet[]>('/inventory/sets', { params });
  }

  async createInventorySet(data: Partial<InventorySet>, schoolId: number = 1) {
    return this.api.post<InventorySet>('/inventory/sets', data, { params: { school_id: schoolId } });
  }

  async updateInventorySet(setId: number, data: Partial<InventorySet>, schoolId: number = 1) {
    return this.api.put<InventorySet>(`/inventory/sets/${setId}`, data, { params: { school_id: schoolId } });
  }

  async deleteInventorySet(setId: number, schoolId: number = 1) {
    return this.api.delete(`/inventory/sets/${setId}`, { params: { school_id: schoolId } });
  }

  async listInventoryVolumes(params?: { school_id?: number; subject_id?: number; set_id?: number; is_active?: boolean }) {
    return this.api.get<InventoryVolume[]>('/inventory/volumes', { params });
  }

  async createInventoryVolume(data: Partial<InventoryVolume>, schoolId: number = 1) {
    return this.api.post<InventoryVolume>('/inventory/volumes', data, { params: { school_id: schoolId } });
  }

  async updateInventoryVolume(volumeId: number, data: Partial<InventoryVolume>, schoolId: number = 1) {
    return this.api.put<InventoryVolume>(`/inventory/volumes/${volumeId}`, data, { params: { school_id: schoolId } });
  }

  async deleteInventoryVolume(volumeId: number, schoolId: number = 1) {
    return this.api.delete(`/inventory/volumes/${volumeId}`, { params: { school_id: schoolId } });
  }

  async getInventoryCatalog(params?: { school_id?: number; include_inactive?: boolean }) {
    return this.api.get<InventoryCatalogSubject[]>('/inventory/catalog', { params });
  }

  async listMaterials(params?: { school_id?: number; search?: string; subject?: string; batch_name?: string; is_active?: boolean }) {
    return this.api.get<MaterialItem[]>('/inventory/materials', { params });
  }

  async createMaterial(data: Partial<MaterialItem>, schoolId: number = 1) {
    return this.api.post<MaterialItem>('/inventory/materials', data, { params: { school_id: schoolId } });
  }

  async updateMaterial(materialId: number, data: Partial<MaterialItem>, schoolId: number = 1) {
    return this.api.put<MaterialItem>(`/inventory/materials/${materialId}`, data, { params: { school_id: schoolId } });
  }

  async deleteMaterial(materialId: number, schoolId: number = 1) {
    return this.api.delete(`/inventory/materials/${materialId}`, { params: { school_id: schoolId } });
  }

  async downloadInventoryMaterialTemplate() {
    return this.api.get('/inventory/materials/template/download', {
      responseType: 'blob',
    });
  }

  async importInventoryMaterials(formData: FormData, schoolId: number = 1) {
    return this.api.post<InventoryMaterialImportResponse>('/inventory/materials/import', formData, {
      params: { school_id: schoolId },
    });
  }

  async listStockIn(params?: { school_id?: number; supplier_id?: number; material_id?: number }) {
    return this.api.get<StockInEntry[]>('/inventory/stock-in', { params });
  }

  async createStockIn(data: Partial<StockInEntry>, schoolId: number = 1) {
    return this.api.post<StockInEntry>('/inventory/stock-in', data, { params: { school_id: schoolId } });
  }

  async deleteStockIn(entryId: number, schoolId: number = 1) {
    return this.api.delete(`/inventory/stock-in/${entryId}`, { params: { school_id: schoolId } });
  }

  async listStockOut(params?: { school_id?: number; batch_id?: number; material_id?: number }) {
    return this.api.get<StockOutEntry[]>('/inventory/stock-out', { params });
  }

  async createStockOut(data: Partial<StockOutEntry>, schoolId: number = 1) {
    return this.api.post<StockOutEntry>('/inventory/stock-out', data, { params: { school_id: schoolId } });
  }

  async deleteStockOut(entryId: number, schoolId: number = 1) {
    return this.api.delete(`/inventory/stock-out/${entryId}`, { params: { school_id: schoolId } });
  }

  async listStudentIssues(params?: { school_id?: number; batch_id?: number; student_id?: number; material_id?: number }) {
    return this.api.get<StudentIssueEntry[]>('/inventory/student-issues', { params });
  }

  async createStudentIssues(data: {
    date: string;
    batch_id?: number;
    student_ids: number[];
    material_id: number;
    quantity_issued: number;
    issued_by?: string;
    remarks?: string;
  }, schoolId: number = 1) {
    return this.api.post<StudentIssueEntry>('/inventory/student-issues', data, { params: { school_id: schoolId } });
  }

  async deleteStudentIssue(entryId: number, schoolId: number = 1) {
    return this.api.delete(`/inventory/student-issues/${entryId}`, { params: { school_id: schoolId } });
  }

  async getInventoryDashboard(schoolId: number = 1) {
    return this.api.get<InventoryDashboard>('/inventory/dashboard', { params: { school_id: schoolId } });
  }

  async getMaterialHistory(materialId: number, schoolId: number = 1) {
    return this.api.get<InventoryHistoryEntry[]>(`/inventory/history/material/${materialId}`, { params: { school_id: schoolId } });
  }

  async getInventoryReport(params: {
    report_type: string;
    school_id?: number;
    date_from?: string;
    date_to?: string;
    supplier_id?: number;
    batch_id?: number;
    student_id?: number;
    material_id?: number;
  }) {
    return this.api.get<InventoryReportResponse>('/inventory/reports/data', { params });
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
    return this.api.get<EduPayDashboard>('/edupay/dashboard', {
      params: { school_id: schoolId },
    });
  }

  async listEduPayStudents(schoolId: number = 1) {
    return this.api.get<EduPayStudent[]>('/edupay/students', {
      params: { school_id: schoolId },
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
    schoolId: number = 1
  ) {
    return this.api.post<EduPayStudent>('/edupay/students', data, {
      params: { school_id: schoolId },
    });
  }

  async listEduPayFeeStructures(schoolId: number = 1) {
    return this.api.get<EduPayFeeStructure[]>('/edupay/fee-structures', {
      params: { school_id: schoolId },
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
    schoolId: number = 1
  ) {
    return this.api.post<EduPayFeeStructure>('/edupay/fee-structures', data, {
      params: { school_id: schoolId },
    });
  }

  async listEduPayAssignments(params?: {
    school_id?: number;
    status?: 'paid' | 'pending' | 'overdue';
    student_id?: number;
  }) {
    return this.api.get<EduPayAssignment[]>('/edupay/assignments', { params });
  }

  async listEduPayPayments(schoolId: number = 1) {
    return this.api.get<EduPayPayment[]>('/edupay/payments', {
      params: { school_id: schoolId },
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
    schoolId: number = 1
  ) {
    return this.api.post<EduPayPayment>('/edupay/payments', data, {
      params: { school_id: schoolId },
    });
  }

  async getEduPayParentPortal(schoolId: number = 1, parentId?: number) {
    return this.api.get<EduPayParentPortal>('/edupay/parent-portal', {
      params: { school_id: schoolId, parent_id: parentId },
    });
  }

  // ==================== Attendance ====================

  async getAttendanceOverview(schoolId: number = 1) {
    return this.api.get<AttendanceOverview>('/attendance/overview', {
      params: { school_id: schoolId },
    });
  }

  async listAttendanceStudents(params?: { school_id?: number; skip?: number; limit?: number; search?: string }) {
    return this.api.get<AttendanceStudent[]>('/attendance/students', { params });
  }

  async createAttendanceStudent(
    data: {
      name: string;
      class_name: string;
      section: string;
      roll_no: string;
      parent_contact?: string;
    },
    schoolId: number = 1
  ) {
    return this.api.post<AttendanceStudent>('/attendance/students', data, {
      params: { school_id: schoolId },
    });
  }

  async listAttendanceStaff(params?: { school_id?: number; skip?: number; limit?: number; search?: string }) {
    return this.api.get<AttendanceStaff[]>('/attendance/staff', { params });
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
    schoolId: number = 1
  ) {
    return this.api.post<AttendanceStaff>('/attendance/staff', data, {
      params: { school_id: schoolId },
    });
  }

  async listAttendanceSubjects(schoolId: number = 1) {
    return this.api.get<AttendanceSubject[]>('/attendance/subjects', {
      params: { school_id: schoolId },
    });
  }

  async createAttendanceSubject(
    data: { name: string; class_name: string; section: string },
    schoolId: number = 1
  ) {
    return this.api.post<AttendanceSubject>('/attendance/subjects', data, {
      params: { school_id: schoolId },
    });
  }

  async getTeacherAttendanceContext(params?: {
    target_date?: string;
    current_time?: string;
    school_id?: number;
  }) {
    return this.api.get<TeacherAttendanceContext>('/attendance/teacher-current-class', {
      params,
    });
  }

  async getBatchAttendanceContext(params: {
    class_name: string;
    section: string;
    target_date?: string;
    current_time?: string;
    school_id?: number;
  }) {
    return this.api.get<TeacherAttendanceContext>('/attendance/batch-current-class', {
      params,
    });
  }

  async getStudentAttendanceMarking(params: {
    date: string;
    class_name: string;
    section: string;
    subject_id: number;
    search?: string;
    school_id?: number;
  }) {
    try {
      return await this.api.get<StudentAttendanceMarkingResponse>('/attendance/student-marking', { params });
    } catch (error: any) {
      if (!this.isDatetimeValidationError(error)) throw error;
      const retryParams = { ...params, date: this.toDateTimeString(params.date) || params.date };
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
    schoolId: number = 1
  ) {
    try {
      return await this.api.post('/attendance/student-marking', data, {
        params: { school_id: schoolId },
      });
    } catch (error: any) {
      if (!this.isDatetimeValidationError(error)) throw error;
      const retryData = { ...data, date: this.toDateTimeString(data.date) || data.date };
      return this.api.post('/attendance/student-marking', retryData, {
        params: { school_id: schoolId },
      });
    }
  }

  async listStudentAttendanceRecords(params?: {
    school_id?: number;
    class_name?: string;
    section?: string;
    student_name?: string;
    date_from?: string;
    date_to?: string;
    skip?: number;
    limit?: number;
  }) {
    try {
      return await this.api.get<StudentAttendanceRecord[]>('/attendance/student-records', { params });
    } catch (error: any) {
      if (!this.isDatetimeValidationError(error) || !params) throw error;
      const retryParams = {
        ...params,
        date_from: this.toDateTimeString(params.date_from),
        date_to: this.toDateTimeString(params.date_to, true),
      };
      return this.api.get<StudentAttendanceRecord[]>('/attendance/student-records', { params: retryParams });
    }
  }

  async deleteStudentAttendanceRecord(recordId: number, schoolId: number = 1) {
    return this.api.delete(`/attendance/student-records/${recordId}`, {
      params: { school_id: schoolId },
    });
  }

  async deleteAllStudentAttendanceRecords(params?: {
    school_id?: number;
    class_name?: string;
    section?: string;
    student_name?: string;
    date_from?: string;
    date_to?: string;
  }) {
    return this.api.delete('/attendance/student-records', { params });
  }

  async getStudentAttendanceDashboard(studentId: number, schoolId: number = 1) {
    return this.api.get<StudentDashboard>(`/attendance/student-dashboard/${studentId}`, {
      params: { school_id: schoolId },
    });
  }

  async getStaffAttendanceMarking(params: {
    date: string;
    department: string;
    search?: string;
    school_id?: number;
  }) {
    try {
      return await this.api.get<StaffAttendanceMarkingResponse>('/attendance/staff-marking', { params });
    } catch (error: any) {
      if (!this.isDatetimeValidationError(error)) throw error;
      const retryParams = { ...params, date: this.toDateTimeString(params.date) || params.date };
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
    schoolId: number = 1
  ) {
    try {
      return await this.api.post('/attendance/staff-marking', data, {
        params: { school_id: schoolId },
      });
    } catch (error: any) {
      if (!this.isDatetimeValidationError(error)) throw error;
      const retryData = { ...data, date: this.toDateTimeString(data.date) || data.date };
      return this.api.post('/attendance/staff-marking', retryData, {
        params: { school_id: schoolId },
      });
    }
  }

  async listStaffAttendanceRecords(params?: {
    school_id?: number;
    department?: string;
    staff_name?: string;
    date_from?: string;
    date_to?: string;
    skip?: number;
    limit?: number;
  }) {
    try {
      return await this.api.get<StaffAttendanceRecord[]>('/attendance/staff-records', { params });
    } catch (error: any) {
      if (!this.isDatetimeValidationError(error) || !params) throw error;
      const retryParams = {
        ...params,
        date_from: this.toDateTimeString(params.date_from),
        date_to: this.toDateTimeString(params.date_to, true),
      };
      return this.api.get<StaffAttendanceRecord[]>('/attendance/staff-records', { params: retryParams });
    }
  }

  async deleteStaffAttendanceRecord(recordId: number, schoolId: number = 1) {
    return this.api.delete(`/attendance/staff-records/${recordId}`, {
      params: { school_id: schoolId },
    });
  }

  async deleteAllStaffAttendanceRecords(params?: {
    school_id?: number;
    department?: string;
    staff_name?: string;
    date_from?: string;
    date_to?: string;
  }) {
    return this.api.delete('/attendance/staff-records', { params });
  }

  async getStaffAttendanceDashboard(params?: {
    school_id?: number;
    department?: string;
    date_from?: string;
    date_to?: string;
  }) {
    try {
      return await this.api.get<StaffDashboard>('/attendance/staff-dashboard', { params });
    } catch (error: any) {
      if (!this.isDatetimeValidationError(error) || !params) throw error;
      const retryParams = {
        ...params,
        date_from: this.toDateTimeString(params.date_from),
        date_to: this.toDateTimeString(params.date_to, true),
      };
      return this.api.get<StaffDashboard>('/attendance/staff-dashboard', { params: retryParams });
    }
  }

  async listAttendanceLeaves(params?: { school_id?: number; status?: 'pending' | 'approved' | 'rejected' }) {
    return this.api.get<AttendanceLeave[]>('/attendance/leaves', { params });
  }

  async createAttendanceLeave(
    data: {
      staff_member_id: number;
      leave_type: 'casual' | 'sick' | 'paid' | 'emergency';
      from_date: string;
      to_date: string;
      reason?: string;
    },
    schoolId: number = 1
  ) {
    try {
      return await this.api.post<AttendanceLeave>('/attendance/leaves', data, {
        params: { school_id: schoolId },
      });
    } catch (error: any) {
      if (!this.isDatetimeValidationError(error)) throw error;
      const retryData = {
        ...data,
        from_date: this.toDateTimeString(data.from_date) || data.from_date,
        to_date: this.toDateTimeString(data.to_date, true) || data.to_date,
      };
      return this.api.post<AttendanceLeave>('/attendance/leaves', retryData, {
        params: { school_id: schoolId },
      });
    }
  }

  async decideAttendanceLeave(
    leaveId: number,
    data: { status: 'approved' | 'rejected'; approved_by: string },
    schoolId: number = 1
  ) {
    return this.api.post<AttendanceLeave>(`/attendance/leaves/${leaveId}/decision`, data, {
      params: { school_id: schoolId },
    });
  }

  async deleteAttendanceLeave(leaveId: number, schoolId: number = 1) {
    return this.api.delete(`/attendance/leaves/${leaveId}`, {
      params: { school_id: schoolId },
    });
  }

  async deleteAllAttendanceLeaves(params?: { school_id?: number; status?: 'pending' | 'approved' | 'rejected' }) {
    return this.api.delete('/attendance/leaves', { params });
  }

  async listAttendanceNotifications(schoolId: number = 1) {
    return this.api.get<AttendanceNotification[]>('/attendance/notifications', {
      params: { school_id: schoolId },
    });
  }

  async deleteAttendanceNotification(notificationId: number, schoolId: number = 1) {
    return this.api.delete(`/attendance/notifications/${notificationId}`, {
      params: { school_id: schoolId },
    });
  }

  async deleteAllAttendanceNotifications(schoolId: number = 1) {
    return this.api.delete('/attendance/notifications', {
      params: { school_id: schoolId },
    });
  }

  async listAttendanceHolidays(schoolId: number = 1) {
    return this.api.get<AttendanceHoliday[]>('/attendance/holidays', {
      params: { school_id: schoolId },
    });
  }

  async deleteAttendanceHoliday(holidayId: number, schoolId: number = 1) {
    return this.api.delete(`/attendance/holidays/${holidayId}`, {
      params: { school_id: schoolId },
    });
  }

  async deleteAllAttendanceHolidays(schoolId: number = 1) {
    return this.api.delete('/attendance/holidays', {
      params: { school_id: schoolId },
    });
  }

  async createAttendanceHoliday(
    data: { title: string; holiday_date: string; description?: string },
    schoolId: number = 1
  ) {
    try {
      return await this.api.post<AttendanceHoliday>('/attendance/holidays', data, {
        params: { school_id: schoolId },
      });
    } catch (error: any) {
      if (!this.isDatetimeValidationError(error)) throw error;
      const retryData = {
        ...data,
        holiday_date: this.toDateTimeString(data.holiday_date) || data.holiday_date,
      };
      return this.api.post<AttendanceHoliday>('/attendance/holidays', retryData, {
        params: { school_id: schoolId },
      });
    }
  }

  async getAttendanceSettings(schoolId: number = 1) {
    return this.api.get<AttendanceSettings>('/attendance/settings', {
      params: { school_id: schoolId },
    });
  }

  async updateAttendanceSettings(
    data: { minimum_attendance_threshold: number; working_hours_start: string; working_hours_end: string },
    schoolId: number = 1
  ) {
    return this.api.put<AttendanceSettings>('/attendance/settings', data, {
      params: { school_id: schoolId },
    });
  }

  async getAttendanceReportData(params: {
    report_type: 'student_summary' | 'staff_summary' | 'leave_summary';
    school_id?: number;
    batch_names?: string;
    department?: string;
    date_from?: string;
    date_to?: string;
  }) {
    try {
      return await this.api.get<AttendanceReportResponse>('/attendance/reports/data', { params });
    } catch (error: any) {
      if (!this.isDatetimeValidationError(error)) throw error;
      const retryParams = {
        ...params,
        date_from: this.toDateTimeString(params.date_from),
        date_to: this.toDateTimeString(params.date_to, true),
      };
      return this.api.get<AttendanceReportResponse>('/attendance/reports/data', { params: retryParams });
    }
  }

async exportAttendanceReport(params: {
    report_type: 'student_summary' | 'staff_summary' | 'leave_summary';
    export_format: 'excel' | 'pdf';
    school_id?: number;
    batch_names?: string;
    department?: string;
    date_from?: string;
    date_to?: string;
  }) {
    try {
      return await this.api.get('/attendance/reports/export', {
        params,
        responseType: 'blob',
      });
    } catch (error: any) {
      if (!this.isDatetimeValidationError(error)) throw error;
      const retryParams = {
        ...params,
        date_from: this.toDateTimeString(params.date_from),
        date_to: this.toDateTimeString(params.date_to, true),
      };
      return this.api.get('/attendance/reports/export', {
        params: retryParams,
        responseType: 'blob',
      });
    }
  }

  async listIntegratedStudents(params?: { school_id?: number; skip?: number; limit?: number; search?: string; batch?: string }) {
    return this.api.get<AttendanceStudent[]>('/attendance/integrated-students', { params });
  }

  async listIntegratedStaff(params?: { school_id?: number; skip?: number; limit?: number; search?: string; department?: string; source?: 'teachers' | 'invigilators' | 'all' }) {
    return this.api.get<AttendanceStaff[]>('/attendance/integrated-staff', { params });
  }

  async getIntegratedAttendanceOverview(schoolId: number = 1) {
    return this.api.get('/attendance/integrated-overview', {
      params: { school_id: schoolId },
    });
  }
}

export const apiService = new ApiService();
