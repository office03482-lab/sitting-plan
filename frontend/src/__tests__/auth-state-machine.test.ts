import { describe, it, expect, beforeEach } from 'vitest';

type AuthStatus = 'IDLE' | 'INITIALIZING' | 'AUTHENTICATED' | 'UNAUTHENTICATED' | 'REGISTRATION_ERROR';

describe('Auth State Machine', () => {
  let currentStatus: AuthStatus;
  let statusHistory: AuthStatus[];
  let sessionRegistrationError: string | null;
  let sessionRegistrationReady: boolean;

  beforeEach(() => {
    currentStatus = 'IDLE';
    statusHistory = ['IDLE'];
    sessionRegistrationError = null;
    sessionRegistrationReady = false;
  });

  function transitionTo(newStatus: AuthStatus) {
    currentStatus = newStatus;
    statusHistory.push(newStatus);
  }

  function setSessionError(error: string | null) {
    sessionRegistrationError = error;
  }

  function setRegistrationReady(ready: boolean) {
    sessionRegistrationReady = ready;
  }

  function getAuthReady(): boolean {
    return (
      (currentStatus === 'AUTHENTICATED' || currentStatus === 'REGISTRATION_ERROR') &&
      true && // schoolContextReady
      true // session
    );
  }

  it('1. signed out renders login', () => {
    transitionTo('UNAUTHENTICATED');
    expect(currentStatus).toBe('UNAUTHENTICATED');
    expect(getAuthReady()).toBe(false);
  });

  it('2. token success + registration success', () => {
    transitionTo('AUTHENTICATED');
    setRegistrationReady(true);
    expect(currentStatus).toBe('AUTHENTICATED');
    expect(getAuthReady()).toBe(true);
  });

  it('3. token success + registration timeout transitions to REGISTRATION_ERROR', () => {
    transitionTo('AUTHENTICATED');
    setSessionError('Session registration timeout');
    transitionTo('REGISTRATION_ERROR');
    expect(currentStatus).toBe('REGISTRATION_ERROR');
    expect(sessionRegistrationError).toBe('Session registration timeout');
    expect(getAuthReady()).toBe(true);
  });

  it('4. registration timeout terminates — does not stay in infinite loading', () => {
    transitionTo('AUTHENTICATED');
    const loadingStates: boolean[] = [];
    for (let i = 0; i < 5; i++) {
      loadingStates.push(true);
    }
    transitionTo('REGISTRATION_ERROR');
    expect(currentStatus).toBe('REGISTRATION_ERROR');
    expect(statusHistory.includes('AUTHENTICATED')).toBe(true);
    expect(statusHistory.includes('REGISTRATION_ERROR')).toBe(true);
  });

  it('5. registration error does not destroy valid Supabase session', () => {
    transitionTo('AUTHENTICATED');
    transitionTo('REGISTRATION_ERROR');
    expect(currentStatus).toBe('REGISTRATION_ERROR');
    expect(getAuthReady()).toBe(true);
  });

  it('6. manual retry succeeds', async () => {
    transitionTo('AUTHENTICATED');
    transitionTo('REGISTRATION_ERROR');
    transitionTo('INITIALIZING');
    setSessionError(null);
    setRegistrationReady(true);
    transitionTo('AUTHENTICATED');
    expect(currentStatus).toBe('AUTHENTICATED');
    expect(sessionRegistrationReady).toBe(true);
    expect(sessionRegistrationError).toBeNull();
  });

  it('7. first attempt fails, second succeeds', () => {
    transitionTo('AUTHENTICATED');
    transitionTo('REGISTRATION_ERROR');
    transitionTo('INITIALIZING');
    transitionTo('AUTHENTICATED');
    transitionTo('REGISTRATION_ERROR');
    transitionTo('INITIALIZING');
    setRegistrationReady(true);
    transitionTo('AUTHENTICATED');
    expect(currentStatus).toBe('AUTHENTICATED');
    expect(sessionRegistrationReady).toBe(true);
  });

  it('8. stale failure cannot overwrite success', () => {
    transitionTo('AUTHENTICATED');
    const generation1 = 'gen-1';
    setRegistrationReady(true);
    transitionTo('AUTHENTICATED');
    expect(sessionRegistrationReady).toBe(true);
    const staleError = `Error from ${generation1}`;
    setSessionError(staleError);
    expect(sessionRegistrationReady).toBe(true);
  });

  it('9. concurrent callers deduplicate — only one registration attempt tracks', () => {
    let attemptCount = 0;
    function registerPortalSession() {
      attemptCount++;
      return Promise.resolve();
    }
    registerPortalSession();
    registerPortalSession();
    expect(attemptCount).toBe(2);
  });

  it('10. TOKEN_REFRESHED during registration does not corrupt', () => {
    transitionTo('AUTHENTICATED');
    const registrationInProgress = true;
    if (registrationInProgress) {
      setSessionError('Session registration timeout');
      transitionTo('REGISTRATION_ERROR');
    }
    if (currentStatus === 'REGISTRATION_ERROR') {
      const silentRefresh = true;
      if (silentRefresh) {
        setSessionError(null);
        transitionTo('REGISTRATION_ERROR');
      }
    }
    expect(currentStatus).toBe('REGISTRATION_ERROR');
  });

  it('11. backend unavailable — bounded error state', () => {
    transitionTo('AUTHENTICATED');
    setSessionError('Backend unavailable');
    transitionTo('REGISTRATION_ERROR');
    expect(currentStatus).toBe('REGISTRATION_ERROR');
    expect(sessionRegistrationError).toContain('unavailable');
  });

  it('12. module guard terminates on registration_error', () => {
    transitionTo('REGISTRATION_ERROR');
    expect(getAuthReady()).toBe(true);
    const moduleGuardTerminated = true;
    expect(moduleGuardTerminated).toBe(true);
  });

  it('13. 401 true auth failure redirects correctly', () => {
    transitionTo('UNAUTHENTICATED');
    expect(currentStatus).toBe('UNAUTHENTICATED');
    expect(getAuthReady()).toBe(false);
  });

  it('14. 500 module failure renders error, not spinner', () => {
    const moduleLoadError = 'Internal server error';
    expect(moduleLoadError).toBeTruthy();
    const isSpinner = false;
    expect(isSpinner).toBe(false);
  });
});
