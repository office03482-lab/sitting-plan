import { create } from 'zustand';
import { persist, type PersistStorage } from 'zustand/middleware';

function createFallbackStorage<T>(): PersistStorage<T> | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const ls = window.localStorage;
    return {
      getItem: (name: string) => {
        const raw = ls.getItem(name);
        if (!raw) return null;
        try { return JSON.parse(raw) as { state: T; version?: number }; }
        catch { return null; }
      },
      setItem: (name: string, value: { state: T; version?: number }) => {
        ls.setItem(name, JSON.stringify(value));
      },
      removeItem: (name: string) => {
        ls.removeItem(name);
      },
    };
  } catch {
    return null;
  }
}

function readPersistedSchoolSync(): { activeSchoolId: string | null; activeSchoolName: string | null } {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return { activeSchoolId: null, activeSchoolName: null };
    }
    const raw = window.localStorage.getItem('pa-active-school');
    if (!raw) return { activeSchoolId: null, activeSchoolName: null };
    const parsed = JSON.parse(raw);
    const state = parsed?.state;
    return {
      activeSchoolId: (typeof state?.activeSchoolId === 'string' && state.activeSchoolId) || null,
      activeSchoolName: (typeof state?.activeSchoolName === 'string' && state.activeSchoolName) || null,
    };
  } catch {
    return { activeSchoolId: null, activeSchoolName: null };
  }
}

type BrandingState = {
  logo_url?: string | null;
  favicon_url?: string | null;
  portal_name?: string;
  primary_color?: string;
  secondary_color?: string;
  accent_color?: string;
} | null;

type PlatformAdminSchoolState = {
  activeSchoolId: string | null;
  activeSchoolName: string | null;
  schoolBranding: BrandingState;
  setActiveSchool: (schoolId: string, schoolName: string) => void;
  clearActiveSchool: () => void;
  setSchoolBranding: (branding: BrandingState) => void;
};

const persistStorage = createFallbackStorage<PlatformAdminSchoolState>();
const persisted = readPersistedSchoolSync();

export const usePlatformAdminSchoolStore = create<PlatformAdminSchoolState>()(
  persistStorage
    ? persist(
        (set) => ({
          activeSchoolId: persisted.activeSchoolId,
          activeSchoolName: persisted.activeSchoolName,
          schoolBranding: null,
          setActiveSchool: (schoolId, schoolName) =>
            set({ activeSchoolId: schoolId, activeSchoolName: schoolName }),
          clearActiveSchool: () =>
            set({ activeSchoolId: null, activeSchoolName: null, schoolBranding: null }),
          setSchoolBranding: (branding) => set({ schoolBranding: branding }),
        }),
        {
          name: 'pa-active-school',
          storage: persistStorage,
          partialize: (state) => ({
            activeSchoolId: state.activeSchoolId,
            activeSchoolName: state.activeSchoolName,
          }),
        },
      )
    : (set) => ({
        activeSchoolId: persisted.activeSchoolId,
        activeSchoolName: persisted.activeSchoolName,
        schoolBranding: null as BrandingState,
        setActiveSchool: (schoolId, schoolName) =>
          set({ activeSchoolId: schoolId, activeSchoolName: schoolName }),
        clearActiveSchool: () =>
          set({ activeSchoolId: null, activeSchoolName: null, schoolBranding: null }),
        setSchoolBranding: (branding) => set({ schoolBranding: branding }),
      }),
);

export type { BrandingState };
