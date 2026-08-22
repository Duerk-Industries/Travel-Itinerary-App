import { Router } from 'express';
import { authenticate } from '../auth';
import { isFeatureEnabled } from '../services/entitlementService';
import { HttpRateLimitExceededError, reserveBlogCommentRateLimit, reserveBlogReactionRateLimit } from '../services/httpRateLimitService';
import { ApiLimitConfigurationError, ApiLimitExceededError } from '../apis/usageLimiter';
import {
  BlogEngagementUnauthorizedError,
  BlogTargetNotFoundError,
  clearReactionOnTarget,
  deleteComment,
  editComment,
  listCommentsForDay,
  listReactorsForTarget,
  listRepliesForComment,
  postComment,
  reactToTarget,
  reportCommentByActor,
} from '../services/blogEngagementService';
import { hideCommentAsModerator, unhideCommentAsModerator } from '../services/blogModerationService';
import { BLOG_REACTION_EMOJIS, BlogEngagementTargetKind, BlogReactionEmoji } from '../blog/engagementTypes';

// Phase 3/4 of docs/trip-blog-social-implementation-plan.md — the reaction routes (Phase 3,
// architecture §5.1 rows 1–3) and the comment routes (Phase 4, rows 4–11). Mentions and realtime
// delivery are Phase 4.6, not built here — see blogEngagementService.ts's postComment, which
// accepts a body/parentCommentId/idempotencyKey but no mentions array yet.
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

const requireCommentsEnabled = async (res: any): Promise<boolean> => {
  if (!(await isFeatureEnabled('trip_blog_social_layer')) || !(await isFeatureEnabled('trip_blog_comments'))) {
    res.status(404).json({ error: 'Trip blog comments are not enabled' });
    return false;
  }
  return true;
};

const VALID_REPORT_REASONS = ['spam', 'harassment', 'private_info', 'other'];
const isValidReportReason = (value: unknown): value is 'spam' | 'harassment' | 'private_info' | 'other' =>
  VALID_REPORT_REASONS.includes(value as string);

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

// --- Comments (Phase 4) --------------------------------------------------------------------

// Day-level fetch, architecture §5.1: one request per day, not one per target — a day with 23
// photos, 3 notes and a day-level thread must not become 27 requests. Each returned top-level
// comment carries up to 3 preview replies and its own replyCount.
router.get('/:tripId/blog/comments', async (req, res) => {
  try {
    if (!(await requireCommentsEnabled(res))) return;
    const dayDate = typeof req.query.dayDate === 'string' ? req.query.dayDate : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayDate)) {
      res.status(400).json({ error: 'dayDate is required' });
      return;
    }
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const comments = await listCommentsForDay(req.params.tripId, userIdOf(req), dayDate, { cursor, limit });
    res.json({ comments });
  } catch (err) {
    engagementErrorResponse(res, err);
  }
});

router.get('/:tripId/blog/comments/:commentId/replies', async (req, res) => {
  try {
    if (!(await requireCommentsEnabled(res))) return;
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const replies = await listRepliesForComment(req.params.tripId, userIdOf(req), req.params.commentId, { cursor, limit });
    res.json({ replies });
  } catch (err) {
    engagementErrorResponse(res, err);
  }
});

// Idempotency-Key required (architecture §5.1) — actually enforced, not just acknowledged: a
// retried POST with the same key returns the original comment (postgresEngagementRepository.ts's
// createComment / the equivalent Firestore query).
router.post('/:tripId/blog/:targetKind/:targetId/comments', async (req, res) => {
  try {
    if (!(await requireCommentsEnabled(res))) return;
    if (!isValidTargetKind(req.params.targetKind)) {
      res.status(400).json({ error: 'targetKind must be one of day, item, asset' });
      return;
    }
    const idempotencyKey = String(req.header('Idempotency-Key') ?? '').trim();
    if (!idempotencyKey) {
      res.status(400).json({ error: 'Idempotency-Key is required' });
      return;
    }
    const body = String(req.body?.body ?? '');
    if (!body.trim()) {
      res.status(400).json({ error: 'A comment body is required' });
      return;
    }
    await reserveBlogCommentRateLimit(userIdOf(req), clientIp(req));
    const comment = await postComment(
      req.params.tripId, userIdOf(req), req.params.targetKind, req.params.targetId,
      body, req.body?.parentCommentId ?? null, idempotencyKey
    );
    res.status(201).json(comment);
  } catch (err) {
    engagementErrorResponse(res, err);
  }
});

// 15-minute edit window (FR-B2.3), enforced server-side inside updateCommentBody, not here.
router.patch('/:tripId/blog/comments/:commentId', async (req, res) => {
  try {
    if (!(await requireCommentsEnabled(res))) return;
    const body = String(req.body?.body ?? '');
    if (!body.trim()) {
      res.status(400).json({ error: 'A comment body is required' });
      return;
    }
    const comment = await editComment(req.params.tripId, userIdOf(req), req.params.commentId, body);
    res.json(comment);
  } catch (err) {
    engagementErrorResponse(res, err);
  }
});

// Soft delete — FR-B2.4's tombstone rule is decided inside softDeleteComment, not here.
router.delete('/:tripId/blog/comments/:commentId', async (req, res) => {
  try {
    if (!(await requireCommentsEnabled(res))) return;
    await deleteComment(req.params.tripId, userIdOf(req), req.params.commentId);
    res.status(204).end();
  } catch (err) {
    engagementErrorResponse(res, err);
  }
});

// FR-B11.1: every viewer except the author may report. Never auto-hides (threat S8) — a human
// (the hide route below) always decides.
router.post('/:tripId/blog/comments/:commentId/report', async (req, res) => {
  try {
    if (!(await requireCommentsEnabled(res))) return;
    if (!isValidReportReason(req.body?.reason)) {
      res.status(400).json({ error: `reason must be one of ${VALID_REPORT_REASONS.join(', ')}` });
      return;
    }
    const detail = req.body?.detail == null ? null : String(req.body.detail).slice(0, 1000);
    await reportCommentByActor(req.params.tripId, userIdOf(req), req.params.commentId, req.body.reason, detail);
    res.status(204).end();
  } catch (err) {
    engagementErrorResponse(res, err);
  }
});

// Owner/admin only — deliberately not gated by requireCommentsEnabled's membership-based flag
// check alone; hideCommentAsModerator applies its own trip-owner-or-admin authorization
// (architecture §4: "Admin access is deliberately narrower than trip-owner access"), which is a
// stricter, separate gate from the traveler/follower membership every other route here checks.
router.post('/:tripId/blog/comments/:commentId/hide', async (req: any, res) => {
  try {
    if (!(await requireCommentsEnabled(res))) return;
    const comment = await hideCommentAsModerator(req.params.tripId, userIdOf(req), req.user?.role, req.params.commentId, clientIp(req));
    res.json(comment);
  } catch (err) {
    engagementErrorResponse(res, err);
  }
});

// Reverses one hide/strike idempotently (architecture §5.1 DELETE .../hide row).
router.delete('/:tripId/blog/comments/:commentId/hide', async (req: any, res) => {
  try {
    if (!(await requireCommentsEnabled(res))) return;
    const comment = await unhideCommentAsModerator(req.params.tripId, userIdOf(req), req.user?.role, req.params.commentId, clientIp(req));
    res.json(comment);
  } catch (err) {
    engagementErrorResponse(res, err);
  }
});

export default router;
