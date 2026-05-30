# API CONTRACTS

## Dr. Girish App - School ERP System

**Version:** 1.0.0
**Base URL:** `/api`
**Auth:** Bearer JWT (Authorization header)

---

## 1. STANDARD RESPONSE FORMAT

### Success Response
```json
{
  "success": true,
  "data": { ... },
  "message": "Operation completed successfully",
  "error": null
}
```

### Paginated Response
```json
{
  "success": true,
  "data": {
    "items": [...],
    "total": 100,
    "skip": 0,
    "limit": 100
  },
  "message": "Data retrieved successfully",
  "error": null
}
```

### Error Response
```json
{
  "success": false,
  "data": null,
  "message": "Error description",
  "error": "error_code_or_message"
}
```

---

## 2. AUTH ENDPOINTS

### POST `/auth/login-password`
Authenticate with username/email and password.

**Request:**
```json
{
  "username": "admin@school.edu",
  "password": "securepassword"
}
```

**Response (200):**
```json
{
  "access_token": "eyJ...",
  "refresh_token": "eyJ...",
  "access_token_expires_in_seconds": 900,
  "refresh_token_expires_in_seconds": 1209600,
  "user_id": 1,
  "email": "admin@school.edu",
  "username": "admin",
  "full_name": "Admin User",
  "role": "admin",
  "user_type": "non_teaching",
  "permissions": ["admin_office", "settings"]
}
```

### POST `/auth/send-otp`
Send OTP verification code to email.

**Request:**
```json
{
  "email": "user@school.edu"
}
```

**Response (200):**
```json
{
  "message": "OTP sent to email",
  "email": "user@school.edu",
  "expires_in_minutes": 10
}
```

### POST `/auth/verify-otp`
Verify OTP and create session.

**Request:**
```json
{
  "email": "user@school.edu",
  "otp_code": "123456"
}
```

**Response (200):** Same as login-password.

### POST `/auth/refresh`
Refresh access token using refresh token.

**Request:**
```json
{
  "refresh_token": "eyJ..."
}
```

**Response (200):** Same as login-password.

### POST `/auth/logout`
Invalidate refresh token.

**Request:**
```json
{
  "refresh_token": "eyJ..."
}
```

**Response (200):**
```json
{
  "message": "Logged out successfully"
}
```

---

## 3. USER MANAGEMENT

### GET `/auth/users`
List all users. Requires `admin_office.access_control` permission.

**Query params:** `school_id` (optional, integer)

**Response (200):**
```json
[
  {
    "id": 1,
    "username": "admin",
    "full_name": "Admin User",
    "email": "admin@school.edu",
    "password": "",
    "role": "admin",
    "user_type": "non_teaching",
    "permissions": ["admin_office", "settings"],
    "is_active": true,
    "created_at": "2026-01-01T00:00:00+00:00"
  }
]
```

### POST `/auth/users`
Create a new user.

**Request:**
```json
{
  "username": "teacher1",
  "full_name": "Teacher One",
  "email": "teacher1@school.edu",
  "password": "securepassword",
  "role": "teacher",
  "user_type": "teaching",
  "permissions": ["attendance.student", "timetable.view"]
}
```

### PUT `/auth/users/{user_id}`
Update user details.

### DELETE `/auth/users/{user_id}`
Delete a user.

---

## 4. STUDENT ENDPOINTS

### GET `/students`
List students for a school.

**Query params:** `school_id` (required), `skip` (default: 0), `limit` (default: 10000), `batch` (optional), `search` (optional)

**Response (200):**
```json
[
  {
    "id": 1,
    "roll_number": "S001",
    "name": "Student Name",
    "father_name": "Father Name",
    "batch": "11th",
    "class_name": "11",
    "section": "A",
    "academic_session": "2025-26",
    "school_id": 1,
    "email": null,
    "phone": null,
    "is_active": true
  }
]
```

### POST `/students`
Create a new student.

### GET `/students/{student_id}`
Get student details.

### PUT `/students/{student_id}`
Update student.

### DELETE `/students/{student_id}`
Delete a student.

### POST `/students/import`
Bulk import students from Excel.

### GET `/students/count`
Get student count.

---

## 5. ROOM ENDPOINTS

### GET `/rooms`
List rooms for a school.

### POST `/rooms`
Create a new room with desks and seats.

### GET `/rooms/{room_id}`
Get room details.

### PUT `/rooms/{room_id}`
Update room configuration.

### DELETE `/rooms/{room_id}`
Soft-delete a room (set is_active=false).

### GET `/rooms/summary`
Get room count and total capacity.

---

## 6. EXAM ENDPOINTS

### GET `/exams`
List exams for a school.

### POST `/exams`
Create a new exam.

### GET `/exams/{exam_id}`
Get exam details.

### PUT `/exams/{exam_id}`
Update exam.

### DELETE `/exams/{exam_id}`
Delete exam and associated seating plans.

---

## 7. SEATING PLAN ENDPOINTS

### POST `/seating/generate`
Generate seating plans.

**Request:**
```json
{
  "exam_id": 1,
  "room_ids": [1, 2, 3],
  "plan_type": "all_in_one",
  "batch_names": ["11th", "12th"],
  "batch_conflict_groups": [["11th", "12th"]]
}
```

### GET `/seating/plans`
List all seating plans.

### GET `/seating/plans/{room_id}`
List plans for a room.

### GET `/seating/{plan_id}/layout`
Get visual layout.

### POST `/seating/{plan_id}/finalize`
Finalize a plan.

### DELETE `/seating/{plan_id}`
Delete a plan.

---

## 8. TEACHER ENDPOINTS

### GET `/teachers`
List teachers. Supports pagination.

### POST `/teachers`
Create teacher.

### GET `/teachers/{teacher_id}`
Get teacher.

### PUT `/teachers/{teacher_id}`
Update teacher.

### DELETE `/teachers/{teacher_id}`
Delete teacher.

### GET `/teachers/count`
Get teacher count.

---

## 9. BATCH ENDPOINTS

### GET `/batches`
List batches.

### POST `/batches`
Create batch.

### PUT `/batches/{batch_id}`
Update batch.

### DELETE `/batches/{batch_id}`
Delete batch.

### POST `/batches/reorder`
Reorder batches.

---

## 10. TIMETABLE ENDPOINTS

### GET `/timetable`
List timetable entries.

### POST `/timetable`
Create timetable entry.

### GET `/timetable/{entry_id}`
Get entry.

### PUT `/timetable/{entry_id}`
Update entry.

### DELETE `/timetable/{entry_id}`
Delete entry.

### POST `/timetable/check-conflict`
Check for scheduling conflicts.

---

## 11. ERROR CODES

| Code | HTTP Status | Meaning |
|------|-------------|---------|
| `missing_authorization_header` | 401 | No Authorization header |
| `invalid_token` | 401 | Token is expired or invalid |
| `invalid_token_type` | 401 | Refresh token used as access token |
| `user_inactive` | 401 | User account is disabled |
| `user_not_found` | 401 | User from token not in database |
| `permission_denied` | 403 | Insufficient permissions |
| `school_context_denied` | 403 | No valid school_id in context |
| `resource_not_found` | 404 | Requested resource does not exist |
| `rate_limit_exceeded` | 429 | Too many requests |
| `validation_error` | 422 | Request validation failed |
| `migration_unavailable` | 503 | Module in migration |

---

## 12. AUTHENTICATION REQUIREMENTS PER ENDPOINT

| Endpoint Group | Auth Required | Permission Required |
|----------------|--------------|-------------------|
| Auth (login, send-otp, verify-otp) | NO | N/A |
| Auth (refresh, logout) | YES (refresh token) | N/A |
| Auth (users CRUD) | YES | `admin_office.access_control` |
| Students | YES | `admin_office.students` |
| Rooms | YES | `admin_office.rooms` |
| Exams | YES | `admin_office.seating_generation` |
| Seating Plans | YES | `admin_office.seating_plans` |
| Teachers | YES | `admin_office.teachers` |
| Batches | YES | `admin_office.batches` |
| Timetable | YES | `timetable` |
| Invigilators | YES | `admin_office.invigilators` |
| Inventory | YES | `inventory` |
| EduPay | YES | `edupay` |
| Attendance | YES | `attendance` |
| Reports | YES | `admin_office.reports` |
| Settings | YES | `settings` |
| Health | NO | N/A |
