import { ensureUserInTrip, ensureUserFollowsTrip } from '../db';
import { queryBlog } from '../db.postgres';
import { blogRepository } from '../blog/repository';
import { blogEngagementRepository } from '../blog/engagementRepository';
import { reserveApiUsageOrThrow } from '../apis/usageLimiter';
import { checkSpam } from './blogModerationService';
import { BlogAudience } from '../blog/types';
import {
  BlogCommentAuthorRole,
  BlogComment,
  BlogEngagementSummary,
  BlogEngagementTargetKind,
  BlogReactionEmoji,
  ResolvedComment,
  ResolvedEngagementTarget,
} from '../blog/engagementTypes';
import { BlogEngagementUnauthorizedError, BlogTargetNotFoundError } from './blogEngagementErrors';

export { BlogEngagementUnauthorizedError, BlogTargetNotFoundError };

// Phase 2 of docs/trip-blog-social-implementation-plan.md — the authorization spine. Phase 4 adds
// the comment write path (postComment below) and its automated spam check; hide/unhide are a
// trip-owner/admin action and live in blogModerationService.ts instead, since they answer a
// different authorization question than everything else in this file (see that file's header
// comment). See docs/trip-blog-social-architecture.md §4 for the authorization table and the
// 8-step resolution order. One step is still deliberately not implemented here:
//   - Step 7 (per-request rate limiting via httpRateLimitService) — that needs request/IP context
//     this service layer doesn't have. It belongs on the route, the same way isFeatureEnabled and
//     ensureUserInTrip are already called inline in every existing blogRoutes.ts handler rather
//     than through a generic middleware wrapper (see e.g. blogSocialRoutes.ts).

export type EngagementMembership = 'traveler' | 'follower';

// Step 2 of the resolution order: is this actor a traveler or a follower of this trip at all.
// Neither → BlogEngagementUnauthorizedError (403); a real trip-level relationship is required
// before target-level visibility (step 3) is even evaluated. This mirrors ensureUserCanReadTrip's
// combined member/follower resolution but keeps the two checks as separate calls rather than
// reusing that function directly — resolveEngagementTarget needs to know *which* one matched, not
// merely that access exists, and a second dedicated query is cheap next to everything else this
// function already does.
export const resolveActorMembership = async (tripId: string, userId: string): Promise<EngagementMembership> => {
  if (await ensureUserInTrip(tripId, userId)) return 'traveler';
  if (await ensureUserFollowsTrip(tripId, userId)) return 'follower';
  throw new BlogEngagementUnauthorizedError();
};

type TargetRow = { dayId: string; tripId: string; audience: BlogAudience | null; ready: boolean };

const resolveDayTarget = async (tripId: string, dayId: string): Promise<TargetRow | null> => {
  const result = await queryBlog<{ id: string; trip_id: string }>('SELECT id, trip_id FROM blog_days WHERE id = $1', [dayId]);
  const row = result.rows[0];
  if (!row || String(row.trip_id) !== tripId) return null;
  return { dayId: String(row.id), tripId, audience: null, ready: true };
};

const resolveItemTarget = async (tripId: string, itemId: string): Promise<TargetRow | null> => {
  const result = await queryBlog<{ id: string; trip_id: string; blog_day_id: string; audience: BlogAudience }>(
    'SELECT id, trip_id, blog_day_id, audience FROM blog_items WHERE id = $1 AND deleted_at IS NULL',
    [itemId]
  );
  const row = result.rows[0];
  if (!row || String(row.trip_id) !== tripId) return null;
  return { dayId: String(row.blog_day_id), tripId, audience: row.audience, ready: true };
};

const resolveAssetTarget = async (tripId: string, assetId: string): Promise<TargetRow | null> => {
  // Same join shape as setDayCover in postgresRepository.ts: an asset's day/audience is only
  // reachable through its parent blog_items row (every asset, gallery member or standalone, has
  // exactly one via blog_item_assets — see the comment on that table's usage in blogRoutes.ts).
  // `state = 'ready'` excludes grace-hidden and still-processing assets, matching the existing
  // convention that such assets are simply absent from the day's `items` in GET /:tripId/blog.
  const result = await queryBlog<{ id: string; trip_id: string; blog_day_id: string; audience: BlogAudience }>(
    `SELECT a.id, a.trip_id, i.blog_day_id, i.audience
     FROM blog_media_assets a
     JOIN blog_item_assets ia ON ia.asset_id = a.id
     JOIN blog_items i ON i.id = ia.item_id AND i.deleted_at IS NULL
     WHERE a.id = $1 AND a.state = 'ready'`,
    [assetId]
  );
  const row = result.rows[0];
  if (!row || String(row.trip_id) !== tripId) return null;
  return { dayId: String(row.blog_day_id), tripId, audience: row.audience, ready: true };
};

// Step 3 of the resolution order, and the single load-bearing function in this file: the exact
// `resolveEngagementTarget(actor, tripId, targetKind, targetId)` architecture §4 names, returning
// `{ dayId, effectiveAudience } | null` (here, `ResolvedEngagementTarget | null`). Every future
// engagement route must call this — there is no second path to a target (architecture §4).
//
// A follower attempting to react to a `travelers`-audience item returns `null` here (→ 404 at the
// route), not a distinguishable "found but forbidden" — the endpoint must not confirm the item
// exists to someone who isn't allowed to see it (architecture §4, threat model consistent with
// the rest of this feature's audience projection).
export const resolveEngagementTarget = async (
  tripId: string,
  actorUserId: string,
  membership: EngagementMembership,
  targetKind: BlogEngagementTargetKind,
  targetId: string
): Promise<ResolvedEngagementTarget | null> => {
  const row = targetKind === 'day' ? await resolveDayTarget(tripId, targetId)
    : targetKind === 'item' ? await resolveItemTarget(tripId, targetId)
    : await resolveAssetTarget(tripId, targetId);
  if (!row) return null;

  let effectiveAudience: BlogAudience;
  if (targetKind === 'day') {
    // A day has no audience column of its own — architecture §4.1: public only while the blog is
    // published; a traveler's engagement is `travelers`, a follower's is `followers`, both frozen
    // at creation regardless of what publication does afterward.
    const isPublic = await blogRepository().isBlogPublic(tripId);
    effectiveAudience = isPublic ? 'public' : membership === 'traveler' ? 'travelers' : 'followers';
  } else {
    // Item/asset targets inherit the existing audience already on that item (architecture §4.1:
    // "an asset can never widen its parent"). A follower may not engage with a `travelers`-only
    // item/asset — same visibility rule the read path already applies when projecting a day's
    // items to a follower.
    effectiveAudience = row.audience ?? 'public';
    if (membership === 'follower' && effectiveAudience === 'travelers') return null;
  }

  return { tripId, targetKind, targetId, dayId: row.dayId, effectiveAudience };
};

// The parallel, equally mandatory resolver for comment-id routes (PATCH/DELETE/report/hide),
// which take a *comment* id rather than a target id and so cannot go through
// resolveEngagementTarget above — architecture §4's explicit warning that this pairing is "the
// gap most likely to become an IDOR" (see threat S3, §15.1). Two functions, no third path.
export const resolveComment = async (
  tripId: string,
  actorUserId: string,
  membership: EngagementMembership,
  commentId: string
): Promise<ResolvedComment | null> => {
  const comment = await blogEngagementRepository().getCommentById(commentId);
  if (!comment || comment.tripId !== tripId || comment.deletedAt) return null;
  if (membership === 'follower' && comment.audience === 'travelers') return null;
  return {
    comment,
    target: { tripId, targetKind: comment.targetKind, targetId: comment.targetId, dayId: '', effectiveAudience: comment.audience },
  };
};

// Step 5: the trip owner's kill switch for follower commenting (PRD §8 decision 1). Travelers are
// never subject to it — only follower-authored comment *creation*; existing follower comments
// remain readable per their own audience regardless of this toggle (architecture §3.3).
const isFollowerCommentingEnabled = async (tripId: string): Promise<boolean> => {
  const result = await queryBlog<{ follower_comments_enabled: boolean }>(
    'SELECT follower_comments_enabled FROM trip_blogs WHERE trip_id = $1',
    [tripId]
  );
  return result.rows[0]?.follower_comments_enabled !== false;
};

// Step 6: three hides on a trip ends commenting there for that user (FR-B11.3). Read-only in this
// phase — incrementing a strike is a Phase 3/4 moderation-endpoint concern (blogModerationService,
// paired with the hide route), but the block state this reads is checked here regardless, since
// the schema and the read side are both already real.
const assertNotStrikeBlocked = async (tripId: string, userId: string): Promise<void> => {
  const state = await blogEngagementRepository().getStrikeState(tripId, userId);
  if (state.blockedAt) throw new BlogEngagementUnauthorizedError('Commenting is blocked on this trip for this account');
};

// Full write-path orchestration for a reaction — steps 2, 3, 5 (n/a for reactions), 8, then the
// repository write. Step 4 (spam filtering) doesn't apply to reactions at all; step 7 (rate
// limiting) is the caller's responsibility, as noted at the top of this file.
// The audience set a given membership level may see summed together (architecture §3.2): a
// traveler sees everything ever posted on this trip; a follower sees only what was ever posted
// as followers/public. Used to build the "full summary" §5.1 says PUT/DELETE must return.
export const visibleAudiencesForMembership = (membership: EngagementMembership): BlogAudience[] =>
  membership === 'traveler' ? ['travelers', 'followers', 'public'] : ['followers', 'public'];

export const reactToTarget = async (
  tripId: string,
  actorUserId: string,
  targetKind: BlogEngagementTargetKind,
  targetId: string,
  emoji: BlogReactionEmoji
): Promise<{ target: ResolvedEngagementTarget; summary: BlogEngagementSummary }> => {
  const membership = await resolveActorMembership(tripId, actorUserId);
  const target = await resolveEngagementTarget(tripId, actorUserId, membership, targetKind, targetId);
  if (!target) throw new BlogTargetNotFoundError();
  await reserveApiUsageOrThrow({ provider: 'TRIP_BLOG_SOCIAL_API', caller: 'BLOG_REACTION_WRITE', requireConfiguredLimit: true });
  await blogEngagementRepository().upsertReaction(tripId, actorUserId, targetKind, targetId, emoji, target.effectiveAudience);
  const summaries = await blogEngagementRepository().getEngagementSummaries(actorUserId, [{ targetKind, targetId }], visibleAudiencesForMembership(membership));
  return { target, summary: summaries[`${targetKind}:${targetId}`] };
};

export const clearReactionOnTarget = async (
  tripId: string,
  actorUserId: string,
  targetKind: BlogEngagementTargetKind,
  targetId: string
): Promise<{ target: ResolvedEngagementTarget; summary: BlogEngagementSummary }> => {
  const membership = await resolveActorMembership(tripId, actorUserId);
  const target = await resolveEngagementTarget(tripId, actorUserId, membership, targetKind, targetId);
  if (!target) throw new BlogTargetNotFoundError();
  await reserveApiUsageOrThrow({ provider: 'TRIP_BLOG_SOCIAL_API', caller: 'BLOG_REACTION_WRITE', requireConfiguredLimit: true });
  await blogEngagementRepository().clearReaction(tripId, actorUserId, targetKind, targetId, target.effectiveAudience);
  const summaries = await blogEngagementRepository().getEngagementSummaries(actorUserId, [{ targetKind, targetId }], visibleAudiencesForMembership(membership));
  return { target, summary: summaries[`${targetKind}:${targetId}`] };
};

// GET .../reactions — only called when a user expands the summary, never on page load
// (architecture §5.1). No target-resolution gate beyond membership: the reactor list for a target
// the caller can't see would leak its existence, so this still needs resolveEngagementTarget.
export const listReactorsForTarget = async (
  tripId: string,
  actorUserId: string,
  targetKind: BlogEngagementTargetKind,
  targetId: string,
  options: { cursor?: string; limit?: number } = {}
) => {
  const membership = await resolveActorMembership(tripId, actorUserId);
  const target = await resolveEngagementTarget(tripId, actorUserId, membership, targetKind, targetId);
  if (!target) throw new BlogTargetNotFoundError();
  return blogEngagementRepository().listReactors(targetKind, targetId, options);
};

// Full write-path orchestration for a comment — steps 2, 3, 5, 6, 8, then the repository write.
// Step 4 (automated spam filtering) is the one gap noted at the top of this file: a
// `trip_blog_comments`-flagged deployment today would rely entirely on the report/hide path
// (Phase 3/4) rather than pre-publication filtering.
export const postComment = async (
  tripId: string,
  actorUserId: string,
  targetKind: BlogEngagementTargetKind,
  targetId: string,
  body: string,
  parentCommentId?: string | null,
  idempotencyKey?: string | null
): Promise<BlogComment> => {
  const membership = await resolveActorMembership(tripId, actorUserId);
  const target = await resolveEngagementTarget(tripId, actorUserId, membership, targetKind, targetId);
  if (!target) throw new BlogTargetNotFoundError();
  if (membership === 'follower' && !(await isFollowerCommentingEnabled(tripId))) {
    throw new BlogEngagementUnauthorizedError('Follower comments are disabled on this trip');
  }
  await assertNotStrikeBlocked(tripId, actorUserId);
  await reserveApiUsageOrThrow({ provider: 'TRIP_BLOG_SOCIAL_API', caller: 'BLOG_COMMENT_WRITE', requireConfiguredLimit: true });
  const authorRole: BlogCommentAuthorRole = membership;
  // NFR-12: automated spam filtering applies only to public-audience comments from a follower —
  // a traveler's comment is never checked (Phase 4's own test list is explicit: "traveler comment
  // with same keywords is NOT hidden, as travelers are trusted"). Flagged comments are still
  // created — the author sees their own comment — but hidden immediately, with no strike (a
  // strike is reserved for a human moderator's decision, per FR-B11.3; an automated false
  // positive should not silently march someone toward being blocked from commenting at all).
  const shouldCheckSpam = authorRole === 'follower' && target.effectiveAudience === 'public';
  const spamResult = shouldCheckSpam ? checkSpam(body) : { isSpam: false, reason: null };
  return blogEngagementRepository().createComment({
    tripId, targetKind, targetId, audience: target.effectiveAudience,
    authorUserId: actorUserId, authorRole, body, parentCommentId: parentCommentId ?? null,
    idempotencyKey: idempotencyKey ?? null,
    autoHiddenReason: spamResult.isSpam ? spamResult.reason : null,
  });
};

// Comment-id actions (edit/delete/report) — all route through resolveComment, never
// resolveEngagementTarget, per the IDOR note above. Hide is a trip-owner/admin action, not a
// traveler/follower one, so it is intentionally NOT here — see the "Admin access is deliberately
// narrower" note in architecture §4; that endpoint belongs with blogModerationService in Phase 3/4
// and needs its own, separate authorization path (owner-of-trip or admin, not membership).
export const editComment = async (tripId: string, actorUserId: string, commentId: string, body: string): Promise<BlogComment> => {
  const membership = await resolveActorMembership(tripId, actorUserId);
  const resolved = await resolveComment(tripId, actorUserId, membership, commentId);
  if (!resolved) throw new BlogTargetNotFoundError('That comment was not found');
  if (resolved.comment.authorUserId !== actorUserId) throw new BlogTargetNotFoundError('That comment was not found');
  const updated = await blogEngagementRepository().updateCommentBody(commentId, actorUserId, body);
  if (!updated) throw new BlogTargetNotFoundError('That comment was not found');
  return updated;
};

export const deleteComment = async (tripId: string, actorUserId: string, commentId: string): Promise<void> => {
  const membership = await resolveActorMembership(tripId, actorUserId);
  const resolved = await resolveComment(tripId, actorUserId, membership, commentId);
  if (!resolved) throw new BlogTargetNotFoundError('That comment was not found');
  if (resolved.comment.authorUserId !== actorUserId) throw new BlogTargetNotFoundError('That comment was not found');
  const deleted = await blogEngagementRepository().softDeleteComment(commentId, actorUserId);
  if (!deleted) throw new BlogTargetNotFoundError('That comment was not found');
};

export const reportCommentByActor = async (
  tripId: string,
  actorUserId: string,
  commentId: string,
  reason: 'spam' | 'harassment' | 'private_info' | 'other',
  detail?: string | null
): Promise<void> => {
  const membership = await resolveActorMembership(tripId, actorUserId);
  const resolved = await resolveComment(tripId, actorUserId, membership, commentId);
  if (!resolved) throw new BlogTargetNotFoundError('That comment was not found');
  // FR-B11.1: every viewer except the author may report. Reporting your own comment is simply
  // rejected rather than silently accepted — there is no moderation value in it and it would
  // otherwise let an author generate a "report" that reads as third-party.
  if (resolved.comment.authorUserId === actorUserId) throw new BlogEngagementUnauthorizedError('You cannot report your own comment');
  await blogEngagementRepository().reportComment(commentId, actorUserId, reason, detail ?? null);
};

const REPLY_PREVIEW_COUNT = 3; // architecture §5.1: "up to 3 preview replies"

// Day-level comment fetch (architecture §5.1): one HTTP request per day, not one per target — a
// day with 23 photos, 3 notes and a day-level thread must not become 27 requests. Internally this
// is still bounded, not a single query: one query for the day's top-level comments, then up to
// `commentPageSize` more (one per top-level comment) for their reply previews — the requirement is
// about round-trips from the client, not eliminating every internal query.
export const listCommentsForDay = async (
  tripId: string,
  actorUserId: string,
  dayDate: string,
  options: { cursor?: string; limit?: number } = {}
): Promise<Array<BlogComment & { replies: BlogComment[] }>> => {
  const membership = await resolveActorMembership(tripId, actorUserId);
  const dayRow = await queryBlog<{ id: string }>('SELECT id FROM blog_days WHERE trip_id = $1 AND local_date = $2::date', [tripId, dayDate]);
  if (!dayRow.rows[0]) throw new BlogTargetNotFoundError('That day was not found on this trip');
  const visibleAudiences = visibleAudiencesForMembership(membership);
  const topLevel = await blogEngagementRepository().listTopLevelCommentsForDay(tripId, dayRow.rows[0].id, visibleAudiences, options);
  return Promise.all(topLevel.map(async (comment) => ({
    ...comment,
    replies: await blogEngagementRepository().listReplies(comment.id, visibleAudiences, { limit: REPLY_PREVIEW_COUNT }),
  })));
};

export const listRepliesForComment = async (
  tripId: string,
  actorUserId: string,
  commentId: string,
  options: { cursor?: string; limit?: number } = {}
): Promise<BlogComment[]> => {
  const membership = await resolveActorMembership(tripId, actorUserId);
  const resolved = await resolveComment(tripId, actorUserId, membership, commentId);
  if (!resolved) throw new BlogTargetNotFoundError('That comment was not found');
  return blogEngagementRepository().listReplies(commentId, visibleAudiencesForMembership(membership), options);
};
