import { Router } from 'express';
import { authenticate } from '../auth';
import { isFeatureEnabled } from '../services/entitlementService';
import { reserveApiUsageOrThrow, ApiLimitExceededError } from '../apis/usageLimiter';
import { getDayFacts } from '../services/blogDayFactsService';
import { BlogEngagementUnauthorizedError } from '../services/blogEngagementService';
import { BlogTargetNotFoundError } from '../services/blogEngagementErrors';

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
    if (process.env.NODE_ENV !== 'production') console.error('[blog-insight] request failed', message);
    res.status(500).json({ error: message });
  }
});

export default router;
