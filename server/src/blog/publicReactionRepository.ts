import { randomUUID } from 'crypto';
import { getCurrentDbProvider } from '../db';
import { queryBlog, withBlogTransaction } from '../db.postgres';
import { getDb } from '../db.firebase';
import { clearReaction as clearFirebaseReaction, upsertReaction as upsertFirebaseReaction } from './firebaseEngagementRepository';
import { recomputeCounterRow } from './postgresEngagementRepository';
import { BlogEngagementTargetKind, BlogReactionEmoji } from './engagementTypes';

// A public visitor is represented by a random per-blog browser UUID, never a users row.
// Firestore can reuse the reaction transaction with a reserved synthetic actor key;
// Postgres stores the visitor separately so its users FK remains meaningful.
const firebaseActor = (visitorId: string) => `public-visitor:${visitorId}`;

const targetColumn = (kind: BlogEngagementTargetKind): 'blog_day_id' | 'blog_item_id' | 'asset_id' =>
  kind === 'day' ? 'blog_day_id' : kind === 'item' ? 'blog_item_id' : 'asset_id';

export const getPublicVisitorReactions = async (
  tripId: string,
  targets: Array<{ targetKind: BlogEngagementTargetKind; targetId: string }>,
  visitorId: string
): Promise<Record<string, BlogReactionEmoji>> => {
  if (!targets.length) return {};
  if (getCurrentDbProvider() === 'firebase') {
    const db = getDb();
    const entries = await Promise.all(targets.map(async (target) => {
      const snapshot = await db.collection('blog_reactions').doc(`${target.targetKind}:${target.targetId}:${firebaseActor(visitorId)}`).get();
      return [`${target.targetKind}:${target.targetId}`, snapshot.exists ? (snapshot.data() as any).emoji : null] as const;
    }));
    return Object.fromEntries(entries.filter((entry) => entry[1])) as Record<string, BlogReactionEmoji>;
  }
  const rows = await queryBlog<{ target_kind: BlogEngagementTargetKind; blog_day_id: string | null; blog_item_id: string | null; asset_id: string | null; emoji: BlogReactionEmoji }>(
    'SELECT target_kind, blog_day_id, blog_item_id, asset_id, emoji FROM blog_reactions WHERE trip_id = $1 AND visitor_id = $2',
    [tripId, visitorId]
  );
  const allowed = new Set(targets.map((target) => `${target.targetKind}:${target.targetId}`));
  return Object.fromEntries(rows.rows.map((row) => [`${row.target_kind}:${row[targetColumn(row.target_kind)]}`, row.emoji] as const).filter(([key]) => allowed.has(key)));
};

export const setPublicReaction = async (tripId: string, kind: BlogEngagementTargetKind, targetId: string, visitorId: string, emoji: BlogReactionEmoji): Promise<void> => {
  if (getCurrentDbProvider() === 'firebase') {
    await upsertFirebaseReaction(tripId, firebaseActor(visitorId), kind, targetId, emoji, 'public');
    return;
  }
  await withBlogTransaction(async (client) => {
    const column = targetColumn(kind);
    const existing = await client.query<{ id: string; emoji: string }>(
      `SELECT id, emoji FROM blog_reactions WHERE ${column} = $1 AND visitor_id = $2 AND target_kind = $3`,
      [targetId, visitorId, kind]
    );
    if (existing.rows[0]) {
      if (existing.rows[0].emoji !== emoji) {
        await client.query('UPDATE blog_reactions SET emoji = $2, updated_at = NOW() WHERE id = $1', [existing.rows[0].id, emoji]);
      }
    } else {
      await client.query(
        `INSERT INTO blog_reactions (id, trip_id, target_kind, ${column}, visitor_id, emoji, audience) VALUES ($1, $2, $3, $4, $5, $6, 'public')`,
        [randomUUID(), tripId, kind, targetId, visitorId, emoji]
      );
    }
    await recomputeCounterRow(client, tripId, kind, targetId, 'public');
  });
};

export const clearPublicReaction = async (tripId: string, kind: BlogEngagementTargetKind, targetId: string, visitorId: string): Promise<void> => {
  if (getCurrentDbProvider() === 'firebase') {
    await clearFirebaseReaction(tripId, firebaseActor(visitorId), kind, targetId, 'public');
    return;
  }
  await withBlogTransaction(async (client) => {
    const column = targetColumn(kind);
    await client.query(`DELETE FROM blog_reactions WHERE ${column} = $1 AND visitor_id = $2 AND target_kind = $3`, [targetId, visitorId, kind]);
    await recomputeCounterRow(client, tripId, kind, targetId, 'public');
  });
};
