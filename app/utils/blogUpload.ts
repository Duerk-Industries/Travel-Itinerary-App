// Shared trip-blog media upload plumbing — used by both the in-tab "+ Photo/Video" button
// (app/tabs/tripBlog.tsx) and the native "send to WanderBunnies" share-intent flow
// (app/utils/incomingShare.ts / app/components/IncomingShareModal.tsx), so upload/init/complete
// logic, mime-type support, and outcome handling live in exactly one place.
import { createIdempotencyKey } from './idempotencyKey';

// Mirrors the server's accepted mime types (server/src/blog/postgresMediaRepository.ts /
// firebaseMediaRepository.ts `allowedMime` lists) so an obviously-unsupported file is filtered out
// client-side before an upload attempt, rather than only after a round trip to the server.
export const SUPPORTED_PHOTO_MIME_TYPES = ['image/jpeg', 'image/png'];
export const SUPPORTED_VIDEO_MIME_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];
export const SUPPORTED_MIME_TYPES = [...SUPPORTED_PHOTO_MIME_TYPES, ...SUPPORTED_VIDEO_MIME_TYPES];

export const isVideoMimeType = (mimeType?: string | null): boolean =>
  Boolean(mimeType) && SUPPORTED_VIDEO_MIME_TYPES.includes(String(mimeType));

export const guessMimeTypeFromName = (name?: string | null): string | null => {
  const lower = String(name ?? '').toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.mp4')) return 'video/mp4';
  if (lower.endsWith('.mov')) return 'video/quicktime';
  if (lower.endsWith('.webm')) return 'video/webm';
  return null;
};

export type PickedMediaFile = {
  blob: unknown;
  mimeType: string | null;
  size: number;
  name?: string;
};

export type UploadOutcome = 'ok' | 'quota_exceeded' | 'entitlement_required' | 'error';

export type UploadOneFileResult = {
  outcome: UploadOutcome;
  asset?: any;
  error?: string;
};

type BlogUploadContext = {
  backendUrl: string;
  headers: Record<string, string>;
  tripId: string;
};

// Uploads a single picked file to a trip day, optionally with a caption (used by the share-intent
// "single item + message" case — see incomingShare.ts). Returns a typed outcome rather than
// throwing for the two well-known non-fatal cases (over quota / video needs Premium) so a caller
// driving a batch can decide whether to stop (quota) or just skip-and-continue (entitlement).
export const uploadOneBlogFile = async (
  { backendUrl, headers, tripId }: BlogUploadContext,
  dayDate: string,
  pickedFile: PickedMediaFile,
  caption?: string | null
): Promise<UploadOneFileResult> => {
  const mediaKind = isVideoMimeType(pickedFile.mimeType) ? 'video' : 'photo';
  const idempotencyKey = createIdempotencyKey('up');
  const initRes = await fetch(`${backendUrl}/api/trips/${tripId}/blog/media/upload-init`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ dayDate, mediaKind, mimeType: pickedFile.mimeType, byteSize: pickedFile.size, caption: caption ?? null }),
  });

  if (initRes.status === 413) return { outcome: 'quota_exceeded' };
  if (initRes.status === 402) return { outcome: 'entitlement_required' };
  if (!initRes.ok) {
    const body = await initRes.json().catch(() => ({}));
    return { outcome: 'error', error: body.error || 'Upload failed' };
  }
  const { asset, uploadUrl } = await initRes.json();

  if (uploadUrl) {
    // Real signed URL: upload the actual selected file's bytes directly to storage.
    const putRes = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': String(pickedFile.mimeType) }, body: pickedFile.blob as any });
    if (!putRes.ok) return { outcome: 'error', error: `Failed to upload the ${mediaKind} to storage` };
  }

  const completeRes = await fetch(`${backendUrl}/api/trips/${tripId}/blog/media/${asset.id}/complete`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ physicalBytes: pickedFile.size }),
  });
  if (completeRes.status === 413) return { outcome: 'quota_exceeded' };
  if (!completeRes.ok) {
    const body = await completeRes.json().catch(() => ({}));
    return { outcome: 'error', error: body.error || 'Failed to finalize upload' };
  }
  return { outcome: 'ok', asset };
};

export type UploadBatchResult = {
  succeeded: number;
  failed: number;
  entitlementSkipped: number;
  quotaBlocked: boolean;
  assets: any[];
};

// Uploads a batch of files sequentially (matches the existing in-tab upload behavior), stopping
// early only on quota-exceeded — an entitlement skip (e.g. video without Premium) or a generic
// failure just gets tallied and the batch continues with the remaining files.
export const uploadBlogFiles = async (
  context: BlogUploadContext,
  dayDate: string,
  files: PickedMediaFile[],
  options: { caption?: string | null; onProgress?: (current: number, total: number) => void } = {}
): Promise<UploadBatchResult> => {
  let succeeded = 0;
  let failed = 0;
  let entitlementSkipped = 0;
  let quotaBlocked = false;
  const assets: any[] = [];

  for (let index = 0; index < files.length; index += 1) {
    if (quotaBlocked) break;
    options.onProgress?.(index + 1, files.length);
    try {
      // A caption only ever applies to a lone shared item (see planShareUpload in
      // incomingShare.ts) — a multi-file batch never sets one here.
      const result = await uploadOneBlogFile(context, dayDate, files[index], files.length === 1 ? options.caption ?? null : null);
      if (result.outcome === 'quota_exceeded') { quotaBlocked = true; break; }
      if (result.outcome === 'entitlement_required') { entitlementSkipped += 1; continue; }
      if (result.outcome === 'error') { failed += 1; continue; }
      succeeded += 1;
      if (result.asset) assets.push(result.asset);
    } catch {
      failed += 1;
    }
  }

  return { succeeded, failed, entitlementSkipped, quotaBlocked, assets };
};

// The existing "+ Add note" mechanism (POST core.text) reused as-is for a share's "general message
// for the day" — see incomingShare.ts's planShareUpload for when this applies (multiple shared
// items + a message).
export const createDayTextItem = async (
  { backendUrl, headers, tripId }: BlogUploadContext,
  dayDate: string,
  body: string
): Promise<any> => {
  const response = await fetch(`${backendUrl}/api/trips/${tripId}/blog/items`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ kindKey: 'core.text', dayDate, body }),
  });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Unable to add blog item');
  return response.json();
};
