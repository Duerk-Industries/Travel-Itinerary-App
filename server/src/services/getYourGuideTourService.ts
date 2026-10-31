import fs from 'node:fs';
import { z } from 'zod';
import { deleteGetYourGuideTour, listGetYourGuideTours, upsertGetYourGuideTour, type GetYourGuideTourRecord } from '../db';
import { getGetYourGuideAllowedHosts } from '../config/getYourGuide';
import { logError, logInfo } from '../logger';
import { normalizeItineraryStatus } from '../utils/itineraryStatus';
import { resolveRuntimeDataPath } from '../utils/runtimeDataPath';

// Until there is Partner API access, tours are matched to itinerary activities offline and kept in
// server/data/getyourguide-tours.json (see server/data/trip-template-authoring/GETYOURGUIDE.md). The
// file is synced into the database at startup; a tour dropped from the file is dropped from the database.

const TOUR_PATH = /^\/[a-z0-9-]+-l\d+\/[a-z0-9-]+-t\d+\/?$/;
const CACHE_MS = 5 * 60 * 1000;

export const tourFileSchema = z.object({
  tours: z.array(z.object({
    id: z.string().regex(/^t\d+$/),
    url: z.string().url(),
    title: z.string().min(1),
    rating: z.number().min(0).max(5),
    reviewCount: z.number().int().min(1),
    city: z.string().default(''),
    country: z.string().min(1),
    activities: z.array(z.string().min(1)).min(1),
    checkedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })),
});

let cache: { tours: GetYourGuideTourRecord[]; loadedAt: number } | null = null;

export const clearGetYourGuideTourCacheForTests = (): void => { cache = null; };

const loadTours = async (): Promise<GetYourGuideTourRecord[]> => {
  if (cache && Date.now() - cache.loadedAt < CACHE_MS) return cache.tours;
  const tours = await listGetYourGuideTours();
  cache = { tours, loadedAt: Date.now() };
  return tours;
};

export const syncGetYourGuideToursFromSeed = async (): Promise<number> => {
  const file = resolveRuntimeDataPath('getyourguide-tours.json', process.env.GETYOURGUIDE_TOURS_FILE);
  if (!fs.existsSync(file)) return 0;
  try {
    const { tours } = tourFileSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')));
    const usable = tours.filter((tour) => tourUrl(tour.url) !== null);
    for (const tour of usable) await upsertGetYourGuideTour(tour);
    const keep = new Set(usable.map((tour) => tour.id));
    for (const existing of await listGetYourGuideTours()) {
      if (!keep.has(existing.id)) await deleteGetYourGuideTour(existing.id);
    }
    cache = null;
    logInfo(`[getyourguide] synced ${usable.length} tour(s)`);
    return usable.length;
  } catch (err) {
    // A bad file must not take startup down; the tours already in the database stay in use.
    logError('[getyourguide] ignoring invalid tour file', err);
    return 0;
  }
};

/** The stored tour page, only if it really is a tour page on GetYourGuide, with nothing extra on the address. */
const tourUrl = (raw: string): URL | null => {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || !getGetYourGuideAllowedHosts().includes(url.hostname.toLowerCase())) return null;
    if (url.username || url.password || url.port || !TOUR_PATH.test(url.pathname)) return null;
    url.search = '';
    url.hash = '';
    return url;
  } catch {
    return null;
  }
};

export const buildGetYourGuideTourRedirect = async (tourId: string, partnerId: string): Promise<string | null> => {
  const tour = (await loadTours()).find((candidate) => candidate.id === tourId);
  const url = tour ? tourUrl(tour.url) : null;
  if (!url) return null;
  url.searchParams.set('partner_id', partnerId);
  return url.toString();
};

const normalize = (value: unknown): string => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const mentions = (text: string, place: string): boolean => Boolean(place) && ` ${text} `.includes(` ${place} `);

/** Highest rating * log(number of ratings) wins. */
export const tourScore = (tour: Pick<GetYourGuideTourRecord, 'rating' | 'reviewCount'>): number => tour.rating * Math.log(tour.reviewCount);

export type TourActivity = { id: string; name?: string | null; date?: string | null; status?: unknown; startLocation?: string | null };
export type ActivityTourLink = { tourId: string; title: string; path: string };

/**
 * Links only on an exact activity name in the tour's city or country: a wrong tour is worse than none.
 * Among a stop's matches, a tour that also covers other stops that day comes first, then one covering
 * other stops on the trip, then the best score, so one combined tour is offered for several stops.
 */
export const selectToursForActivities = (
  activities: TourActivity[],
  tripPlace: string,
  tours: GetYourGuideTourRecord[],
): Record<string, ActivityTourLink> => {
  const open = activities.filter((activity) => ['Proposed', 'Needs Booking'].includes(normalizeItineraryStatus(activity.status as any)));
  const matchesFor = new Map<string, GetYourGuideTourRecord[]>(open.map((activity) => {
    const name = normalize(activity.name);
    const place = `${normalize(activity.startLocation)} ${normalize(tripPlace)}`;
    return [activity.id, tours.filter((tour) => tour.activities.some((covered) => normalize(covered) === name)
      && (mentions(place, normalize(tour.city)) || mentions(place, normalize(tour.country))))];
  }));
  const covers = (activity: TourActivity, tour: GetYourGuideTourRecord): boolean => (matchesFor.get(activity.id) ?? []).includes(tour);
  const links: Record<string, ActivityTourLink> = {};
  for (const activity of open) {
    const ranked = (matchesFor.get(activity.id) ?? []).map((tour) => ({
      tour,
      sameDay: open.filter((other) => other.date && other.date === activity.date && covers(other, tour)).length,
      onTrip: open.filter((other) => covers(other, tour)).length,
    })).sort((a, b) => b.sameDay - a.sameDay || b.onTrip - a.onTrip || tourScore(b.tour) - tourScore(a.tour));
    const best = ranked[0]?.tour;
    if (best) links[activity.id] = { tourId: best.id, title: best.title, path: `/api/affiliate/getyourguide/tours/${best.id}` };
  }
  return links;
};

export const getActivityTourLinks = async (activities: TourActivity[], tripPlace: string): Promise<Record<string, ActivityTourLink>> =>
  selectToursForActivities(activities, tripPlace, await loadTours());
