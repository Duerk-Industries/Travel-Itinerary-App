/**
 * @jest-environment node
 */
import fs from 'node:fs';
import path from 'node:path';

const workspaceRoot = path.resolve(__dirname, '..', '..');

describe('EAS config parity', () => {
  const rootEas = JSON.parse(fs.readFileSync(path.join(workspaceRoot, 'eas.json'), 'utf8'));
  const appEas = JSON.parse(fs.readFileSync(path.join(workspaceRoot, 'app', 'eas.json'), 'utf8'));

  it('keeps root and app EAS configs equivalent', () => {
    expect(appEas).toEqual(rootEas);
  });

  it('auto-increments native preview and production builds', () => {
    expect(rootEas.build?.preview?.autoIncrement).toBe(true);
    expect(rootEas.build?.production?.autoIncrement).toBe(true);
  });
});
