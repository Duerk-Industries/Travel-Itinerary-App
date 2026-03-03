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
});
