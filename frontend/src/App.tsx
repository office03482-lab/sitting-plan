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
import Login from '@pages/Login';
import Reports from '@pages/Reports';
import RoomConfiguration from '@pages/RoomConfiguration';
import SeatingGeneration from '@pages/SeatingGeneration';
import SeatingPlanManagement from '@pages/SeatingPlanManagement';
import Settings from '@pages/Settings';
import StaffBulkUpload from '@pages/StaffBulkUpload';
import StaffDirectory from '@pages/StaffDirectory';
import StudentDirectory from '@pages/StudentDirectory';
import StudentManagement from '@pages/StudentManagement';
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
