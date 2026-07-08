/// <reference types="jest" />
/// <reference types="node" />
import fs from 'fs';
import path from 'path';

describe('web branding assets', () => {
  const publicDir = path.resolve(__dirname, '../../dist');
  const appAssetsDir = path.resolve(__dirname, '../../app/assets');
  const hasWebExport = fs.existsSync(path.join(publicDir, 'index.html'));
  const webExportTest = hasWebExport ? test : test.skip;

  webExportTest('index.html uses WanderBunnies title and favicon links', () => {
    const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
    expect(html).toContain('<title>WanderBunnies</title>');
    expect(html).toContain('rel="icon"');
    expect(html).toContain('href="/favicon.ico"');
  });

  test('favicon and WanderBunnies image assets exist', () => {
    expect(fs.existsSync(path.join(appAssetsDir, 'wanderbunnies-app-icon.png'))).toBe(true);
    expect(fs.existsSync(path.join(appAssetsDir, 'wanderbunnies-splash-screen.png'))).toBe(true);
    if (hasWebExport) {
      expect(fs.existsSync(path.join(publicDir, 'favicon.ico'))).toBe(true);
    }
  });

  webExportTest('web export contains hashed WanderBunnies reference image asset', () => {
    const exportedAssetsDir = path.join(publicDir, 'assets', 'assets');
    expect(fs.existsSync(exportedAssetsDir)).toBe(true);
    const files = fs.readdirSync(exportedAssetsDir);
    const hasReferenceImage = files.some((name) => /^wanderbunnies-reference\..+\.png$/i.test(name));
    expect(hasReferenceImage).toBe(true);
  });
});
