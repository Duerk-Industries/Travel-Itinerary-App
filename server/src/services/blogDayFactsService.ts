import { queryBlog } from '../db.postgres';
import { getCurrentDbProvider, listFlights, listLodgings, listActivities, listCarRentals } from '../db';
import { fetchOverviewWeather } from '../apis/openMeteoWeatherApi';
import { createTtlCache } from '../utils/ttlCache';
import { getApiCacheSetting } from '../config/apiLimits';
import { resolveActorMembership, visibleAudiencesForMembership } from './blogEngagementService';
import { BlogTargetNotFoundError } from './blogEngagementErrors';
import { createHash } from 'crypto';
import { createBlogReadUrl } from './blogStorageClient';
import { findBundledAirport } from './airportCatalog';
import { getBlogDayByDate, getTripName, getVisibleMediaForDay, getDayMapArtifact } from '../blog/firebaseBlogDayData';

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

type FlightRow = { id: string; departure_date: string; departure_time: string | null; arrival_time: string | null; departure_location: string | null; arrival_location: string | null; departure_airport_code: string | null; arrival_airport_code: string | null; status: string | null };
type LodgingRow = { id: string; name: string; check_in_date: string; check_out_date: string; address: string | null; status: string | null };
type ActivityRow = { id: string; name: string; start_time: string | null; start_location: string | null; status: string | null };
type CarRentalRow = { id: string; vendor: string | null; pickup_date: string; dropoff_date: string; pickup_location: string | null; dropoff_location: string | null; status: string | null };
type MediaRow = { id: string; captured_at: Date | null; captured_lat: number | null; captured_lng: number | null; media_kind_key: string };

const isSameDate = (value: unknown, dayDate: string): boolean => new Date(String(value)).toISOString().slice(0, 10) === dayDate;

export const getDayFacts = async (tripId: string, actorUserId: string, dayDate: string): Promise<BlogDayFactsResult> => {
  const membership = await resolveActorMembership(tripId, actorUserId);
  const cacheKey = `${tripId}:${dayDate}:${membership}`;
  return factsCache.getOrFetch(cacheKey, () => computeDayFacts(tripId, actorUserId, dayDate, membership), getFactsCacheTtlMs());
};

const computeDayFacts = async (tripId: string, actorUserId: string, dayDate: string, membership: 'traveler' | 'follower'): Promise<BlogDayFactsResult> => {
  const isFirebase = getCurrentDbProvider() === 'firebase';

  let dayRow: { rows: Array<{ id: string; headline: string | null; summary: string | null; local_date: string }> };
  if (isFirebase) {
    const day = await getBlogDayByDate(tripId, dayDate);
    dayRow = { rows: day ? [{ id: day.id, headline: day.headline, summary: day.summary, local_date: day.localDate }] : [] };
  } else {
    dayRow = await queryBlog<{ id: string; headline: string | null; summary: string | null; local_date: string }>(
      'SELECT id, headline, summary, local_date FROM blog_days WHERE trip_id = $1 AND local_date = $2::date',
      [tripId, dayDate]
    );
  }
  if (!dayRow.rows[0]) throw new BlogTargetNotFoundError('That day was not found on this trip');
  const dayId = String(dayRow.rows[0].id);
  const asOf = new Date().toISOString();
  const facts: BlogDayFact[] = [];
  const timeline: BlogDayTimelineEntry[] = [];

  // Weather — unchanged existing enrichment (architecture §7.1's own table).
  let tripRow: { rows: Array<{ name: string }> };
  if (isFirebase) {
    const name = await getTripName(tripId);
    tripRow = { rows: name ? [{ name }] : [] };
  } else {
    tripRow = await queryBlog<{ name: string }>('SELECT name FROM trips WHERE id = $1', [tripId]);
  }
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

  // Itinerary-derived facts (distance, places, planned vs. actual) and the itinerary side of the
  // timeline are traveler-only. Flights/lodgings/activities/car rentals carry no audience column
  // at all — there is no per-row visibility rule to apply, so the only safe choice is to exclude
  // this entire source set for a follower rather than guess at a projection (architecture §7.1:
  // "filtered before derivation so it cannot reveal a source the viewer is not authorized to
  // see"). Fetched before the media block below so a traveler's distance fact can combine flight
  // legs with photo geotags into one chronological route rather than two disconnected numbers.
  let flights: { rows: FlightRow[] } = { rows: [] };
  let lodgings: { rows: LodgingRow[] } = { rows: [] };
  let activities: { rows: ActivityRow[] } = { rows: [] };
  let carRentals: { rows: CarRentalRow[] } = { rows: [] };
  // Flight legs resolved to real coordinates via the bundled IATA-code dataset
  // (services/airportCatalog.ts's `data/airport_codes.json`, ~3,300 airports) — the one itinerary
  // source that actually has a stable code to geocode from with no network call, no API budget and
  // no per-row lat/lng column to add. Lodgings/activities/car rentals only ever store a free-text
  // address (see staticMapRoutes.ts's own note on this), so they still can't contribute a real
  // point without a geocoding provider this codebase doesn't have — see the Places fact below,
  // which uses their text as-is instead of pretending to a precision they don't have.
  const flightPoints: Array<{ lat: number; lng: number; time: number }> = [];
  if (membership === 'traveler') {
    if (isFirebase) {
      const [firebaseFlights, firebaseLodgings, firebaseActivities, firebaseCarRentals] = await Promise.all([
        listFlights(actorUserId, tripId),
        listLodgings(actorUserId, tripId),
        listActivities(actorUserId, tripId),
        listCarRentals(actorUserId, tripId),
      ]);
      flights = {
        rows: firebaseFlights
          .filter((f) => f.departureDate === dayDate)
          .map((f) => ({ id: f.id, departure_date: f.departureDate, departure_time: f.departureTime ?? null, arrival_time: f.arrivalTime ?? null, departure_location: f.departureLocation ?? null, arrival_location: f.arrivalLocation ?? null, departure_airport_code: f.departureAirportCode ?? null, arrival_airport_code: f.arrivalAirportCode ?? null, status: f.status ?? null })),
      };
      lodgings = {
        rows: firebaseLodgings
          .filter((l) => isSameDate(l.check_in_date, dayDate) || isSameDate(l.check_out_date, dayDate))
          .map((l) => ({ id: l.id, name: l.name, check_in_date: l.check_in_date, check_out_date: l.check_out_date, address: l.address ?? null, status: l.status ?? null })),
      };
      activities = {
        rows: firebaseActivities
          .filter((a) => a.date === dayDate)
          .map((a) => ({ id: a.id, name: a.name, start_time: a.startTime ?? null, start_location: a.startLocation ?? null, status: a.status ?? null })),
      };
      carRentals = {
        rows: firebaseCarRentals
          .filter((c) => isSameDate(c.pickupDate, dayDate) || isSameDate(c.dropoffDate, dayDate))
          .map((c) => ({ id: c.id, vendor: c.vendor ?? null, pickup_date: c.pickupDate, dropoff_date: c.dropoffDate, pickup_location: c.pickupLocation ?? null, dropoff_location: c.dropoffLocation ?? null, status: c.status ?? null })),
      };
    } else {
      [flights, lodgings, activities, carRentals] = await Promise.all([
        queryBlog<FlightRow>(
          `SELECT id, departure_date, departure_time, arrival_time, departure_location, arrival_location, departure_airport_code, arrival_airport_code, status
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
    }

    for (const row of flights.rows) {
      const departure = findBundledAirport(row.departure_airport_code);
      const arrival = findBundledAirport(row.arrival_airport_code);
      const departureTime = row.departure_time ? Date.parse(`${dayDate}T${row.departure_time}`) : NaN;
      // Arrival can land after midnight local time relative to departure — not modeled here (the
      // dataset has no timezone per airport to compute that correctly), so arrival is always
      // sorted just after departure rather than risking a wrong day-crossing guess.
      const arrivalTime = Number.isFinite(departureTime) ? departureTime + 1 : Date.parse(`${dayDate}T${row.arrival_time ?? '23:59'}`);
      if (departure?.lat != null && departure?.lng != null) {
        flightPoints.push({ lat: departure.lat, lng: departure.lng, time: Number.isFinite(departureTime) ? departureTime : 0 });
      }
      if (arrival?.lat != null && arrival?.lng != null) {
        flightPoints.push({ lat: arrival.lat, lng: arrival.lng, time: Number.isFinite(arrivalTime) ? arrivalTime : 1 });
      }
    }
  }

  // Media facts — the one source set both membership levels ever see, itself still filtered to
  // the audiences that membership level can see (architecture §3.2's own visibility rule, reused
  // rather than re-derived).
  const visibleAudiences = visibleAudiencesForMembership(membership);
  let mediaRows: { rows: MediaRow[] };
  if (isFirebase) {
    mediaRows = { rows: (await getVisibleMediaForDay(dayDate, visibleAudiences)) as unknown as MediaRow[] };
  } else {
    const audiencePlaceholders = visibleAudiences.map((_, i) => `$${i + 2}`).join(',');
    mediaRows = await queryBlog<MediaRow>(
      `SELECT a.id, a.captured_at, a.captured_lat, a.captured_lng, a.media_kind_key
       FROM blog_media_assets a
       JOIN blog_item_assets ia ON ia.asset_id = a.id
       JOIN blog_items i ON i.id = ia.item_id
       WHERE i.blog_day_id = $1 AND i.deleted_at IS NULL AND i.audience IN (${audiencePlaceholders}) AND a.state = 'ready'`,
      [dayId, ...visibleAudiences]
    );
  }
  const mediaPoints = mediaRows.rows
    .filter((r) => r.captured_lat != null && r.captured_lng != null && r.captured_at != null)
    .map((r) => ({ lat: Number(r.captured_lat), lng: Number(r.captured_lng), time: new Date(r.captured_at!).getTime() }));

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

  // Distance — straight-line only (PRD Q4), never a Directions-API route. Combines geotagged
  // photos (both memberships, when present) with resolved flight-leg airport coordinates
  // (travelers only) into one chronological route. A flight leg alone already crosses a real
  // distance, so this is not gated on media existing the way it used to be. Omitted entirely
  // rather than a zero when fewer than two points are available from either source.
  const distancePoints = [...mediaPoints, ...flightPoints].sort((a, b) => a.time - b.time);
  if (distancePoints.length >= 2) {
    let totalKm = 0;
    for (let i = 1; i < distancePoints.length; i += 1) totalKm += haversineKm(distancePoints[i - 1], distancePoints[i]);
    if (totalKm > 0) {
      const sourceTypes = [mediaPoints.length ? 'blog_media_assets' : null, flightPoints.length ? 'flights' : null, flightPoints.length ? 'airport_dataset' : null].filter((t): t is string => t != null);
      facts.push({ key: 'distance', label: 'Distance covered', value: `approx. ${totalKm < 1 ? '<1' : Math.round(totalKm)} km`, sourceTypes, confidence: 'approx', asOf });
    }
  }

  // Day Map Artifact (Phase 5) — keyed on media geotags only, matching exactly what
  // blogBackgroundWorker.ts's render job hashes (it has no flight-leg awareness), so this lookup
  // must use the same media-only point set or it will simply never find the stored artifact.
  if (mediaPoints.length >= 2) {
    const pointsData = mediaPoints.map((p) => `${p.lat},${p.lng}`).sort().join('|');
    const pointsHash = createHash('md5').update(pointsData).digest('hex');
    let artifact: { rows: Array<{ gcs_path: string }> };
    if (isFirebase) {
      const row = await getDayMapArtifact(tripId, dayDate, pointsHash);
      artifact = { rows: row ? [row] : [] };
    } else {
      artifact = await queryBlog<{ gcs_path: string }>(
        'SELECT gcs_path FROM blog_day_map_artifacts WHERE trip_id = $1 AND day_date = $2 AND points_hash = $3',
        [tripId, dayDate, pointsHash]
      );
    }
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

  if (membership === 'traveler') {
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
    for (const row of flights.rows) {
      const departureLabel = findBundledAirport(row.departure_airport_code)?.label ?? row.departure_location;
      const arrivalLabel = findBundledAirport(row.arrival_airport_code)?.label ?? row.arrival_location;
      if (departureLabel) places.add(departureLabel.trim());
      if (arrivalLabel) places.add(arrivalLabel.trim());
    }
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
        sourceTypes: ['flights', 'lodgings', 'tours', 'car_rentals'].filter((t) => (
          t === 'flights' ? flights.rows.length > 0
            : t === 'lodgings' ? lodgings.rows.some((r) => r.address)
            : t === 'tours' ? activities.rows.some((r) => r.start_location)
            : carRentals.rows.some((r) => r.pickup_location || r.dropoff_location)
        )),
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
