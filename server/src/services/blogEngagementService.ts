import { ensureUserInTrip, ensureUserFollowsTrip } from '../db';
import { queryBlog } from '../db.postgres';
import { blogRepository } from '../blog/repository';
import { blogEngagementRepository } from '../blog/engagementRepository';
import { reserveApiUsageOrThrow } from '../apis/usageLimiter';
import { checkSpam } from './blogModerationService';
import { notify } from './notificationService';
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
import { getIo } from '../socket';
import { logError } from '../logger';
import { isFeatureEnabled } from './entitlementService';

export { BlogEngagementUnauthorizedError, BlogTargetNotFoundError };

export type EngagementMembership = 'traveler' | 'follower';

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
    const isPublic = await blogRepository().isBlogPublic(tripId);
    effectiveAudience = isPublic ? 'public' : membership === 'traveler' ? 'travelers' : 'followers';
  } else {
    effectiveAudience = row.audience ?? 'public';
    if (membership === 'follower' && effectiveAudience === 'travelers') return null;
  }

  return { tripId, targetKind, targetId, dayId: row.dayId, effectiveAudience };
};

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

const isFollowerCommentingEnabled = async (tripId: string): Promise<boolean> => {
  const result = await queryBlog<{ follower_comments_enabled: boolean }>(
    'SELECT follower_comments_enabled FROM trip_blogs WHERE trip_id = $1',
    [tripId]
  );
  return result.rows[0]?.follower_comments_enabled !== false;
};

const assertNotStrikeBlocked = async (tripId: string, userId: string): Promise<void> => {
  const state = await blogEngagementRepository().getStrikeState(tripId, userId);
  if (state.blockedAt) throw new BlogEngagementUnauthorizedError('Commenting is blocked on this trip for this account');
};

export const visibleAudiencesForMembership = (membership: EngagementMembership): BlogAudience[] =>
  membership === 'traveler' ? ['travelers', 'followers', 'public'] : ['followers', 'public'];

const broadcastEngagement = (tripId: string, audience: BlogAudience, event: string, payload: any) => {
  const io = getIo();
  if (!io) return;
  io.to(`trip:${tripId}:travelers`).emit(event, payload);
  if (audience === 'followers' || audience === 'public') {
    io.to(`trip:${tripId}:followers`).emit(event, payload);
  }
};

const MILESTONE_THRESHOLDS = [10, 50, 100, 500];

const checkEngagementMilestones = async (tripId: string, targetKind: string, targetId: string, total: number): Promise<void> => {
  try {
    const threshold = MILESTONE_THRESHOLDS.find(t => total >= t && total < t + 5);
    if (!threshold) return;

    const membersResult = await queryBlog<{ user_id: string }>(
      `SELECT user_id FROM group_members gm
       JOIN trips t ON t.group_id = gm.group_id
       WHERE t.id = $1 AND gm.removed_at IS NULL`,
      [tripId]
    );
    const userIds = membersResult.rows.map(r => r.user_id);

    if (userIds.length > 0) {
      await notify({
        userIds,
        category: 'blog_milestone',
        tripId,
        title: 'Engagement Milestone!',
        body: `This trip just hit ${threshold} reactions!`,
        dedupeKey: `trip:${tripId}:milestone:${threshold}`,
      });
    }
  } catch (err) {
    logError('[blog-engagement] failed to check engagement milestones', err);
  }
};

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
  const summary = summaries[`${targetKind}:${targetId}`];

  broadcastEngagement(tripId, target.effectiveAudience, 'BLOG_REACTION_UPDATE', { targetKind, targetId, summary });

  if (summary && await isFeatureEnabled('trip_blog_milestones')) {
    void checkEngagementMilestones(tripId, targetKind, targetId, summary.reactionTotal);
  }

  return { target, summary };
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
  const summary = summaries[`${targetKind}:${targetId}`];
  broadcastEngagement(tripId, target.effectiveAudience, 'BLOG_REACTION_UPDATE', { targetKind, targetId, summary });
  return { target, summary };
};

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

export const postComment = async (
  tripId: string,
  actorUserId: string,
  targetKind: BlogEngagementTargetKind,
  targetId: string,
  body: string,
  parentCommentId?: string | null,
  idempotencyKey?: string | null,
  mentions?: string[] | null
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
  const shouldCheckSpam = authorRole === 'follower' && target.effectiveAudience === 'public';
  const spamResult = shouldCheckSpam ? checkSpam(body) : { isSpam: false, reason: null };
  const comment = await blogEngagementRepository().createComment({
    tripId, targetKind, targetId, audience: target.effectiveAudience,
    authorUserId: actorUserId, authorRole, body, parentCommentId: parentCommentId ?? null,
    idempotencyKey: idempotencyKey ?? null,
    autoHiddenReason: spamResult.isSpam ? spamResult.reason : null,
  });

  if (comment && !spamResult.isSpam) {
    broadcastEngagement(tripId, target.effectiveAudience, 'BLOG_COMMENT_NEW', { comment });
    void dispatchCommentNotifications(comment, mentions ?? []);
  }

  return comment;
};

const dispatchCommentNotifications = async (comment: BlogComment, mentions: string[]): Promise<void> => {
  try {
    const actorRow = await queryBlog<{ first_name: string | null; last_name: string | null }>('SELECT first_name, last_name FROM users WHERE id = $1', [comment.authorUserId]);
    const actorName = actorRow.rows[0] ? `${actorRow.rows[0].first_name ?? ''} ${actorRow.rows[0].last_name ?? ''}`.trim() || 'A traveler' : 'A traveler';

    if (mentions.length > 0) {
      await notify({
        userIds: mentions.slice(0, 10),
        category: 'blog_mention',
        tripId: comment.tripId,
        actorUserId: comment.authorUserId,
        title: 'New mention',
        body: `${actorName} mentioned you in a comment`,
        deepLink: `trip/${comment.tripId}/blog?comment=${comment.id}`,
        dedupeKey: `comment:${comment.id}:mention`,
      });
    }

    if (comment.parentCommentId) {
      const parent = await blogEngagementRepository().getCommentById(comment.parentCommentId);
      if (parent?.authorUserId && parent.authorUserId !== comment.authorUserId) {
        await notify({
          userIds: [parent.authorUserId],
          category: 'blog_comment_reply',
          tripId: comment.tripId,
          actorUserId: comment.authorUserId,
          title: 'New reply',
          body: `${actorName} replied to your comment`,
          deepLink: `trip/${comment.tripId}/blog?comment=${comment.id}`,
          dedupeKey: `comment:${comment.id}:reply`,
          threadKey: `comment:${comment.parentCommentId}`,
        });
      }
    }
  } catch (err) {
    logError('[blog-engagement] failed to dispatch comment notifications', err);
  }
};

export const updateCommentBody = async (tripId: string, actorUserId: string, commentId: string, body: string): Promise<BlogComment> => {
  const membership = await resolveActorMembership(tripId, actorUserId);
  const resolved = await resolveComment(tripId, actorUserId, membership, commentId);
  if (!resolved) throw new BlogTargetNotFoundError('Comment not found');
  const comment = await blogEngagementRepository().updateCommentBody(commentId, actorUserId, body);
  if (!comment) throw new BlogTargetNotFoundError('Comment not found');
  broadcastEngagement(tripId, comment.audience, 'BLOG_COMMENT_UPDATE', { comment });
  return comment;
};

export const deleteComment = async (tripId: string, actorUserId: string, commentId: string): Promise<void> => {
  const membership = await resolveActorMembership(tripId, actorUserId);
  const resolved = await resolveComment(tripId, actorUserId, membership, commentId);
  if (!resolved) throw new BlogTargetNotFoundError('Comment not found');
  const deleted = await blogEngagementRepository().softDeleteComment(commentId, actorUserId);
  if (!deleted) throw new BlogTargetNotFoundError('Comment not found');
  const comment = await blogEngagementRepository().getCommentById(commentId);
  if (comment) {
    broadcastEngagement(tripId, comment.audience, 'BLOG_COMMENT_UPDATE', { comment });
  }
};

export const reportComment = async (tripId: string, actorUserId: string, commentId: string, reason: string, detail?: string): Promise<void> => {
  const membership = await resolveActorMembership(tripId, actorUserId);
  const resolved = await resolveComment(tripId, actorUserId, membership, commentId);
  if (!resolved) throw new BlogTargetNotFoundError('Comment not found');
  if (resolved.comment.authorUserId === actorUserId) throw new BlogEngagementUnauthorizedError('Cannot report your own comment');
  await blogEngagementRepository().reportComment(commentId, actorUserId, reason as any, detail);
};

export const starTarget = async (tripId: string, actorUserId: string, targetKind: 'item' | 'asset', targetId: string): Promise<void> => {
  const membership = await resolveActorMembership(tripId, actorUserId);
  if (membership !== 'traveler') throw new BlogEngagementUnauthorizedError('Only travelers can star items');
  const target = await resolveEngagementTarget(tripId, actorUserId, membership, targetKind, targetId);
  if (!target) throw new BlogTargetNotFoundError();
  await blogEngagementRepository().upsertStar(tripId, actorUserId, targetKind, targetId);
  broadcastEngagement(tripId, 'travelers', 'BLOG_STAR_UPDATE', { targetKind, targetId, starred: true, userId: actorUserId });
};

export const unstarTarget = async (tripId: string, actorUserId: string, targetKind: 'item' | 'asset', targetId: string): Promise<void> => {
  const membership = await resolveActorMembership(tripId, actorUserId);
  if (membership !== 'traveler') throw new BlogEngagementUnauthorizedError('Only travelers can unstar items');
  const target = await resolveEngagementTarget(tripId, actorUserId, membership, targetKind, targetId);
  if (!target) throw new BlogTargetNotFoundError();
  await blogEngagementRepository().clearStar(tripId, actorUserId, targetKind, targetId);
  broadcastEngagement(tripId, 'travelers', 'BLOG_STAR_UPDATE', { targetKind, targetId, starred: false, userId: actorUserId });
};

export const listCommentsForDay = async (tripId: string, actorUserId: string, dayDate: string, options: { cursor?: string; limit?: number } = {}) => {
  const membership = await resolveActorMembership(tripId, actorUserId);
  const dayRow = await queryBlog<{ id: string }>('SELECT id FROM blog_days WHERE trip_id = $1 AND local_date = $2::date', [tripId, dayDate]);
  if (!dayRow.rows[0]) throw new BlogTargetNotFoundError();
  const dayId = dayRow.rows[0].id;
  const visibleAudiences = visibleAudiencesForMembership(membership);
  const comments = await blogEngagementRepository().listTopLevelCommentsForDay(tripId, dayId, visibleAudiences, options);
  return Promise.all(comments.map(async (c) => ({
    ...c,
    replies: await blogEngagementRepository().listReplies(c.id, visibleAudiences, { limit: 3 })
  })));
};

export const listRepliesForComment = async (tripId: string, actorUserId: string, commentId: string, options: { cursor?: string; limit?: number } = {}) => {
  const membership = await resolveActorMembership(tripId, actorUserId);
  const resolved = await resolveComment(tripId, actorUserId, membership, commentId);
  if (!resolved) throw new BlogTargetNotFoundError();
  return blogEngagementRepository().listReplies(commentId, visibleAudiencesForMembership(membership), options);
};

export const editComment = updateCommentBody;
export const reportCommentByActor = reportComment;
