# MODULE_RUNTIME_MATRIX

## Notes

- Source of truth: [frontend/src/App.tsx](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/frontend/src/App.tsx) and [frontend/src/components/Layout.tsx](/C:/Users/GIRISH/Desktop/SITTING%20PLAN/frontend/src/components/Layout.tsx)
- `Requires Session Registration` is effectively `YES` for protected runtime surfaces because `authReady` depends on registered session readiness.
- `Current Result` below reflects post-fix code audit plus automated validation, not live browser execution.
- `UNVERIFIED` means no direct browser click/run was performed in this environment.

| Module | Route | Component | Required Role / Guard | Required Permission | Scope | Requires School Context | Requires Session Registration | Primary API Calls | Current Result |
|---|---|---|---|---|---|---|---|---|---|
| Overview | `/overview` | `Dashboard` | `ProtectedRoute` | permission-derived | SCHOOL_SCOPED | YES | YES | attendance overview, metrics, timetable, inventory, edupay | CONTEXT_BLOCKED or UNVERIFIED |
| Platform Dashboard | `/platform/dashboard` | `PlatformDashboard` | `PlatformAdminRoute` | platform admin | PLATFORM_SCOPED | NO | YES | `getPlatformDashboardSummary`, `getPlatformAnalytics` | UNVERIFIED |
| Schools Management | `/platform/schools` | `PlatformSchoolsPage` | `PlatformAdminRoute` | platform admin | PLATFORM_SCOPED | NO | YES | `listPlatformSchools` | UNVERIFIED |
| School Detail | `/platform/schools/:schoolId` | `PlatformSchoolDetailsPage` | `PlatformAdminRoute` | platform admin | PLATFORM_SCOPED | NO | YES | platform school detail APIs | UNVERIFIED |
| Subscription Center | `/platform/subscriptions` | `PlatformSubscriptionCenterPage` | `PlatformAdminRoute` | platform admin | PLATFORM_SCOPED | NO | YES | platform subscriptions APIs | UNVERIFIED |
| Usage Dashboard | `/platform/usage` | `PlatformUsageDashboardPage` | `PlatformAdminRoute` | platform admin | PLATFORM_SCOPED | NO | YES | platform usage APIs | UNVERIFIED |
| Health Dashboard | `/platform/health` | `PlatformHealthDashboardPage` | `PlatformAdminRoute` | platform admin | PLATFORM_SCOPED | NO | YES | platform health APIs | UNVERIFIED |
| Global Search | `/platform/search` | `PlatformGlobalSearchPage` | `PlatformAdminRoute` | platform admin | PLATFORM_SCOPED | NO | YES | platform search APIs | UNVERIFIED |
| Platform Analytics | `/platform/analytics` | `PlatformAnalyticsPage` | `PlatformAdminRoute` | platform admin | PLATFORM_SCOPED | NO | YES | platform analytics APIs | UNVERIFIED |
| Support Center | `/platform/support` | `PlatformSupportCenterPage` | `PlatformAdminRoute` | platform admin | PLATFORM_SCOPED | NO | YES | support action APIs | UNVERIFIED |
| Platform Broadcasts | `/platform/notifications` | `PlatformNotificationCenterPage` | `PlatformAdminRoute` | platform admin | PLATFORM_SCOPED | NO | YES | platform notification APIs | UNVERIFIED |
| Onboarding Wizard | `/platform/onboarding` | `PlatformOnboardingWizardPage` | `PlatformAdminRoute` | platform admin | PLATFORM_SCOPED | NO | YES | onboarding APIs | UNVERIFIED |
| Workflow Queue | `/platform/workflow` | `PlatformWorkflowQueue` | `PlatformAdminRoute` | platform admin | PLATFORM_SCOPED | NO | YES | workflow APIs | UNVERIFIED |
| Audit Logs | `/platform/audit-logs` | `PlatformAuditLogs` | `PlatformAdminRoute` | platform admin | PLATFORM_SCOPED | NO | YES | platform audit APIs | UNVERIFIED |
| Admin Office | `/admin-office` | `AdminOffice` | `ProtectedRoute` | `admin_office` | SCHOOL_SCOPED | YES | YES | admin office summary APIs | UNVERIFIED |
| Rooms | `/rooms` | `RoomConfiguration` | `ProtectedRoute` | `admin_office.rooms` | SCHOOL_SCOPED | YES | YES | rooms APIs | UNVERIFIED |
| Seating Generation | `/seating/generate` | `SeatingGeneration` | `ProtectedRoute` | `admin_office.seating_generation` | SCHOOL_SCOPED | YES | YES | rooms, exams, generation APIs | UNVERIFIED |
| Seating Plans | `/seating/plans` | `SeatingPlanManagement` | `ProtectedRoute` | `admin_office.seating_plans` | SCHOOL_SCOPED | YES | YES | seating plan APIs | UNVERIFIED |
| Attendance | `/attendance-management` | `AttendanceManagement` | `ProtectedRoute` | `attendance` | SCHOOL_SCOPED | YES | YES | `getAttendanceOverview`, attendance sub-APIs | UNVERIFIED |
| Hostel | `/hostels` | `HostelManagement` | `ProtectedRoute` | `admin_office.hostels` | SCHOOL_SCOPED | YES | YES | hostel APIs | UNVERIFIED |
| Teacher Management | `/teachers` | `TeacherManagement` | `ProtectedRoute` | `admin_office.teachers` | SCHOOL_SCOPED | YES | YES | teacher APIs | UNVERIFIED |
| Student Management | `/students` | `StudentManagement` | `ProtectedRoute` | `admin_office.students` | SCHOOL_SCOPED | YES | YES | students, batches, hostel, portal APIs | UNVERIFIED |
| Student Directory | `/students/directory` | `StudentDirectory` | `ProtectedRoute` | `admin_office.students` | SCHOOL_SCOPED | YES | YES | student directory APIs | UNVERIFIED |
| Batch Management | `/batches` | `BatchManagement` | `ProtectedRoute` | `admin_office.batches` | SCHOOL_SCOPED | YES | YES | batch APIs | UNVERIFIED |
| Staff Add | `/staff/add` | `AddStaff` | `ProtectedRoute` | `admin_office` | SCHOOL_SCOPED | YES | YES | staff APIs | UNVERIFIED |
| Staff Directory | `/staff/directory` | `StaffDirectory` | `ProtectedRoute` | `admin_office` | SCHOOL_SCOPED | YES | YES | staff directory APIs | UNVERIFIED |
| Staff Bulk Upload | `/staff/bulk-upload` | `StaffBulkUpload` | `ProtectedRoute` | `admin_office` | SCHOOL_SCOPED | YES | YES | staff import APIs | UNVERIFIED |
| Invigilators | `/invigilators` | `InvigilatorManagement` | `ProtectedRoute` | `admin_office.invigilators` | SCHOOL_SCOPED | YES | YES | invigilator APIs | UNVERIFIED |
| Timetable | `/timetable` | `TimetableManagement` | `ProtectedRoute` | `timetable` | SCHOOL_SCOPED | YES | YES | timetable APIs | UNVERIFIED |
| Inventory | `/inventory` | `InventoryManagement` | `ProtectedRoute` | `inventory` | SCHOOL_SCOPED | YES | YES | inventory APIs | UNVERIFIED |
| EduPay / Finance | `/edupay` | `FeeManagement` | `ProtectedRoute` | `edupay` | SCHOOL_SCOPED | YES | YES | edupay APIs | UNVERIFIED |
| Commerce / Revenue | `/commerce` | `CommercePage` | `ProtectedRoute` | `edupay.commerce`, `edupay.subscriptions`, `edupay.revenue` | SCHOOL_SCOPED | YES | YES | commerce APIs | UNVERIFIED |
| BI Dashboard | `/bi` | `BusinessIntelligencePage` | `ProtectedRoute` | BI permissions | SCHOOL_SCOPED | YES | YES | BI APIs | UNVERIFIED |
| School AI Assistant | `/school-ai-assistant` | `SchoolAiAssistantPage` | `ProtectedRoute` | AI permissions | SCHOOL_SCOPED | YES | YES | school AI APIs | UNVERIFIED |
| Courses | `/courses` | `Courses` | `ProtectedRoute` | LMS permissions | SCHOOL_SCOPED | YES | YES | LMS course APIs | UNVERIFIED |
| Course Detail | `/course/:id` | `CourseDetail` | `ProtectedRoute` | LMS permissions | SCHOOL_SCOPED | YES | YES | LMS course detail APIs | UNVERIFIED |
| Lesson Player | `/lesson/:id` | `LessonPlayer` | `ProtectedRoute` | LMS permissions | SCHOOL_SCOPED | YES | YES | lesson APIs | UNVERIFIED |
| My Learning | `/my-learning` | `MyLearning` | `ProtectedRoute` | LMS / learner permissions | SCHOOL_SCOPED | YES | YES | learning APIs | UNVERIFIED |
| Assignments | `/assignments` | `LmsAssignments` | `ProtectedRoute` | `lms.assignments` | SCHOOL_SCOPED | YES | YES | LMS assignment APIs | UNVERIFIED |
| Live Classes | `/live-classes` | `LiveClasses` | `ProtectedRoute` | live class permissions | SCHOOL_SCOPED | YES | YES | live class APIs | UNVERIFIED |
| Online Tests | `/online-tests` | `OnlineTests` | `ProtectedRoute` | role-based | SCHOOL_SCOPED | YES | YES | online test APIs | UNVERIFIED |
| Online Test Create | `/online-tests/create` | `OnlineTestCreate` | `ProtectedRoute` | role-based | SCHOOL_SCOPED | YES | YES | online test create APIs | UNVERIFIED |
| Online Test Edit | `/online-tests/edit/:id` | `OnlineTestEdit` | `ProtectedRoute` | role-based | SCHOOL_SCOPED | YES | YES | online test edit APIs | UNVERIFIED |
| Online Test Take | `/online-tests/take/:id` | `OnlineTestTake` | `ProtectedRoute` | role-based | SCHOOL_SCOPED | YES | YES | online test attempt APIs | UNVERIFIED |
| Online Test Results | `/online-tests/results/:id` | `OnlineTestResults` | `ProtectedRoute` | role-based | SCHOOL_SCOPED | YES | YES | online test result APIs | UNVERIFIED |
| AI Study Assistant | `/ai-study-assistant` | `AiStudyAssistantPage` | `ProtectedRoute` | study planner / AI permissions | SCHOOL_SCOPED | YES | YES | study planner and AI APIs | UNVERIFIED |
| Teacher AI | `/teacher-ai` | `TeacherAiAssistantPage` | `ProtectedRoute` | `teacher_ai.*` | SCHOOL_SCOPED | YES | YES | teacher AI APIs | UNVERIFIED |
| Parent Intelligence | `/parent-intelligence` | `ParentIntelligencePortal` | `ProtectedRoute` | parent intelligence permissions | SCHOOL_SCOPED | YES | YES | parent intelligence APIs | UNVERIFIED |
| Reports | `/reports` | `Reports` | `ProtectedRoute` | `admin_office.reports` | SCHOOL_SCOPED | YES | YES | reports APIs | UNVERIFIED |
| Settings | `/settings` | `Settings` | `ProtectedRoute` | `settings` | SCHOOL_SCOPED | YES | YES | settings APIs | UNVERIFIED |
| School Branding | `/school-self-service/branding` | `SchoolBrandingPage` | `SchoolAdminRoute` | `settings` | SCHOOL_SCOPED | YES | YES | branding APIs | UNVERIFIED |
| Preferences | `/school-self-service/preferences` | `SchoolPreferencesPage` | `SchoolAdminRoute` | `settings` | SCHOOL_SCOPED | YES | YES | preferences APIs | UNVERIFIED |
| Portal Settings | `/school-self-service/portal-settings` | `SchoolPortalSettingsPage` | `SchoolAdminRoute` | `settings` | SCHOOL_SCOPED | YES | YES | portal settings APIs | UNVERIFIED |
| Email Templates | `/school-self-service/email-templates` | `SchoolEmailTemplatesPage` | `SchoolAdminRoute` | `settings` | SCHOOL_SCOPED | YES | YES | email template APIs | UNVERIFIED |
| SMS Templates | `/school-self-service/messaging-templates` | `SchoolSmsTemplatesPage` | `SchoolAdminRoute` | `settings` | SCHOOL_SCOPED | YES | YES | messaging template APIs | UNVERIFIED |
| Storage Center | `/school-self-service/storage` | `SchoolStorageCenterPage` | `SchoolAdminRoute` | `settings` | SCHOOL_SCOPED | YES | YES | storage APIs | UNVERIFIED |
| Backup Center | `/school-self-service/backups` | `SchoolBackupCenterPage` | `SchoolAdminRoute` | `settings` | SCHOOL_SCOPED | YES | YES | backup APIs | UNVERIFIED |
| Access Control | `/admin/access-control` | `AccessControl` | `ProtectedRoute` | `admin_office.access_control` | SCHOOL_SCOPED | YES | YES | access control / permission APIs | UNVERIFIED |
| Portal Access Manager | `/admin/portal-access` | `PortalAccessManager` | `ProtectedRoute` | `admin_office.access_control` | SCHOOL_SCOPED | YES | YES | portal access APIs | UNVERIFIED |
| Security Sessions | `/admin/security-sessions` | `SecuritySessionsPage` | `ProtectedRoute` | `admin_office.access_control` | SCHOOL_SCOPED | YES | YES | security session APIs | UNVERIFIED |
| Parent Dashboard | `/parent`, `/parent/dashboard` | `ParentDashboard` | `ProtectedRoute` | parent portal permissions | USER_SCOPED | YES | YES | `getParentPortalDashboard` | UNVERIFIED |
| Parent Attendance | `/parent/attendance` | `ParentAttendance` | `ProtectedRoute` | parent portal permissions | USER_SCOPED | YES | YES | parent attendance APIs | UNVERIFIED |
| Parent Progress | `/parent/progress` | `ParentAcademicProgress` | `ProtectedRoute` | parent portal permissions | USER_SCOPED | YES | YES | parent progress APIs | UNVERIFIED |
| Parent Assignments | `/parent/assignments` | `ParentAssignments` | `ProtectedRoute` | parent portal permissions | USER_SCOPED | YES | YES | parent assignment APIs | UNVERIFIED |
| Parent Tests | `/parent/tests` | `ParentTestResults` | `ProtectedRoute` | parent portal permissions | USER_SCOPED | YES | YES | parent test APIs | UNVERIFIED |
| Parent Alerts | `/parent/alerts` | `ParentAlerts` | `ProtectedRoute` | parent portal permissions | USER_SCOPED | YES | YES | parent alert APIs | UNVERIFIED |
| Parent AI | `/parent/ai` | `ParentAiAssistant` | `ProtectedRoute` | parent portal permissions | USER_SCOPED | YES | YES | parent AI APIs | UNVERIFIED |

## Shared Before / After

- Before: school-scoped protected routes could mount without school context and child pages often stalled behind `canRunRequests`.
- After: school-scoped protected routes now terminate into a finite context-blocked state before broken child runtime begins.
