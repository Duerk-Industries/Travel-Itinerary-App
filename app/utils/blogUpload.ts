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
export const SUPPORTED_AUDIO_MIME_TYPES = ['audio/mpeg', 'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/wav', 'audio/webm'];
export const SUPPORTED_MIME_TYPES = [...SUPPORTED_PHOTO_MIME_TYPES, ...SUPPORTED_VIDEO_MIME_TYPES];

export const isVideoMimeType = (mimeType?: string | null): boolean =>
  Boolean(mimeType) && SUPPORTED_VIDEO_MIME_TYPES.includes(String(mimeType));
export const isAudioMimeType = (mimeType?: string | null): boolean =>
  Boolean(mimeType) && SUPPORTED_AUDIO_MIME_TYPES.includes(String(mimeType));

export const guessMimeTypeFromName = (name?: string | null): string | null => {
  const lower = String(name ?? '').toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.mp4')) return 'video/mp4';
  if (lower.endsWith('.mov')) return 'video/quicktime';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.m4a')) return 'audio/m4a';
  if (lower.endsWith('.wav')) return 'audio/wav';
  return null;
};

export type PickedMediaFile = {
  blob: unknown;
  mimeType: string | null;
  size: number;
  name?: string;
  // Slice 1 of the photo-first composer (A2): capture time/location read from the file locally
  // (EXIF on web, expo-image-picker's exif output on native). Optional — an older client, a
  // screenshot, or a stripped image simply omits them and the asset's captured_at stays null.
  capturedAt?: string | null;
  capturedLat?: number | null;
  capturedLng?: number | null;
  // A local, displayable URI for a pre-upload thumbnail (blob: URL on web, file URI on native).
  // Never sent to the server; the composer revokes web blob URLs when it closes.
  previewUri?: string | null;
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
  const mediaKind = isAudioMimeType(pickedFile.mimeType) ? 'audio' : isVideoMimeType(pickedFile.mimeType) ? 'video' : 'photo';
  const idempotencyKey = createIdempotencyKey('up');
  // Guard against a NaN slipping through from EXIF parsing — JSON.stringify turns it into null
  // anyway, but be explicit.
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  let initRes: Response;
  try {
    initRes = await fetch(`${backendUrl}/api/trips/${tripId}/blog/media/upload-init`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      // Every field is coerced to a primitive here — the request body must never be able to
      // carry a non-serializable value (a stray press event, a Blob, etc.) into JSON.stringify.
      body: JSON.stringify({
        dayDate: typeof dayDate === 'string' ? dayDate : String(dayDate ?? ''),
        mediaKind,
        mimeType: pickedFile.mimeType == null ? null : String(pickedFile.mimeType),
        byteSize: Number.isFinite(Number(pickedFile.size)) ? Number(pickedFile.size) : 0,
        caption: caption == null ? null : String(caption),
        capturedAt: typeof pickedFile.capturedAt === 'string' ? pickedFile.capturedAt : null,
        capturedLat: num(pickedFile.capturedLat),
        capturedLng: num(pickedFile.capturedLng),
      }),
    });
  } catch (err) {
    return { outcome: 'error', error: `Could not start the upload (${(err as Error)?.name || 'error'}: ${(err as Error)?.message || 'request failed'}). Backend: ${backendUrl}` };
  }

  if (initRes.status === 413) return { outcome: 'quota_exceeded' };
  if (initRes.status === 402) return { outcome: 'entitlement_required' };
  if (!initRes.ok) {
    const body = await initRes.json().catch(() => ({}));
    return { outcome: 'error', error: body.error || 'Upload failed' };
  }
  const { asset, uploadUrl } = await initRes.json();

  if (uploadUrl) {
    // Real signed URL: upload the actual selected file's bytes directly to storage.
    try {
      const putRes = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': String(pickedFile.mimeType) }, body: pickedFile.blob as any });
      if (!putRes.ok) {
        return { outcome: 'error', error: `Storage rejected the ${mediaKind} (HTTP ${putRes.status}). The upload bucket may not allow this site — check its CORS config.` };
      }
    } catch (err) {
      // A thrown fetch here is almost always the browser blocking the cross-origin PUT (bucket
      // CORS) or a network failure — neither surfaces a status code.
      return { outcome: 'error', error: `Could not reach storage to upload the ${mediaKind} (${(err as Error)?.message || 'network/CORS error'}).` };
    }
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
  errors: string[];
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
  const errors: string[] = [];

  for (let index = 0; index < files.length; index += 1) {
    if (quotaBlocked) break;
    options.onProgress?.(index + 1, files.length);
    try {
      // A caption only ever applies to a lone shared item (see planShareUpload in
      // incomingShare.ts) — a multi-file batch never sets one here.
      const result = await uploadOneBlogFile(context, dayDate, files[index], files.length === 1 ? options.caption ?? null : null);
      if (result.outcome === 'quota_exceeded') { quotaBlocked = true; break; }
      if (result.outcome === 'entitlement_required') { entitlementSkipped += 1; continue; }
      if (result.outcome === 'error') { failed += 1; if (result.error) errors.push(result.error); continue; }
      succeeded += 1;
      if (result.asset) assets.push(result.asset);
    } catch (err) {
      failed += 1;
      errors.push((err as Error)?.message || String(err));
    }
  }

  return { succeeded, failed, entitlementSkipped, quotaBlocked, assets, errors };
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
