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

  it('does not ship a blanket iOS ATS arbitrary-loads exception', () => {
    const ats = expo.ios?.infoPlist?.NSAppTransportSecurity;
    expect(ats?.NSAllowsArbitraryLoads).toBeUndefined();
    expect(ats?.NSExceptionDomains?.localhost?.NSExceptionAllowsInsecureHTTPLoads).toBe(true);
  });
});
