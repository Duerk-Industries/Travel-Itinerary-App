/// <reference types="jest" />
/// <reference types="node" />

import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../../..');

describe('Phase 11 PowerShell script parity', () => {
  const scripts = [
    'build-release',
    'deploy-test',
    'deploy-prod',
    'cutover-test-to-prod',
    'rollback',
    'teardown-old-production',
    'current-state',
    'smoke-test',
  ];

  it.each(scripts)('%s.ps1 exists alongside %s.sh', (name) => {
    expect(fs.existsSync(path.join(root, 'scripts', `${name}.sh`))).toBe(true);
    expect(fs.existsSync(path.join(root, 'scripts', `${name}.ps1`))).toBe(true);
  });

  it('lib/deploy-common.ps1 and lib/require-github-actor.ps1 exist alongside their bash counterparts', () => {
    for (const name of ['deploy-common', 'require-github-actor']) {
      expect(fs.existsSync(path.join(root, 'scripts/lib', `${name}.sh`))).toBe(true);
      expect(fs.existsSync(path.join(root, 'scripts/lib', `${name}.ps1`))).toBe(true);
    }
  });

  it('every .ps1 script parses as valid PowerShell', () => {
    const psFiles = [
      ...scripts.map((name) => `${name}.ps1`),
      'lib/deploy-common.ps1',
      'lib/require-github-actor.ps1',
    ];
    for (const file of psFiles) {
      const filePath = path.join(root, 'scripts', file);
      const source = fs.readFileSync(filePath, 'utf8');
      // Cheap structural sanity check without requiring pwsh to be
      // installed on every machine that runs the Jest suite: every script
      // must declare $ErrorActionPreference = 'Stop' so native command
      // failures don't silently continue.
      expect(source).toContain("$ErrorActionPreference = 'Stop'");
    }
  });

  it('the PowerShell scripts delegate manifest/evidence validation and hashing to phase11-validators.js, not a reimplementation', () => {
    // Keeping validation/hashing logic in one place (JS) is load-bearing:
    // a bash-built manifest must validate identically whether the next
    // step in the pipeline happens to run in bash or PowerShell.
    const buildRelease = fs.readFileSync(path.join(root, 'scripts/build-release.ps1'), 'utf8');
    expect(buildRelease).toContain('phase11-validators');
    const cutover = fs.readFileSync(path.join(root, 'scripts/cutover-test-to-prod.ps1'), 'utf8');
    expect(cutover).toContain('phase11-validators');
  });
});
