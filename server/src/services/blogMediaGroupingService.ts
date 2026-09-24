import { queryBlog } from '../db.postgres';
import { ensureUserInTrip, getCurrentDbProvider } from '../db';
import { BlogEngagementUnauthorizedError, BlogTargetNotFoundError } from './blogEngagementErrors';
import { listBlogDayDates } from '../blog/firebaseBlogDayData';

// Phase 5 of docs/trip-blog-social-implementation-plan.md (A2) — architecture §5.3: "stateless on
// purpose: the client sends the timestamps it read locally from the picker, the server answers
// with buckets using trip dates ... and nothing is uploaded until the user confirms." No reads or
// writes to blog_media_assets/blog_storage_accounts happen here at all — this is pure computation
// over the trip's own day range, which is the only reason it's cheap enough to run on every
// keystroke of a 147-photo picker session.

export interface MediaGroupCandidate {
  clientId: string;
  capturedAt?: string | null;
}

export interface MediaGroupBucket {
  dayDate: string;
  clientIds: string[];
}

export interface MediaGroupResult {
  buckets: MediaGroupBucket[];
  // FR-A2.2: an item with no capturedAt at all lands here and is never auto-assigned to a day —
  // the photo-first composer's own "Unassigned" bucket, decided entirely client-side from there.
  unassigned: string[];
  // Has a real capturedAt, but outside every day this trip actually has — the composer's
  // "out-of-range confirm" flow, not a silent drop and not a silent clamp to the nearest day.
  outOfRange: Array<{ clientId: string; capturedAt: string }>;
  // Every day this trip has, normalized and sorted — the composer's day picker uses this so a
  // photo can be placed on any trip day, not only the ones the blog tab has paged in.
  dayDates: string[];
}

const MAX_CANDIDATES = 500;

const toDateString = (iso: string): string | null => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
};

export const groupMediaByDay = async (tripId: string, actorUserId: string, candidates: MediaGroupCandidate[]): Promise<MediaGroupResult> => {
  if (!(await ensureUserInTrip(tripId, actorUserId))) throw new BlogEngagementUnauthorizedError('Not authorized on this trip');
  if (candidates != null && !Array.isArray(candidates)) return { buckets: [], unassigned: [], outOfRange: [], dayDates: [] };
  if (Array.isArray(candidates) && candidates.length > MAX_CANDIDATES) throw new Error(`At most ${MAX_CANDIDATES} candidates are allowed per request`);

  const rawDayDates = getCurrentDbProvider() === 'firebase'
    ? await listBlogDayDates(tripId)
    : (await queryBlog<{ local_date: string }>('SELECT local_date FROM blog_days WHERE trip_id = $1 ORDER BY local_date ASC', [tripId])).rows.map((row) => row.local_date);
  if (!rawDayDates.length) throw new BlogTargetNotFoundError('This trip has no days to group photos into yet');
  const sortedDates = [...new Set(rawDayDates.map((date) => new Date(date).toISOString().slice(0, 10)))].sort();
  const validDates = new Set(sortedDates);

  if (!Array.isArray(candidates) || candidates.length === 0) return { buckets: [], unassigned: [], outOfRange: [], dayDates: sortedDates };

  const byDay = new Map<string, string[]>();
  const unassigned: string[] = [];
  const outOfRange: Array<{ clientId: string; capturedAt: string }> = [];

  for (const candidate of candidates) {
    const clientId = String(candidate?.clientId ?? '').trim();
    if (!clientId) continue;
    const capturedAt = candidate?.capturedAt ? String(candidate.capturedAt) : null;
    if (!capturedAt) {
      unassigned.push(clientId);
      continue;
    }
    const dateString = toDateString(capturedAt);
    if (!dateString) {
      unassigned.push(clientId);
      continue;
    }
    if (!validDates.has(dateString)) {
      outOfRange.push({ clientId, capturedAt });
      continue;
    }
    byDay.set(dateString, [...(byDay.get(dateString) ?? []), clientId]);
  }

  const buckets = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dayDate, clientIds]) => ({ dayDate, clientIds }));

  return { buckets, unassigned, outOfRange, dayDates: sortedDates };
};
