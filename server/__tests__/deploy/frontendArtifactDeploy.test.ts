/// <reference types="jest" />
/// <reference types="node" />

import fs from 'fs';
import path from 'path';

const root = path.resolve(__dirname, '../../..');

describe('Phase 11 frontend artifact deployment', () => {
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
