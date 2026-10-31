import { listActivities, listDismissedActivitySuggestions, listLodgings } from '../db';
import { baseForDay, loadSeedTemplates } from './tripTemplateService';
import { getTemplatePlace, placeNotesText, toPublicImage, type PublicTemplateImage } from './tripTemplateMedia';
import { isoDay } from './tripDateShiftService';

// Activities from the templates, offered on the Activities page for the days the traveler is in the
// city the activity belongs to. Where the traveler is comes from their lodgings; an activity they
// already have, scheduled or optional, is never suggested again.

export type ActivitySuggestion = {
  key: string;
  name: string;
  city: string;
  activityType: string;
  startTime: string;
  duration: string;
  startLocation: string;
  /** The one-sentence version, shown while the suggestion is on offer. */
  description: string;
  /** The paragraph that becomes the activity's notes once it is added (the sentence again when the stop has no paragraph). */
  details: string;
  image: PublicTemplateImage | null;
  bookAhead: boolean;
  /** Days of the trip spent in this activity's city, earliest first. */
  dates: string[];
};

const MAX_SUGGESTIONS = 30;
const MAX_STAY_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

export const normalize = (value: string): string => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const clock = (value: string): string => (/^\d{1,2}:\d{2}$/.test(value) ? value.padStart(5, '0') : '');
const mentions = (text: string, city: string): boolean => Boolean(city) && ` ${text} `.includes(` ${city} `);

/** An existing activity covers a suggestion when one name contains the other. */
export const sameActivity = (existing: string, suggested: string): boolean => {
  if (!existing || !suggested) return false;
  if (existing === suggested) return true;
  const [short, long] = existing.length <= suggested.length ? [existing, suggested] : [suggested, existing];
  return short.length >= 8 && long.includes(short);
};

/** The nights of each stay, plus the check-out day of the last one, as ISO dates. */
const stayDays = (checkIn: string, checkOut: string): string[] => {
  const start = Date.parse(`${checkIn}T00:00:00Z`);
  const end = Date.parse(`${checkOut}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return [];
  const days: string[] = [];
  for (let at = start; at < end && days.length < MAX_STAY_DAYS; at += DAY_MS) days.push(new Date(at).toISOString().slice(0, 10));
  return days;
};

/** The picture and sentence for an activity the trip already has, when it matches a template activity. */
export type ActivityMedia = { description: string; image: PublicTemplateImage | null };

export type ActivitySuggestionResult = {
  suggestions: ActivitySuggestion[];
  dismissedCount: number;
  /** By activity id, for the trip's undated (optional) activities that match a template activity. */
  activityMedia: Record<string, ActivityMedia>;
};

/**
 * Suggestions this traveler has not dismissed, and how many they have. With a `date`, only the activities
 * for the city the traveler's lodging puts them in that day, in the order they would do them.
 */
export const suggestActivitiesForTrip = async (userId: string, tripId: string, options: { date?: string } = {}): Promise<ActivitySuggestionResult> => {
  const [lodgings, activities] = await Promise.all([listLodgings(userId, tripId), listActivities(userId, tripId)]);
  const all = suggestionsFor(lodgings as any[], activities as any[]);
  const dismissed = new Set(await listDismissedActivitySuggestions(tripId, userId));
  let offered = all.filter((s) => !dismissed.has(s.key));
  if (options.date) offered = offered.filter((s) => s.dates.includes(options.date!)).sort((a, b) => a.startTime.localeCompare(b.startTime));
  return { suggestions: offered.slice(0, MAX_SUGGESTIONS), dismissedCount: all.filter((s) => dismissed.has(s.key)).length, activityMedia: mediaForOptionalActivities(activities as any[]) };
};

const mediaForOptionalActivities = (activities: any[]): Record<string, ActivityMedia> => {
  const optional = activities.filter((activity) => !activity.date && activity.name && activity.status !== 'Cancelled');
  const media: Record<string, ActivityMedia> = {};
  if (!optional.length) return media;
  const templateActivities = loadSeedTemplates().flatMap((template) => template.activities);
  for (const activity of optional) {
    const name = normalize(String(activity.name));
    const match = templateActivities.find((candidate) => sameActivity(name, normalize(candidate.name)));
    const place = match ? getTemplatePlace(match.place) : null;
    const image = toPublicImage(place?.image) ?? null;
    if (place?.description || image) media[String(activity.id)] = { description: place?.description ?? '', image };
  }
  return media;
};

const suggestionsFor = (lodgings: any[], activities: any[]): ActivitySuggestion[] => {
  const staysByDay = new Map<string, string>();
  for (const lodging of lodgings) {
    const checkIn = isoDay(lodging.check_in_date ?? lodging.checkInDate);
    const checkOut = isoDay(lodging.check_out_date ?? lodging.checkOutDate);
    const text = normalize(`${lodging.address ?? ''} ${lodging.name ?? ''}`);
    if (!text) continue;
    // The check-out day belongs to the stay too when no later stay starts that day.
    for (const day of [...stayDays(checkIn, checkOut), ...(checkOut ? [checkOut] : [])]) {
      staysByDay.set(day, `${staysByDay.get(day) ?? ''} ${text}`.trim());
    }
  }
  if (!staysByDay.size) return [];

  const have = activities.map((activity) => normalize(String(activity.name ?? ''))).filter(Boolean);
  const seen = new Set<string>();
  const suggestions: ActivitySuggestion[] = [];
  for (const template of loadSeedTemplates()) {
    for (const activity of template.activities) {
      const city = baseForDay(template, activity.day);
      const name = normalize(activity.name);
      const key = activity.place || `${normalize(city)}/${name}`;
      if (!city || !name || seen.has(key)) continue;
      seen.add(key);
      if (have.some((existing) => sameActivity(existing, name))) continue;
      const cityText = normalize(city);
      const dates = [...staysByDay.entries()].filter(([, text]) => mentions(text, cityText)).map(([day]) => day).sort();
      if (!dates.length) continue;
      const place = getTemplatePlace(activity.place);
      suggestions.push({
        key, name: activity.name, city, activityType: activity.type || 'Other', startTime: clock(activity.time), duration: activity.duration,
        startLocation: activity.where, description: place?.description ?? '', details: placeNotesText(place), image: toPublicImage(place?.image) ?? null,
        bookAhead: Boolean(activity.book), dates,
      });
    }
  }
  suggestions.sort((a, b) => a.dates[0].localeCompare(b.dates[0]) || a.startTime.localeCompare(b.startTime));
  return suggestions;
};
