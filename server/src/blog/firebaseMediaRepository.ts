import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { ensureUserInTrip, ensureUserCanReadTrip } from '../db.firebase';
import { getUserTierKey } from '../services/entitlementService';
import { createBlogUploadUrl } from '../services/blogStorageClient';
import { getApiCacheSetting } from '../config/apiLimits';
import { BlogMediaAsset, BlogStorageSummary, BlogUploadInitInput, BlogUploadInitResult } from './mediaTypes';
import { getDb } from '../db.firebase';

const config = (() => { try { return JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../config/blog-storage-tiers.json'), 'utf8')); } catch { return { tiers: { free: { includedBytes: 2 * 1024 ** 3 } } }; } })();
const included = (tier: string) => Number(config.tiers?.[tier]?.includedBytes ?? config.tiers?.free?.includedBytes ?? 0);
const nowIso = () => new Date().toISOString();
const map = (data: any, id: string): BlogMediaAsset => ({ id, tripId: String(data.tripId), blogItemId: String(data.blogItemId), dayDate: String(data.dayDate), uploaderUserId: String(data.uploaderUserId), mediaKind: data.mediaKind, state: String(data.state), sourceMimeType: String(data.sourceMimeType ?? ''), physicalBytes: Number(data.physicalBytes ?? 0), billableBytes: Number(data.billableBytes ?? 0), capturedAt: data.capturedAt ?? null, capturedLat: data.capturedLat == null ? null : Number(data.capturedLat), capturedLng: data.capturedLng == null ? null : Number(data.capturedLng), caption: data.caption ?? null, altText: data.altText ?? null, createdAt: data.createdAt ?? undefined, isHighlight: Boolean(data.isHighlight), parentKindKey: data.parentKindKey ?? undefined, position: data.position != null ? Number(data.position) : undefined });

// Phase 5 — mirrors postgresMediaRepository.ts's isFiniteLat/isFiniteLng.
const isFiniteLat = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= -90 && value <= 90;
const isFiniteLng = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= -180 && value <= 180;

const ensureAccount = async (userId: string): Promise<any> => {
  const ref = getDb().collection('blog_storage_accounts').doc(userId);
  const snapshot = await ref.get();
  const tier = await getUserTierKey(userId);
  const targetIncluded = included(tier);

  if (!snapshot.exists) {
    const base = { userId, includedBytes: targetIncluded, purchasedBytes: 0, reservedBytes: 0, visibleCommittedBytes: 0, graceHiddenBytes: 0, entitlementActive: true, graceStartedAt: null, updatedAt: nowIso() };
    await ref.set(base);
    return base;
  }

  const data: any = snapshot.data() ?? {};
  if (process.env.NODE_ENV !== 'test' && data.includedBytes !== targetIncluded) {
    await ref.set({ includedBytes: targetIncluded, updatedAt: nowIso() }, { merge: true });
    return { ...data, includedBytes: targetIncluded };
  }
  return data;
};

export const getStorageSummary = async (userId: string): Promise<BlogStorageSummary> => {
  const data = await ensureAccount(userId);
  const limit = Number(data.includedBytes ?? 0) + Number(data.purchasedBytes ?? 0);
  return { userId, includedBytes: Number(data.includedBytes ?? 0), purchasedBytes: Number(data.purchasedBytes ?? 0), reservedBytes: Number(data.reservedBytes ?? 0), visibleCommittedBytes: Number(data.visibleCommittedBytes ?? 0), graceHiddenBytes: Number(data.graceHiddenBytes ?? 0), availableBytes: Math.max(0, limit - Number(data.visibleCommittedBytes ?? 0) - Number(data.reservedBytes ?? 0)), entitlementActive: data.entitlementActive !== false, graceStartedAt: data.graceStartedAt ?? null };
};

export const initUpload = async (userId: string, input: BlogUploadInitInput): Promise<BlogUploadInitResult> => {
  if (!(await ensureUserInTrip(input.tripId, userId))) throw new Error('Not authorized to edit this trip');
  const allowed = input.mediaKind === 'photo' ? ['image/jpeg', 'image/png'] : ['video/mp4', 'video/quicktime', 'video/webm'];
  if (!allowed.includes(input.mimeType.toLowerCase())) throw new Error('Unsupported media type');
  const max = input.mediaKind === 'photo' ? 20 * 1024 * 1024 : 1024 * 1024 * 1024;
  if (!Number.isSafeInteger(input.byteSize) || input.byteSize <= 0 || input.byteSize > max) throw new Error('Media exceeds the configured size limit');
  const db = getDb();

  // When joining an existing gallery, the gallery item's own day is authoritative — a stale or
  // mismatched client-supplied dayDate must not be able to desync an asset from its gallery.
  let galleryDayDate: string | null = null;
  let galleryAssetCount = 0;
  if (input.galleryItemId) {
    const gallerySnap = await db.collection('blog_items').doc(input.galleryItemId).get();
    const galleryData = gallerySnap.exists ? (gallerySnap.data() as any) : null;
    if (!galleryData || String(galleryData.tripId) !== input.tripId || galleryData.deletedAt != null || galleryData.kindKey !== 'core.gallery') {
      throw new Error('A valid galleryItemId is required to add photos to a gallery');
    }
    const memberSnap = await db.collection('blog_media_assets').where('blogItemId', '==', input.galleryItemId).get();
    galleryAssetCount = memberSnap.docs.filter((doc) => String((doc.data() as any).state) !== 'deleted').length;
    const maxAssets = getApiCacheSetting('tripBlog', 'maxAssetsPerGallery') ?? 30;
    if (galleryAssetCount >= maxAssets) throw new Error('Gallery exceeds the maximum number of photos allowed');
    galleryDayDate = String(galleryData.localDate);
  }

  const summary = await getStorageSummary(userId);
  if (!summary.entitlementActive || input.byteSize > summary.availableBytes) throw new Error('QUOTA_EXCEEDED');
  const existing = await db.collection('blog_media_assets').where('sourceRef', '==', input.idempotencyKey).where('uploaderUserId', '==', userId).limit(1).get();
  if (!existing.empty) {
    const doc = existing.docs[0];
    const existingData = doc.data() as any;
    const existingObjectKey = String(existingData.objectKey ?? '');
    const stillUploading = ['uploading', 'quarantined'].includes(String(existingData.state));
    const retryUploadUrl = stillUploading ? await createBlogUploadUrl(existingObjectKey, String(existingData.sourceMimeType ?? '')) : null;
    return { asset: map(existingData, doc.id), uploadUrl: retryUploadUrl, objectKey: existingObjectKey, expiresAt: new Date(Date.now() + 900_000).toISOString(), storageMode: retryUploadUrl ? 'gcs' : 'managed' };
  }
  const assetId = randomUUID();
  const blogItemId = input.galleryItemId ?? randomUUID();
  const dayDate = galleryDayDate ?? input.dayDate;
  const objectKey = `trip-blog/${userId}/${assetId}/source`;
  const parentKindKey = input.galleryItemId ? 'core.gallery' : (input.mediaKind === 'photo' ? 'media.photo' : 'media.video');
  const position = input.galleryItemId ? galleryAssetCount : 0;
  const blogDoc = await db.collection('trip_blogs').doc(input.tripId).get();
  const locationEnabled = blogDoc.exists && (blogDoc.data() as any)?.photoLocationEnabled === true;
  const capturedLat = locationEnabled && isFiniteLat(input.capturedLat) ? input.capturedLat : null;
  const capturedLng = locationEnabled && isFiniteLng(input.capturedLng) ? input.capturedLng : null;
  const data = { tripId: input.tripId, blogItemId, dayDate, uploaderUserId: userId, storageAccountUserId: userId, mediaKind: input.mediaKind, state: 'uploading', sourceMimeType: input.mimeType.toLowerCase(), physicalBytes: input.byteSize, billableBytes: input.byteSize, capturedAt: input.capturedAt ?? null, capturedLat, capturedLng, caption: input.caption ?? null, altText: input.altText ?? null, objectKey, sourceRef: input.idempotencyKey, isHighlight: false, parentKindKey, position, createdAt: nowIso(), updatedAt: nowIso() };
  await db.collection('blog_media_assets').doc(assetId).set(data);
  if (!input.galleryItemId) {
    await db.collection('blog_items').doc(blogItemId).set({ tripId: input.tripId, blogDayId: input.dayDate, localDate: input.dayDate, kindKey: parentKindKey, schemaVersion: 1, audience: 'public', sortKey: `${Date.now()}-${blogItemId}`, authorUserId: userId, lastEditorUserId: userId, version: 1, deletedAt: null, createdAt: nowIso(), updatedAt: nowIso() });
  }
  const accountRef = db.collection('blog_storage_accounts').doc(userId);
  await db.runTransaction(async (tx) => { const current = (await tx.get(accountRef)).data() as any; const available = Number(current?.includedBytes ?? 0) + Number(current?.purchasedBytes ?? 0) - Number(current?.visibleCommittedBytes ?? 0) - Number(current?.reservedBytes ?? 0); if (available < input.byteSize) throw new Error('QUOTA_EXCEEDED'); tx.set(accountRef, { reservedBytes: Number(current?.reservedBytes ?? 0) + input.byteSize, updatedAt: nowIso() }, { merge: true }); });
  const uploadUrl = await createBlogUploadUrl(objectKey, input.mimeType.toLowerCase());
  return { asset: map(data, assetId), uploadUrl, objectKey, expiresAt: new Date(Date.now() + 900_000).toISOString(), storageMode: uploadUrl ? 'gcs' : 'managed' };
};

export const completeUpload = async (userId: string, assetId: string, physicalBytes: number, checksum?: string): Promise<BlogMediaAsset> => {
  if (!Number.isSafeInteger(physicalBytes) || physicalBytes <= 0) throw new Error('Uploaded bytes do not match the reservation');

  const db = getDb();
  const assetRef = db.collection('blog_media_assets').doc(assetId);
  const accountRef = db.collection('blog_storage_accounts').doc(userId);
  await ensureAccount(userId);

  const result = await db.runTransaction(async (tx) => {
    const assetSnap = await tx.get(assetRef);
    if (!assetSnap.exists) throw new Error('Media upload not found');
    const asset = assetSnap.data() as any;
    if (asset.uploaderUserId !== userId) throw new Error('Not authorized');
    if (!['uploading', 'quarantined'].includes(String(asset.state))) throw new Error('Media upload not found');

    const accountSnap = await tx.get(accountRef);
    const account = accountSnap.data() as any;
    const reservedBytes = Number(asset.physicalBytes);
    const additionalBytes = Math.max(0, physicalBytes - reservedBytes);
    const availableBytes = Math.max(0, Number(account?.includedBytes ?? 0)
      + Number(account?.purchasedBytes ?? 0)
      - Number(account?.visibleCommittedBytes ?? 0)
      - Number(account?.reservedBytes ?? 0));
    if (additionalBytes > availableBytes) throw new Error('QUOTA_EXCEEDED');

    tx.set(assetRef, { state: 'ready', physicalBytes, billableBytes: physicalBytes, checksum: checksum ?? null, updatedAt: nowIso() }, { merge: true });
    tx.set(accountRef, {
      reservedBytes: Math.max(0, Number(account?.reservedBytes ?? 0) - reservedBytes),
      visibleCommittedBytes: Number(account?.visibleCommittedBytes ?? 0) + physicalBytes,
      updatedAt: nowIso()
    }, { merge: true });

    return { ...asset, state: 'ready', physicalBytes, billableBytes: physicalBytes };
  });

  return map(result, assetId);
};

// Internal worker lookup only — see postgresMediaRepository.getAssetForProcessing for why this exists.
export const getAssetForProcessing = async (assetId: string): Promise<{ id: string; uploaderUserId: string; mediaKind: string; objectKey: string } | null> => {
  const snap = await getDb().collection('blog_media_assets').doc(assetId).get();
  if (!snap.exists) return null;
  const data = snap.data() as any;
  return { id: assetId, uploaderUserId: String(data.uploaderUserId), mediaKind: String(data.mediaKind), objectKey: String(data.objectKey ?? '') };
};

export const listMedia = async (userId: string, tripId: string): Promise<BlogMediaAsset[]> => {
  if (!(await ensureUserCanReadTrip(tripId, userId))) throw new Error('Not authorized to view this trip');
  const db = getDb();
  const snap = await db.collection('blog_media_assets').where('tripId', '==', tripId).get();
  const assets = snap.docs.map((doc) => map(doc.data(), doc.id)).filter((asset) => asset.state !== 'deleted');
  // Exclude assets whose underlying blog_items row was soft-deleted (e.g. via "Remove" in the UI)
  // — without this check a "deleted" photo/video reappears on the next load, since deleting only
  // ever touches blog_items, not blog_media_assets.
  const itemIds = Array.from(new Set(assets.map((asset) => asset.blogItemId).filter(Boolean)));
  const deletedItemIds = new Set<string>();
  await Promise.all(itemIds.map(async (itemId) => {
    const itemSnap = await db.collection('blog_items').doc(itemId).get();
    if (itemSnap.exists && (itemSnap.data() as any)?.deletedAt != null) deletedItemIds.add(itemId);
  }));
  return assets.filter((asset) => !deletedItemIds.has(asset.blogItemId));
};
// Removes a single asset from a gallery (not for standalone media.photo/media.video items — those
// are removed whole via DELETE /blog/items/:itemId). If it was the last asset in its gallery, the
// now-empty gallery item is soft-deleted too so it doesn't linger as an invisible post.
export const deleteMediaAsset = async (userId: string, assetId: string): Promise<{ deleted: boolean }> => {
  const db = getDb();
  const assetRef = db.collection('blog_media_assets').doc(assetId);
  const assetSnap = await assetRef.get();
  if (!assetSnap.exists) return { deleted: false };
  const asset = assetSnap.data() as any;
  if (String(asset.state) === 'deleted') return { deleted: false };
  const itemRef = db.collection('blog_items').doc(String(asset.blogItemId));
  const itemSnap = await itemRef.get();
  const item = itemSnap.exists ? (itemSnap.data() as any) : null;
  if (!item || item.deletedAt != null) return { deleted: false };
  if (item.kindKey !== 'core.gallery') throw new Error('This asset must be part of a gallery to remove individually; use DELETE /blog/items/:itemId for standalone photos or videos instead');
  if (!(await ensureUserInTrip(String(asset.tripId), userId))) throw new Error('Not authorized to edit this trip');

  const accountRef = db.collection('blog_storage_accounts').doc(String(asset.storageAccountUserId));
  const bytesField = asset.state === 'ready' ? 'visibleCommittedBytes' : asset.state === 'grace_hidden' ? 'graceHiddenBytes' : 'reservedBytes';
  await db.runTransaction(async (tx) => {
    const accountSnap = await tx.get(accountRef);
    const account = accountSnap.data() as any;
    tx.set(accountRef, { [bytesField]: Math.max(0, Number(account?.[bytesField] ?? 0) - Number(asset.billableBytes ?? 0)), updatedAt: nowIso() }, { merge: true });
    tx.set(assetRef, { state: 'deleted', updatedAt: nowIso() }, { merge: true });
  });

  const remainingSnap = await db.collection('blog_media_assets').where('blogItemId', '==', asset.blogItemId).get();
  const remaining = remainingSnap.docs.filter((doc) => String((doc.data() as any).state) !== 'deleted').length;
  if (remaining === 0) {
    await itemRef.set({ deletedAt: nowIso(), version: Number(item.version ?? 1) + 1, lastEditorUserId: userId, updatedAt: nowIso() }, { merge: true });
  }
  return { deleted: true };
};

export const setHighlight = async (userId: string, itemId: string, highlighted: boolean): Promise<void> => { const snap = await getDb().collection('blog_items').doc(itemId).get(); if (!snap.exists) throw new Error('Blog item not found'); const row = snap.data() as any; if (!(await ensureUserInTrip(String(row.tripId), userId))) throw new Error('Not authorized'); const assets = await getDb().collection('blog_media_assets').where('blogItemId', '==', itemId).get(); await Promise.all(assets.docs.map((doc) => doc.ref.set({ isHighlight: highlighted, updatedAt: nowIso() }, { merge: true }))); };
export const hideExpiredMediaForUser = async (userId: string, inactiveAt = new Date()): Promise<number> => {
  const summary = await getStorageSummary(userId);
  const limit = summary.includedBytes + summary.purchasedBytes;
  let hidden = 0;
  let currentVisible = summary.visibleCommittedBytes;
  const db = getDb();

  while (currentVisible > limit) {
    const snap = await db.collection('blog_media_assets')
      .where('storageAccountUserId', '==', userId)
      .where('state', '==', 'ready')
      .orderBy('createdAt', 'asc')
      .limit(1)
      .get();

    if (snap.empty) break;
    const doc = snap.docs[0];
    const asset = doc.data();
    const billableBytes = Number(asset.billableBytes ?? 0);

    const deleteAfter = new Date(inactiveAt.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await doc.ref.set({
      state: 'grace_hidden',
      hiddenAt: inactiveAt.toISOString(),
      deleteAfter,
      updatedAt: nowIso()
    }, { merge: true });

    const accountRef = db.collection('blog_storage_accounts').doc(userId);
    await accountRef.set({
      visibleCommittedBytes: Math.max(0, currentVisible - billableBytes),
      graceHiddenBytes: Number((await accountRef.get()).data()?.graceHiddenBytes ?? 0) + billableBytes,
      graceStartedAt: summary.graceStartedAt || inactiveAt.toISOString(),
      updatedAt: nowIso()
    }, { merge: true });

    currentVisible -= billableBytes;
    hidden += 1;
  }
  return hidden;
};
export const listGraceMedia = async (userId: string): Promise<BlogMediaAsset[]> => {
  const snap = await getDb().collection('blog_media_assets').where('uploaderUserId', '==', userId).where('state', '==', 'grace_hidden').get();
  return snap.docs.map((doc) => map(doc.data(), doc.id));
};

export const updatePurchasedStorage = async (userId: string, purchasedBytes: number): Promise<void> => {
  await getDb().collection('blog_storage_accounts').doc(userId).set({
    purchasedBytes,
    updatedAt: nowIso()
  }, { merge: true });
};

export const listStorageAccountUserIds = async (): Promise<string[]> => {
  const snap = await getDb().collection('blog_storage_accounts').get();
  return snap.docs.map((doc) => doc.id);
};

export const setIncludedStorage = async (userId: string, includedBytes: number): Promise<void> => {
  await getDb().collection('blog_storage_accounts').doc(userId).set({
    includedBytes,
    updatedAt: nowIso()
  }, { merge: true });
};
