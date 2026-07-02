import { Platform } from 'react-native';

export type CopyResult = 'copied' | 'unavailable' | 'failed';

const copyOnWeb = async (text: string): Promise<CopyResult> => {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
    return 'unavailable';
  }
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'failed';
  }
};

const copyOnNative = async (text: string): Promise<CopyResult> => {
  try {
    // Lazy-require so web bundles don't pull in the native module.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Clipboard = require('expo-clipboard');
    await Clipboard.setStringAsync(text);
    return 'copied';
  } catch {
    return 'failed';
  }
};

export const copyToClipboard = async (text: string): Promise<CopyResult> => {
  if (!text) return 'failed';
  return Platform.OS === 'web' ? copyOnWeb(text) : copyOnNative(text);
};
