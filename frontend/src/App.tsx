/**
 * Main React App Component
 */
import { BrowserRouter as Router, Navigate, Route, Routes } from 'react-router-dom';

import { ErrorBoundary } from '@components/ErrorBoundary';
import Layout from '@components/Layout';
import PlatformAdminRoute from '@components/PlatformAdminRoute';
import { ParentRoute } from '@components/ParentRoute';
import { ProtectedRoute } from '@components/ProtectedRoute';
import { StudentRoute } from '@components/StudentRoute';
import { DEFAULT_HOME_ROUTE, useAuth } from '@/contexts/AuthProvider';
import RegistrationError from '@components/RegistrationError';

import AccessControl from '@pages/AccessControl';
import AddStaff from '@pages/AddStaff';
import AdminOffice from '@pages/AdminOffice';
import AttendanceManagement from '@pages/AttendanceManagement';
import BatchManagement from '@pages/BatchManagement';
import Dashboard from '@pages/Dashboard';
import FeeManagement from '@pages/FeeManagement';
import ForcePasswordChange from '@pages/ForcePasswordChange';
import HostelManagement from '@pages/HostelManagement';
import InventoryManagement from '@pages/InventoryManagement';
import InvigilatorManagement from '@pages/InvigilatorManagement';
import CommercePage from '@pages/CommercePage';
import BusinessIntelligencePage from '@pages/BusinessIntelligencePage';
import LmsAssignments from '@pages/LmsAssignments';
import LiveClasses from '@pages/LiveClasses';
import Login from '@pages/Login';
import OnlineTestCreate from '@pages/OnlineTestCreate';
import OnlineTestEdit from '@pages/OnlineTestEdit';
import OnlineTestResults from '@pages/OnlineTestResults';
import OnlineTestTake from '@pages/OnlineTestTake';
import OnlineTests from '@pages/OnlineTests';
import AiStudyAssistantPage from '@pages/AiStudyAssistantPage';
import SchoolAiAssistantPage from '@pages/SchoolAiAssistantPage';
import TeacherAiAssistantPage from '@pages/TeacherAiAssistantPage';
import ParentIntelligencePortal from '@pages/ParentIntelligencePortal';
import ParentDashboard from '@pages/ParentDashboard';
import ParentAcademicProgress from '@pages/ParentAcademicProgress';
import ParentAttendance from '@pages/ParentAttendance';
import ParentTestResults from '@pages/ParentTestResults';
import ParentAssignments from '@pages/ParentAssignments';
import ParentAlerts from '@pages/ParentAlerts';
import ParentAiAssistant from '@pages/ParentAiAssistant';
import PortalAccessManager from '@pages/PortalAccessManager';
import CourseDetail from '@pages/CourseDetail';
import Courses from '@pages/Courses';
import LessonPlayer from '@pages/LessonPlayer';
import MyLearning from '@pages/MyLearning';
import Reports from '@pages/Reports';
import RoomConfiguration from '@pages/RoomConfiguration';
import SeatingGeneration from '@pages/SeatingGeneration';
import SeatingPlanManagement from '@pages/SeatingPlanManagement';
import Settings from '@pages/Settings';
import SecuritySessionsPage from '@pages/SecuritySessionsPage';
import StaffBulkUpload from '@pages/StaffBulkUpload';
import StaffDirectory from '@pages/StaffDirectory';
import StudentDirectory from '@pages/StudentDirectory';
import StudentManagement from '@pages/StudentManagement';
import TeacherManagement from '@pages/TeacherManagement';
import TimetableManagement from '@pages/TimetableManagement';
import PlatformAnalyticsPage from '@pages/PlatformAnalyticsPage';
import PlatformDashboard from '@pages/PlatformDashboard';
import PlatformGlobalSearchPage from '@pages/PlatformGlobalSearchPage';
import PlatformHealthDashboardPage from '@pages/PlatformHealthDashboardPage';
import PlatformWorkflowQueue from '@pages/PlatformWorkflowQueue';
import PlatformAuditLogs from '@pages/PlatformAuditLogs';
import PlatformNotificationCenterPage from '@pages/PlatformNotificationCenterPage';
import PlatformOnboardingWizardPage from '@pages/PlatformOnboardingWizardPage';
import PlatformSchoolDetailsPage from '@pages/PlatformSchoolDetailsPage';
import PlatformSchoolsPage from '@pages/PlatformSchoolsPage';
import PlatformSubscriptionCenterPage from '@pages/PlatformSubscriptionCenterPage';
import PlatformSupportCenterPage from '@pages/PlatformSupportCenterPage';
import PlatformUsageDashboardPage from '@pages/PlatformUsageDashboardPage';
import SchoolBackupCenterPage from '@pages/SchoolBackupCenterPage';
import SchoolBrandingPage from '@pages/SchoolBrandingPage';
import SchoolEmailTemplatesPage from '@pages/SchoolEmailTemplatesPage';
import SchoolPortalSettingsPage from '@pages/SchoolPortalSettingsPage';
import SchoolPreferencesPage from '@pages/SchoolPreferencesPage';
import SchoolSmsTemplatesPage from '@pages/SchoolSmsTemplatesPage';
import SchoolStorageCenterPage from '@pages/SchoolStorageCenterPage';

function SchoolAdminRoute({ children }: { children: JSX.Element }) {
  const { user, getDefaultRoute } = useAuth();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (user.role_key === 'platform_admin') {
    return <Navigate to={getDefaultRoute(user)} replace />;
  }

  return (
    <ProtectedRoute allowedRoles={['admin', 'school_admin']} requiredPermissions={['settings']}>
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
      </Router>
    </ErrorBoundary>
  );
}

export default App;
