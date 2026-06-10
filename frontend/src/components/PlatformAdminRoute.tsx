import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
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
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

export default PlatformAdminRoute;
