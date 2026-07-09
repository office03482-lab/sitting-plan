import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { LoadingSpinner } from '@components/LoadingSpinner';
import { DEFAULT_HOME_ROUTE, useAuth } from '@/contexts/AuthProvider';

type PlatformAdminRouteProps = {
  children: ReactNode;
};

export function PlatformAdminRoute({ children }: PlatformAdminRouteProps) {
  const { user, loading: authLoading, initialized: authInitialized } = useAuth();

  if (authLoading || !authInitialized) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <LoadingSpinner />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (user.role_key !== 'platform_admin') {
    return <Navigate to={DEFAULT_HOME_ROUTE} replace />;
  }

  return <>{children}</>;
}

export default PlatformAdminRoute;
