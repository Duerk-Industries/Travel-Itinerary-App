import { Platform } from 'react-native';
import * as Network from 'expo-network';
import { readAsync, writeAsync } from './persistentStorage';

/** Device-level choice (not per account): the same phone and data plan apply to anyone using it. */
const WIFI_ONLY_KEY = 'stp.offline-wifi-only-downloads';
/** Warn before a deliberate save on mobile data when the last copy was at least this large. */
export const LARGE_DOWNLOAD_BYTES = 5 * 1024 * 1024;

export type ConnectionCost = 'unmetered' | 'metered' | 'unknown';

export const readWifiOnlyPreference = async (): Promise<boolean> => (await readAsync(WIFI_ONLY_KEY)) === '1';
export const writeWifiOnlyPreference = (enabled: boolean): Promise<void> =>
  writeAsync(WIFI_ONLY_KEY, enabled ? '1' : '0');

/** Unknown is a real answer: VPNs, Bluetooth tethering and most browsers do not say. */
export const getConnectionCost = async (): Promise<ConnectionCost> => {
  try {
    if (Platform.OS === 'web') {
      const type = (typeof navigator !== 'undefined'
        ? (navigator as Navigator & { connection?: { type?: string } }).connection?.type : undefined);
      if (type === 'cellular') return 'metered';
      return type === 'wifi' || type === 'ethernet' ? 'unmetered' : 'unknown';
    }
    const type = String((await Network.getNetworkStateAsync()).type ?? '');
    if (type === 'CELLULAR') return 'metered';
    return type === 'WIFI' || type === 'ETHERNET' ? 'unmetered' : 'unknown';
  } catch {
    return 'unknown';
  }
};

/** Automatic refreshes honor the setting strictly: only a confirmed unmetered link qualifies. */
export const allowAutomaticDownload = (wifiOnly: boolean, cost: ConnectionCost): boolean =>
  !wifiOnly || cost === 'unmetered';

/** A deliberate save always works on mobile data; this only decides whether to ask first. */
export const shouldWarnBeforeDownload = (wifiOnly: boolean, cost: ConnectionCost, estimatedBytes: number): boolean =>
  cost === 'metered' && (wifiOnly || estimatedBytes >= LARGE_DOWNLOAD_BYTES);

/** Conservative UTF-8 bound without needing TextEncoder (absent in some Hermes builds). */
export const estimateBytes = (value: unknown): number => {
  if (!value) return 0;
  const serialized = JSON.stringify(value);
  return typeof TextEncoder === 'function' ? new TextEncoder().encode(serialized).byteLength : serialized.length * 4;
};
