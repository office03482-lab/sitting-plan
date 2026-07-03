import { create } from 'zustand';
import type { User, AuthState } from '@types';

interface AuthStore extends AuthState {
  setUser: (user: User | null) => void;
  setToken: (token: string | null) => void;
  setRefreshToken: (refreshToken: string | null) => void;
  setAuthLifecycle: (payload: { auth_initialized: boolean; auth_loading: boolean }) => void;
  login: (token: string, user: User, refreshToken?: string | null) => void;
  hydrate: (payload: { token: string | null; refreshToken?: string | null; user: User | null }) => void;
  logout: () => void;
  isLoggedIn: () => boolean;
  hasPermission: (permission: string) => boolean;
}

const decodeJwtExp = (token: string): number | null => {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payloadRaw = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(payloadRaw) as { exp?: number };
    return typeof payload?.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
};

export const isJwtActive = (token: string) => {
  const exp = decodeJwtExp(token);
  if (!exp) return false;
  const now = Math.floor(Date.now() / 1000);
  return exp > now;
};

const AUTH_TOKEN_KEYS = ['auth_token', 'token', 'access_token'] as const;
const REFRESH_TOKEN_KEYS = ['refresh_token'] as const;

const readFirstStoredValue = (keys: readonly string[]) => {
  for (const key of keys) {
    const value = localStorage.getItem(key);
    if (value) return value;
  }
  return null;
};

const writeStoredValue = (keys: readonly string[], value: string | null) => {
  for (const key of keys) {
    if (value) {
      localStorage.setItem(key, value);
    } else {
      localStorage.removeItem(key);
    }
  }
};

const loadInitialAuthState = (): Pick<AuthStore, 'user' | 'token' | 'refresh_token' | 'is_authenticated' | 'auth_initialized' | 'auth_loading'> => {
  if (typeof window === 'undefined') {
    return {
      user: null,
      token: null,
      refresh_token: null,
      is_authenticated: false,
      auth_initialized: false,
      auth_loading: true,
    };
  }

  const storedToken = readFirstStoredValue(AUTH_TOKEN_KEYS);
  const storedRefreshToken = readFirstStoredValue(REFRESH_TOKEN_KEYS);
  const rawUser = localStorage.getItem('user');

  const clearAuthStorage = () => {
    writeStoredValue(AUTH_TOKEN_KEYS, null);
    writeStoredValue(REFRESH_TOKEN_KEYS, null);
    localStorage.removeItem('user');
  };

  if (rawUser && (storedToken || storedRefreshToken)) {
    try {
      const parsedUser = JSON.parse(rawUser) as User;
      if (!parsedUser?.id || !parsedUser?.role || !parsedUser?.email) {
        clearAuthStorage();
        return {
          user: null,
          token: null,
          refresh_token: null,
          is_authenticated: false,
          auth_initialized: false,
          auth_loading: true,
        };
      }
      const activeAccessToken = storedToken && isJwtActive(storedToken) ? storedToken : null;
      if (!activeAccessToken && !storedRefreshToken) {
        clearAuthStorage();
        return {
          user: null,
          token: null,
          refresh_token: null,
          is_authenticated: false,
          auth_initialized: false,
          auth_loading: true,
        };
      }
      return {
        user: parsedUser,
        token: activeAccessToken,
        refresh_token: storedRefreshToken,
        is_authenticated: true,
        auth_initialized: false,
        auth_loading: true,
      };
    } catch {
      clearAuthStorage();
    }
  }

  return {
    user: null,
    token: null,
    refresh_token: null,
    is_authenticated: false,
    auth_initialized: false,
    auth_loading: true,
  };
};

const initialAuthState = loadInitialAuthState();

const areUsersEquivalent = (left: User | null, right: User | null) => {
  if (left === right) return true;
  if (!left || !right) return left === right;
  const leftPermissions = Array.isArray(left.permissions) ? [...left.permissions].sort() : [];
  const rightPermissions = Array.isArray(right.permissions) ? [...right.permissions].sort() : [];
  return (
    left.id === right.id &&
    left.email === right.email &&
    left.full_name === right.full_name &&
    left.role === right.role &&
    left.role_key === right.role_key &&
    left.user_type === right.user_type &&
    left.school_id === right.school_id &&
    left.default_school_id === right.default_school_id &&
    left.membership_id === right.membership_id &&
    left.username === right.username &&
    Boolean(left.must_change_password) === Boolean(right.must_change_password) &&
    Boolean(left.first_login_completed) === Boolean(right.first_login_completed) &&
    Boolean(left.is_active) === Boolean(right.is_active) &&
    leftPermissions.join('|') === rightPermissions.join('|')
  );
};

export const useAuthStore = create<AuthStore>((set, get) => ({
  user: initialAuthState.user,
  token: initialAuthState.token,
  refresh_token: initialAuthState.refresh_token,
  is_authenticated: initialAuthState.is_authenticated,
  auth_initialized: initialAuthState.auth_initialized,
  auth_loading: initialAuthState.auth_loading,

  setUser: (user) =>
    set((state) => {
      if (areUsersEquivalent(state.user, user)) {
        return state;
      }
      return { ...state, user };
    }),
  setToken: (token) => {
    writeStoredValue(AUTH_TOKEN_KEYS, token);
    set({ token, is_authenticated: !!(token || get().refresh_token) });
  },
  setRefreshToken: (refreshToken) => {
    writeStoredValue(REFRESH_TOKEN_KEYS, refreshToken);
    set({ refresh_token: refreshToken, is_authenticated: !!(get().token || refreshToken) });
  },

  setAuthLifecycle: ({ auth_initialized, auth_loading }) =>
    set((state) => {
      if (state.auth_initialized === auth_initialized && state.auth_loading === auth_loading) {
        return state;
      }
      return {
        ...state,
        auth_initialized,
        auth_loading,
      };
    }),

  hydrate: ({ token, refreshToken = null, user }) => {
    const current = get();
    const normalizedUser = areUsersEquivalent(current.user, user) ? current.user : user;
    const nextIsAuthenticated = !!(token || refreshToken);
    const unchanged =
      current.token === token &&
      current.refresh_token === refreshToken &&
      current.is_authenticated === nextIsAuthenticated &&
      areUsersEquivalent(current.user, normalizedUser);

    if (unchanged) {
      return;
    }

    writeStoredValue(AUTH_TOKEN_KEYS, token);
    writeStoredValue(REFRESH_TOKEN_KEYS, refreshToken);

    if (normalizedUser) {
      localStorage.setItem('user', JSON.stringify(normalizedUser));
    } else {
      localStorage.removeItem('user');
    }

    set({
      token,
      refresh_token: refreshToken,
      user: normalizedUser,
      is_authenticated: nextIsAuthenticated,
      auth_initialized: current.auth_initialized,
      auth_loading: current.auth_loading,
    });
  },

  login: (token, user, refreshToken = null) => {
    writeStoredValue(AUTH_TOKEN_KEYS, token);
    writeStoredValue(REFRESH_TOKEN_KEYS, refreshToken);
    localStorage.setItem('user', JSON.stringify(user));
    set({ token, refresh_token: refreshToken, user, is_authenticated: true, auth_initialized: true, auth_loading: false });
  },

  logout: () => {
    writeStoredValue(AUTH_TOKEN_KEYS, null);
    writeStoredValue(REFRESH_TOKEN_KEYS, null);
    localStorage.removeItem('user');
    set({ token: null, refresh_token: null, user: null, is_authenticated: false, auth_initialized: true, auth_loading: false });
  },

  isLoggedIn: () => {
    return get().is_authenticated && !!(get().token || get().refresh_token);
  },

  hasPermission: (permission) => {
    const user = get().user;
    if (!user || !user.is_active) return false;
    if (user.role === 'admin' || user.role_key === 'platform_admin' || user.role_key === 'school_admin') return true;
    const permissions = user.permissions || [];
    return (
      permissions.includes(permission) ||
      permissions.some((item) => item.startsWith(`${permission}.`))
    );
  },
}));
