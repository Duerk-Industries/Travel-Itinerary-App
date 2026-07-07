/// <reference types="jest" />
/// <reference types="node" />

import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../../..');

describe('Phase 11 production authorization', () => {
  it('requires GitHub actor identity rather than gcloud identity', () => {
    const source = fs.readFileSync(path.join(root, 'scripts/lib/require-github-actor.sh'), 'utf8');
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
});
