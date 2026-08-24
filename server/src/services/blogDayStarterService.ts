import { queryBlog } from '../db.postgres';
import { ensureUserInTrip, getCurrentDbProvider, listFlights, listLodgings, listActivities, listCarRentals } from '../db';
import { buildNarrativeBlogBody } from '../blog/narrative';
import { blogRepository } from '../blog/repository';
import { BlogTextItem } from '../blog/types';
import { BlogEngagementUnauthorizedError } from './blogEngagementErrors';
import {
  getBlogDayByDate,
  hasTextItemForDay,
  getDayStarterDismissed,
  insertDayStarterDismissal,
  countAllReadyMediaForDay,
} from '../blog/firebaseBlogDayData';

// Phase 5 of docs/trip-blog-social-implementation-plan.md (A1) — architecture §8: a deterministic
// template, never an LLM call. Same inputs always produce the same output (testable, free, can't
// hallucinate a restaurant the group never went to); the "Rewrite" button in the UI is a separate,
// explicit, user-initiated LLM call behind trip_blog_ai_highlights, not built here.
//
// A starter is never persisted before acceptance (FR-A1.2) — getDayStarter only ever reads.
// acceptDayStarter recomputes the suggestion itself rather than trusting a client-echoed body, so
// what gets stored is always exactly what was actually shown, byte for byte.

export interface DayStarterSuggestion {
  dayDate: string;
  body: string;
  sourceTypes: string[];
}

type FlightRow = { id: string; departure_time: string | null; departure_location: string | null; arrival_location: string | null };
type LodgingRow = { id: string; name: string; check_in_date: string; check_out_date: string };
type ActivityRow = { id: string; name: string; start_time: string | null; notes: string | null };
type CarRentalRow = { id: string; vendor: string | null; pickup_date: string; dropoff_date: string };
type MediaCountRow = { count: string };

const WEEKDAY_FORMATTER = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' });
const weekdayOf = (dayDate: string): string => WEEKDAY_FORMATTER.format(new Date(`${dayDate}T00:00:00.000Z`));

const isSameDate = (value: unknown, dayDate: string): boolean => new Date(String(value)).toISOString().slice(0, 10) === dayDate;

// Ordered (time, sentence, sourceType) tuples get sorted once, then joined — "ordered by time,
// joined" per architecture §8's pseudocode. Untimed entries (lodging check-in/out, car rental)
// sort after every timed entry, in the stable order they were assembled (checkins before
// checkouts before car rentals), which is itself deterministic.
type Sentence = { time: string | null; text: string; sourceType: string };

const assembleSentences = async (tripId: string, actorUserId: string, dayDate: string): Promise<Sentence[]> => {
  let flights: { rows: FlightRow[] };
  let lodgings: { rows: LodgingRow[] };
  let activities: { rows: ActivityRow[] };
  let carRentals: { rows: CarRentalRow[] };

  if (getCurrentDbProvider() === 'firebase') {
    const [firebaseFlights, firebaseLodgings, firebaseActivities, firebaseCarRentals] = await Promise.all([
      listFlights(actorUserId, tripId),
      listLodgings(actorUserId, tripId),
      listActivities(actorUserId, tripId),
      listCarRentals(actorUserId, tripId),
    ]);
    flights = { rows: firebaseFlights.filter((f) => f.departureDate === dayDate).map((f) => ({ id: f.id, departure_time: f.departureTime ?? null, departure_location: f.departureLocation ?? null, arrival_location: f.arrivalLocation ?? null })) };
    lodgings = { rows: firebaseLodgings.filter((l) => isSameDate(l.check_in_date, dayDate) || isSameDate(l.check_out_date, dayDate)).map((l) => ({ id: l.id, name: l.name, check_in_date: l.check_in_date, check_out_date: l.check_out_date })) };
    activities = {
      rows: firebaseActivities
        .filter((a) => a.date === dayDate)
        .sort((a, b) => (a.startTime ?? '￿').localeCompare(b.startTime ?? '￿'))
        .map((a) => ({ id: a.id, name: a.name, start_time: a.startTime ?? null, notes: a.notes ?? null })),
    };
    carRentals = { rows: firebaseCarRentals.filter((c) => isSameDate(c.pickupDate, dayDate) || isSameDate(c.dropoffDate, dayDate)).map((c) => ({ id: c.id, vendor: c.vendor ?? null, pickup_date: c.pickupDate, dropoff_date: c.dropoffDate })) };
  } else {
    [flights, lodgings, activities, carRentals] = await Promise.all([
      queryBlog<FlightRow>(
        `SELECT id, departure_time, departure_location, arrival_location FROM flights WHERE trip_id = $1 AND departure_date = $2::date`,
        [tripId, dayDate]
      ),
      queryBlog<LodgingRow>(
        `SELECT id, name, check_in_date, check_out_date FROM lodgings WHERE trip_id = $1 AND (check_in_date = $2::date OR check_out_date = $2::date)`,
        [tripId, dayDate]
      ),
      queryBlog<ActivityRow>(
        `SELECT id, name, start_time, notes FROM tours WHERE trip_id = $1 AND date = $2::date ORDER BY start_time ASC NULLS LAST, created_at ASC`,
        [tripId, dayDate]
      ),
      queryBlog<CarRentalRow>(
        `SELECT id, vendor, pickup_date, dropoff_date FROM car_rentals WHERE trip_id = $1 AND (pickup_date = $2::date OR dropoff_date = $2::date)`,
        [tripId, dayDate]
      ),
    ]);
  }

  const sentences: Sentence[] = [];
  for (const row of flights.rows) {
    sentences.push({
      time: row.departure_time,
      text: `Flew from ${row.departure_location || 'the departure point'} to ${row.arrival_location || 'the destination'}.`,
      sourceType: 'flights',
    });
  }
  for (const row of lodgings.rows) {
    if (isSameDate(row.check_in_date, dayDate)) sentences.push({ time: null, text: `Checked into ${row.name}.`, sourceType: 'lodgings' });
    if (isSameDate(row.check_out_date, dayDate)) sentences.push({ time: null, text: `Checked out of ${row.name}.`, sourceType: 'lodgings' });
  }
  for (const row of activities.rows) {
    const sentence = buildNarrativeBlogBody({ activity: row.name, kind: 'activity', noteBody: row.notes });
    if (sentence) sentences.push({ time: row.start_time, text: sentence, sourceType: 'tours' });
  }
  for (const row of carRentals.rows) {
    if (isSameDate(row.pickup_date, dayDate)) sentences.push({ time: null, text: `Picked up a rental car from ${row.vendor || 'the rental desk'}.`, sourceType: 'car_rentals' });
    if (isSameDate(row.dropoff_date, dayDate)) sentences.push({ time: null, text: `Dropped off the rental car at ${row.vendor || 'the rental desk'}.`, sourceType: 'car_rentals' });
  }

  return sentences.sort((a, b) => {
    if (a.time && b.time) return a.time.localeCompare(b.time);
    if (a.time) return -1;
    if (b.time) return 1;
    return 0; // stable: Array.prototype.sort is guaranteed stable in Node, so assembly order is preserved
  });
};

export const getDayStarter = async (tripId: string, actorUserId: string, dayDate: string): Promise<DayStarterSuggestion | null> => {
  if (!(await ensureUserInTrip(tripId, actorUserId))) throw new BlogEngagementUnauthorizedError('Not authorized on this trip');
  const isFirebase = getCurrentDbProvider() === 'firebase';

  let dayId: string;
  if (isFirebase) {
    const day = await getBlogDayByDate(tripId, dayDate);
    if (!day) return null;
    dayId = day.id;
  } else {
    const dayRow = await queryBlog<{ id: string }>('SELECT id FROM blog_days WHERE trip_id = $1 AND local_date = $2::date', [tripId, dayDate]);
    if (!dayRow.rows[0]) return null;
    dayId = String(dayRow.rows[0].id);
  }

  // FR-A1.3: suppressed after this user dismissed it for this day, or once the day already has
  // any text content — a starter is a blank-page aid, not something that reappears over a
  // traveler's own writing.
  let dismissed: boolean;
  let hasExistingText: boolean;
  if (isFirebase) {
    [dismissed, hasExistingText] = await Promise.all([
      getDayStarterDismissed(tripId, dayDate, actorUserId),
      hasTextItemForDay(dayId),
    ]);
  } else {
    const [dismissedResult, existingTextResult] = await Promise.all([
      queryBlog<{ user_id: string }>('SELECT user_id FROM blog_day_starter_dismissals WHERE trip_id = $1 AND local_date = $2::date AND user_id = $3', [tripId, dayDate, actorUserId]),
      queryBlog<{ id: string }>(`SELECT id FROM blog_items WHERE blog_day_id = $1 AND kind_key = 'core.text' AND deleted_at IS NULL LIMIT 1`, [dayId]),
    ]);
    dismissed = Boolean(dismissedResult.rows[0]);
    hasExistingText = Boolean(existingTextResult.rows[0]);
  }
  if (dismissed || hasExistingText) return null;

  const sentences = await assembleSentences(tripId, actorUserId, dayDate);
  if (sentences.length) {
    return { dayDate, body: sentences.map((s) => s.text).join(' '), sourceTypes: [...new Set(sentences.map((s) => s.sourceType))] };
  }

  // Nothing but media, or nothing at all. A media-only day still gets a starter; a day with
  // neither itinerary data nor media gets none — there is nothing true to say about it yet.
  let count: number;
  if (isFirebase) {
    count = await countAllReadyMediaForDay(dayId);
  } else {
    const mediaCount = await queryBlog<MediaCountRow>(
      `SELECT COUNT(*)::text AS count FROM blog_media_assets a
       JOIN blog_item_assets ia ON ia.asset_id = a.id JOIN blog_items i ON i.id = ia.item_id
       WHERE i.blog_day_id = $1 AND i.deleted_at IS NULL AND a.state = 'ready'`,
      [dayId]
    );
    count = Number(mediaCount.rows[0]?.count ?? 0);
  }
  if (count === 0) return null;
  // "+ place names from geotags, if enabled" (architecture §8) would need reverse geocoding from
  // captured_lat/captured_lng to a human place name, which this codebase has no provider for
  // today (the same gap noted in staticMapRoutes.ts's history) — so this omits place names
  // honestly rather than fabricate them, and revisits this once/if that provider exists.
  return { dayDate, body: `${count} photo${count === 1 ? '' : 's'} from ${weekdayOf(dayDate)}.`, sourceTypes: ['blog_media_assets'] };
};

export const acceptDayStarter = async (tripId: string, actorUserId: string, dayDate: string): Promise<BlogTextItem> => {
  const suggestion = await getDayStarter(tripId, actorUserId, dayDate);
  if (!suggestion) throw new Error('There is no Day Starter suggestion for this day right now');
  return blogRepository().createBlogTextItem(actorUserId, tripId, { dayDate, body: suggestion.body, sourceType: 'day_starter' });
};

export const dismissDayStarter = async (tripId: string, actorUserId: string, dayDate: string): Promise<void> => {
  if (!(await ensureUserInTrip(tripId, actorUserId))) throw new BlogEngagementUnauthorizedError('Not authorized on this trip');
  if (getCurrentDbProvider() === 'firebase') {
    await insertDayStarterDismissal(tripId, dayDate, actorUserId);
    return;
  }
  await queryBlog(
    'INSERT INTO blog_day_starter_dismissals (trip_id, local_date, user_id) VALUES ($1, $2::date, $3) ON CONFLICT (trip_id, local_date, user_id) DO NOTHING',
    [tripId, dayDate, actorUserId]
  );
};
