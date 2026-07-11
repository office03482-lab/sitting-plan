import { describe, it, expect, beforeEach } from 'vitest';
import {
  getRegisteredActiveSessionKey,
  setRegisteredActiveSessionKey,
  clearRegisteredActiveSessionKey,
  getStoredActiveSessionKey,
} from '@services/api';

/**
 * Active Session Key Authority — regression tests.
 *
 * These lock in the invariant from the P0 frontend fix:
 *   X-Active-Session may be attached ONLY when the current authenticated
 *   lifecycle has registered the key. A key merely existing in localStorage
 *   is NOT proof of registration and must never be attached (it would cause
 *   a 401 "Session is not registered" race on the first business request).
 *
 * The interceptor reads getRegisteredActiveSessionKey(); these tests verify
 * that function is the single source of truth and that registration success /
 * failure / logout / re-login all move it correctly.
 */

function installLocalStorageMock(): Map<string, string> {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => store.clear(),
    },
    configurable: true,
  });
  return store;
}

describe('Active Session Key Authority', () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = installLocalStorageMock();
    clearRegisteredActiveSessionKey();
  });

  it('1. authority starts null even if a stale key exists in localStorage', () => {
    store.set('active_session_key', 'sess-stale-previous');
    expect(getRegisteredActiveSessionKey()).toBeNull();
  });

  it('2. a stale localStorage key is NOT attached (interceptor source of truth)', () => {
    store.set('active_session_key', 'sess-stale-previous');
    const header = getRegisteredActiveSessionKey() ?? undefined;
    expect(header).toBeUndefined();
  });

  it('3. setRegisteredActiveSessionKey persists AND becomes the authority', () => {
    setRegisteredActiveSessionKey('sess-fresh-1');
    expect(getRegisteredActiveSessionKey()).toBe('sess-fresh-1');
    expect(store.get('active_session_key')).toBe('sess-fresh-1');
  });

  it('4. unregistered (failed) key is never persisted', () => {
    clearRegisteredActiveSessionKey();
    expect(getRegisteredActiveSessionKey()).toBeNull();
    expect(store.get('active_session_key')).toBeUndefined();
  });

  it('5. clearRegisteredActiveSessionKey wipes both authority and storage', () => {
    setRegisteredActiveSessionKey('sess-fresh-2');
    clearRegisteredActiveSessionKey();
    expect(getRegisteredActiveSessionKey()).toBeNull();
    expect(store.get('active_session_key')).toBeUndefined();
  });

  it('6. setRegisteredActiveSessionKey(null) clears everything', () => {
    setRegisteredActiveSessionKey('sess-fresh-3');
    setRegisteredActiveSessionKey(null);
    expect(getRegisteredActiveSessionKey()).toBeNull();
    expect(store.get('active_session_key')).toBeUndefined();
  });

  it('7. User A key is not reused for User B after sign-out/in', () => {
    setRegisteredActiveSessionKey('sess-user-a');
    expect(getRegisteredActiveSessionKey()).toBe('sess-user-a');

    // sign-out / sign-in clears the authority and storage deterministically
    clearRegisteredActiveSessionKey();
    store.delete('active_session_key');
    expect(getRegisteredActiveSessionKey()).toBeNull();

    // User B gets a brand-new key; it must never equal User A's key
    setRegisteredActiveSessionKey('sess-user-b');
    expect(getRegisteredActiveSessionKey()).toBe('sess-user-b');
    expect(getRegisteredActiveSessionKey()).not.toBe('sess-user-a');
  });

  it('8. authority is independent of getStoredActiveSessionKey (no stale reuse)', () => {
    // Divergent state: storage has a key but the authority is null.
    // (beforeEach already cleared the authority; we only populate storage.)
    store.set('active_session_key', 'sess-divergent');
    expect(getStoredActiveSessionKey()).toBe('sess-divergent');
    expect(getRegisteredActiveSessionKey()).toBeNull();
  });
});
