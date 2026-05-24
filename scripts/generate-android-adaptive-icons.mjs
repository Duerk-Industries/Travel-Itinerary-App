/**
 * Generates Android adaptive-icon assets from the existing app icon.
 *
 *   foreground: 1024x1024 transparent canvas, source scaled into the centered
 *               660x660 safe zone the Android launcher mask respects.
 *   monochrome: same geometry, flattened to a black-on-transparent silhouette
 *               derived from the source's luminance, so Android 13+ themed
 *               icons have a sensible default.
 *
 * Re-run with `npm run icons:android` after the source icon changes.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(REPO_ROOT, 'app', 'assets', 'wanderbunnies-app-icon.png');
const OUT_FOREGROUND = path.join(REPO_ROOT, 'app', 'assets', 'wanderbunnies-android-foreground.png');
const OUT_MONOCHROME = path.join(REPO_ROOT, 'app', 'assets', 'wanderbunnies-android-monochrome.png');

const CANVAS = 1024;
// Android masks the outer ring of the icon. The safe zone is the centered
// circle of diameter ~66% of the canvas. Using a 660x660 square keeps the
// source artwork comfortably inside that circle regardless of mask shape.
const SAFE_ZONE = 660;
const OFFSET = Math.floor((CANVAS - SAFE_ZONE) / 2);

const ensureSourceIsCorrectSize = async () => {
  const meta = await sharp(SOURCE).metadata();
  if (meta.width !== CANVAS || meta.height !== CANVAS) {
    throw new Error(
      `Expected source icon to be ${CANVAS}x${CANVAS}, got ${meta.width}x${meta.height}. Update SOURCE or resize the asset.`,
    );
  }
};

const buildForeground = async () => {
  // Source scaled down into the safe zone, then composited onto a fully
  // transparent canvas at the correct centered offset.
  const scaled = await sharp(SOURCE)
    .resize(SAFE_ZONE, SAFE_ZONE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: CANVAS,
      height: CANVAS,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: scaled, top: OFFSET, left: OFFSET }])
    .png()
    .toFile(OUT_FOREGROUND);
};

const buildMonochrome = async () => {
  // Convert the source to a single-channel luminance signal, invert it (so
  // dark artwork stays visible, light backgrounds drop out), threshold to
  // produce a clean silhouette, and use that as the alpha channel of a flat
  // black image. Result: black-on-transparent inside the safe zone.
  const silhouette = await sharp(SOURCE)
    .resize(SAFE_ZONE, SAFE_ZONE, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .grayscale()
    .negate({ alpha: false })
    .threshold(96)
    .toBuffer();

  const blackPlate = await sharp({
    create: {
      width: SAFE_ZONE,
      height: SAFE_ZONE,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  })
    .png()
    .toBuffer();

  const masked = await sharp(blackPlate)
    .joinChannel(silhouette)
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: CANVAS,
      height: CANVAS,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: masked, top: OFFSET, left: OFFSET }])
    .png()
    .toFile(OUT_MONOCHROME);
};

const main = async () => {
  await ensureSourceIsCorrectSize();
  await buildForeground();
  await buildMonochrome();
  console.log('Wrote:', path.relative(REPO_ROOT, OUT_FOREGROUND));
  console.log('Wrote:', path.relative(REPO_ROOT, OUT_MONOCHROME));
};

main().catch((err) => {
  console.error('Failed to generate adaptive icons:', err);
  process.exit(1);
});
