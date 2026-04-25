/**
 * @jest-environment jsdom
 */

import { act, renderHook } from '@testing-library/react-native';
import { useAuthForm } from '../hooks/useAuthForm';

describe('useAuthForm', () => {
  it('starts in login mode with empty fields', () => {
    const { result } = renderHook(() => useAuthForm());
    expect(result.current.authMode).toBe('login');
    expect(result.current.authForm).toEqual({
      firstName: '',
      lastName: '',
      email: '',
      password: '',
      passwordConfirm: '',
    });
  });

  it('switchToRegister / switchToLogin toggle authMode', () => {
    const { result } = renderHook(() => useAuthForm());
    act(() => result.current.switchToRegister());
    expect(result.current.authMode).toBe('register');
    act(() => result.current.switchToLogin());
    expect(result.current.authMode).toBe('login');
  });

  it('updateAuthFormField sets a single field', () => {
    const { result } = renderHook(() => useAuthForm());
    act(() => {
      result.current.updateAuthFormField('email', 'ada@example.com');
    });
    expect(result.current.authForm.email).toBe('ada@example.com');
    expect(result.current.authForm.firstName).toBe('');
  });

  it('setAuthForm with an updater merges correctly', () => {
    const { result } = renderHook(() => useAuthForm());
    act(() => {
      result.current.setAuthForm((prev) => ({ ...prev, password: 'hunter2' }));
    });
    act(() => {
      result.current.setAuthForm((prev) => ({ ...prev, passwordConfirm: 'hunter2' }));
    });
    expect(result.current.authForm.password).toBe('hunter2');
    expect(result.current.authForm.passwordConfirm).toBe('hunter2');
    expect(result.current.authForm.email).toBe('');
  });

  it('resetAuthForm clears every field', () => {
    const { result } = renderHook(() => useAuthForm());
    act(() => {
      result.current.updateAuthFormField('firstName', 'Ada');
      result.current.updateAuthFormField('lastName', 'Lovelace');
      result.current.updateAuthFormField('email', 'ada@example.com');
      result.current.updateAuthFormField('password', 'hunter2');
      result.current.updateAuthFormField('passwordConfirm', 'hunter2');
    });
    act(() => {
      result.current.resetAuthForm();
    });
    expect(result.current.authForm).toEqual({
      firstName: '',
      lastName: '',
      email: '',
      password: '',
      passwordConfirm: '',
    });
  });

  it('setAuthMode works directly alongside the semantic helpers', () => {
    const { result } = renderHook(() => useAuthForm());
    act(() => result.current.setAuthMode('register'));
    expect(result.current.authMode).toBe('register');
  });
});
