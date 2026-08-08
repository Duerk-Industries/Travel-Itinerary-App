import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { ensureUserInTrip, ensureUserCanReadTrip } from '../db';
import { queryBlog } from '../db.postgres';
import { getUserTierKey } from '../services/entitlementService';
import { createBlogUploadUrl } from '../services/blogStorageClient';
import { BlogMediaAsset, BlogStorageSummary, BlogUploadInitInput, BlogUploadInitResult } from './mediaTypes';

const tierConfig = (() => {
  try { return JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../config/blog-storage-tiers.json'), 'utf8')); } catch { return { tiers: { free: { includedBytes: 2 * 1024 ** 3 } } }; }
})();

const includedForTier = (tier: string): number => Number(tierConfig.tiers?.[tier]?.includedBytes ?? tierConfig.tiers?.free?.includedBytes ?? 0);
const dateString = (value: unknown): string => new Date(String(value)).toISOString().slice(0, 10);
const mapSummary = (row: any): BlogStorageSummary => {
  const includedBytes = Number(row.included_bytes ?? 0);
  const purchasedBytes = Number(row.purchased_bytes ?? 0);
  const reservedBytes = Number(row.reserved_bytes ?? 0);
  const visibleCommittedBytes = Number(row.visible_committed_bytes ?? 0);
  return { userId: String(row.user_id), includedBytes, purchasedBytes, reservedBytes, visibleCommittedBytes, graceHiddenBytes: Number(row.grace_hidden_bytes ?? 0), availableBytes: Math.max(0, includedBytes + purchasedBytes - visibleCommittedBytes - reservedBytes), entitlementActive: Boolean(row.entitlement_active), graceStartedAt: row.grace_started_at ? new Date(row.grace_started_at).toISOString() : null };
};

export const getStorageSummary = async (userId: string): Promise<BlogStorageSummary> => {
  const tier = await getUserTierKey(userId);
  const targetIncluded = includedForTier(tier);
  await queryBlog(
    `INSERT INTO blog_storage_accounts (user_id, included_bytes) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET
       included_bytes = CASE WHEN $3 = 'test' THEN blog_storage_accounts.included_bytes ELSE EXCLUDED.included_bytes END,
       updated_at = NOW()`,
    [userId, targetIncluded, process.env.NODE_ENV]
  );
  const row = await queryBlog<any>('SELECT * FROM blog_storage_accounts WHERE user_id = $1', [userId]);
  return mapSummary(row.rows[0]);
};

export const updatePurchasedStorage = async (userId: string, purchasedBytes: number): Promise<void> => {
  await queryBlog(
    `INSERT INTO blog_storage_accounts (user_id, purchased_bytes) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET purchased_bytes = EXCLUDED.purchased_bytes, updated_at = NOW()`,
    [userId, purchasedBytes]
  );
};

export const setIncludedStorage = async (userId: string, includedBytes: number): Promise<void> => {
  await queryBlog(
    `INSERT INTO blog_storage_accounts (user_id, included_bytes) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET included_bytes = EXCLUDED.included_bytes, updated_at = NOW()`,
    [userId, includedBytes]
  );
};

const mapAsset = (row: any): BlogMediaAsset => ({ id: String(row.id), tripId: String(row.trip_id), blogItemId: String(row.blog_item_id ?? ''), dayDate: dateString(row.local_date), uploaderUserId: String(row.uploader_user_id), mediaKind: row.media_kind_key, state: String(row.state), sourceMimeType: String(row.source_mime_type ?? ''), physicalBytes: Number(row.physical_bytes ?? 0), billableBytes: Number(row.billable_bytes ?? 0), capturedAt: row.captured_at ? new Date(row.captured_at).toISOString() : null, caption: row.caption ?? null, altText: row.alt_text ?? null, createdAt: row.created_at ? new Date(row.created_at).toISOString() : undefined, isHighlight: Boolean(row.is_highlight) });

const ensureMediaDays = async (tripId: string): Promise<void> => {
  const trip = await queryBlog<{ start_date: string | null; end_date: string | null }>('SELECT start_date, end_date FROM trips WHERE id = $1 LIMIT 1', [tripId]);
  if (!trip.rows[0]) throw new Error('Trip not found');
  const start = trip.rows[0].start_date ? dateString(trip.rows[0].start_date) : dateString(new Date());
  const end = trip.rows[0].end_date ? dateString(trip.rows[0].end_date) : start;
  for (let cursor = new Date(`${start}T00:00:00.000Z`); cursor <= new Date(`${end}T00:00:00.000Z`); cursor = new Date(cursor.getTime() + 86_400_000)) {
    await queryBlog('INSERT INTO blog_days (id, trip_id, local_date) VALUES ($1, $2, $3::date) ON CONFLICT (trip_id, local_date) DO NOTHING', [randomUUID(), tripId, cursor.toISOString().slice(0, 10)]);
  }
};

export const initUpload = async (userId: string, input: BlogUploadInitInput): Promise<BlogUploadInitResult> => {
  const access = await ensureUserInTrip(input.tripId, userId);
  if (!access) throw new Error('Not authorized to edit this trip');
  const existing = await queryBlog<any>('SELECT * FROM blog_media_assets WHERE source_ref = $1 AND uploader_user_id = $2 LIMIT 1', [input.idempotencyKey, userId]);
  if (existing.rows[0]) {
    const existingObjectKey = String(existing.rows[0].object_key ?? '');
    const stillUploading = ['uploading', 'quarantined'].includes(String(existing.rows[0].state));
    const retryUploadUrl = stillUploading ? await createBlogUploadUrl(existingObjectKey, String(existing.rows[0].source_mime_type ?? '')) : null;
    return { asset: mapAsset(existing.rows[0]), uploadUrl: retryUploadUrl, objectKey: existingObjectKey, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), storageMode: retryUploadUrl ? 'gcs' : 'managed' };
  }
  const allowedMime = input.mediaKind === 'photo' ? ['image/jpeg', 'image/png'] : ['video/mp4', 'video/quicktime', 'video/webm'];
  if (!allowedMime.includes(input.mimeType.toLowerCase())) throw new Error('Unsupported media type');
  const maxBytes = input.mediaKind === 'photo' ? 20 * 1024 * 1024 : 1024 * 1024 * 1024;
  if (!Number.isSafeInteger(input.byteSize) || input.byteSize <= 0 || input.byteSize > maxBytes) throw new Error('Media exceeds the configured size limit');
  const summary = await getStorageSummary(userId);
  if (!summary.entitlementActive || input.byteSize > summary.availableBytes) throw new Error('QUOTA_EXCEEDED');
  const assetId = randomUUID();
  const blogItemId = randomUUID();
  await ensureMediaDays(input.tripId);
  const dayRows = await queryBlog<{ id: string; local_date: string }>('SELECT id, local_date FROM blog_days WHERE trip_id = $1 ORDER BY local_date ASC', [input.tripId]);
  const day = dayRows.rows.find((row) => dateString(row.local_date) === input.dayDate);
  if (!day) throw new Error('The selected day is outside the trip range');
  const objectKey = `trip-blog/${userId}/${assetId}/source`;
  const reservation = await queryBlog<any>(
    `UPDATE blog_storage_accounts SET reserved_bytes = reserved_bytes + $2, updated_at = NOW()
     WHERE user_id = $1 AND entitlement_active = TRUE AND included_bytes + purchased_bytes - visible_committed_bytes - reserved_bytes >= $2
     RETURNING *`,
    [userId, input.byteSize]
  );
  if (!reservation.rows[0]) throw new Error('QUOTA_EXCEEDED');
  await queryBlog(
    `INSERT INTO blog_storage_reservations (id, user_id, idempotency_key, reserved_bytes, state, expires_at)
     VALUES ($1, $2, $3, $4, 'reserved', NOW() + INTERVAL '15 minutes')`,
    [randomUUID(), userId, input.idempotencyKey, input.byteSize]
  );
  await queryBlog(
    `INSERT INTO blog_items (id, trip_id, blog_day_id, kind_key, schema_version, audience, sort_key, author_user_id, last_editor_user_id)
     VALUES ($1, $2, $3, $4, 1, 'public', $5, $6, $6)`,
    [blogItemId, input.tripId, day.id, input.mediaKind === 'photo' ? 'media.photo' : 'media.video', `${Date.now().toString().padStart(16, '0')}-${blogItemId}`, userId]
  );
  await queryBlog(
    `INSERT INTO blog_media_assets (id, trip_id, uploader_user_id, storage_account_user_id, media_kind_key, state, physical_bytes, billable_bytes, source_mime_type, captured_at, caption, alt_text, source_ref, object_key, created_at, updated_at)
     VALUES ($1, $2, $3, $3, $4, 'uploading', $5, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())`,
    [assetId, input.tripId, userId, input.mediaKind, input.byteSize, input.mimeType.toLowerCase(), input.capturedAt ?? null, input.caption ?? null, input.altText ?? null, input.idempotencyKey, objectKey]
  );
  await queryBlog('INSERT INTO blog_item_assets (item_id, asset_id, position, role) VALUES ($1, $2, 0, \'primary\')', [blogItemId, assetId]);
  const row = await queryBlog<any>(
    `SELECT a.*, i.id AS blog_item_id, d.local_date, FALSE AS is_highlight
     FROM blog_media_assets a JOIN blog_item_assets ia ON ia.asset_id = a.id JOIN blog_items i ON i.id = ia.item_id JOIN blog_days d ON d.id = i.blog_day_id WHERE a.id = $1`,
    [assetId]
  );
  const uploadUrl = await createBlogUploadUrl(objectKey, input.mimeType.toLowerCase());
  return {
    asset: mapAsset(row.rows[0]),
    uploadUrl,
    objectKey,
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    // 'gcs' when a real signed PUT URL was issued (client uploads real bytes there); 'managed'
    // only as a fallback when signing fails (e.g. no GCS credentials in this environment), in
    // which case the client-reported byte count is trusted at /complete instead.
    storageMode: uploadUrl ? 'gcs' : 'managed',
  };
};

export const completeUpload = async (userId: string, assetId: string, physicalBytes: number, checksum?: string): Promise<BlogMediaAsset> => {
  const current = await queryBlog<any>('SELECT * FROM blog_media_assets WHERE id = $1 AND uploader_user_id = $2 AND state IN (\'uploading\', \'quarantined\')', [assetId, userId]);
  if (!current.rows[0]) throw new Error('Media upload not found');
  const row = current.rows[0];
  if (!Number.isSafeInteger(physicalBytes) || physicalBytes <= 0 || physicalBytes > Number(row.physical_bytes)) throw new Error('Uploaded bytes do not match the reservation');
  await queryBlog('UPDATE blog_media_assets SET state = \'ready\', physical_bytes = $2, billable_bytes = $2, source_checksum = $3, updated_at = NOW() WHERE id = $1', [assetId, physicalBytes, checksum ?? null]);
  await queryBlog('UPDATE blog_storage_accounts SET reserved_bytes = GREATEST(0, reserved_bytes - $2), visible_committed_bytes = visible_committed_bytes + $2, updated_at = NOW() WHERE user_id = $1', [userId, Number(row.physical_bytes)]);
  await queryBlog('UPDATE blog_storage_reservations SET state = \'committed\' WHERE user_id = $1 AND idempotency_key = $2', [userId, row.source_ref]);
  const updated = await queryBlog<any>(
    `SELECT a.*, i.id AS blog_item_id, d.local_date, FALSE AS is_highlight
     FROM blog_media_assets a JOIN blog_item_assets ia ON ia.asset_id = a.id JOIN blog_items i ON i.id = ia.item_id JOIN blog_days d ON d.id = i.blog_day_id WHERE a.id = $1`,
    [assetId]
  );
  return mapAsset(updated.rows[0]);
};

// Internal worker lookup only (called from internalBlogWorkerRoutes.ts, which is already gated by a
// shared-secret check) — the media processing pipeline needs to know mediaKind to pick the
// image (sharp) vs video (ffmpeg) branch instead of assuming every upload is a photo.
export const getAssetForProcessing = async (assetId: string): Promise<{ id: string; uploaderUserId: string; mediaKind: string; objectKey: string } | null> => {
  const row = await queryBlog<any>('SELECT id, uploader_user_id, media_kind_key, object_key FROM blog_media_assets WHERE id = $1', [assetId]);
  if (!row.rows[0]) return null;
  return { id: String(row.rows[0].id), uploaderUserId: String(row.rows[0].uploader_user_id), mediaKind: String(row.rows[0].media_kind_key), objectKey: String(row.rows[0].object_key ?? '') };
};

export const listMedia = async (userId: string, tripId: string): Promise<BlogMediaAsset[]> => {
  const access = await ensureUserCanReadTrip(tripId, userId);
  if (!access) throw new Error('Not authorized to view this trip');
  const rows = await queryBlog<any>(
    `SELECT a.*, i.id AS blog_item_id, d.local_date, FALSE AS is_highlight
     FROM blog_media_assets a JOIN blog_item_assets ia ON ia.asset_id = a.id JOIN blog_items i ON i.id = ia.item_id JOIN blog_days d ON d.id = i.blog_day_id
     WHERE a.trip_id = $1 AND a.state <> 'deleted' AND i.deleted_at IS NULL ORDER BY d.local_date ASC, i.sort_key ASC`,
    [tripId]
  );
  return rows.rows.map(mapAsset);
};

export const setHighlight = async (userId: string, itemId: string, highlighted: boolean): Promise<void> => {
  const item = await queryBlog<{ trip_id: string }>('SELECT trip_id FROM blog_items WHERE id = $1 AND deleted_at IS NULL', [itemId]);
  if (!item.rows[0]) throw new Error('Blog item not found');
  const access = await ensureUserInTrip(item.rows[0].trip_id, userId);
  if (!access) throw new Error('Not authorized to edit this trip');
  if (highlighted) await queryBlog('INSERT INTO blog_item_highlights (item_id, starred_by_user_id) VALUES ($1, $2) ON CONFLICT (item_id) DO UPDATE SET starred_by_user_id = EXCLUDED.starred_by_user_id', [itemId, userId]);
  else await queryBlog('DELETE FROM blog_item_highlights WHERE item_id = $1', [itemId]);
};

export const hideExpiredMediaForUser = async (userId: string, inactiveAt = new Date()): Promise<number> => {
  const summary = await getStorageSummary(userId);
  const limit = summary.includedBytes + summary.purchasedBytes;
  let hidden = 0;
  while (summary.visibleCommittedBytes > limit) {
    const oldest = await queryBlog<any>(`SELECT id, billable_bytes FROM blog_media_assets WHERE storage_account_user_id = $1 AND state = 'ready' ORDER BY created_at ASC LIMIT 1`, [userId]);
    if (!oldest.rows[0]) break;
    await queryBlog(`UPDATE blog_media_assets SET state = 'grace_hidden', hidden_at = $2, delete_after = $2::timestamptz + INTERVAL '30 days', updated_at = NOW() WHERE id = $1`, [oldest.rows[0].id, inactiveAt]);
    await queryBlog(`UPDATE blog_storage_accounts SET visible_committed_bytes = GREATEST(0, visible_committed_bytes - $2), grace_hidden_bytes = grace_hidden_bytes + $2, grace_started_at = COALESCE(grace_started_at, $3), updated_at = NOW() WHERE user_id = $1`, [userId, oldest.rows[0].billable_bytes, inactiveAt]);
    summary.visibleCommittedBytes -= Number(oldest.rows[0].billable_bytes);
    hidden += 1;
  }
  return hidden;
};

export const listGraceMedia = async (userId: string): Promise<BlogMediaAsset[]> => {
  const rows = await queryBlog<any>(
    `SELECT a.*, i.id AS blog_item_id, d.local_date, FALSE AS is_highlight
     FROM blog_media_assets a JOIN blog_item_assets ia ON ia.asset_id = a.id JOIN blog_items i ON i.id = ia.item_id JOIN blog_days d ON d.id = i.blog_day_id
     WHERE a.storage_account_user_id = $1 AND a.state = 'grace_hidden' ORDER BY a.hidden_at ASC`,
    [userId]
  );
  return rows.rows.map(mapAsset);
};

export const listStorageAccountUserIds = async (): Promise<string[]> => {
  const rows = await queryBlog<{ user_id: string }>('SELECT user_id FROM blog_storage_accounts');
  return rows.rows.map((r) => String(r.user_id));
};
