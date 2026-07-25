import { useAuthStore } from '../store/auth';
import { usePlatformAdminSchoolStore } from '../store/platformAdminSchool';

export interface EffectiveSchool {
  effectiveSchoolId: string;
  effectiveSchoolName: string;
  isPlatformAdmin: boolean;
  activeSchoolId: string | null;
  activeSchoolName: string | null;
}

export function useEffectiveSchool(): EffectiveSchool {
  const user = useAuthStore((state) => state.user);
  const paActiveSchoolId = usePlatformAdminSchoolStore((state) => state.activeSchoolId);
  const paActiveSchoolName = usePlatformAdminSchoolStore((state) => state.activeSchoolName);

  const isPlatformAdmin = user?.role_key === 'platform_admin' || (user?.role === 'admin' && !user?.school_id);

  if (isPlatformAdmin) {
    const effectiveSchoolId = paActiveSchoolId || '';
    const effectiveSchoolName = paActiveSchoolName || 'Select a school...';
    return {
      effectiveSchoolId,
      effectiveSchoolName,
      isPlatformAdmin: true,
      activeSchoolId: paActiveSchoolId,
      activeSchoolName: paActiveSchoolName,
    };
  }

  const schoolId = user?.school_id || user?.default_school_id || '';
  const effectiveSchoolId = schoolId === '1' ? '' : String(schoolId);

  return {
    effectiveSchoolId,
    effectiveSchoolName: 'My School',
    isPlatformAdmin: false,
    activeSchoolId: null,
    activeSchoolName: null,
  };
}

export function useEffectiveSchoolId(): string {
  const { effectiveSchoolId } = useEffectiveSchool();
  return effectiveSchoolId;
}
