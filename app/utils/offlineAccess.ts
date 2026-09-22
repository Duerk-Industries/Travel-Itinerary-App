import * as LocalAuthentication from 'expo-local-authentication';
import { Platform } from 'react-native';

export type OfflineUnlockResult =
  | { ok: true }
  | { ok: false; message: string };

/**
 * Uses the operating system's authentication sheet. On supported devices the
 * default fallback permits the device PIN/passcode after biometric attempts.
 */
export const requestOfflineUnlock = async (): Promise<OfflineUnlockResult> => {
  if (Platform.OS === 'web') {
    return { ok: false, message: 'Offline unlock is available in the phone app.' };
  }

  try {
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    if (!hasHardware) {
      return { ok: false, message: 'This device does not support biometric or device-PIN authentication.' };
    }
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock cached trips',
      promptDescription: 'Confirm your identity to view offline trip information.',
      cancelLabel: 'Cancel',
      fallbackLabel: 'Use device PIN',
      disableDeviceFallback: false,
    });
    return result.success ? { ok: true } : { ok: false, message: 'Offline trips remain locked.' };
  } catch {
    return { ok: false, message: 'Could not open device authentication.' };
  }
};
