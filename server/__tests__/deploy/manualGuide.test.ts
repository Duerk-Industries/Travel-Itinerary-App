/// <reference types="jest" />
/// <reference types="node" />

import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../../..');

describe('Phase 11 manual deployment guide', () => {
  const guide = fs.readFileSync(path.join(root, 'docs/production-deployment-guide.md'), 'utf8');

  it('documents deploy-to-test, promote-to-production, and direct-production commands', () => {
    for (const script of [
      'scripts/deploy-test.sh',
      'scripts/cutover-test-to-prod.sh',
      'scripts/deploy-prod.sh',
      'scripts/rollback.sh',
      'scripts/teardown-old-production.sh',
      'scripts/current-state.sh',
    ]) {
      expect(guide).toContain(script);
    }
  });

  it('documents the workflow-dispatch operator path', () => {
    expect(guide).toContain('Production Path - Deploy Test');
    expect(guide).toContain('Production Path - Cutover');
    expect(guide).toContain('Production Path - Direct Deploy');
  });
});
