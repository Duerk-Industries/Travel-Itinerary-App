/**
 * @jest-environment jsdom
 */

import { jest } from '@jest/globals';

describe('persistentStorage (web)', () => {
  beforeEach(() => {
    jest.resetModules();
    window.localStorage.clear();
  });

  it('reads/writes via localStorage synchronously', () => {
    const ps = require('../utils/persistentStorage');
    expect(ps.readSync('k')).toBeNull();
    ps.writeSync('k', 'v');
    expect(ps.readSync('k')).toBe('v');
    ps.removeSync('k');
    expect(ps.readSync('k')).toBeNull();
  });

  it('canAccessWebStorage is true in jsdom', () => {
    const ps = require('../utils/persistentStorage');
    expect(ps.canAccessWebStorage()).toBe(true);
  });

  it('async helpers delegate to localStorage on web', async () => {
    const ps = require('../utils/persistentStorage');
    await ps.writeAsync('aks', 'av');
    expect(window.localStorage.getItem('aks')).toBe('av');
    await expect(ps.readAsync('aks')).resolves.toBe('av');
    await ps.removeAsync('aks');
    expect(window.localStorage.getItem('aks')).toBeNull();
  });
});

describe('persistentStorage (native)', () => {
  beforeEach(() => {
    jest.resetModules();
    // Hide localStorage so canAccessWebStorage() returns false.
    Object.defineProperty(window, 'localStorage', {
      value: undefined,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    // Restore for other tests
    jest.resetModules();
  });

  it('routes reads/writes through AsyncStorage when window.localStorage is unavailable', async () => {
    const store = new Map<string, string>();
    jest.doMock('@react-native-async-storage/async-storage', () => ({
      __esModule: true,
      default: {
        getItem: jest.fn(async (k: string) => (store.has(k) ? store.get(k)! : null)),
        setItem: jest.fn(async (k: string, v: string) => {
          store.set(k, v);
        }),
        removeItem: jest.fn(async (k: string) => {
          store.delete(k);
        }),
      },
    }));
    const ps = require('../utils/persistentStorage');
    expect(ps.canAccessWebStorage()).toBe(false);
    expect(ps.readSync('k')).toBeNull(); // sync no-op on native
    await ps.writeAsync('k', 'v');
    expect(store.get('k')).toBe('v');
    await expect(ps.readAsync('k')).resolves.toBe('v');
    await ps.removeAsync('k');
    expect(store.has('k')).toBe(false);
  });
});
