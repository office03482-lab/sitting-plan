import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { LoadingSpinner } from '@components/LoadingSpinner';
import { useAuth } from '@/contexts/AuthProvider';
import { getMissingSchoolContextMessage } from '@services/api';
import { usePlatformAdminSchoolStore } from '@store/platformAdminSchool';
import PlatformAdminSchoolSelector from '@components/PlatformAdminSchoolSelector';
import type { UserRole } from '@types';

type ProtectedRouteProps = {
  children: ReactNode;
  allowedRoles?: UserRole[];
  requiredPermissions?: string[];
};

export function ProtectedRoute({ children, allowedRoles, requiredPermissions }: ProtectedRouteProps) {
  const location = useLocation();
  const { loading, initialized, user, canAccess, getDefaultRoute, schoolContextReady } = useAuth();
  const paActiveSchoolId = usePlatformAdminSchoolStore((s) => s.activeSchoolId);
  const isPlatformRoute = location.pathname.startsWith('/platform');
  const isForcePasswordRoute = location.pathname === '/force-password-change';
  const isPlatformUser = user?.role_key === 'platform_admin';
  const isNonPlatformRoute = !isPlatformRoute && !isForcePasswordRoute;
  const requiresSchoolContext = isNonPlatformRoute && !isPlatformUser;
  const paNeedsSchoolSelection = isPlatformUser && isNonPlatformRoute && !paActiveSchoolId;

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

  if (paNeedsSchoolSelection) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-lg">
          <PlatformAdminSchoolSelector returnPath={location.pathname} />
        </div>
      </div>
    );
  }

  if (requiresSchoolContext && !schoolContextReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-2xl rounded-3xl border border-amber-200 bg-white p-8 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-amber-700">Context Required</p>
          <h1 className="mt-3 text-2xl font-bold text-slate-900">This module needs an active school context</h1>
          <p className="mt-3 text-sm text-slate-600">
            {getMissingSchoolContextMessage('This module')}
          </p>
          <p className="mt-3 text-sm text-slate-500">
            {user.role_key === 'platform_admin'
              ? 'Platform Admin school-scoped routes cannot open until a school context is explicitly available.'
              : 'Your account is signed in, but the school context required by this module is not available right now.'}
          </p>
        </div>
      </div>
    );
  }

  if (!canAccess({ roles: allowedRoles, permissions: requiredPermissions })) {
    return <Navigate to={getDefaultRoute(user)} replace />;
  }

  return <>{children}</>;
}
