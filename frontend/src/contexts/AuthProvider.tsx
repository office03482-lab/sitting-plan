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

import { apiService, getStoredActiveSessionKey, getStoredDeviceId, ACTIVE_SESSION_STORAGE_KEY } from '@services/api';
import { supabase } from '@/lib/supabase';
import { runtimeConfig } from '@/lib/runtimeConfig';
import type { User, UserRole, UserType } from '@types';
import { useAuthStore, isJwtActive } from '@store/auth';

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

export type AuthStatus = 'IDLE' | 'INITIALIZING' | 'AUTHENTICATED' | 'UNAUTHENTICATED';

type AuthContextValue = {
  loading: boolean;
  initialized: boolean;
  authReady: boolean;
  sessionReady: boolean;
  schoolContextReady: boolean;
  sessionRegistrationReady: boolean;
  authStatus: AuthStatus;
  user: User | null;
  session: Session | null;
  authError: string | null;
  signIn: (identifier: string, password: string, options?: { forceTakeover?: boolean }) => Promise<void>;
  signOut: () => Promise<void>;
  reloadUserProfile: () => Promise<void>;
  getDefaultRoute: (user?: User | null) => string;
  hasRole: (roles: UserRole | UserRole[]) => boolean;
  hasPermission: (permissions: string | string[]) => boolean;
  canAccess: (options?: { roles?: UserRole[]; permissions?: string[] }) => boolean;
};

type ReadySignal = {
  promise: Promise<void>;
  resolve: () => void;
  reject: (reason?: unknown) => void;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const AUTH_STORAGE_KEYS = [
  'auth_token',
  'token',
  'access_token',
  'refresh_token',
  'user',
  'sitting-plan-auth',
] as const;

const ACTIVE_SESSION_HEARTBEAT_MS = 60_000;
const SESSION_REGISTRATION_RETRY_DELAYS_MS = [350, 900];
const SESSION_REGISTRATION_ATTEMPT_TIMEOUTS_MS = [8_000, 12_000, 18_000];

const createReadySignal = (): ReadySignal => {
  let resolvePromise!: () => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
  };
};

const createAuthInitializationRegistry = () => {
  let signal = createReadySignal();

  return {
    status: 'IDLE' as AuthStatus,
    lastError: null as string | null,
    readyPromise: signal.promise,
    reset(nextStatus: AuthStatus = 'INITIALIZING') {
      signal = createReadySignal();
      this.readyPromise = signal.promise;
      this.status = nextStatus;
      this.lastError = null;
    },
    resolve(nextStatus: AuthStatus) {
      this.status = nextStatus;
      signal.resolve();
    },
    fail(reason: unknown, nextStatus: AuthStatus = 'UNAUTHENTICATED') {
      this.status = nextStatus;
      this.lastError =
        reason instanceof Error
          ? reason.message
          : typeof reason === 'string'
            ? reason
            : 'Auth initialization failed.';
      signal.resolve();
    },
  };
};

export const AuthInitializationRegistry = createAuthInitializationRegistry();
export const DEFAULT_HOME_ROUTE = '/overview';

function clearPersistedAuthArtifacts() {
  if (typeof window === 'undefined') return;
  for (const key of AUTH_STORAGE_KEYS) {
    window.localStorage.removeItem(key);
    window.sessionStorage.removeItem(key);
  }
  window.localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
}

function generateActiveSessionKey() {
  return `sess-${Math.random().toString(36).slice(2, 12)}-${Date.now().toString(36)}`;
}

function getBrowserLabel() {
  if (typeof navigator === 'undefined') return 'Browser';
  const userAgent = navigator.userAgent;
  if (userAgent.includes('Edg/')) return 'Microsoft Edge';
  if (userAgent.includes('Chrome/')) return 'Google Chrome';
  if (userAgent.includes('Firefox/')) return 'Mozilla Firefox';
  if (userAgent.includes('Safari/') && !userAgent.includes('Chrome/')) return 'Safari';
  return 'Browser';
}

function getDeviceLabel() {
  if (typeof navigator === 'undefined') return 'Unknown device';
  return `${navigator.platform || 'Web'} device`;
}

function redirectToLogin() {
  if (typeof window === 'undefined') return;
  if (!window.location.pathname.startsWith('/login')) {
    window.location.replace('/login');
  }
}

function wait(delayMs: number) {
  return new Promise((resolve) => window.setTimeout(resolve, delayMs));
}

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
    const authError = error as Error & { code?: string; conflict?: { message?: string } };
    if (authError.code === 'session_limit_exceeded') {
      return authError;
    }
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

function isEmailIdentifier(value: string): boolean {
  return /\S+@\S+\.\S+/.test(value.trim());
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
  if (user.role_key === 'platform_admin') return DEFAULT_HOME_ROUTE;
  if (user.role_key === 'school_admin' || user.role === 'admin') return DEFAULT_HOME_ROUTE;
  if (user.role_key === 'parent' || user.permissions?.includes('parent_intelligence.view') || user.permissions?.includes('edupay.parent_portal')) return '/parent/dashboard';
  if (user.role === 'teacher' && user.permissions?.includes('teacher_ai.generate')) return '/teacher-ai';
  if (user.role === 'student' && (user.permissions?.includes('doubt_solver.solve') || user.permissions?.includes('study_planner.view'))) return '/ai-study-assistant';
  if (user.permissions?.includes('doubt_solver.solve')) return '/ai-study-assistant';
  if (user.role === 'store_manager') return '/inventory';
  if (user.role === 'teacher') return user.permissions?.includes('attendance') ? '/attendance-management' : '/timetable';
  if (user.role === 'staff') {
    if (user.permissions?.includes('inventory')) return '/inventory';
    if (user.permissions?.includes('attendance')) return '/attendance-management';
    return '/';
  }
  if (user.role === 'student') return '/ai-study-assistant';
  if (user.permissions?.includes('attendance')) return '/attendance-management';
  if (user.permissions?.includes('timetable') || user.permissions?.includes('timetable.view')) return '/timetable';
  if (user.permissions?.includes('edupay')) return '/edupay';
  return '/';
}

function hasResolvedSchoolContext(user?: User | null): boolean {
  return Boolean(
    user?.role &&
    String(user?.school_id || '').trim() &&
    String(user?.membership_id || '').trim(),
  );
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
      default_school_id,
      metadata
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
    username:
      profile.metadata?.portal_access?.username ||
      profile.metadata?.username ||
      profile.display_name ||
      profile.email ||
      session.user.email ||
      undefined,
    must_change_password: Boolean(profile.metadata?.portal_access?.must_change_password),
    first_login_completed: Boolean(profile.metadata?.portal_access?.first_login_completed),
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const hydrate = useAuthStore((state) => state.hydrate);
  const logoutStore = useAuthStore((state) => state.logout);
  const setAuthLifecycle = useAuthStore((state) => state.setAuthLifecycle);
  const storeUser = useAuthStore((state) => state.user);

  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus>('IDLE');
  const [sessionRegistrationReady, setSessionRegistrationReady] = useState(false);

  const storeUserRef = useRef(storeUser);
  const authErrorRef = useRef(authError);
  const failedSessionFingerprintRef = useRef<string | null>(null);
  const initializedRef = useRef(false);
  const lastProfileBootstrapUserIdRef = useRef<string | null>(null);
  const activeSyncFingerprintRef = useRef<string | null>(null);
  const currentSessionFingerprintRef = useRef<string | null>(null);
  const tokenRefreshDebounceRef = useRef<number | null>(null);
  const authSubscriptionAttachedRef = useRef(false);
  const sessionRegistrationFingerprintRef = useRef<string | null>(null);
  const sessionRegistrationInFlightRef = useRef<{ fingerprint: string; promise: Promise<string> } | null>(null);

  useEffect(() => {
    storeUserRef.current = storeUser;
  }, [storeUser]);

  useEffect(() => {
    authErrorRef.current = authError;
  }, [authError]);

  useEffect(() => {
    currentSessionFingerprintRef.current = getSessionFingerprint(session);
  }, [session]);

  const ensurePortalSessionRegistered = async (
    accessToken: string,
    options?: { forceTakeover?: boolean },
  ) => {
    const sessionKey = getStoredActiveSessionKey() || generateActiveSessionKey();
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, sessionKey);
    }
    const registrationUrl = `${runtimeConfig.apiUrl || import.meta.env.VITE_API_URL || '/api'}/account-security/sessions/register`;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= SESSION_REGISTRATION_RETRY_DELAYS_MS.length; attempt += 1) {
      const controller = new AbortController();
      const timeoutMs = SESSION_REGISTRATION_ATTEMPT_TIMEOUTS_MS[Math.min(attempt, SESSION_REGISTRATION_ATTEMPT_TIMEOUTS_MS.length - 1)];
      const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
      const attemptStartedAt = performance.now();
      try {
        await fetch(registrationUrl, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'X-Device-Id': getStoredDeviceId(),
          },
          body: JSON.stringify({
            session_key: sessionKey,
            device_id: getStoredDeviceId(),
            device_name: getDeviceLabel(),
            browser: getBrowserLabel(),
            force_takeover: Boolean(options?.forceTakeover),
          }),
        }).then(async (response) => {
          if (response.ok) {
            console.debug('[auth-session-registration]', {
              attempt: attempt + 1,
              method: 'POST',
              path: '/account-security/sessions/register',
              status: response.status,
              duration_ms: Math.round(performance.now() - attemptStartedAt),
            });
            return response.json().catch(() => ({}));
          }
          const payload = await response.json().catch(() => ({}));
          const detail = payload?.detail;
          console.debug('[auth-session-registration]', {
            attempt: attempt + 1,
            method: 'POST',
            path: '/account-security/sessions/register',
            status: response.status,
            duration_ms: Math.round(performance.now() - attemptStartedAt),
          });
          if (detail?.code === 'session_limit_exceeded') {
            const error = new Error(detail.message || 'Existing session detected') as Error & {
              code?: string;
              conflict?: unknown;
            };
            error.code = 'session_limit_exceeded';
            error.conflict = detail;
            throw error;
          }
          throw new Error(typeof detail === 'string' ? detail : payload?.message || 'Session registration failed');
        });
        window.clearTimeout(timeoutId);
        return sessionKey;
      } catch (error) {
        window.clearTimeout(timeoutId);
        if ((error as any)?.code === 'session_limit_exceeded') {
          throw error;
        }
        if (error instanceof DOMException && error.name === 'AbortError') {
          lastError = new Error('Session registration timeout');
        } else {
          lastError = error instanceof Error ? error : new Error('Session registration failed');
        }
        console.warn('[auth-session-registration]', {
          attempt: attempt + 1,
          method: 'POST',
          path: '/account-security/sessions/register',
          status: Number((error as any)?.response?.status || 0) || null,
          duration_ms: Math.round(performance.now() - attemptStartedAt),
          reason: lastError.message,
          aborted: error instanceof DOMException && error.name === 'AbortError',
        });
        if (attempt >= SESSION_REGISTRATION_RETRY_DELAYS_MS.length) {
          break;
        }
        await wait(SESSION_REGISTRATION_RETRY_DELAYS_MS[attempt]);
      }
    }

    throw lastError || new Error('Session registration failed');
  };

  const registerPortalSession = async (
    nextSession: Session,
    options?: { forceTakeover?: boolean },
  ) => {
    const fingerprint = `${nextSession.user.id}:${getStoredActiveSessionKey() || 'pending'}`;
    if (sessionRegistrationReady && sessionRegistrationFingerprintRef.current === fingerprint) {
      return getStoredActiveSessionKey() || '';
    }
    const inFlight = sessionRegistrationInFlightRef.current;
    if (inFlight?.fingerprint === fingerprint) {
      return inFlight.promise;
    }

    const promise = ensurePortalSessionRegistered(nextSession.access_token, options).finally(() => {
      if (sessionRegistrationInFlightRef.current?.promise === promise) {
        sessionRegistrationInFlightRef.current = null;
      }
    });
    sessionRegistrationInFlightRef.current = {
      fingerprint,
      promise,
    };
    return promise;
  };

  const reloadUserProfile = async () => {
    if (!session) return;
    const appUser = await buildAppUserFromSession(session);
    hydrate({
      token: session.access_token,
      refreshToken: session.refresh_token,
      user: appUser,
    });
  };

  useEffect(() => {
    setAuthLifecycle({
      auth_initialized: initialized,
      auth_loading: loading,
    });
  }, [initialized, loading, setAuthLifecycle]);

  const getSessionFingerprint = (value: Session | null) => {
    if (!value?.user?.id || !value?.access_token) return null;
    return `${value.user.id}:${value.access_token.slice(0, 16)}`;
  };

  useEffect(() => {
    if (authSubscriptionAttachedRef.current) {
      return;
    }
    authSubscriptionAttachedRef.current = true;

    let isMounted = true;
    AuthInitializationRegistry.reset('INITIALIZING');
    setAuthStatus('INITIALIZING');
    setLoading(true);

    const finalizeInitialization = (status: AuthStatus, errorMessage?: string | null) => {
      if (!isMounted) return;
      setAuthStatus(status);
      setAuthError(errorMessage ?? null);
      setLoading(false);
      setInitialized(true);
      initializedRef.current = true;
      if (errorMessage) {
        AuthInitializationRegistry.fail(errorMessage, status);
      } else {
        AuthInitializationRegistry.resolve(status);
      }
    };

    const clearAuthState = (options?: { redirectToLogin?: boolean; reason?: string | null }) => {
      if (!isMounted) return;
      clearPersistedAuthArtifacts();
      setSession(null);
      setSessionRegistrationReady(false);
      sessionRegistrationInFlightRef.current = null;
      failedSessionFingerprintRef.current = null;
      lastProfileBootstrapUserIdRef.current = null;
      activeSyncFingerprintRef.current = null;
      sessionRegistrationFingerprintRef.current = null;
      logoutStore();
      finalizeInitialization('UNAUTHENTICATED', options?.reason ?? null);
      if (options?.redirectToLogin) {
        redirectToLogin();
      }
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

      if (!nextSession?.access_token || !nextSession?.user?.id) {
        clearAuthState({
          redirectToLogin: origin === 'SIGNED_OUT',
        });
        return;
      }

      const shouldBootstrapProfile =
        options?.bootstrapProfile ??
        (
          !storeUserRef.current ||
          storeUserRef.current.id !== nextSession.user.id ||
          lastProfileBootstrapUserIdRef.current !== nextSession.user.id ||
          !hasResolvedSchoolContext(storeUserRef.current)
        );

      if (
        shouldBootstrapProfile &&
        nextFingerprint &&
        failedSessionFingerprintRef.current === nextFingerprint &&
        authErrorRef.current &&
        !storeUserRef.current
      ) {
        setSession(nextSession);
        setSessionRegistrationReady(false);
        finalizeInitialization('UNAUTHENTICATED', authErrorRef.current);
        return;
      }

      if (
        options?.silentTokenRefresh &&
        storeUserRef.current &&
        storeUserRef.current.id === nextSession.user.id &&
        hasResolvedSchoolContext(storeUserRef.current)
      ) {
        failedSessionFingerprintRef.current = null;
        useAuthStore.getState().hydrate({
          token: nextSession.access_token,
          refreshToken: nextSession.refresh_token,
          user: storeUserRef.current,
        });
        setSession(nextSession);
        setSessionRegistrationReady(Boolean(getStoredActiveSessionKey()));
        finalizeInitialization('AUTHENTICATED');
        console.debug('[auth-sync]', 'syncSession.silent_refresh_applied', {
          origin,
          nextFingerprint,
          userId: nextSession.user.id,
        });
        return;
      }

      if (
        currentFingerprint &&
        nextFingerprint &&
        currentFingerprint === nextFingerprint &&
        !shouldBootstrapProfile &&
        hasResolvedSchoolContext(storeUserRef.current)
      ) {
        setSessionRegistrationReady(Boolean(getStoredActiveSessionKey()));
        finalizeInitialization(storeUserRef.current ? 'AUTHENTICATED' : 'UNAUTHENTICATED', authErrorRef.current);
        console.debug('[auth-sync]', 'syncSession.noop_same_fingerprint', {
          origin,
          nextFingerprint,
        });
        return;
      }

      if (!shouldBootstrapProfile && hasResolvedSchoolContext(storeUserRef.current)) {
        setSession(nextSession);
        setAuthError(null);
        failedSessionFingerprintRef.current = null;
        hydrate({
          token: nextSession.access_token,
          refreshToken: nextSession.refresh_token,
          user: storeUserRef.current,
        });
        if (!getStoredActiveSessionKey()) {
          await registerPortalSession(nextSession);
        }
        if (!isMounted) return;
        setSessionRegistrationReady(true);
        sessionRegistrationFingerprintRef.current = `${nextSession.user.id}:${getStoredActiveSessionKey() || 'pending'}`;
        finalizeInitialization(storeUserRef.current ? 'AUTHENTICATED' : 'UNAUTHENTICATED');
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

      const shouldShowBlockingAuthLoad =
        !initializedRef.current ||
        !storeUserRef.current ||
        storeUserRef.current.id !== nextSession.user.id;
      if (shouldShowBlockingAuthLoad) {
        setAuthStatus('INITIALIZING');
        setLoading(true);
      }
      activeSyncFingerprintRef.current = nextFingerprint;

      try {
        let bootstrapSession = nextSession;
        if (!isJwtActive(bootstrapSession.access_token)) {
          const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
          if (!refreshError && refreshData?.session?.access_token) {
            bootstrapSession = refreshData.session;
            useAuthStore.getState().hydrate({
              token: bootstrapSession.access_token,
              refreshToken: bootstrapSession.refresh_token,
              user: storeUserRef.current,
            });
          }
        }
        const appUser = await buildAppUserFromSession(bootstrapSession);
        await registerPortalSession(bootstrapSession, {
          forceTakeover: options?.origin === 'SIGNED_IN' ? false : undefined,
        });
        if (!isMounted) return;

        setSession(bootstrapSession);
        setAuthError(null);
        setSessionRegistrationReady(true);
        failedSessionFingerprintRef.current = null;
        lastProfileBootstrapUserIdRef.current = bootstrapSession.user.id;
        sessionRegistrationFingerprintRef.current = `${bootstrapSession.user.id}:${getStoredActiveSessionKey() || 'pending'}`;
        hydrate({
          token: bootstrapSession.access_token,
          refreshToken: bootstrapSession.refresh_token,
          user: appUser,
        });
        finalizeInitialization('AUTHENTICATED');
        console.debug('[auth-sync]', 'syncSession.bootstrap_complete', {
          origin,
          nextFingerprint,
          userId: nextSession.user.id,
        });
      } catch (error) {
        console.error('Failed to build authenticated ERP user from Supabase session.', error);
        if (!isMounted) return;

        setSession(nextSession);
        setSessionRegistrationReady(false);
        failedSessionFingerprintRef.current = nextFingerprint;
        hydrate({
          token: nextSession.access_token,
          refreshToken: nextSession.refresh_token,
          user: null,
        });
        finalizeInitialization(
          'UNAUTHENTICATED',
          error instanceof Error
            ? error.message
            : 'Authenticated session mili, lekin ERP profile ya school membership load nahi hui.',
        );
        console.debug('[auth-sync]', 'syncSession.bootstrap_failed', {
          origin,
          nextFingerprint,
          userId: nextSession.user.id,
        });
      } finally {
        if (isMounted) {
          activeSyncFingerprintRef.current = null;
        }
      }
    };

    const bootstrapInitialSession = async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) {
          throw error;
        }
        await syncSession(data.session, {
          bootstrapProfile: true,
          origin: 'INITIAL_SESSION',
        });
      } catch (error) {
        console.error('Failed to initialize Supabase auth session.', error);
        clearAuthState({
          reason: error instanceof Error ? error.message : 'Failed to initialize auth session.',
        });
      }
    };

    void bootstrapInitialSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event: AuthChangeEvent, nextSession: Session | null) => {
      console.debug('[auth-sync]', 'onAuthStateChange', {
        event,
        fingerprint: getSessionFingerprint(nextSession),
      });

      if (event === 'SIGNED_OUT') {
        clearAuthState({
          redirectToLogin: true,
        });
        return;
      }

      if (event === 'TOKEN_REFRESHED') {
        if (nextSession?.access_token) {
          useAuthStore.getState().setToken(nextSession.access_token);
          if (nextSession.refresh_token) {
            useAuthStore.getState().setRefreshToken(nextSession.refresh_token);
          }
        }
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
      authSubscriptionAttachedRef.current = false;
    };
  }, [hydrate, logoutStore, setAuthLifecycle]);

  const value = useMemo<AuthContextValue>(
    () => {
      const schoolContextReady = hasResolvedSchoolContext(storeUser);

      return ({
      loading,
      initialized,
      authReady: authStatus === 'AUTHENTICATED' && schoolContextReady && sessionRegistrationReady && !!session,
      sessionReady: initialized && authStatus !== 'INITIALIZING' && !!session,
      schoolContextReady,
      sessionRegistrationReady,
      authStatus,
      user: storeUser,
      session,
      authError,
      async signIn(identifier: string, password: string, options?: { forceTakeover?: boolean }) {
        setLoading(true);
        setAuthStatus('INITIALIZING');
        AuthInitializationRegistry.reset('INITIALIZING');
        setAuthError(null);
        try {
          const trimmedIdentifier = identifier.trim();
          const loginEmail = isEmailIdentifier(trimmedIdentifier)
            ? trimmedIdentifier
            : String((await apiService.resolveLoginIdentifier(trimmedIdentifier)).data?.email || trimmedIdentifier).trim();
          const { data, error } = await supabase.auth.signInWithPassword({
            email: loginEmail,
            password,
          });

          if (error) {
            throw error;
          }
          if (!data.session?.access_token) {
            throw new Error('Authenticated session not returned by Supabase.');
          }
          await registerPortalSession(data.session, {
            forceTakeover: options?.forceTakeover,
          });
        } catch (error: any) {
          if (error?.code === 'session_limit_exceeded') {
            try {
              await supabase.auth.signOut();
            } catch {
              // ignore sign-out cleanup failure
            }
            setLoading(false);
            setAuthStatus('UNAUTHENTICATED');
            AuthInitializationRegistry.fail(error, 'UNAUTHENTICATED');
            throw await normalizeAuthError(error);
          }
          console.warn('Session registration failed (non-fatal during sign-in):', error);
          setLoading(false);
        }
      },
      async signOut() {
        try {
          const sessionKey = getStoredActiveSessionKey();
          if (sessionKey) {
            try {
              await apiService.logoutCurrentSecuritySession(sessionKey);
            } catch {
              // Session may already be gone; continue local sign-out.
            }
          }
          await supabase.auth.signOut();
        } finally {
          clearPersistedAuthArtifacts();
          logoutStore();
          setSession(null);
          setSessionRegistrationReady(false);
          setAuthStatus('UNAUTHENTICATED');
          setAuthError(null);
          AuthInitializationRegistry.resolve('UNAUTHENTICATED');
          redirectToLogin();
        }
      },
      reloadUserProfile,
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
    });
    },
    [authError, authStatus, initialized, loading, logoutStore, session, sessionRegistrationReady, storeUser],
  );

  useEffect(() => {
    if (!session?.access_token || !storeUser?.id || authStatus !== 'AUTHENTICATED') {
      sessionRegistrationFingerprintRef.current = null;
      return;
    }

    if (sessionRegistrationFingerprintRef.current === `${storeUser.id}:${getStoredActiveSessionKey() || 'pending'}`) {
      setSessionRegistrationReady(true);
      return;
    }
    sessionRegistrationFingerprintRef.current = `${storeUser.id}:${getStoredActiveSessionKey() || 'pending'}`;

    void registerPortalSession(session)
      .then(() => {
        setSessionRegistrationReady(true);
        sessionRegistrationFingerprintRef.current = `${storeUser.id}:${getStoredActiveSessionKey() || 'pending'}`;
      })
      .catch(async (error: any) => {
        const detail = error?.conflict;
        if (error?.code === 'session_limit_exceeded') {
          setAuthError(
            typeof detail?.message === 'string'
              ? detail.message
              : 'Existing session detected. Please sign in again and choose Continue Here.',
          );
          setSessionRegistrationReady(false);
          return;
        }
        console.warn('Session registration failed (non-fatal):', error);
        setSessionRegistrationReady(false);
      });
  }, [authStatus, logoutStore, session, storeUser?.id]);

  useEffect(() => {
    if (authStatus !== 'AUTHENTICATED' || !storeUser?.id) {
      return;
    }
    const sessionKey = getStoredActiveSessionKey();
    if (!sessionKey) return;
    const intervalId = window.setInterval(() => {
      void apiService.heartbeatSecuritySession(sessionKey).catch(() => {
        // Ignore transient heartbeat failures; middleware validation will enforce revocations.
      });
    }, ACTIVE_SESSION_HEARTBEAT_MS);
    return () => window.clearInterval(intervalId);
  }, [authStatus, storeUser?.id]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider.');
  }
  return context;
}
