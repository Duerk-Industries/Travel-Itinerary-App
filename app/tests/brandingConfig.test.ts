/**
 * @jest-environment node
 */

import config from '../app.config';

describe('WanderBunnies branding config', () => {
  test('uses WanderBunnies visible app name', () => {
    expect(config.name).toBe('WanderBunnies');
  });

  test('sets app icon and splash assets', () => {
    expect(config.icon).toBe('./assets/wanderbunnies-app-icon.png');
    expect(config.splash?.image).toBe('./assets/wanderbunnies-splash-screen.png');
  });

  test('sets web favicon from app icon asset', () => {
    expect(config.web?.favicon).toBe('./assets/wanderbunnies-app-icon.png');
  });

  test('sets native app identifiers and version fields for EAS builds', () => {
    expect(config.ios?.bundleIdentifier).toBe('com.duerkindustries.travelitineraryplanner');
    expect(config.ios?.buildNumber).toBe('1');
    expect(config.android?.package).toBe('com.duerkindustries.travelitineraryplanner');
    expect(config.android?.versionCode).toBe(1);
  });

  test('sets Android adaptive icon assets in dynamic config', () => {
    expect(config.android?.adaptiveIcon?.foregroundImage).toBe('./assets/wanderbunnies-android-foreground.png');
    expect(config.android?.adaptiveIcon?.backgroundColor).toBe('#0b3c79');
    expect(config.android?.adaptiveIcon?.monochromeImage).toBe('./assets/wanderbunnies-android-monochrome.png');
  });
});
