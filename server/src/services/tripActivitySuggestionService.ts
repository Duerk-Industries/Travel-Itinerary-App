import { listActivities, listDismissedActivitySuggestions, listLodgings } from '../db';
import { baseForDay, loadSeedTemplates } from './tripTemplateService';
import { getTemplatePlace, toPublicImage, type PublicTemplateImage } from './tripTemplateMedia';
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
  description: string;
  image: PublicTemplateImage | null;
  bookAhead: boolean;
  /** Days of the trip spent in this activity's city, earliest first. */
  dates: string[];
};

const MAX_SUGGESTIONS = 30;
const MAX_STAY_DAYS = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

const normalize = (value: string): string => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const clock = (value: string): string => (/^\d{1,2}:\d{2}$/.test(value) ? value.padStart(5, '0') : '');
const mentions = (text: string, city: string): boolean => Boolean(city) && ` ${text} `.includes(` ${city} `);

/** An existing activity covers a suggestion when one name contains the other. */
const sameActivity = (existing: string, suggested: string): boolean => {
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

export type ActivitySuggestionResult = { suggestions: ActivitySuggestion[]; dismissedCount: number };

/** Suggestions this traveler has not dismissed, and how many they have. */
export const suggestActivitiesForTrip = async (userId: string, tripId: string): Promise<ActivitySuggestionResult> => {
  const all = await allSuggestionsForTrip(userId, tripId);
  const dismissed = new Set(await listDismissedActivitySuggestions(tripId, userId));
  return { suggestions: all.filter((s) => !dismissed.has(s.key)).slice(0, MAX_SUGGESTIONS), dismissedCount: all.filter((s) => dismissed.has(s.key)).length };
};

const allSuggestionsForTrip = async (userId: string, tripId: string): Promise<ActivitySuggestion[]> => {
  const [lodgings, activities] = await Promise.all([listLodgings(userId, tripId), listActivities(userId, tripId)]);
  const staysByDay = new Map<string, string>();
  for (const lodging of lodgings as any[]) {
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

  const have = (activities as any[]).map((activity) => normalize(String(activity.name ?? ''))).filter(Boolean);
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
        startLocation: activity.where, description: place?.description ?? '', image: toPublicImage(place?.image) ?? null,
        bookAhead: Boolean(activity.book), dates,
      });
    }
  }
  suggestions.sort((a, b) => a.dates[0].localeCompare(b.dates[0]) || a.startTime.localeCompare(b.startTime));
  return suggestions;
};
