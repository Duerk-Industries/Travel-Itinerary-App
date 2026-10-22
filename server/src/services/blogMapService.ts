import { getCurrentDbProvider } from '../db';
import { queryBlog } from '../db.postgres';
import { getSharedMapEnabled, getTripLodgingAnchors, getVisibleMediaForDay } from '../blog/firebaseBlogDayData';
import { projectBlogDayMapPoints, type BlogDayMapPoints, type BlogMapSource } from './blogMapProjection';
import { resolveActorMembership, visibleAudiencesForMembership } from './blogEngagementService';

export type BlogMapDay = { dayDate: string; mapPoints: BlogDayMapPoints };
const sharing = async (tripId: string): Promise<boolean> => getCurrentDbProvider() === 'firebase'
  ? getSharedMapEnabled(tripId)
  : (await queryBlog<{ shared_map_enabled: boolean }>('SELECT shared_map_enabled FROM trip_blogs WHERE trip_id=$1', [tripId])).rows[0]?.shared_map_enabled === true;

/** Fresh audience checks: never embed locations in cached public prose or recap snapshots. */
export const readBlogMaps = async (tripId: string, dates: string[], actorUserId?: string, sharedOnly = false): Promise<BlogMapDay[]> => {
  const membership = actorUserId ? await resolveActorMembership(tripId, actorUserId) : 'follower';
  const exact = membership === 'traveler' && !sharedOnly;
  if (!exact && !await sharing(tripId)) return [];
  const firebase = getCurrentDbProvider() === 'firebase';
  const anchors = exact ? [] : firebase ? await getTripLodgingAnchors(tripId)
    : (await queryBlog<{ lat: number; lng: number }>('SELECT lat,lng FROM lodgings WHERE trip_id=$1 AND lat IS NOT NULL AND lng IS NOT NULL', [tripId])).rows.map(p => ({ lat: Number(p.lat), lng: Number(p.lng) }));
  const audiences = !actorUserId || sharedOnly ? ['public'] : visibleAudiencesForMembership(membership);
  const days: BlogMapDay[] = [];
  for (const dayDate of [...new Set(dates)].filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).slice(0, 60)) {
    const rows = firebase ? await getVisibleMediaForDay(tripId, dayDate, audiences as Parameters<typeof getVisibleMediaForDay>[2])
      : (await queryBlog<{ captured_lat: number | null; captured_lng: number | null; captured_at: string | null }>(
        `SELECT a.captured_lat,a.captured_lng,a.captured_at FROM blog_media_assets a
         JOIN blog_item_assets ia ON ia.asset_id=a.id JOIN blog_items i ON i.id=ia.item_id JOIN blog_days d ON d.id=i.blog_day_id
         WHERE d.trip_id=$1 AND d.local_date=$2::date AND i.deleted_at IS NULL
         AND i.audience IN (${audiences.map((_, n) => '$' + (n + 3)).join(',')}) AND a.state='ready' AND a.moderation_state <> 'blocked'
         ORDER BY a.captured_at LIMIT 1000`, [tripId, dayDate, ...audiences])).rows;
    const sources: BlogMapSource[] = rows.filter(r => r.captured_lat != null && r.captured_lng != null && r.captured_at != null)
      .map(r => ({ lat: Number(r.captured_lat), lng: Number(r.captured_lng), time: new Date(r.captured_at!).getTime() }));
    const mapPoints = projectBlogDayMapPoints({ sources, membership: exact ? 'traveler' : 'follower', sharedMapEnabled: true, privateAnchors: anchors });
    if (mapPoints) days.push({ dayDate, mapPoints });
  }
  if (actorUserId && await resolveActorMembership(tripId, actorUserId) !== membership) return [];
  return !exact && !await sharing(tripId) ? [] : days;
};
