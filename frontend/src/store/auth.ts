import { create } from 'zustand';
import type { User, AuthState } from '@types';

interface AuthStore extends AuthState {
  setUser: (user: User | null) => void;
  setToken: (token: string | null) => void;
  setRefreshToken: (refreshToken: string | null) => void;
  login: (token: string, user: User, refreshToken?: string | null) => void;
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

export const useAuthStore = create<AuthStore>((set, get) => ({
  user: initialAuthState.user,
  token: initialAuthState.token,
  refresh_token: initialAuthState.refresh_token,
  is_authenticated: initialAuthState.is_authenticated,

  setUser: (user) => set({ user }),
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
    if (user.role === 'admin') return true;
    const permissions = user.permissions || [];
    return (
      permissions.includes(permission) ||
      permissions.some((item) => item.startsWith(`${permission}.`))
    );
  },
}));
