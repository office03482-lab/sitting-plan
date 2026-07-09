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

type PlatformAdminSchoolState = {
  activeSchoolId: string | null;
  activeSchoolName: string | null;
  setActiveSchool: (schoolId: string, schoolName: string) => void;
  clearActiveSchool: () => void;
};

const persistStorage = createFallbackStorage<PlatformAdminSchoolState>();

export const usePlatformAdminSchoolStore = create<PlatformAdminSchoolState>()(
  persistStorage
    ? persist(
        (set) => ({
          activeSchoolId: null,
          activeSchoolName: null,
          setActiveSchool: (schoolId, schoolName) =>
            set({ activeSchoolId: schoolId, activeSchoolName: schoolName }),
          clearActiveSchool: () =>
            set({ activeSchoolId: null, activeSchoolName: null }),
        }),
        { name: 'pa-active-school', storage: persistStorage },
      )
    : (set) => ({
        activeSchoolId: null as string | null,
        activeSchoolName: null as string | null,
        setActiveSchool: (schoolId, schoolName) =>
          set({ activeSchoolId: schoolId, activeSchoolName: schoolName }),
        clearActiveSchool: () =>
          set({ activeSchoolId: null, activeSchoolName: null }),
      }),
);
