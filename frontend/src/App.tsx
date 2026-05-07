/**
 * Main React App Component
 */
import { BrowserRouter as Router, Navigate, Route, Routes } from 'react-router-dom';

import { ErrorBoundary } from '@components/ErrorBoundary';
import Layout from '@components/Layout';
import { useAuthStore } from '@store/auth';

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

function AppShell() {
  const isLoggedIn = useAuthStore((state) => state.isLoggedIn());

  if (!isLoggedIn) {
    return <Navigate to="/login" replace />;
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/admin-office" element={<AdminOffice />} />
        <Route path="/rooms" element={<RoomConfiguration />} />
        <Route path="/seating/generate" element={<SeatingGeneration />} />
        <Route path="/seating/plans" element={<SeatingPlanManagement />} />
        <Route path="/attendance-management" element={<AttendanceManagement />} />
        <Route path="/hostels" element={<HostelManagement />} />
        <Route path="/teachers" element={<TeacherManagement />} />
        <Route path="/students" element={<StudentManagement />} />
        <Route path="/students/directory" element={<StudentDirectory />} />
        <Route path="/batches" element={<BatchManagement />} />
        <Route path="/staff/add" element={<AddStaff />} />
        <Route path="/staff/directory" element={<StaffDirectory />} />
        <Route path="/staff/bulk-upload" element={<StaffBulkUpload />} />
        <Route path="/invigilators" element={<InvigilatorManagement />} />
        <Route path="/timetable" element={<TimetableManagement />} />
        <Route path="/inventory" element={<InventoryManagement />} />
        <Route path="/edupay" element={<FeeManagement />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/admin/access-control" element={<AccessControl />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

export function App() {
  return (
    <ErrorBoundary>
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/*" element={<AppShell />} />
        </Routes>
      </Router>
    </ErrorBoundary>
  );
}

export default App;
