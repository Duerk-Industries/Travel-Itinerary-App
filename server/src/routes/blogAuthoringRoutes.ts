import { Router } from 'express';
import { authenticate } from '../auth';
import { isFeatureEnabled } from '../services/entitlementService';
import { blogRepository } from '../blog/repository';

// Phase 1 of docs/trip-blog-social-implementation-plan.md (A3/A4): editing UI for
// blog_days.headline/summary and trip_blogs.title/subtitle/introduction, both of which have
// existed in the schema and the GET /:tripId/blog response since the original blog platform
// shipped, but had no write path at all until this file. See
// docs/trip-blog-social-architecture.md §4.05 for the day-metadata concurrency contract and §5
// for the route surface this belongs to.

const router = Router();
router.use(authenticate);

const userIdOf = (req: any): string => String(req.user?.userId ?? '');

const errorResponse = (res: any, err: any): void => {
  const message = String(err?.message ?? 'Unable to process blog request');
  if (process.env.NODE_ENV !== 'production') console.error('[blog-authoring] request failed', message);
  if (/not authorized/i.test(message)) res.status(403).json({ error: message });
  else if (/outside|too large|must be|required|characters or fewer/i.test(message)) res.status(400).json({ error: message });
  else res.status(500).json({ error: message });
};

router.patch('/:tripId/blog/days/:dayDate', async (req, res) => {
  try {
    if (!(await isFeatureEnabled('trip_blog'))) {
      res.status(404).json({ error: 'Trip blog is not enabled' });
      return;
    }
    const updateVersion = Number(req.body?.updateVersion);
    if (!Number.isInteger(updateVersion) || updateVersion < 1) {
      res.status(428).json({ error: 'updateVersion is required' });
      return;
    }
    const headline = req.body?.headline === undefined ? undefined : (req.body.headline === null ? null : String(req.body.headline));
    const summary = req.body?.summary === undefined ? undefined : (req.body.summary === null ? null : String(req.body.summary));
    const result = await blogRepository().updateBlogDayMeta(userIdOf(req), req.params.tripId, req.params.dayDate, { headline, summary, updateVersion });
    if (!result) {
      res.status(404).json({ error: 'That day was not found on this trip' });
      return;
    }
    if ('conflict' in result) {
      // Same conflict-banner contract as the item PATCH route (architecture §5.5, §4.05):
      // the 409 body carries the latest authorized headline/summary/updateVersion so the
      // client can offer Keep mine / Use theirs / Show both without a second round-trip.
      res.status(409).json({
        error: 'Someone else edited this day while you were writing',
        code: 'VERSION_CONFLICT',
        latest: result.latest ? {
          headline: result.latest.headline,
          summary: result.latest.summary,
          updateVersion: result.latest.updateVersion,
        } : null,
      });
      return;
    }
    res.json(result);
  } catch (err) {
    errorResponse(res, err);
  }
});

router.patch('/:tripId/blog', async (req, res) => {
  try {
    if (!(await isFeatureEnabled('trip_blog'))) {
      res.status(404).json({ error: 'Trip blog is not enabled' });
      return;
    }
    const title = req.body?.title === undefined ? undefined : String(req.body.title);
    const subtitle = req.body?.subtitle === undefined ? undefined : (req.body.subtitle === null ? null : String(req.body.subtitle));
    const introduction = req.body?.introduction === undefined ? undefined : (req.body.introduction === null ? null : String(req.body.introduction));
    const blog = await blogRepository().updateBlogMeta(userIdOf(req), req.params.tripId, { title, subtitle, introduction });
    res.json(blog);
  } catch (err) {
    errorResponse(res, err);
  }
});

export default router;
