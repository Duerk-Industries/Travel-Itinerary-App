import { Router } from 'express';
import { authenticate } from '../auth';
import { isFeatureEnabled } from '../services/entitlementService';
import { getApiLimitsConfig } from '../config/apiLimits';
import { getBlogItemDescriptor, listBlogItemDescriptors } from '../blog/registry';
import { blogRepository } from '../blog/repository';
import { BlogAudience } from '../blog/types';
import { ensureUserInTrip } from '../db';

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
const errorResponse = (res: any, err: any): void => {
  const message = String(err?.message ?? 'Unable to process blog request');
  if (process.env.NODE_ENV !== 'production') console.error('[blog] request failed', message);
  if (/not authorized/i.test(message)) res.status(403).json({ error: message });
  else if (/outside|too large|must be|required/i.test(message)) res.status(400).json({ error: message });
  else res.status(500).json({ error: message });
};

router.get('/:tripId/blog/capabilities', async (req, res) => {
  try {
    const master = await isFeatureEnabled('trip_blog');
    const descriptors = listBlogItemDescriptors();
    const kinds = await Promise.all(descriptors.map(async (descriptor) => ({ ...descriptor, enabled: master && await isFeatureEnabled(descriptor.featureFlag) })));
    const limits = tripBlogLimits();
    const writable = Boolean(await ensureUserInTrip(req.params.tripId, userIdOf(req)));
    res.json({ enabled: master, writable, kinds, limits: { maxTextBlocksPerDay: Number(limits.maxTextBlocksPerDay ?? 10), maxMediaItemsPerDay: Number(limits.maxMediaItemsPerDay ?? 50), videoMaxDurationSeconds: Number(limits.videoMaxDurationSeconds ?? 300) } });
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
    const blog = await blogRepository().getBlog(userIdOf(req), req.params.tripId);
    const etag = `W/"blog-${blog.contentRevision}-${blog.visibilityEpoch}"`;
    res.setHeader('ETag', etag);
    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(blog);
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
    const item = await blogRepository().updateBlogTextItem(userIdOf(req), req.params.itemId, patch);
    if (!item) {
      res.status(409).json({ error: 'The blog item changed; reload and resolve the conflict', code: 'VERSION_CONFLICT' });
      return;
    }
    res.json(item);
  } catch (err) {
    errorResponse(res, err);
  }
});

router.delete('/:tripId/blog/items/:itemId', async (req, res) => {
  try {
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

router.post('/:tripId/blog/items/reorder', async (req, res) => {
  try {
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

export default router;
