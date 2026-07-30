import { create } from 'zustand';
import type { Student, Teacher, Room, Invigilator } from '@types';
import { apiService } from '@services/api';

const CACHE_TTL_MS = 5 * 60_000;

interface CacheEntry<T> {
  data: T;
  ts: number;
}

interface ReferenceDataStore {
  getStudents: (schoolId: string | number, force?: boolean) => Promise<Student[]>;
  getTeachers: (schoolId: string | number, force?: boolean) => Promise<Teacher[]>;
  getRooms: (schoolId: string | number, force?: boolean) => Promise<Room[]>;
  getInvigilators: (schoolId: string | number, force?: boolean) => Promise<Invigilator[]>;
  getBatches: (schoolId: string | number, category?: 'batch' | 'class' | string, force?: boolean) => Promise<any[]>;
  invalidateStudents: (schoolId?: string | number) => void;
  invalidateTeachers: (schoolId?: string | number) => void;
  invalidateRooms: (schoolId?: string | number) => void;
  invalidateInvigilators: (schoolId?: string | number) => void;
  invalidateBatches: (schoolId?: string | number) => void;
  invalidateAll: (schoolId?: string | number) => void;
}

const studentsCache = new Map<string, CacheEntry<Student[]>>();
const teachersCache = new Map<string, CacheEntry<Teacher[]>>();
const roomsCache = new Map<string, CacheEntry<Room[]>>();
const invigilatorsCache = new Map<string, CacheEntry<Invigilator[]>>();
const batchesCache = new Map<string, CacheEntry<any[]>>();
const batchesClassCache = new Map<string, CacheEntry<any[]>>();

const studentsInFlight = new Map<string, Promise<Student[]>>();
const teachersInFlight = new Map<string, Promise<Teacher[]>>();
const roomsInFlight = new Map<string, Promise<Room[]>>();
const invigilatorsInFlight = new Map<string, Promise<Invigilator[]>>();
const batchesInFlight = new Map<string, Promise<any[]>>();
const batchesClassInFlight = new Map<string, Promise<any[]>>();

function normalizeSchoolKey(schoolId: string | number): string {
  return String(schoolId || '').trim();
}

function isFresh<T>(entry: CacheEntry<T> | undefined): entry is CacheEntry<T> {
  return Boolean(entry) && Date.now() - entry.ts < CACHE_TTL_MS;
}

function invalidateMap<T>(cache: Map<string, CacheEntry<T>>, inflight: Map<string, Promise<T>>, schoolId?: string | number) {
  if (schoolId === undefined) {
    cache.clear();
    inflight.clear();
    return;
  }
  const key = normalizeSchoolKey(schoolId);
  cache.delete(key);
  inflight.delete(key);
}

async function readThroughCache<T>(
  key: string,
  cache: Map<string, CacheEntry<T>>,
  inflight: Map<string, Promise<T>>,
  force: boolean,
  loader: () => Promise<T>,
): Promise<T> {
  if (!force) {
    const cached = cache.get(key);
    if (isFresh(cached)) {
      return cached.data;
    }
    const pending = inflight.get(key);
    if (pending) {
      return pending;
    }
  }

  const request = loader().then((data) => {
    cache.set(key, { data, ts: Date.now() });
    return data;
  }).finally(() => {
    if (inflight.get(key) === request) {
      inflight.delete(key);
    }
  });

  inflight.set(key, request);
  return request;
}

export const useRefDataStore = create<ReferenceDataStore>(() => ({
  async getStudents(schoolId, force = false) {
    const key = normalizeSchoolKey(schoolId);
    return readThroughCache(key, studentsCache, studentsInFlight, force, async () => {
      const response = await apiService.listStudents(schoolId, 0, 10000);
      return Array.isArray(response.data) ? response.data : [];
    });
  },

  async getTeachers(schoolId, force = false) {
    const key = normalizeSchoolKey(schoolId);
    return readThroughCache(key, teachersCache, teachersInFlight, force, async () => {
      const response = await apiService.listTeachers(schoolId, 0, 10000);
      return Array.isArray(response.data) ? response.data : [];
    });
  },

  async getRooms(schoolId, force = false) {
    const key = normalizeSchoolKey(schoolId);
    return readThroughCache(key, roomsCache, roomsInFlight, force, async () => {
      const response = await apiService.listRooms(schoolId);
      return Array.isArray(response.data) ? response.data : [];
    });
  },

  async getInvigilators(schoolId, force = false) {
    const key = normalizeSchoolKey(schoolId);
    return readThroughCache(key, invigilatorsCache, invigilatorsInFlight, force, async () => {
      const response = await apiService.listInvigilators(schoolId, undefined, 0, 10000);
      return Array.isArray(response.data) ? response.data : [];
    });
  },

  async getBatches(schoolId, category, force = false) {
    const key = normalizeSchoolKey(schoolId);
    const isClass = category === 'class';
    const cache = isClass ? batchesClassCache : batchesCache;
    const inflight = isClass ? batchesClassInFlight : batchesInFlight;
    return readThroughCache(key, cache, inflight, force, async () => {
      const response = await apiService.listBatches(schoolId, undefined, category);
      return Array.isArray(response.data) ? response.data : [];
    });
  },

  invalidateStudents: (schoolId) => invalidateMap(studentsCache, studentsInFlight, schoolId),
  invalidateTeachers: (schoolId) => invalidateMap(teachersCache, teachersInFlight, schoolId),
  invalidateRooms: (schoolId) => invalidateMap(roomsCache, roomsInFlight, schoolId),
  invalidateInvigilators: (schoolId) => invalidateMap(invigilatorsCache, invigilatorsInFlight, schoolId),
  invalidateBatches: (schoolId) => {
    invalidateMap(batchesCache, batchesInFlight, schoolId);
    invalidateMap(batchesClassCache, batchesClassInFlight, schoolId);
  },
  invalidateAll: (schoolId) => {
    invalidateMap(studentsCache, studentsInFlight, schoolId);
    invalidateMap(teachersCache, teachersInFlight, schoolId);
    invalidateMap(roomsCache, roomsInFlight, schoolId);
    invalidateMap(invigilatorsCache, invigilatorsInFlight, schoolId);
    invalidateMap(batchesCache, batchesInFlight, schoolId);
    invalidateMap(batchesClassCache, batchesClassInFlight, schoolId);
  },
}));
