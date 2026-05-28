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

export function logIfUnexpectedRequestError(
  message: string,
  error: any,
  level: 'error' | 'warn' = 'error'
): void {
  if (isRequestCanceled(error) || isMigrationGuardError(error)) {
    return;
  }

  if (level === 'warn') {
    console.warn(message, error);
    return;
  }

  console.error(message, error);
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

  async importStudents(
    formData: FormData,
    schoolId: string | number = 1,
    onUploadProgress?: (progressEvent: any) => void
  ) {
    return this.api.post('/students/import', formData, {
      params: { school_id: schoolId },
      onUploadProgress,
    });
  }

  async createStudent(studentData: Partial<Student>, schoolId: string | number = 1) {
    return this.api.post<Student>('/students', studentData, {
      params: { school_id: schoolId },
    });
  }

  async listStudents(schoolId: string | number = 1, skip = 0, limit = 10000, batch?: string) {
    return this.api.get<Student[]>('/students', {
      params: { school_id: schoolId, skip, limit, batch },
    });
  }

  async getStudent(studentId: string | number) {
    return this.api.get<Student>(`/students/${studentId}`);
  }

  async updateStudent(studentId: string | number, data: Partial<Student>) {
    return this.api.put<Student>(`/students/${studentId}`, data);
  }

  async deleteStudent(studentId: string | number) {
    return this.api.delete(`/students/${studentId}`);
  }

  async deleteAllStudents(isAdmin: boolean = false, schoolId: string | number = 1) {
    return this.api.delete('/students', {
      params: { school_id: schoolId, is_admin: isAdmin },
    });
  }

  // ==================== Rooms ====================

  async createRoom(roomData: Partial<Room>, schoolId: string | number = 1) {
    return this.api.post<Room>('/rooms', roomData, {
      params: { school_id: schoolId },
    });
  }

  async listRooms(schoolId: string | number = 1) {
    return this.api.get<Room[]>('/rooms', {
      params: { school_id: schoolId },
    });
  }

  async getRoom(roomId: string | number) {
    return this.api.get<Room>(`/rooms/${roomId}`);
  }

  async updateRoom(roomId: string | number, data: Partial<Room>, schoolId: string | number = 1) {
  return this.api.put<Room>(`/rooms/${roomId}`, data, {
    params: { school_id: schoolId },
  });
}

  async deleteRoom(roomId: string | number, schoolId: string | number = 1) {
  return this.api.delete(`/rooms/${roomId}`, {
    params: { school_id: schoolId },
  });
}

  async deleteAllRooms(isAdmin: boolean = false, schoolId: string | number = 1) {
    return this.api.delete('/rooms', {
      params: { school_id: schoolId, is_admin: isAdmin },
    });
  }

  // ==================== Seating Plans ====================

  async generateSeatingPlans(
    examId: string | number,
    roomIds: Array<string | number>,
    planType?: 'strict' | 'compact' | 'all_in_one',
    batchNames?: string[],
    className?: string,
    generatedAt?: string,
    batchConflictGroups?: string[][]
  ) {
    return this.api.post('/seating/generate', {
      exam_id: examId,
      room_ids: roomIds,
      plan_type: planType,
      batch_names: batchNames,
      class_name: className,
      generated_at: generatedAt,
      batch_conflict_groups: batchConflictGroups,
    });
  }

  async listPlans(roomId: string | number, examId?: string | number) {
    return this.api.get<SeatingPlan[]>(`/seating/plans/${roomId}`, {
      params: { exam_id: examId },
    });
  }

  async listAllPlans(examId?: string | number) {
    return this.api.get<SeatingPlan[]>('/seating/plans', {
      params: { exam_id: examId },
    });
  }

  async getPlanLayout(planId: string | number) {
    return this.api.get<RoomLayout>(`/seating/${planId}/layout`);
  }

  async finalizePlan(planId: string | number) {
    return this.api.post(`/seating/${planId}/finalize`);
  }

  async deleteSeatingPlan(planId: string | number) {
    return this.api.delete(`/seating/${planId}`);
  }

  async deleteAllSeatingPlans(isAdmin: boolean = false, schoolId: string | number = 1) {
    return this.api.delete('/seating', {
      params: { school_id: schoolId, is_admin: isAdmin },
    });
  }

  async importSeatingPlan(formData: FormData, examId?: string | number) {
    return this.api.post('/seating/import', formData, {
      params: { exam_id: examId },
    });
  }

  // ==================== Exams ====================

  async listExams(schoolId: string | number = 1) {
    return this.api.get<Exam[]>('/exams', {
      params: { school_id: schoolId },
    });
  }

  async createExam(examData: Partial<Exam>, schoolId: string | number = 1) {
    return this.api.post<Exam>('/exams', examData, {
      params: { school_id: schoolId },
    });
  }

  async updateExam(examId: string | number, examData: Partial<Exam>, schoolId: string | number = 1) {
    return this.api.put<Exam>(`/exams/${examId}`, examData, {
      params: { school_id: schoolId },
    });
  }

  async deleteExam(examId: string | number, schoolId: string | number = 1) {
    return this.api.delete(`/exams/${examId}`, {
      params: { school_id: schoolId },
    });
  }

  // ==================== Reports ====================

  async exportPDF(planId: string | number) {
    return this.api.get(`/reports/pdf/${planId}`, {
      responseType: 'blob',
    });
  }

  async exportExcel(planId: string | number) {
    return this.api.get(`/reports/excel/${planId}`, {
      responseType: 'blob',
    });
  }

  async exportAllRoomsExcel(examId: string | number, planType?: 'strict' | 'compact' | 'all_in_one') {
    return this.api.get(`/reports/excel/all-rooms/${examId}`, {
      params: { plan_type: planType },
      responseType: 'blob',
    });
  }

  // ==================== Teachers ====================

  async createTeacher(teacherData: Partial<Teacher>, schoolId: string | number = 1) {
    return this.api.post<Teacher>('/teachers', teacherData, {
      params: { school_id: schoolId },
    });
  }

  async listTeachers(schoolId: string | number = 1, skip = 0, limit = 100) {
    return this.api.get<Teacher[]>('/teachers', {
      params: { school_id: schoolId, skip, limit },
    });
  }

  async getTeacher(teacherId: string | number) {
    return this.api.get<Teacher>(`/teachers/${teacherId}`);
  }

  async updateTeacher(teacherId: string | number, data: Partial<Teacher>) {
    return this.api.put<Teacher>(`/teachers/${teacherId}`, data);
  }

  async deleteTeacher(teacherId: string | number) {
    return this.api.delete(`/teachers/${teacherId}`);
  }

  async getTeachersCount(schoolId: string | number = 1) {
    return this.api.get('/teachers/count', { params: { school_id: schoolId } });
  }

  // ==================== Invigilators ====================

  async createInvigilator(invigilatorData: Partial<Invigilator>, schoolId: string | number = 1) {
    return this.api.post<Invigilator>('/invigilators', invigilatorData, {
      params: { school_id: schoolId },
    });
  }

  async listInvigilators(schoolId: string | number = 1, isActive?: boolean, skip = 0, limit = 100) {
    return this.api.get<Invigilator[]>('/invigilators', {
      params: { school_id: schoolId, is_active: isActive, skip, limit },
    });
  }

  async getInvigilator(invigilatorId: string | number) {
    return this.api.get<Invigilator>(`/invigilators/${invigilatorId}`);
  }

  async updateInvigilator(invigilatorId: string | number, data: Partial<Invigilator>) {
    return this.api.put<Invigilator>(`/invigilators/${invigilatorId}`, data);
  }

  async deleteInvigilator(invigilatorId: string | number) {
    return this.api.delete(`/invigilators/${invigilatorId}`);
  }

  async listRoomAssignments(schoolId: string | number = 1, params: {
    room_id?: string | number;
    invigilator_id?: string | number;
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
    invigilator_id: string | number;
    exam_id?: string | number;
    notes?: string;
  }, schoolId: string | number = 1) {
    return this.api.post<RoomInvigilator>('/invigilators/room-assignment', data, {
      params: { school_id: schoolId },
    });
  }

  async getRoomInvigilators(roomId: string | number) {
    return this.api.get<Invigilator[]>(`/invigilators/room/${roomId}/invigilators`);
  }

  async updateRoomAssignment(assignmentId: string | number, data: {
    invigilator_id?: string | number;
    exam_id?: string | number;
    notes?: string;
    is_active?: boolean;
  }) {
    return this.api.put<RoomInvigilator>(`/invigilators/assignments/${assignmentId}`, data);
  }

  async deleteRoomAssignment(assignmentId: string | number) {
    return this.api.delete(`/invigilators/assignments/${assignmentId}`);
  }

  async deleteAllInvigilatorAssignments(schoolId: string | number = 1) {
    return this.api.delete('/invigilators/assignments', {
      params: { school_id: schoolId },
    });
  }

  // ==================== Timetable ====================

  async checkTimetableConflict(data: {
    teacher_id: string | number;
    day_of_week: DayOfWeek;
    start_time: string;
    end_time: string;
    exclude_entry_id?: string | number;
  }) {
    return this.api.post('/timetable/check-conflict', data);
  }

  async createTimetableEntry(entryData: Partial<TimetableEntry>, schoolId: string | number = 1) {
    return this.api.post<TimetableEntry>('/timetable', entryData, {
      params: { school_id: schoolId },
    });
  }

  async listTimetableEntries(params?: {
    day_of_week?: DayOfWeek;
    teacher_id?: string | number;
    class_name?: string;
    school_id?: string | number;
    reference_date?: string;
  }) {
    return this.api.get<TimetableView[]>('/timetable', { params });
  }

  async getTimetableEntry(entryId: string | number) {
    return this.api.get<TimetableEntry>(`/timetable/${entryId}`);
  }

  async updateTimetableEntry(entryId: string | number, data: Partial<TimetableEntry>) {
    return this.api.put<TimetableEntry>(`/timetable/${entryId}`, data);
  }

  async deleteTimetableEntry(entryId: string | number) {
    return this.api.delete(`/timetable/${entryId}`);
  }

  async deleteAllTimetableEntries(schoolId: string | number = 1, isAdmin: boolean = true) {
    return this.api.delete(`/timetable`, { params: { school_id: schoolId, is_admin: isAdmin } });
  }

  async exportTimetableReport(params: Record<string, unknown>) {
    return this.api.get('/timetable/export', {
      params,
      responseType: 'blob',
    });
  }

  async downloadTimetableTemplate() {
    return this.api.get('/timetable/template', {
      responseType: 'blob',
    });
  }

  async uploadTimetableExcel(file: File | FormData, schoolId: string | number = 1) {
    const formData = file instanceof FormData ? file : (() => {
      const next = new FormData();
      next.append('file', file);
      return next;
    })();
    return this.api.post('/timetable/upload', formData, {
      params: { school_id: schoolId },
    });
  }

  async getTimetableEntriesCount(schoolId: string | number = 1) {
    return this.api.get('/timetable/count', {
      params: { school_id: schoolId },
    });
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

  async listBatches(schoolId: string | number = 1, isActive?: boolean, category?: 'batch' | 'class' | string) {
    const params: any = { school_id: schoolId };
    if (isActive !== undefined) {
      params.is_active = isActive;
    }
    if (category) {
      params.category = category;
    }
    return this.api.get<any[]>('/batches', { params });
  }

  async deleteAllBatches(schoolId: string | number = 1, category?: 'batch' | 'class' | string) {
    return this.api.delete('/batches', {
      params: { school_id: schoolId, category },
    });
  }

  async reorderBatches(items: Array<{ batch_id: string | number; display_order: number }>, schoolId: string | number = 1, category?: 'batch' | 'class' | string) {
    return this.api.post('/batches/reorder', { items }, {
      params: { school_id: schoolId, category },
    });
  }

  async getStudentAttendanceCalendar(params: { month?: string; class_name?: string; batch_name?: string; scope?: string; school_id?: string | number } = {}) {
    return this.api.get('/attendance/calendar', { params });
  }

  // ==================== Attendance ====================

  async getAttendanceOverview(schoolId: string | number = 1) {
    return this.api.get('/attendance/overview', {
      params: { school_id: schoolId },
    });
  }

  async listIntegratedStudents(params: {
    school_id?: string | number;
    skip?: number;
    limit?: number;
    search?: string;
    batch?: string;
  } = {}) {
    return this.api.get('/attendance/integrated-students', { params });
  }

  async listAttendanceStaff(params: {
    school_id?: string | number;
    skip?: number;
    limit?: number;
    search?: string;
    department?: string;
    source?: string;
  } = {}) {
    return this.api.get('/attendance/integrated-staff', { params });
  }

  async listAttendanceSubjects(schoolId: string | number = 1) {
    return this.api.get('/attendance/subjects', {
      params: { school_id: schoolId },
    });
  }

  async getTeacherAttendanceContext(params: {
    target_date: string;
    current_time?: string;
    school_id?: string | number;
  }) {
    return this.api.get('/attendance/teacher-current-class', { params });
  }

  async getBatchDayClasses(params: {
    class_name: string;
    section: string;
    batch_name?: string;
    target_date: string;
    current_time?: string;
    school_id?: string | number;
  }) {
    return this.api.get('/attendance/batch-day-classes', { params });
  }

  async getStudentAttendanceMarking(params: {
    date: string;
    class_name: string;
    section: string;
    subject_id?: string;
    search?: string;
    school_id?: string | number;
  }) {
    return this.api.get('/attendance/student-marking', { params });
  }

  async saveStudentAttendance(data: {
    date: string;
    subject_id?: string;
    marked_by?: string;
    entries: Array<{
      student_id: string | number;
      status: string;
      absence_reason?: string;
    }>;
  }, schoolId: string | number = 1) {
    return this.api.post('/attendance/student-marking', data, {
      params: { school_id: schoolId },
    });
  }

  async listStudentAttendanceRecords(params: {
    school_id?: string | number;
    student_id?: string | number;
    batch_names?: string;
    batch_name?: string;
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
    school_id?: string | number;
    batch_names?: string;
    batch_name?: string;
    class_name?: string;
    section?: string;
    month?: string;
    date?: string;
    scope?: string;
  } = {}) {
    return this.api.get('/attendance/dashboard', { params });
  }

  async deleteStudentAttendanceRecord(recordId: string | number, schoolId: string | number = 1) {
    return this.api.delete(`/attendance/student-records/${recordId}`, {
      params: { school_id: schoolId },
    });
  }

  async deleteAllStudentAttendanceRecords(params: {
    school_id?: string | number;
    student_id?: string | number;
    batch_names?: string;
    batch_name?: string;
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
    school_id?: string | number;
  }) {
    return this.api.get('/attendance/staff-marking', { params });
  }

  async saveStaffAttendance(data: any, schoolId: string | number = 1) {
    return this.api.post('/attendance/staff-marking', data, {
      params: { school_id: schoolId },
    });
  }

  async listStaffAttendanceRecords(params: {
    school_id?: string | number;
    department?: string;
    staff_name?: string;
    date_from?: string;
    date_to?: string;
    skip?: number;
    limit?: number;
  } = {}) {
    return this.api.get('/attendance/staff-records', { params });
  }

  async deleteStaffAttendanceRecord(recordId: string | number, schoolId: string | number = 1) {
    return this.api.delete(`/attendance/staff-records/${recordId}`, {
      params: { school_id: schoolId },
    });
  }

  async deleteAllStaffAttendanceRecords(params: {
    school_id?: string | number;
    department?: string;
    staff_name?: string;
    date_from?: string;
    date_to?: string;
  } = {}) {
    return this.api.delete('/attendance/staff-records', { params });
  }

  async getStaffAttendanceDashboard(params: {
    school_id?: string | number;
    department?: string;
    target_date?: string;
  } = {}) {
    return this.api.get('/attendance/staff-dashboard', { params });
  }

  async createAttendanceHoliday(data: {
    title: string;
    holiday_date: string;
    description?: string;
  }, schoolId: string | number = 1) {
    return this.api.post('/attendance/holidays', data, {
      params: { school_id: schoolId },
    });
  }

  async deleteAttendanceHoliday(holidayId: string | number, schoolId: string | number = 1) {
    return this.api.delete(`/attendance/holidays/${holidayId}`, {
      params: { school_id: schoolId },
    });
  }

  async deleteAllAttendanceHolidays(schoolId: string | number = 1) {
    return this.api.delete('/attendance/holidays', {
      params: { school_id: schoolId },
    });
  }

  async listAttendanceLeaves(params: {
    school_id?: string | number;
    status?: string;
  } = {}) {
    return this.api.get('/attendance/leaves', { params });
  }

  async createAttendanceLeave(data: any, schoolId: string | number = 1) {
    return this.api.post('/attendance/leaves', data, {
      params: { school_id: schoolId },
    });
  }

  async decideAttendanceLeave(leaveId: string | number, data: any, schoolId: string | number = 1) {
    return this.api.post(`/attendance/leaves/${leaveId}/decision`, data, {
      params: { school_id: schoolId },
    });
  }

  async deleteAttendanceLeave(leaveId: string | number, schoolId: string | number = 1) {
    return this.api.delete(`/attendance/leaves/${leaveId}`, {
      params: { school_id: schoolId },
    });
  }

  async deleteAllAttendanceLeaves(params: {
    school_id?: string | number;
    status?: string;
  } = {}) {
    return this.api.delete('/attendance/leaves', { params });
  }

  async deleteAttendanceNotification(notificationId: string | number, schoolId: string | number = 1) {
    return this.api.delete(`/attendance/notifications/${notificationId}`, {
      params: { school_id: schoolId },
    });
  }

  async deleteAllAttendanceNotifications(schoolId: string | number = 1) {
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
    school_id?: string | number;
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
    school_id?: string | number;
  }) {
    return this.api.get('/attendance/reports/export', {
      params,
      responseType: 'blob',
    });
  }

  async getBatch(batchId: string | number, schoolId: string | number = 1) {
    return this.api.get<any>(`/batches/${batchId}`, { params: { school_id: schoolId } });
  }

  async createBatch(data: { name: string; category?: string; syllabus?: string; display_order?: number; is_active?: boolean }, schoolId: string | number = 1) {
    return this.api.post<any>('/batches', data, { params: { school_id: schoolId } });
  }

  async updateBatch(batchId: string | number, data: { name?: string; category?: string; syllabus?: string; display_order?: number; is_active?: boolean }, schoolId: string | number = 1) {
    return this.api.put<any>(`/batches/${batchId}`, data, { params: { school_id: schoolId } });
  }

  async deleteBatch(batchId: string | number, schoolId: string | number = 1) {
    return this.api.delete(`/batches/${batchId}`, { params: { school_id: schoolId } });
  }

  async listRoleUsers(schoolId: string | number = 1) {
    return this.api.get('/auth/users', { params: { school_id: schoolId } });
  }

  async createRoleUser(data: Record<string, unknown>) {
    return this.api.post('/auth/users', data);
  }

  async updateRoleUser(userId: string | number, data: Record<string, unknown>) {
    return this.api.put(`/auth/users/${userId}`, data);
  }

  async deleteRoleUser(userId: string | number) {
    return this.api.delete(`/auth/users/${userId}`);
  }

  async listHostels(schoolId: string | number = 1) {
    return this.api.get('/students/hostels', { params: { school_id: schoolId } });
  }

  async createHostel(data: Record<string, unknown>, schoolId: string | number = 1) {
    return this.api.post('/students/hostels', data, { params: { school_id: schoolId } });
  }

  async updateHostel(hostelId: string | number, data: Record<string, unknown>, schoolId: string | number = 1) {
    return this.api.put(`/students/hostels/${hostelId}`, data, { params: { school_id: schoolId } });
  }

  async deleteHostel(hostelId: string | number, schoolId: string | number = 1) {
    return this.api.delete(`/students/hostels/${hostelId}`, { params: { school_id: schoolId } });
  }

  async addHostelRoom(hostelId: string | number, data: Record<string, unknown>, schoolId: string | number = 1) {
    return this.api.post(`/students/hostels/${hostelId}/rooms`, data, { params: { school_id: schoolId } });
  }

  async listStudentHostelRequests(schoolId: string | number = 1, status?: string) {
    return this.api.get('/students/hostel-requests', { params: { school_id: schoolId, status_filter: status } });
  }

  async createStudentHostelRequest(studentId: string | number, data: Record<string, unknown>, schoolId: string | number = 1) {
    return this.api.post(`/students/${studentId}/hostel-request`, data, { params: { school_id: schoolId } });
  }

  async approveStudentHostelRequest(requestId: string | number, data: Record<string, unknown>, schoolId: string | number = 1) {
    return this.api.post(`/students/hostel-requests/${requestId}/approve`, data, { params: { school_id: schoolId } });
  }

  async moveStudentHostelAllocation(requestId: string | number, data: Record<string, unknown>, schoolId: string | number = 1) {
    return this.api.post(`/students/hostel-requests/${requestId}/move`, data, { params: { school_id: schoolId } });
  }

  async rejectStudentHostelRequest(requestId: string | number, data: Record<string, unknown>, schoolId: string | number = 1) {
    return this.api.post(`/students/hostel-requests/${requestId}/reject`, data, { params: { school_id: schoolId } });
  }

  async downloadStudentTemplate() {
    return this.api.get('/students/template/download', { responseType: 'blob' });
  }

  async transferStudentsToBatch(data: Record<string, unknown>, schoolId: string | number = 1) {
    return this.api.post('/students/transfer', data, { params: { school_id: schoolId } });
  }

  async getStudentsCount(schoolId: string | number = 1) {
    return this.api.get('/students/count', { params: { school_id: schoolId } });
  }

  async getRoomsSummary(schoolId: string | number = 1) {
    return this.api.get('/rooms/summary', { params: { school_id: schoolId } });
  }

  async getAttendanceSettings(schoolId: string | number = 1) {
    return this.api.get('/attendance/settings', { params: { school_id: schoolId } });
  }

  async updateAttendanceSettings(data: Record<string, unknown>, schoolId: string | number = 1) {
    return this.api.put('/attendance/settings', data, { params: { school_id: schoolId } });
  }

  async downloadSeatingTemplate() {
    return this.api.get('/seating/template/download', { responseType: 'blob' });
  }
}

export const apiService = new ApiService();
