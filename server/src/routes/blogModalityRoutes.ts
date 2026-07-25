import { Router } from 'express';
import { randomUUID } from 'crypto';
import { authenticate } from '../auth';
import { isFeatureEnabled } from '../services/entitlementService';
import { ensureUserInTrip } from '../db';
import { getBlogItemDescriptor } from '../blog/registry';
import { queryBlog } from '../db.postgres';
import { reserveApiUsageOrThrow } from '../apis/usageLimiter';

const router = Router(); router.use(authenticate);
router.post('/:tripId/blog/modalities', async (req: any, res) => {
  const kindKey = String(req.body?.kindKey ?? ''); const descriptor = getBlogItemDescriptor(kindKey);
  if (!descriptor || !(await isFeatureEnabled(descriptor.featureFlag))) return res.status(404).json({ error: 'Modality is not enabled' });
  const userId = String(req.user.userId); if (!(await ensureUserInTrip(req.params.tripId, userId))) return res.status(403).json({ error: 'Not authorized' });
  const dayDate = String(req.body?.dayDate ?? ''); const day = await queryBlog<any>('SELECT id FROM blog_days WHERE trip_id = $1 AND local_date = $2::date LIMIT 1', [req.params.tripId, dayDate]);
  if (!day.rows[0]) return res.status(400).json({ error: 'The selected day is outside the trip range' });
  const itemId = randomUUID(); await queryBlog(`INSERT INTO blog_items (id, trip_id, blog_day_id, kind_key, schema_version, audience, sort_key, author_user_id, last_editor_user_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`, [itemId, req.params.tripId, day.rows[0].id, kindKey, descriptor.schemaVersion, descriptor.defaultAudience, `${Date.now()}-${itemId}`, userId]);
  const payload = req.body?.payload && typeof req.body.payload === 'object' ? req.body.payload : {};
  await queryBlog('INSERT INTO blog_item_payloads (item_id, payload) VALUES ($1, $2::jsonb)', [itemId, JSON.stringify(payload)]);
  if (kindKey === 'core.translation') await reserveApiUsageOrThrow({ provider: 'TRANSLATION', caller: 'BLOG_TRANSLATION' });
  if (kindKey === 'media.audio') await reserveApiUsageOrThrow({ provider: 'TRANSCRIPTION', caller: 'BLOG_AUDIO_TRANSCRIPTION' });
  if (kindKey === 'core.export' || kindKey === 'core.ai_highlight') return res.status(202).json({ itemId, jobId: randomUUID(), state: 'queued', kindKey });
  res.status(201).json({ itemId, kindKey, schemaVersion: descriptor.schemaVersion, payload });
});

router.get('/:tripId/blog/search', async (req: any, res) => {
  if (!(await isFeatureEnabled('trip_blog_search'))) return res.status(404).json({ error: 'Blog search is not enabled' });
  const userId = String(req.user.userId); if (!(await ensureUserInTrip(req.params.tripId, userId))) return res.status(403).json({ error: 'Not authorized' });
  const q = `%${String(req.query.q ?? '').slice(0, 100)}%`; const result = await queryBlog<any>(`SELECT i.id, d.local_date, t.body FROM blog_items i JOIN blog_days d ON d.id = i.blog_day_id JOIN blog_text_contents t ON t.item_id = i.id WHERE i.trip_id = $1 AND i.deleted_at IS NULL AND t.body ILIKE $2 ORDER BY d.local_date LIMIT 50`, [req.params.tripId, q]);
  res.json({ results: result.rows });
});
export default router;
