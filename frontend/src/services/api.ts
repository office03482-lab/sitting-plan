import axios, { AxiosInstance } from 'axios';
import type { 
  Student, Room, SeatingPlan, RoomLayout, LoginCredentials, Exam,
  Teacher, TimetableEntry, TimetableView, DayOfWeek, Invigilator, RoomInvigilator
} from '@types';

export function isRequestCanceled(error: unknown): boolean {
  return axios.isCancel(error);
}

const MIGRATION_GUARD_DETAIL_FRAGMENT = 'temporarily unavailable during supabase migration';

export function isMigrationGuardError(error: any): boolean {
  const status = Number(error?.response?.status || error?.status || 0);
  const detail = String(error?.response?.data?.detail || error?.message || '')
    .trim()
    .toLowerCase();
  return status === 503 && detail.includes(MIGRATION_GUARD_DETAIL_FRAGMENT);
}

export function isTemporarilyUnavailableDataError(error: any): boolean {
  if (isMigrationGuardError(error)) {
    return true;
  }

  const status = Number(error?.response?.status || error?.status || 0);
  const detail = String(error?.response?.data?.detail || error?.message || '')
    .trim()
    .toLowerCase();

  return (
    (status === 422 && detail.includes('input should be a valid integer') && detail.includes('count')) ||
    (status === 500 && detail.includes('invalid input syntax for type uuid') && detail.includes('"count"'))
  );
}

export function getMigrationUnavailableMessage(subject = 'This module'): string {
  return `${subject} is temporarily unavailable during the ongoing Supabase migration.`;
}

export function getRequestErrorMessage(error: any, fallback: string): string {
  if (isRequestCanceled(error)) {
    return '';
  }
  if (isMigrationGuardError(error)) {
    return getMigrationUnavailableMessage('This module');
  }
  const detail = error?.response?.data?.detail;
  if (typeof detail === 'string' && detail.trim()) {
    return detail;
  }
  return error?.message || fallback;
}

function readStoredAuthUser(): any | null {
  try {
    const rawUser = localStorage.getItem('user');
    if (!rawUser) return null;
    const parsed = JSON.parse(rawUser);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function resolveStoredSchoolId(user: any): string | null {
  const candidate = String(
    user?.school_id
    || user?.default_school_id
    || ''
  ).trim();
  return candidate && candidate !== '1' ? candidate : null;
}

class ApiService {
  private api: AxiosInstance;

  constructor() {
    this.api = axios.create({
      baseURL: "/api",
    });

    this.api.interceptors.request.use((config) => {
      const storedUser = readStoredAuthUser();
      const token =
        localStorage.getItem('auth_token')
        || localStorage.getItem('token')
        || localStorage.getItem('access_token');
      const resolvedSchoolId = resolveStoredSchoolId(storedUser);

      const headers = (config.headers ?? {}) as Record<string, unknown>;
      config.headers = headers as typeof config.headers;
      const params =
        config.params && typeof config.params === 'object' && !Array.isArray(config.params)
          ? (config.params as Record<string, unknown>)
          : {};
      config.params = params;

      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
      if (storedUser?.role) {
        headers['X-User-Role'] = String(storedUser.role).trim().toLowerCase();
      }
      if (storedUser?.full_name || storedUser?.username || storedUser?.email) {
        headers['X-User-Name'] = String(
          storedUser.full_name || storedUser.username || storedUser.email
        ).trim();
      }
      if (storedUser?.email) {
        headers['X-User-Email'] = String(storedUser.email).trim();
      }
      if (Array.isArray(storedUser?.permissions) && storedUser.permissions.length) {
        headers['X-User-Permissions'] = storedUser.permissions.join(',');
      }
      if (resolvedSchoolId) {
        const currentSchoolId = String(params.school_id ?? '').trim();
        if (!currentSchoolId || currentSchoolId === '1') {
          params.school_id = resolvedSchoolId;
        }
      }

      // Ensure multipart uploads do not send a JSON content type header.
      if (config.data instanceof FormData) {
        delete headers['Content-Type'];
        delete headers['content-type'];
      }
      return config;
    });
  }

  // ==================== Authentication ====================

  async sendOTP(email: string) {
    return this.api.post('/auth/send-otp', { email });
  }

  async verifyOTP(credentials: LoginCredentials) {
    return this.api.post('/auth/verify-otp', credentials);
  }

  async logout() {
    localStorage.removeItem('auth_token');
    return this.api.post('/auth/logout');
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

  async generateSeatingPlans(examId: number, roomIds: number[], planType?: 'strict' | 'compact') {
    return this.api.post('/seating/generate', {
      exam_id: examId,
      room_ids: roomIds,
      plan_type: planType,
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

  // ==================== Invigilators ====================

  async createInvigilator(invigilatorData: Partial<Invigilator>, schoolId: number = 1) {
    return this.api.post<Invigilator>('/invigilators', invigilatorData, {
      params: { school_id: schoolId },
    });
  }

  async listInvigilators(schoolId: number = 1, isActive?: boolean, skip = 0, limit = 100) {
    return this.api.get<Invigilator[]>('/invigilators', {
      params: { school_id: schoolId, is_active: isActive, skip, limit },
    });
  }

  async getInvigilator(invigilatorId: number) {
    return this.api.get<Invigilator>(`/invigilators/${invigilatorId}`);
  }

  async updateInvigilator(invigilatorId: number, data: Partial<Invigilator>) {
    return this.api.put<Invigilator>(`/invigilators/${invigilatorId}`, data);
  }

  async deleteInvigilator(invigilatorId: number) {
    return this.api.delete(`/invigilators/${invigilatorId}`);
  }

  async listRoomAssignments(schoolId: number = 1, params: {
    room_id?: number;
    invigilator_id?: number;
    is_active?: boolean;
    skip?: number;
    limit?: number;
  } = {}) {
    return this.api.get<RoomInvigilator[]>('/invigilators/assignments', {
      params: { school_id: schoolId, ...params },
    });
  }

  async assignInvigilatorToRoom(data: {
    room_id: string | number;
    invigilator_id: number;
    exam_id?: number;
    notes?: string;
  }, schoolId: number = 1) {
    return this.api.post<RoomInvigilator>('/invigilators/room-assignment', data, {
      params: { school_id: schoolId },
    });
  }

  async getRoomInvigilators(roomId: number) {
    return this.api.get<Invigilator[]>(`/invigilators/room/${roomId}/invigilators`);
  }

  async updateRoomAssignment(assignmentId: number, data: {
    invigilator_id?: number;
    exam_id?: number;
    notes?: string;
    is_active?: boolean;
  }) {
    return this.api.put<RoomInvigilator>(`/invigilators/assignments/${assignmentId}`, data);
  }

  async deleteRoomAssignment(assignmentId: number) {
    return this.api.delete(`/invigilators/assignments/${assignmentId}`);
  }

  async deleteAllInvigilatorAssignments(schoolId: number = 1) {
    return this.api.delete('/invigilators/assignments', {
      params: { school_id: schoolId },
    });
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
    school_id?: number;
  }) {
    return this.api.get<TimetableView[]>('/timetable', { params });
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

  async listBatches(schoolId: number = 1, isActive?: boolean) {
    const params: any = { school_id: schoolId };
    if (isActive !== undefined) {
      params.is_active = isActive;
    }
    return this.api.get<any[]>('/batches', { params });
  }

  async getStudentAttendanceCalendar(params: { month?: string; class_name?: string; batch_name?: string; scope?: string; school_id?: number } = {}) {
    return this.api.get('/attendance/calendar', { params });
  }

  // ==================== Attendance ====================

  async getAttendanceOverview(schoolId: number = 1) {
    return this.api.get('/attendance/overview', {
      params: { school_id: schoolId },
    });
  }

  async listIntegratedStudents(params: {
    school_id?: number;
    skip?: number;
    limit?: number;
    search?: string;
    batch?: string;
  } = {}) {
    return this.api.get('/attendance/integrated-students', { params });
  }

  async listAttendanceStaff(params: {
    school_id?: number;
    skip?: number;
    limit?: number;
    search?: string;
    department?: string;
    source?: string;
  } = {}) {
    return this.api.get('/attendance/integrated-staff', { params });
  }

  async listAttendanceSubjects(schoolId: number = 1) {
    return this.api.get('/attendance/subjects', {
      params: { school_id: schoolId },
    });
  }

  async getTeacherAttendanceContext(params: {
    target_date: string;
    current_time?: string;
    school_id?: number;
  }) {
    return this.api.get('/attendance/teacher-current-class', { params });
  }

  async getBatchDayClasses(params: {
    class_name: string;
    section: string;
    batch_name?: string;
    target_date: string;
    current_time?: string;
    school_id?: number;
  }) {
    return this.api.get('/attendance/batch-day-classes', { params });
  }

  async getStudentAttendanceMarking(params: {
    date: string;
    class_name: string;
    section: string;
    subject_id?: string;
    search?: string;
    school_id?: number;
  }) {
    return this.api.get('/attendance/student-marking', { params });
  }

  async saveStudentAttendance(data: {
    date: string;
    subject_id?: string;
    marked_by?: string;
    entries: Array<{
      student_id: number;
      status: string;
      absence_reason?: string;
    }>;
  }, schoolId: number = 1) {
    return this.api.post('/attendance/student-marking', data, {
      params: { school_id: schoolId },
    });
  }

  async listStudentAttendanceRecords(params: {
    school_id?: number;
    student_id?: number;
    batch_names?: string;
    class_name?: string;
    section?: string;
    date_from?: string;
    date_to?: string;
    skip?: number;
    limit?: number;
  } = {}) {
    return this.api.get('/attendance/student-records', { params });
  }

  async getStudentAttendanceDashboardSummary(params: {
    school_id?: number;
    batch_names?: string;
    class_name?: string;
    section?: string;
    month?: string;
  } = {}) {
    return this.api.get('/attendance/dashboard', { params });
  }

  async deleteStudentAttendanceRecord(recordId: number, schoolId: number = 1) {
    return this.api.delete(`/attendance/student-records/${recordId}`, {
      params: { school_id: schoolId },
    });
  }

  async deleteAllStudentAttendanceRecords(params: {
    school_id?: number;
    student_id?: number;
    batch_names?: string;
    class_name?: string;
    section?: string;
    date_from?: string;
    date_to?: string;
  } = {}) {
    return this.api.delete('/attendance/student-records', { params });
  }

  async getStaffAttendanceMarking(params: {
    date: string;
    staff_type?: string;
    department?: string;
    search?: string;
    school_id?: number;
  }) {
    return this.api.get('/attendance/staff-marking', { params });
  }

  async saveStaffAttendance(data: any, schoolId: number = 1) {
    return this.api.post('/attendance/staff-marking', data, {
      params: { school_id: schoolId },
    });
  }

  async listStaffAttendanceRecords(params: {
    school_id?: number;
    department?: string;
    staff_name?: string;
    date_from?: string;
    date_to?: string;
    skip?: number;
    limit?: number;
  } = {}) {
    return this.api.get('/attendance/staff-records', { params });
  }

  async deleteStaffAttendanceRecord(recordId: number, schoolId: number = 1) {
    return this.api.delete(`/attendance/staff-records/${recordId}`, {
      params: { school_id: schoolId },
    });
  }

  async deleteAllStaffAttendanceRecords(params: {
    school_id?: number;
    department?: string;
    staff_name?: string;
    date_from?: string;
    date_to?: string;
  } = {}) {
    return this.api.delete('/attendance/staff-records', { params });
  }

  async getStaffAttendanceDashboard(params: {
    school_id?: number;
    department?: string;
    target_date?: string;
  } = {}) {
    return this.api.get('/attendance/staff-dashboard', { params });
  }

  async createAttendanceHoliday(data: {
    title: string;
    holiday_date: string;
    description?: string;
  }, schoolId: number = 1) {
    return this.api.post('/attendance/holidays', data, {
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

  async listAttendanceLeaves(params: {
    school_id?: number;
    status?: string;
  } = {}) {
    return this.api.get('/attendance/leaves', { params });
  }

  async createAttendanceLeave(data: any, schoolId: number = 1) {
    return this.api.post('/attendance/leaves', data, {
      params: { school_id: schoolId },
    });
  }

  async decideAttendanceLeave(leaveId: number, data: any, schoolId: number = 1) {
    return this.api.post(`/attendance/leaves/${leaveId}/decision`, data, {
      params: { school_id: schoolId },
    });
  }

  async deleteAttendanceLeave(leaveId: number, schoolId: number = 1) {
    return this.api.delete(`/attendance/leaves/${leaveId}`, {
      params: { school_id: schoolId },
    });
  }

  async deleteAllAttendanceLeaves(params: {
    school_id?: number;
    status?: string;
  } = {}) {
    return this.api.delete('/attendance/leaves', { params });
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

  async getAttendanceReportData(params: {
    report_type: string;
    batch_names?: string;
    class_name?: string;
    section?: string;
    department?: string;
    date_from?: string;
    date_to?: string;
    school_id?: number;
  }) {
    return this.api.get('/attendance/reports/data', { params });
  }

  async exportAttendanceReport(params: {
    report_type: string;
    export_format: 'excel' | 'pdf';
    batch_names?: string;
    class_name?: string;
    section?: string;
    department?: string;
    date_from?: string;
    date_to?: string;
    school_id?: number;
  }) {
    return this.api.get('/attendance/reports/export', {
      params,
      responseType: 'blob',
    });
  }

  async getBatch(batchId: number, schoolId: number = 1) {
    return this.api.get<any>(`/batches/${batchId}`, { params: { school_id: schoolId } });
  }

  async createBatch(data: { name: string; is_active?: boolean }, schoolId: number = 1) {
    return this.api.post<any>('/batches', data, { params: { school_id: schoolId } });
  }

  async updateBatch(batchId: number, data: { name?: string; is_active?: boolean }, schoolId: number = 1) {
    return this.api.put<any>(`/batches/${batchId}`, data, { params: { school_id: schoolId } });
  }

  async deleteBatch(batchId: number, schoolId: number = 1) {
    return this.api.delete(`/batches/${batchId}`, { params: { school_id: schoolId } });
  }
}

export const apiService = new ApiService();
