import { Router } from 'express';
import { authenticate } from '../auth';
import { isFeatureEnabled } from '../services/entitlementService';
import { ensureUserInTrip } from '../db';
import { queryBlog } from '../db.postgres';
import { randomUUID } from 'crypto';

const router = Router();
const slug = (v: string) => v.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'trip';
const eligibleAdults = async (tripId: string): Promise<{ adults: string[]; missingBirthDate: number }> => {
  const result = await queryBlog<{ user_id: string }>(`SELECT DISTINCT gm.user_id FROM trips t JOIN group_members gm ON gm.group_id = t.group_id JOIN users u ON u.id = gm.user_id WHERE t.id = $1 AND gm.removed_at IS NULL AND gm.user_id IS NOT NULL AND u.date_of_birth IS NOT NULL AND u.date_of_birth <= CURRENT_DATE - INTERVAL '16 years'`, [tripId]);
  const missing = await queryBlog<{ count: string }>(`SELECT COUNT(*) AS count FROM trips t JOIN group_members gm ON gm.group_id = t.group_id JOIN users u ON u.id = gm.user_id WHERE t.id = $1 AND gm.removed_at IS NULL AND gm.user_id IS NOT NULL AND u.date_of_birth IS NULL`, [tripId]);
  return { adults: result.rows.map((r) => String(r.user_id)), missingBirthDate: Number(missing.rows[0]?.count ?? 0) };
};

router.post('/:tripId/blog/publication/request', authenticate, async (req: any, res) => {
  try {
    if (!(await isFeatureEnabled('trip_blog_public_sharing'))) return res.status(404).json({ error: 'Public sharing is not enabled' });
    const userId = String(req.user.userId); if (!(await ensureUserInTrip(req.params.tripId, userId))) return res.status(403).json({ error: 'Not authorized' });
    const eligibility = await eligibleAdults(req.params.tripId);
    if (eligibility.missingBirthDate > 0) return res.status(409).json({ error: 'Every account traveler must complete the date-of-birth profile before public consent can be requested', code: 'PROFILE_COMPLETION_REQUIRED' });
    const adults = eligibility.adults.filter((id) => id !== userId);
    const prior = await queryBlog<{ epoch: number }>('SELECT COALESCE(MAX(epoch), 0) AS epoch FROM blog_publication_epochs WHERE trip_id = $1', [req.params.tripId]);
    const epoch = Number(prior.rows[0]?.epoch ?? 0) + 1; const epochId = randomUUID();
    await queryBlog(`INSERT INTO blog_publication_epochs (id, trip_id, epoch, state, requested_by, expires_at) VALUES ($1, $2, $3, 'pending_consent', $4, NOW() + INTERVAL '14 days')`, [epochId, req.params.tripId, epoch, userId]);
    await queryBlog(`INSERT INTO blog_publication_consents (epoch_id, user_id, decision, decided_at) VALUES ($1, $2, 'approved', NOW())`, [epochId, userId]);
    for (const adult of adults) await queryBlog(`INSERT INTO blog_publication_consents (epoch_id, user_id, decision) VALUES ($1, $2, 'pending')`, [epochId, adult]);
    if (adults.length === 0) await queryBlog(`UPDATE blog_publication_epochs SET state = 'public', updated_at = NOW() WHERE id = $1`, [epochId]);
    const identity = await queryBlog<{ username: string; trip_name: string }>('SELECT u.username, t.name AS trip_name FROM users u JOIN trips t ON t.id = $2 WHERE u.id = $1', [userId, req.params.tripId]);
    if (identity.rows[0]) await queryBlog(`INSERT INTO blog_public_aliases (trip_id, user_id, username_slug, trip_slug, canonical) VALUES ($1, $2, $3, $4, TRUE) ON CONFLICT (username_slug, trip_slug) DO UPDATE SET canonical = TRUE`, [req.params.tripId, userId, slug(identity.rows[0].username), slug(identity.rows[0].trip_name)]);
    res.status(201).json({ epoch, state: adults.length ? 'pending_consent' : 'public', pendingCount: adults.length });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

router.post('/:tripId/blog/publication/:epoch/consent', authenticate, async (req: any, res) => {
  try {
    const userId = String(req.user.userId); if (!(await ensureUserInTrip(req.params.tripId, userId))) return res.status(403).json({ error: 'Not authorized' });
    const decision = req.body?.decision === 'approved' ? 'approved' : req.body?.decision === 'declined' ? 'declined' : '';
    if (!decision) return res.status(400).json({ error: 'decision must be approved or declined' });
    const epoch = await queryBlog<any>('SELECT * FROM blog_publication_epochs WHERE trip_id = $1 AND epoch = $2', [req.params.tripId, Number(req.params.epoch)]); if (!epoch.rows[0]) return res.status(404).json({ error: 'Publication request not found' });
    await queryBlog('UPDATE blog_publication_consents SET decision = $3, decided_at = NOW() WHERE epoch_id = $1 AND user_id = $2', [epoch.rows[0].id, userId, decision]);
    if (decision === 'approved') {
      const identity = await queryBlog<{ username: string; trip_name: string }>('SELECT u.username, t.name AS trip_name FROM users u JOIN trips t ON t.id = $2 WHERE u.id = $1', [userId, req.params.tripId]);
      if (identity.rows[0]) await queryBlog(`INSERT INTO blog_public_aliases (trip_id, user_id, username_slug, trip_slug, canonical) VALUES ($1, $2, $3, $4, FALSE) ON CONFLICT (username_slug, trip_slug) DO NOTHING`, [req.params.tripId, userId, slug(identity.rows[0].username), slug(identity.rows[0].trip_name)]);
    }
    if (decision === 'declined') await queryBlog(`UPDATE blog_publication_epochs SET state = 'expired', updated_at = NOW() WHERE id = $1 AND state = 'pending_consent'`, [epoch.rows[0].id]);
    else { const pending = await queryBlog<{ count: string }>(`SELECT COUNT(*) AS count FROM blog_publication_consents WHERE epoch_id = $1 AND decision = 'pending'`, [epoch.rows[0].id]); if (Number(pending.rows[0]?.count ?? 0) === 0) await queryBlog(`UPDATE blog_publication_epochs SET state = 'public', updated_at = NOW() WHERE id = $1 AND state = 'pending_consent'`, [epoch.rows[0].id]); }
    res.status(204).end();
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

router.post('/:tripId/blog/publication/revoke', authenticate, async (req: any, res) => {
  try { const userId = String(req.user.userId); if (!(await ensureUserInTrip(req.params.tripId, userId))) return res.status(403).json({ error: 'Not authorized' }); await queryBlog(`UPDATE blog_publication_epochs SET state = 'revoked', revoked_by = $2, updated_at = NOW() WHERE trip_id = $1 AND state = 'public'`, [req.params.tripId, userId]); res.status(204).end(); }
  catch (err) { res.status(400).json({ error: (err as Error).message }); }
});
export default router;
