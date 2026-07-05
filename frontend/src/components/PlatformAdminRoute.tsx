import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { LoadingSpinner } from '@components/LoadingSpinner';
import { DEFAULT_HOME_ROUTE } from '@/contexts/AuthProvider';
import { useAuthStore } from '@store/auth';

type PlatformAdminRouteProps = {
  children: ReactNode;
};

export function PlatformAdminRoute({ children }: PlatformAdminRouteProps) {
  const user = useAuthStore((state) => state.user);
  const authLoading = useAuthStore((state) => state.auth_loading);
  const authInitialized = useAuthStore((state) => state.auth_initialized);

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
