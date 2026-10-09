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

/**
 * Registry → store disclosure drift check (analytics plan, Phase 4 §4 / Phase 7). Every consent
 * purpose used by an event in packages/analytics must map to App Store data types that the iOS
 * manifest declares (with the Analytics purpose) and that the review packet's App Privacy table
 * lists. Adding a new purpose or data category fails here until the disclosures are updated.
 */
describe('analytics registry vs store disclosures', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { ANALYTICS_EVENTS } = require('../../packages/analytics/src/registry');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createExpoConfig } = require('../../expo.config.shared.cjs');
  const fs = require('fs') as typeof import('fs');
  const manifest = createExpoConfig({ appDir: path.resolve(__dirname, '..') }).ios.privacyManifests;
  const packet = fs.readFileSync(path.resolve(__dirname, '../../docs/app-store-review-packet.md'), 'utf8');

  const PURPOSE_DISCLOSURES: Record<string, Array<{ manifestType: string; packetLabel: string }>> = {
    product_analytics: [
      { manifestType: 'ProductInteraction', packetLabel: 'Product Interaction' },
      { manifestType: 'UserID', packetLabel: 'User ID' },
    ],
  };

  const events = Object.entries(ANALYTICS_EVENTS) as Array<[string, any]>;

  it('maps every registry purpose to declared, linked, non-tracking analytics data types', () => {
    for (const [name, def] of events) {
      const required = PURPOSE_DISCLOSURES[def.purpose];
      expect({ event: name, mapped: Boolean(required) }).toEqual({ event: name, mapped: true });
      for (const { manifestType, packetLabel } of required) {
        const declared = manifest.NSPrivacyCollectedDataTypes.find((t: any) => t.NSPrivacyCollectedDataType === `NSPrivacyCollectedDataType${manifestType}`);
        expect(declared).toBeDefined();
        expect(declared.NSPrivacyCollectedDataTypePurposes).toContain('NSPrivacyCollectedDataTypePurposeAnalytics');
        expect(declared.NSPrivacyCollectedDataTypeLinked).toBe(true);
        expect(declared.NSPrivacyCollectedDataTypeTracking).toBe(false);
        expect(packet).toContain(packetLabel);
      }
    }
  });

  it('keeps every event property bounded (enum, boolean or bounded integer — never free text)', () => {
    for (const [, def] of events) {
      for (const spec of Object.values(def.properties) as any[]) {
        expect(['enum', 'boolean', 'int']).toContain(spec.type);
        if (spec.type === 'enum') expect(spec.values.length).toBeGreaterThan(0);
        if (spec.type === 'int') expect(Number.isFinite(spec.min) && Number.isFinite(spec.max)).toBe(true);
      }
    }
  });
});
