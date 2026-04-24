import React from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import type { AuthFormFields, AuthMode } from '../hooks/useAuthForm';

export type AuthFormProps = {
  /** Which form to render — Login (minimal fields) vs Create (full fields). */
  authMode: AuthMode;
  setAuthMode: (mode: AuthMode) => void;
  /** Current form state — first name, last name, email, password, confirm. */
  authForm: AuthFormFields;
  setAuthForm: React.Dispatch<React.SetStateAction<AuthFormFields>>;
  /** If true, renders the "Resend confirmation" affordance under the password field. */
  showResendConfirmation: boolean;
  setShowResendConfirmation: (value: boolean) => void;
  resendConfirmationLoading: boolean;
  resendConfirmationEmail: () => void | Promise<void>;
  /** Banner message shown above the submit buttons; null/empty hides the banner. */
  authErrorMessage: string | null;
  /** Submit handlers wired by App.tsx — `onSubmit` dispatches based on mode. */
  loginWithPassword: () => void | Promise<void>;
  register: () => void | Promise<void>;
  loginWithGoogle: () => void | Promise<void>;
  /** Full `styles` object from the parent App.tsx — the form consumes a fixed set. */
  styles: Record<string, any>;
};

/**
 * Login/Create-account form extracted verbatim from App.tsx as part of the
 * Priority 4 decomposition pass. Presentational only — App.tsx retains all
 * auth mutation logic, session persistence, and navigation. The form owns
 * zero state; every field is controlled by the parent hook (`useAuthForm`)
 * so resetting the form from an outer success flow (e.g. clearing inputs
 * after a successful register) stays a one-line call there.
 */
const AuthForm: React.FC<AuthFormProps> = ({
  authMode,
  setAuthMode,
  authForm,
  setAuthForm,
  showResendConfirmation,
  setShowResendConfirmation,
  resendConfirmationLoading,
  resendConfirmationEmail,
  authErrorMessage,
  loginWithPassword,
  register,
  loginWithGoogle,
  styles,
}) => (
  <View style={styles.auth} testID="auth-form">
    <View style={styles.toggleRow}>
      <TouchableOpacity
        style={[styles.toggleButton, authMode === 'login' && styles.toggleActive]}
        onPress={() => setAuthMode('login')}
        accessibilityRole="button"
        accessibilityLabel="Switch to Login form"
        accessibilityState={{ selected: authMode === 'login' }}
        testID="auth-form-mode-login"
      >
        <Text style={styles.toggleText}>Login</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.toggleButton, authMode === 'register' && styles.toggleActive]}
        onPress={() => setAuthMode('register')}
        accessibilityRole="button"
        accessibilityLabel="Switch to Create account form"
        accessibilityState={{ selected: authMode === 'register' }}
        testID="auth-form-mode-register"
      >
        <Text style={styles.toggleText}>Create</Text>
      </TouchableOpacity>
    </View>

    {authMode === 'register' ? (
      <>
        <TextInput
          style={styles.input}
          placeholder="First name"
          autoComplete="given-name"
          textContentType="givenName"
          value={authForm.firstName}
          onChangeText={(text: string) => setAuthForm((p) => ({ ...p, firstName: text }))}
        />
        <TextInput
          style={styles.input}
          placeholder="Last name"
          autoComplete="family-name"
          textContentType="familyName"
          value={authForm.lastName}
          onChangeText={(text: string) => setAuthForm((p) => ({ ...p, lastName: text }))}
        />
      </>
    ) : null}

    <TextInput
      style={styles.input}
      placeholder="Email or Username"
      autoCapitalize="none"
      autoComplete={authMode === 'register' ? 'email' : 'username'}
      textContentType={authMode === 'register' ? 'emailAddress' : 'username'}
      inputMode="email"
      nativeID="email"
      value={authForm.email}
      onChangeText={(text: string) => setAuthForm((p) => ({ ...p, email: text }))}
    />
    <TextInput
      style={styles.input}
      placeholder="Password"
      secureTextEntry
      autoComplete={authMode === 'register' ? 'new-password' : 'current-password'}
      textContentType={authMode === 'register' ? 'newPassword' : 'password'}
      nativeID="password"
      value={authForm.password}
      onChangeText={(text: string) => setAuthForm((p) => ({ ...p, password: text }))}
    />
    {authMode === 'register' ? (
      <TextInput
        style={styles.input}
        placeholder="Confirm password"
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        nativeID="password-confirm"
        value={authForm.passwordConfirm}
        onChangeText={(text: string) => setAuthForm((p) => ({ ...p, passwordConfirm: text }))}
      />
    ) : null}
    {authMode === 'login' && showResendConfirmation ? (
      <View style={styles.row}>
        <TouchableOpacity
          style={[styles.button, styles.smallButton, resendConfirmationLoading && styles.buttonDisabled]}
          onPress={resendConfirmationEmail}
          disabled={resendConfirmationLoading}
        >
          <Text style={styles.buttonText}>{resendConfirmationLoading ? 'Resending...' : 'Resend confirmation'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.button, styles.smallButton]}
          onPress={() => setShowResendConfirmation(false)}
        >
          <Text style={styles.buttonText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    ) : null}
    {authErrorMessage ? (
      <View style={styles.authErrorBanner} testID="auth-form-error-banner">
        <Text style={styles.authErrorBannerText}>{authErrorMessage}</Text>
      </View>
    ) : null}
    <TouchableOpacity
      style={styles.button}
      onPress={authMode === 'login' ? loginWithPassword : register}
      accessibilityRole="button"
      accessibilityLabel={authMode === 'login' ? 'Login' : 'Create account'}
      testID="auth-form-submit"
    >
      <Text style={styles.buttonText}>{authMode === 'login' ? 'Login' : 'Create account'}</Text>
    </TouchableOpacity>
    <TouchableOpacity
      style={[styles.button, { marginTop: 12, backgroundColor: '#4285F4' }]}
      onPress={loginWithGoogle}
      accessibilityRole="button"
      accessibilityLabel="Sign in with Google"
      testID="auth-form-google"
    >
      <Text style={styles.buttonText}>Sign in with Google</Text>
    </TouchableOpacity>
  </View>
);

export default AuthForm;
