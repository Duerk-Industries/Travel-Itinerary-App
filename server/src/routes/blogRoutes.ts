import { Router } from 'express';
import { authenticate } from '../auth';
import { isFeatureEnabled } from '../services/entitlementService';
import { getApiLimitsConfig } from '../config/apiLimits';
import { getBlogItemDescriptor, listBlogItemDescriptors } from '../blog/registry';
import { blogMediaRepository, blogRepository } from '../blog/repository';
import { blogEngagementRepository } from '../blog/engagementRepository';
import { BlogAudience } from '../blog/types';
import { ensureUserInTrip, ensureUserCanReadTrip, getCurrentDbProvider } from '../db';
import { assertCanUseFeature, getUserTierKey } from '../services/entitlementService';
import { reserveApiUsageOrThrow } from '../apis/usageLimiter';
import { validateVideoEnvelope } from '../services/blogVideoProcessingService';
import { processMediaUpload } from '../services/blogMediaProcessingService';
import { objectExists, createBlogReadUrl, blogRenditionKey } from '../services/blogStorageClient';
import { queryBlog } from '../db.postgres';
import { getCanonicalPublicPathFirebase } from '../blog/firebasePublicationRepository';
import { logError } from '../logger';

const router = Router();
router.use(authenticate);

const tripBlogLimits = (): Record<string, any> => {
  try {
    return (getApiLimitsConfig() as any)?.caching?.tripBlog ?? {};
  } catch {
    return {};
  }
};

const userIdOf = (req: any): string => String(req.user?.userId ?? '');
const validAudience = (value: unknown): value is BlogAudience => value === 'travelers' || value === 'followers' || value === 'public';
// Signed read URLs are short-lived and specific to a rendition object, so they're computed at
// response time rather than stored — only ready assets have anything to render.
const attachMediaUrls = async (assets: any[]): Promise<any[]> => Promise.all(assets.map(async (asset) => {
  if (asset.state !== 'ready') return asset;
  if (asset.mediaKind === 'video') {
    const primaryUrl = await createBlogReadUrl(blogRenditionKey(asset.uploaderUserId, asset.assetId ?? asset.id, 'primary.mp4'));
    return { ...asset, primaryUrl };
  }
  const [primaryUrl, thumbnailUrl] = await Promise.all([
    createBlogReadUrl(blogRenditionKey(asset.uploaderUserId, asset.assetId ?? asset.id, 'primary.jpg')),
    createBlogReadUrl(blogRenditionKey(asset.uploaderUserId, asset.assetId ?? asset.id, 'thumb.jpg')),
  ]);
  return { ...asset, primaryUrl, thumbnailUrl };
}));

const errorResponse = (res: any, err: any): void => {
  const message = String(err?.message ?? 'Unable to process blog request');
  if (process.env.NODE_ENV !== 'production') console.error('[blog] request failed', message);
  if (/not authorized/i.test(message)) res.status(403).json({ error: message });
  else if (/outside|too large|must be|required|unsupported|exceeds|bytes do not match/i.test(message)) res.status(400).json({ error: message });
  else res.status(500).json({ error: message });
};

router.get('/:tripId/blog/capabilities', async (req, res) => {
  try {
    const master = await isFeatureEnabled('trip_blog');
    const descriptors = listBlogItemDescriptors();
    const kinds = await Promise.all(descriptors.map(async (descriptor) => ({ ...descriptor, enabled: master && await isFeatureEnabled(descriptor.featureFlag) })));
    const limits = tripBlogLimits();
    const writable = Boolean(await ensureUserInTrip(req.params.tripId, userIdOf(req)));
    res.json({ enabled: master, writable, kinds, limits: { maxTextBlocksPerDay: Number(limits.maxTextBlocksPerDay ?? 10), maxMediaItemsPerDay: Number(limits.maxMediaItemsPerDay ?? 50), videoMaxDurationSeconds: Number(limits.videoMaxDurationSeconds ?? 300), maxAssetsPerGallery: Number(limits.maxAssetsPerGallery ?? 30) } });
  } catch (err) {
    errorResponse(res, err);
  }
});

router.get('/:tripId/blog', async (req, res) => {
  try {
    if (!(await isFeatureEnabled('trip_blog'))) {
      res.status(404).json({ error: 'Trip blog is not enabled' });
      return;
    }
    const options = {
      date: typeof req.query.date === 'string' ? req.query.date : undefined,
      cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    };
    const blog = await blogRepository().getBlog(userIdOf(req), req.params.tripId, options);
    const media = await blogMediaRepository().listMedia(userIdOf(req), req.params.tripId);
    const withUrls = await attachMediaUrls(media);
    // `id` must be the underlying blog_items row id (asset.blogItemId), not the media asset's own
    // id — PATCH/DELETE /blog/items/:itemId operate on blog_items, so shipping the asset id as
    // `id` makes every client action against a photo/video item target a row that doesn't exist
    // there, silently failing (404/409) no matter what the client tries.
    // Assets whose parent blog_items row is a core.gallery are grouped into one item with an
    // `assets` array; everything else (standalone media.photo/media.video items) keeps the
    // one-asset-per-item shape. The client flattens both shapes back into one combined per-day
    // set (see DayMediaGallery/DayMediaLightbox usage in tripBlog.tsx) — this grouping exists so
    // a batch of photos uploaded together stays associated as one unit (shared audience/version,
    // deletable as a whole via DELETE /blog/items/:itemId) without preventing the day view from
    // treating every traveler's media as one browsable collection.
    const galleryAssetsByItem = new Map<string, any[]>();
    const mediaItems: any[] = [];
    for (const asset of withUrls as any[]) {
      if (asset.parentKindKey === 'core.gallery') {
        const list = galleryAssetsByItem.get(asset.blogItemId) ?? [];
        list.push(asset);
        galleryAssetsByItem.set(asset.blogItemId, list);
      } else {
        mediaItems.push({ ...asset, id: asset.blogItemId, assetId: asset.id, kindKey: `media.${asset.mediaKind}`, version: 1, sortKey: `media-${asset.id}` });
      }
    }
    if (galleryAssetsByItem.size) {
      const galleryMeta = await blogRepository().getGalleryItemsMeta(req.params.tripId, Array.from(galleryAssetsByItem.keys()));
      for (const [itemId, assets] of galleryAssetsByItem) {
        const meta = (galleryMeta as any)[itemId];
        if (!meta) continue; // defensive: gallery item itself was deleted/missing between queries
        const sortedAssets = [...assets].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
          .map((a) => ({ ...a, assetId: a.id, kindKey: `media.${a.mediaKind}` }));
        mediaItems.push({
          id: itemId, tripId: req.params.tripId, kindKey: 'core.gallery', schemaVersion: 1,
          audience: meta.audience, sortKey: meta.sortKey, authorUserId: meta.authorUserId, lastEditorUserId: meta.lastEditorUserId,
          version: meta.version, caption: meta.caption, dayDate: sortedAssets[0].dayDate,
          createdAt: meta.createdAt, updatedAt: meta.updatedAt, assets: sortedAssets,
        });
      }
    }
    // Cover resolution below needs one flat entry per *asset* (matching what the client's own
    // flattening of core.gallery items produces — see the allMedia flatMap in tripBlog.tsx), not
    // one entry per blog_item — otherwise a traveler picking a gallery photo as the day's cover
    // could never match here, since only the gallery wrapper item is pushed into day.items and it
    // has no assetId of its own (only its nested assets do).
    const mediaByDay = new Map<string, any[]>();
    for (const item of mediaItems) {
      const day = blog.days.find((candidate) => candidate.localDate === item.dayDate);
      if (!day) continue;
      (day.items as any[]).push(item);
      const flatEntries = item.kindKey === 'core.gallery' ? (item.assets ?? []) : [item];
      mediaByDay.set(day.localDate, [...(mediaByDay.get(day.localDate) ?? []), ...flatEntries]);
    }
    // Resolve each day's cover: prefer the traveler's explicit pick (if that asset is still
    // present — a hidden/deleted asset silently falls through to the fallback below, same as an
    // unset cover) else the most-recently-uploaded media item for that day, so a day with photos
    // always has *something* to show as its default even before anyone picks one.
    for (const day of blog.days) {
      const dayMedia = mediaByDay.get(day.localDate) ?? [];
      const explicit = (day as any).coverAssetId ? dayMedia.find((item) => item.assetId === (day as any).coverAssetId) : null;
      if (explicit) {
        (day as any).coverItemId = explicit.id;
        (day as any).coverIsExplicit = true;
      } else if (dayMedia.length) {
        const mostRecent = [...dayMedia].sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime())[0];
        (day as any).coverItemId = mostRecent.id;
        (day as any).coverIsExplicit = false;
      } else {
        (day as any).coverItemId = null;
        (day as any).coverIsExplicit = false;
      }
      delete (day as any).coverAssetId;
    }
    // Phase 3 of docs/trip-blog-social-implementation-plan.md — batched engagement + contributors
    // (architecture §5.4). One counter/own-reaction batch and one contributor batch for every
    // target/day on the page, not a query per item. Additive only: with the reactions flag off,
    // no `engagement`/`contributors` field appears at all, so a client that ignores them behaves
    // exactly as it did before this phase — the NFR-1 compatibility guarantee in §5.4.
    if (await isFeatureEnabled('trip_blog_social_layer') && await isFeatureEnabled('trip_blog_reactions')) {
      const membership = await ensureUserCanReadTrip(req.params.tripId, userIdOf(req));
      const visibleAudiences: BlogAudience[] = membership?.access === 'follower' ? ['followers', 'public'] : ['travelers', 'followers', 'public'];

      const targets: { targetKind: 'day' | 'item' | 'asset'; targetId: string }[] = [];
      for (const day of blog.days) {
        targets.push({ targetKind: 'day', targetId: (day as any).id });
        for (const item of (day.items as any[])) {
          if (item.kindKey === 'core.text') targets.push({ targetKind: 'item', targetId: item.id });
        }
        for (const entry of mediaByDay.get(day.localDate) ?? []) {
          targets.push({ targetKind: 'asset', targetId: entry.assetId });
        }
      }
      const summaries = await blogEngagementRepository().getEngagementSummaries(userIdOf(req), targets, visibleAudiences);
      const zeroSummary = { reactionCounts: {}, reactionTotal: 0, commentCount: 0, userReaction: null };
      const contributorsByDay = await blogRepository().getContributorsForDays(blog.days.map((day) => (day as any).id));

      for (const day of blog.days) {
        (day as any).engagement = summaries[`day:${(day as any).id}`] ?? zeroSummary;
        (day as any).contributors = contributorsByDay[(day as any).id] ?? [];
        for (const item of (day.items as any[])) {
          if (item.kindKey === 'core.text') item.engagement = summaries[`item:${item.id}`] ?? zeroSummary;
        }
        for (const entry of mediaByDay.get(day.localDate) ?? []) {
          entry.engagement = summaries[`asset:${entry.assetId}`] ?? zeroSummary;
        }
      }
    }
    // Return the canonical public path only after publication has completed. The alias is
    // generated during the publication/consent flow, so deriving it from the display name in
    // the client could produce a link that does not resolve.
    const publicPath = blog.visibilityState === 'public'
      ? await blogRepository().getPublicPath(req.params.tripId)
      : null;
    const etag = `W/"blog-${blog.contentRevision}-${blog.visibilityEpoch}"`;
    res.setHeader('ETag', etag);
    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ ...blog, publicPath });
  } catch (err) {
    errorResponse(res, err);
  }
});

router.post('/:tripId/blog/items', async (req, res) => {
  try {
    if (!(await isFeatureEnabled('trip_blog'))) {
      res.status(404).json({ error: 'Trip blog is not enabled' });
      return;
    }
    const kind = String(req.body?.kindKey ?? 'core.text');
    const descriptor = getBlogItemDescriptor(kind);
    if (!descriptor || !(await isFeatureEnabled(descriptor.featureFlag))) {
      res.status(404).json({ error: 'Blog item type is not enabled' });
      return;
    }
    if (kind === 'core.gallery') {
      const dayDate = String(req.body?.dayDate ?? '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dayDate)) {
        res.status(400).json({ error: 'dayDate is required' });
        return;
      }
      const caption = req.body?.caption == null ? null : String(req.body.caption).slice(0, 2000);
      const audience = validAudience(req.body?.audience) ? req.body.audience : 'public';
      const item = await blogRepository().createGalleryItem(userIdOf(req), req.params.tripId, { dayDate, caption, audience });
      res.status(201).json(item);
      return;
    }
    if (kind !== 'core.text') {
      res.status(501).json({ error: 'This modality is enabled for capability discovery but not yet writable' });
      return;
    }
    const dayDate = String(req.body?.dayDate ?? '').trim();
    const body = String(req.body?.body ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayDate) || body.length > 100_000) {
      res.status(400).json({ error: 'dayDate and a text body up to 100,000 characters are required' });
      return;
    }
    const audience = validAudience(req.body?.audience) ? req.body.audience : 'public';
    const item = await blogRepository().createBlogTextItem(userIdOf(req), req.params.tripId, { dayDate, body, languageTag: req.body?.languageTag ?? null, audience });
    res.status(201).json(item);
  } catch (err) {
    errorResponse(res, err);
  }
});

router.patch('/:tripId/blog/items/:itemId', async (req, res) => {
  try {
    if (!(await isFeatureEnabled('trip_blog'))) {
      res.status(404).json({ error: 'Trip blog is not enabled' });
      return;
    }
    const version = Number(req.body?.version ?? req.header('If-Match')?.replace(/\D/g, ''));
    if (!Number.isInteger(version) || version < 1) {
      res.status(428).json({ error: 'version or If-Match is required' });
      return;
    }
    const patch = { version, body: req.body?.body === undefined ? undefined : String(req.body.body), languageTag: req.body?.languageTag, audience: validAudience(req.body?.audience) ? req.body.audience : undefined };
    const result = await blogRepository().updateBlogTextItem(userIdOf(req), req.params.itemId, patch);
    if (!result) {
      // Item not found or already deleted — distinct from a version conflict, but the client's
      // conflict banner (architecture §5.5) has no useful "latest" to show either way, so this
      // stays a plain 409 as before.
      res.status(409).json({ error: 'The blog item changed; reload and resolve the conflict', code: 'VERSION_CONFLICT' });
      return;
    }
    if ('conflict' in result) {
      // §5.5's autosave conflict contract: the 409 body carries the latest authorized
      // { version, body, updatedAt, lastEditor } so the client can offer Keep mine / Use theirs /
      // Show both without a second round-trip. Never logs either body (errorResponse's own
      // console.error path is not hit on this branch).
      res.status(409).json({
        error: 'Someone else edited this while you were writing',
        code: 'VERSION_CONFLICT',
        latest: result.latest ? {
          version: result.latest.version,
          body: result.latest.body,
          updatedAt: result.latest.updatedAt,
          lastEditorUserId: result.latest.lastEditorUserId,
        } : null,
      });
      return;
    }
    res.json(result);
  } catch (err) {
    errorResponse(res, err);
  }
});

router.delete('/:tripId/blog/items/:itemId', async (req, res) => {
  try {
    if (!(await isFeatureEnabled('trip_blog'))) {
      res.status(404).json({ error: 'Trip blog is not enabled' });
      return;
    }
    const version = req.body?.version === undefined ? undefined : Number(req.body.version);
    const deleted = await blogRepository().deleteBlogItem(userIdOf(req), req.params.itemId, version);
    if (!deleted) {
      res.status(409).json({ error: 'The blog item changed or was already deleted' });
      return;
    }
    res.status(204).end();
  } catch (err) {
    errorResponse(res, err);
  }
});

router.post('/:tripId/blog/days/:dayDate/cover', async (req, res) => {
  try {
    if (!(await isFeatureEnabled('trip_blog'))) {
      res.status(404).json({ error: 'Trip blog is not enabled' });
      return;
    }
    const assetId = req.body?.assetId == null ? null : String(req.body.assetId);
    await blogRepository().setDayCover(userIdOf(req), req.params.tripId, req.params.dayDate, assetId);
    res.status(204).end();
  } catch (err) {
    errorResponse(res, err);
  }
});

router.post('/:tripId/blog/items/reorder', async (req, res) => {
  try {
    if (!(await isFeatureEnabled('trip_blog'))) {
      res.status(404).json({ error: 'Trip blog is not enabled' });
      return;
    }
    const ids = Array.isArray(req.body?.itemIds) ? req.body.itemIds.map((value: unknown) => String(value)).filter(Boolean) : [];
    if (ids.length > 200) {
      res.status(400).json({ error: 'Too many items to reorder in one request' });
      return;
    }
    await blogRepository().reorderBlogItems(userIdOf(req), req.params.tripId, ids);
    res.status(204).end();
  } catch (err) {
    errorResponse(res, err);
  }
});

router.post('/:tripId/blog/media/upload-init', async (req, res) => {
  try {
    if (!(await isFeatureEnabled('trip_blog_photo_uploads'))) {
      res.status(404).json({ error: 'Photo uploads are not enabled' });
      return;
    }
    const mediaKind = req.body?.mediaKind === 'video' ? 'video' : 'photo';
    if (mediaKind === 'video') {
      const tier = await getUserTierKey(userIdOf(req));
      if (!['premium', 'pro'].includes(tier)) {
        res.status(402).json({ error: 'Video uploads require Premium', code: 'PREMIUM_REQUIRED' });
        return;
      }
      if (!(await isFeatureEnabled('trip_blog_video_uploads'))) {
        res.status(404).json({ error: 'Video uploads are not enabled' });
        return;
      }
    }
    await assertCanUseFeature(userIdOf(req), 'trip_blog', (req as any).user.role);
    await reserveApiUsageOrThrow({ provider: 'GCS', caller: 'BLOG_UPLOAD_INIT' });
    const idempotencyKey = String(req.header('Idempotency-Key') ?? '').trim();
    if (!idempotencyKey) {
      res.status(400).json({ error: 'Idempotency-Key is required' });
      return;
    }
    const result = await blogMediaRepository().initUpload(userIdOf(req), {
      tripId: req.params.tripId,
      dayDate: String(req.body?.dayDate ?? ''),
      mediaKind,
      mimeType: String(req.body?.mimeType ?? ''),
      byteSize: Number(req.body?.byteSize),
      capturedAt: req.body?.capturedAt ?? null,
      caption: req.body?.caption ?? null,
      altText: req.body?.altText ?? null,
      idempotencyKey,
      galleryItemId: req.body?.galleryItemId ? String(req.body.galleryItemId) : null,
    });
    res.status(201).json(result);
  } catch (err) {
    const message = String((err as any)?.message ?? 'Unable to initialize upload');
    if (message === 'QUOTA_EXCEEDED') { res.status(413).json({ error: message, code: message }); return; }
    errorResponse(res, err);
  }
});

router.post('/:tripId/blog/media/:assetId/complete', async (req, res) => {
  try {
    await reserveApiUsageOrThrow({ provider: 'GCS', caller: 'BLOG_OBJECT_FINALIZE' });
    if (req.body?.videoProbe) validateVideoEnvelope(req.body.videoProbe);
    const userId = userIdOf(req);
    const pending = await blogMediaRepository().getAssetForProcessing(req.params.assetId);
    const reallyUploaded = pending && pending.uploaderUserId === userId && pending.objectKey ? await objectExists(pending.objectKey) : false;
    // A real object landed in the bucket (the client PUT to the signed URL from upload-init): run
    // the actual normalization/thumbnail pipeline and trust the real processed byte count instead
    // of whatever the client claims. Otherwise (no GCS configured, so upload-init fell back to the
    // simulated path) keep the old client-trusted behavior — there's no real file to process.
    const asset = reallyUploaded
      ? await processMediaUpload(userId, req.params.assetId)
      : await blogMediaRepository().completeUpload(userId, req.params.assetId, Number(req.body?.physicalBytes), req.body?.checksum);
    if (asset.mediaKind === 'photo') {
      await blogRepository().setDayCoverIfUnset(userId, asset.tripId, asset.dayDate, asset.id).catch((err) => {
        // The media is already committed at this point. Do not turn a cover-selection failure into
        // a failed upload response that encourages the client to retry an already-finalized asset.
        logError(`[blog] unable to automatically set first photo as cover assetId=${asset.id}`, err);
      });
    }
    const [withUrls] = await attachMediaUrls([asset]);
    res.status(200).json(withUrls);
  } catch (err) {
    const message = String((err as any)?.message ?? 'Unable to finalize upload');
    if (message === 'QUOTA_EXCEEDED') { res.status(413).json({ error: message, code: message }); return; }
    errorResponse(res, err);
  }
});

router.get('/:tripId/blog/media', async (req, res) => {
  try {
    const media = await blogMediaRepository().listMedia(userIdOf(req), req.params.tripId);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ media: await attachMediaUrls(media) });
  } catch (err) { errorResponse(res, err); }
});

router.delete('/:tripId/blog/media/:assetId', async (req, res) => {
  try {
    if (!(await isFeatureEnabled('trip_blog_galleries'))) {
      res.status(404).json({ error: 'Galleries are not enabled' });
      return;
    }
    const result = await blogMediaRepository().deleteMediaAsset(userIdOf(req), req.params.assetId);
    if (!result.deleted) {
      res.status(404).json({ error: 'Media asset not found' });
      return;
    }
    res.status(204).end();
  } catch (err) {
    errorResponse(res, err);
  }
});

router.post('/:tripId/blog/items/:itemId/highlight', async (req, res) => {
  try {
    await blogMediaRepository().setHighlight(userIdOf(req), req.params.itemId, req.body?.highlighted !== false);
    res.status(204).end();
  } catch (err) { errorResponse(res, err); }
});

export default router;
