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

import { apiService, getStoredActiveSessionKey, getStoredDeviceId, ACTIVE_SESSION_STORAGE_KEY, setRegisteredActiveSessionKey, getRegisteredActiveSessionKey, clearRegisteredActiveSessionKey } from '@services/api';
import { supabase } from '@/lib/supabase';
import { runtimeConfig } from '@/lib/runtimeConfig';
import type { PortalIntent, User, UserRole, UserType } from '@types';
import { usePlatformAdminSchoolStore } from '@store/platformAdminSchool';
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

export type AuthStatus = 'IDLE' | 'INITIALIZING' | 'AUTHENTICATED' | 'UNAUTHENTICATED' | 'REGISTRATION_ERROR' | 'PORTAL_DENIED';

type AuthContextValue = {
  loading: boolean;
  initialized: boolean;
  authReady: boolean;
  sessionReady: boolean;
  schoolContextReady: boolean;
  sessionRegistrationReady: boolean;
  sessionRegistrationError: string | null;
  authStatus: AuthStatus;
  portalIntent: PortalIntent;
  user: User | null;
  session: Session | null;
  authError: string | null;
  signIn: (identifier: string, password: string, options?: { forceTakeover?: boolean; portalIntent?: PortalIntent }) => Promise<void>;
  signOut: () => Promise<void>;
  reloadUserProfile: () => Promise<void>;
  retrySessionRegistration: () => Promise<void>;
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
const SESSION_REGISTRATION_RETRY_DELAYS_MS = [1000, 2000];
const SESSION_REGISTRATION_ATTEMPT_TIMEOUTS_MS = [15_000, 25_000, 40_000];
const PORTAL_INTENT_STORAGE_KEY = 'portal_intent';

function persistPortalIntent(intent: PortalIntent) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(PORTAL_INTENT_STORAGE_KEY, intent);
  } catch {}
}

function restorePortalIntent(): PortalIntent | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.sessionStorage.getItem(PORTAL_INTENT_STORAGE_KEY);
    if (stored === 'school_erp' || stored === 'platform_admin' || stored === 'student_portal' || stored === 'parent_portal') {
      return stored;
    }
  } catch {}
  return null;
}

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

const AuthInitializationRegistry = createAuthInitializationRegistry();
export const DEFAULT_HOME_ROUTE = '/overview';
export const PLATFORM_HOME_ROUTE = '/platform/dashboard';

function clearPersistedAuthArtifacts() {
  if (typeof window === 'undefined') {
    clearRegisteredActiveSessionKey();
    return;
  }
  for (const key of AUTH_STORAGE_KEYS) {
    window.localStorage.removeItem(key);
    window.sessionStorage.removeItem(key);
  }
  window.localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
  window.sessionStorage.removeItem(PORTAL_INTENT_STORAGE_KEY);
  clearRegisteredActiveSessionKey();
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

export function getDefaultRouteForUser(user?: User | null, portalIntent?: PortalIntent): string {
  console.debug('[auth-debug] getDefaultRouteForUser', { userId: user?.id, role: user?.role, role_key: user?.role_key, portalIntent });
  if (!user) return '/login';
  if (user.role_key === 'platform_admin') return PLATFORM_HOME_ROUTE;
  if (portalIntent === 'student_portal' || user.role === 'student') return '/student/dashboard';
  if (portalIntent === 'parent_portal' || user.role === 'parent') return '/parent/dashboard';
  if (user.role_key === 'school_admin' || user.role === 'admin') return DEFAULT_HOME_ROUTE;
  if (user.role_key === 'parent' || user.permissions?.includes('parent_intelligence.view') || user.permissions?.includes('edupay.parent_portal')) return '/parent/dashboard';
  if (user.role === 'teacher' && user.permissions?.includes('teacher_ai.generate')) return '/teacher-ai';
  if (user.permissions?.includes('doubt_solver.solve')) return '/ai-study-assistant';
  if (user.role === 'store_manager') return '/inventory';
  if (user.role === 'teacher') return user.permissions?.includes('attendance') ? '/attendance-management' : '/timetable';
  if (user.role === 'staff') {
    if (user.permissions?.includes('inventory')) return '/inventory';
    if (user.permissions?.includes('attendance')) return '/attendance-management';
    return '/';
  }
  if (user.permissions?.includes('attendance')) return '/attendance-management';
  if (user.permissions?.includes('timetable') || user.permissions?.includes('timetable.view')) return '/timetable';
  if (user.permissions?.includes('edupay')) return '/edupay';
  return '/';
}

export function isRouteCompatibleWithPortal(pathname: string, portalIntent: PortalIntent): boolean {
  if (portalIntent === 'platform_admin') {
    return pathname.startsWith('/platform') || pathname === '/';
  }
  if (portalIntent === 'student_portal') {
    return pathname.startsWith('/student') || pathname === '/';
  }
  if (portalIntent === 'parent_portal') {
    return pathname.startsWith('/parent') || pathname === '/';
  }
  return true;
}

function hasResolvedSchoolContext(user?: User | null, paActiveSchoolId?: string | null): boolean {
  if (user?.role_key === 'platform_admin') {
    return Boolean(paActiveSchoolId);
  }
  // Parents and students resolve school context from their linked entity
  // (guardian/student school_id), not a staff membership_id. Their portal
  // routes derive scope from this context, so treat a resolved school_id as
  // ready. Without this, schoolContextReady is permanently false and every
  // Parent/Student page hangs on its loading spinner.
  if (user?.role_key === 'parent' || user?.role === 'student') {
    return Boolean(String(user?.school_id || '').trim());
  }
  return Boolean(
    user?.role &&
    String(user?.school_id || '').trim() &&
    String(user?.membership_id || '').trim(),
  );
}

function hasResolvedUserContext(user?: User | null): boolean {
  if (!user?.id || !user.role) return false;
  if (user.role_key === 'platform_admin') return true;
  if (user.role === 'student') return Boolean(user.school_id);
  if (user.role === 'parent') return Boolean(user.school_id);
  return hasResolvedSchoolContext(user);
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

async function buildAppUserFromSession(session: Session, portalIntent: PortalIntent = 'school_erp'): Promise<User> {
  const userId = session.user.id;

  const [profileResult, membershipsResult] = await Promise.all([
    supabase
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
      .single(),
    supabase
      .from('school_memberships')
      .select(`
        id,
        school_id,
        role_id,
        status,
        is_primary,
        is_active
      `)
      .eq('profile_id', userId)
      .eq('is_active', true)
      .eq('status', 'active'),
  ]);

  const { data: profile, error: profileError } = profileResult;
  if (profileError) {
    throw profileError;
  }

  const { data: memberships, error: membershipError } = membershipsResult;
  if (membershipError) {
    throw membershipError;
  }

  console.debug('[auth-memberships] raw query result', {
    userId,
    count: (memberships || []).length,
    memberships,
  });

  const roleIds = [...new Set((memberships || []).map((m: any) => m.role_id).filter(Boolean))];
  let rolesMap = new Map<string, { role_key: string; role_name: string; is_system?: boolean }>();

  if (roleIds.length > 0) {
    const { data: rolesData, error: rolesError } = await supabase
      .from('roles')
      .select('id, role_key, role_name, is_system')
      .in('id', roleIds);

    if (rolesError) {
      console.warn('[auth-memberships] roles fetch failed (will proceed with null roles)', rolesError);
    } else if (rolesData) {
      for (const r of rolesData as any[]) {
        rolesMap.set(r.id, r);
      }
    }

    console.debug('[auth-memberships] roles fetch', {
      roleIds,
      rolesFound: rolesData?.length ?? 0,
      rolesMap: Object.fromEntries(rolesMap),
    });
  }

  const membershipList = ((memberships || []) as unknown as MembershipRecord[]).map((item) => ({
    ...item,
    roles: rolesMap.get(item.role_id) || null,
  }));

  console.debug('[auth-memberships] processed membershipList', {
    count: membershipList.length,
    items: membershipList.map((m) => ({
      id: m.id,
      school_id: m.school_id,
      role_id: m.role_id,
      role_key: m.roles?.role_key ?? null,
      is_primary: m.is_primary,
      is_active: m.is_active,
      status: m.status,
    })),
  });

  if (portalIntent === 'student_portal') {
    const { data: studentData, error: studentError } = await supabase
      .from('students')
      .select('id, school_id, roll_number, class_name, section, batch_id, is_active')
      .eq('profile_id', userId)
      .eq('is_active', true)
      .maybeSingle();

    if (studentError) throw studentError;
    if (!studentData) {
      throw new Error('No active student account found for this user.');
    }

    return {
      id: profile.id,
      email: profile.email || session.user.email || '',
      full_name: profile.full_name || profile.display_name || session.user.email || 'User',
      role: 'student' as const,
      role_key: 'student',
      user_type: 'student' as const,
      permissions: [],
      school_id: studentData.school_id,
      membership_id: undefined,
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

  if (portalIntent === 'parent_portal') {
    const { data: guardianData, error: guardianError } = await supabase
      .schema('academic')
      .from('guardians')
      .select('id, school_id, full_name, is_active')
      .eq('profile_id', userId)
      .eq('is_active', true)
      .maybeSingle();

    if (guardianError) throw guardianError;
    if (!guardianData) {
      throw new Error('No active parent account found for this user.');
    }

    const { data: linkData, error: linkError } = await supabase
      .schema('academic')
      .from('student_guardians')
      .select('student_id')
      .eq('guardian_id', guardianData.id)
      .limit(1);

    if (linkError) throw linkError;
    if (!linkData || linkData.length === 0) {
      throw new Error('No linked students found for this parent account.');
    }

    return {
      id: profile.id,
      email: profile.email || session.user.email || '',
      full_name: profile.full_name || profile.display_name || guardianData.full_name || session.user.email || 'User',
      role: 'parent' as const,
      role_key: 'parent',
      user_type: 'non_teaching' as const,
      permissions: [],
      school_id: guardianData.school_id,
      membership_id: undefined,
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

  // Platform Admin detection — role-based, not portal-intent-based.
  // A user with a platform_admin membership is always resolved as a Platform
  // Admin regardless of which portal intent was requested.  The downstream
  // ProtectedRoute + PlatformAdminSchoolSelector handle school-context
  // selection when the user navigates to school-scoped routes.
  const paMembership = membershipList.find((m) => {
    const role = Array.isArray(m.roles) ? m.roles[0] || null : m.roles;
    return role?.role_key === 'platform_admin';
  });

  if (portalIntent === 'platform_admin' && !paMembership) {
    throw new Error('You are not authorized to access Platform Admin.');
  }

  if (paMembership) {
    return {
      id: profile.id,
      email: profile.email || session.user.email || '',
      full_name: profile.full_name || profile.display_name || session.user.email || 'User',
      role: 'admin' as const,
      role_key: 'platform_admin',
      user_type: 'non_teaching' as const,
      permissions: [],
      school_id: '',
      membership_id: paMembership.id,
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

  const nonPaMemberships = membershipList.filter((item) => {
    const role = Array.isArray(item.roles) ? item.roles[0] || null : item.roles;
    return role?.role_key !== 'platform_admin';
  });

  console.debug('[auth-memberships] filtering result', {
    totalMemberships: membershipList.length,
    nonPaCount: nonPaMemberships.length,
    filteredOutAsPlatformAdmin: membershipList.length - nonPaMemberships.length,
    nonPaItems: nonPaMemberships.map((m) => ({
      id: m.id,
      school_id: m.school_id,
      role_key: m.roles?.role_key ?? null,
      is_primary: m.is_primary,
    })),
    defaultSchoolId: profile.default_school_id,
  });

  const activeMembership =
    nonPaMemberships.find((item) => item.is_primary) ||
    nonPaMemberships.find((item) => item.school_id === profile.default_school_id) ||
    nonPaMemberships[0];

  if (!activeMembership) {
    console.warn('[auth-memberships] no active membership found, trying guardian fallback', {
      userId,
      membershipListCount: membershipList.length,
      nonPaCount: nonPaMemberships.length,
      defaultSchoolId: profile.default_school_id,
      rawMemberships: memberships,
    });

    const { data: guardianData } = await supabase
      .schema('academic')
      .from('guardians')
      .select('id, school_id, full_name, is_active')
      .eq('profile_id', userId)
      .eq('is_active', true)
      .maybeSingle();

    if (guardianData) {
      return {
        id: profile.id,
        email: profile.email || session.user.email || '',
        full_name: profile.full_name || profile.display_name || guardianData.full_name || session.user.email || 'User',
        role: 'parent' as const,
        role_key: 'parent',
        user_type: 'non_teaching' as const,
        permissions: [],
        school_id: guardianData.school_id,
        membership_id: undefined,
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

    const rejectionReasons: string[] = [];
    if (membershipList.length === 0) {
      rejectionReasons.push(
        `school_memberships query returned 0 rows for profile_id=${userId} with is_active=true AND status=active. ` +
        'This typically means RLS is blocking the rows. Check: (1) profiles.id matches auth.uid(), ' +
        '(2) the membership row has is_active=true and status=active, ' +
        '(3) no other RLS policy is interfering.'
      );
    } else {
      rejectionReasons.push(
        `Found ${membershipList.length} membership(s) but all were excluded. ` +
        `Roles resolved: [${membershipList.map((m) => m.roles?.role_key ?? 'null').join(', ')}]. ` +
        `default_school_id=${profile.default_school_id}. ` +
        `Guardian fallback also returned null.`
      );
    }

    console.error('[auth-memberships] REJECTION', {
      userId,
      portalIntent,
      rawMemberships: memberships,
      processedMemberships: membershipList,
      nonPaMemberships,
      defaultSchoolId: profile.default_school_id,
      rejectionReasons,
    });

    throw new Error(
      `No active school membership found for this user. ${rejectionReasons.join(' ')}`
    );
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
  const [sessionRegistrationError, setSessionRegistrationError] = useState<string | null>(null);
  const paActiveSchoolId = usePlatformAdminSchoolStore((s) => s.activeSchoolId);

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
  const portalIntentRef = useRef<PortalIntent>('school_erp');
  const isSigningOutRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const heartbeatActiveRef = useRef(false);
  const signOutInProgressRef = useRef(false);

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
        if (typeof window !== 'undefined') {
          setRegisteredActiveSessionKey(sessionKey);
        }
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

    if (typeof window !== 'undefined') {
      clearRegisteredActiveSessionKey();
    }
    throw lastError || new Error('Session registration failed');
  };

  const registerPortalSession = async (
    nextSession: Session,
    options?: { forceTakeover?: boolean },
  ) => {
    const userId = nextSession.user.id;
    if (sessionRegistrationReady && sessionRegistrationFingerprintRef.current === userId) {
      return getRegisteredActiveSessionKey() || '';
    }
    const inFlight = sessionRegistrationInFlightRef.current;
    if (inFlight?.fingerprint === userId) {
      return inFlight.promise;
    }

    const promise = ensurePortalSessionRegistered(nextSession.access_token, options).finally(() => {
      if (sessionRegistrationInFlightRef.current?.promise === promise) {
        sessionRegistrationInFlightRef.current = null;
      }
    });
    sessionRegistrationInFlightRef.current = {
      fingerprint: userId,
      promise,
    };
    return promise;
  };

  const reloadUserProfile = async () => {
    if (!session) return;
    const appUser = await buildAppUserFromSession(session, portalIntentRef.current);
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
    const storedIntent = restorePortalIntent();
    if (storedIntent) {
      portalIntentRef.current = storedIntent;
    }
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
      usePlatformAdminSchoolStore.getState().clearActiveSchool();
      setSession(null);
      setSessionRegistrationReady(false);
      setSessionRegistrationError(null);
      sessionRegistrationInFlightRef.current = null;
      failedSessionFingerprintRef.current = null;
      lastProfileBootstrapUserIdRef.current = null;
      activeSyncFingerprintRef.current = null;
      sessionRegistrationFingerprintRef.current = null;
      portalIntentRef.current = 'school_erp';
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
          !hasResolvedUserContext(storeUserRef.current)
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
        hasResolvedUserContext(storeUserRef.current)
      ) {
        failedSessionFingerprintRef.current = null;
        useAuthStore.getState().hydrate({
          token: nextSession.access_token,
          refreshToken: nextSession.refresh_token,
          user: storeUserRef.current,
        });
        setSession(nextSession);
        setSessionRegistrationReady(Boolean(getRegisteredActiveSessionKey()));
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
        hasResolvedUserContext(storeUserRef.current)
      ) {
        setSessionRegistrationReady(Boolean(getRegisteredActiveSessionKey()));
        finalizeInitialization(storeUserRef.current ? 'AUTHENTICATED' : 'UNAUTHENTICATED', authErrorRef.current);
        console.debug('[auth-sync]', 'syncSession.noop_same_fingerprint', {
          origin,
          nextFingerprint,
        });
        return;
      }

      if (!shouldBootstrapProfile && hasResolvedUserContext(storeUserRef.current)) {
        setSession(nextSession);
        setAuthError(null);
        failedSessionFingerprintRef.current = null;
        hydrate({
          token: nextSession.access_token,
          refreshToken: nextSession.refresh_token,
          user: storeUserRef.current,
        });
        if (!getRegisteredActiveSessionKey()) {
          await registerPortalSession(nextSession);
        }
        if (!isMounted) return;
        setSessionRegistrationReady(true);
        sessionRegistrationFingerprintRef.current = nextSession.user.id;
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
      const effectivePortalIntent = portalIntentRef.current;

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
        const appUser = await buildAppUserFromSession(bootstrapSession, effectivePortalIntent);
        if (!isMounted) return;

        let resolvedPortalIntent = effectivePortalIntent;
        if (appUser.role_key === 'parent' && portalIntentRef.current !== 'parent_portal') {
          portalIntentRef.current = 'parent_portal';
          persistPortalIntent('parent_portal');
          resolvedPortalIntent = 'parent_portal';
        }

        setSession(bootstrapSession);
        setAuthError(null);

        if (resolvedPortalIntent === 'platform_admin' || resolvedPortalIntent === 'student_portal' || resolvedPortalIntent === 'parent_portal' || appUser.role_key === 'platform_admin') {
          setSessionRegistrationReady(false);
        } else {
          registerPortalSession(bootstrapSession, {
            forceTakeover: options?.origin === 'SIGNED_IN' ? false : undefined,
          }).then(() => {
            setSessionRegistrationReady(true);
          }).catch((regError) => {
            if ((regError as any)?.code === 'session_limit_exceeded') {
              setSessionRegistrationReady(false);
              setSessionRegistrationError((regError as any)?.conflict?.message || 'Existing session detected.');
              setAuthError((regError as any)?.conflict?.message || 'Existing session detected.');
              return;
            }
            console.warn('[auth-sync] session registration non-fatal:', regError);
            setSessionRegistrationReady(false);
            setSessionRegistrationError('Session registration unavailable. Some features may be limited.');
          });

          failedSessionFingerprintRef.current = null;
          lastProfileBootstrapUserIdRef.current = bootstrapSession.user.id;
          sessionRegistrationFingerprintRef.current = bootstrapSession.user.id;
        }
        hydrate({
          token: bootstrapSession.access_token,
          refreshToken: bootstrapSession.refresh_token,
          user: appUser,
        });
        persistPortalIntent(resolvedPortalIntent);
        // Debug: record the bootstrap outcome and the default route chosen for this user
        try {
          const defaultRoute = getDefaultRouteForUser(appUser);
          console.debug('[auth-debug] syncSession.bootstrap_complete', {
            origin,
            nextFingerprint,
            userId: nextSession.user.id,
            portalIntent: resolvedPortalIntent,
            appUser: { id: appUser.id, role: appUser.role, role_key: appUser.role_key, school_id: appUser.school_id },
            defaultRoute,
            locationPathname: typeof window !== 'undefined' ? window.location.pathname : null,
          });
        } catch (e) {
          console.debug('[auth-debug] syncSession.bootstrap_complete - logging failed', e);
        }
        finalizeInitialization('AUTHENTICATED');
      } catch (error) {
        console.error(`[auth-sync] syncSession failed for intent=${effectivePortalIntent}`, error);
        if (!isMounted) return;

        const errorMessage = error instanceof Error ? error.message : (error as any)?.message || 'Profile bootstrap failed.';
        const isSessionLimit = (error as any)?.code === 'session_limit_exceeded';
        const isDenial =
          errorMessage.includes('No active student account') ||
          errorMessage.includes('No active parent account') ||
          errorMessage.includes('not authorized') ||
          errorMessage.includes('Platform Admin');
        const noMembershipError = errorMessage.includes('No active school membership');

        if (isSessionLimit) {
          setSession(nextSession);
          setSessionRegistrationReady(false);
          setSessionRegistrationError(errorMessage);
          setAuthError(
            typeof (error as any)?.conflict?.message === 'string'
              ? (error as any)?.conflict?.message
              : 'Existing session detected.',
          );
          finalizeInitialization('REGISTRATION_ERROR', errorMessage);
          return;
        }

        if (isDenial) {
          setSession(nextSession);
          setSessionRegistrationReady(false);
          setSessionRegistrationError(errorMessage);
          failedSessionFingerprintRef.current = nextFingerprint;
          hydrate({
            token: nextSession.access_token,
            refreshToken: nextSession.refresh_token,
            user: null,
          });
          finalizeInitialization('PORTAL_DENIED', errorMessage);
          return;
        }

        if (noMembershipError && nextSession?.access_token) {
          setSession(nextSession);
          setSessionRegistrationReady(false);
          failedSessionFingerprintRef.current = nextFingerprint;
          hydrate({
            token: nextSession.access_token,
            refreshToken: nextSession.refresh_token,
            user: null,
          });
          finalizeInitialization('UNAUTHENTICATED', errorMessage);
          console.debug('[auth-sync]', 'syncSession.bootstrap_failed', {
            origin,
            nextFingerprint,
            userId: nextSession.user.id,
            portalIntent: effectivePortalIntent,
          });
          return;
        }

        if (nextSession?.access_token) {
          setSession(nextSession);
          setSessionRegistrationReady(false);
          setSessionRegistrationError(errorMessage);
          failedSessionFingerprintRef.current = nextFingerprint;
          hydrate({
            token: nextSession.access_token,
            refreshToken: nextSession.refresh_token,
            user: null,
          });
          finalizeInitialization('REGISTRATION_ERROR', errorMessage);
          console.debug('[auth-sync]', 'syncSession.registration_failed', {
            origin,
            nextFingerprint,
            userId: nextSession.user.id,
          });
        } else {
          clearAuthState({ reason: errorMessage });
        }
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

      // A fresh sign-in must always start in the Platform Workspace ("Managing
      // All Schools") for platform admins. Any school workspace context left
      // over from a previous session (persisted in localStorage) is cleared so
      // no individual school appears immediately after login. This only affects
      // the workspace-context UI, not auth/permissions/routes/APIs.
      //
      // IMPORTANT: Supabase fires SIGNED_IN on both fresh login AND page
      // refresh (session restore from storage). We only want to clear the
      // school context on a genuine fresh login, not on session restore.
      // If initializedRef is already true, this is a session restore — skip clearing.
      if (event === 'SIGNED_IN' && !initializedRef.current) {
        usePlatformAdminSchoolStore.getState().clearActiveSchool();
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
      const schoolContextReady = hasResolvedSchoolContext(storeUser, paActiveSchoolId);
      const effectivePortalIntent = portalIntentRef.current;

      return ({
      loading,
      initialized,
      authReady: (authStatus === 'AUTHENTICATED' || authStatus === 'REGISTRATION_ERROR') && !!session && (
        effectivePortalIntent === 'platform_admin' || effectivePortalIntent === 'student_portal' || effectivePortalIntent === 'parent_portal' || schoolContextReady
      ),
      sessionReady: initialized && authStatus !== 'INITIALIZING' && !!session,
      schoolContextReady,
      sessionRegistrationReady,
      sessionRegistrationError,
      authStatus,
      portalIntent: effectivePortalIntent,
      user: storeUser,
      session,
      authError,
      async signIn(identifier: string, password: string, _options?: { forceTakeover?: boolean; portalIntent?: PortalIntent }) {
        portalIntentRef.current = _options?.portalIntent || 'school_erp';
        if (typeof window !== 'undefined') {
          window.localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
          clearRegisteredActiveSessionKey();
        }
        setLoading(true);
        setAuthStatus('INITIALIZING');
        AuthInitializationRegistry.reset('INITIALIZING');
        setAuthError(null);
        try {
          const trimmedIdentifier = identifier.trim();
          if (!trimmedIdentifier) {
            throw new Error('Email or username is required.');
          }
          const loginEmail = isEmailIdentifier(trimmedIdentifier)
            ? trimmedIdentifier
            : String((await apiService.resolveLoginIdentifier(trimmedIdentifier, portalIntentRef.current)).data?.email || trimmedIdentifier).trim();
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

          await AuthInitializationRegistry.readyPromise;

          if (AuthInitializationRegistry.status !== 'AUTHENTICATED') {
            const errorMessage = AuthInitializationRegistry.lastError || 'Authentication initialization failed.';
            const error = new Error(errorMessage) as Error & { code?: string };
            error.code = 'auth_init_failed';
            throw error;
          }
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
          throw error;
        }
      },
      async signOut() {
        if (signOutInProgressRef.current) return;
        signOutInProgressRef.current = true;

        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
          abortControllerRef.current = null;
        }

        heartbeatActiveRef.current = false;
        isSigningOutRef.current = true;
        const sessionKey = getStoredActiveSessionKey();

        if (typeof window !== 'undefined') {
          window.localStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
          clearRegisteredActiveSessionKey();
        }
        clearPersistedAuthArtifacts();
        logoutStore();
        setSession(null);
        setSessionRegistrationReady(false);
        setSessionRegistrationError(null);
        setAuthStatus('UNAUTHENTICATED');
        setAuthError(null);
        AuthInitializationRegistry.resolve('UNAUTHENTICATED');
        portalIntentRef.current = 'school_erp';

        if (sessionKey) {
          apiService.logoutCurrentSecuritySession(sessionKey).catch(() => {});
        }
        try {
          await supabase.auth.signOut();
        } catch {
          // Best-effort Supabase signOut
        }
        signOutInProgressRef.current = false;
        isSigningOutRef.current = false;

        if (!window.location.pathname.startsWith('/login')) {
          window.location.replace('/login');
        }
      },
      reloadUserProfile,
      async retrySessionRegistration() {
        if (!session?.access_token) return;
        setSessionRegistrationError(null);
        setAuthStatus('INITIALIZING');
        setLoading(true);
        setInitialized(false);
        AuthInitializationRegistry.reset('INITIALIZING');
        try {
          await registerPortalSession(session);
          setSessionRegistrationReady(true);
          setAuthStatus('AUTHENTICATED');
          setLoading(false);
          setInitialized(true);
          initializedRef.current = true;
          AuthInitializationRegistry.resolve('AUTHENTICATED');
        } catch (error: any) {
          const isTimeout = error instanceof DOMException && error.name === 'AbortError';
          const errorMessage = isTimeout ? 'Session registration timeout' : (error?.message || 'Session registration failed');
          setSessionRegistrationError(errorMessage);
          setSessionRegistrationReady(false);
          setAuthStatus('REGISTRATION_ERROR');
          setLoading(false);
          setInitialized(true);
          initializedRef.current = true;
          AuthInitializationRegistry.fail(errorMessage, 'REGISTRATION_ERROR');
        }
      },
      getDefaultRoute: (user?: User | null) => getDefaultRouteForUser(user, portalIntentRef.current),
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
        const roleOk = !options?.roles?.length || options.roles.includes(storeUser.role) || storeUser.role_key === 'platform_admin';
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
    [authError, authStatus, initialized, loading, logoutStore, paActiveSchoolId, session, sessionRegistrationError, sessionRegistrationReady, storeUser],
  );

  useEffect(() => {
    if (!session?.access_token || !storeUser?.id || authStatus !== 'AUTHENTICATED') {
      sessionRegistrationFingerprintRef.current = null;
      return;
    }

    if (portalIntentRef.current === 'platform_admin' || portalIntentRef.current === 'student_portal' || portalIntentRef.current === 'parent_portal' || storeUser?.role_key === 'platform_admin') {
      return;
    }

    const currentKey = getStoredActiveSessionKey();
    if (!currentKey) {
      return;
    }

    if (sessionRegistrationFingerprintRef.current === storeUser.id) {
      setSessionRegistrationReady(true);
      return;
    }
    sessionRegistrationFingerprintRef.current = storeUser.id;

    const inFlight = sessionRegistrationInFlightRef.current;
    if (inFlight?.fingerprint === storeUser.id) {
      return;
    }

    void registerPortalSession(session)
      .then(() => {
        setSessionRegistrationReady(true);
        sessionRegistrationFingerprintRef.current = storeUser.id;
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
        const isTimeout = error instanceof DOMException && error.name === 'AbortError';
        const errorMessage = isTimeout ? 'Session registration timeout' : (error?.message || 'Session registration failed');
        console.warn('[auth] Session registration failed in background effect:', errorMessage);
        setSessionRegistrationError(errorMessage);
        setSessionRegistrationReady(false);
        setAuthStatus('REGISTRATION_ERROR');
      });
  }, [authStatus, logoutStore, session, storeUser?.id]);

  useEffect(() => {
    if (authStatus !== 'AUTHENTICATED' || !storeUser?.id) {
      return;
    }
    if (portalIntentRef.current === 'platform_admin' || portalIntentRef.current === 'student_portal' || portalIntentRef.current === 'parent_portal' || storeUser?.role_key === 'platform_admin') {
      return;
    }
    const sessionKey = getStoredActiveSessionKey();
    if (!sessionKey) return;
    let active = true;
    let scheduled = false;
    heartbeatActiveRef.current = true;
    const scheduleNext = () => {
      if (!active || !heartbeatActiveRef.current || isSigningOutRef.current) return;
      if (scheduled) return;
      scheduled = true;
      window.setTimeout(() => {
        scheduled = false;
        if (!active || !heartbeatActiveRef.current || isSigningOutRef.current) return;
        apiService.heartbeatSecuritySession(sessionKey).catch(() => {}).finally(() => {
          scheduleNext();
        });
      }, ACTIVE_SESSION_HEARTBEAT_MS);
    };
    scheduleNext();
    return () => {
      active = false;
      heartbeatActiveRef.current = false;
    };
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
