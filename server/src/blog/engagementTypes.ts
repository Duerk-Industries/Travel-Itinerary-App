// Phase 2 of docs/trip-blog-social-implementation-plan.md — the engagement spine. Types for
// reactions, comments and their counters. Kept in a dedicated file rather than added to types.ts
// directly, mirroring the existing mediaTypes.ts/types.ts split: types.ts is the blog *document*
// shape (days, items, the masthead); this file is the social layer that attaches to it.
import { BlogAudience } from './types';

export type BlogEngagementTargetKind = 'day' | 'item' | 'asset';

export type BlogReactionEmoji = 'heart' | 'laugh' | 'wow' | 'fire' | 'clap' | 'thanks';

export const BLOG_REACTION_EMOJIS: BlogReactionEmoji[] = ['heart', 'laugh', 'wow', 'fire', 'clap', 'thanks'];

export type BlogCommentAuthorRole = 'traveler' | 'follower';

// What resolveEngagementTarget (blogEngagementService.ts) returns for a validated target — the
// single load-bearing check every engagement route must call (architecture §4 step 3). `dayId` is
// included because every target ultimately belongs to one day, which callers need for cache
// invalidation and for building the day-level comment fetch (architecture §5.1).
export interface ResolvedEngagementTarget {
  tripId: string;
  targetKind: BlogEngagementTargetKind;
  targetId: string;
  dayId: string;
  // The audience a *new* reaction/comment on this target would get right now — not necessarily
  // the audience of engagement already attached to it (architecture §4.1: audience is frozen at
  // creation time, so existing rows may differ from this value).
  effectiveAudience: BlogAudience;
}

export interface ResolvedComment {
  comment: BlogComment;
  target: ResolvedEngagementTarget;
}

export interface BlogReaction {
  id: string;
  tripId: string;
  targetKind: BlogEngagementTargetKind;
  targetId: string;
  userId: string;
  emoji: BlogReactionEmoji;
  audience: BlogAudience;
  createdAt: string;
  updatedAt: string;
}

export interface BlogComment {
  id: string;
  tripId: string;
  targetKind: BlogEngagementTargetKind;
  targetId: string;
  parentCommentId: string | null;
  authorUserId: string | null;
  authorRole: BlogCommentAuthorRole;
  // Phase 4 client surface (BlogCommentThread.tsx, PRD §6.6) — resolved only by the two read paths
  // the thread UI actually renders from (listTopLevelCommentsForDay, listReplies), via a join/lookup
  // against users. `undefined` (not present on the object at all) from every other call site that
  // doesn't resolve it (createComment/updateCommentBody/getCommentById), so callers that don't care
  // about a display name don't pay for the extra query. `null` once resolved but the author has no
  // name on file, or the comment is an anonymous tombstone (authorUserId already null).
  authorDisplayName?: string | null;
  body: string | null;
  audience: BlogAudience;
  editedAt: string | null;
  deletedAt: string | null;
  hiddenAt: string | null;
  hiddenByUserId: string | null;
  replyCount: number;
  createdAt: string;
  updatedAt: string;
}

// One row per (target, audience) — matches blog_engagement_counters' composite primary key
// (architecture §3.2). `reactionCounts` only holds emoji keys with a non-zero count.
export interface BlogEngagementCounterRow {
  targetKind: BlogEngagementTargetKind;
  targetId: string;
  audience: BlogAudience;
  reactionCounts: Partial<Record<BlogReactionEmoji, number>>;
  reactionTotal: number;
  commentCount: number;
}

// The shape a page render actually wants: audiences already summed for the viewer (architecture
// §3.2's "an authorized traveler sums all audiences they may see"), plus the caller's own
// reaction, which can't be derived from an aggregate count and is fetched separately.
export interface BlogEngagementSummary {
  reactionCounts: Partial<Record<BlogReactionEmoji, number>>;
  reactionTotal: number;
  commentCount: number;
  userReaction: BlogReactionEmoji | null;
}

export interface BlogEngagementTargetRef {
  targetKind: BlogEngagementTargetKind;
  targetId: string;
}

export interface BlogCommentReport {
  id: string;
  commentId: string;
  reporterUserId: string;
  reason: 'spam' | 'harassment' | 'private_info' | 'other';
  detail: string | null;
  state: 'open' | 'actioned' | 'dismissed';
  createdAt: string;
  resolvedAt: string | null;
}

export interface BlogCommentStrikeState {
  strikeCount: number;
  blockedAt: string | null;
}

// GET .../reactions row — the reactor list. Architecture §5.1: "Only called when a user expands
// the summary — never on page load," so this carries identity (unlike BlogEngagementSummary,
// which never does) precisely because it's an explicit, opt-in request rather than part of the
// default page payload.
export interface BlogReactor {
  userId: string;
  displayName: string;
  emoji: BlogReactionEmoji;
  createdAt: string;
}

export interface BlogContributor {
  userId: string;
  displayName: string;
  itemCount: number;
  assetCount: number;
}
