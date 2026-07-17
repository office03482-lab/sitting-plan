import { create } from 'zustand';
import type { Student, Teacher, Room, Invigilator } from '@types';
import { apiService } from '@services/api';

const CACHE_TTL_MS = 60_000;

interface CacheEntry<T> {
  data: T;
  ts: number;
  schoolId: string | number;
}

interface ReferenceDataStore {
  _students: CacheEntry<Student[]> | null;
  _teachers: CacheEntry<Teacher[]> | null;
  _rooms: CacheEntry<Room[]> | null;
  _invigilators: CacheEntry<Invigilator[]> | null;
  _batches: CacheEntry<any[]> | null;
  _batchesClass: CacheEntry<any[]> | null;

  getStudents: (schoolId: string | number, force?: boolean) => Promise<Student[]>;
  getTeachers: (schoolId: string | number, force?: boolean) => Promise<Teacher[]>;
  getRooms: (schoolId: string | number, force?: boolean) => Promise<Room[]>;
  getInvigilators: (schoolId: string | number, force?: boolean) => Promise<Invigilator[]>;
  getBatches: (schoolId: string | number, category?: 'batch' | 'class' | string, force?: boolean) => Promise<any[]>;

  invalidateStudents: () => void;
  invalidateTeachers: () => void;
  invalidateRooms: () => void;
  invalidateInvigilators: () => void;
  invalidateBatches: () => void;
  invalidateAll: () => void;
}

function isFresh<T>(entry: CacheEntry<T> | null, schoolId: string | number): entry is CacheEntry<T> {
  if (!entry) return false;
  if (String(entry.schoolId) !== String(schoolId)) return false;
  return Date.now() - entry.ts < CACHE_TTL_MS;
}

export const useRefDataStore = create<ReferenceDataStore>((set, get) => ({
  _students: null,
  _teachers: null,
  _rooms: null,
  _invigilators: null,
  _batches: null,
  _batchesClass: null,

  async getStudents(schoolId, force = false) {
    const state = get();
    if (!force && isFresh(state._students, schoolId)) {
      return state._students!.data;
    }
    const res = await apiService.listStudents(schoolId, 0, 10000);
    const data = Array.isArray(res.data) ? res.data : [];
    set({ _students: { data, ts: Date.now(), schoolId } });
    return data;
  },

  async getTeachers(schoolId, force = false) {
    const state = get();
    if (!force && isFresh(state._teachers, schoolId)) {
      return state._teachers!.data;
    }
    const res = await apiService.listTeachers(schoolId, 0, 10000);
    const data = Array.isArray(res.data) ? res.data : [];
    set({ _teachers: { data, ts: Date.now(), schoolId } });
    return data;
  },

  async getRooms(schoolId, force = false) {
    const state = get();
    if (!force && isFresh(state._rooms, schoolId)) {
      return state._rooms!.data;
    }
    const res = await apiService.listRooms(schoolId);
    const data = Array.isArray(res.data) ? res.data : [];
    set({ _rooms: { data, ts: Date.now(), schoolId } });
    return data;
  },

  async getInvigilators(schoolId, force = false) {
    const state = get();
    if (!force && isFresh(state._invigilators, schoolId)) {
      return state._invigilators!.data;
    }
    const res = await apiService.listInvigilators(schoolId, undefined, 0, 10000);
    const data = Array.isArray(res.data) ? res.data : [];
    set({ _invigilators: { data, ts: Date.now(), schoolId } });
    return data;
  },

  async getBatches(schoolId, category, force = false) {
    const state = get();
    const isClass = category === 'class';
    const entry = isClass ? state._batchesClass : state._batches;
    if (!force && isFresh(entry, schoolId)) {
      return entry!.data;
    }
    const res = await apiService.listBatches(schoolId, undefined, category);
    const data = Array.isArray(res.data) ? res.data : [];
    if (isClass) {
      set({ _batchesClass: { data, ts: Date.now(), schoolId } });
    } else {
      set({ _batches: { data, ts: Date.now(), schoolId } });
    }
    return data;
  },

  invalidateStudents: () => set({ _students: null }),
  invalidateTeachers: () => set({ _teachers: null }),
  invalidateRooms: () => set({ _rooms: null }),
  invalidateInvigilators: () => set({ _invigilators: null }),
  invalidateBatches: () => set({ _batches: null, _batchesClass: null }),
  invalidateAll: () => set({
    _students: null,
    _teachers: null,
    _rooms: null,
    _invigilators: null,
    _batches: null,
    _batchesClass: null,
  }),
}));
