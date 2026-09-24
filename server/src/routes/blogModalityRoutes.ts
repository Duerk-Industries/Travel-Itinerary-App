import { Router } from 'express';
import { authenticate } from '../auth';
import { isFeatureEnabled } from '../services/entitlementService';
import { ensureUserInTrip, getCurrentDbProvider } from '../db';
import { getBlogItemDescriptor } from '../blog/registry';
import { blogRepository } from '../blog/repository';
import { ApiLimitExceededError, reserveApiUsageOrThrow } from '../apis/usageLimiter';
import { getApiCacheSetting } from '../config/apiLimits';
import { resolveActorMembership, visibleAudiencesForMembership } from '../services/blogEngagementService';
import { logError } from '../logger';

const router = Router(); router.use(authenticate);
router.post('/:tripId/blog/modalities', async (req: any, res) => {
  try {
    const kindKey = String(req.body?.kindKey ?? ''); const descriptor = getBlogItemDescriptor(kindKey);
    if (!descriptor || !(await isFeatureEnabled(descriptor.featureFlag))) return res.status(404).json({ error: 'Modality is not enabled' });
    const userId = String(req.user.userId); if (!(await ensureUserInTrip(req.params.tripId, userId))) return res.status(403).json({ error: 'Not authorized' });
    const dayDate = String(req.body?.dayDate ?? '');
    const payload = req.body?.payload && typeof req.body.payload === 'object' ? req.body.payload : {};

    // Audio is an uploaded object, not a JSON modality row. Export is not a job until durable
    // claim/lease state exists. Reject both before any write instead of returning a synthetic 202.
    if (kindKey === 'media.audio') return res.status(409).json({ error: 'Use the bounded blog media upload flow for voice notes' });
    if (kindKey === 'core.export') return res.status(501).json({ error: 'Durable blog export jobs are not available' });
    if (kindKey === 'core.translation') await reserveApiUsageOrThrow({ provider: 'TRANSLATION', caller: 'BLOG_TRANSLATION' });

    const { itemId, payload: cleanPayload } = await blogRepository().createModalityItem(
      userId,
      req.params.tripId,
      kindKey,
      descriptor.schemaVersion,
      descriptor.defaultAudience,
      payload,
      dayDate
    );

    // Note: jobs for export/highlight would typically be enqueued by the repository if needed, but keeping the response pattern.
    if (kindKey === 'core.ai_highlight') return res.status(202).json({ itemId, jobId: cleanPayload.jobId ?? itemId, state: 'queued', kindKey });
    res.status(201).json({ itemId, kindKey, schemaVersion: descriptor.schemaVersion, payload: cleanPayload });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.get('/:tripId/blog/search', async (req: any, res) => {
  try {
    if (!(await isFeatureEnabled('trip_blog_search'))) return res.type('application/json').status(404).send({ error: 'Blog search is not enabled' });
    const query = String(req.query.q ?? '').trim();
    const maxLength = Math.max(10, Number(getApiCacheSetting('tripBlog', 'searchQueryMaxLength') ?? 100));
    if (query.length < 2 || query.length > maxLength) return res.status(400).json({ error: `Search must be between 2 and ${maxLength} characters` });
    const membership = await resolveActorMembership(req.params.tripId, String(req.user.userId));
    const pageSize = Math.min(50, Math.max(1, Number(getApiCacheSetting('tripBlog', 'searchPageSize') ?? 20)));
    const scanLimit = Math.min(2000, Math.max(pageSize + 1, Number(getApiCacheSetting('tripBlog', 'searchScanMaxItems') ?? 500)));
    await reserveApiUsageOrThrow({ provider: 'TRIP_BLOG_SOCIAL_API', caller: 'BLOG_SEARCH_READ', requireConfiguredLimit: true });
    await reserveApiUsageOrThrow({ provider: 'TRIP_BLOG_SOCIAL_STORAGE', caller: 'DATABASE_READ_UNIT', units: getCurrentDbProvider() === 'firebase' ? scanLimit + 2 : 2, requireConfiguredLimit: true });
    const rows = await blogRepository().searchBlog(req.params.tripId, query, visibleAudiencesForMembership(membership), { cursor: String(req.query.cursor ?? '') || null, limit: pageSize, scanLimit });
    const hasMore = rows.length > pageSize;
    const results = rows.slice(0, pageSize);
    const last = results[results.length - 1];
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ results, nextCursor: hasMore && last ? `${last.localDate}|${last.id}` : null });
  } catch (err) {
    const message = String((err as Error).message || 'Unable to search this blog');
    const status = /not authorized/i.test(message) ? 403 : err instanceof ApiLimitExceededError ? 429 : 500;
    if (status === 500) logError('[blog-search] request failed', err);
    res.status(status).json({ error: message });
  }
});
export default router;
