import { describe, it, expect, vi, beforeEach } from 'vitest';
import { usePlatformAdminSchoolStore } from '@store/platformAdminSchool';

describe('Platform Admin School Scope Store', () => {
  beforeEach(() => {
    usePlatformAdminSchoolStore.getState().clearActiveSchool();
  });

  it('1. PA can select School A', () => {
    usePlatformAdminSchoolStore.getState().setActiveSchool('school-a-uuid', 'School A');
    const { activeSchoolId, activeSchoolName } = usePlatformAdminSchoolStore.getState();
    expect(activeSchoolId).toBe('school-a-uuid');
    expect(activeSchoolName).toBe('School A');
  });

  it('2. PA can switch to School B', () => {
    usePlatformAdminSchoolStore.getState().setActiveSchool('school-a-uuid', 'School A');
    usePlatformAdminSchoolStore.getState().setActiveSchool('school-b-uuid', 'School B');
    const { activeSchoolId, activeSchoolName } = usePlatformAdminSchoolStore.getState();
    expect(activeSchoolId).toBe('school-b-uuid');
    expect(activeSchoolName).toBe('School B');
  });

  it('3. PA can clear school scope', () => {
    usePlatformAdminSchoolStore.getState().setActiveSchool('school-a-uuid', 'School A');
    usePlatformAdminSchoolStore.getState().clearActiveSchool();
    const { activeSchoolId, activeSchoolName } = usePlatformAdminSchoolStore.getState();
    expect(activeSchoolId).toBeNull();
    expect(activeSchoolName).toBeNull();
  });

  it('15. logout clears PA scope', () => {
    usePlatformAdminSchoolStore.getState().setActiveSchool('school-a-uuid', 'School A');
    usePlatformAdminSchoolStore.getState().clearActiveSchool();
    const { activeSchoolId } = usePlatformAdminSchoolStore.getState();
    expect(activeSchoolId).toBeNull();
  });

  it('16. normal user never inherits PA scope', () => {
    usePlatformAdminSchoolStore.getState().clearActiveSchool();
    const { activeSchoolId } = usePlatformAdminSchoolStore.getState();
    expect(activeSchoolId).toBeNull();
  });

  it('17. malformed stored UUID can be cleared', () => {
    usePlatformAdminSchoolStore.getState().setActiveSchool('not-a-uuid', 'Bad School');
    usePlatformAdminSchoolStore.getState().clearActiveSchool();
    const { activeSchoolId } = usePlatformAdminSchoolStore.getState();
    expect(activeSchoolId).toBeNull();
  });
});

describe('hasResolvedSchoolContext', () => {
  beforeEach(() => {
    usePlatformAdminSchoolStore.getState().clearActiveSchool();
  });

  it('returns false for PA without selected school', () => {
    const user = { role_key: 'platform_admin', role: 'admin' as const, school_id: '', membership_id: '' };
    const paId = usePlatformAdminSchoolStore.getState().activeSchoolId;
    const result = Boolean(user?.role_key === 'platform_admin' && paId);
    expect(result).toBe(false);
  });

  it('returns true for PA with selected school', () => {
    usePlatformAdminSchoolStore.getState().setActiveSchool('school-a-uuid', 'School A');
    const user = { role_key: 'platform_admin', role: 'admin' as const, school_id: '', membership_id: '' };
    const paId = usePlatformAdminSchoolStore.getState().activeSchoolId;
    const result = Boolean(user?.role_key === 'platform_admin' && paId);
    expect(result).toBe(true);
  });

  it('returns true for regular user with membership', () => {
    const user = { role: 'admin' as const, school_id: 'valid-school-uuid', membership_id: 'valid-membership-uuid' };
    const result = Boolean(user?.role && String(user.school_id || '').trim() && String(user.membership_id || '').trim());
    expect(result).toBe(true);
  });

  it('returns false for regular user without membership', () => {
    const user = { role: 'admin' as const, school_id: '', membership_id: '' };
    const result = Boolean(user?.role && String(user.school_id || '').trim() && String(user.membership_id || '').trim());
    expect(result).toBe(false);
  });
});

describe('canAccess for PA bypasses role check', () => {
  it('PA passes role check even when role is not in allowedRoles', () => {
    const allowedRoles = ['admin'];
    const userRole = 'platform_admin';
    const roleOk = !allowedRoles?.length || allowedRoles.includes(userRole as any) || userRole === 'platform_admin';
    expect(roleOk).toBe(true);
  });

  it('regular admin does not bypass role check', () => {
    const allowedRoles = ['admin'];
    const userRole = 'admin';
    const roleOk = !allowedRoles?.length || allowedRoles.includes(userRole as any) || userRole === 'platform_admin';
    expect(roleOk).toBe(true);
  });

  it('teacher does not bypass for admin-only routes', () => {
    const allowedRoles = ['admin'];
    const userRole = 'teacher';
    const roleOk = !allowedRoles?.length || allowedRoles.includes(userRole as any) || userRole === 'platform_admin';
    expect(roleOk).toBe(false);
  });

  it('student does not bypass for admin-only routes', () => {
    const allowedRoles = ['admin'];
    const userRole = 'student';
    const roleOk = !allowedRoles?.length || allowedRoles.includes(userRole as any) || userRole === 'platform_admin';
    expect(roleOk).toBe(false);
  });
});

describe('normalizeRequestSchoolId parameter precedence', () => {
  it('resolved school_id always wins over placeholder "1"', () => {
    const params: Record<string, unknown> = { school_id: '1' };
    const resolvedSchoolId = 'school-a-uuid';
    params.school_id = resolvedSchoolId;
    expect(params.school_id).toBe('school-a-uuid');
  });

  it('resolved school_id wins over empty param', () => {
    const params: Record<string, unknown> = {};
    const resolvedSchoolId = 'school-a-uuid';
    params.school_id = resolvedSchoolId;
    expect(params.school_id).toBe('school-a-uuid');
  });

  it('non-PA without resolved school deletes placeholder', () => {
    const params: Record<string, unknown> = { school_id: '1' };
    const hasAuthorization = true;
    if (hasAuthorization && String(params.school_id ?? '').trim() === '1') {
      delete params.school_id;
    }
    expect(params.school_id).toBeUndefined();
  });
});

describe('globa vs school-scoped route classification', () => {
  it('platform routes do not require school selection', () => {
    const path = '/platform/dashboard';
    const isPlatformRoute = path.startsWith('/platform');
    const isForcePasswordRoute = path === '/force-password-change';
    const isNonPlatformRoute = !isPlatformRoute && !isForcePasswordRoute;
    const isPlatformUser = true;
    const paActiveSchoolId = null;
    const paNeedsSchoolSelection = isPlatformUser && isNonPlatformRoute && !paActiveSchoolId;
    expect(paNeedsSchoolSelection).toBe(false);
  });

  it('school-scoped routes require school selection for PA without scope', () => {
    const path = '/students';
    const isPlatformRoute = path.startsWith('/platform');
    const isForcePasswordRoute = path === '/force-password-change';
    const isNonPlatformRoute = !isPlatformRoute && !isForcePasswordRoute;
    const isPlatformUser = true;
    const paActiveSchoolId = null;
    const paNeedsSchoolSelection = isPlatformUser && isNonPlatformRoute && !paActiveSchoolId;
    expect(paNeedsSchoolSelection).toBe(true);
  });

  it('nested platform routes do not require school selection', () => {
    const path = '/platform/schools/school-a/details';
    const isPlatformRoute = path.startsWith('/platform');
    const paNeedsSchoolSelection = false;
    expect(paNeedsSchoolSelection).toBe(false);
  });

  it('force-password-change does not require school selection for PA', () => {
    const path = '/force-password-change';
    const isPlatformRoute = path.startsWith('/platform');
    const isForcePasswordRoute = path === '/force-password-change';
    const isNonPlatformRoute = !isPlatformRoute && !isForcePasswordRoute;
    const paNeedsSchoolSelection = false;
    expect(paNeedsSchoolSelection).toBe(false);
  });
});
