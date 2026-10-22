import { Platform } from 'react-native';
import * as Network from 'expo-network';
import {
  LARGE_DOWNLOAD_BYTES, allowAutomaticDownload, getConnectionCost, readWifiOnlyPreference, shouldWarnBeforeDownload, writeWifiOnlyPreference,
} from '../utils/offlineDownloadPolicy';

const network = (type?: string) => jest.mocked(Network.getNetworkStateAsync).mockResolvedValue({ type } as never);

describe('offline download policy', () => {
  beforeEach(() => { Platform.OS = 'ios'; });

  it('classifies native connections and treats anything unclear as unknown', async () => {
    network('WIFI'); expect(await getConnectionCost()).toBe('unmetered');
    network('ETHERNET'); expect(await getConnectionCost()).toBe('unmetered');
    network('CELLULAR'); expect(await getConnectionCost()).toBe('metered');
    network('VPN'); expect(await getConnectionCost()).toBe('unknown');
    network(undefined); expect(await getConnectionCost()).toBe('unknown');
    jest.mocked(Network.getNetworkStateAsync).mockRejectedValue(new Error('no'));
    expect(await getConnectionCost()).toBe('unknown');
  });

  it('automatic downloads need a confirmed unmetered link only when Wi-Fi only is on', () => {
    expect(allowAutomaticDownload(false, 'metered')).toBe(true);
    expect(allowAutomaticDownload(true, 'unmetered')).toBe(true);
    expect(allowAutomaticDownload(true, 'metered')).toBe(false);
    expect(allowAutomaticDownload(true, 'unknown')).toBe(false);
  });

  it('warns on mobile data for Wi-Fi only or large trips, never blocks, never guesses', () => {
    expect(shouldWarnBeforeDownload(true, 'metered', 0)).toBe(true);
    expect(shouldWarnBeforeDownload(false, 'metered', LARGE_DOWNLOAD_BYTES)).toBe(true);
    expect(shouldWarnBeforeDownload(false, 'metered', 1024)).toBe(false);
    expect(shouldWarnBeforeDownload(true, 'unmetered', LARGE_DOWNLOAD_BYTES * 4)).toBe(false);
    expect(shouldWarnBeforeDownload(true, 'unknown', LARGE_DOWNLOAD_BYTES * 4)).toBe(false);
  });

  it('persists the preference', async () => {
    expect(await readWifiOnlyPreference()).toBe(false);
    await writeWifiOnlyPreference(true);
    expect(await readWifiOnlyPreference()).toBe(true);
    await writeWifiOnlyPreference(false);
    expect(await readWifiOnlyPreference()).toBe(false);
  });
});
