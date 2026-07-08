/// <reference types="jest" />
/// <reference types="node" />

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

const root = path.resolve(__dirname, '../../..');

describe('Phase 11 rollback pairing', () => {
  it('requires a release manifest and never uses bare Firebase Hosting rollback', () => {
    const source = fs.readFileSync(path.join(root, 'scripts/rollback.sh'), 'utf8');
    expect(source).toMatch(/--release-manifest is required/);
    expect(source).toContain('prepare_frontend_from_manifest');
    expect(source).toContain('firebase.hosting.generated.json');
    expect(source).not.toMatch(/hosting:rollback|firebase hosting:rollback/);
  });

  it('refuses to roll back when --revision is running an image that does not match --release-manifest, via a mocked gcloud', () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rollback-pairing-'));

    const manifest = {
      gitSha: 'abc1234',
      backendImageDigest: 'us-east5-docker.pkg.dev/proj/repo/backend:abc1234@sha256:' + 'a'.repeat(64),
      frontendArtifact: path.join(workDir, 'frontend.tgz'),
      frontendSha256: 'b'.repeat(64),
      firestoreIndexesSha256: 'c'.repeat(64),
      configFingerprint: 'd'.repeat(64),
      builtAt: new Date().toISOString(),
      builderRunId: 'local-test',
    };
    const manifestPath = path.join(workDir, 'release-manifest-abc1234.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    // The live revision is running a *different* digest than the manifest.
    const fakeGcloud = `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1 $2" == "run revisions" && "$3" == "describe" ]]; then
  echo "us-east5-docker.pkg.dev/proj/repo/backend:zzz9999@sha256:${'f'.repeat(64)}"
  exit 0
fi
echo "unhandled fake gcloud invocation (rollback should have refused before reaching this): $*" >&2
exit 1
`;
    const fakeGcloudPath = path.join(workDir, 'gcloud');
    fs.writeFileSync(fakeGcloudPath, fakeGcloud, { mode: 0o755 });

    const deployConfig = [
      'PROD_SERVICE_NAME=svc',
      'PROD_REGION=us-east5',
      'PROD_HOSTING_SITE=svc-hosting',
      'PROD_DOMAIN=https://prod.example.com',
    ].join('\n');
    const deployConfigPath = path.join(workDir, 'deploy.config');
    fs.writeFileSync(deployConfigPath, deployConfig);

    let error: any;
    try {
      execFileSync(
        'bash',
        [path.join(root, 'scripts/rollback.sh'), '--release-manifest', manifestPath, '--revision', 'svc-00042-mismatched'],
        {
          env: {
            ...process.env,
            PATH: `${workDir}${path.delimiter}${process.env.PATH}`,
            DEPLOY_CONFIG_FILE: deployConfigPath,
            GITHUB_ACTOR: 'Bryan',
          },
          cwd: root,
          stdio: 'pipe',
        },
      );
    } catch (err) {
      error = err;
    }
    expect(error).toBeDefined();
    expect(String(error.stderr)).toMatch(/Rollback refused/);
  });
});
