// "Send to WanderBunnies" — receiving photos/videos shared from the phone's native share sheet
// (Photos app, Files, etc.), the same way a traveler might "share to" a messaging app. The native
// receiving side (iOS Share Extension / Android SEND intent-filters) is wired up via the
// expo-share-intent config plugin in expo.config.shared.cjs; this module holds the pure,
// unit-testable decision logic plus the file-normalization step, kept separate from
// app/components/IncomingShareModal.tsx (which owns the actual hook call / UI).
import { useShareIntent } from 'expo-share-intent';
import { guessMimeTypeFromName, isVideoMimeType, type PickedMediaFile } from './blogUpload';

export { useShareIntent };

export type ShareUploadPlan = {
  captionForSingleItem: string | null;
  dayMessage: string | null;
};

// If a single photo/video is shared with a message, that message becomes the item's caption.
// If multiple items are shared with a message, it becomes a general message for the day instead
// (posted as a normal core.text blog item via createDayTextItem in blogUpload.ts — the same
// mechanism the in-app "+ Add note" button already uses). No message means neither happens.
export const planShareUpload = (itemCount: number, message?: string | null): ShareUploadPlan => {
  const trimmed = String(message ?? '').trim();
  if (!trimmed || itemCount === 0) return { captionForSingleItem: null, dayMessage: null };
  if (itemCount === 1) return { captionForSingleItem: trimmed, dayMessage: null };
  return { captionForSingleItem: null, dayMessage: trimmed };
};

export type ShareIntentFileLike = {
  path: string;
  mimeType?: string | null;
  fileName?: string | null;
  size?: number | null;
};

// Normalizes expo-share-intent's file shape ({ path, mimeType, fileName, size, ... }) into the
// same { blob, mimeType, size, name } shape app/utils/blogUpload.ts's upload functions already
// expect from the in-app picker, so the upload plumbing itself never needs to know which entry
// point (picker vs. share) produced a file. A file that fails to read (revoked permission, the
// share extension's temp copy already cleaned up, etc.) is dropped rather than failing the whole
// batch — the caller reports how many files it started with vs. how many were actually usable.
export const normalizeShareIntentFiles = async (files: ShareIntentFileLike[]): Promise<PickedMediaFile[]> => {
  const results = await Promise.all(files.map(async (file): Promise<PickedMediaFile | null> => {
    const mimeType = file.mimeType || guessMimeTypeFromName(file.fileName);
    try {
      const response = await fetch(file.path);
      const blob = await response.blob();
      return { blob, mimeType, size: file.size ?? blob.size, name: file.fileName ?? (isVideoMimeType(mimeType) ? 'video' : 'photo') };
    } catch {
      return null;
    }
  }));
  return results.filter((file): file is PickedMediaFile => file != null);
};
