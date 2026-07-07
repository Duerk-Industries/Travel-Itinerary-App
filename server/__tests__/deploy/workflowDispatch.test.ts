/// <reference types="jest" />
/// <reference types="node" />

import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../../..');

describe('Phase 11 workflow dispatch wiring', () => {
  const workflows = [
    ['production-deploy-test.yml', 'scripts/deploy-test.sh'],
    ['production-cutover.yml', 'scripts/cutover-test-to-prod.sh'],
    ['production-rollback.yml', 'scripts/rollback.sh'],
    ['production-teardown.yml', 'scripts/teardown-old-production.sh'],
    ['production-deploy-direct.yml', 'scripts/deploy-prod.sh'],
  ] as const;

  it.each(workflows)('%s is manually dispatchable and invokes %s', (workflow, script) => {
    const source = fs.readFileSync(path.join(root, '.github/workflows', workflow), 'utf8');
    expect(source).toMatch(/workflow_dispatch:/);
    expect(source).toContain(script);
  });

  it('production-affecting workflows use the production environment gate', () => {
    for (const workflow of ['production-cutover.yml', 'production-rollback.yml', 'production-teardown.yml', 'production-deploy-direct.yml']) {
      const source = fs.readFileSync(path.join(root, '.github/workflows', workflow), 'utf8');
      expect(source).toMatch(/environment:\s*production/);
    }
  });
});
