import { Router } from 'express';
import { authenticate } from '../auth';
import { isFeatureEnabled } from '../services/entitlementService';
import { ensureUserInTrip, getCurrentDbProvider } from '../db';
import { queryBlog } from '../db.postgres';
import { randomUUID } from 'crypto';
import { consentPublicationFirebase, getPublicationStatusFirebase, requestPublicationFirebase, revokePublicationFirebase } from '../blog/firebasePublicationRepository';
import { blogMediaRepository } from '../blog/repository';
import { ApiLimitExceededError, reserveApiUsageOrThrow } from '../apis/usageLimiter';

const router = Router();
const slug = (v: string) => v.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'trip';
// blog_publication_epochs is the source of truth for public serving (publicBlogRoutes.ts), but the
// private blog view (blogRoutes.ts) reads trip_blogs.visibility_state/visibility_epoch directly, so
// every epoch state transition must mirror onto trip_blogs or the private UI shows a stale state.
const syncBlogVisibility = async (tripId: string, epoch: number, state: 'pending_consent' | 'public' | 'declined' | 'revoked'): Promise<void> => {
  const visibilityState = state === 'public' ? 'public' : state === 'pending_consent' ? 'pending_consent' : 'private';
  // Update-then-insert, with an explicit client-generated id, rather than relying on the
  // trip_blogs.id DEFAULT uuid_generate_v4(): this repo's pg-mem test adapter's DEFAULT UUID
  // generator can repeat a value already used by an earlier row in the same table within one test
  // run, producing a spurious primary-key collision a real Postgres server would not hit. A trip
  // can also request publication before anyone has ever loaded the private blog view (the only
  // other place trip_blogs gets lazily created), so the row may not exist yet on the update path.
  const updated = await queryBlog(
    `UPDATE trip_blogs SET visibility_state = $2, visibility_epoch = $3, updated_at = NOW() WHERE trip_id = $1`,
    [tripId, visibilityState, epoch]
  );
  if (updated.rowCount) return;
  const trip = await queryBlog<{ name: string | null }>('SELECT name FROM trips WHERE id = $1', [tripId]);
  const title = trip.rows[0]?.name?.trim() || 'Trip Blog';
  try {
    await queryBlog(
      `INSERT INTO trip_blogs (id, trip_id, title, visibility_state, visibility_epoch) VALUES ($1, $2, $3, $4, $5)`,
      [randomUUID(), tripId, title, visibilityState, epoch]
    );
  } catch {
    // Lost the race to a concurrent creator (for example, someone loading the private blog view
    // at the same moment) — fall back to the update now that the row exists.
    await queryBlog(
      `UPDATE trip_blogs SET visibility_state = $2, visibility_epoch = $3, updated_at = NOW() WHERE trip_id = $1`,
      [tripId, visibilityState, epoch]
    );
  }
};
// Same update-then-insert pattern as syncBlogVisibility, for the same pg-mem ON CONFLICT +
// auto-generated-UUID-PK limitation — this pre-existing alias upsert was never previously
// exercised by any test, so the incompatibility was latent until now.
// mode 'force' mirrors the original ON CONFLICT ... DO UPDATE SET canonical = <value> (always
// applies the given canonical flag). mode 'insertOnly' mirrors ON CONFLICT ... DO NOTHING (only
// creates the row if missing; never downgrades an alias that's already canonical).
const upsertPublicAlias = async (tripId: string, userId: string, usernameSlug: string, tripSlug: string, canonical: boolean, mode: 'force' | 'insertOnly'): Promise<void> => {
  if (mode === 'force') {
    const updated = await queryBlog(
      `UPDATE blog_public_aliases SET canonical = $5 WHERE username_slug = $3 AND trip_slug = $4`,
      [tripId, userId, usernameSlug, tripSlug, canonical]
    );
    if (updated.rowCount) return;
  } else {
    const existing = await queryBlog('SELECT 1 FROM blog_public_aliases WHERE username_slug = $1 AND trip_slug = $2', [usernameSlug, tripSlug]);
    if (existing.rows[0]) return;
  }
  try {
    await queryBlog(
      `INSERT INTO blog_public_aliases (id, trip_id, user_id, username_slug, trip_slug, canonical) VALUES ($1, $2, $3, $4, $5, $6)`,
      [randomUUID(), tripId, userId, usernameSlug, tripSlug, canonical]
    );
  } catch {
    // Lost the race to a concurrent request for the same alias.
  }
};
const eligibleAdults = async (tripId: string): Promise<{ adults: string[]; missingBirthDate: number }> => {
  const result = await queryBlog<{ user_id: string }>(`SELECT DISTINCT gm.user_id FROM trips t JOIN group_members gm ON gm.group_id = t.group_id JOIN users u ON u.id = gm.user_id WHERE t.id = $1 AND gm.removed_at IS NULL AND gm.user_id IS NOT NULL AND u.date_of_birth IS NOT NULL AND u.date_of_birth <= CURRENT_DATE - INTERVAL '16 years'`, [tripId]);
  const missing = await queryBlog<{ count: string }>(`SELECT COUNT(*) AS count FROM trips t JOIN group_members gm ON gm.group_id = t.group_id JOIN users u ON u.id = gm.user_id WHERE t.id = $1 AND gm.removed_at IS NULL AND gm.user_id IS NOT NULL AND u.date_of_birth IS NULL`, [tripId]);
  return { adults: result.rows.map((r) => String(r.user_id)), missingBirthDate: Number(missing.rows[0]?.count ?? 0) };
};

router.get('/:tripId/blog/publication/status', authenticate, async (req: any, res) => {
  try {
    if (!(await isFeatureEnabled('trip_blog_public_sharing'))) return res.status(404).json({ error: 'Public sharing is not enabled' });
    const userId = String(req.user.userId);
    if (getCurrentDbProvider() === 'firebase') return res.json(await getPublicationStatusFirebase(req.params.tripId, userId));
    if (!(await ensureUserInTrip(req.params.tripId, userId))) return res.status(403).json({ error: 'Not authorized' });
    const latest = await queryBlog<any>(
      'SELECT id, epoch, state, requested_by, expires_at FROM blog_publication_epochs WHERE trip_id = $1 ORDER BY epoch DESC LIMIT 1',
      [req.params.tripId]
    );
    if (!latest.rows[0]) return res.json({ epoch: null, state: 'private', userDecision: null, pendingCount: 0 });
    const epoch = latest.rows[0];
    const [consent, pending] = await Promise.all([
      queryBlog<{ decision: string }>('SELECT decision FROM blog_publication_consents WHERE epoch_id = $1 AND user_id = $2', [epoch.id, userId]),
      queryBlog<{ count: string }>("SELECT COUNT(*) AS count FROM blog_publication_consents WHERE epoch_id = $1 AND decision = 'pending'", [epoch.id]),
    ]);
    res.json({
      epoch: Number(epoch.epoch),
      state: epoch.state,
      // requested_by is nullable since 20260901_add_blog_publication_requested_by_nullable.sql
      // (ON DELETE SET NULL) — the requesting account may since have been deleted.
      requestedBy: epoch.requested_by == null ? null : String(epoch.requested_by),
      expiresAt: epoch.expires_at,
      userDecision: consent.rows[0]?.decision ?? null,
      pendingCount: Number(pending.rows[0]?.count ?? 0),
    });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

router.post('/:tripId/blog/publication/request', authenticate, async (req: any, res) => {
  try {
    if (!(await isFeatureEnabled('trip_blog_public_sharing'))) return res.status(404).json({ error: 'Public sharing is not enabled' });
    const userId = String(req.user.userId); if (!(await ensureUserInTrip(req.params.tripId, userId))) return res.status(403).json({ error: 'Not authorized' });
    if (await isFeatureEnabled('trip_blog_alt_text')) {
      await reserveApiUsageOrThrow({ provider: 'TRIP_BLOG_SOCIAL_API', caller: 'BLOG_PUBLICATION_READINESS_READ', requireConfiguredLimit: true });
      await reserveApiUsageOrThrow({ provider: 'TRIP_BLOG_SOCIAL_STORAGE', caller: 'DATABASE_READ_UNIT', requireConfiguredLimit: true });
      const issues = await blogMediaRepository().listPublicationAccessibilityIssues(userId, req.params.tripId);
      if (issues.length) return res.status(422).json({ error: 'Add alt text or mark each public photo decorative before publishing', code: 'ALT_TEXT_REQUIRED', issues: issues.slice(0, 50), remaining: Math.max(0, issues.length - 50) });
    }
    if (getCurrentDbProvider() === 'firebase') return res.status(201).json(await requestPublicationFirebase(req.params.tripId, userId));
    const eligibility = await eligibleAdults(req.params.tripId);
    if (eligibility.missingBirthDate > 0) return res.status(409).json({ error: 'Every account traveler must complete the date-of-birth profile before public consent can be requested', code: 'PROFILE_COMPLETION_REQUIRED' });
    const adults = eligibility.adults.filter((id) => id !== userId);
    const prior = await queryBlog<{ epoch: number }>('SELECT COALESCE(MAX(epoch), 0) AS epoch FROM blog_publication_epochs WHERE trip_id = $1', [req.params.tripId]);
    const epoch = Number(prior.rows[0]?.epoch ?? 0) + 1; const epochId = randomUUID();
    await queryBlog(`INSERT INTO blog_publication_epochs (id, trip_id, epoch, state, requested_by, expires_at) VALUES ($1, $2, $3, 'pending_consent', $4, NOW() + INTERVAL '14 days')`, [epochId, req.params.tripId, epoch, userId]);
    await queryBlog(`INSERT INTO blog_publication_consents (epoch_id, user_id, decision, decided_at) VALUES ($1, $2, 'approved', NOW())`, [epochId, userId]);
    for (const adult of adults) await queryBlog(`INSERT INTO blog_publication_consents (epoch_id, user_id, decision) VALUES ($1, $2, 'pending')`, [epochId, adult]);
    if (adults.length === 0) {
      await queryBlog(`UPDATE blog_publication_epochs SET state = 'public', updated_at = NOW() WHERE id = $1`, [epochId]);
      await syncBlogVisibility(req.params.tripId, epoch, 'public');
    } else {
      await syncBlogVisibility(req.params.tripId, epoch, 'pending_consent');
    }
    const identity = await queryBlog<{ username: string; trip_name: string }>('SELECT u.username, t.name AS trip_name FROM users u JOIN trips t ON t.id = $2 WHERE u.id = $1', [userId, req.params.tripId]);
    if (identity.rows[0]) await upsertPublicAlias(req.params.tripId, userId, slug(identity.rows[0].username), slug(identity.rows[0].trip_name), true, 'force');
    res.status(201).json({ epoch, state: adults.length ? 'pending_consent' : 'public', pendingCount: adults.length });
  } catch (err) {
    const error = err as any;
    res.status(error instanceof ApiLimitExceededError ? 429 : error?.code === 'PROFILE_COMPLETION_REQUIRED' ? 409 : 400).json({ error: error?.message ?? 'Unable to request publication', ...(error?.code ? { code: error.code } : {}) });
  }
});

router.post('/:tripId/blog/publication/:epoch/consent', authenticate, async (req: any, res) => {
  try {
    const userId = String(req.user.userId); if (!(await ensureUserInTrip(req.params.tripId, userId))) return res.status(403).json({ error: 'Not authorized' });
    const decision = req.body?.decision === 'approved' ? 'approved' : req.body?.decision === 'declined' ? 'declined' : '';
    if (!decision) return res.status(400).json({ error: 'decision must be approved or declined' });
    if (getCurrentDbProvider() === 'firebase') {
      await consentPublicationFirebase(req.params.tripId, Number(req.params.epoch), userId, decision);
      return res.status(204).end();
    }
    const epoch = await queryBlog<any>('SELECT * FROM blog_publication_epochs WHERE trip_id = $1 AND epoch = $2', [req.params.tripId, Number(req.params.epoch)]); if (!epoch.rows[0]) return res.status(404).json({ error: 'Publication request not found' });
    await queryBlog('UPDATE blog_publication_consents SET decision = $3, decided_at = NOW() WHERE epoch_id = $1 AND user_id = $2', [epoch.rows[0].id, userId, decision]);
    if (decision === 'approved') {
      const identity = await queryBlog<{ username: string; trip_name: string }>('SELECT u.username, t.name AS trip_name FROM users u JOIN trips t ON t.id = $2 WHERE u.id = $1', [userId, req.params.tripId]);
      if (identity.rows[0]) await upsertPublicAlias(req.params.tripId, userId, slug(identity.rows[0].username), slug(identity.rows[0].trip_name), false, 'insertOnly');
    }
    if (decision === 'declined') {
      await queryBlog(`UPDATE blog_publication_epochs SET state = 'expired', updated_at = NOW() WHERE id = $1 AND state = 'pending_consent'`, [epoch.rows[0].id]);
      await syncBlogVisibility(req.params.tripId, Number(epoch.rows[0].epoch), 'declined');
    } else {
      const pending = await queryBlog<{ count: string }>(`SELECT COUNT(*) AS count FROM blog_publication_consents WHERE epoch_id = $1 AND decision = 'pending'`, [epoch.rows[0].id]);
      if (Number(pending.rows[0]?.count ?? 0) === 0) {
        await queryBlog(`UPDATE blog_publication_epochs SET state = 'public', updated_at = NOW() WHERE id = $1 AND state = 'pending_consent'`, [epoch.rows[0].id]);
        await syncBlogVisibility(req.params.tripId, Number(epoch.rows[0].epoch), 'public');
      }
    }
    res.status(204).end();
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});

router.post('/:tripId/blog/publication/revoke', authenticate, async (req: any, res) => {
  try {
    const userId = String(req.user.userId); if (!(await ensureUserInTrip(req.params.tripId, userId))) return res.status(403).json({ error: 'Not authorized' });
    if (getCurrentDbProvider() === 'firebase') {
      await revokePublicationFirebase(req.params.tripId, userId);
      return res.status(204).end();
    }
    const revoked = await queryBlog<{ epoch: number }>(`UPDATE blog_publication_epochs SET state = 'revoked', revoked_by = $2, updated_at = NOW() WHERE trip_id = $1 AND state = 'public' RETURNING epoch`, [req.params.tripId, userId]);
    if (revoked.rows[0]) await syncBlogVisibility(req.params.tripId, Number(revoked.rows[0].epoch), 'revoked');
    res.status(204).end();
  }
  catch (err) { res.status(400).json({ error: (err as Error).message }); }
});
export default router;
