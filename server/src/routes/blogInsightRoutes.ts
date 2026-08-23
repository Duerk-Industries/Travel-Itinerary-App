import { Router } from 'express';
import { authenticate } from '../auth';
import { isFeatureEnabled } from '../services/entitlementService';
import { reserveApiUsageOrThrow, ApiLimitExceededError } from '../apis/usageLimiter';
import { getDayFacts } from '../services/blogDayFactsService';
import { BlogEngagementUnauthorizedError } from '../services/blogEngagementService';
import { BlogTargetNotFoundError } from '../services/blogEngagementErrors';
import { getOrQueueBlogRecap } from '../services/blogRecapService';
import { ensureUserInTrip } from '../db';
import { blogEngagementRepository } from '../blog/engagementRepository';
import { blogMediaRepository } from '../blog/repository';
import { logError } from '../logger';

// Phase 5 of docs/trip-blog-social-implementation-plan.md (C1, C2, C3, C5) — architecture §5.2.
// A request entirely separate from GET /:tripId/blog: facts draw on five more table reads
// (flights/lodgings/tours/car_rentals/blog_media_assets) that aren't needed for first paint, so
// the day card renders headline/entries/gallery immediately and the fact strip/timeline fill in
// once this resolves, same rationale as the engagement block being its own fetch (Phase 3/4).
//
// Only /days/:dayDate/facts is built here — /recap (C7) and /places (C6) are later phases' work;
// this file gains those routes when those phases land, per §5.2's own table.

const router = Router();
router.use(authenticate);

const userIdOf = (req: any): string => String(req.user?.userId ?? '');

router.get('/:tripId/blog/days/:dayDate/facts', async (req, res) => {
  try {
    if (!(await isFeatureEnabled('trip_blog_social_layer')) || !(await isFeatureEnabled('trip_blog_day_facts'))) {
      res.status(404).json({ error: 'Day facts are not enabled' });
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(req.params.dayDate))) {
      res.status(400).json({ error: 'dayDate must be YYYY-MM-DD' });
      return;
    }
    await reserveApiUsageOrThrow({ provider: 'TRIP_BLOG_SOCIAL_API', caller: 'BLOG_DAY_FACTS_READ', requireConfiguredLimit: true });
    const result = await getDayFacts(req.params.tripId, userIdOf(req), req.params.dayDate);
    res.json(result);
  } catch (err) {
    if (err instanceof BlogEngagementUnauthorizedError) {
      res.status(403).json({ error: err.message });
      return;
    }
    if (err instanceof BlogTargetNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof ApiLimitExceededError) {
      res.status(429).json({ error: 'Trip blog facts are at capacity right now — please try again shortly' });
      return;
    }
    const message = String((err as any)?.message ?? 'Unable to load day facts');
    logError('[blog-insight] request failed', err);
    res.status(500).json({ error: message });
  }
});

router.get('/:tripId/blog/recap', async (req, res) => {
  try {
    if (!(await isFeatureEnabled('trip_blog_recap'))) {
      res.status(404).json({ error: 'Trip recap is not enabled' });
      return;
    }
    const result = await getOrQueueBlogRecap(req.params.tripId, userIdOf(req));
    if (result.status === 'pending') {
      res.setHeader('Retry-After', String(result.retryAfterSeconds));
      res.status(202).json({ state: 'pending', retryAfterSeconds: result.retryAfterSeconds });
      return;
    }
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.json({ state: 'ready', recap: result.payload });
  } catch (err) {
    if (err instanceof ApiLimitExceededError) {
      res.status(429).json({ error: 'Trip recap generation is at capacity right now' });
      return;
    }
    const message = String((err as any)?.message ?? 'Unable to load trip recap');
    res.status(/not authorized/i.test(message) ? 403 : /not found/i.test(message) ? 404 : 500).json({ error: message });
  }
});

router.get('/:tripId/blog/days/:dayDate/cover-proposal', async (req, res) => {
  try {
    if (!(await isFeatureEnabled('trip_blog_social_layer')) || !(await isFeatureEnabled('trip_blog_reactions'))) {
      res.status(404).json({ error: 'Photo-of-the-day proposals are not enabled' });
      return;
    }
    if (!(await ensureUserInTrip(req.params.tripId, userIdOf(req)))) {
      res.status(403).json({ error: 'Not authorized to edit this trip' });
      return;
    }
    await reserveApiUsageOrThrow({ provider: 'TRIP_BLOG_SOCIAL_API', caller: 'BLOG_COVER_PROPOSAL_READ', requireConfiguredLimit: true });
    await reserveApiUsageOrThrow({ provider: 'TRIP_BLOG_SOCIAL_STORAGE', caller: 'DATABASE_READ_UNIT', units: 3, requireConfiguredLimit: true });
    const media = (await blogMediaRepository().listMedia(userIdOf(req), req.params.tripId))
      .filter((asset) => asset.dayDate === req.params.dayDate && asset.mediaKind === 'photo' && asset.state === 'ready');
    if (!media.length) {
      res.json({ proposal: null });
      return;
    }
    const targets = media.map((asset) => ({ targetKind: 'asset' as const, targetId: asset.id }));
    const summaries = await blogEngagementRepository().getEngagementSummaries(userIdOf(req), targets, ['travelers', 'followers', 'public']);
    const winner = [...media].sort((a, b) => {
      const delta = Number(summaries[`asset:${b.id}`]?.reactionTotal ?? 0) - Number(summaries[`asset:${a.id}`]?.reactionTotal ?? 0);
      return delta || a.id.localeCompare(b.id);
    })[0];
    const reactionTotal = Number(summaries[`asset:${winner.id}`]?.reactionTotal ?? 0);
    res.json({ proposal: reactionTotal > 0 ? { assetId: winner.id, reactionTotal } : null });
  } catch (err) {
    const message = String((err as any)?.message ?? 'Unable to propose a day cover');
    res.status(err instanceof ApiLimitExceededError ? 429 : /not authorized/i.test(message) ? 403 : 500).json({ error: message });
  }
});

export default router;
