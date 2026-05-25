/**
 * @jest-environment node
 */
import fs from 'node:fs';
import path from 'node:path';

const workspaceRoot = path.resolve(__dirname, '..', '..');
const appJsonPath = path.join(workspaceRoot, 'app.json');

describe('static app.json native config', () => {
  const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
  const appPackage = JSON.parse(fs.readFileSync(path.join(workspaceRoot, 'app', 'package.json'), 'utf8'));
  const expo = appJson.expo;

  it('declares the store-facing app version', () => {
    expect(expo.version).toBe(appPackage.version);
  });

  it('does not disable React Native New Architecture', () => {
    expect(expo.newArchEnabled).not.toBe(false);
  });

  it('does not ship a blanket iOS ATS arbitrary-loads exception', () => {
    const ats = expo.ios?.infoPlist?.NSAppTransportSecurity;
    expect(ats?.NSAllowsArbitraryLoads).toBeUndefined();
    expect(ats?.NSExceptionDomains?.localhost?.NSExceptionAllowsInsecureHTTPLoads).toBe(true);
  });

  it('declares automatic userInterfaceStyle so the OS dark-mode setting is respected', () => {
    expect(expo.userInterfaceStyle).toBe('automatic');
  });

  it('opts in to Android edge-to-edge for SDK 54 / Android 15 readiness', () => {
    expect(expo.android?.edgeToEdgeEnabled).toBe(true);
  });

  it('keeps the Android soft keyboard in pan mode', () => {
    expect(expo.android?.softwareKeyboardLayoutMode).toBe('pan');
  });
});
