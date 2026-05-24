/**
 * Locks in the Android adaptive-icon configuration so future edits to
 * app.json or accidental asset deletions surface as test failures rather
 * than as a degraded launcher icon nobody notices until someone installs
 * the app on a Pixel.
 */
import fs from 'node:fs';
import path from 'node:path';

const workspaceRoot = path.resolve(__dirname, '..', '..');
const appJsonPath = path.join(workspaceRoot, 'app.json');

type AppJson = {
  expo?: {
    android?: {
      adaptiveIcon?: {
        foregroundImage?: string;
        backgroundColor?: string;
        monochromeImage?: string;
      };
    };
  };
};

const readPngDimensions = (filePath: string): { width: number; height: number } => {
  const buf = fs.readFileSync(filePath);
  // PNG IHDR: width at offset 16, height at offset 20, both big-endian uint32.
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
};

describe('Android adaptive icon configuration', () => {
  const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8')) as AppJson;
  const adaptive = appJson.expo?.android?.adaptiveIcon;

  it('declares an adaptiveIcon block', () => {
    expect(adaptive).toBeDefined();
  });

  it('uses the brand background color shared with the splash screen', () => {
    expect(adaptive?.backgroundColor).toBe('#0b3c79');
  });

  it('references foregroundImage and monochromeImage assets', () => {
    expect(typeof adaptive?.foregroundImage).toBe('string');
    expect(typeof adaptive?.monochromeImage).toBe('string');
  });

  const adaptiveAssets: Array<['foregroundImage' | 'monochromeImage', string | undefined]> = [
    ['foregroundImage', adaptive?.foregroundImage],
    ['monochromeImage', adaptive?.monochromeImage],
  ];

  it.each(adaptiveAssets)('%s asset exists on disk at 1024x1024', (_key, relative) => {
    expect(relative).toBeTruthy();
    if (!relative) return;
    const absolute = path.resolve(workspaceRoot, relative.replace(/^\.\//, ''));
    expect(fs.existsSync(absolute)).toBe(true);
    const { width, height } = readPngDimensions(absolute);
    expect(width).toBe(1024);
    expect(height).toBe(1024);
  });
});
