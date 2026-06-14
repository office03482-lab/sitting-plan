/**
 * Main React App Component
 */
import { BrowserRouter as Router, Navigate, Route, Routes } from 'react-router-dom';

import { ErrorBoundary } from '@components/ErrorBoundary';
import Layout from '@components/Layout';
import PlatformAdminRoute from '@components/PlatformAdminRoute';
import { ProtectedRoute } from '@components/ProtectedRoute';
import { useAuth } from '@/contexts/AuthProvider';

import AccessControl from '@pages/AccessControl';
import AddStaff from '@pages/AddStaff';
import AdminOffice from '@pages/AdminOffice';
import AttendanceManagement from '@pages/AttendanceManagement';
import BatchManagement from '@pages/BatchManagement';
import Dashboard from '@pages/Dashboard';
import FeeManagement from '@pages/FeeManagement';
import HostelManagement from '@pages/HostelManagement';
import InventoryManagement from '@pages/InventoryManagement';
import InvigilatorManagement from '@pages/InvigilatorManagement';
import CommercePage from '@pages/CommercePage';
import BusinessIntelligencePage from '@pages/BusinessIntelligencePage';
import PredictiveIntelligencePage from '@pages/PredictiveIntelligencePage';
import AiAcademicOperatingSystemPage from '@pages/AiAcademicOperatingSystemPage';
import LmsAssignments from '@pages/LmsAssignments';
import LiveClasses from '@pages/LiveClasses';
import Login from '@pages/Login';
import OnlineTestCreate from '@pages/OnlineTestCreate';
import OnlineTestEdit from '@pages/OnlineTestEdit';
import OnlineTestResults from '@pages/OnlineTestResults';
import OnlineTestTake from '@pages/OnlineTestTake';
import OnlineTests from '@pages/OnlineTests';
import AiTutorPage from '@pages/AiTutorPage';
import AiDoubtSolverPage from '@pages/AiDoubtSolverPage';
import TeacherAiAssistantPage from '@pages/TeacherAiAssistantPage';
import ParentIntelligencePortal from '@pages/ParentIntelligencePortal';
import CourseDetail from '@pages/CourseDetail';
import Courses from '@pages/Courses';
import LessonPlayer from '@pages/LessonPlayer';
import MyLearning from '@pages/MyLearning';
import Reports from '@pages/Reports';
import RoomConfiguration from '@pages/RoomConfiguration';
import SeatingGeneration from '@pages/SeatingGeneration';
import SeatingPlanManagement from '@pages/SeatingPlanManagement';
import Settings from '@pages/Settings';
import StaffBulkUpload from '@pages/StaffBulkUpload';
import StaffDirectory from '@pages/StaffDirectory';
import StudentDirectory from '@pages/StudentDirectory';
import StudentManagement from '@pages/StudentManagement';
import StudyPlanner from '@pages/StudyPlanner';
import TeacherManagement from '@pages/TeacherManagement';
import TimetableManagement from '@pages/TimetableManagement';
import PlatformDashboard from '@pages/PlatformDashboard';
import PlatformWorkflowQueue from '@pages/PlatformWorkflowQueue';
import PlatformAuditLogs from '@pages/PlatformAuditLogs';

function AppShell() {
  const { user } = useAuth();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
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
          path="/predictions"
          element={
            <ProtectedRoute requiredPermissions={['predictions.student', 'predictions.campus', 'predictions.finance', 'predictions.manage', 'edupay.parent_portal']}>
              <PredictiveIntelligencePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/ai-command-center"
          element={
            <ProtectedRoute requiredPermissions={['ai_agents.view', 'ai_agents.run', 'ai_agents.approve', 'ai_agents.reports']}>
              <AiAcademicOperatingSystemPage />
            </ProtectedRoute>
          }
        />
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
          path="/study-planner"
          element={
            <ProtectedRoute requiredPermissions={['study_planner.view', 'study_planner.goals', 'study_planner.reports', 'edupay.parent_portal']}>
              <StudyPlanner />
            </ProtectedRoute>
          }
        />
        <Route
          path="/ai-tutor"
          element={
            <ProtectedRoute requiredPermissions={['ai_tutor.chat', 'ai_tutor.review', 'ai_tutor.manage']}>
              <AiTutorPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/doubts"
          element={
            <ProtectedRoute requiredPermissions={['doubt_solver.solve', 'doubt_solver.review', 'doubt_solver.manage', 'doubt_solver.escalate']}>
              <AiDoubtSolverPage />
            </ProtectedRoute>
          }
        />
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
          path="/admin/access-control"
          element={
            <ProtectedRoute requiredPermissions={['admin_office.access_control']}>
              <AccessControl />
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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

export function App() {
  const { user, loading, initialized, getDefaultRoute } = useAuth();

  return (
    <ErrorBoundary>
      <Router>
        <Routes>
          <Route
            path="/login"
            element={
              initialized && !loading && user ? <Navigate to={getDefaultRoute(user)} replace /> : <Login />
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
