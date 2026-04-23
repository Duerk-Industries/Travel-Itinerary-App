import { useCallback, useState } from 'react';
import { ApiClientError, requestJson } from '../utils/apiClient';

export type PasswordSetupForm = {
  newPassword: string;
  newPasswordConfirm: string;
};

const EMPTY_PASSWORD_FORM: PasswordSetupForm = {
  newPassword: '',
  newPasswordConfirm: '',
};

export type AuthActionResult<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true } & T)
  | { ok: false; error: string };

type UseAuthFlowStateParams = {
  backendUrl: string;
  userToken: string | null;
};

/**
 * Clusters the post-login auth-flow state and actions that App.tsx previously
 * held as 9 separate `useState` calls and two inline async handlers:
 *
 *   - `deferFirstLoginRedirect` — whether the first-login account tour is
 *     currently suppressed (e.g. while processing an invite).
 *   - `showResendConfirmation` / `resendConfirmationLoading` — UX state for
 *     "resend verification email" prompt shown on login.
 *   - `requirePasswordSetup` / `passwordSetupLoading` / `passwordSetupForm`
 *     — the "set your password" flow shown after OAuth-only signup.
 *   - `isFirstLogin` — triggers the onboarding redirect to /account.
 *   - `emailConfirmationMessage` / `authErrorMessage` — banner messages.
 *
 * Plus two actions (new in this pass):
 *   - `completeInitialPasswordSetup()` — PATCH /api/account/password; on
 *     success clears the form and dismisses the password-setup gate.
 *   - `resendConfirmationEmail(identifier)` — POST /api/web-auth/resend-confirmation.
 *
 * Core session tokens (userToken/userEmail/...) stay in App.tsx — a separate
 * extraction pass owns those.
 */
export const useAuthFlowState = ({ backendUrl, userToken }: UseAuthFlowStateParams) => {
  const [deferFirstLoginRedirect, setDeferFirstLoginRedirect] = useState(false);
  const [showResendConfirmation, setShowResendConfirmation] = useState(false);
  const [resendConfirmationLoading, setResendConfirmationLoading] = useState(false);
  const [requirePasswordSetup, setRequirePasswordSetup] = useState(false);
  const [passwordSetupLoading, setPasswordSetupLoading] = useState(false);
  const [passwordSetupForm, setPasswordSetupForm] = useState<PasswordSetupForm>(EMPTY_PASSWORD_FORM);
  const [isFirstLogin, setIsFirstLogin] = useState(false);
  const [emailConfirmationMessage, setEmailConfirmationMessage] = useState<string | null>(null);
  const [authErrorMessage, setAuthErrorMessage] = useState<string | null>(null);

  const resetPasswordSetupForm = useCallback(() => {
    setPasswordSetupForm(EMPTY_PASSWORD_FORM);
  }, []);

  const clearAuthFlowState = useCallback(() => {
    setDeferFirstLoginRedirect(false);
    setShowResendConfirmation(false);
    setResendConfirmationLoading(false);
    setRequirePasswordSetup(false);
    setPasswordSetupLoading(false);
    setPasswordSetupForm(EMPTY_PASSWORD_FORM);
    setIsFirstLogin(false);
    setEmailConfirmationMessage(null);
    setAuthErrorMessage(null);
  }, []);

  const completeInitialPasswordSetup = useCallback(async (): Promise<AuthActionResult> => {
    if (!userToken) return { ok: false, error: 'Not signed in' };
    if (passwordSetupForm.newPassword !== passwordSetupForm.newPasswordConfirm) {
      return { ok: false, error: 'Passwords do not match' };
    }
    if (passwordSetupForm.newPassword.trim().length < 6) {
      return { ok: false, error: 'New password must be at least 6 characters' };
    }
    setPasswordSetupLoading(true);
    try {
      await requestJson(`${backendUrl}/api/account/password`, {
        method: 'PATCH',
        token: userToken,
        body: {
          newPassword: passwordSetupForm.newPassword,
          newPasswordConfirm: passwordSetupForm.newPasswordConfirm,
        },
      });
      setRequirePasswordSetup(false);
      setPasswordSetupForm(EMPTY_PASSWORD_FORM);
      return { ok: true };
    } catch (err) {
      const message =
        err instanceof ApiClientError
          ? err.message
          : (err as Error).message || 'Unable to set password';
      return { ok: false, error: message };
    } finally {
      setPasswordSetupLoading(false);
    }
  }, [backendUrl, passwordSetupForm.newPassword, passwordSetupForm.newPasswordConfirm, userToken]);

  const resendConfirmationEmail = useCallback(
    async (identifier: string): Promise<AuthActionResult<{ message: string }>> => {
      const email = identifier.trim();
      if (!email) return { ok: false, error: 'Enter your email or username first.' };
      setResendConfirmationLoading(true);
      try {
        const data = await requestJson<{ message?: string }>(
          `${backendUrl}/api/web-auth/resend-confirmation`,
          {
            method: 'POST',
            body: { identifier: email },
          }
        );
        return {
          ok: true,
          message:
            data?.message ||
            'If an account exists for this email, a confirmation link has been sent.',
        };
      } catch (err) {
        const message =
          err instanceof ApiClientError
            ? err.message
            : (err as Error).message || 'Failed to resend confirmation email.';
        return { ok: false, error: message };
      } finally {
        setResendConfirmationLoading(false);
      }
    },
    [backendUrl]
  );

  return {
    // state
    deferFirstLoginRedirect,
    showResendConfirmation,
    resendConfirmationLoading,
    requirePasswordSetup,
    passwordSetupLoading,
    passwordSetupForm,
    isFirstLogin,
    emailConfirmationMessage,
    authErrorMessage,
    // setters
    setDeferFirstLoginRedirect,
    setShowResendConfirmation,
    setResendConfirmationLoading,
    setRequirePasswordSetup,
    setPasswordSetupLoading,
    setPasswordSetupForm,
    setIsFirstLogin,
    setEmailConfirmationMessage,
    setAuthErrorMessage,
    // helpers
    resetPasswordSetupForm,
    clearAuthFlowState,
    // actions
    completeInitialPasswordSetup,
    resendConfirmationEmail,
  };
};
