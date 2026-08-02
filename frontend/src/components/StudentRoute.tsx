import { Navigate, useSearchParams } from 'react-router-dom';
import type { ReactNode } from 'react';
import { LoadingSpinner } from '@components/LoadingSpinner';
import { canPreviewStudentPortal, useAuth } from '@/contexts/AuthProvider';

type StudentRouteProps = {
  children: ReactNode;
};

export function StudentRoute({ children }: StudentRouteProps) {
  const { user, authReady, loading } = useAuth();
  const [searchParams] = useSearchParams();

  if (loading || !authReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <LoadingSpinner />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  const isAdminPreview = canPreviewStudentPortal(user) && searchParams.has('preview');

  if (user.role !== 'student' && !isAdminPreview) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

export default StudentRoute;
