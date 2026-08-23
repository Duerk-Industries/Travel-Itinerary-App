import { Router } from 'express';
import { randomUUID } from 'crypto';
import { authenticate } from '../auth';
import { isFeatureEnabled } from '../services/entitlementService';
import { ApiLimitExceededError, reserveApiUsageOrThrow } from '../apis/usageLimiter';
import { ensureUserInTrip } from '../db';

const router = Router();
router.use(authenticate);
const userIdOf = (req: any) => String(req.user?.userId ?? '');

router.post('/:tripId/blog/import/google/session', async (req: any, res) => {
  try {
    if (!(await isFeatureEnabled('trip_blog_google_photos_import'))) return res.status(404).json({ error: 'Google Photos import is not enabled' });
    if (!(await ensureUserInTrip(req.params.tripId, userIdOf(req)))) return res.status(403).json({ error: 'Not authorized' });
    await reserveApiUsageOrThrow({ provider: 'GOOGLE_PHOTOS', caller: 'PHOTOS_PICKER_SESSION' });
    res.status(201).json({ sessionId: randomUUID(), expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(), scopes: ['photoslibrary.readonly'], provider: 'google_photos' });
  } catch (err) { res.status(429).json({ error: (err as Error).message }); }
});

router.post('/:tripId/blog/import/:provider/complete', async (req: any, res) => {
  try {
    const provider = String(req.params.provider);
    const flag = provider === 'google' ? 'trip_blog_google_photos_import' : provider === 'apple' ? 'trip_blog_apple_photos_import' : '';
    if (!flag || !(await isFeatureEnabled(flag))) return res.status(404).json({ error: 'Import provider is not enabled' });
    if (!(await ensureUserInTrip(req.params.tripId, userIdOf(req)))) return res.status(403).json({ error: 'Not authorized' });
    res.status(202).json({ jobId: randomUUID(), state: 'queued', provider: provider === 'google' ? 'google_photos' : 'apple_photos', unassignedPolicy: 'review_queue' });
  } catch (err) { res.status(err instanceof ApiLimitExceededError ? 429 : 400).json({ error: (err as Error).message }); }
});

router.post('/:tripId/blog/share-intent', async (req: any, res) => {
  try {
    const platform = String(req.body?.platform ?? '').toLowerCase();
    const flag = platform === 'ios' ? 'trip_blog_mobile_share_ios' : platform === 'android' ? 'trip_blog_mobile_share_android' : '';
    if (!flag || !(await isFeatureEnabled(flag))) return res.status(404).json({ error: 'Mobile share import is not enabled' });
    if (!(await ensureUserInTrip(req.params.tripId, userIdOf(req)))) return res.status(403).json({ error: 'Not authorized' });
    await reserveApiUsageOrThrow({ provider: 'TRIP_BLOG_SOCIAL_API', caller: 'BLOG_QUICK_CAPTURE_HANDOFF', requireConfiguredLimit: true });
    res.status(202).json({ accepted: true, uploadEndpoint: `/api/trips/${req.params.tripId}/blog/media/upload-init`, platform });
  } catch (err) { res.status(err instanceof ApiLimitExceededError ? 429 : 400).json({ error: (err as Error).message }); }
});
export default router;
