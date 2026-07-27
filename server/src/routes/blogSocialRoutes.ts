import { Router } from 'express';
import { randomUUID } from 'crypto';
import { authenticate } from '../auth';
import { isFeatureEnabled } from '../services/entitlementService';
import { ensureUserInTrip } from '../db';
import { blogRepository } from '../blog/repository';
import { reserveApiUsageOrThrow } from '../apis/usageLimiter';

const router = Router();
router.use(authenticate);
const providerOf = (value: unknown) => value === 'facebook' ? 'facebook' : value === 'instagram' ? 'instagram' : '';

router.post('/:tripId/blog/social/:provider/connect', async (req: any, res) => {
  if (!(await isFeatureEnabled('trip_blog_social_posting'))) return res.status(404).json({ error: 'Social posting is not enabled' });
  const provider = providerOf(req.params.provider); if (!provider) return res.status(400).json({ error: 'Unsupported provider' });
  if (!(await ensureUserInTrip(req.params.tripId, String(req.user.userId)))) return res.status(403).json({ error: 'Not authorized' });
  res.status(200).json({ provider, authorizationUrl: `/oauth/${provider}/authorize?state=${randomUUID()}`, pkceRequired: true });
});

router.post('/:tripId/blog/social/:provider/preview', async (req: any, res) => {
  if (!(await isFeatureEnabled('trip_blog_social_posting'))) return res.status(404).json({ error: 'Social posting is not enabled' });
  const provider = providerOf(req.params.provider); if (!provider) return res.status(400).json({ error: 'Unsupported provider' });
  if (!(await ensureUserInTrip(req.params.tripId, String(req.user.userId)))) return res.status(403).json({ error: 'Not authorized' });
  await reserveApiUsageOrThrow({ provider: 'META_GRAPH', caller: 'SOCIAL_POST_PREVIEW' });
  if (!(await blogRepository().isBlogPublic(req.params.tripId))) return res.status(409).json({ error: 'The trip blog must be public before social posting' });
  res.json({ provider, dayDate: String(req.body?.dayDate ?? ''), preview: { caption: String(req.body?.caption ?? '').slice(0, 2200), mediaCount: Math.min(10, Number(req.body?.mediaCount ?? 0)) } });
});

router.post('/:tripId/blog/social/:provider/enqueue', async (req: any, res) => {
  if (!(await isFeatureEnabled('trip_blog_social_posting'))) return res.status(404).json({ error: 'Social posting is not enabled' });
  const provider = providerOf(req.params.provider); if (!provider) return res.status(400).json({ error: 'Unsupported provider' });
  if (!(await ensureUserInTrip(req.params.tripId, String(req.user.userId)))) return res.status(403).json({ error: 'Not authorized' });
  await reserveApiUsageOrThrow({ provider: 'META_GRAPH', caller: 'SOCIAL_POST_ENQUEUE' });
  if (!(await blogRepository().isBlogPublic(req.params.tripId))) return res.status(409).json({ error: 'The trip blog must be public before social posting' });
  const idempotencyKey = String(req.header('Idempotency-Key') ?? '').trim(); if (!idempotencyKey) return res.status(400).json({ error: 'Idempotency-Key is required' });
  res.status(202).json({ jobId: randomUUID(), provider, state: 'queued', idempotencyKey });
});
export default router;
