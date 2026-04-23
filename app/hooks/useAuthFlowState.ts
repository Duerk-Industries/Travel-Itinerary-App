import { useCallback, useState } from 'react';

export type PasswordSetupForm = {
  newPassword: string;
  newPasswordConfirm: string;
};

const EMPTY_PASSWORD_FORM: PasswordSetupForm = {
  newPassword: '',
  newPasswordConfirm: '',
};

/**
 * Clusters the post-login auth-flow state that App.tsx previously held as 9
 * separate `useState` calls:
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
 * Core session tokens (userToken/userEmail/...) deliberately stay in App.tsx
 * because they are referenced by hundreds of call sites; that rewrite is a
 * separate pass.
 */
export const useAuthFlowState = () => {
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
  };
};
