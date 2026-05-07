const STUDENT_DIRECTORY_PHOTOS_KEY = 'student-directory-photos';
const STUDENT_DIRECTORY_SESSIONS_KEY = 'student-directory-sessions';
const STUDENT_DIRECTORY_SESSION_OPTIONS_KEY = 'student-directory-session-options';

type StudentPhotoMap = Record<string, string>;
type StudentSessionMap = Record<string, string>;

const DEFAULT_SESSION_OPTIONS = ['Apr 2026 - Mar 2027', 'Apr 2027 - Mar 2028'];

const buildKeys = (studentId?: number | null, rollNumber?: string | null) => {
  const keys: string[] = [];
  if (typeof studentId === 'number') keys.push(`id:${studentId}`);
  const cleanedRoll = (rollNumber || '').trim();
  if (cleanedRoll) keys.push(`roll:${cleanedRoll.toLowerCase()}`);
  return keys;
};

const readPhotoMap = (): StudentPhotoMap => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STUDENT_DIRECTORY_PHOTOS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StudentPhotoMap;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const readSessionMap = (): StudentSessionMap => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STUDENT_DIRECTORY_SESSIONS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StudentSessionMap;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const writePhotoMap = (map: StudentPhotoMap) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STUDENT_DIRECTORY_PHOTOS_KEY, JSON.stringify(map));
};

const writeSessionMap = (map: StudentSessionMap) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STUDENT_DIRECTORY_SESSIONS_KEY, JSON.stringify(map));
};

export const getStudentPhoto = (studentId?: number | null, rollNumber?: string | null) => {
  const map = readPhotoMap();
  const keys = buildKeys(studentId, rollNumber);
  return keys.map((key) => map[key]).find(Boolean) || '';
};

export const setStudentPhoto = (photoDataUrl: string, studentId?: number | null, rollNumber?: string | null) => {
  const cleanedPhoto = photoDataUrl.trim();
  const keys = buildKeys(studentId, rollNumber);
  if (!cleanedPhoto || !keys.length) return;
  const map = readPhotoMap();
  keys.forEach((key) => {
    map[key] = cleanedPhoto;
  });
  writePhotoMap(map);
};

export const removeStudentPhoto = (studentId?: number | null, rollNumber?: string | null) => {
  const keys = buildKeys(studentId, rollNumber);
  if (!keys.length) return;
  const map = readPhotoMap();
  keys.forEach((key) => {
    delete map[key];
  });
  writePhotoMap(map);
};

export const getStudentSession = (studentId?: number | null, rollNumber?: string | null) => {
  const map = readSessionMap();
  const keys = buildKeys(studentId, rollNumber);
  return keys.map((key) => map[key]).find(Boolean) || '';
};

export const setStudentSession = (session: string, studentId?: number | null, rollNumber?: string | null) => {
  const cleanedSession = session.trim();
  const keys = buildKeys(studentId, rollNumber);
  if (!cleanedSession || !keys.length) return;
  const map = readSessionMap();
  keys.forEach((key) => {
    map[key] = cleanedSession;
  });
  writeSessionMap(map);
  ensureStudentSessionOption(cleanedSession);
};

export const removeStudentSession = (studentId?: number | null, rollNumber?: string | null) => {
  const keys = buildKeys(studentId, rollNumber);
  if (!keys.length) return;
  const map = readSessionMap();
  keys.forEach((key) => {
    delete map[key];
  });
  writeSessionMap(map);
};

export const readStudentSessionOptions = () => {
  if (typeof window === 'undefined') return DEFAULT_SESSION_OPTIONS;
  try {
    const raw = window.localStorage.getItem(STUDENT_DIRECTORY_SESSION_OPTIONS_KEY);
    if (!raw) return DEFAULT_SESSION_OPTIONS;
    const parsed = JSON.parse(raw) as string[];
    const next = Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    return Array.from(new Set([...DEFAULT_SESSION_OPTIONS, ...next]));
  } catch {
    return DEFAULT_SESSION_OPTIONS;
  }
};

export const ensureStudentSessionOption = (session: string) => {
  const cleanedSession = session.trim();
  if (!cleanedSession || typeof window === 'undefined') return;
  const next = Array.from(new Set([...readStudentSessionOptions(), cleanedSession]));
  window.localStorage.setItem(STUDENT_DIRECTORY_SESSION_OPTIONS_KEY, JSON.stringify(next));
};
