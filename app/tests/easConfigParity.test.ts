/**
 * @jest-environment node
 *
 * app/eas.json is the single source of truth for EAS build profiles — both CI
 * pipelines run `cd app && eas …`. This test locks in the build-profile
 * invariants that matter for store submissions.
 */
/// <reference types="jest" />
/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';

describe('EAS build config', () => {
  const appEas = JSON.parse(
    fs.readFileSync(path.join(path.resolve(__dirname, '..'), 'eas.json'), 'utf8'),
  );

  it('uses remote app version source so store build numbers auto-increment server-side', () => {
    expect(appEas.cli?.appVersionSource).toBe('remote');
  });

  it('auto-increments native preview and production builds', () => {
    expect(appEas.build?.preview?.autoIncrement).toBe(true);
    expect(appEas.build?.production?.autoIncrement).toBe(true);
  });

  it('points preview and production at the hosted backend', () => {
    expect(appEas.build?.preview?.env?.EXPO_PUBLIC_BACKEND_URL).toBe('https://wander-bunnies.com');
    expect(appEas.build?.production?.env?.EXPO_PUBLIC_BACKEND_URL).toBe('https://wander-bunnies.com');
  });
});
