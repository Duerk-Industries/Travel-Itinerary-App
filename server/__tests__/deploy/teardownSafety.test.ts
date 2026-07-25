/// <reference types="jest" />
/// <reference types="node" />

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { shellQuote, toBashPath } from './bashPath';

const root = path.resolve(__dirname, '../../..');

describe('Phase 11 teardown safety', () => {
  it('requires typed confirmation and skips nonzero-traffic revisions', () => {
    const source = fs.readFileSync(path.join(root, 'scripts/teardown-old-production.sh'), 'utf8');
    expect(source).toContain('yes-delete');
    expect(source).toContain('CONFIRM="${2%$\'\\r\'}"');
    expect(source).toMatch(/traffic.*!= "0"/);
    expect(source).toContain('gcloud run revisions delete');
  });

  it('only deletes revisions that are both 0%-traffic AND older than ROLLBACK_RETENTION_DAYS, via a mocked gcloud', () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'teardown-safety-'));
    const deletedLog = path.join(workDir, 'deleted.log');
    fs.writeFileSync(deletedLog, '');

    const now = Date.now();
    const oldTimestamp = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days old
    const youngTimestamp = new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString(); // 1 day old

    const serviceDescribeJson = JSON.stringify({
      status: {
        traffic: [
          { revisionName: 'svc-00003-current', percent: 100 },
          { revisionName: 'svc-00002-old-zero-traffic', percent: 0 },
          { revisionName: 'svc-00001-young-zero-traffic', percent: 0 },
        ],
      },
    });

    // metadata.name<TAB>lastTransitionTime, one row per revision.
    const revisionsListOutput = [
      `svc-00003-current\t${youngTimestamp}`,
      `svc-00002-old-zero-traffic\t${oldTimestamp}`,
      `svc-00001-young-zero-traffic\t${youngTimestamp}`,
    ].join('\n');

    // A fake `gcloud` on PATH: dispatches on the subcommand so the real
    // teardown-old-production.sh can run unmodified against canned
    // service/revision state instead of real GCP infrastructure.
    const fakeGcloud = `#!/usr/bin/env bash
set -euo pipefail
if [[ "$1 $2" == "run services" && "$3" == "describe" ]]; then
  cat <<'JSON'
${serviceDescribeJson}
JSON
  exit 0
fi
if [[ "$1 $2" == "run revisions" && "$3" == "list" ]]; then
  cat <<'REVISIONS'
${revisionsListOutput}
REVISIONS
  exit 0
fi
if [[ "$1 $2" == "run revisions" && "$3" == "delete" ]]; then
  echo "$4" >> "${toBashPath(deletedLog)}"
  exit 0
fi
echo "unhandled fake gcloud invocation: $*" >&2
exit 1
`;
    const fakeGcloudPath = path.join(workDir, 'gcloud');
    fs.writeFileSync(fakeGcloudPath, fakeGcloud, { mode: 0o755 });

    const deployConfig = [
      'PROD_SERVICE_NAME=svc',
      'PROD_REGION=us-east5',
      'PROD_DOMAIN=https://prod.example.com',
      'ROLLBACK_RETENTION_DAYS=7',
    ].join('\n');
    const deployConfigPath = path.join(workDir, 'deploy.config');
    fs.writeFileSync(deployConfigPath, deployConfig);

    execFileSync('bash', [
      '-lc',
      [
        // Prepend workDir (the fake gcloud) rather than replacing $PATH
        // outright, so real tools this script also shells out to (node,
        // etc.) stay resolvable.
        `export PATH=${shellQuote(toBashPath(workDir))}":$PATH"`,
        `export DEPLOY_CONFIG_FILE=${shellQuote(toBashPath(deployConfigPath))}`,
        'export GITHUB_ACTOR=Bryan',
        `bash ${shellQuote(toBashPath(path.join(root, 'scripts/teardown-old-production.sh')))} --confirm yes-delete`,
      ].join('; '),
    ], {
      cwd: root,
      stdio: 'pipe',
    });

    const deleted = fs.readFileSync(deletedLog, 'utf8').trim().split('\n').filter(Boolean);
    expect(deleted).toEqual(['svc-00002-old-zero-traffic']);
    expect(deleted).not.toContain('svc-00003-current'); // nonzero traffic
    expect(deleted).not.toContain('svc-00001-young-zero-traffic'); // within retention window
  });
});
