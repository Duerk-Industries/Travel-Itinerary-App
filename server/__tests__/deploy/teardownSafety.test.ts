/// <reference types="jest" />
/// <reference types="node" />

import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../../..');

describe('Phase 11 teardown safety', () => {
  it('requires typed confirmation and skips nonzero-traffic revisions', () => {
    const source = fs.readFileSync(path.join(root, 'scripts/teardown-old-production.sh'), 'utf8');
    expect(source).toContain('yes-delete');
    expect(source).toMatch(/traffic.*!= "0"/);
    expect(source).toContain('gcloud run revisions delete');
  });
});
