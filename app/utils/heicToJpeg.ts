// iPhone camera-roll photos are HEIC (some Android phones save HEIF). The blog only stores
// JPEG/PNG, since most browsers can't display HEIC, so convert those on the device before upload.
// Used by the share-sheet flow (incomingShare.ts) and as a fallback for the in-app picker.

export const isHeicMimeType = (mimeType?: string | null, name?: string | null): boolean => {
  const mime = String(mimeType ?? '').toLowerCase();
  if (mime === 'image/heic' || mime === 'image/heif' || mime === 'image/heic-sequence' || mime === 'image/heif-sequence') return true;
  return /\.(heic|heif)$/i.test(String(name ?? ''));
};

export const toJpegName = (name?: string | null): string =>
  String(name || 'photo').replace(/\.(heic|heif)$/i, '') + '.jpg';

/**
 * Re-encodes a local image file as JPEG and returns the new file's URI, or null if conversion
 * isn't possible here (web, or the native module isn't in this build).
 */
export const convertImageToJpeg = async (uri: string): Promise<string | null> => {
  let manipulator: typeof import('expo-image-manipulator');
  try {
    // Required lazily: it's a native module, absent on web and in Jest.
    manipulator = require('expo-image-manipulator');
  } catch {
    return null;
  }
  if (!manipulator?.ImageManipulator?.manipulate) return null;
  const rendered = await manipulator.ImageManipulator.manipulate(uri).renderAsync();
  const saved = await rendered.saveAsync({ format: manipulator.SaveFormat.JPEG, compress: 0.9 });
  return saved.uri;
};
