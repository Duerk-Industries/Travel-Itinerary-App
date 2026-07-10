/// <reference types="jest" />
/// <reference types="node" />

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { shellQuote, toBashPath } from './bashPath';

const root = path.resolve(__dirname, '../../..');
const guardPath = path.join(root, 'scripts/lib/require-github-actor.sh');
const guardBashPath = toBashPath(guardPath);

const runGuard = (actor: string | undefined, dryRun = '0'): { code: number; stderr: string } => {
  try {
    const actorExport = actor === undefined ? 'unset GITHUB_ACTOR' : `export GITHUB_ACTOR=${shellQuote(actor)}`;
    execFileSync(
      'bash',
      ['-lc', `${actorExport}; source ${shellQuote(guardBashPath)} && require_github_actor ${shellQuote(dryRun)}`],
      { stdio: 'pipe' },
    );
    return { code: 0, stderr: '' };
  } catch (err: any) {
    return { code: err.status ?? 1, stderr: String(err.stderr ?? '') };
  }
};

describe('Phase 11 production authorization', () => {
  it('requires GitHub actor identity rather than gcloud identity', () => {
    const source = fs.readFileSync(guardPath, 'utf8');
    expect(source).toContain('GITHUB_ACTOR');
    expect(source).not.toMatch(/gcloud auth list/);
  });

  it.each(['deploy-prod.sh', 'cutover-test-to-prod.sh', 'rollback.sh', 'teardown-old-production.sh'])(
    '%s sources the GitHub actor guard',
    (script) => {
      const source = fs.readFileSync(path.join(root, 'scripts', script), 'utf8');
      expect(source).toContain('require-github-actor.sh');
      expect(source).toContain('require_github_actor');
    },
  );

  it.each(['Bryan', 'bryan', 'Tristan', 'tristan'])('allows authorized actor %s', (actor) => {
    expect(runGuard(actor).code).toBe(0);
  });

  it.each(['duerk-industries', 'bduerk', 'random-contributor', 'Bryan2'])(
    'rejects unauthorized actor %s (regression test for an over-wide allowlist)',
    (actor) => {
      const result = runGuard(actor);
      expect(result.code).not.toBe(0);
      expect(result.stderr).toMatch(/not authorized/);
    },
  );

  it('rejects a missing GITHUB_ACTOR', () => {
    const result = runGuard(undefined);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/GITHUB_ACTOR is required/);
  });

  it('does not enforce authorization for --dry-run, even with no actor', () => {
    expect(runGuard(undefined, '1').code).toBe(0);
  });
});
