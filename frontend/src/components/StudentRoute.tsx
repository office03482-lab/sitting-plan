import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { LoadingSpinner } from '@components/LoadingSpinner';
import { useAuth } from '@/contexts/AuthProvider';

type StudentRouteProps = {
  children: ReactNode;
};

export function StudentRoute({ children }: StudentRouteProps) {
  const { user, authReady, loading } = useAuth();

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

  if (user.role !== 'student') {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

export default StudentRoute;
