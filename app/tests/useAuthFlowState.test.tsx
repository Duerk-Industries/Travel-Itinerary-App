/**
 * @jest-environment jsdom
 */

import { act, renderHook } from '@testing-library/react-native';
import { useAuthFlowState } from '../hooks/useAuthFlowState';

const BACKEND = 'https://api.example.test';
const DEFAULT_PARAMS = { backendUrl: BACKEND, userToken: 't' } as const;

describe('useAuthFlowState (state + helpers)', () => {
  it('starts with every flag false, every message null, and an empty password form', () => {
    const { result } = renderHook(() => useAuthFlowState(DEFAULT_PARAMS));
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
    const { result } = renderHook(() => useAuthFlowState(DEFAULT_PARAMS));
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
    const { result } = renderHook(() => useAuthFlowState(DEFAULT_PARAMS));
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
    const { result } = renderHook(() => useAuthFlowState(DEFAULT_PARAMS));
    act(() => {
      result.current.setPasswordSetupForm({ newPassword: 'x', newPasswordConfirm: 'y' });
    });
    act(() => {
      result.current.resetPasswordSetupForm();
    });
    expect(result.current.passwordSetupForm).toEqual({ newPassword: '', newPasswordConfirm: '' });
  });

  it('clearAuthFlowState resets every slice to its initial value', () => {
    const { result } = renderHook(() => useAuthFlowState(DEFAULT_PARAMS));
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

describe('useAuthFlowState.completeInitialPasswordSetup', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    (globalThis as any).fetch = fetchMock;
  });

  it('returns error when not signed in', async () => {
    const { result } = renderHook(() =>
      useAuthFlowState({ backendUrl: BACKEND, userToken: null })
    );
    act(() => {
      result.current.setPasswordSetupForm({ newPassword: 'abcdef', newPasswordConfirm: 'abcdef' });
    });
    const r = await result.current.completeInitialPasswordSetup();
    expect(r).toEqual({ ok: false, error: 'Not signed in' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns error when confirmation does not match', async () => {
    const { result } = renderHook(() => useAuthFlowState(DEFAULT_PARAMS));
    act(() => {
      result.current.setPasswordSetupForm({ newPassword: 'abcdef', newPasswordConfirm: 'abcdex' });
    });
    const r = await result.current.completeInitialPasswordSetup();
    expect(r).toEqual({ ok: false, error: 'Passwords do not match' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns error when password is too short', async () => {
    const { result } = renderHook(() => useAuthFlowState(DEFAULT_PARAMS));
    act(() => {
      result.current.setPasswordSetupForm({ newPassword: 'ab', newPasswordConfirm: 'ab' });
    });
    const r = await result.current.completeInitialPasswordSetup();
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toContain('at least 6 characters');
  });

  it('PATCHes /api/account/password on success, clears form, and lowers requirePasswordSetup', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
      text: async () => '{"ok":true}',
    });
    const { result } = renderHook(() => useAuthFlowState(DEFAULT_PARAMS));
    act(() => {
      result.current.setRequirePasswordSetup(true);
      result.current.setPasswordSetupForm({ newPassword: 'abcdef', newPasswordConfirm: 'abcdef' });
    });
    let r;
    await act(async () => {
      r = await result.current.completeInitialPasswordSetup();
    });
    expect(r).toEqual({ ok: true });
    expect(result.current.requirePasswordSetup).toBe(false);
    expect(result.current.passwordSetupForm).toEqual({ newPassword: '', newPasswordConfirm: '' });
    const [[url, init]] = fetchMock.mock.calls;
    expect(String(url)).toBe(`${BACKEND}/api/account/password`);
    expect((init as any)?.method).toBe('PATCH');
  });

  it('surfaces server error on failure and leaves form intact', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'weak password' }),
      text: async () => '{"error":"weak password"}',
    });
    const { result } = renderHook(() => useAuthFlowState(DEFAULT_PARAMS));
    act(() => {
      result.current.setRequirePasswordSetup(true);
      result.current.setPasswordSetupForm({ newPassword: 'abcdef', newPasswordConfirm: 'abcdef' });
    });
    let r;
    await act(async () => {
      r = await result.current.completeInitialPasswordSetup();
    });
    expect(r).toEqual({ ok: false, error: 'weak password' });
    expect(result.current.requirePasswordSetup).toBe(true);
    expect(result.current.passwordSetupForm.newPassword).toBe('abcdef');
  });
});

describe('useAuthFlowState.resendConfirmationEmail', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    (globalThis as any).fetch = fetchMock;
  });

  it('returns error when identifier is blank', async () => {
    const { result } = renderHook(() => useAuthFlowState(DEFAULT_PARAMS));
    const r = await result.current.resendConfirmationEmail('   ');
    expect(r).toEqual({ ok: false, error: 'Enter your email or username first.' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs /api/web-auth/resend-confirmation and returns server message on success', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ message: 'sent!' }),
      text: async () => '{"message":"sent!"}',
    });
    const { result } = renderHook(() => useAuthFlowState(DEFAULT_PARAMS));
    let r;
    await act(async () => {
      r = await result.current.resendConfirmationEmail('ada@example.com');
    });
    expect(r).toEqual({ ok: true, message: 'sent!' });
    const [[url, init]] = fetchMock.mock.calls;
    expect(String(url)).toBe(`${BACKEND}/api/web-auth/resend-confirmation`);
    expect((init as any)?.method).toBe('POST');
  });

  it('returns default success message when server omits one', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => '{}',
    });
    const { result } = renderHook(() => useAuthFlowState(DEFAULT_PARAMS));
    let r!: Awaited<ReturnType<typeof result.current.resendConfirmationEmail>>;
    await act(async () => {
      r = await result.current.resendConfirmationEmail('x@y.z');
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.message).toContain('confirmation link');
  });

  it('surfaces server error on failure', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'boom' }),
      text: async () => '{"error":"boom"}',
    });
    const { result } = renderHook(() => useAuthFlowState(DEFAULT_PARAMS));
    let r;
    await act(async () => {
      r = await result.current.resendConfirmationEmail('x@y.z');
    });
    expect(r).toEqual({ ok: false, error: 'boom' });
  });
});
