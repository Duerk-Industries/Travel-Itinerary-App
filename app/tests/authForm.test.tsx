/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import AuthForm from '../components/AuthForm';
import type { AuthFormFields, AuthMode } from '../hooks/useAuthForm';

const styles: Record<string, any> = {
  auth: {},
  toggleRow: {},
  toggleButton: {},
  toggleActive: {},
  toggleText: {},
  input: {},
  row: {},
  button: {},
  smallButton: {},
  buttonDisabled: {},
  buttonText: {},
  authErrorBanner: {},
  authErrorBannerText: {},
};

const emptyForm: AuthFormFields = {
  firstName: '',
  lastName: '',
  email: '',
  password: '',
  passwordConfirm: '',
};

const buildProps = (overrides: Partial<React.ComponentProps<typeof AuthForm>> = {}) => {
  const setAuthMode = jest.fn();
  const setAuthForm = jest.fn();
  const setShowResendConfirmation = jest.fn();
  const resendConfirmationEmail = jest.fn();
  const loginWithPassword = jest.fn();
  const register = jest.fn();
  const loginWithGoogle = jest.fn();
  const loginWithApple = jest.fn();
  return {
    authMode: 'login' as AuthMode,
    setAuthMode,
    authForm: emptyForm,
    setAuthForm,
    showResendConfirmation: false,
    setShowResendConfirmation,
    resendConfirmationLoading: false,
    resendConfirmationEmail,
    authErrorMessage: null,
    loginWithPassword,
    register,
    loginWithGoogle,
    loginWithApple,
    appleOAuthEnabled: false,
    styles,
    ...overrides,
    mocks: {
      setAuthMode,
      setAuthForm,
      setShowResendConfirmation,
      resendConfirmationEmail,
      loginWithPassword,
      register,
      loginWithGoogle,
      loginWithApple,
    },
  };
};

describe('AuthForm', () => {
  it('renders Login form (no first/last name, no confirm password) when authMode is login', () => {
    const props = buildProps({ authMode: 'login' });
    const { getByPlaceholderText, queryByPlaceholderText, getByTestId } = render(<AuthForm {...props} />);
    expect(getByPlaceholderText('Email or Username')).toBeTruthy();
    expect(getByPlaceholderText('Password')).toBeTruthy();
    expect(queryByPlaceholderText('First name')).toBeNull();
    expect(queryByPlaceholderText('Last name')).toBeNull();
    expect(queryByPlaceholderText('Confirm password')).toBeNull();
    expect(getByTestId('auth-form-submit').props.accessibilityLabel).toBe('Login');
  });

  it('renders Register form (first/last name + confirm password) when authMode is register', () => {
    const props = buildProps({ authMode: 'register' });
    const { getByPlaceholderText, getByTestId } = render(<AuthForm {...props} />);
    expect(getByPlaceholderText('First name')).toBeTruthy();
    expect(getByPlaceholderText('Last name')).toBeTruthy();
    expect(getByPlaceholderText('Confirm password')).toBeTruthy();
    expect(getByTestId('auth-form-submit').props.accessibilityLabel).toBe('Create account');
  });

  it('pressing the Login submit button calls loginWithPassword (not register)', () => {
    const props = buildProps({ authMode: 'login' });
    const { getByTestId } = render(<AuthForm {...props} />);
    fireEvent.press(getByTestId('auth-form-submit'));
    expect(props.mocks.loginWithPassword).toHaveBeenCalledTimes(1);
    expect(props.mocks.register).not.toHaveBeenCalled();
  });

  it('pressing the Create submit button calls register (not loginWithPassword)', () => {
    const props = buildProps({ authMode: 'register' });
    const { getByTestId } = render(<AuthForm {...props} />);
    fireEvent.press(getByTestId('auth-form-submit'));
    expect(props.mocks.register).toHaveBeenCalledTimes(1);
    expect(props.mocks.loginWithPassword).not.toHaveBeenCalled();
  });

  it('pressing the Google button calls loginWithGoogle', () => {
    const props = buildProps();
    const { getByTestId } = render(<AuthForm {...props} />);
    fireEvent.press(getByTestId('auth-form-google'));
    expect(props.mocks.loginWithGoogle).toHaveBeenCalledTimes(1);
  });

  it('shows Apple sign-in only when enabled and invokes it when pressed', () => {
    const props = buildProps({ appleOAuthEnabled: true });
    const { getByTestId } = render(<AuthForm {...props} />);
    fireEvent.press(getByTestId('auth-form-apple'));
    expect(props.mocks.loginWithApple).toHaveBeenCalledTimes(1);
  });

  it('hides Apple sign-in when the backend feature flag is disabled', () => {
    const { queryByTestId } = render(<AuthForm {...buildProps({ appleOAuthEnabled: false })} />);
    expect(queryByTestId('auth-form-apple')).toBeNull();
  });

  it('mode toggle buttons call setAuthMode with the chosen mode', () => {
    const props = buildProps({ authMode: 'login' });
    const { getByTestId } = render(<AuthForm {...props} />);
    fireEvent.press(getByTestId('auth-form-mode-register'));
    expect(props.mocks.setAuthMode).toHaveBeenCalledWith('register');
    fireEvent.press(getByTestId('auth-form-mode-login'));
    expect(props.mocks.setAuthMode).toHaveBeenCalledWith('login');
  });

  it('shows the error banner when authErrorMessage is non-empty, hides when null', () => {
    const { queryByTestId, rerender } = render(
      <AuthForm {...buildProps({ authErrorMessage: null })} />,
    );
    expect(queryByTestId('auth-form-error-banner')).toBeNull();
    rerender(<AuthForm {...buildProps({ authErrorMessage: 'Invalid credentials' })} />);
    expect(queryByTestId('auth-form-error-banner')).toBeTruthy();
  });

  it('shows the Resend confirmation affordance only on login with showResendConfirmation=true', () => {
    const { queryByText, rerender } = render(
      <AuthForm {...buildProps({ authMode: 'login', showResendConfirmation: true })} />,
    );
    expect(queryByText('Resend confirmation')).toBeTruthy();
    rerender(<AuthForm {...buildProps({ authMode: 'login', showResendConfirmation: false })} />);
    expect(queryByText('Resend confirmation')).toBeNull();
    // Never shown on register.
    rerender(<AuthForm {...buildProps({ authMode: 'register', showResendConfirmation: true })} />);
    expect(queryByText('Resend confirmation')).toBeNull();
  });

  it('typing in the email field calls setAuthForm with the updated email', () => {
    const props = buildProps();
    const { getByPlaceholderText } = render(<AuthForm {...props} />);
    fireEvent.changeText(getByPlaceholderText('Email or Username'), 'alice@example.com');
    expect(props.mocks.setAuthForm).toHaveBeenCalledTimes(1);
    const updater = (props.mocks.setAuthForm.mock.calls[0] as any)[0];
    expect(typeof updater).toBe('function');
    expect(updater(emptyForm)).toEqual({ ...emptyForm, email: 'alice@example.com' });
  });
});
