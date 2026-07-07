/// <reference types="jest" />
/// <reference types="node" />

import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../../..');

describe('Phase 11 rollback pairing', () => {
  it('requires a release manifest and never uses bare Firebase Hosting rollback', () => {
    const source = fs.readFileSync(path.join(root, 'scripts/rollback.sh'), 'utf8');
    expect(source).toMatch(/--release-manifest is required/);
    expect(source).toContain('frontendArtifact');
    expect(source).not.toMatch(/hosting:rollback|firebase hosting:rollback/);
  });
});
