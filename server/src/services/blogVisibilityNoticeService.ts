import { getTripById, loadBlogVisibilityContext } from '../db';
import { blogRepository } from '../blog/repository';
import { evaluateBlogVisibility } from './blogVisibilityService';
import { notify } from './notificationService';

// R5: travelers hear about the blog going public before it happens and when it does. Visibility itself is decided by
// evaluateBlogVisibility (R1); this only reads that result. Each notice carries a dedupe key, and the notification table
// is unique on (user, dedupe key), so a traveler gets each event at most once however often the hourly job runs.

const DAY_MS = 86_400_000;
const dayNumber = (date: string): number => Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS);

// A blog that turns public more than a day after its start date did not just "go public on the start date" (for example
// a trip that was held back until an opt-out cleared, or one that predates R1). Travelers see those once, on their next
// visit to the blog, rather than all at once from the worker.
const RECENT_DAYS = 1;

export type BlogNoticeKind = 'tomorrow' | 'public';

const send = async (kind: BlogNoticeKind, tripId: string, userIds: string[], startDate: string | null): Promise<void> => {
  const name = (await getTripById(tripId))?.name || 'your trip';
  const deepLink = `/trips/${tripId}/blog`;
  if (kind === 'tomorrow') {
    await notify({
      userIds, category: 'blog_visibility', tripId, deepLink,
      title: `Your blog for ${name} goes public tomorrow`,
      body: 'Anyone with the link can read it from tomorrow. Open the blog to preview it as the public will see it, or make it private first.',
      payload: { event: 'public_tomorrow', tripId, startDate, actions: ['preview_as_public', 'make_private'] },
      dedupeKey: `blog_public_tomorrow:${tripId}:${startDate}`,
    });
    return;
  }
  const publicPath = await blogRepository().getPublicPath(tripId).catch(() => null);
  await notify({
    userIds, category: 'blog_visibility', tripId, deepLink,
    title: `Your blog for ${name} is now public`,
    body: publicPath ? `Anyone can read it at ${publicPath}. You can make it private at any time from the blog.` : 'Anyone can read it now. You can make it private at any time from the blog.',
    payload: { event: 'now_public', tripId, publicPath: publicPath ?? null, actions: ['make_private'] },
    dedupeKey: `blog_now_public:${tripId}`,
  });
};

/**
 * Called by the hourly blog worker for each trip, after visibility was synchronized. `becamePublic` is the
 * private-to-public transition that synchronization just recorded. Sends nothing while any R1 condition other than the
 * start date is unmet (an under-16 or unknown-age account traveler, an opt-out, sharing switched off).
 */
export const sendBlogVisibilityNotices = async (tripId: string, now: Date, becamePublic: boolean): Promise<BlogNoticeKind | null> => {
  const result = await evaluateBlogVisibility(tripId, now);
  const context = await loadBlogVisibilityContext(tripId);
  const userIds = [...new Set(context?.members.map(m => m.userId) ?? [])];
  if (!userIds.length) return null;
  if (!result.isPublic) {
    const onlyTheDateIsMissing = result.reasons.length === 1 && result.reasons[0] === 'TRIP_NOT_STARTED';
    if (!onlyTheDateIsMissing || !result.startDate || dayNumber(result.startDate) - dayNumber(result.localDate) !== 1) return null;
    await send('tomorrow', tripId, userIds, result.startDate);
    return 'tomorrow';
  }
  if (!becamePublic) return null;
  const recent = result.earlyRelease || !result.startDate || dayNumber(result.localDate) - dayNumber(result.startDate) <= RECENT_DAYS;
  if (!recent) return null;
  await send('public', tripId, userIds, result.startDate);
  return 'public';
};

/**
 * Called when a traveler opens the blog. Someone who joined after the blog went public never received the transition
 * notice, so they get the same one now. A traveler who already has it is unaffected (same dedupe key).
 */
export const ensureBlogPublicNotice = async (tripId: string, userId: string, now = new Date()): Promise<boolean> => {
  const result = await evaluateBlogVisibility(tripId, now);
  if (!result.isPublic) return false;
  const context = await loadBlogVisibilityContext(tripId);
  if (!context?.members.some(m => m.userId === userId)) return false;
  await send('public', tripId, [userId], result.startDate);
  return true;
};
