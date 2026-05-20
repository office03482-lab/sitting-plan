import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';
import type { User, UserRole, UserType } from '@types';
import { useAuthStore } from '@store/auth';

type MembershipRole = {
  role_key: string;
  role_name: string;
  is_system?: boolean;
} | null;

type MembershipRecord = {
  id: string;
  school_id: string;
  role_id: string;
  status: string;
  is_primary: boolean;
  is_active: boolean;
  roles?: MembershipRole | MembershipRole[];
};

type AuthContextValue = {
  loading: boolean;
  initialized: boolean;
  user: User | null;
  session: Session | null;
  authError: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  getDefaultRoute: (user?: User | null) => string;
  hasRole: (roles: UserRole | UserRole[]) => boolean;
  hasPermission: (permissions: string | string[]) => boolean;
  canAccess: (options?: { roles?: UserRole[]; permissions?: string[] }) => boolean;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

async function diagnoseSupabaseConnectivityError() {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/health`, {
      method: 'GET',
    });

    return {
      reachable: true,
      status: response.status,
    };
  } catch (error) {
    return {
      reachable: false,
      error,
    };
  }
}

async function normalizeAuthError(error: unknown): Promise<Error> {
  if (error instanceof Error) {
    if (error.message === 'Failed to fetch') {
      const diagnostics = await diagnoseSupabaseConnectivityError();
      if (!diagnostics.reachable) {
        return new Error(
          'Supabase server tak request nahi pahunch rahi. Internet, browser firewall/extension, ya Supabase project URL/availability check karo.'
        );
      }

      return new Error(
        `Supabase reachable hai (health ${diagnostics.status}), lekin auth request fail ho rahi hai. Browser network tab me /auth/v1/token request check karo.`
      );
    }
    return error;
  }

  return new Error('Authentication failed.');
}

function mapRoleKeyToLegacyRole(roleKey?: string | null): UserRole {
  if (roleKey === 'platform_admin' || roleKey === 'school_admin') return 'admin';
  if (roleKey === 'teacher') return 'teacher';
  if (roleKey === 'store_manager') return 'store_manager';
  if (roleKey === 'student') return 'student';
  if (roleKey === 'staff' || roleKey === 'hr' || roleKey === 'viewer_staff') return 'staff';
  return 'viewer';
}

function mapRoleKeyToUserType(roleKey?: string | null): UserType {
  if (roleKey === 'teacher') return 'teaching';
  if (roleKey === 'student') return 'student';
  return 'non_teaching';
}

function getDefaultRouteForUser(user?: User | null) {
  if (!user) return '/login';
  if (user.role === 'admin') return '/';
  if (user.role === 'store_manager') return '/inventory';
  if (user.role === 'teacher') return user.permissions?.includes('attendance') ? '/attendance-management' : '/timetable';
  if (user.role === 'staff') {
    if (user.permissions?.includes('inventory')) return '/inventory';
    if (user.permissions?.includes('attendance')) return '/attendance-management';
    return '/';
  }
  if (user.role === 'student') return '/attendance-management';
  if (user.permissions?.includes('attendance')) return '/attendance-management';
  if (user.permissions?.includes('timetable') || user.permissions?.includes('timetable.view')) return '/timetable';
  if (user.permissions?.includes('edupay')) return '/edupay';
  return '/';
}

async function fetchRolePermissions(roleId: string) {
  const { data, error } = await supabase
    .from('role_permissions')
    .select('permissions(permission_key)')
    .eq('role_id', roleId);

  if (error) {
    throw error;
  }

  return (data || [])
    .map((item: any) => item.permissions?.permission_key)
    .filter(Boolean) as string[];
}

async function buildAppUserFromSession(session: Session): Promise<User> {
  const userId = session.user.id;

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select(`
      id,
      email,
      full_name,
      display_name,
      is_active,
      default_school_id
    `)
    .eq('id', userId)
    .single();

  if (profileError) {
    throw profileError;
  }

  const { data: memberships, error: membershipError } = await supabase
    .from('school_memberships')
    .select(`
      id,
      school_id,
      role_id,
      status,
      is_primary,
      is_active,
      roles (
        role_key,
        role_name,
        is_system
      )
    `)
    .eq('profile_id', userId)
    .eq('is_active', true)
    .eq('status', 'active');

  if (membershipError) {
    throw membershipError;
  }

  const membershipList = ((memberships || []) as unknown as MembershipRecord[]).map((item) => ({
    ...item,
    roles: Array.isArray(item.roles) ? item.roles[0] || null : item.roles || null,
  }));
  const activeMembership =
    membershipList.find((item) => item.is_primary) ||
    membershipList.find((item) => item.school_id === profile.default_school_id) ||
    membershipList[0];

  if (!activeMembership) {
    throw new Error('No active school membership found for this user.');
  }

  const permissions = await fetchRolePermissions(activeMembership.role_id);
  const roleKey = activeMembership.roles?.role_key || 'viewer';

  return {
    id: profile.id,
    email: profile.email || session.user.email || '',
    full_name: profile.full_name || profile.display_name || session.user.email || 'User',
    role: mapRoleKeyToLegacyRole(roleKey),
    role_key: roleKey,
    user_type: mapRoleKeyToUserType(roleKey),
    permissions,
    school_id: activeMembership.school_id,
    membership_id: activeMembership.id,
    default_school_id: profile.default_school_id,
    is_active: Boolean(profile.is_active),
    username: profile.display_name || profile.email || session.user.email || undefined,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const hydrate = useAuthStore((state) => state.hydrate);
  const logoutStore = useAuthStore((state) => state.logout);
  const storeUser = useAuthStore((state) => state.user);
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const failedSessionFingerprintRef = useRef<string | null>(null);
  const initializedRef = useRef(false);
  const lastProfileBootstrapUserIdRef = useRef<string | null>(null);
  const storeUserRef = useRef(storeUser);
  const authErrorRef = useRef(authError);
  const activeSyncFingerprintRef = useRef<string | null>(null);
  const currentSessionFingerprintRef = useRef<string | null>(null);
  const tokenRefreshDebounceRef = useRef<number | null>(null);

  useEffect(() => {
    storeUserRef.current = storeUser;
  }, [storeUser]);

  useEffect(() => {
    authErrorRef.current = authError;
  }, [authError]);

  useEffect(() => {
    currentSessionFingerprintRef.current = getSessionFingerprint(session);
  }, [session]);

  const getSessionFingerprint = (value: Session | null) => {
    if (!value?.user?.id || !value?.access_token) return null;
    return `${value.user.id}:${value.access_token.slice(0, 16)}`;
  };

  useEffect(() => {
    let isMounted = true;

    const clearAuthState = () => {
      if (!isMounted) return;
      setSession(null);
      setAuthError(null);
      failedSessionFingerprintRef.current = null;
      lastProfileBootstrapUserIdRef.current = null;
      activeSyncFingerprintRef.current = null;
      logoutStore();
      setLoading(false);
      setInitialized(true);
      initializedRef.current = true;
    };

    const syncSession = async (
      nextSession: Session | null,
      options?: {
        bootstrapProfile?: boolean;
        silentTokenRefresh?: boolean;
        origin?: string;
      },
    ) => {
      if (!isMounted) return;

      const origin = options?.origin || 'unknown';
      const currentFingerprint = currentSessionFingerprintRef.current;
      const nextFingerprint = getSessionFingerprint(nextSession);
      console.debug('[auth-sync]', 'syncSession.request', {
        origin,
        currentFingerprint,
        nextFingerprint,
        bootstrapProfile: options?.bootstrapProfile,
        silentTokenRefresh: options?.silentTokenRefresh,
      });

      if (!nextSession) {
        clearAuthState();
        return;
      }

      if (!nextSession.access_token || !nextSession.user?.id) {
        clearAuthState();
        return;
      }

      const shouldBootstrapProfile =
        options?.bootstrapProfile ??
        (
          !storeUserRef.current ||
          storeUserRef.current.id !== nextSession.user.id ||
          lastProfileBootstrapUserIdRef.current !== nextSession.user.id
        );

      if (
        shouldBootstrapProfile &&
        nextFingerprint &&
        failedSessionFingerprintRef.current === nextFingerprint &&
        authErrorRef.current &&
        !storeUserRef.current
      ) {
        setSession(nextSession);
        setLoading(false);
        setInitialized(true);
        initializedRef.current = true;
        return;
      }

      if (options?.silentTokenRefresh && storeUserRef.current && storeUserRef.current.id === nextSession.user.id) {
        failedSessionFingerprintRef.current = null;
        useAuthStore.getState().hydrate({
          token: nextSession.access_token,
          refreshToken: nextSession.refresh_token,
          user: storeUserRef.current,
        });
        console.debug('[auth-sync]', 'syncSession.silent_refresh_applied', {
          origin,
          nextFingerprint,
          userId: nextSession.user.id,
        });
        return;
      }

      if (currentFingerprint && nextFingerprint && currentFingerprint === nextFingerprint && !shouldBootstrapProfile) {
        console.debug('[auth-sync]', 'syncSession.noop_same_fingerprint', {
          origin,
          nextFingerprint,
        });
        return;
      }

      if (!shouldBootstrapProfile) {
        setSession(nextSession);
        setAuthError(null);
        failedSessionFingerprintRef.current = null;
        hydrate({
          token: nextSession.access_token,
          refreshToken: nextSession.refresh_token,
          user: storeUserRef.current,
        });
        setLoading(false);
        setInitialized(true);
        initializedRef.current = true;
        console.debug('[auth-sync]', 'syncSession.fast_path_complete', {
          origin,
          nextFingerprint,
        });
        return;
      }

      if (nextFingerprint && activeSyncFingerprintRef.current === nextFingerprint) {
        console.debug('[auth-sync]', 'syncSession.skipped_active_duplicate', {
          origin,
          nextFingerprint,
        });
        return;
      }

      setLoading(true);
      activeSyncFingerprintRef.current = nextFingerprint;

      try {
        const appUser = await buildAppUserFromSession(nextSession);
        if (!isMounted) return;
        setAuthError(null);
        failedSessionFingerprintRef.current = null;
        lastProfileBootstrapUserIdRef.current = nextSession.user.id;
        setSession(nextSession);
        hydrate({
          token: nextSession.access_token,
          refreshToken: nextSession.refresh_token,
          user: appUser,
        });
        console.debug('[auth-sync]', 'syncSession.bootstrap_complete', {
          origin,
          nextFingerprint,
          userId: nextSession.user.id,
        });
      } catch (error) {
        console.error('Failed to build authenticated ERP user from Supabase session.', error);
        if (!isMounted) return;
        setSession(nextSession);
        failedSessionFingerprintRef.current = nextFingerprint;
        setAuthError(
          error instanceof Error
            ? error.message
            : 'Authenticated session mili, lekin ERP profile ya school membership load nahi hui.',
        );
        hydrate({
          token: nextSession.access_token,
          refreshToken: nextSession.refresh_token,
          user: null,
        });
        console.debug('[auth-sync]', 'syncSession.bootstrap_failed', {
          origin,
          nextFingerprint,
          userId: nextSession.user.id,
        });
      } finally {
        if (isMounted) {
          activeSyncFingerprintRef.current = null;
          setLoading(false);
          setInitialized(true);
          initializedRef.current = true;
        }
      }
    };

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event: AuthChangeEvent, nextSession: Session | null) => {
      console.debug('[auth-sync]', 'onAuthStateChange', {
        event,
        fingerprint: getSessionFingerprint(nextSession),
      });
      if (event === 'TOKEN_REFRESHED') {
        if (tokenRefreshDebounceRef.current) {
          window.clearTimeout(tokenRefreshDebounceRef.current);
        }
        tokenRefreshDebounceRef.current = window.setTimeout(() => {
          void syncSession(nextSession, {
            bootstrapProfile: false,
            silentTokenRefresh: true,
            origin: 'TOKEN_REFRESHED',
          });
        }, 400);
        return;
      }

      void syncSession(nextSession, {
        bootstrapProfile: event === 'SIGNED_IN' || event === 'USER_UPDATED' || !initializedRef.current,
        origin: event,
      });
    });

    return () => {
      isMounted = false;
      if (tokenRefreshDebounceRef.current) {
        window.clearTimeout(tokenRefreshDebounceRef.current);
      }
      subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      loading,
      initialized,
      user: storeUser,
      session,
      authError,
      async signIn(email: string, password: string) {
        setLoading(true);
        setAuthError(null);
        try {
          const { error } = await supabase.auth.signInWithPassword({
            email,
            password,
          });

          if (error) {
            throw error;
          }
        } catch (error) {
          setLoading(false);
          throw await normalizeAuthError(error);
        }
      },
      async signOut() {
        await supabase.auth.signOut();
        setAuthError(null);
        failedSessionFingerprintRef.current = null;
        logoutStore();
      },
      getDefaultRoute: getDefaultRouteForUser,
      hasRole(roles) {
        if (!storeUser?.role) return false;
        const allowedRoles = Array.isArray(roles) ? roles : [roles];
        return allowedRoles.includes(storeUser.role);
      },
      hasPermission(permissions) {
        if (!storeUser?.is_active) return false;
        if (storeUser.role === 'admin' || storeUser.role_key === 'platform_admin' || storeUser.role_key === 'school_admin') {
          return true;
        }
        const wantedPermissions = Array.isArray(permissions) ? permissions : [permissions];
        const currentPermissions = storeUser.permissions || [];
        return wantedPermissions.some(
          (permission) =>
            currentPermissions.includes(permission) ||
            currentPermissions.some((item) => item.startsWith(`${permission}.`) || permission.startsWith(`${item}.`)),
        );
      },
      canAccess(options) {
        if (!storeUser?.is_active) return false;
        const roleOk = !options?.roles?.length || options.roles.includes(storeUser.role);
        const permissionOk =
          !options?.permissions?.length ||
          options.permissions.some(
            (permission) =>
              storeUser.role === 'admin' ||
              storeUser.role_key === 'platform_admin' ||
              storeUser.role_key === 'school_admin' ||
              (storeUser.permissions || []).includes(permission) ||
              (storeUser.permissions || []).some(
                (item) => item.startsWith(`${permission}.`) || permission.startsWith(`${item}.`),
              ),
          );
        return roleOk && permissionOk;
      },
    }),
    [authError, hydrate, initialized, loading, logoutStore, session, storeUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider.');
  }
  return context;
}
