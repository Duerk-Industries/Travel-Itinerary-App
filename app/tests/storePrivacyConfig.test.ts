/// <reference types="jest" />
import path from 'path';

/**
 * Store disclosures (analytics plan, Phase 4): the iOS privacy manifest and the Android
 * advertising-ID block must stay in the app config. If you add a data type here, update
 * the App Store Connect App Privacy answers, Google Play Data safety and the privacy notice.
 */
describe('store privacy configuration', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createExpoConfig } = require('../../expo.config.shared.cjs');
  const config = createExpoConfig({ appDir: path.resolve(__dirname, '..') });
  const manifest = config.ios.privacyManifests;

  it('declares no tracking and no tracking domains (no ATT prompt)', () => {
    expect(manifest.NSPrivacyTracking).toBe(false);
    expect(manifest.NSPrivacyTrackingDomains).toEqual([]);
    expect(config.ios.infoPlist?.NSUserTrackingUsageDescription).toBeUndefined();
    for (const type of manifest.NSPrivacyCollectedDataTypes) {
      expect(type.NSPrivacyCollectedDataTypeTracking).toBe(false);
    }
  });

  it('declares the optional analytics and diagnostics data as linked, with analytics purposes', () => {
    const byType = Object.fromEntries(
      manifest.NSPrivacyCollectedDataTypes.map((t: any) => [t.NSPrivacyCollectedDataType.replace('NSPrivacyCollectedDataType', ''), t]),
    );
    for (const type of ['ProductInteraction', 'CrashData', 'PerformanceData', 'UserID', 'DeviceID']) {
      expect(byType[type]).toBeDefined();
      expect(byType[type].NSPrivacyCollectedDataTypeLinked).toBe(true);
    }
    expect(byType.ProductInteraction.NSPrivacyCollectedDataTypePurposes).toEqual(['NSPrivacyCollectedDataTypePurposeAnalytics']);
  });

  it('declares a reason for each required-reason API category', () => {
    for (const api of manifest.NSPrivacyAccessedAPITypes) {
      expect(api.NSPrivacyAccessedAPIType).toMatch(/^NSPrivacyAccessedAPICategory/);
      expect(api.NSPrivacyAccessedAPITypeReasons.length).toBeGreaterThan(0);
    }
  });

  it('blocks the Android advertising ID permission', () => {
    expect(config.android.blockedPermissions).toContain('com.google.android.gms.permission.AD_ID');
  });
});
