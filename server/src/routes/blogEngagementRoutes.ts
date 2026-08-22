import { Router } from 'express';
import { authenticate } from '../auth';
import { isFeatureEnabled } from '../services/entitlementService';
import { HttpRateLimitExceededError, reserveBlogReactionRateLimit } from '../services/httpRateLimitService';
import { ApiLimitConfigurationError, ApiLimitExceededError } from '../apis/usageLimiter';
import {
  BlogEngagementUnauthorizedError,
  BlogTargetNotFoundError,
  clearReactionOnTarget,
  listReactorsForTarget,
  reactToTarget,
} from '../services/blogEngagementService';
import { BLOG_REACTION_EMOJIS, BlogEngagementTargetKind, BlogReactionEmoji } from '../blog/engagementTypes';

// Phase 3 of docs/trip-blog-social-implementation-plan.md — the first user-visible social
// surface. Architecture §5.1 rows 1–3 only (reactions); comments are Phase 4.
//
// Every handler below follows the same error-mapping convention: BlogEngagementUnauthorizedError
// (no relationship to the trip at all, or a trip-level toggle blocks the action) → 403;
// BlogTargetNotFoundError (target doesn't exist, or exists but isn't visible to this actor —
// architecture §4 step 3, "the endpoint does not confirm the item exists") → 404;
// HttpRateLimitExceededError → 429 with Retry-After; ApiLimitExceededError (the shared
// TRIP_BLOG_SOCIAL_API aggregate cap) → 429; anything else → 500. This mirrors the existing
// convention in blogRoutes.ts's errorResponse, kept local here since the error classes this route
// group needs to distinguish are specific to the engagement service, not the blog document one.

const router = Router();
router.use(authenticate);

const userIdOf = (req: any): string => String(req.user?.userId ?? '');
const clientIp = (req: any): string | null => (req.ip || req.socket?.remoteAddress || null);

const isValidTargetKind = (value: unknown): value is BlogEngagementTargetKind =>
  value === 'day' || value === 'item' || value === 'asset';

const isValidEmoji = (value: unknown): value is BlogReactionEmoji =>
  BLOG_REACTION_EMOJIS.includes(value as BlogReactionEmoji);

const engagementErrorResponse = (res: any, err: any): void => {
  if (err instanceof HttpRateLimitExceededError) {
    res.setHeader('Retry-After', String(err.retryAfterSeconds));
    res.status(429).json({ error: err.message });
    return;
  }
  if (err instanceof ApiLimitExceededError) {
    res.status(429).json({ error: 'Trip blog reactions are at capacity right now — please try again shortly' });
    return;
  }
  if (err instanceof ApiLimitConfigurationError) {
    res.status(500).json({ error: 'Trip blog reactions are not fully configured' });
    return;
  }
  if (err instanceof BlogEngagementUnauthorizedError) {
    res.status(403).json({ error: err.message });
    return;
  }
  if (err instanceof BlogTargetNotFoundError) {
    res.status(404).json({ error: err.message });
    return;
  }
  const message = String(err?.message ?? 'Unable to process this request');
  if (process.env.NODE_ENV !== 'production') console.error('[blog-engagement] request failed', message);
  res.status(500).json({ error: message });
};

const requireReactionsEnabled = async (res: any): Promise<boolean> => {
  if (!(await isFeatureEnabled('trip_blog_social_layer')) || !(await isFeatureEnabled('trip_blog_reactions'))) {
    res.status(404).json({ error: 'Trip blog reactions are not enabled' });
    return false;
  }
  return true;
};

// PUT idempotently sets/replaces the reaction — never toggles off on a repeat call with the same
// emoji (architecture §5.1, revised after Phase 2 — see the comment on upsertReaction in
// postgresEngagementRepository.ts). The client implements re-tap-to-clear by calling DELETE.
router.put('/:tripId/blog/:targetKind/:targetId/reactions', async (req, res) => {
  try {
    if (!(await requireReactionsEnabled(res))) return;
    if (!isValidTargetKind(req.params.targetKind)) {
      res.status(400).json({ error: 'targetKind must be one of day, item, asset' });
      return;
    }
    if (!isValidEmoji(req.body?.emoji)) {
      res.status(400).json({ error: `emoji must be one of ${BLOG_REACTION_EMOJIS.join(', ')}` });
      return;
    }
    await reserveBlogReactionRateLimit(userIdOf(req), clientIp(req));
    const { summary } = await reactToTarget(req.params.tripId, userIdOf(req), req.params.targetKind, req.params.targetId, req.body.emoji);
    res.json(summary);
  } catch (err) {
    engagementErrorResponse(res, err);
  }
});

router.delete('/:tripId/blog/:targetKind/:targetId/reactions', async (req, res) => {
  try {
    if (!(await requireReactionsEnabled(res))) return;
    if (!isValidTargetKind(req.params.targetKind)) {
      res.status(400).json({ error: 'targetKind must be one of day, item, asset' });
      return;
    }
    await reserveBlogReactionRateLimit(userIdOf(req), clientIp(req));
    const { summary } = await clearReactionOnTarget(req.params.tripId, userIdOf(req), req.params.targetKind, req.params.targetId);
    res.json(summary);
  } catch (err) {
    engagementErrorResponse(res, err);
  }
});

// Reactor list — only called when a user expands the summary, never on page load
// (architecture §5.1). Paginated; server-clamped limit inside listReactors.
router.get('/:tripId/blog/:targetKind/:targetId/reactions', async (req, res) => {
  try {
    if (!(await requireReactionsEnabled(res))) return;
    if (!isValidTargetKind(req.params.targetKind)) {
      res.status(400).json({ error: 'targetKind must be one of day, item, asset' });
      return;
    }
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const reactors = await listReactorsForTarget(req.params.tripId, userIdOf(req), req.params.targetKind, req.params.targetId, { cursor, limit });
    res.json({ reactors });
  } catch (err) {
    engagementErrorResponse(res, err);
  }
});

export default router;
