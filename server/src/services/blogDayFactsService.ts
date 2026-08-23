import { queryBlog } from '../db.postgres';
import { fetchOverviewWeather } from '../apis/openMeteoWeatherApi';
import { createTtlCache } from '../utils/ttlCache';
import { getApiCacheSetting } from '../config/apiLimits';
import { resolveActorMembership, visibleAudiencesForMembership } from './blogEngagementService';
import { BlogTargetNotFoundError } from './blogEngagementErrors';
import { createHash } from 'crypto';
import { createBlogReadUrl } from './blogStorageClient';

// Phase 5 of docs/trip-blog-social-implementation-plan.md (C1, C2, C3, C5) — architecture §7.1.
// One service, two projections over the same source set: `facts` (aggregates for the strip) and
// `timeline` (the same data as a sorted list, C3). Both are filtered by the actor's membership
// *before* derivation, never after — a follower must never see a fact whose only source is
// itinerary data they aren't authorized to read, not even indirectly through an aggregate. Facts
// are computed per request and cached in-process only (never persisted): every input already
// lives elsewhere, so a stale materialized fact would be strictly worse than a slightly slower
// request (§7.1's own reasoning for why this cache is a P2 efficiency knob, never a correctness
// or authorization mechanism).

export type FactConfidence = 'high' | 'approx';

export interface BlogDayFact {
  key: 'weather' | 'distance' | 'places' | 'media' | 'plannedVsActual' | 'dayMap';
  label: string;
  value: string;
  sourceTypes: string[];
  confidence: FactConfidence;
  asOf: string;
}

export type BlogTimelineKind = 'flight' | 'lodging_checkin' | 'lodging_checkout' | 'activity' | 'car_rental' | 'media';

export interface BlogDayTimelineEntry {
  id: string;
  kind: BlogTimelineKind;
  time: string | null;
  label: string;
  status?: string | null;
  sourceTypes: string[];
  confidence: FactConfidence;
  asOf: string;
}

export interface BlogDayFactsResult {
  dayDate: string;
  facts: BlogDayFact[];
  timeline: BlogDayTimelineEntry[];
}

const EARTH_RADIUS_KM = 6371;
const toRad = (deg: number): number => (deg * Math.PI) / 180;
// Straight-line haversine only (PRD Q4) — deliberately not a Directions-API route distance, which
// would be a per-day billed call multiplied across every page view (architecture §14.1's exact
// mistake, one section over). Labeled "approx." for that reason, never presented as driving distance.
const haversineKm = (a: { lat: number; lng: number }, b: { lat: number; lng: number }): number => {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
};

const getFactsCacheTtlMs = (): number => {
  const configured = Number(getApiCacheSetting('tripBlog', 'factsCacheTtlMs'));
  return Number.isFinite(configured) && configured > 0 ? configured : 60_000;
};

// In-process cache + local single-flight (createTtlCache already collapses concurrent misses on
// one key — see staticMapRoutes.ts for the same pattern). Keyed by trip/day/membership, per §7.1;
// not by contentRevision — a P2 knob is allowed a bounded staleness window rather than perfect
// invalidation, and factsCacheTtlMs is deliberately short.
const factsCache = createTtlCache<BlogDayFactsResult>({ metricName: 'blog_day_facts' });

export const clearDayFactsCacheForTests = (): void => factsCache.clear();

type FlightRow = { id: string; departure_date: string; departure_time: string | null; arrival_time: string | null; departure_location: string | null; arrival_location: string | null; status: string | null };
type LodgingRow = { id: string; name: string; check_in_date: string; check_out_date: string; address: string | null; status: string | null };
type ActivityRow = { id: string; name: string; start_time: string | null; start_location: string | null; status: string | null };
type CarRentalRow = { id: string; vendor: string | null; pickup_date: string; dropoff_date: string; pickup_location: string | null; dropoff_location: string | null; status: string | null };
type MediaRow = { id: string; captured_at: Date | null; captured_lat: number | null; captured_lng: number | null; media_kind_key: string };

const isSameDate = (value: unknown, dayDate: string): boolean => new Date(String(value)).toISOString().slice(0, 10) === dayDate;

export const getDayFacts = async (tripId: string, actorUserId: string, dayDate: string): Promise<BlogDayFactsResult> => {
  const membership = await resolveActorMembership(tripId, actorUserId);
  const cacheKey = `${tripId}:${dayDate}:${membership}`;
  return factsCache.getOrFetch(cacheKey, () => computeDayFacts(tripId, dayDate, membership), getFactsCacheTtlMs());
};

const computeDayFacts = async (tripId: string, dayDate: string, membership: 'traveler' | 'follower'): Promise<BlogDayFactsResult> => {
  const dayRow = await queryBlog<{ id: string; headline: string | null; summary: string | null; local_date: string }>(
    'SELECT id, headline, summary, local_date FROM blog_days WHERE trip_id = $1 AND local_date = $2::date',
    [tripId, dayDate]
  );
  if (!dayRow.rows[0]) throw new BlogTargetNotFoundError('That day was not found on this trip');
  const dayId = String(dayRow.rows[0].id);
  const asOf = new Date().toISOString();
  const facts: BlogDayFact[] = [];
  const timeline: BlogDayTimelineEntry[] = [];

  // Weather — unchanged existing enrichment (architecture §7.1's own table).
  const tripRow = await queryBlog<{ name: string }>('SELECT name FROM trips WHERE id = $1', [tripId]);
  const location = dayRow.rows[0].headline || dayRow.rows[0].summary || tripRow.rows[0]?.name || 'Destination';
  const { weather } = await fetchOverviewWeather([{ date: dayDate, location }]).catch(() => ({ weather: [] as any[] }));
  const dayWeather = weather.find((w: any) => w.date === dayDate);
  if (dayWeather) {
    facts.push({
      key: 'weather',
      label: 'Weather',
      value: `${dayWeather.icon ?? ''} ${dayWeather.temperatureHighC != null ? `${dayWeather.temperatureHighC}°C` : ''}`.trim(),
      sourceTypes: ['weather'],
      confidence: 'high',
      asOf,
    });
  }

  // Media facts — the one source set both membership levels ever see, itself still filtered to
  // the audiences that membership level can see (architecture §3.2's own visibility rule, reused
  // rather than re-derived).
  const visibleAudiences = visibleAudiencesForMembership(membership);
  const audiencePlaceholders = visibleAudiences.map((_, i) => `$${i + 2}`).join(',');
  const mediaRows = await queryBlog<MediaRow>(
    `SELECT a.id, a.captured_at, a.captured_lat, a.captured_lng, a.media_kind_key
     FROM blog_media_assets a
     JOIN blog_item_assets ia ON ia.asset_id = a.id
     JOIN blog_items i ON i.id = ia.item_id
     WHERE i.blog_day_id = $1 AND i.deleted_at IS NULL AND i.audience IN (${audiencePlaceholders}) AND a.state = 'ready'`,
    [dayId, ...visibleAudiences]
  );
  if (mediaRows.rows.length) {
    const photoCount = mediaRows.rows.filter((r) => r.media_kind_key === 'photo').length;
    const videoCount = mediaRows.rows.filter((r) => r.media_kind_key === 'video').length;
    const captured = mediaRows.rows.map((r) => r.captured_at).filter((v): v is Date => v != null).map((v) => new Date(v).getTime());
    const parts = [photoCount ? `${photoCount} photo${photoCount === 1 ? '' : 's'}` : null, videoCount ? `${videoCount} video${videoCount === 1 ? '' : 's'}` : null].filter(Boolean);
    let value = parts.join(', ');
    if (captured.length >= 2) {
      const span = (Math.max(...captured) - Math.min(...captured)) / 3_600_000;
      if (span > 0) value += ` over ${span < 1 ? '<1 hr' : `${Math.round(span)} hr${Math.round(span) === 1 ? '' : 's'}`}`;
    }
    if (value) {
      facts.push({ key: 'media', label: 'Photos & videos', value, sourceTypes: ['blog_media_assets'], confidence: 'high', asOf });
    }
    // Distance — straight-line only, and only ever derived from geotagged photos (the one
    // coordinate source that actually exists today; see captured_lat/captured_lng, PR-3). Omitted
    // entirely rather than a zero when fewer than two points are geotagged.
    const points = mediaRows.rows
      .filter((r) => r.captured_lat != null && r.captured_lng != null && r.captured_at != null)
      .sort((a, b) => new Date(a.captured_at!).getTime() - new Date(b.captured_at!).getTime())
      .map((r) => ({ lat: Number(r.captured_lat), lng: Number(r.captured_lng) }));
    if (points.length >= 2) {
      let totalKm = 0;
      for (let i = 1; i < points.length; i += 1) totalKm += haversineKm(points[i - 1], points[i]);
      if (totalKm > 0) {
        facts.push({ key: 'distance', label: 'Distance covered', value: `approx. ${totalKm < 1 ? '<1' : Math.round(totalKm)} km`, sourceTypes: ['blog_media_assets'], confidence: 'approx', asOf });
      }

      // Day Map Artifact (Phase 5)
      const pointsData = points.map(p => `${p.lat},${p.lng}`).sort().join('|');
      const pointsHash = createHash('md5').update(pointsData).digest('hex');
      const artifact = await queryBlog<{ gcs_path: string }>(
        'SELECT gcs_path FROM blog_day_map_artifacts WHERE trip_id = $1 AND day_date = $2 AND points_hash = $3',
        [tripId, dayDate, pointsHash]
      );
      if (artifact.rows[0]) {
        // The stored artifact is a bare object path (blog_day_map_artifacts.gcs_path), not a
        // fetchable URL — signed the same way every blog photo already is (architecture §14.1:
        // "served through the existing signed-URL/CDN path"). A signing failure (object missing,
        // credentials misconfigured) degrades this one fact away rather than failing the whole
        // request — the day card must still render without its map, per the "assert budget
        // exhaustion degrades the card rather than erroring the page" contract this same section
        // sets for the render job's own failure mode.
        const mapUrl = await createBlogReadUrl(artifact.rows[0].gcs_path).catch(() => null);
        if (mapUrl) {
          facts.push({
            key: 'dayMap',
            label: 'Day Map',
            value: mapUrl,
            sourceTypes: ['blog_day_map_artifacts'],
            confidence: 'high',
            asOf,
          });
        }
      }
    }
    for (const row of mediaRows.rows) {
      timeline.push({
        id: `media:${row.id}`,
        kind: 'media',
        time: row.captured_at ? new Date(row.captured_at).toISOString() : null,
        label: row.media_kind_key === 'video' ? 'Video' : 'Photo',
        sourceTypes: ['blog_media_assets'],
        confidence: 'high',
        asOf,
      });
    }
  }

  // Itinerary-derived facts (places, planned vs. actual) and the itinerary side of the timeline
  // are traveler-only. Flights/lodgings/activities/car rentals carry no audience column at all —
  // there is no per-row visibility rule to apply, so the only safe choice is to exclude this
  // entire source set for a follower rather than guess at a projection (architecture §7.1: "filtered
  // before derivation so it cannot reveal a source the viewer is not authorized to see").
  if (membership === 'traveler') {
    const [flights, lodgings, activities, carRentals] = await Promise.all([
      queryBlog<FlightRow>(
        `SELECT id, departure_date, departure_time, arrival_time, departure_location, arrival_location, status
         FROM flights WHERE trip_id = $1 AND departure_date = $2::date`,
        [tripId, dayDate]
      ),
      queryBlog<LodgingRow>(
        `SELECT id, name, check_in_date, check_out_date, address, status
         FROM lodgings WHERE trip_id = $1 AND (check_in_date = $2::date OR check_out_date = $2::date)`,
        [tripId, dayDate]
      ),
      queryBlog<ActivityRow>(
        `SELECT id, name, start_time, start_location, status FROM tours WHERE trip_id = $1 AND date = $2::date`,
        [tripId, dayDate]
      ),
      queryBlog<CarRentalRow>(
        `SELECT id, vendor, pickup_date, dropoff_date, pickup_location, dropoff_location, status
         FROM car_rentals WHERE trip_id = $1 AND (pickup_date = $2::date OR dropoff_date = $2::date)`,
        [tripId, dayDate]
      ),
    ]);

    for (const row of flights.rows) {
      timeline.push({ id: `flight:${row.id}`, kind: 'flight', time: row.departure_time ?? null, label: `${row.departure_location ?? 'Departure'} → ${row.arrival_location ?? 'Arrival'}`, status: row.status, sourceTypes: ['flights'], confidence: 'high', asOf });
    }
    for (const row of lodgings.rows) {
      if (isSameDate(row.check_in_date, dayDate)) timeline.push({ id: `lodging-in:${row.id}`, kind: 'lodging_checkin', time: null, label: `Check in — ${row.name}`, status: row.status, sourceTypes: ['lodgings'], confidence: 'high', asOf });
      if (isSameDate(row.check_out_date, dayDate)) timeline.push({ id: `lodging-out:${row.id}`, kind: 'lodging_checkout', time: null, label: `Check out — ${row.name}`, status: row.status, sourceTypes: ['lodgings'], confidence: 'high', asOf });
    }
    for (const row of activities.rows) {
      timeline.push({ id: `activity:${row.id}`, kind: 'activity', time: row.start_time ?? null, label: row.name, status: row.status, sourceTypes: ['tours'], confidence: 'high', asOf });
    }
    for (const row of carRentals.rows) {
      if (isSameDate(row.pickup_date, dayDate)) timeline.push({ id: `car-pickup:${row.id}`, kind: 'car_rental', time: null, label: `Pick up — ${row.vendor ?? 'Car rental'}`, status: row.status, sourceTypes: ['car_rentals'], confidence: 'high', asOf });
      if (isSameDate(row.dropoff_date, dayDate)) timeline.push({ id: `car-dropoff:${row.id}`, kind: 'car_rental', time: null, label: `Drop off — ${row.vendor ?? 'Car rental'}`, status: row.status, sourceTypes: ['car_rentals'], confidence: 'high', asOf });
    }

    const places = new Set<string>();
    for (const row of lodgings.rows) if (row.address) places.add(row.address.trim());
    for (const row of activities.rows) if (row.start_location) places.add(row.start_location.trim());
    for (const row of carRentals.rows) {
      if (row.pickup_location) places.add(row.pickup_location.trim());
      if (row.dropoff_location) places.add(row.dropoff_location.trim());
    }
    if (places.size) {
      facts.push({
        key: 'places',
        label: 'Places',
        value: [...places].slice(0, 5).join(', ') + (places.size > 5 ? `, +${places.size - 5} more` : ''),
        sourceTypes: ['lodgings', 'tours', 'car_rentals'].filter((t) => (t === 'lodgings' ? lodgings.rows.some((r) => r.address) : t === 'tours' ? activities.rows.some((r) => r.start_location) : carRentals.rows.some((r) => r.pickup_location || r.dropoff_location))),
        confidence: 'high',
        asOf,
      });
    }

    if (activities.rows.length) {
      const completed = activities.rows.filter((r) => r.status === 'Completed').length;
      const cancelled = activities.rows.filter((r) => r.status === 'Cancelled').length;
      if (completed || cancelled) {
        const parts = [completed ? `${completed} completed` : null, cancelled ? `${cancelled} cancelled` : null].filter(Boolean);
        facts.push({ key: 'plannedVsActual', label: 'Planned vs. actual', value: `${parts.join(', ')} of ${activities.rows.length} planned`, sourceTypes: ['tours'], confidence: 'high', asOf });
      }
    }
  }

  timeline.sort((a, b) => {
    if (a.time && b.time) return a.time.localeCompare(b.time);
    if (a.time) return -1;
    if (b.time) return 1;
    return a.label.localeCompare(b.label);
  });

  return { dayDate, facts, timeline };
};
