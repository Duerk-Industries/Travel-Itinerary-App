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

  it('deploys the API from its Node 20 Dockerfile without unsupported runtime flags', () => {
    const workflow = fs.readFileSync(path.join(root, '.github/workflows/deploy-api.yml'), 'utf8');
    const dockerfile = fs.readFileSync(path.join(root, 'server/Dockerfile'), 'utf8');

    expect(workflow).toContain('gcloud run deploy travel-itinerary-app');
    expect(workflow).toContain('--source .');
    expect(workflow).toContain('--session-affinity');
    expect(workflow).toContain('--max-instances 1');
    expect(workflow).toContain('--to-latest');
    expect(workflow).not.toContain('--runtime');
    expect(dockerfile).toMatch(/^FROM node:20-/m);
  });
});
