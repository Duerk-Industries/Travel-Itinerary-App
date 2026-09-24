import { useCallback, useEffect, useRef, useState } from 'react';
import { createIdempotencyKey } from './idempotencyKey';

export type BlogCommentAuthorRole = 'traveler' | 'follower';
export type BlogCommentAudience = 'travelers' | 'followers' | 'public';
export type BlogCommentTargetKind = 'day' | 'item' | 'asset';

export type BlogComment = {
  id: string;
  tripId: string;
  targetKind: BlogCommentTargetKind;
  targetId: string;
  parentCommentId: string | null;
  authorUserId: string | null;
  authorRole: BlogCommentAuthorRole;
  authorDisplayName?: string | null;
  body: string | null;
  audience: BlogCommentAudience;
  editedAt: string | null;
  deletedAt: string | null;
  hiddenAt: string | null;
  hiddenByUserId: string | null;
  replyCount: number;
  createdAt: string;
  updatedAt: string;
  replies?: BlogComment[];
};

type DayState = { comments: BlogComment[]; loading: boolean; error: string | null };
const EMPTY_DAY_STATE: DayState = { comments: [], loading: false, error: null };

// Phase 4 of docs/trip-blog-social-implementation-plan.md — the client-side store for
// BlogCommentThread.tsx/BlogCommentComposer.tsx. Deliberately simpler than useBlogEngagement.ts's
// optimistic-mutation model: comments are not tapped dozens of times a minute the way reactions
// are, so every mutation here just re-fetches the affected day's thread from
// `GET .../blog/comments?dayDate=` (architecture §5.1 — "one request per day, not one per
// target") rather than patching local state by hand. Cached per dayDate so switching between an
// already-open day and the lightbox doesn't refetch on every render.
export function useBlogComments(backendUrl: string, headers: Record<string, string>, tripId: string | null) {
  const [byDay, setByDay] = useState<Record<string, DayState>>({});
  const tripIdRef = useRef(tripId);
  tripIdRef.current = tripId;

  useEffect(() => {
    setByDay({});
  }, [tripId]);

  const setDayState = useCallback((dayDate: string, patch: Partial<DayState>) => {
    setByDay((current) => ({ ...current, [dayDate]: { ...(current[dayDate] ?? EMPTY_DAY_STATE), ...patch } }));
  }, []);

  const loadDay = useCallback(async (dayDate: string): Promise<void> => {
    if (!tripIdRef.current) return;
    setDayState(dayDate, { loading: true, error: null });
    try {
      const response = await fetch(`${backendUrl}/api/trips/${tripIdRef.current}/blog/comments?dayDate=${encodeURIComponent(dayDate)}`, { headers });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Unable to load comments');
      const data = await response.json();
      setDayState(dayDate, { comments: Array.isArray(data.comments) ? data.comments : [], loading: false, error: null });
    } catch (error: any) {
      setDayState(dayDate, { loading: false, error: error?.message || 'Unable to load comments' });
      throw error;
    }
  }, [backendUrl, headers, setDayState]);

  const getDayState = useCallback((dayDate: string): DayState => byDay[dayDate] ?? EMPTY_DAY_STATE, [byDay]);

  // The day-level fetch mixes together every comment on that day's targets (the day itself, its
  // text notes, its photos/videos) in one payload — this filters that shared cache down to one
  // target's own thread, which is what BlogCommentThread actually renders for an item or asset
  // (e.g. inside DayMediaLightbox). There is no separate per-target list endpoint; filtering the
  // already-fetched day payload avoids one more round trip per photo.
  const getCommentsForTarget = useCallback((dayDate: string, targetKind: BlogCommentTargetKind, targetId: string): BlogComment[] =>
    getDayState(dayDate).comments.filter((c) => c.targetKind === targetKind && c.targetId === targetId),
  [getDayState]);

  const postComment = useCallback(async (
    dayDate: string, targetKind: BlogCommentTargetKind, targetId: string, body: string, parentCommentId?: string | null
  ): Promise<BlogComment> => {
    if (!tripIdRef.current) throw new Error('No active trip');
    const response = await fetch(`${backendUrl}/api/trips/${tripIdRef.current}/blog/${targetKind}/${targetId}/comments`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', 'Idempotency-Key': createIdempotencyKey('blog-comment') },
      body: JSON.stringify({ body, parentCommentId: parentCommentId ?? null }),
    });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Unable to post your comment');
    const comment = await response.json();
    await loadDay(dayDate);
    return comment;
  }, [backendUrl, headers, loadDay]);

  const editComment = useCallback(async (dayDate: string, commentId: string, body: string): Promise<void> => {
    if (!tripIdRef.current) throw new Error('No active trip');
    const response = await fetch(`${backendUrl}/api/trips/${tripIdRef.current}/blog/comments/${commentId}`, {
      method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ body }),
    });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Unable to edit your comment');
    await loadDay(dayDate);
  }, [backendUrl, headers, loadDay]);

  const deleteComment = useCallback(async (dayDate: string, commentId: string): Promise<void> => {
    if (!tripIdRef.current) throw new Error('No active trip');
    const response = await fetch(`${backendUrl}/api/trips/${tripIdRef.current}/blog/comments/${commentId}`, { method: 'DELETE', headers });
    if (!response.ok && response.status !== 204) throw new Error((await response.json().catch(() => ({}))).error || 'Unable to delete your comment');
    await loadDay(dayDate);
  }, [backendUrl, headers, loadDay]);

  const reportComment = useCallback(async (commentId: string, reason: 'spam' | 'harassment' | 'private_info' | 'other', detail?: string | null): Promise<void> => {
    if (!tripIdRef.current) throw new Error('No active trip');
    const response = await fetch(`${backendUrl}/api/trips/${tripIdRef.current}/blog/comments/${commentId}/report`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ reason, detail: detail ?? null }),
    });
    if (!response.ok && response.status !== 204) throw new Error((await response.json().catch(() => ({}))).error || 'Unable to submit your report');
  }, [backendUrl, headers]);

  const hideComment = useCallback(async (dayDate: string, commentId: string): Promise<void> => {
    if (!tripIdRef.current) throw new Error('No active trip');
    const response = await fetch(`${backendUrl}/api/trips/${tripIdRef.current}/blog/comments/${commentId}/hide`, { method: 'POST', headers });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Unable to hide this comment');
    await loadDay(dayDate);
  }, [backendUrl, headers, loadDay]);

  const unhideComment = useCallback(async (dayDate: string, commentId: string): Promise<void> => {
    if (!tripIdRef.current) throw new Error('No active trip');
    const response = await fetch(`${backendUrl}/api/trips/${tripIdRef.current}/blog/comments/${commentId}/hide`, { method: 'DELETE', headers });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Unable to unhide this comment');
    await loadDay(dayDate);
  }, [backendUrl, headers, loadDay]);

  // GET .../comments/:commentId/replies — used only for "Show N earlier comments," expanding a
  // thread past the 3-reply preview the day-level fetch already embeds (architecture §5.1).
  const loadMoreReplies = useCallback(async (dayDate: string, commentId: string): Promise<void> => {
    if (!tripIdRef.current) return;
    const response = await fetch(`${backendUrl}/api/trips/${tripIdRef.current}/blog/comments/${commentId}/replies?limit=50`, { headers });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Unable to load earlier comments');
    const data = await response.json();
    const replies = Array.isArray(data.replies) ? data.replies : [];
    setByDay((current) => {
      const day = current[dayDate] ?? EMPTY_DAY_STATE;
      return {
        ...current,
        [dayDate]: { ...day, comments: day.comments.map((c) => (c.id === commentId ? { ...c, replies } : c)) },
      };
    });
  }, [backendUrl, headers]);

  return { getDayState, loadDay, getCommentsForTarget, postComment, editComment, deleteComment, reportComment, hideComment, unhideComment, loadMoreReplies };
}
