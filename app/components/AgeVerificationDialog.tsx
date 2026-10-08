import React, { useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import DialogShell from './DialogShell';
import { requestAppleAgeConfirmation } from '../utils/appleAgeRange';

/**
 * Post-sign-in date-of-birth prompt (docs/implementation-plans/analytics-upgrade.md,
 * open decision 10). Shown for any account without a declared date of birth, which
 * includes every Google/Apple sign-up. It is a neutral age screen: the minimum age is
 * not shown until a date is submitted, and the dialog cannot be dismissed.
 */

export type AgeVerificationStatus = { required: boolean; enforced: boolean; minimumAge: number };

export const fetchAgeVerificationStatus = async (
  backendUrl: string,
  token: string
): Promise<AgeVerificationStatus | null> => {
  try {
    const res = await fetch(`${backendUrl}/api/account/age-verification`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return (await res.json()) as AgeVerificationStatus;
  } catch {
    return null;
  }
};

/**
 * iOS 26+ shortcut: if Apple's Declared Age Range confirms the minimum age, record
 * "verified 16+ via Apple" and skip the prompt. Returns false in every other case
 * (including server errors) so the caller falls back to the date-of-birth prompt.
 */
export const verifyAgeWithAppleIfAvailable = async (
  backendUrl: string,
  token: string,
  minimumAge: number,
  requestConfirmation: typeof requestAppleAgeConfirmation = requestAppleAgeConfirmation
): Promise<boolean> => {
  const apple = await requestConfirmation(minimumAge);
  if (!apple.confirmed) return false;
  try {
    const res = await fetch(`${backendUrl}/api/account/age-verification/apple`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ lowerBound: apple.lowerBound }),
    });
    return res.ok;
  } catch {
    return false;
  }
};

type SubmitResult = 'verified' | 'under_minimum_age' | 'invalid' | 'error';

export const submitDateOfBirth = async (backendUrl: string, token: string, dateOfBirth: string): Promise<SubmitResult> => {
  try {
    const res = await fetch(`${backendUrl}/api/account/age-verification`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ dateOfBirth }),
    });
    if (res.ok) return 'verified';
    const body = await res.json().catch(() => ({}));
    if (body?.code === 'UNDER_MINIMUM_AGE') return 'under_minimum_age';
    if (body?.code === 'INVALID_DATE_OF_BIRTH') return 'invalid';
    return 'error';
  } catch {
    return 'error';
  }
};

const deleteOwnAccount = async (backendUrl: string, token: string): Promise<boolean> => {
  try {
    const res = await fetch(`${backendUrl}/api/account`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.ok;
  } catch {
    return false;
  }
};

type AgeVerificationDialogProps = {
  visible: boolean;
  styles: Record<string, any>;
  backendUrl: string;
  token: string;
  onVerified: () => void;
  onSignOut: () => void;
};

const noop = () => undefined;

const AgeVerificationDialog: React.FC<AgeVerificationDialogProps> = ({
  visible,
  styles,
  backendUrl,
  token,
  onVerified,
  onSignOut,
}) => {
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [underAge, setUnderAge] = useState(false);

  const submit = async () => {
    setBusy(true);
    setMessage(null);
    const result = await submitDateOfBirth(backendUrl, token, dateOfBirth.trim());
    setBusy(false);
    if (result === 'verified') {
      onVerified();
    } else if (result === 'under_minimum_age') {
      setUnderAge(true);
    } else if (result === 'invalid') {
      setMessage('Enter a valid date as YYYY-MM-DD.');
    } else {
      setMessage('Could not save your date of birth. Try again.');
    }
  };

  const deleteAccount = async () => {
    setBusy(true);
    const deleted = await deleteOwnAccount(backendUrl, token);
    setBusy(false);
    if (deleted) {
      onSignOut();
    } else {
      setMessage('Could not delete your account. Try again or contact support@wander-bunnies.com.');
    }
  };

  if (underAge) {
    return (
      <DialogShell
        visible={visible}
        title="You can't use WanderBunnies yet"
        message="You must be at least 16 years old to have a WanderBunnies account. You can delete this account now, which removes the data it holds."
        styles={styles}
        onClose={noop}
        testID="age-verification-under-age"
        accessibilityRole="alert"
      >
        {message ? <Text style={styles.helperText}>{message}</Text> : null}
        <View style={styles.row}>
          <TouchableOpacity
            style={[styles.button, styles.smallButton, busy && styles.buttonDisabled]}
            onPress={deleteAccount}
            disabled={busy}
            testID="age-verification-delete-account"
            accessibilityRole="button"
            accessibilityLabel="Delete my account"
          >
            <Text style={styles.buttonText}>{busy ? 'Deleting...' : 'Delete my account'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.smallButton, styles.secondaryButton]}
            onPress={onSignOut}
            testID="age-verification-sign-out"
            accessibilityRole="button"
            accessibilityLabel="Sign out"
          >
            <Text style={styles.secondaryButtonText}>Sign out</Text>
          </TouchableOpacity>
        </View>
      </DialogShell>
    );
  }

  return (
    <DialogShell
      visible={visible}
      title="Confirm your date of birth"
      message="Enter your date of birth to continue. We use it only to confirm you're old enough to have an account."
      styles={styles}
      onClose={noop}
      testID="age-verification-dialog"
      accessibilityRole="alert"
    >
      <TextInput
        style={styles.input}
        value={dateOfBirth}
        onChangeText={setDateOfBirth}
        placeholder="YYYY-MM-DD"
        keyboardType="numbers-and-punctuation"
        autoComplete="birthdate-full"
        textContentType="none"
        maxLength={10}
        testID="age-verification-date-input"
        accessibilityLabel="Date of birth, year month day"
      />
      {message ? <Text style={styles.helperText}>{message}</Text> : null}
      <View style={styles.row}>
        <TouchableOpacity
          style={[styles.button, styles.smallButton, (busy || !dateOfBirth.trim()) && styles.buttonDisabled]}
          onPress={submit}
          disabled={busy || !dateOfBirth.trim()}
          testID="age-verification-submit"
          accessibilityRole="button"
          accessibilityLabel="Continue"
        >
          <Text style={styles.buttonText}>{busy ? 'Saving...' : 'Continue'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.button, styles.smallButton, styles.secondaryButton]}
          onPress={onSignOut}
          testID="age-verification-sign-out"
          accessibilityRole="button"
          accessibilityLabel="Sign out"
        >
          <Text style={styles.secondaryButtonText}>Sign out</Text>
        </TouchableOpacity>
      </View>
    </DialogShell>
  );
};

export default AgeVerificationDialog;
