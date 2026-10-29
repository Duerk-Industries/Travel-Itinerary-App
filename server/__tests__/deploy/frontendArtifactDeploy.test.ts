/// <reference types="jest" />
/// <reference types="node" />

import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../../..');

describe('Phase 11 frontend artifact deployment', () => {
  it.each(['/public/blog/**', '/sitemap-trip-blogs.xml'])('routes %s to the backend before the SPA fallback in every hosting config', (sourcePath) => {
    const hosting = JSON.parse(fs.readFileSync(path.join(root, 'firebase.json'), 'utf8')).hosting;
    const index = hosting.rewrites.findIndex((rewrite: { source: string }) => rewrite.source === sourcePath);
    expect(index).toBeGreaterThanOrEqual(0);
    expect(index).toBeLessThan(hosting.rewrites.findIndex((rewrite: { source: string }) => rewrite.source === '**'));
    expect(hosting.rewrites[index].run).toEqual({ serviceId: 'travel-itinerary-app', region: 'us-east5' });
    for (const file of ['deploy-common.sh', 'deploy-common.ps1']) {
      const fileSource = fs.readFileSync(path.join(root, 'scripts/lib', file), 'utf8');
      const source = fileSource.slice(fileSource.indexOf('rewrites'));
      const rewrite = source.split('\n').find(line => line.includes(`source${file.endsWith('.ps1') ? ' =' : ':'} '${sourcePath}'`));
      expect(rewrite).toBeDefined();
      expect(rewrite).toContain('run');
      expect(rewrite).toContain('serviceId');
      expect(rewrite).toContain('region');
      expect(source.indexOf(rewrite!)).toBeLessThan(source.indexOf("source" + (file.endsWith('.ps1') ? ' =' : ':') + " '**'"));
    }
  });

  it.each(['deploy-test.sh', 'deploy-prod.sh', 'cutover-test-to-prod.sh', 'rollback.sh'])(
    '%s deploys the manifest-paired frontend artifact through a generated Firebase config',
    (script) => {
      const source = fs.readFileSync(path.join(root, 'scripts', script), 'utf8');
      expect(source).toContain('prepare_frontend_from_manifest');
      expect(source).toContain('write_hosting_config');
      if (source.includes('firebase deploy')) {
        expect(source).toContain('--config');
        expect(source).toContain('firebase.hosting.generated.json');
      }
    },
  );

  it('allows the on-device assistant to download its WebLLM model in every hosting CSP source', () => {
    const sources = [
      fs.readFileSync(path.join(root, 'firebase.json'), 'utf8'),
      fs.readFileSync(path.join(root, 'scripts/lib/deploy-common.sh'), 'utf8'),
      fs.readFileSync(path.join(root, 'scripts/lib/deploy-common.ps1'), 'utf8'),
    ];
    for (const source of sources) {
      // Model config/weights come from Hugging Face (weights redirect to its hf.co CDN); the
      // WebAssembly model library comes from raw.githubusercontent.com.
      expect(source).toMatch(/connect-src[^;]*https:\/\/huggingface\.co/);
      expect(source).toMatch(/connect-src[^;]*https:\/\/\*\.hf\.co/);
      expect(source).toMatch(/connect-src[^;]*https:\/\/raw\.githubusercontent\.com/);
    }
  });

  it('allows signed Google Cloud Storage uploads and media in every hosting CSP source', () => {
    const sources = [
      fs.readFileSync(path.join(root, 'firebase.json'), 'utf8'),
      fs.readFileSync(path.join(root, 'scripts/lib/deploy-common.sh'), 'utf8'),
      fs.readFileSync(path.join(root, 'scripts/lib/deploy-common.ps1'), 'utf8'),
    ];
    for (const source of sources) {
      expect(source).toMatch(/connect-src[^;]*https:\/\/storage\.googleapis\.com/);
      expect(source).toMatch(/media-src[^;]*https:\/\/storage\.googleapis\.com/);
    }
  });
});
