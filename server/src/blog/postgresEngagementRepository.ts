import { randomUUID } from 'crypto';
import { queryBlog, withBlogTransaction } from '../db.postgres';
import { BlogAudience } from './types';
import {
  BLOG_REACTION_EMOJIS,
  BlogCommentAuthorRole,
  BlogCommentReport,
  BlogCommentStrikeState,
  BlogEngagementCounterRow,
  BlogEngagementSummary,
  BlogEngagementTargetKind,
  BlogEngagementTargetRef,
  BlogComment,
  BlogReaction,
  BlogReactionEmoji,
} from './engagementTypes';

// Phase 2 of docs/trip-blog-social-implementation-plan.md — the engagement spine's Postgres
// (and, by extension, memory/pg-mem — see the note in blog/repository.ts) implementation. Ships
// dark: no routes call this yet. See docs/trip-blog-social-architecture.md §3.2 for the schema
// and §14.6 for why counters are read directly rather than cached.
//
// pg-mem compatibility notes (verified empirically while writing this file, not assumed from the
// architecture doc's §3.4, which undersold how limited the native function set actually is):
//   - Neither `char_length` nor `length` exist. The comment body length bound (1-2000 chars) is
//     therefore enforced here in application code, not as a DB CHECK — see the migration.
//   - `jsonb_set` does not exist, and JSONB concatenation (`||`) is unreliable. `reaction_counts`
//     is therefore read, merged in JS, and written back as a whole JSON blob rather than patched
//     in SQL.
//   - Plain integer arithmetic in `ON CONFLICT ... DO UPDATE SET col = table.col + 1` DOES work
//     and IS used for `reaction_total`/`comment_count` — those get real atomic increments.
//   - Partial unique indexes with `WHERE`, composite primary keys, and JSONB defaults all work —
//     confirmed by the migration applying cleanly under DB_PROVIDER=memory.
//
// The `reaction_counts` blob is consequently *not* atomically consistent under concurrent writes
// to the same target — a documented, deliberate tradeoff: "counters are disposable derived data"
// (architecture §3.2/§14.6), and the reconciliation job (blogCounterReconciliationService.ts)
// exists specifically to correct any drift. Nothing that depends on correctness — authorization,
// the reactions/comments tables themselves — ever reads this blob; only display does.

type ReactionRow = {
  id: string; target_kind: string; blog_day_id: string | null; blog_item_id: string | null; asset_id: string | null;
  user_id: string; emoji: string; audience: string; created_at: Date; updated_at: Date; trip_id: string;
};
type CommentRow = {
  id: string; trip_id: string; target_kind: string;
  blog_day_id: string | null; blog_item_id: string | null; asset_id: string | null;
  parent_comment_id: string | null;
  author_user_id: string | null; author_role: string; body: string | null; audience: string;
  edited_at: Date | null; deleted_at: Date | null; hidden_at: Date | null; hidden_by_user_id: string | null;
  reply_count: number; created_at: Date; updated_at: Date;
};
type CounterRow = { target_kind: string; target_id: string; audience: string; reaction_counts: Record<string, number>; reaction_total: number; comment_count: number };

const COMMENT_MAX_LENGTH = 2000;

const targetColumn = (targetKind: BlogEngagementTargetKind): 'blog_day_id' | 'blog_item_id' | 'asset_id' => {
  if (targetKind === 'day') return 'blog_day_id';
  if (targetKind === 'item') return 'blog_item_id';
  return 'asset_id';
};

// blog_reactions/blog_comments have no `target_id` column — the polymorphic target is three
// nullable FK columns (blog_day_id/blog_item_id/asset_id, architecture §3.1), never a single
// generic one. This reads back whichever of the three is populated, keyed by the row's own
// target_kind, for the mapping functions below.
const targetIdFromRow = (row: { target_kind: string; blog_day_id?: string | null; blog_item_id?: string | null; asset_id?: string | null }): string => {
  const column = targetColumn(row.target_kind as BlogEngagementTargetKind);
  const raw = column === 'blog_day_id' ? row.blog_day_id : column === 'blog_item_id' ? row.blog_item_id : row.asset_id;
  return String(raw);
};

const mapReaction = (row: ReactionRow): BlogReaction => ({
  id: String(row.id),
  tripId: String(row.trip_id),
  targetKind: row.target_kind as BlogEngagementTargetKind,
  targetId: targetIdFromRow(row),
  userId: String(row.user_id),
  emoji: row.emoji as BlogReactionEmoji,
  audience: row.audience as BlogAudience,
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
});

const mapComment = (row: CommentRow): BlogComment => ({
  id: String(row.id),
  tripId: String(row.trip_id),
  targetKind: row.target_kind as BlogEngagementTargetKind,
  targetId: targetIdFromRow(row),
  parentCommentId: row.parent_comment_id == null ? null : String(row.parent_comment_id),
  authorUserId: row.author_user_id == null ? null : String(row.author_user_id),
  authorRole: row.author_role as BlogCommentAuthorRole,
  body: row.body,
  audience: row.audience as BlogAudience,
  editedAt: row.edited_at ? new Date(row.edited_at).toISOString() : null,
  deletedAt: row.deleted_at ? new Date(row.deleted_at).toISOString() : null,
  hiddenAt: row.hidden_at ? new Date(row.hidden_at).toISOString() : null,
  hiddenByUserId: row.hidden_by_user_id == null ? null : String(row.hidden_by_user_id),
  replyCount: Number(row.reply_count ?? 0),
  createdAt: new Date(row.created_at).toISOString(),
  updatedAt: new Date(row.updated_at).toISOString(),
});

// Rewrites the whole (target, audience) counter row from the current source-of-truth tables —
// used after every mutation rather than incrementing in place, which sidesteps the JSONB
// limitation noted above at the cost of an extra read. Called inside the same transaction as the
// mutation that triggered it, so the two never observably diverge even though the write itself
// isn't a single atomic statement. Exported (not just used internally) so
// blogCounterReconciliationService.ts can call it directly with `queryBlog` in place of a
// transaction client — the two share the same `{ query(sql, params) }` shape.
export const recomputeCounterRow = async (
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> },
  tripId: string,
  targetKind: BlogEngagementTargetKind,
  targetId: string,
  audience: BlogAudience
): Promise<void> => {
  const column = targetColumn(targetKind);
  const reactionRows = await client.query(
    `SELECT emoji, COUNT(*)::int AS count FROM blog_reactions WHERE ${column} = $1 AND audience = $2 GROUP BY emoji`,
    [targetId, audience]
  );
  const counts: Partial<Record<BlogReactionEmoji, number>> = {};
  let total = 0;
  for (const row of reactionRows.rows) {
    const n = Number(row.count);
    counts[row.emoji as BlogReactionEmoji] = n;
    total += n;
  }
  const commentRows = await client.query(
    `SELECT COUNT(*)::int AS count FROM blog_comments WHERE ${column} = $1 AND audience = $2 AND deleted_at IS NULL`,
    [targetId, audience]
  );
  const commentCount = Number(commentRows.rows[0]?.count ?? 0);
  await client.query(
    `INSERT INTO blog_engagement_counters (target_kind, target_id, trip_id, audience, reaction_counts, reaction_total, comment_count, updated_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, NOW())
     ON CONFLICT (target_kind, target_id, audience) DO UPDATE
       SET reaction_counts = $5::jsonb, reaction_total = $6, comment_count = $7, updated_at = NOW()`,
    [targetKind, targetId, tripId, audience, JSON.stringify(counts), total, commentCount]
  );
};

// FR-B1.2: one reaction per user per target, changeable — re-sending the same emoji clears it.
export const upsertReaction = async (
  tripId: string,
  userId: string,
  targetKind: BlogEngagementTargetKind,
  targetId: string,
  emoji: BlogReactionEmoji,
  audience: BlogAudience
): Promise<{ cleared: boolean }> =>
  withBlogTransaction(async (client) => {
    const column = targetColumn(targetKind);
    const existing = await client.query<{ id: string; emoji: string }>(
      `SELECT id, emoji FROM blog_reactions WHERE ${column} = $1 AND user_id = $2`,
      [targetId, userId]
    );
    let cleared = false;
    if (existing.rows[0] && existing.rows[0].emoji === emoji) {
      await client.query('DELETE FROM blog_reactions WHERE id = $1', [existing.rows[0].id]);
      cleared = true;
    } else if (existing.rows[0]) {
      await client.query('UPDATE blog_reactions SET emoji = $2, updated_at = NOW() WHERE id = $1', [existing.rows[0].id, emoji]);
    } else {
      await client.query(
        `INSERT INTO blog_reactions (id, trip_id, target_kind, ${column}, user_id, emoji, audience)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [randomUUID(), tripId, targetKind, targetId, userId, emoji, audience]
      );
    }
    await recomputeCounterRow(client, tripId, targetKind, targetId, audience);
    return { cleared };
  });

export const clearReaction = async (
  tripId: string,
  userId: string,
  targetKind: BlogEngagementTargetKind,
  targetId: string,
  audience: BlogAudience
): Promise<void> =>
  withBlogTransaction(async (client) => {
    const column = targetColumn(targetKind);
    await client.query(`DELETE FROM blog_reactions WHERE ${column} = $1 AND user_id = $2`, [targetId, userId]);
    await recomputeCounterRow(client, tripId, targetKind, targetId, audience);
  });

// Batched per-page reads (architecture §14.6/NFR-1): one query for counts across every target on
// the page, one for the caller's own reactions — never per-target queries. `visibleAudiences` is
// the caller-appropriate set to sum: a traveler sums travelers+followers+public, a follower sums
// followers+public, an anonymous public reader sums public only (architecture §3.2).
export const getEngagementSummaries = async (
  userId: string | null,
  targets: BlogEngagementTargetRef[],
  visibleAudiences: BlogAudience[]
): Promise<Record<string, BlogEngagementSummary>> => {
  const key = (t: BlogEngagementTargetRef) => `${t.targetKind}:${t.targetId}`;
  const summaries: Record<string, BlogEngagementSummary> = {};
  for (const target of targets) {
    summaries[key(target)] = { reactionCounts: {}, reactionTotal: 0, commentCount: 0, userReaction: null };
  }
  if (!targets.length) return summaries;

  // Two different clause sets against two different schemas: blog_engagement_counters has a real
  // `target_id` column (it isn't polymorphic — see the migration), so it can be filtered with a
  // plain (target_kind, target_id) pair. blog_reactions has no such column — its target is the
  // three polymorphic FK columns (architecture §3.1) — so each target's clause must reference
  // whichever of the three columns actually applies to *that* target's kind, not a generic one.
  const counterClauses: string[] = [];
  const counterParams: unknown[] = [];
  const reactionClauses: string[] = [];
  const reactionParams: unknown[] = [];
  targets.forEach((target) => {
    counterClauses.push(`(target_kind = $${counterParams.length + 1} AND target_id = $${counterParams.length + 2})`);
    counterParams.push(target.targetKind, target.targetId);

    const column = targetColumn(target.targetKind);
    reactionClauses.push(`(target_kind = $${reactionParams.length + 1} AND ${column} = $${reactionParams.length + 2})`);
    reactionParams.push(target.targetKind, target.targetId);
  });
  const audiencePlaceholders = visibleAudiences.map((_, i) => `$${counterParams.length + i + 1}`).join(',');

  const counterRows = await queryBlog<CounterRow>(
    `SELECT target_kind, target_id, audience, reaction_counts, reaction_total, comment_count
     FROM blog_engagement_counters
     WHERE (${counterClauses.join(' OR ')}) AND audience IN (${audiencePlaceholders})`,
    [...counterParams, ...visibleAudiences]
  );
  for (const row of counterRows.rows) {
    const k = `${row.target_kind}:${row.target_id}`;
    const summary = summaries[k];
    if (!summary) continue;
    for (const [emoji, count] of Object.entries(row.reaction_counts ?? {})) {
      summary.reactionCounts[emoji as BlogReactionEmoji] = (summary.reactionCounts[emoji as BlogReactionEmoji] ?? 0) + Number(count);
    }
    summary.reactionTotal += Number(row.reaction_total ?? 0);
    summary.commentCount += Number(row.comment_count ?? 0);
  }

  if (userId) {
    const ownRows = await queryBlog<ReactionRow>(
      `SELECT * FROM blog_reactions WHERE user_id = $${reactionParams.length + 1} AND (${reactionClauses.join(' OR ')})`,
      [...reactionParams, userId]
    );
    for (const row of ownRows.rows) {
      const k = `${row.target_kind}:${targetIdFromRow(row)}`;
      if (summaries[k]) summaries[k].userReaction = row.emoji as BlogReactionEmoji;
    }
  }
  return summaries;
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
  return withBlogTransaction(async (client) => {
    const column = targetColumn(input.targetKind);
    if (input.parentCommentId) {
      const parent = await client.query<{ id: string; deleted_at: Date | null }>(
        'SELECT id, deleted_at FROM blog_comments WHERE id = $1 AND target_kind = $2',
        [input.parentCommentId, input.targetKind]
      );
      if (!parent.rows[0] || parent.rows[0].deleted_at) throw new Error('Parent comment not found');
    }
    const id = randomUUID();
    const inserted = await client.query<CommentRow>(
      `INSERT INTO blog_comments (id, trip_id, target_kind, ${column}, parent_comment_id, author_user_id, author_role, body, audience)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [id, input.tripId, input.targetKind, input.targetId, input.parentCommentId ?? null, input.authorUserId, input.authorRole, body, input.audience]
    );
    if (input.parentCommentId) {
      await client.query('UPDATE blog_comments SET reply_count = reply_count + 1, updated_at = NOW() WHERE id = $1', [input.parentCommentId]);
    }
    await recomputeCounterRow(client, input.tripId, input.targetKind, input.targetId, input.audience);
    return mapComment(inserted.rows[0]);
  });
};

export const getCommentById = async (commentId: string): Promise<BlogComment | null> => {
  const result = await queryBlog<CommentRow>('SELECT * FROM blog_comments WHERE id = $1', [commentId]);
  return result.rows[0] ? mapComment(result.rows[0]) : null;
};

const EDIT_WINDOW_SECONDS = 900; // FR-B2.3 / architecture caching.tripBlog.commentEditWindowSeconds

export const updateCommentBody = async (commentId: string, authorUserId: string, body: string): Promise<BlogComment | null> => {
  const trimmed = String(body ?? '').trim();
  if (trimmed.length < 1 || trimmed.length > COMMENT_MAX_LENGTH) {
    throw new Error(`Comment must be between 1 and ${COMMENT_MAX_LENGTH} characters`);
  }
  const current = await queryBlog<CommentRow>('SELECT * FROM blog_comments WHERE id = $1', [commentId]);
  const row = current.rows[0];
  if (!row || row.deleted_at || String(row.author_user_id) !== authorUserId) return null;
  const ageSeconds = (Date.now() - new Date(row.created_at).getTime()) / 1000;
  if (ageSeconds > EDIT_WINDOW_SECONDS) throw new Error('The edit window for this comment has closed');
  const updated = await queryBlog<CommentRow>(
    'UPDATE blog_comments SET body = $2, edited_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *',
    [commentId, trimmed]
  );
  return mapComment(updated.rows[0]);
};

// FR-B2.4: a comment with replies becomes a tombstone (body cleared, row kept so the thread stays
// coherent); a comment with no replies is removed outright.
export const softDeleteComment = async (commentId: string, authorUserId: string): Promise<boolean> =>
  withBlogTransaction(async (client) => {
    const current = await client.query<CommentRow>('SELECT * FROM blog_comments WHERE id = $1', [commentId]);
    const row = current.rows[0];
    if (!row || row.deleted_at || String(row.author_user_id) !== authorUserId) return false;
    if (Number(row.reply_count ?? 0) > 0) {
      await client.query('UPDATE blog_comments SET body = NULL, deleted_at = NOW(), updated_at = NOW() WHERE id = $1', [commentId]);
    } else {
      await client.query('DELETE FROM blog_comments WHERE id = $1', [commentId]);
      if (row.parent_comment_id) {
        await client.query('UPDATE blog_comments SET reply_count = GREATEST(reply_count - 1, 0), updated_at = NOW() WHERE id = $1', [row.parent_comment_id]);
      }
    }
    await recomputeCounterRow(client, String(row.trip_id), row.target_kind as BlogEngagementTargetKind, targetIdFromRow(row), row.audience as BlogAudience);
    return true;
  });

// FR-B11.2: trip owner (or admin, via the moderation context) may hide any comment on the trip.
// Reversible — never a delete. The strike-increment side effect (FR-B11.3) is applied by the
// caller (blogEngagementService in Phase 3/4), which also knows whether this is the user's first,
// second or third hide on this trip; the repository only performs the hide itself here.
export const hideComment = async (commentId: string, hiddenByUserId: string): Promise<BlogComment | null> => {
  const updated = await queryBlog<CommentRow>(
    'UPDATE blog_comments SET hidden_at = NOW(), hidden_by_user_id = $2, updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING *',
    [commentId, hiddenByUserId]
  );
  return updated.rows[0] ? mapComment(updated.rows[0]) : null;
};

export const unhideComment = async (commentId: string): Promise<BlogComment | null> => {
  const updated = await queryBlog<CommentRow>(
    'UPDATE blog_comments SET hidden_at = NULL, hidden_by_user_id = NULL, updated_at = NOW() WHERE id = $1 RETURNING *',
    [commentId]
  );
  return updated.rows[0] ? mapComment(updated.rows[0]) : null;
};

// FR-B11.1: every comment exposes a report action to every viewer except its author. UNIQUE
// (comment_id, reporter_user_id) makes a second report from the same user a no-op collision
// rather than a duplicate row — reports never auto-hide (threat S8); a human always decides.
export const reportComment = async (commentId: string, reporterUserId: string, reason: BlogCommentReport['reason'], detail?: string | null): Promise<void> => {
  try {
    await queryBlog(
      `INSERT INTO blog_comment_reports (id, comment_id, reporter_user_id, reason, detail) VALUES ($1, $2, $3, $4, $5)`,
      [randomUUID(), commentId, reporterUserId, reason, detail ?? null]
    );
  } catch {
    // Duplicate (comment_id, reporter_user_id) — already reported by this user. Idempotent no-op.
  }
};

export const getStrikeState = async (tripId: string, userId: string): Promise<BlogCommentStrikeState> => {
  const result = await queryBlog<{ strike_count: number; blocked_at: Date | null }>(
    'SELECT strike_count, blocked_at FROM blog_comment_strikes WHERE trip_id = $1 AND user_id = $2',
    [tripId, userId]
  );
  const row = result.rows[0];
  return { strikeCount: Number(row?.strike_count ?? 0), blockedAt: row?.blocked_at ? new Date(row.blocked_at).toISOString() : null };
};

const HIDE_STRIKES_BEFORE_BLOCK = 3; // FR-B11.3 / caching.tripBlog.hideStrikesBeforeBlock

export const incrementStrike = async (tripId: string, userId: string): Promise<BlogCommentStrikeState> => {
  const existing = await queryBlog<{ strike_count: number }>(
    'SELECT strike_count FROM blog_comment_strikes WHERE trip_id = $1 AND user_id = $2',
    [tripId, userId]
  );
  const nextCount = Number(existing.rows[0]?.strike_count ?? 0) + 1;
  const blocked = nextCount >= HIDE_STRIKES_BEFORE_BLOCK;
  if (existing.rows[0]) {
    await queryBlog(
      'UPDATE blog_comment_strikes SET strike_count = $3, blocked_at = CASE WHEN $4 THEN COALESCE(blocked_at, NOW()) ELSE blocked_at END, updated_at = NOW() WHERE trip_id = $1 AND user_id = $2',
      [tripId, userId, nextCount, blocked]
    );
  } else {
    await queryBlog(
      'INSERT INTO blog_comment_strikes (trip_id, user_id, strike_count, blocked_at) VALUES ($1, $2, $3, $4)',
      [tripId, userId, nextCount, blocked ? new Date() : null]
    );
  }
  return { strikeCount: nextCount, blockedAt: blocked ? new Date().toISOString() : null };
};

// Day-level comment fetch (architecture §5.1): one request per day, not one per target. Returns
// top-level comments only, newest-first; replies are fetched separately per thread
// (getReplies below) so a day with many short threads doesn't pull every reply eagerly.
export const listTopLevelCommentsForDay = async (
  tripId: string,
  dayId: string,
  visibleAudiences: BlogAudience[],
  options: { cursor?: string; limit?: number } = {}
): Promise<BlogComment[]> => {
  const limit = Math.min(50, Math.max(1, options.limit ?? 20));
  const audiencePlaceholders = visibleAudiences.map((_, i) => `$${i + 3}`).join(',');
  const cursorClause = options.cursor ? `AND created_at < (SELECT created_at FROM blog_comments WHERE id = $${visibleAudiences.length + 3})` : '';
  const params: unknown[] = [tripId, dayId, ...visibleAudiences];
  if (options.cursor) params.push(options.cursor);
  const result = await queryBlog<CommentRow>(
    `SELECT * FROM blog_comments
     WHERE trip_id = $1
       AND (blog_day_id = $2 OR blog_item_id IN (SELECT id FROM blog_items WHERE blog_day_id = $2) OR asset_id IN (SELECT id FROM blog_media_assets a JOIN blog_item_assets ia ON ia.asset_id = a.id JOIN blog_items i ON i.id = ia.item_id WHERE i.blog_day_id = $2))
       AND parent_comment_id IS NULL
       AND deleted_at IS NULL
       AND hidden_at IS NULL
       AND audience IN (${audiencePlaceholders})
       ${cursorClause}
     ORDER BY created_at DESC, id DESC
     LIMIT ${limit}`,
    params
  );
  return result.rows.map(mapComment);
};

export const listReplies = async (parentCommentId: string, visibleAudiences: BlogAudience[], options: { limit?: number } = {}): Promise<BlogComment[]> => {
  const limit = Math.min(50, Math.max(1, options.limit ?? 20));
  const audiencePlaceholders = visibleAudiences.map((_, i) => `$${i + 2}`).join(',');
  const result = await queryBlog<CommentRow>(
    `SELECT * FROM blog_comments
     WHERE parent_comment_id = $1 AND audience IN (${audiencePlaceholders}) AND hidden_at IS NULL
     ORDER BY created_at ASC, id ASC
     LIMIT ${limit}`,
    [parentCommentId, ...visibleAudiences]
  );
  // A deleted-with-replies tombstone (FR-B2.4) still renders in the thread — it is not filtered
  // here, since `deleted_at IS NOT NULL` on a reply just means an empty body, not an absence.
  // A *hidden* reply is filtered out, same as a hidden top-level comment: hiding suppresses
  // visibility from ordinary readers regardless of nesting depth.
  return result.rows.map(mapComment);
};
