/**
 * @jest-environment jsdom
 */

import { act, renderHook } from '@testing-library/react-native';

jest.mock('react-native', () => ({
  Platform: { OS: 'web' },
}));

import { usePersistedState } from '../hooks/usePersistedState';

describe('usePersistedState', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('returns the default value when nothing is stored', () => {
    const { result } = renderHook(() => usePersistedState('p-test-a', 'initial'));
    expect(result.current[0]).toBe('initial');
  });

  it('reads a previously stored value on first render', () => {
    window.localStorage.setItem('p-test-b', JSON.stringify('persisted'));
    const { result } = renderHook(() => usePersistedState('p-test-b', 'fallback'));
    expect(result.current[0]).toBe('persisted');
  });

  it('writes to localStorage when the value is updated', () => {
    const { result } = renderHook(() => usePersistedState<number>('p-test-c', 0));
    act(() => {
      result.current[1](42);
    });
    expect(result.current[0]).toBe(42);
    expect(window.localStorage.getItem('p-test-c')).toBe('42');
  });

  it('supports updater functions', () => {
    const { result } = renderHook(() => usePersistedState<number>('p-test-d', 10));
    act(() => {
      result.current[1]((prev) => prev + 5);
    });
    expect(result.current[0]).toBe(15);
    expect(window.localStorage.getItem('p-test-d')).toBe('15');
  });

  it('falls back to the default when the stored JSON is corrupt', () => {
    window.localStorage.setItem('p-test-e', '{not json');
    const { result } = renderHook(() => usePersistedState('p-test-e', 'fallback'));
    expect(result.current[0]).toBe('fallback');
  });

  it('round-trips complex objects through JSON', () => {
    const { result } = renderHook(() =>
      usePersistedState<{ q: string; page: number }>('p-test-f', { q: '', page: 1 })
    );
    act(() => {
      result.current[1]({ q: 'hello', page: 3 });
    });
    const raw = window.localStorage.getItem('p-test-f');
    expect(raw && JSON.parse(raw)).toEqual({ q: 'hello', page: 3 });
    expect(result.current[0]).toEqual({ q: 'hello', page: 3 });
  });
});
