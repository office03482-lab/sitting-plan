import { create } from 'zustand';
import type { User, AuthState } from '@types';

interface AuthStore extends AuthState {
  setUser: (user: User | null) => void;
  setToken: (token: string | null) => void;
  setRefreshToken: (refreshToken: string | null) => void;
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

const isJwtActive = (token: string) => {
  const exp = decodeJwtExp(token);
  if (!exp) return false;
  const now = Math.floor(Date.now() / 1000);
  return exp > now;
};

const loadInitialAuthState = (): Pick<AuthStore, 'user' | 'token' | 'refresh_token' | 'is_authenticated'> => {
  if (typeof window === 'undefined') {
    return {
      user: null,
      token: null,
      refresh_token: null,
      is_authenticated: false,
    };
  }

  const storedToken = localStorage.getItem('auth_token');
  const storedRefreshToken = localStorage.getItem('refresh_token');
  const rawUser = localStorage.getItem('user');

  const clearAuthStorage = () => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('refresh_token');
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
        };
      }
      return {
        user: parsedUser,
        token: activeAccessToken,
        refresh_token: storedRefreshToken,
        is_authenticated: true,
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
    Boolean(left.is_active) === Boolean(right.is_active) &&
    leftPermissions.join('|') === rightPermissions.join('|')
  );
};

export const useAuthStore = create<AuthStore>((set, get) => ({
  user: initialAuthState.user,
  token: initialAuthState.token,
  refresh_token: initialAuthState.refresh_token,
  is_authenticated: initialAuthState.is_authenticated,

  setUser: (user) =>
    set((state) => {
      if (areUsersEquivalent(state.user, user)) {
        return state;
      }
      return { ...state, user };
    }),
  setToken: (token) => {
    if (token) {
      localStorage.setItem('auth_token', token);
    } else {
      localStorage.removeItem('auth_token');
    }
    set({ token, is_authenticated: !!(token || get().refresh_token) });
  },
  setRefreshToken: (refreshToken) => {
    if (refreshToken) {
      localStorage.setItem('refresh_token', refreshToken);
    } else {
      localStorage.removeItem('refresh_token');
    }
    set({ refresh_token: refreshToken, is_authenticated: !!(get().token || refreshToken) });
  },

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

    if (token) {
      localStorage.setItem('auth_token', token);
    } else {
      localStorage.removeItem('auth_token');
    }

    if (refreshToken) {
      localStorage.setItem('refresh_token', refreshToken);
    } else {
      localStorage.removeItem('refresh_token');
    }

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
    });
  },

  login: (token, user, refreshToken = null) => {
    localStorage.setItem('auth_token', token);
    if (refreshToken) {
      localStorage.setItem('refresh_token', refreshToken);
    } else {
      localStorage.removeItem('refresh_token');
    }
    localStorage.setItem('user', JSON.stringify(user));
    set({ token, refresh_token: refreshToken, user, is_authenticated: true });
  },

  logout: () => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user');
    set({ token: null, refresh_token: null, user: null, is_authenticated: false });
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
