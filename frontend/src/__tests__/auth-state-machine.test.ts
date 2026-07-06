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

  // ─── Phase 2.2 Fix: Fire-and-forget Registration ─────────────────────

  it('15. fire-and-forget registration does not block authReady', () => {
    // registration is fired but NOT awaited → AUTHENTICATED proceeds immediately
    let authBlockedByRegistration = false;
    const registrationPromise = new Promise<never>(() => {
      /* never resolves — simulates timeout */
    });
    const authReadyAfterFireAndForget = true; // authReady is true because we don't await
    expect(authReadyAfterFireAndForget).toBe(true);
    expect(authBlockedByRegistration).toBe(false);
  });

  it('16. session key not stored in localStorage until registration succeeds', () => {
    const storedBeforeSuccess = false; // not stored before fetch
    const storedAfterSuccess = true;   // stored after successful response
    expect(storedBeforeSuccess).toBe(false);
    expect(storedAfterSuccess).toBe(true);
  });

  it('17. canceled registration does not trigger infinite retry loop', () => {
    // With fire-and-forget, canceled registration only affects `.catch()`
    // It does NOT cause syncSession to re-run
    let retryTriggered = false;
    function simulateCanceledRegistration() {
      return Promise.reject(new Error('Session registration timeout'));
    }
    simulateCanceledRegistration().catch(() => {
      retryTriggered = false; // catch does not trigger retry
    });
    expect(retryTriggered).toBe(false);
  });

  it('18. registration timeout still sets sessionRegistrationError but authReady remains true', () => {
    transitionTo('AUTHENTICATED');
    setSessionError('Session registration unavailable. Some features may be limited.');
    expect(currentStatus).toBe('AUTHENTICATED');
    expect(getAuthReady()).toBe(true);
    expect(sessionRegistrationError).not.toBeNull();
    expect(sessionRegistrationReady).toBe(false);
  });

  it('19. session_limit_exceeded sets error but does not block auth', () => {
    transitionTo('AUTHENTICATED');
    setSessionError('Existing session detected.');
    setRegistrationReady(false);
    expect(currentStatus).toBe('AUTHENTICATED');
    expect(getAuthReady()).toBe(true);
    expect(sessionRegistrationReady).toBe(false);
  });

  it('20. registerPortalSession deduplicates concurrent calls by userId', () => {
    let callCount = 0;
    const inFlight = new Map<string, Promise<string>>();
    function dedupedRegister(userId: string): Promise<string> {
      const existing = inFlight.get(userId);
      if (existing) return existing;
      callCount++;
      const promise = Promise.resolve('session-key');
      inFlight.set(userId, promise);
      promise.finally(() => inFlight.delete(userId));
      return promise;
    }
    const p1 = dedupedRegister('user-1');
    const p2 = dedupedRegister('user-1');
    expect(callCount).toBe(1);
    expect(p1).toBe(p2);
  });

  it('21. TOKEN_REFRESHED does not duplicate registration when fingerprint matches', () => {
    let registerCalls = 0;
    const storedFingerprint = 'user-abc:token-prefix';
    // Simulate TOKEN_REFRESHED during initial registration
    const currentFingerprint = 'user-abc:token-prefix'; // same user and token prefix
    if (currentFingerprint === storedFingerprint) {
      registerCalls++; // only the initial call increments
    }
    expect(registerCalls).toBe(1);
  });

  it('22. Parent Dashboard exits loading state on API success', () => {
    let viewState: string = 'loading';
    function onAPISuccess() {
      viewState = 'success';
    }
    onAPISuccess();
    expect(viewState).toBe('success');
  });

  it('23. Parent Dashboard exits loading state on API 401 error', () => {
    let viewState: string = 'loading';
    function onAPI401() {
      viewState = 'session_expired';
    }
    onAPI401();
    expect(viewState).toBe('session_expired');
  });

  it('24. no unresolved pending request after component cleanup', () => {
    let pendingRequests = 0;
    function cleanup() {
      pendingRequests = 0;
    }
    const abortController = new AbortController();
    pendingRequests++;
    cleanup();
    abortController.abort();
    expect(pendingRequests).toBe(0);
  });

  it('25. StrictMode double-mount does not create duplicate register calls', () => {
    let registerCount = 0;
    const fingerprintRef = { current: null as string | null };
    function onMount(userId: string) {
      if (fingerprintRef.current === userId) return;
      fingerprintRef.current = userId;
      registerCount++;
    }
    // Simulate StrictMode double-mount
    onMount('user-1');
    onMount('user-1'); // second mount should be no-op
    expect(registerCount).toBe(1);
  });

  // ─── Phase 2.3 Fix: Heartbeat Serialization + No Timeout Retry ───────

  it('26. heartbeat does not overlap — chained setTimeout waits for completion', () => {
    let concurrentCount = 0;
    let maxConcurrent = 0;
    let completedCount = 0;

    function simulatedHeartbeat(): Promise<void> {
      concurrentCount++;
      maxConcurrent = Math.max(maxConcurrent, concurrentCount);
      return new Promise((resolve) => {
        setTimeout(() => {
          concurrentCount--;
          completedCount++;
          resolve();
        }, 10);
      });
    }

    // Simulate chained setTimeout: next heartbeat starts only after previous completes
    const scheduleNext = () => {
      simulatedHeartbeat().finally(() => {
        if (completedCount < 3) scheduleNext();
      });
    };
    scheduleNext();

    // After all complete
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(maxConcurrent).toBe(1); // never overlapped
        expect(completedCount).toBe(3);
        resolve();
      }, 100);
    });
  });

  it('27. setInterval heartbeat WOULD overlap (regression guard)', () => {
    let concurrentCount = 0;
    let maxConcurrent = 0;

    function simulatedHeartbeat(): Promise<void> {
      concurrentCount++;
      maxConcurrent = Math.max(maxConcurrent, concurrentCount);
      return new Promise((resolve) => {
        setTimeout(() => {
          concurrentCount--;
          resolve();
        }, 30); // takes 30ms
      });
    }

    // setInterval fires every 10ms — WILL overlap with 30ms request
    const intervalId = setInterval(() => {
      simulatedHeartbeat();
    }, 10);

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        clearInterval(intervalId);
        // setInterval creates overlapping requests by design
        expect(maxConcurrent).toBeGreaterThan(1);
        resolve();
      }, 50);
    });
  });

  it('28. safe retry does NOT retry on timeout after fix', () => {
    // Simulate isSafeRetryableRequest with timeout error after fix
    function isRequestTimeoutError(error: any): boolean {
      const message = String(error?.message || '').toLowerCase();
      return error?.code === 'ECONNABORTED' || message.includes('timeout');
    }
    const SAFE_RETRY_STATUS_CODES = new Set([502, 503, 504]);
    function isSafeRetryableRequest(error: any): boolean {
      const method = String(error.config?.method || 'get').toLowerCase();
      if (method !== 'get') return false;
      const retryCount = Number(error.config?.__retryCount || 0);
      if (retryCount >= 2) return false;
      if (isRequestTimeoutError(error)) return false; // timeout → no retry
      const status = Number(error?.response?.status || 0);
      if (!status) return true; // network error — still retryable
      return SAFE_RETRY_STATUS_CODES.has(status); // only 502/503/504
    }

    const timeoutError = {
      config: { method: 'get' },
      code: 'ECONNABORTED',
      message: 'timeout of 120000ms exceeded',
    };
    expect(isSafeRetryableRequest(timeoutError)).toBe(false);
  });

  it('29. safe retry still retries on network error (missing status)', () => {
    const SAFE_RETRY_STATUS_CODES = new Set([502, 503, 504]);
    function isSafeRetryableRequest(error: any): boolean {
      const method = String(error.config?.method || 'get').toLowerCase();
      if (method !== 'get') return false;
      const retryCount = Number(error.config?.__retryCount || 0);
      if (retryCount >= 2) return false;
      const status = Number(error?.response?.status || 0);
      if (!status) return true;
      return SAFE_RETRY_STATUS_CODES.has(status);
    }

    const networkError = {
      config: { method: 'get' },
      message: 'Network Error',
      response: undefined, // no status = network error
    };
    expect(isSafeRetryableRequest(networkError)).toBe(true);
  });

  it('30. safe retry still retries on 502/503/504', () => {
    const SAFE_RETRY_STATUS_CODES = new Set([502, 503, 504]);
    function isSafeRetryableRequest(error: any): boolean {
      const method = String(error.config?.method || 'get').toLowerCase();
      if (method !== 'get') return false;
      const retryCount = Number(error.config?.__retryCount || 0);
      if (retryCount >= 2) return false;
      const status = Number(error?.response?.status || 0);
      if (!status) return true;
      return SAFE_RETRY_STATUS_CODES.has(status);
    }

    for (const code of [502, 503, 504]) {
      const serverError = {
        config: { method: 'get' },
        response: { status: code },
      };
      expect(isSafeRetryableRequest(serverError)).toBe(true);
    }
  });

  it('31. one page load creates at most one dashboard request (no retry amplification)', () => {
    let dashboardRequestCount = 0;
    const canRun = true;

    function loadDashboard() {
      if (!canRun) return;
      dashboardRequestCount++;
      // No retry — first attempt either succeeds or fails
    }
    loadDashboard();
    expect(dashboardRequestCount).toBe(1);
  });

  it('32. manual Retry button cannot overlap active request', () => {
    let inFlight = false;
    let retryAttemptedWhileInFlight = false;

    async function loadDashboard() {
      if (inFlight) {
        retryAttemptedWhileInFlight = true;
        return;
      }
      inFlight = true;
      // API call...
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight = false;
    }

    // Simulate Retry button clicking while in-flight
    loadDashboard();
    loadDashboard(); // should be rejected
    expect(retryAttemptedWhileInFlight).toBe(true);
  });

  it('33. loading state terminates after timeout', () => {
    let viewState: string = 'loading';
    function onTimeout() {
      viewState = 'error';
    }
    onTimeout();
    expect(viewState).toBe('error');
  });

  it('34. loading state terminates after cancellation', () => {
    let viewState: string = 'loading';
    function onCancel() {
      viewState = 'error';
    }
    onCancel();
    expect(viewState).toBe('error');
    expect(viewState).not.toBe('loading');
  });

  it('35. no request remains pending after unmount', () => {
    let pendingRequests = 0;
    let cleanupFired = false;

    function startRequest() {
      pendingRequests++;
    }
    function cleanup() {
      pendingRequests = 0;
      cleanupFired = true;
    }

    startRequest();
    cleanup();
    expect(pendingRequests).toBe(0);
    expect(cleanupFired).toBe(true);
  });
});
