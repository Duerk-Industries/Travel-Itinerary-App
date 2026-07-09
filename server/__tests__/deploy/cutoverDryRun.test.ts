/// <reference types="jest" />
/// <reference types="node" />

import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../../..');

describe('Phase 11 cutover dry-run behavior', () => {
  it('keeps live test infrastructure checks out of the bash dry-run path', () => {
    const source = fs.readFileSync(path.join(root, 'scripts/cutover-test-to-prod.sh'), 'utf8');
    expect(source).toContain('LIVE_TEST_IMAGE="$(live_service_image "$TEST_SERVICE_NAME" "$TEST_REGION")"');
    expect(source).toMatch(/if \[\[ "\$DRY_RUN" != "1" \]\]; then\s+LIVE_TEST_IMAGE=/);
  });

  it('keeps live test infrastructure checks out of the PowerShell dry-run path', () => {
    const source = fs.readFileSync(path.join(root, 'scripts/cutover-test-to-prod.ps1'), 'utf8');
    expect(source).toContain('$liveTestImage = Get-LiveServiceImage -Service $env:TEST_SERVICE_NAME -Region $env:TEST_REGION');
    expect(source).toMatch(/if \(-not \$DryRun\) \{\s+\$liveTestImage = Get-LiveServiceImage/);
  });
});

