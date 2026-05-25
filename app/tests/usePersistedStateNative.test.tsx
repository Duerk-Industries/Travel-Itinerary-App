/**
 * @jest-environment jsdom
 *
 * Native-mode tests for usePersistedState: window.localStorage is hidden so
 * the hook takes the AsyncStorage hydration path. Pairs with the existing
 * web-mode tests in usePersistedState.test.tsx.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';

// Hide localStorage BEFORE anything imports the hook so canAccessWebStorage()
// returns false at module evaluation time.
Object.defineProperty(window, 'localStorage', {
  value: undefined,
  configurable: true,
  writable: true,
});

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

const asyncStore = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (k: string) => (asyncStore.has(k) ? asyncStore.get(k)! : null)),
    setItem: jest.fn(async (k: string, v: string) => {
      asyncStore.set(k, v);
    }),
    removeItem: jest.fn(async (k: string) => {
      asyncStore.delete(k);
    }),
  },
}));

import { usePersistedState } from '../hooks/usePersistedState';

describe('usePersistedState (native, AsyncStorage)', () => {
  beforeEach(() => {
    asyncStore.clear();
  });

  it('returns the default value on first render, then hydrates from AsyncStorage', async () => {
    asyncStore.set('pn-test-a', JSON.stringify('persisted-native'));
    const { result } = renderHook(() => usePersistedState('pn-test-a', 'fallback'));
    expect(result.current[0]).toBe('fallback');
    await waitFor(() => expect(result.current[0]).toBe('persisted-native'));
  });

  it('writes propagate to AsyncStorage', async () => {
    const { result } = renderHook(() => usePersistedState<number>('pn-test-b', 0));
    await act(async () => {
      result.current[1](7);
    });
    expect(result.current[0]).toBe(7);
    await waitFor(() => expect(asyncStore.get('pn-test-b')).toBe('7'));
  });

  it('does not overwrite when AsyncStorage has nothing stored', async () => {
    const { result } = renderHook(() => usePersistedState('pn-test-c', 'untouched'));
    expect(result.current[0]).toBe('untouched');
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current[0]).toBe('untouched');
  });
});
