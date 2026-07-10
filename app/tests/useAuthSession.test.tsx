/**
 * @jest-environment jsdom
 */
/// <reference types="jest" />
/// <reference types="node" />

import { act, renderHook } from '@testing-library/react-native';
import { useAuthSession } from '../hooks/useAuthSession';

describe('useAuthSession', () => {
  it('starts fully signed out with role=user', () => {
    const { result } = renderHook(() => useAuthSession());
    expect(result.current.userToken).toBeNull();
    expect(result.current.userName).toBeNull();
    expect(result.current.userEmail).toBeNull();
    expect(result.current.userId).toBeNull();
    expect(result.current.userRole).toBe('user');
  });

  it('individual setters update their slice', () => {
    const { result } = renderHook(() => useAuthSession());
    act(() => {
      result.current.setUserToken('jwt-abc');
      result.current.setUserName('Ada');
      result.current.setUserEmail('ada@example.com');
      result.current.setUserId('user-1');
      result.current.setUserRole('admin');
    });
    expect(result.current.userToken).toBe('jwt-abc');
    expect(result.current.userName).toBe('Ada');
    expect(result.current.userEmail).toBe('ada@example.com');
    expect(result.current.userId).toBe('user-1');
    expect(result.current.userRole).toBe('admin');
  });

  it('applySession atomically populates the whole cluster', () => {
    const { result } = renderHook(() => useAuthSession());
    act(() => {
      result.current.applySession({
        token: 'jwt-xyz',
        name: 'Grace',
        email: 'grace@example.com',
        userId: 'user-2',
        role: 'user',
      });
    });
    expect(result.current.userToken).toBe('jwt-xyz');
    expect(result.current.userName).toBe('Grace');
    expect(result.current.userEmail).toBe('grace@example.com');
    expect(result.current.userId).toBe('user-2');
    expect(result.current.userRole).toBe('user');
  });

  it('applySession preserves explicit nulls (email/name/userId can be absent)', () => {
    const { result } = renderHook(() => useAuthSession());
    act(() => {
      result.current.applySession({
        token: 'jwt-zzz',
        name: null,
        email: null,
        userId: null,
        role: 'user',
      });
    });
    expect(result.current.userToken).toBe('jwt-zzz');
    expect(result.current.userName).toBeNull();
    expect(result.current.userEmail).toBeNull();
    expect(result.current.userId).toBeNull();
  });

  it('clearSessionState resets every slice and role back to user', () => {
    const { result } = renderHook(() => useAuthSession());
    act(() => {
      result.current.applySession({
        token: 'x',
        name: 'x',
        email: 'x',
        userId: 'x',
        role: 'admin',
      });
    });
    expect(result.current.userRole).toBe('admin');

    act(() => {
      result.current.clearSessionState();
    });
    expect(result.current.userToken).toBeNull();
    expect(result.current.userName).toBeNull();
    expect(result.current.userEmail).toBeNull();
    expect(result.current.userId).toBeNull();
    expect(result.current.userRole).toBe('user');
  });

  it('raw setters and applySession compose correctly (e.g. promote to admin mid-session)', () => {
    const { result } = renderHook(() => useAuthSession());
    act(() => {
      result.current.applySession({
        token: 't',
        name: 'n',
        email: 'e',
        userId: 'u',
        role: 'user',
      });
    });
    act(() => {
      result.current.setUserRole('admin');
    });
    expect(result.current.userToken).toBe('t');
    expect(result.current.userRole).toBe('admin');
  });
});
