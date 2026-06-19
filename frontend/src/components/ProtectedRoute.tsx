import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { LoadingSpinner } from '@components/LoadingSpinner';
import { useAuth } from '@/contexts/AuthProvider';
import type { UserRole } from '@types';

type ProtectedRouteProps = {
  children: ReactNode;
  allowedRoles?: UserRole[];
  requiredPermissions?: string[];
};

export function ProtectedRoute({ children, allowedRoles, requiredPermissions }: ProtectedRouteProps) {
  const location = useLocation();
  const { loading, initialized, user, canAccess, getDefaultRoute } = useAuth();

  if (loading || !initialized) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <LoadingSpinner />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (user.must_change_password && location.pathname !== '/force-password-change') {
    return <Navigate to="/force-password-change" replace />;
  }

  if (!canAccess({ roles: allowedRoles, permissions: requiredPermissions })) {
    return <Navigate to={getDefaultRoute(user)} replace />;
  }

  return <>{children}</>;
}
