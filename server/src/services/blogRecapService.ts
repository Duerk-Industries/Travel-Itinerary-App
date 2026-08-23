import { createHash, randomUUID } from 'crypto';
import { ensureUserCanReadTrip } from '../db';
import { getApiCacheSetting } from '../config/apiLimits';
import { blogRecapRepository } from '../blog/recapRepository';
import type { BlogRecapAudienceClass, BlogRecapPayload, BlogRecapRevision } from '../blog/recapTypes';
import { commitCapacityReservation, releaseCapacityReservation, reserveApiUsageOrThrow, reserveCapacityOrThrow } from '../apis/usageLimiter';
import { logError } from '../logger';
import { atomicIncrementApiUsageIfUnderLimit } from '../db';

export type BlogRecapResult = { status: 'ready'; payload: BlogRecapPayload } | { status: 'pending'; retryAfterSeconds: number };

const leaseSeconds = (): number => Math.max(15, Number(getApiCacheSetting('tripBlog', 'recapLeaseSeconds') ?? 60));
const retainCount = (): number => Math.min(10, Math.max(1, Number(getApiCacheSetting('tripBlog', 'recapSnapshotsPerTrip') ?? 3)));
const recapBuildsPerTripPerDay = (): number => Math.max(1, Number(getApiCacheSetting('tripBlog', 'recapGenerationsPerDayPerTrip') ?? 5));
const capacityId = (revision: BlogRecapRevision, audienceClass: BlogRecapAudienceClass): string => {
  const hex = createHash('sha256').update(`blog-recap:${revision.tripId}:${revision.contentRevision}:${revision.engagementRevision}:${audienceClass}`).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const buildPayload = async (revision: BlogRecapRevision, audienceClass: BlogRecapAudienceClass): Promise<BlogRecapPayload> => {
  const source = await blogRecapRepository().getRecapSource(revision.tripId, audienceClass);
  const rankedPhoto = [...source.media].sort((a, b) => b.reactionTotal - a.reactionTotal || a.assetId.localeCompare(b.assetId))[0] ?? null;
  const topPhoto = rankedPhoto && rankedPhoto.reactionTotal > 0 ? rankedPhoto : null;
  return {
    tripId: revision.tripId,
    title: revision.title,
    dayCount: source.dayCount,
    placeCount: source.placeCount,
    distanceKm: source.distanceKm,
    photoCount: source.photoCount,
    videoCount: source.videoCount,
    travelerCount: source.travelerCount,
    followerParticipantCount: source.followerParticipantCount,
    topPhoto,
    topContributors: source.contributors.slice(0, 3),
    mostCommentedDay: source.mostCommentedDay,
    generatedAt: new Date().toISOString(),
    audienceClass,
  };
};

const generateClaimedSnapshot = async (revision: BlogRecapRevision, audienceClass: BlogRecapAudienceClass, leaseOwner: string): Promise<void> => {
  const reservationId = capacityId(revision, audienceClass);
  try {
    const tripQuota = await atomicIncrementApiUsageIfUnderLimit({
      provider: 'TRIP_BLOG_RECAP_TRIP',
      caller: createHash('sha256').update(revision.tripId).digest('hex').slice(0, 24),
      scope: 'caller',
      windowKey: new Date().toISOString().slice(0, 10),
      limit: recapBuildsPerTripPerDay(),
    });
    if (!tripQuota.allowed) throw new Error('Daily trip recap generation limit reached');
    await reserveApiUsageOrThrow({ provider: 'TRIP_BLOG_SOCIAL_API', caller: 'BLOG_RECAP_BUILD', requireConfiguredLimit: true });
    await reserveApiUsageOrThrow({ provider: 'TRIP_BLOG_SOCIAL_STORAGE', caller: 'DATABASE_READ_UNIT', units: 20, requireConfiguredLimit: true });
    await reserveCapacityOrThrow({ provider: 'TRIP_BLOG_SOCIAL_CAPACITY', caller: 'RECAP_RETAINED_KIB', units: 64, idempotencyKey: reservationId });
    const payload = await buildPayload(revision, audienceClass);
    const actualKiB = Math.max(1, Math.ceil(Buffer.byteLength(JSON.stringify(payload), 'utf8') / 1024));
    await reserveApiUsageOrThrow({ provider: 'TRIP_BLOG_SOCIAL_STORAGE', caller: 'DATABASE_WRITE_UNIT', requireConfiguredLimit: true });
    await blogRecapRepository().completeRecapSnapshot(revision, audienceClass, leaseOwner, payload);
    await commitCapacityReservation(reservationId, actualKiB);
    await reserveApiUsageOrThrow({ provider: 'TRIP_BLOG_SOCIAL_STORAGE', caller: 'DATABASE_DELETE_UNIT', units: retainCount(), requireConfiguredLimit: true });
    const pruned = await blogRecapRepository().pruneRecapSnapshots(revision.tripId, retainCount());
    await Promise.all(pruned.map((entry) => releaseCapacityReservation(capacityId({ ...revision, contentRevision: entry.contentRevision, engagementRevision: entry.engagementRevision }, entry.audienceClass))));
  } catch (err) {
    const failureCode = String((err as any)?.message ?? 'BUILD_FAILED').replace(/[\r\n]+/g, ' ').slice(0, 1000);
    await blogRecapRepository().failRecapSnapshot(revision, audienceClass, leaseOwner, failureCode).catch(() => undefined);
    await releaseCapacityReservation(reservationId).catch(() => undefined);
    logError('[blog-recap] snapshot generation failed', err);
  }
};

export const getOrQueueBlogRecap = async (tripId: string, actorUserId: string): Promise<BlogRecapResult> => {
  const access = await ensureUserCanReadTrip(tripId, actorUserId);
  if (!access) throw new Error('Not authorized to view this trip');
  const audienceClass: BlogRecapAudienceClass = access.access === 'follower' ? 'followers' : 'travelers';
  await reserveApiUsageOrThrow({ provider: 'TRIP_BLOG_SOCIAL_API', caller: 'BLOG_RECAP_READ', requireConfiguredLimit: true });
  await reserveApiUsageOrThrow({ provider: 'TRIP_BLOG_SOCIAL_STORAGE', caller: 'DATABASE_READ_UNIT', units: 2, requireConfiguredLimit: true });
  const revision = await blogRecapRepository().getRecapRevision(tripId);
  if (!revision) throw new Error('Trip blog not found');
  const current = await blogRecapRepository().getRecapSnapshot(revision, audienceClass);
  if (current?.state === 'ready' && current.payload) return { status: 'ready', payload: current.payload };
  const leaseOwner = `recap-${randomUUID()}`;
  await reserveApiUsageOrThrow({ provider: 'TRIP_BLOG_SOCIAL_STORAGE', caller: 'DATABASE_WRITE_UNIT', requireConfiguredLimit: true });
  const claimed = await blogRecapRepository().claimRecapSnapshot(revision, audienceClass, leaseOwner, leaseSeconds());
  if (claimed) setTimeout(() => { void generateClaimedSnapshot(revision, audienceClass, leaseOwner); }, 0);
  return { status: 'pending', retryAfterSeconds: 2 };
};
