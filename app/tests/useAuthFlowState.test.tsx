/**
 * @jest-environment jsdom
 */

import { act, renderHook } from '@testing-library/react-native';
import { useAuthFlowState } from '../hooks/useAuthFlowState';

describe('useAuthFlowState', () => {
  it('starts with every flag false, every message null, and an empty password form', () => {
    const { result } = renderHook(() => useAuthFlowState());
    expect(result.current.deferFirstLoginRedirect).toBe(false);
    expect(result.current.showResendConfirmation).toBe(false);
    expect(result.current.resendConfirmationLoading).toBe(false);
    expect(result.current.requirePasswordSetup).toBe(false);
    expect(result.current.passwordSetupLoading).toBe(false);
    expect(result.current.passwordSetupForm).toEqual({ newPassword: '', newPasswordConfirm: '' });
    expect(result.current.isFirstLogin).toBe(false);
    expect(result.current.emailConfirmationMessage).toBeNull();
    expect(result.current.authErrorMessage).toBeNull();
  });

  it('individual setters update their own slice', () => {
    const { result } = renderHook(() => useAuthFlowState());
    act(() => {
      result.current.setRequirePasswordSetup(true);
      result.current.setIsFirstLogin(true);
      result.current.setAuthErrorMessage('bad credentials');
      result.current.setEmailConfirmationMessage('check your email');
    });
    expect(result.current.requirePasswordSetup).toBe(true);
    expect(result.current.isFirstLogin).toBe(true);
    expect(result.current.authErrorMessage).toBe('bad credentials');
    expect(result.current.emailConfirmationMessage).toBe('check your email');
  });

  it('supports updater-style setPasswordSetupForm', () => {
    const { result } = renderHook(() => useAuthFlowState());
    act(() => {
      result.current.setPasswordSetupForm((prev) => ({ ...prev, newPassword: 'hunter2' }));
    });
    expect(result.current.passwordSetupForm.newPassword).toBe('hunter2');
    expect(result.current.passwordSetupForm.newPasswordConfirm).toBe('');

    act(() => {
      result.current.setPasswordSetupForm((prev) => ({ ...prev, newPasswordConfirm: 'hunter2' }));
    });
    expect(result.current.passwordSetupForm.newPasswordConfirm).toBe('hunter2');
  });

  it('resetPasswordSetupForm clears both fields', () => {
    const { result } = renderHook(() => useAuthFlowState());
    act(() => {
      result.current.setPasswordSetupForm({ newPassword: 'x', newPasswordConfirm: 'y' });
    });
    act(() => {
      result.current.resetPasswordSetupForm();
    });
    expect(result.current.passwordSetupForm).toEqual({ newPassword: '', newPasswordConfirm: '' });
  });

  it('clearAuthFlowState resets every slice to its initial value', () => {
    const { result } = renderHook(() => useAuthFlowState());
    act(() => {
      result.current.setDeferFirstLoginRedirect(true);
      result.current.setShowResendConfirmation(true);
      result.current.setResendConfirmationLoading(true);
      result.current.setRequirePasswordSetup(true);
      result.current.setPasswordSetupLoading(true);
      result.current.setPasswordSetupForm({ newPassword: 'a', newPasswordConfirm: 'b' });
      result.current.setIsFirstLogin(true);
      result.current.setEmailConfirmationMessage('x');
      result.current.setAuthErrorMessage('y');
    });
    act(() => {
      result.current.clearAuthFlowState();
    });
    expect(result.current.deferFirstLoginRedirect).toBe(false);
    expect(result.current.showResendConfirmation).toBe(false);
    expect(result.current.resendConfirmationLoading).toBe(false);
    expect(result.current.requirePasswordSetup).toBe(false);
    expect(result.current.passwordSetupLoading).toBe(false);
    expect(result.current.passwordSetupForm).toEqual({ newPassword: '', newPasswordConfirm: '' });
    expect(result.current.isFirstLogin).toBe(false);
    expect(result.current.emailConfirmationMessage).toBeNull();
    expect(result.current.authErrorMessage).toBeNull();
  });
});
