import fs from 'fs';
import path from 'path';

describe('web branding assets', () => {
  const publicDir = path.resolve(__dirname, '../public');

  test('index.html uses WanderBunnies title and favicon links', () => {
    const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
    expect(html).toContain('<title>WanderBunnies</title>');
    expect(html).toContain('href="/favicon.png"');
    expect(html).toContain('href="/assets/wanderbunnies-app-icon.png"');
    expect(html).toContain('href="/apple-touch-icon.png"');
  });

  test('favicon and apple touch icon files exist', () => {
    expect(fs.existsSync(path.join(publicDir, 'favicon.png'))).toBe(true);
    expect(fs.existsSync(path.join(publicDir, 'apple-touch-icon.png'))).toBe(true);
    expect(fs.existsSync(path.join(publicDir, 'assets', 'wanderbunnies-app-icon.png'))).toBe(true);
  });
});
