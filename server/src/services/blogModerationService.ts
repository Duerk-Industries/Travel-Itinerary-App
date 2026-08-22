import { ensureUserOwnsTrip, writeAuditLog } from '../db';
import { blogEngagementRepository } from '../blog/engagementRepository';
import { BlogComment } from '../blog/engagementTypes';
import { BlogEngagementUnauthorizedError, BlogTargetNotFoundError } from './blogEngagementErrors';

// Phase 4 of docs/trip-blog-social-implementation-plan.md — moderation primitives: automated spam
// filtering for public comments (NFR-12) and the trip-owner/admin hide/unhide actions
// (architecture §4, §5.1, threat S8 in §15.1). Both live here rather than in
// blogEngagementService.ts because they answer a different question — "should this be visible at
// all," decided by the trip's owner or a heuristic, not "is this actor allowed to act on this
// target," which is what resolveEngagementTarget/resolveComment answer.

// --- Automated spam check (NFR-12) -----------------------------------------------------------
//
// Deterministic, in-process rules only, per the architecture's explicit instruction: "use
// deterministic in-process rules in v1, with no separate client-callable endpoint or uncapped
// provider call. Any future external classifier requires its own disabled-by-default flag, finite
// caller limit and cost-model entry before activation." This ruleset is content-moderation
// heuristics, not an operational rate/cost limit, so it is a plain TS constant here rather than a
// server/config/api-limits.yaml entry — that file's "route-local numeric constants are forbidden"
// convention governs request-shaping numbers (page sizes, rate windows), not a moderation
// wordlist, which is reviewed and changed by a different process entirely.
//
// Applied only to public-audience comments authored by a follower — a traveler's comment is never
// checked, matching the product decision that account-holding travelers are trusted (Phase 4's own
// test list: "traveler comment with same keywords is NOT hidden"). This is deliberately narrower
// than "every public comment": a traveler who happens to type one of these phrases is not spam.
const SPAM_TRIGGER_PHRASES = [
  'click here to claim',
  'buy now at',
  'wire transfer',
  'crypto investment opportunity',
  'act now limited time',
  'free money',
  'work from home earn',
  'guaranteed income',
  'lose weight fast',
];

const URL_PATTERN = /\bhttps?:\/\/\S+/gi;
const MAX_URLS_BEFORE_FLAG = 2;

export type SpamCheckResult = { isSpam: boolean; reason: string | null };

export const checkSpam = (body: string): SpamCheckResult => {
  const normalized = String(body ?? '').toLowerCase();
  for (const phrase of SPAM_TRIGGER_PHRASES) {
    if (normalized.includes(phrase)) {
      return { isSpam: true, reason: `matched trigger phrase: ${phrase}` };
    }
  }
  const urlCount = (body.match(URL_PATTERN) ?? []).length;
  if (urlCount > MAX_URLS_BEFORE_FLAG) {
    return { isSpam: true, reason: `contains ${urlCount} links` };
  }
  return { isSpam: false, reason: null };
};

// --- Hide / unhide (owner or admin only) ------------------------------------------------------
//
// Deliberately not routed through resolveComment (which governs traveler/follower engagement) —
// architecture §4: "Admin access is deliberately narrower than trip-owner access... The
// moderation endpoint... cannot be used to react, comment, set covers or publish." This function
// is the *only* path to hide/unhide, matching the "two functions, no third path" discipline
// resolveEngagementTarget/resolveComment already established for their own actions.
const assertModerator = async (tripId: string, actorUserId: string, actorRole: string | undefined): Promise<void> => {
  if (actorRole === 'admin') return;
  if (await ensureUserOwnsTrip(tripId, actorUserId)) return;
  throw new BlogEngagementUnauthorizedError('Only the trip owner or an admin may moderate comments on this trip');
};

const getCommentInTrip = async (tripId: string, commentId: string): Promise<BlogComment> => {
  const comment = await blogEngagementRepository().getCommentById(commentId);
  if (!comment || comment.tripId !== tripId) throw new BlogTargetNotFoundError('That comment was not found');
  return comment;
};

// FR-B11.2/threat S8: hiding is reversible and always a human action — never automatic, and
// reports never trigger it on their own (see reportCommentByActor in blogEngagementService.ts,
// which only ever writes a report row). Increments the author's strike count; three strikes blocks
// further commenting on this trip (FR-B11.3, blog_comment_strikes).
export const hideCommentAsModerator = async (
  tripId: string,
  actorUserId: string,
  actorRole: string | undefined,
  commentId: string,
  ipAddress?: string | null
): Promise<BlogComment> => {
  await assertModerator(tripId, actorUserId, actorRole);
  const comment = await getCommentInTrip(tripId, commentId);
  const updated = await blogEngagementRepository().hideComment(commentId, actorUserId);
  if (!updated) throw new BlogTargetNotFoundError('That comment was not found');
  if (comment.authorUserId && !comment.hiddenAt) {
    // Only strike on a *new* hide, not a replay (idempotent — see the strike-count test). A
    // comment with no living author (account already deleted) has nothing left to strike.
    await blogEngagementRepository().incrementStrike(tripId, comment.authorUserId);
  }
  await writeAuditLog({
    actorUserId,
    targetUserId: comment.authorUserId,
    action: 'BLOG_COMMENT_HIDDEN',
    beforeState: { hiddenAt: comment.hiddenAt },
    afterState: { hiddenAt: updated.hiddenAt, hiddenByUserId: actorUserId },
    ipAddress: ipAddress ?? null,
  });
  return updated;
};

// Reverses one hide — and, symmetrically, removes exactly one strike from the author, so a
// mistaken hide doesn't leave a permanent mark. Idempotent: unhiding an already-visible comment is
// a no-op with no further strike adjustment (checked via `comment.hiddenAt` before the repository
// call, same pattern as the hide path above).
export const unhideCommentAsModerator = async (
  tripId: string,
  actorUserId: string,
  actorRole: string | undefined,
  commentId: string,
  ipAddress?: string | null
): Promise<BlogComment> => {
  await assertModerator(tripId, actorUserId, actorRole);
  const comment = await getCommentInTrip(tripId, commentId);
  const wasHidden = Boolean(comment.hiddenAt);
  const updated = await blogEngagementRepository().unhideComment(commentId);
  if (!updated) throw new BlogTargetNotFoundError('That comment was not found');
  if (wasHidden && comment.authorUserId) {
    await blogEngagementRepository().decrementStrike(tripId, comment.authorUserId);
  }
  await writeAuditLog({
    actorUserId,
    targetUserId: comment.authorUserId,
    action: 'BLOG_COMMENT_UNHIDDEN',
    beforeState: { hiddenAt: comment.hiddenAt },
    afterState: { hiddenAt: null },
    ipAddress: ipAddress ?? null,
  });
  return updated;
};
