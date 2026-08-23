import { useCallback, useEffect, useRef, useState } from 'react';

export type BlogReactionEmoji = 'heart' | 'laugh' | 'wow' | 'fire' | 'clap' | 'thanks';
export const BLOG_REACTION_EMOJIS: BlogReactionEmoji[] = ['heart', 'laugh', 'wow', 'fire', 'clap', 'thanks'];

export type BlogEngagementSummary = {
  reactionCounts: Partial<Record<BlogReactionEmoji, number>>;
  reactionTotal: number;
  commentCount: number;
  userReaction: BlogReactionEmoji | null;
};

export type BlogEngagementTargetKind = 'day' | 'item' | 'asset';

const ZERO_SUMMARY: BlogEngagementSummary = { reactionCounts: {}, reactionTotal: 0, commentCount: 0, userReaction: null };

const targetKey = (targetKind: BlogEngagementTargetKind, targetId: string) => `${targetKind}:${targetId}`;

// Phase 3 of docs/trip-blog-social-implementation-plan.md — a normalized engagement store, keyed
// by `targetKind:targetId`, separate from `TripBlogTab`'s own render-tree state. The blog document
// GET response already carries an `engagement` object per day/item/asset (architecture §5.4) — this
// hook is seeded from those embedded values via `seedFromBlog`, not a second fetch, and only ever
// talks to the network for the write itself (PUT/DELETE .../reactions).
//
// Optimistic mutation + rollback: `react`/`clear` update local state immediately, then reconcile
// with the server's response (the full summary the route returns) or roll back to the pre-mutation
// value on failure. This mirrors ReactionBar.tsx's computeOptimisticSummary pattern but as a
// standalone store rather than per-component state, since one blog page has many simultaneous
// reaction targets (every day, every note, every photo) that must not fight over one piece of state.
export function useBlogEngagement(backendUrl: string, headers: Record<string, string>, tripId: string | null) {
  const [summaries, setSummaries] = useState<Record<string, BlogEngagementSummary>>({});
  // Tracks in-flight mutations per target so a rapid double-tap doesn't race two requests against
  // the same target — the second tap waits rather than firing a second PUT/DELETE.
  const inFlight = useRef<Set<string>>(new Set());
  const tripIdRef = useRef(tripId);
  tripIdRef.current = tripId;

  // Called after every load()/refresh — walks the blog document's days/items/assets and populates
  // this store from their embedded `engagement` fields. Never overwrites a target with a pending
  // mutation, so a fetch that lands mid-mutation can't stomp on an optimistic update.
  const seedFromBlog = useCallback((blog: any) => {
    if (!blog?.days) return;
    setSummaries((current) => {
      const next = { ...current };
      for (const day of blog.days) {
        const dayKey = targetKey('day', day.id);
        if (day.engagement && !inFlight.current.has(dayKey)) next[dayKey] = day.engagement;
        for (const item of day.items ?? []) {
          if (item.kindKey === 'core.text' && item.engagement) {
            const key = targetKey('item', item.id);
            if (!inFlight.current.has(key)) next[key] = item.engagement;
          }
          if (item.kindKey && item.kindKey.startsWith('media.') && item.engagement && item.assetId) {
            const key = targetKey('asset', item.assetId);
            if (!inFlight.current.has(key)) next[key] = item.engagement;
          }
          if (item.kindKey === 'core.gallery') {
            for (const asset of item.assets ?? []) {
              if (asset.engagement && asset.assetId) {
                const key = targetKey('asset', asset.assetId);
                if (!inFlight.current.has(key)) next[key] = asset.engagement;
              }
            }
          }
        }
      }
      return next;
    });
  }, []);

  const getSummary = useCallback((targetKind: BlogEngagementTargetKind, targetId: string): BlogEngagementSummary =>
    summaries[targetKey(targetKind, targetId)] ?? ZERO_SUMMARY, [summaries]);

  const applyOptimistic = useCallback((targetKind: BlogEngagementTargetKind, targetId: string, nextEmoji: BlogReactionEmoji | null) => {
    const key = targetKey(targetKind, targetId);
    let previous: BlogEngagementSummary = ZERO_SUMMARY;
    setSummaries((current) => {
      previous = current[key] ?? ZERO_SUMMARY;
      const counts = { ...previous.reactionCounts };
      let total = previous.reactionTotal;
      if (previous.userReaction) {
        counts[previous.userReaction] = Math.max(0, (counts[previous.userReaction] ?? 0) - 1);
        total = Math.max(0, total - 1);
      }
      if (nextEmoji) {
        counts[nextEmoji] = (counts[nextEmoji] ?? 0) + 1;
        total += 1;
      }
      return { ...current, [key]: { reactionCounts: counts, reactionTotal: total, commentCount: previous.commentCount, userReaction: nextEmoji } };
    });
    return previous;
  }, []);

  const rollback = useCallback((targetKind: BlogEngagementTargetKind, targetId: string, previous: BlogEngagementSummary) => {
    setSummaries((current) => ({ ...current, [targetKey(targetKind, targetId)]: previous }));
  }, []);

  const commit = useCallback((targetKind: BlogEngagementTargetKind, targetId: string, summary: BlogEngagementSummary) => {
    setSummaries((current) => ({ ...current, [targetKey(targetKind, targetId)]: summary }));
  }, []);

  const react = useCallback(async (targetKind: BlogEngagementTargetKind, targetId: string, emoji: BlogReactionEmoji): Promise<void> => {
    const key = targetKey(targetKind, targetId);
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    const previous = applyOptimistic(targetKind, targetId, emoji);
    try {
      const response = await fetch(`${backendUrl}/api/trips/${tripIdRef.current}/blog/${targetKind}/${targetId}/reactions`, {
        method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ emoji }),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Unable to react');
      commit(targetKind, targetId, await response.json());
    } catch (error) {
      rollback(targetKind, targetId, previous);
      throw error;
    } finally {
      inFlight.current.delete(key);
    }
  }, [applyOptimistic, backendUrl, commit, headers, rollback]);

  const clear = useCallback(async (targetKind: BlogEngagementTargetKind, targetId: string): Promise<void> => {
    const key = targetKey(targetKind, targetId);
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    const previous = applyOptimistic(targetKind, targetId, null);
    try {
      const response = await fetch(`${backendUrl}/api/trips/${tripIdRef.current}/blog/${targetKind}/${targetId}/reactions`, {
        method: 'DELETE', headers,
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Unable to clear your reaction');
      commit(targetKind, targetId, await response.json());
    } catch (error) {
      rollback(targetKind, targetId, previous);
      throw error;
    } finally {
      inFlight.current.delete(key);
    }
  }, [applyOptimistic, backendUrl, commit, headers, rollback]);

  // Client-side toggle decision, matching architecture §5.1's revised PUT/DELETE split: re-tapping
  // the same emoji clears it, a different emoji issues a fresh PUT. The server itself no longer
  // toggles (Phase 3) — this is the client logic that reproduces the old user-facing behavior on
  // top of the now-idempotent server contract.
  const toggle = useCallback(async (targetKind: BlogEngagementTargetKind, targetId: string, emoji: BlogReactionEmoji): Promise<void> => {
    const current = getSummary(targetKind, targetId);
    if (current.userReaction === emoji) await clear(targetKind, targetId);
    else await react(targetKind, targetId, emoji);
  }, [clear, getSummary, react]);

  // Clear the whole store on trip switch — stale optimistic state from a previous trip must never
  // bleed into the next one's initial render before the first seedFromBlog call lands.
  useEffect(() => {
    setSummaries({});
    inFlight.current.clear();
  }, [tripId]);

  return { getSummary, seedFromBlog, toggle, react, clear };
}
