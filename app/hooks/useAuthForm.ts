import { useCallback, useState } from 'react';

export type AuthFormFields = {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  passwordConfirm: string;
};

export type AuthMode = 'login' | 'register';

const EMPTY_FORM: AuthFormFields = {
  firstName: '',
  lastName: '',
  email: '',
  password: '',
  passwordConfirm: '',
};

/**
 * Owns the login/register form cluster that App.tsx held as two useStates:
 *
 *   - `authMode` — toggles which set of fields the login view renders
 *   - `authForm` — { firstName, lastName, email, password, passwordConfirm }
 *
 * Ships convenience helpers used by the auth view:
 *   - `updateAuthFormField(field, value)` — partial update by key
 *   - `resetAuthForm()` — clear all fields (e.g. after successful register → login)
 *   - `switchToLogin()` / `switchToRegister()` — semantic aliases for setAuthMode
 */
export const useAuthForm = () => {
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [authForm, setAuthForm] = useState<AuthFormFields>(EMPTY_FORM);

  const updateAuthFormField = useCallback(
    <K extends keyof AuthFormFields>(field: K, value: AuthFormFields[K]) => {
      setAuthForm((prev) => ({ ...prev, [field]: value }));
    },
    []
  );

  const resetAuthForm = useCallback(() => {
    setAuthForm(EMPTY_FORM);
  }, []);

  const switchToLogin = useCallback(() => setAuthMode('login'), []);
  const switchToRegister = useCallback(() => setAuthMode('register'), []);

  return {
    authMode,
    authForm,
    setAuthMode,
    setAuthForm,
    updateAuthFormField,
    resetAuthForm,
    switchToLogin,
    switchToRegister,
  };
};
