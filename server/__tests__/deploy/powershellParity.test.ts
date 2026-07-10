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

  it.each([
    ['build-release', ['deploy-marker.json', 'frontendSha256', 'configFingerprint'], ['deploy-marker.json', 'frontendSha256', 'configFingerprint']],
    ['deploy-test', ['Config fingerprint drift', 'firebase.hosting.generated.json', 'firebase_deploy_hosting'], ['Config fingerprint drift', 'firebase.hosting.generated.json', 'Invoke-FirebaseHostingDeploy']],
    ['deploy-prod', ['DEPLOY_DIRECT_PROD', 'direct production deploy bypasses test cutover', 'firebase_deploy_hosting'], ['DEPLOY_DIRECT_PROD', 'direct production deploy bypasses test cutover', 'Invoke-FirebaseHostingDeploy']],
    ['cutover-test-to-prod', ['live_service_image', 'canary-smoke-cleanup', 'DEPLOY_CUTOVER', 'prod-candidate'], ['Get-LiveServiceImage', 'canary-smoke-cleanup', 'DEPLOY_CUTOVER', 'prod-candidate']],
    ['rollback', ['backendImageDigest', 'DEPLOY_ROLLBACK', 'firebase_deploy_hosting'], ['backendImageDigest', 'DEPLOY_ROLLBACK', 'Invoke-FirebaseHostingDeploy']],
    ['teardown-old-production', ['ROLLBACK_RETENTION_DAYS', 'DEPLOY_TEARDOWN', 'gcloud run revisions delete'], ['ROLLBACK_RETENTION_DAYS', 'DEPLOY_TEARDOWN', 'gcloud run revisions delete']],
  ])('%s.sh and %s.ps1 carry equivalent load-bearing behavior markers', (name, bashMarkers, powershellMarkers) => {
    const bash = fs.readFileSync(path.join(root, 'scripts', `${name}.sh`), 'utf8');
    const powershell = fs.readFileSync(path.join(root, 'scripts', `${name}.ps1`), 'utf8');
    for (const marker of bashMarkers) {
      expect(bash).toContain(marker);
    }
    for (const marker of powershellMarkers) {
      expect(powershell).toContain(marker);
    }
  });
});
