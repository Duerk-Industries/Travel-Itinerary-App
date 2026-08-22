import { randomUUID } from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { getDb } from '../db.firebase';
import { BlogAudience } from './types';
import {
  BlogCommentAuthorRole,
  BlogCommentReport,
  BlogCommentStrikeState,
  BlogEngagementSummary,
  BlogEngagementTargetKind,
  BlogEngagementTargetRef,
  BlogComment,
  BlogReactionEmoji,
  BlogReactor,
} from './engagementTypes';

// Phase 2 of docs/trip-blog-social-implementation-plan.md — the Firestore side of the engagement
// spine. Same method signatures as postgresEngagementRepository.ts, called through the same
// interface (blog/engagementRepository.ts).
//
// Collection names are snake_case (`blog_reactions`, not `blogReactions`), matching the
// established convention in blog/firebaseRepository.ts and firestore.indexes.json's existing
// `blog_days`/`blog_media_assets` entries — architecture §3.5 used camelCase collection names,
// which would have been the only inconsistent set in the codebase; this follows precedent instead.
//
// Document IDs are deterministic where SQL has a unique key, exactly as §3.5 specifies: a
// reaction's ID is `${targetKind}:${targetId}:${userId}` (the same identity the partial unique
// indexes enforce in Postgres) and a counter's ID is `${targetKind}:${targetId}:${audience}` (the
// composite primary key). This makes both idempotent under retry without needing a query first.
//
// Verified against a hand-rolled Firestore fake in __tests__/blog-engagement-firebase.test.ts,
// following the existing FakeFirestore pattern in firebase-lodging-membership.test.ts — this repo
// has no Firestore emulator available to run rule/transaction-contention tests against a real
// instance, which architecture §3.5 also calls for; that emulator-backed verification is not done
// here and should be treated as outstanding, not covered.

const nowIso = () => new Date().toISOString();

const targetField = (targetKind: BlogEngagementTargetKind): 'blogDayId' | 'blogItemId' | 'assetId' => {
  if (targetKind === 'day') return 'blogDayId';
  if (targetKind === 'item') return 'blogItemId';
  return 'assetId';
};

const reactionDocId = (targetKind: BlogEngagementTargetKind, targetId: string, userId: string) => `${targetKind}:${targetId}:${userId}`;
const counterDocId = (targetKind: BlogEngagementTargetKind, targetId: string, audience: BlogAudience) => `${targetKind}:${targetId}:${audience}`;

const mapComment = (id: string, data: any): BlogComment => ({
  id,
  tripId: String(data.tripId),
  targetKind: data.targetKind,
  targetId: String(data.targetId),
  parentCommentId: data.parentCommentId ?? null,
  authorUserId: data.authorUserId ?? null,
  authorRole: data.authorRole,
  body: data.body ?? null,
  audience: data.audience,
  editedAt: data.editedAt ?? null,
  deletedAt: data.deletedAt ?? null,
  hiddenAt: data.hiddenAt ?? null,
  hiddenByUserId: data.hiddenByUserId ?? null,
  replyCount: Number(data.replyCount ?? 0),
  createdAt: data.createdAt,
  updatedAt: data.updatedAt,
});

const COMMENT_MAX_LENGTH = 2000;
const EDIT_WINDOW_SECONDS = 900;
const HIDE_STRIKES_BEFORE_BLOCK = 3;

// FR-B1.2 / architecture §5.1 (revised after Phase 2): PUT idempotently sets/replaces the
// reaction — it never toggles off on a repeat call with the same emoji. The client decides
// DELETE vs PUT based on the caller's currently-known reaction; see the matching comment in
// postgresEngagementRepository.ts's upsertReaction for the retry-safety reasoning.
export const upsertReaction = async (
  tripId: string,
  userId: string,
  targetKind: BlogEngagementTargetKind,
  targetId: string,
  emoji: BlogReactionEmoji,
  audience: BlogAudience
): Promise<void> => {
  const db = getDb();
  const reactionRef = db.collection('blog_reactions').doc(reactionDocId(targetKind, targetId, userId));
  const counterRef = db.collection('blog_engagement_counters').doc(counterDocId(targetKind, targetId, audience));
  await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(reactionRef);
    const existingEmoji = existing.exists ? (existing.data() as any).emoji : null;
    if (existingEmoji === emoji) return; // already set to this emoji — no-op
    const now = nowIso();
    const isNew = !existing.exists;
    transaction.set(reactionRef, { tripId, targetKind, targetId, userId, emoji, audience, createdAt: existing.exists ? (existing.data() as any).createdAt : now, updatedAt: now }, { merge: true });
    const reactionCounts: Record<string, unknown> = { [emoji]: FieldValue.increment(1) };
    if (existingEmoji) reactionCounts[existingEmoji] = FieldValue.increment(-1);
    const counterUpdate: Record<string, unknown> = {
      targetKind, targetId, tripId, audience,
      reactionCounts,
      updatedAt: now,
    };
    if (isNew) counterUpdate.reactionTotal = FieldValue.increment(1); // replacing an existing emoji doesn't change the total, only adding one does
    transaction.set(counterRef, counterUpdate, { merge: true });
  });
};

export const clearReaction = async (
  tripId: string,
  userId: string,
  targetKind: BlogEngagementTargetKind,
  targetId: string,
  audience: BlogAudience
): Promise<void> => {
  const db = getDb();
  const reactionRef = db.collection('blog_reactions').doc(reactionDocId(targetKind, targetId, userId));
  const counterRef = db.collection('blog_engagement_counters').doc(counterDocId(targetKind, targetId, audience));
  await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(reactionRef);
    if (!existing.exists) return;
    const emoji = (existing.data() as any).emoji;
    transaction.delete(reactionRef);
    transaction.set(counterRef, {
      targetKind, targetId, tripId, audience,
      reactionTotal: FieldValue.increment(-1),
      reactionCounts: { [emoji]: FieldValue.increment(-1) },
      updatedAt: nowIso(),
    }, { merge: true });
  });
};

export const getEngagementSummaries = async (
  userId: string | null,
  targets: BlogEngagementTargetRef[],
  visibleAudiences: BlogAudience[]
): Promise<Record<string, BlogEngagementSummary>> => {
  const key = (t: BlogEngagementTargetRef) => `${t.targetKind}:${t.targetId}`;
  const summaries: Record<string, BlogEngagementSummary> = {};
  for (const target of targets) summaries[key(target)] = { reactionCounts: {}, reactionTotal: 0, commentCount: 0, userReaction: null };
  if (!targets.length) return summaries;

  const db = getDb();
  // Firestore has no "IN this set of composite keys" query; counters are fetched by their
  // deterministic doc ID directly instead of a collection query, which is also cheaper than a
  // filtered scan for a bounded per-page target list.
  await Promise.all(targets.flatMap((target) => visibleAudiences.map(async (audience) => {
    const snap = await db.collection('blog_engagement_counters').doc(counterDocId(target.targetKind, target.targetId, audience)).get();
    if (!snap.exists) return;
    const data = snap.data() as any;
    const summary = summaries[key(target)];
    for (const [emoji, count] of Object.entries(data.reactionCounts ?? {})) {
      summary.reactionCounts[emoji as BlogReactionEmoji] = (summary.reactionCounts[emoji as BlogReactionEmoji] ?? 0) + Number(count);
    }
    summary.reactionTotal += Number(data.reactionTotal ?? 0);
    summary.commentCount += Number(data.commentCount ?? 0);
  })));

  if (userId) {
    await Promise.all(targets.map(async (target) => {
      const snap = await db.collection('blog_reactions').doc(reactionDocId(target.targetKind, target.targetId, userId)).get();
      if (snap.exists) summaries[key(target)].userReaction = (snap.data() as any).emoji;
    }));
  }
  return summaries;
};

// Mirrors postgresEngagementRepository.ts's displayNameFromRow — no shared package between
// app/ and server/ to reuse the client's formatMemberDisplayName.
const displayNameFromUserDoc = (data: any): string => {
  const combined = `${data?.firstName ?? ''} ${data?.lastName ?? ''}`.trim();
  if (combined) return combined;
  if (data?.email) return String(data.email);
  return 'A traveler';
};

export const listReactors = async (
  targetKind: BlogEngagementTargetKind,
  targetId: string,
  options: { cursor?: string; limit?: number } = {}
): Promise<BlogReactor[]> => {
  const limit = Math.min(100, Math.max(1, options.limit ?? 20));
  const db = getDb();
  const snap = await db.collection('blog_reactions')
    .where('targetKind', '==', targetKind)
    .where(targetField(targetKind), '==', targetId)
    .get();
  const rows = snap.docs
    .map((doc: any) => doc.data() as any)
    .filter((data: any) => !options.cursor || data.createdAt < options.cursor)
    .sort((a: any, b: any) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
  const withNames = await Promise.all(rows.map(async (row: any) => {
    const userSnap = await db.collection('users').doc(row.userId).get();
    return {
      userId: String(row.userId),
      displayName: userSnap.exists ? displayNameFromUserDoc(userSnap.data()) : 'A traveler',
      emoji: row.emoji as BlogReactionEmoji,
      createdAt: row.createdAt,
    };
  }));
  return withNames;
};

export const createComment = async (input: {
  tripId: string;
  targetKind: BlogEngagementTargetKind;
  targetId: string;
  audience: BlogAudience;
  authorUserId: string;
  authorRole: BlogCommentAuthorRole;
  body: string;
  parentCommentId?: string | null;
}): Promise<BlogComment> => {
  const body = String(input.body ?? '').trim();
  if (body.length < 1 || body.length > COMMENT_MAX_LENGTH) {
    throw new Error(`Comment must be between 1 and ${COMMENT_MAX_LENGTH} characters`);
  }
  const db = getDb();
  const id = randomUUID();
  const commentRef = db.collection('blog_comments').doc(id);
  const counterRef = db.collection('blog_engagement_counters').doc(counterDocId(input.targetKind, input.targetId, input.audience));
  const parentRef = input.parentCommentId ? db.collection('blog_comments').doc(input.parentCommentId) : null;

  return db.runTransaction(async (transaction) => {
    if (parentRef) {
      const parentSnap = await transaction.get(parentRef);
      if (!parentSnap.exists || (parentSnap.data() as any).deletedAt) throw new Error('Parent comment not found');
    }
    const now = nowIso();
    const data = {
      tripId: input.tripId, targetKind: input.targetKind, targetId: input.targetId,
      [targetField(input.targetKind)]: input.targetId,
      parentCommentId: input.parentCommentId ?? null,
      authorUserId: input.authorUserId, authorRole: input.authorRole,
      body, audience: input.audience,
      editedAt: null, deletedAt: null, hiddenAt: null, hiddenByUserId: null,
      replyCount: 0, createdAt: now, updatedAt: now,
    };
    transaction.set(commentRef, data);
    if (parentRef) transaction.set(parentRef, { replyCount: FieldValue.increment(1), updatedAt: now }, { merge: true });
    transaction.set(counterRef, { targetKind: input.targetKind, targetId: input.targetId, tripId: input.tripId, audience: input.audience, commentCount: FieldValue.increment(1), updatedAt: now }, { merge: true });
    return mapComment(id, data);
  });
};

export const getCommentById = async (commentId: string): Promise<BlogComment | null> => {
  const snap = await getDb().collection('blog_comments').doc(commentId).get();
  return snap.exists ? mapComment(commentId, snap.data()) : null;
};

export const updateCommentBody = async (commentId: string, authorUserId: string, body: string): Promise<BlogComment | null> => {
  const trimmed = String(body ?? '').trim();
  if (trimmed.length < 1 || trimmed.length > COMMENT_MAX_LENGTH) {
    throw new Error(`Comment must be between 1 and ${COMMENT_MAX_LENGTH} characters`);
  }
  const ref = getDb().collection('blog_comments').doc(commentId);
  const snap = await ref.get();
  const data = snap.exists ? (snap.data() as any) : null;
  if (!data || data.deletedAt || String(data.authorUserId) !== authorUserId) return null;
  const ageSeconds = (Date.now() - new Date(data.createdAt).getTime()) / 1000;
  if (ageSeconds > EDIT_WINDOW_SECONDS) throw new Error('The edit window for this comment has closed');
  const now = nowIso();
  await ref.set({ body: trimmed, editedAt: now, updatedAt: now }, { merge: true });
  return mapComment(commentId, { ...data, body: trimmed, editedAt: now, updatedAt: now });
};

export const softDeleteComment = async (commentId: string, authorUserId: string): Promise<boolean> => {
  const db = getDb();
  const ref = db.collection('blog_comments').doc(commentId);
  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    const data = snap.exists ? (snap.data() as any) : null;
    if (!data || data.deletedAt || String(data.authorUserId) !== authorUserId) return false;
    const now = nowIso();
    if (Number(data.replyCount ?? 0) > 0) {
      transaction.set(ref, { body: null, deletedAt: now, updatedAt: now }, { merge: true });
    } else {
      transaction.delete(ref);
      if (data.parentCommentId) {
        transaction.set(db.collection('blog_comments').doc(data.parentCommentId), { replyCount: FieldValue.increment(-1), updatedAt: now }, { merge: true });
      }
    }
    const counterRef = db.collection('blog_engagement_counters').doc(counterDocId(data.targetKind, data.targetId, data.audience));
    transaction.set(counterRef, { commentCount: FieldValue.increment(-1), updatedAt: now }, { merge: true });
    return true;
  });
};

export const hideComment = async (commentId: string, hiddenByUserId: string): Promise<BlogComment | null> => {
  const ref = getDb().collection('blog_comments').doc(commentId);
  const snap = await ref.get();
  const data = snap.exists ? (snap.data() as any) : null;
  if (!data || data.deletedAt) return null;
  const now = nowIso();
  await ref.set({ hiddenAt: now, hiddenByUserId, updatedAt: now }, { merge: true });
  return mapComment(commentId, { ...data, hiddenAt: now, hiddenByUserId, updatedAt: now });
};

export const unhideComment = async (commentId: string): Promise<BlogComment | null> => {
  const ref = getDb().collection('blog_comments').doc(commentId);
  const snap = await ref.get();
  const data = snap.exists ? (snap.data() as any) : null;
  if (!data) return null;
  const now = nowIso();
  await ref.set({ hiddenAt: null, hiddenByUserId: null, updatedAt: now }, { merge: true });
  return mapComment(commentId, { ...data, hiddenAt: null, hiddenByUserId: null, updatedAt: now });
};

export const reportComment = async (commentId: string, reporterUserId: string, reason: BlogCommentReport['reason'], detail?: string | null): Promise<void> => {
  const db = getDb();
  // UNIQUE (comment_id, reporter_user_id) in Postgres becomes a deterministic doc ID here — the
  // same idempotent-no-op-on-retry behavior without a query first.
  const ref = db.collection('blog_comment_reports').doc(`${commentId}:${reporterUserId}`);
  const existing = await ref.get();
  if (existing.exists) return;
  await ref.set({
    commentId, reporterUserId, reason, detail: detail ?? null,
    state: 'open', createdAt: nowIso(), resolvedAt: null,
  });
};

export const getStrikeState = async (tripId: string, userId: string): Promise<BlogCommentStrikeState> => {
  const snap = await getDb().collection('blog_comment_strikes').doc(`${tripId}:${userId}`).get();
  if (!snap.exists) return { strikeCount: 0, blockedAt: null };
  const data = snap.data() as any;
  return { strikeCount: Number(data.strikeCount ?? 0), blockedAt: data.blockedAt ?? null };
};

export const incrementStrike = async (tripId: string, userId: string): Promise<BlogCommentStrikeState> => {
  const db = getDb();
  const ref = db.collection('blog_comment_strikes').doc(`${tripId}:${userId}`);
  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    const current = snap.exists ? Number((snap.data() as any).strikeCount ?? 0) : 0;
    const nextCount = current + 1;
    const blocked = nextCount >= HIDE_STRIKES_BEFORE_BLOCK;
    const existingBlockedAt = snap.exists ? (snap.data() as any).blockedAt : null;
    const now = nowIso();
    transaction.set(ref, {
      tripId, userId, strikeCount: nextCount,
      blockedAt: blocked ? (existingBlockedAt ?? now) : existingBlockedAt ?? null,
      updatedAt: now,
    }, { merge: true });
    return { strikeCount: nextCount, blockedAt: blocked ? (existingBlockedAt ?? now) : existingBlockedAt ?? null };
  });
};

// Day-level fetch (architecture §5.1) — Firestore can't do the Postgres version's join through
// blog_items/blog_item_assets to resolve which comments belong to a day's items/assets, so
// blogItemId/assetId documents would need their own dayId denormalized to support this query
// efficiently. Not required for Phase 2 (no routes call this yet); flagged here rather than
// silently shipping a version that only handles day-level targets correctly.
export const listTopLevelCommentsForDay = async (
  tripId: string,
  dayId: string,
  visibleAudiences: BlogAudience[],
  options: { cursor?: string; limit?: number } = {}
): Promise<BlogComment[]> => {
  const limit = Math.min(50, Math.max(1, options.limit ?? 20));
  const db = getDb();
  let query = db.collection('blog_comments')
    .where('tripId', '==', tripId)
    .where('blogDayId', '==', dayId)
    .where('parentCommentId', '==', null);
  const snap = await query.get();
  const rows = snap.docs
    .map((doc: any) => mapComment(doc.id, doc.data()))
    .filter((c: BlogComment) => !c.deletedAt && !c.hiddenAt && visibleAudiences.includes(c.audience))
    .filter((c: BlogComment) => !options.cursor || c.createdAt < options.cursor)
    .sort((a: BlogComment, b: BlogComment) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
  return rows;
};

export const listReplies = async (parentCommentId: string, visibleAudiences: BlogAudience[], options: { limit?: number } = {}): Promise<BlogComment[]> => {
  const limit = Math.min(50, Math.max(1, options.limit ?? 20));
  const snap = await getDb().collection('blog_comments').where('parentCommentId', '==', parentCommentId).get();
  return snap.docs
    .map((doc: any) => mapComment(doc.id, doc.data()))
    .filter((c: BlogComment) => !c.hiddenAt && visibleAudiences.includes(c.audience))
    .sort((a: BlogComment, b: BlogComment) => a.createdAt.localeCompare(b.createdAt))
    .slice(0, limit);
};
