import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { DEFAULT_HOME_ROUTE } from '@/contexts/AuthProvider';
import { useAuthStore } from '@store/auth';

type PlatformAdminRouteProps = {
  children: ReactNode;
};

export function PlatformAdminRoute({ children }: PlatformAdminRouteProps) {
  const user = useAuthStore((state) => state.user);

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (user.role_key !== 'platform_admin') {
    return <Navigate to={DEFAULT_HOME_ROUTE} replace />;
  }

  return <>{children}</>;
}

export default PlatformAdminRoute;
