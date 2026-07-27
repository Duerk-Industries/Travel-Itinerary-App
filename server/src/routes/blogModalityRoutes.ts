import { Router } from 'express';
import { authenticate } from '../auth';
import { isFeatureEnabled } from '../services/entitlementService';
import { ensureUserInTrip } from '../db';
import { getBlogItemDescriptor } from '../blog/registry';
import { blogRepository } from '../blog/repository';
import { reserveApiUsageOrThrow } from '../apis/usageLimiter';

const router = Router(); router.use(authenticate);
router.post('/:tripId/blog/modalities', async (req: any, res) => {
  try {
    const kindKey = String(req.body?.kindKey ?? ''); const descriptor = getBlogItemDescriptor(kindKey);
    if (!descriptor || !(await isFeatureEnabled(descriptor.featureFlag))) return res.status(404).json({ error: 'Modality is not enabled' });
    const userId = String(req.user.userId); if (!(await ensureUserInTrip(req.params.tripId, userId))) return res.status(403).json({ error: 'Not authorized' });
    const dayDate = String(req.body?.dayDate ?? '');
    const payload = req.body?.payload && typeof req.body.payload === 'object' ? req.body.payload : {};

    const { itemId, payload: cleanPayload } = await blogRepository().createModalityItem(
      userId,
      req.params.tripId,
      kindKey,
      descriptor.schemaVersion,
      descriptor.defaultAudience,
      payload,
      dayDate
    );

    if (kindKey === 'core.translation') await reserveApiUsageOrThrow({ provider: 'TRANSLATION', caller: 'BLOG_TRANSLATION' });
    if (kindKey === 'media.audio') await reserveApiUsageOrThrow({ provider: 'TRANSCRIPTION', caller: 'BLOG_AUDIO_TRANSCRIPTION' });
    // Note: jobs for export/highlight would typically be enqueued by the repository if needed, but keeping the response pattern.
    if (kindKey === 'core.export' || kindKey === 'core.ai_highlight') return res.status(202).json({ itemId, jobId: cleanPayload.jobId ?? itemId, state: 'queued', kindKey });
    res.status(201).json({ itemId, kindKey, schemaVersion: descriptor.schemaVersion, payload: cleanPayload });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.get('/:tripId/blog/search', async (req: any, res) => {
  if (!(await isFeatureEnabled('trip_blog_search'))) return res.type('application/json').status(404).send({ error: 'Blog search is not enabled' });
  const userId = String(req.user.userId); if (!(await ensureUserInTrip(req.params.tripId, userId))) return res.status(403).json({ error: 'Not authorized' });
  const results = await blogRepository().searchBlog(req.params.tripId, String(req.query.q ?? ''));
  res.json({ results });
});
export default router;
