import { getActivityImageCache, saveActivityImageCache } from '../db';
import { fetchUnsplashPhotoForActivity } from '../apis/unsplashCallers';
import { getEnvFlag, getEnvValue } from '../env';
import { logError } from '../logger';
import { loadSeedTemplates } from './tripTemplateService';
import { getTemplatePlace, toPublicImage } from './tripTemplateMedia';
import { normalize, sameActivity } from './tripActivitySuggestionService';

// A picture for an activity, found without the traveler adding one. First choice is the public-domain photo the trip
// templates carry for the same stop (credited to its photographer); failing that, an Unsplash photo found by the
// activity's name. What was found is remembered by name for every trip, including that nothing was found, so a name
// is looked up once. Lookups that are not awaited run in the background and show up the next time the page loads.

export type ActivityImage = { url: string; credit: string; pageUrl: string; width?: number; height?: number };

const RECHECK_MISSING_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_LOOKUPS_IN_FLIGHT = 4;

/** Items that name the same activity share a picture. */
export const activityImageKey = (name: unknown): string => normalize(String(name ?? ''));

/** The template's photo for a stop of this name, when a template has one. */
export const templateImageFor = (name: unknown): ActivityImage | null => {
  const wanted = activityImageKey(name);
  if (!wanted) return null;
  for (const template of loadSeedTemplates()) {
    for (const activity of template.activities) {
      if (!sameActivity(wanted, normalize(activity.name))) continue;
      const image = toPublicImage(getTemplatePlace(activity.place)?.image);
      if (image) return image;
    }
  }
  return null;
};

const inFlight = new Map<string, Promise<void>>();

const lookUp = (key: string, name: string, place: string): Promise<void> => {
  const running = inFlight.get(key);
  if (running) return running;
  const accessKey = getEnvValue('UNSPLASH_ACCESS_KEY');
  if (!accessKey) return Promise.resolve();
  // A developer's real key must never make a test call the provider; tests that mock it opt in.
  if (process.env.NODE_ENV === 'test' && !getEnvFlag('ACTIVITY_PHOTO_LOOKUPS_IN_TESTS')) return Promise.resolve();
  const task = (async () => {
    try {
      const photo = await fetchUnsplashPhotoForActivity(accessKey, name, place);
      // undefined: the provider limit stopped the search, so try again later rather than record "none".
      if (photo !== undefined) await saveActivityImageCache(key, photo);
    } catch (err) {
      logError(`[activity-images] lookup failed for "${name}"`, err);
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, task);
  return task;
};

export type ActivityImageRequest = { name: unknown; place?: unknown };

/**
 * The picture for each requested activity, by activity-name key (null when there is none yet). `awaitLookups` is how
 * many names without a remembered result are searched for before answering; any beyond that are searched in the
 * background, a few at a time.
 */
export const resolveActivityImages = async (requests: ActivityImageRequest[], options: { awaitLookups?: number } = {}): Promise<Map<string, ActivityImage | null>> => {
  const images = new Map<string, ActivityImage | null>();
  const wanted = new Map<string, { name: string; place: string }>();
  for (const request of requests) {
    const key = activityImageKey(request.name);
    if (!key || images.has(key) || wanted.has(key)) continue;
    const fromTemplate = templateImageFor(request.name);
    if (fromTemplate) images.set(key, fromTemplate);
    else wanted.set(key, { name: String(request.name).trim(), place: String(request.place ?? '').trim() });
  }
  if (!wanted.size) return images;

  const remembered = await getActivityImageCache([...wanted.keys()]);
  const toLookUp: string[] = [];
  for (const [key] of wanted) {
    const entry = remembered[key];
    if (entry?.url) images.set(key, { url: entry.url, credit: entry.credit, pageUrl: entry.pageUrl });
    else {
      images.set(key, null);
      if (!entry || Date.now() - entry.checkedAt.getTime() > RECHECK_MISSING_AFTER_MS) toLookUp.push(key);
    }
  }

  const search = (key: string) => lookUp(key, wanted.get(key)!.name, wanted.get(key)!.place);
  const awaited = toLookUp.splice(0, Math.max(0, options.awaitLookups ?? 0));
  // The awaited names are searched a few at a time; their results are read back once all have finished.
  for (let i = 0; i < awaited.length; i += MAX_LOOKUPS_IN_FLIGHT) await Promise.all(awaited.slice(i, i + MAX_LOOKUPS_IN_FLIGHT).map(search));
  if (awaited.length) {
    const found = await getActivityImageCache(awaited);
    for (const key of awaited) if (found[key]?.url) images.set(key, { url: found[key].url as string, credit: found[key].credit, pageUrl: found[key].pageUrl });
  }
  for (const key of toLookUp) {
    if (inFlight.size >= MAX_LOOKUPS_IN_FLIGHT) break;
    void search(key);
  }
  return images;
};

/** Adds `image` (url, credit, pageUrl, or null) to each activity. */
export const attachActivityImages = async <T extends { name?: unknown; geoCity?: unknown }>(activities: T[]): Promise<Array<T & { image: ActivityImage | null }>> => {
  if (!activities.length) return [];
  const images = await resolveActivityImages(activities.map((activity) => ({ name: activity.name, place: activity.geoCity })));
  return activities.map((activity) => ({ ...activity, image: images.get(activityImageKey(activity.name)) ?? null }));
};
