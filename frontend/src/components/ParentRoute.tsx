import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { LoadingSpinner } from '@components/LoadingSpinner';
import { ProtectedRoute } from '@components/ProtectedRoute';
import { useAuth } from '@/contexts/AuthProvider';

type ParentRouteProps = {
  children: ReactNode;
};

export function ParentRoute({ children }: ParentRouteProps) {
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

  if (user.role === 'parent') {
    return <>{children}</>;
  }

  return (
    <ProtectedRoute requiredPermissions={['parent_intelligence.view', 'parent_intelligence.reports', 'edupay.parent_portal']}>
      {children}
    </ProtectedRoute>
  );
}

export default ParentRoute;
