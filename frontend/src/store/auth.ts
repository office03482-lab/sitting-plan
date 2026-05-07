import { create } from 'zustand';
import type { User, AuthState } from '@types';

interface AuthStore extends AuthState {
  setUser: (user: User | null) => void;
  setToken: (token: string | null) => void;
  login: (token: string, user: User) => void;
  logout: () => void;
  isLoggedIn: () => boolean;
  hasPermission: (permission: string) => boolean;
}

const loadInitialAuthState = (): Pick<AuthStore, 'user' | 'token' | 'is_authenticated'> => {
  if (typeof window === 'undefined') {
    return {
      user: null,
      token: null,
      is_authenticated: false,
    };
  }

  const storedToken = localStorage.getItem('auth_token');
  const rawUser = localStorage.getItem('user');

  const clearAuthStorage = () => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user');
  };

  const isTokenStructurallyValidJwt = (token: string) => {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    try {
      const payloadRaw = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
      const payload = JSON.parse(payloadRaw) as { exp?: number };
      if (!payload?.exp) return false;
      const now = Math.floor(Date.now() / 1000);
      return payload.exp > now;
    } catch {
      return false;
    }
  };

  if (rawUser && storedToken) {
    try {
      const parsedUser = JSON.parse(rawUser) as User;
      if (!parsedUser?.id || !parsedUser?.role || !parsedUser?.email) {
        clearAuthStorage();
        return {
          user: null,
          token: null,
          is_authenticated: false,
        };
      }
      if (!isTokenStructurallyValidJwt(storedToken)) {
        clearAuthStorage();
        return {
          user: null,
          token: null,
          is_authenticated: false,
        };
      }
      return {
        user: parsedUser,
        token: storedToken,
        is_authenticated: true,
      };
    } catch {
      clearAuthStorage();
    }
  }

  return {
    user: null,
    token: null,
    is_authenticated: false,
  };
};

const initialAuthState = loadInitialAuthState();

export const useAuthStore = create<AuthStore>((set, get) => ({
  user: initialAuthState.user,
  token: initialAuthState.token,
  is_authenticated: initialAuthState.is_authenticated,

  setUser: (user) => set({ user }),
  setToken: (token) => set({ token }),

  login: (token, user) => {
    localStorage.setItem('auth_token', token);
    localStorage.setItem('user', JSON.stringify(user));
    set({ token, user, is_authenticated: true });
  },

  logout: () => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user');
    set({ token: null, user: null, is_authenticated: false });
  },

  isLoggedIn: () => {
    return get().is_authenticated && !!get().token;
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
