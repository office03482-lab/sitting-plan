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
  Hostel, HostelRoom, StudentHostelRequest,
  AuthResponse, RolePowerUser, User
} from '@types';
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
  private refreshPromise: Promise<string | null> | null = null;

  private getAccessToken() {
    return typeof window === 'undefined' ? null : localStorage.getItem('auth_token');
  }

  private getRefreshToken() {
    return typeof window === 'undefined' ? null : localStorage.getItem('refresh_token');
  }

  private isJwtExpired(token: string) {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return true;
      const payloadRaw = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
      const payload = JSON.parse(payloadRaw) as { exp?: number };
      if (!payload?.exp) return true;
      const now = Math.floor(Date.now() / 1000);
      return payload.exp <= now + 10;
    } catch {
      return true;
    }
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

  private buildUserFromAuthResponse(data: AuthResponse): User {
    return {
      id: data.user_id,
      username: data.username,
      email: data.email,
      full_name: data.full_name,
      role: data.role,
      user_type: data.user_type,
      permissions: data.permissions || [],
      is_active: true,
    };
  }

  private applyAuthResponse(data: AuthResponse) {
    useAuthStore.getState().login(
      data.access_token,
      this.buildUserFromAuthResponse(data),
      data.refresh_token || null,
    );
  }

  private clearClientAuth(redirectToLogin: boolean = true) {
    useAuthStore.getState().logout();
    if (typeof window !== 'undefined' && redirectToLogin && !window.location.pathname.startsWith('/login')) {
      window.location.replace('/login');
    }
  }

  private async refreshAccessToken() {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    const refreshToken = this.getRefreshToken();
    if (!refreshToken) {
      return null;
    }

    this.refreshPromise = (async () => {
      try {
        const response = await axios.post<AuthResponse>(
          `${this.api.defaults.baseURL}/auth/refresh`,
          { refresh_token: refreshToken },
          { timeout: API_TIMEOUT_MS },
        );
        this.applyAuthResponse(response.data);
        return response.data.access_token;
      } catch {
        this.clearClientAuth();
        return null;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
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

      let token = this.getAccessToken();
      if ((!token || this.isJwtExpired(token)) && !this.isRefreshExcluded(config.url) && this.getRefreshToken()) {
        token = await this.refreshAccessToken();
      }

      if (token) {
        config.headers = config.headers || {};
        config.headers.Authorization = `Bearer ${token}`;
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
            this.clearClientAuth();
            return Promise.reject(error);
          }

          if (config.__retryAfterRefresh) {
            this.clearClientAuth();
            return Promise.reject(error);
          }

          const refreshedToken = await this.refreshAccessToken();
          if (!refreshedToken) {
            return Promise.reject(error);
          }

          config.__retryAfterRefresh = true;
          config.headers = config.headers || {};
          config.headers.Authorization = `Bearer ${refreshedToken}`;
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
    const refreshToken = this.getRefreshToken();
    try {
      return await this.api.post('/auth/logout', {
        refresh_token: refreshToken || undefined,
      });
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

  async createStudent(studentData: Partial<Student>, schoolId: number = 1) {
    return this.api.post<Student>('/students', studentData, {
      params: { school_id: schoolId },
    });
  }

  async listStudents(schoolId: number = 1, skip = 0, limit = 10000, batch?: string) {
    return this.api.get<Student[]>('/students', {
      params: { school_id: schoolId, skip, limit, batch },
    });
  }

  async getStudent(studentId: number) {
    return this.api.get<Student>(`/students/${studentId}`);
  }

  async updateStudent(studentId: number, data: Partial<Student>) {
    return this.api.put<Student>(`/students/${studentId}`, data);
  }

  async deleteStudent(studentId: number) {
    return this.api.delete(`/students/${studentId}`);
  }

  async deleteAllStudents(isAdmin: boolean = false, schoolId: number = 1) {
    return this.api.delete('/students', {
      params: { school_id: schoolId, is_admin: isAdmin },
    });
  }

  async transferStudentsToBatch(
    data: {
      target_batch: string;
      student_ids?: number[];
      source_batch?: string;
      transfer_all_from_batch?: boolean;
    },
    schoolId: number = 1
  ) {
    return this.api.post<StudentBatchTransferResponse>('/students/transfer', data, {
      params: { school_id: schoolId },
    });
  }

  async listHostels(schoolId: number = 1) {
    return this.api.get<Hostel[]>('/students/hostels', {
      params: { school_id: schoolId },
    });
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
    schoolId: number = 1
  ) {
    return this.api.post<Hostel>('/students/hostels', data, {
      params: { school_id: schoolId },
    });
  }

  async updateHostel(hostelId: number, data: Partial<Hostel>, schoolId: number = 1) {
    return this.api.put<Hostel>(`/students/hostels/${hostelId}`, data, {
      params: { school_id: schoolId },
    });
  }

  async deleteHostel(hostelId: number, schoolId: number = 1) {
    return this.api.delete<{ message: string }>(`/students/hostels/${hostelId}`, {
      params: { school_id: schoolId },
    });
  }

  async addHostelRoom(hostelId: number, data: { room_number: string; total_beds: number }, schoolId: number = 1) {
    return this.api.post<HostelRoom>(`/students/hostels/${hostelId}/rooms`, data, {
      params: { school_id: schoolId },
    });
  }

  async listStudentHostelRequests(schoolId: number = 1, statusFilter?: string) {
    return this.api.get<StudentHostelRequest[]>('/students/hostel-requests', {
      params: { school_id: schoolId, status_filter: statusFilter },
    });
  }

  async createStudentHostelRequest(studentId: number, data: { hostel_id: number; requested_notes?: string }, schoolId: number = 1) {
    return this.api.post<StudentHostelRequest>(`/students/${studentId}/hostel-request`, data, {
      params: { school_id: schoolId },
    });
  }

  async approveStudentHostelRequest(requestId: number, data: { hostel_id?: number; room_id?: number; reviewed_by?: string; review_notes?: string }, schoolId: number = 1) {
    return this.api.post<StudentHostelRequest>(`/students/hostel-requests/${requestId}/approve`, data, {
      params: { school_id: schoolId },
    });
  }

  async moveStudentHostelAllocation(requestId: number, data: { hostel_id?: number; room_id?: number; reviewed_by?: string; review_notes?: string }, schoolId: number = 1) {
    return this.api.post<StudentHostelRequest>(`/students/hostel-requests/${requestId}/move`, data, {
      params: { school_id: schoolId },
    });
  }

  async rejectStudentHostelRequest(requestId: number, data: { reviewed_by?: string; review_notes?: string }, schoolId: number = 1) {
    return this.api.post<StudentHostelRequest>(`/students/hostel-requests/${requestId}/reject`, data, {
      params: { school_id: schoolId },
    });
  }

  // ==================== Rooms ====================

  async createRoom(roomData: Partial<Room>, schoolId: number = 1) {
    return this.api.post<Room>('/rooms', roomData, {
      params: { school_id: schoolId },
    });
  }

  async listRooms(schoolId: number = 1) {
    return this.api.get<Room[]>('/rooms', {
      params: { school_id: schoolId },
    });
  }

  async getRoom(roomId: number) {
    return this.api.get<Room>(`/rooms/${roomId}`);
  }

  async updateRoom(roomId: number, data: Partial<Room>, schoolId: number = 1) {
  return this.api.put<Room>(`/rooms/${roomId}`, data, {
    params: { school_id: schoolId },
  });
}

  async deleteRoom(roomId: number, schoolId: number = 1) {
  return this.api.delete(`/rooms/${roomId}`, {
    params: { school_id: schoolId },
  });
}

  async deleteAllRooms(isAdmin: boolean = false, schoolId: number = 1) {
    return this.api.delete('/rooms', {
      params: { school_id: schoolId, is_admin: isAdmin },
    });
  }

  // ==================== Seating Plans ====================

  async generateSeatingPlans(examId: number, roomIds: number[], planType?: 'strict' | 'compact' | 'all_in_one', batches?: string[], invigilatorAssignments?: {[roomId: number]: number | null}, generatedDate?: string, batchConflictGroups?: string[][]) {
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

  async createTeacher(teacherData: Partial<Teacher>, schoolId: number = 1) {
    return this.api.post<Teacher>('/teachers', teacherData, {
      params: { school_id: schoolId },
    });
  }

  async listTeachers(schoolId: number = 1, skip = 0, limit = 100) {
    return this.api.get<Teacher[]>('/teachers', {
      params: { school_id: schoolId, skip, limit },
    });
  }

  async getTeacher(teacherId: number) {
    return this.api.get<Teacher>(`/teachers/${teacherId}`);
  }

  async updateTeacher(teacherId: number, data: Partial<Teacher>) {
    return this.api.put<Teacher>(`/teachers/${teacherId}`, data);
  }

  async deleteTeacher(teacherId: number) {
    return this.api.delete(`/teachers/${teacherId}`);
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

  async listBatches(schoolId: number = 1, isActive?: boolean, category?: string) {
    const params: any = { school_id: schoolId };
    if (isActive !== undefined) {
      params.is_active = isActive;
    }
    if (category) {
      params.category = category;
    }
    return this.api.get<any[]>('/batches', { params });
  }

  async getBatch(batchId: number, schoolId: number = 1) {
    return this.api.get<any>(`/batches/${batchId}`, { params: { school_id: schoolId } });
  }

  async createBatch(data: { name: string; category?: string; syllabus?: string; display_order?: number; is_active?: boolean }, schoolId: number = 1) {
    return this.api.post<any>('/batches', data, { params: { school_id: schoolId } });
  }

  async updateBatch(batchId: number, data: { name?: string; category?: string; syllabus?: string; display_order?: number; is_active?: boolean }, schoolId: number = 1) {
    return this.api.put<any>(`/batches/${batchId}`, data, { params: { school_id: schoolId } });
  }

  async reorderBatches(items: Array<{ batch_id: number; display_order: number }>, schoolId: number = 1) {
    return this.api.post<any[]>('/batches/reorder', { items }, { params: { school_id: schoolId } });
  }

  async deleteBatch(batchId: number, schoolId: number = 1) {
    return this.api.delete(`/batches/${batchId}`, { params: { school_id: schoolId } });
  }

  async deleteAllBatches(schoolId: number = 1, category?: string) {
    return this.api.delete('/batches', { params: { school_id: schoolId, category } });
  }

  // ==================== Invigilators ====================

  async createInvigilator(invigilatorData: any, schoolId: number = 1) {
    return this.api.post<Invigilator>('/invigilators', invigilatorData, {
      params: { school_id: schoolId },
    });
  }

  async listInvigilators(schoolId: number = 1, isActive?: boolean, skip = 0, limit = 100) {
    const params: any = { school_id: schoolId, skip, limit };
    if (isActive !== undefined) {
      params.is_active = isActive;
    }
    return this.api.get<Invigilator[]>('/invigilators', { params });
  }

  async getInvigilator(invigilatorId: number) {
    return this.api.get<InvigilatorWithRooms>(`/invigilators/${invigilatorId}`);
  }

  async updateInvigilator(invigilatorId: number, data: Partial<Invigilator>) {
    return this.api.put<Invigilator>(`/invigilators/${invigilatorId}`, data);
  }

  async deleteInvigilator(invigilatorId: number) {
    return this.api.delete(`/invigilators/${invigilatorId}`);
  }

  // Room Assignment Methods
  async assignInvigilatorToRoom(assignment: any, schoolId: number = 1) {
    return this.api.post<RoomInvigilator>('/invigilators/room-assignment', assignment, {
      params: { school_id: schoolId },
    });
  }

  async getRoomInvigilators(roomId: number) {
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
