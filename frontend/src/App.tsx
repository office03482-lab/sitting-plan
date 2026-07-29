/**
 * Main React App Component
 */
import { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Navigate, Route, Routes } from 'react-router-dom';

import { ErrorBoundary } from '@components/ErrorBoundary';
import Layout from '@components/Layout';
import { LoadingSpinner } from '@components/LoadingSpinner';
import PlatformAdminRoute from '@components/PlatformAdminRoute';
import { ParentRoute } from '@components/ParentRoute';
import { ProtectedRoute } from '@components/ProtectedRoute';
import { StudentRoute } from '@components/StudentRoute';
import { DEFAULT_HOME_ROUTE, useAuth } from '@/contexts/AuthProvider';
import RegistrationError from '@components/RegistrationError';

const AccessControl = lazy(() => import('@pages/AccessControl'));
const AddStaff = lazy(() => import('@pages/AddStaff'));
const AdminOffice = lazy(() => import('@pages/AdminOffice'));
const AttendanceManagement = lazy(() => import('@pages/AttendanceManagement'));
const BatchManagement = lazy(() => import('@pages/BatchManagement'));
const Dashboard = lazy(() => import('@pages/Dashboard'));
const FeeManagement = lazy(() => import('@pages/FeeManagement'));
const ForcePasswordChange = lazy(() => import('@pages/ForcePasswordChange'));
const HostelManagement = lazy(() => import('@pages/HostelManagement'));
const InventoryManagement = lazy(() => import('@pages/InventoryManagement'));
const InvigilatorManagement = lazy(() => import('@pages/InvigilatorManagement'));
const CommercePage = lazy(() => import('@pages/CommercePage'));
const BusinessIntelligencePage = lazy(() => import('@pages/BusinessIntelligencePage'));
const LmsAssignments = lazy(() => import('@pages/LmsAssignments'));
const LiveClasses = lazy(() => import('@pages/LiveClasses'));
const Login = lazy(() => import('@pages/Login'));
const OnlineTestCreate = lazy(() => import('@pages/OnlineTestCreate'));
const OnlineTestEdit = lazy(() => import('@pages/OnlineTestEdit'));
const OnlineTestResults = lazy(() => import('@pages/OnlineTestResults'));
const OnlineTestTake = lazy(() => import('@pages/OnlineTestTake'));
const OnlineTests = lazy(() => import('@pages/OnlineTests'));
const OfflineExams = lazy(() => import('@pages/OfflineExams'));
const OfflineExamCreate = lazy(() => import('@pages/OfflineExamCreate'));
const OfflineExamDetails = lazy(() => import('@pages/OfflineExamDetails'));
const OfflineExamEvaluate = lazy(() => import('@pages/OfflineExamEvaluate'));
const OfflineExamQuestionBuilder = lazy(() => import('@pages/OfflineExamQuestionBuilder'));
const QuestionBankList = lazy(() => import('@pages/QuestionBankList'));
const QuestionBuilder = lazy(() => import('@pages/QuestionBuilder'));
const AiStudyAssistantPage = lazy(() => import('@pages/AiStudyAssistantPage'));
const SchoolAiAssistantPage = lazy(() => import('@pages/SchoolAiAssistantPage'));
const TeacherAiAssistantPage = lazy(() => import('@pages/TeacherAiAssistantPage'));
const ParentIntelligencePortal = lazy(() => import('@pages/ParentIntelligencePortal'));
const ParentDashboard = lazy(() => import('@pages/ParentDashboard'));
const ParentAcademicProgress = lazy(() => import('@pages/ParentAcademicProgress'));
const ParentAttendance = lazy(() => import('@pages/ParentAttendance'));
const ParentTestResults = lazy(() => import('@pages/ParentTestResults'));
const ParentAssignments = lazy(() => import('@pages/ParentAssignments'));
const ParentAlerts = lazy(() => import('@pages/ParentAlerts'));
const ParentAiAssistant = lazy(() => import('@pages/ParentAiAssistant'));
const PortalAccessManager = lazy(() => import('@pages/PortalAccessManager'));
const CourseDetail = lazy(() => import('@pages/CourseDetail'));
const Courses = lazy(() => import('@pages/Courses'));
const LessonPlayer = lazy(() => import('@pages/LessonPlayer'));
const MyLearning = lazy(() => import('@pages/MyLearning'));
const Reports = lazy(() => import('@pages/Reports'));
const RoomConfiguration = lazy(() => import('@pages/RoomConfiguration'));
const SeatingGeneration = lazy(() => import('@pages/SeatingGeneration'));
const SeatingPlanManagement = lazy(() => import('@pages/SeatingPlanManagement'));
const Settings = lazy(() => import('@pages/Settings'));
const SecuritySessionsPage = lazy(() => import('@pages/SecuritySessionsPage'));
const StaffBulkUpload = lazy(() => import('@pages/StaffBulkUpload'));
const StaffDirectory = lazy(() => import('@pages/StaffDirectory'));
const StudentDirectory = lazy(() => import('@pages/StudentDirectory'));
const StudentManagement = lazy(() => import('@pages/StudentManagement'));
const TeacherManagement = lazy(() => import('@pages/TeacherManagement'));
const TimetableManagement = lazy(() => import('@pages/TimetableManagement'));
const PlatformAnalyticsPage = lazy(() => import('@pages/PlatformAnalyticsPage'));
const PlatformDashboard = lazy(() => import('@pages/PlatformDashboard'));
const PlatformGlobalSearchPage = lazy(() => import('@pages/PlatformGlobalSearchPage'));
const PlatformHealthDashboardPage = lazy(() => import('@pages/PlatformHealthDashboardPage'));
const PlatformWorkflowQueue = lazy(() => import('@pages/PlatformWorkflowQueue'));
const PlatformAuditLogs = lazy(() => import('@pages/PlatformAuditLogs'));
const PlatformNotificationCenterPage = lazy(() => import('@pages/PlatformNotificationCenterPage'));
const PlatformOnboardingWizardPage = lazy(() => import('@pages/PlatformOnboardingWizardPage'));
const PlatformSchoolDetailsPage = lazy(() => import('@pages/PlatformSchoolDetailsPage'));
const PlatformSchoolsPage = lazy(() => import('@pages/PlatformSchoolsPage'));
const PlatformSubscriptionCenterPage = lazy(() => import('@pages/PlatformSubscriptionCenterPage'));
const PlatformSupportCenterPage = lazy(() => import('@pages/PlatformSupportCenterPage'));
const PlatformUsageDashboardPage = lazy(() => import('@pages/PlatformUsageDashboardPage'));
const SchoolBackupCenterPage = lazy(() => import('@pages/SchoolBackupCenterPage'));
const SchoolBrandingPage = lazy(() => import('@pages/SchoolBrandingPage'));
const SchoolEmailTemplatesPage = lazy(() => import('@pages/SchoolEmailTemplatesPage'));
const SchoolPortalSettingsPage = lazy(() => import('@pages/SchoolPortalSettingsPage'));
const SchoolPreferencesPage = lazy(() => import('@pages/SchoolPreferencesPage'));
const SchoolSmsTemplatesPage = lazy(() => import('@pages/SchoolSmsTemplatesPage'));
const SchoolStorageCenterPage = lazy(() => import('@pages/SchoolStorageCenterPage'));

function RouteFallback() {
  return <LoadingSpinner message="Page load ho rahi hai..." />;
}

function SchoolAdminRoute({ children }: { children: JSX.Element }) {
  const { user } = useAuth();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <ProtectedRoute allowedRoles={['admin', 'school_admin', 'platform_admin']} requiredPermissions={['settings']}>
      {children}
    </ProtectedRoute>
  );
}

function AppShell() {
  const { user, getDefaultRoute } = useAuth();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (user.must_change_password) {
    return <Navigate to="/force-password-change" replace />;
  }

  return (
    <Layout>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<Navigate to={getDefaultRoute(user)} replace />} />
        <Route path={DEFAULT_HOME_ROUTE} element={<Dashboard />} />
        <Route
          path="/admin-office"
          element={
            <ProtectedRoute requiredPermissions={['admin_office']}>
              <AdminOffice />
            </ProtectedRoute>
          }
        />
        <Route
          path="/rooms"
          element={
            <ProtectedRoute requiredPermissions={['admin_office.rooms']}>
              <RoomConfiguration />
            </ProtectedRoute>
          }
        />
        <Route
          path="/seating/generate"
          element={
            <ProtectedRoute requiredPermissions={['admin_office.seating_generation']}>
              <SeatingGeneration />
            </ProtectedRoute>
          }
        />
        <Route
          path="/seating/plans"
          element={
            <ProtectedRoute requiredPermissions={['admin_office.seating_plans']}>
              <SeatingPlanManagement />
            </ProtectedRoute>
          }
        />
        <Route
          path="/attendance-management"
          element={
            <ProtectedRoute requiredPermissions={['attendance']}>
              <AttendanceManagement />
            </ProtectedRoute>
          }
        />
        <Route
          path="/hostels"
          element={
            <ProtectedRoute requiredPermissions={['admin_office.hostels']}>
              <HostelManagement />
            </ProtectedRoute>
          }
        />
        <Route
          path="/teachers"
          element={
            <ProtectedRoute requiredPermissions={['admin_office.teachers']}>
              <TeacherManagement />
            </ProtectedRoute>
          }
        />
        <Route
          path="/students"
          element={
            <ProtectedRoute requiredPermissions={['admin_office.students']}>
              <StudentManagement />
            </ProtectedRoute>
          }
        />
        <Route
          path="/students/directory"
          element={
            <ProtectedRoute requiredPermissions={['admin_office.students']}>
              <StudentDirectory />
            </ProtectedRoute>
          }
        />
        <Route
          path="/batches"
          element={
            <ProtectedRoute requiredPermissions={['admin_office.batches']}>
              <BatchManagement />
            </ProtectedRoute>
          }
        />
        <Route
          path="/staff/add"
          element={
            <ProtectedRoute requiredPermissions={['admin_office']}>
              <AddStaff />
            </ProtectedRoute>
          }
        />
        <Route
          path="/staff/directory"
          element={
            <ProtectedRoute requiredPermissions={['admin_office']}>
              <StaffDirectory />
            </ProtectedRoute>
          }
        />
        <Route
          path="/staff/bulk-upload"
          element={
            <ProtectedRoute requiredPermissions={['admin_office']}>
              <StaffBulkUpload />
            </ProtectedRoute>
          }
        />
        <Route
          path="/invigilators"
          element={
            <ProtectedRoute requiredPermissions={['admin_office.invigilators']}>
              <InvigilatorManagement />
            </ProtectedRoute>
          }
        />
        <Route
          path="/timetable"
          element={
            <ProtectedRoute requiredPermissions={['timetable']}>
              <TimetableManagement />
            </ProtectedRoute>
          }
        />
        <Route
          path="/inventory"
          element={
            <ProtectedRoute requiredPermissions={['inventory']}>
              <InventoryManagement />
            </ProtectedRoute>
          }
        />
        <Route
          path="/edupay"
          element={
            <ProtectedRoute requiredPermissions={['edupay']}>
              <FeeManagement />
            </ProtectedRoute>
          }
        />
        <Route
          path="/commerce"
          element={
            <ProtectedRoute requiredPermissions={['edupay.commerce', 'edupay.subscriptions', 'edupay.revenue']}>
              <CommercePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/bi"
          element={
            <ProtectedRoute requiredPermissions={['bi.academic', 'bi.finance', 'bi.operations', 'bi.platform', 'bi.reports']}>
              <BusinessIntelligencePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/school-ai-assistant"
          element={
            <ProtectedRoute requiredPermissions={['ai_agents.view', 'predictions.campus', 'predictions.finance', 'predictions.manage', 'bi.academic']}>
              <SchoolAiAssistantPage />
            </ProtectedRoute>
          }
        />
        <Route path="/predictions" element={<Navigate to="/school-ai-assistant" replace />} />
        <Route path="/ai-command-center" element={<Navigate to="/school-ai-assistant" replace />} />
        <Route
          path="/courses"
          element={
            <ProtectedRoute requiredPermissions={['lms.view', 'lms.manage', 'lms.progress', 'edupay.parent_portal']}>
              <Courses />
            </ProtectedRoute>
          }
        />
        <Route
          path="/course/:id"
          element={
            <ProtectedRoute requiredPermissions={['lms.view', 'lms.manage', 'lms.progress', 'edupay.parent_portal']}>
              <CourseDetail />
            </ProtectedRoute>
          }
        />
        <Route
          path="/lesson/:id"
          element={
            <ProtectedRoute requiredPermissions={['lms.view', 'lms.manage', 'lms.progress', 'edupay.parent_portal']}>
              <LessonPlayer />
            </ProtectedRoute>
          }
        />
        <Route
          path="/my-learning"
          element={
            <ProtectedRoute requiredPermissions={['lms.progress', 'lms.manage', 'edupay.parent_portal']}>
              <MyLearning />
            </ProtectedRoute>
          }
        />
        <Route
          path="/assignments"
          element={
            <ProtectedRoute requiredPermissions={['lms.assignments', 'lms.manage', 'lms.progress']}>
              <LmsAssignments />
            </ProtectedRoute>
          }
        />
        <Route
          path="/live-classes"
          element={
            <ProtectedRoute requiredPermissions={['live_classes.view', 'live_classes.manage', 'live_classes.join', 'live_classes.attendance', 'edupay.parent_portal']}>
              <LiveClasses />
            </ProtectedRoute>
          }
        />
        <Route
          path="/online-tests"
          element={
            <ProtectedRoute allowedRoles={['admin', 'teacher', 'student']}>
              <OnlineTests />
            </ProtectedRoute>
          }
        />
        <Route
          path="/online-tests/create"
          element={
            <ProtectedRoute allowedRoles={['admin', 'teacher']}>
              <OnlineTestCreate />
            </ProtectedRoute>
          }
        />
        <Route
          path="/online-tests/edit/:id"
          element={
            <ProtectedRoute allowedRoles={['admin', 'teacher']}>
              <OnlineTestEdit />
            </ProtectedRoute>
          }
        />
        <Route
          path="/online-tests/:id/build"
          element={
            <ProtectedRoute allowedRoles={['admin', 'teacher']}>
              <QuestionBuilder />
            </ProtectedRoute>
          }
        />
        <Route
          path="/online-tests/take/:id"
          element={
            <ProtectedRoute allowedRoles={['admin', 'student']}>
              <OnlineTestTake />
            </ProtectedRoute>
          }
        />
        <Route
          path="/online-tests/results/:id"
          element={
            <ProtectedRoute allowedRoles={['admin', 'teacher', 'student']}>
              <OnlineTestResults />
            </ProtectedRoute>
          }
        />
        <Route
          path="/offline-exams"
          element={
            <ProtectedRoute allowedRoles={['admin', 'teacher', 'student']}>
              <OfflineExams />
            </ProtectedRoute>
          }
        />
        <Route
          path="/offline-exams/create"
          element={
            <ProtectedRoute allowedRoles={['admin', 'teacher']}>
              <OfflineExamCreate />
            </ProtectedRoute>
          }
        />
        <Route
          path="/offline-exams/edit/:examId"
          element={
            <ProtectedRoute allowedRoles={['admin', 'teacher']}>
              <OfflineExamCreate />
            </ProtectedRoute>
          }
        />
        <Route
          path="/offline-exams/details/:examId"
          element={
            <ProtectedRoute allowedRoles={['admin', 'teacher', 'student']}>
              <OfflineExamDetails />
            </ProtectedRoute>
          }
        />
        <Route
          path="/offline-exams/evaluate/:examId"
          element={
            <ProtectedRoute allowedRoles={['admin', 'teacher']}>
              <OfflineExamEvaluate />
            </ProtectedRoute>
          }
        />
        <Route
          path="/offline-exams/build/:examId"
          element={
            <ProtectedRoute allowedRoles={['admin', 'teacher']}>
              <OfflineExamQuestionBuilder />
            </ProtectedRoute>
          }
        />
        <Route
          path="/question-bank"
          element={
            <ProtectedRoute allowedRoles={['admin', 'teacher']}>
              <QuestionBankList />
            </ProtectedRoute>
          }
        />
        <Route
          path="/question-bank/add"
          element={
            <ProtectedRoute allowedRoles={['admin', 'teacher']}>
              <QuestionBuilder />
            </ProtectedRoute>
          }
        />
        <Route
          path="/question-bank/edit/:questionId"
          element={
            <ProtectedRoute allowedRoles={['admin', 'teacher']}>
              <QuestionBuilder />
            </ProtectedRoute>
          }
        />
        <Route
          path="/ai-study-assistant"
          element={
            <ProtectedRoute requiredPermissions={['study_planner.view', 'study_planner.goals', 'ai_tutor.chat', 'doubt_solver.solve', 'lms.progress']}>
              <AiStudyAssistantPage />
            </ProtectedRoute>
          }
        />
        <Route path="/study-planner" element={<Navigate to="/ai-study-assistant" replace />} />
        <Route path="/ai-tutor" element={<Navigate to="/ai-study-assistant" replace />} />
        <Route path="/doubts" element={<Navigate to="/ai-study-assistant" replace />} />
        <Route
          path="/teacher-ai"
          element={
            <ProtectedRoute requiredPermissions={['teacher_ai.generate', 'teacher_ai.evaluate', 'teacher_ai.reports']}>
              <TeacherAiAssistantPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/parent-intelligence"
          element={
            <ProtectedRoute requiredPermissions={['parent_intelligence.view', 'parent_intelligence.alerts', 'parent_intelligence.reports', 'edupay.parent_portal']}>
              <ParentIntelligencePortal />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports"
          element={
            <ProtectedRoute requiredPermissions={['admin_office.reports']}>
              <Reports />
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <ProtectedRoute requiredPermissions={['settings']}>
              <Settings />
            </ProtectedRoute>
          }
        />
        <Route
          path="/school-self-service/branding"
          element={
            <SchoolAdminRoute>
              <SchoolBrandingPage />
            </SchoolAdminRoute>
          }
        />
        <Route
          path="/school-self-service/preferences"
          element={
            <SchoolAdminRoute>
              <SchoolPreferencesPage />
            </SchoolAdminRoute>
          }
        />
        <Route
          path="/school-self-service/portal-settings"
          element={
            <SchoolAdminRoute>
              <SchoolPortalSettingsPage />
            </SchoolAdminRoute>
          }
        />
        <Route
          path="/school-self-service/email-templates"
          element={
            <SchoolAdminRoute>
              <SchoolEmailTemplatesPage />
            </SchoolAdminRoute>
          }
        />
        <Route
          path="/school-self-service/messaging-templates"
          element={
            <SchoolAdminRoute>
              <SchoolSmsTemplatesPage />
            </SchoolAdminRoute>
          }
        />
        <Route
          path="/school-self-service/storage"
          element={
            <SchoolAdminRoute>
              <SchoolStorageCenterPage />
            </SchoolAdminRoute>
          }
        />
        <Route
          path="/school-self-service/backups"
          element={
            <SchoolAdminRoute>
              <SchoolBackupCenterPage />
            </SchoolAdminRoute>
          }
        />
        <Route
          path="/admin/access-control"
          element={
            <ProtectedRoute requiredPermissions={['admin_office.access_control']}>
              <AccessControl />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/portal-access"
          element={
            <ProtectedRoute requiredPermissions={['admin_office.access_control']}>
              <PortalAccessManager />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/security-sessions"
          element={
            <ProtectedRoute requiredPermissions={['admin_office.access_control']}>
              <SecuritySessionsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/platform/dashboard"
          element={
            <PlatformAdminRoute>
              <PlatformDashboard />
            </PlatformAdminRoute>
          }
        />
        <Route
          path="/platform/schools"
          element={
            <PlatformAdminRoute>
              <PlatformSchoolsPage />
            </PlatformAdminRoute>
          }
        />
        <Route
          path="/platform/schools/:schoolId"
          element={
            <PlatformAdminRoute>
              <PlatformSchoolDetailsPage />
            </PlatformAdminRoute>
          }
        />
        <Route
          path="/platform/subscriptions"
          element={
            <PlatformAdminRoute>
              <PlatformSubscriptionCenterPage />
            </PlatformAdminRoute>
          }
        />
        <Route
          path="/platform/usage"
          element={
            <PlatformAdminRoute>
              <PlatformUsageDashboardPage />
            </PlatformAdminRoute>
          }
        />
        <Route
          path="/platform/health"
          element={
            <PlatformAdminRoute>
              <PlatformHealthDashboardPage />
            </PlatformAdminRoute>
          }
        />
        <Route
          path="/platform/search"
          element={
            <PlatformAdminRoute>
              <PlatformGlobalSearchPage />
            </PlatformAdminRoute>
          }
        />
        <Route
          path="/platform/analytics"
          element={
            <PlatformAdminRoute>
              <PlatformAnalyticsPage />
            </PlatformAdminRoute>
          }
        />
        <Route
          path="/platform/support"
          element={
            <PlatformAdminRoute>
              <PlatformSupportCenterPage />
            </PlatformAdminRoute>
          }
        />
        <Route
          path="/platform/notifications"
          element={
            <PlatformAdminRoute>
              <PlatformNotificationCenterPage />
            </PlatformAdminRoute>
          }
        />
        <Route
          path="/platform/onboarding"
          element={
            <PlatformAdminRoute>
              <PlatformOnboardingWizardPage />
            </PlatformAdminRoute>
          }
        />
        <Route
          path="/platform/workflow"
          element={
            <PlatformAdminRoute>
              <PlatformWorkflowQueue />
            </PlatformAdminRoute>
          }
        />
        <Route
          path="/platform/audit-logs"
          element={
            <PlatformAdminRoute>
              <PlatformAuditLogs />
            </PlatformAdminRoute>
          }
        />
        {/* Student Portal Routes */}
        <Route
          path="/student/dashboard"
          element={
            <StudentRoute>
              <MyLearning />
            </StudentRoute>
          }
        />
        {/* Parent Portal Routes */}
        <Route
          path="/parent"
          element={
            <ParentRoute>
              <ParentDashboard />
            </ParentRoute>
          }
        />
        <Route
          path="/parent/dashboard"
          element={
            <ParentRoute>
              <ParentDashboard />
            </ParentRoute>
          }
        />
        <Route
          path="/parent/attendance"
          element={
            <ParentRoute>
              <ParentAttendance />
            </ParentRoute>
          }
        />
        <Route
          path="/parent/progress"
          element={
            <ParentRoute>
              <ParentAcademicProgress />
            </ParentRoute>
          }
        />
        <Route
          path="/parent/assignments"
          element={
            <ParentRoute>
              <ParentAssignments />
            </ParentRoute>
          }
        />
        <Route
          path="/parent/tests"
          element={
            <ParentRoute>
              <ParentTestResults />
            </ParentRoute>
          }
        />
        <Route
          path="/parent/alerts"
          element={
            <ParentRoute>
              <ParentAlerts />
            </ParentRoute>
          }
        />
        <Route
          path="/parent/ai"
          element={
            <ParentRoute>
              <ParentAiAssistant />
            </ParentRoute>
          }
        />
          <Route path="*" element={<Navigate to={getDefaultRoute(user)} replace />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}

function PortalDenied({ message }: { message: string }) {
  const { signOut } = useAuth();
  const isStudentDenial = message.includes('student');
  const isParentDenial = message.includes('parent');
  const portalName = isStudentDenial ? 'Student Portal' : isParentDenial ? 'Parent Portal' : 'Portal';

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md rounded-3xl border border-orange-200 bg-white p-8 shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.24em] text-orange-700">Access Denied</p>
        <h1 className="mt-3 text-2xl font-bold text-slate-900">{portalName} Access Unavailable</h1>
        <p className="mt-3 text-sm text-slate-600">
          This account is not linked to an active {isStudentDenial ? 'student profile' : isParentDenial ? 'parent account' : 'portal identity'}.
        </p>
        <div className="mt-4 rounded-xl border border-orange-100 bg-orange-50 px-4 py-3">
          <p className="text-xs font-medium text-orange-800">{message}</p>
        </div>
        <div className="mt-6 flex flex-col gap-3">
          <button
            type="button"
            onClick={signOut}
            className="flex w-full items-center justify-center rounded-full border border-slate-300 bg-white px-6 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
          >
            Back to portal selection
          </button>
          <button
            type="button"
            onClick={signOut}
            className="flex w-full items-center justify-center rounded-full bg-sky-600 px-6 py-3 text-sm font-bold text-white shadow-sm hover:bg-sky-700"
          >
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}

export function App() {
  const { user, loading, initialized, getDefaultRoute, authStatus, sessionRegistrationError } = useAuth();

  if (authStatus === 'PORTAL_DENIED') {
    return (
      <ErrorBoundary>
        <PortalDenied message={sessionRegistrationError || 'Access denied for this portal.'} />
      </ErrorBoundary>
    );
  }

  if (authStatus === 'REGISTRATION_ERROR') {
    return (
      <ErrorBoundary>
        <RegistrationError errorMessage={sessionRegistrationError || 'Session registration failed'} />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <Router>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route
              path="/login"
              element={
                initialized && !loading && user ? <Navigate to={user.must_change_password ? '/force-password-change' : getDefaultRoute(user)} replace /> : <Login />
              }
            />
            <Route
              path="/force-password-change"
              element={
                <ProtectedRoute>
                  <ForcePasswordChange />
                </ProtectedRoute>
              }
            />
            <Route
              path="/*"
              element={
                <ProtectedRoute>
                  <AppShell />
                </ProtectedRoute>
              }
            />
          </Routes>
        </Suspense>
      </Router>
    </ErrorBoundary>
  );
}

export default App;
