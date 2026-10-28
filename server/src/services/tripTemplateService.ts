import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  addItineraryDetail,
  createItineraryRecord,
  getTripById,
  insertActivity,
  insertFlight,
  insertLodging,
  listGroupMembers,
  listTripTemplates,
  upsertTripTemplate,
  type TripTemplateRecord,
  addTripEstimatedItems,
} from '../db';
import { logError, logInfo } from '../logger';
import { resolveRuntimeDataPath } from '../utils/runtimeDataPath';
import { getLocationOptionsByIds } from './locationServices';
import { getTemplateDestination, getTemplatePlace, toPublicImage, type PublicTemplateImage } from './tripTemplateMedia';

// A template is seed data in the repo (server/data/trip-templates/*.json, written by
// server/tools/trip-templates/generate.py): a day-offset plan with day 0 as the arrival day. The
// trip_templates table holds the catalogue row that associates it with destinations; the plan
// itself is always read from the seed file, so a corrected file takes effect on deploy.

const seedSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1).max(80),
  title: z.string().min(1),
  summary: z.string().default(''),
  days: z.number().int().min(1).max(60),
  route: z.string().default(''),
  arrive: z.string().default(''),
  depart: z.string().default(''),
  countries: z.array(z.string()).min(1),
  cities: z.array(z.string()).default([]),
  imageQuery: z.string().default(''),
  highlights: z.array(z.string()).default([]),
  /** Destination keys (country, then cities) whose shared description and pictures belong with this template. */
  destinationKeys: z.array(z.string()).default([]),
  /** The destination whose first picture is the card's. */
  hero: z.string().default(''),
  stays: z.array(z.object({
    base: z.string(), hotel: z.string(), start: z.number().int().min(0), nights: z.number().int().min(1), area: z.string().default(''),
    breakfast: z.boolean().default(false), dinner: z.boolean().default(false),
  })),
  activities: z.array(z.object({
    day: z.number().int().min(0), type: z.string(), time: z.string().default(''), duration: z.string().default(''), name: z.string().min(1),
    notes: z.string().default(''), where: z.string().default(''), book: z.string().default(''),
    /** Key into the shared media catalogue, for this stop's description and picture. */
    place: z.string().default(''),
  })),
  legs: z.array(z.object({
    day: z.number().int().min(0), transferType: z.string(), from: z.string().min(1), to: z.string().min(1), time: z.string().default(''),
    minutes: z.number().int().min(0), carrier: z.string().default(''), notes: z.string().default(''), book: z.string().default(''),
  })),
});
export type SeedTemplate = z.infer<typeof seedSchema> & { contentHash: string };

/** Shown on a lodging card until the traveler picks their own hotel. */
export const CHOOSE_HOTEL_FEATURE = 'Choose your hotel';
const NEEDS_BOOKING = 'Needs Booking';

let seedCache: SeedTemplate[] | null = null;

export const clearTripTemplateCacheForTests = (): void => { seedCache = null; };

export const loadSeedTemplates = (): SeedTemplate[] => {
  if (seedCache) return seedCache;
  const dir = resolveRuntimeDataPath('trip-templates', process.env.TRIP_TEMPLATES_DIR);
  const loaded: SeedTemplate[] = [];
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.endsWith('.json')).sort() : [];
  for (const name of files) {
    try {
      const raw = fs.readFileSync(path.join(dir, name), 'utf8');
      const parsed = seedSchema.parse(JSON.parse(raw));
      loaded.push({ ...parsed, contentHash: createHash('sha256').update(raw).digest('hex') });
    } catch (err) {
      // One bad file must not take the other templates, or startup, down with it.
      logError(`[trip-templates] ignoring invalid seed file ${name}`, err);
    }
  }
  seedCache = loaded;
  return loaded;
};

export const getSeedTemplate = (id: string): SeedTemplate | null => loadSeedTemplates().find((template) => template.id === id) ?? null;

/** Writes the catalogue rows for every seed file. Safe to run on every start; an admin's `enabled` is kept. */
export const syncTripTemplatesFromSeed = async (): Promise<number> => {
  const templates = loadSeedTemplates();
  let order = 0;
  for (const template of templates) {
    await upsertTripTemplate({
      id: template.id, title: template.title, summary: template.summary, days: template.days, route: template.route,
      imageQuery: template.imageQuery, countries: template.countries, cities: template.cities, highlights: template.highlights,
      contentHash: template.contentHash, enabled: true, sortOrder: order += 10,
    });
  }
  logInfo(`[trip-templates] synced ${templates.length} template(s)`);
  return templates.length;
};

// ------------------------------------------------------------------------ matching

const normalize = (value: string): string => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export type SelectedDestinations = { countries: string[]; cities: string[] };

/**
 * The countries and cities a traveler chose, from the location ids the wizard holds plus the names
 * its search results carried (destination results are not in the country/state dataset).
 */
export const resolveSelectedDestinations = async (input: { locationIds?: string[]; countries?: string[]; cities?: string[] }): Promise<SelectedDestinations> => {
  const countries = new Set<string>((input.countries ?? []).map(normalize).filter(Boolean));
  const cities = new Set<string>((input.cities ?? []).map(normalize).filter(Boolean));
  const ids = (input.locationIds ?? []).filter(Boolean).slice(0, 25);
  if (ids.length) {
    const options = await getLocationOptionsByIds(ids).catch(() => []);
    for (const option of options) {
      if (option.sourceType === 'country') countries.add(normalize(option.name));
      else if (option.countryName) countries.add(normalize(option.countryName));
    }
  }
  return { countries: [...countries], cities: [...cities] };
};

/** A template is offered only for a destination it covers: a chosen country it is in, or a city it visits. */
export const templatesForDestinations = (templates: TripTemplateRecord[], selected: SelectedDestinations, maxDays?: number | null): Array<TripTemplateRecord & { matchedCities: string[] }> => {
  if (!selected.countries.length && !selected.cities.length) return [];
  // A template longer than the trip would not fit it; with no known trip length, length is not a filter.
  const fits = (template: TripTemplateRecord) => !(maxDays && maxDays > 0) || template.days <= maxDays;
  const result = templates
    .filter(fits)
    .map((template) => {
      const countryMatch = template.countries.some((country) => selected.countries.includes(normalize(country)));
      const matchedCities = template.cities.filter((city) => selected.cities.includes(normalize(city)));
      return { template, matched: countryMatch || matchedCities.length > 0, matchedCities };
    })
    .filter((entry) => entry.matched);
  // Templates that visit a city the traveler picked first, then the catalogue order.
  result.sort((a, b) => b.matchedCities.length - a.matchedCities.length);
  return result.map((entry) => ({ ...entry.template, matchedCities: entry.matchedCities }));
};

export const listOfferedTemplates = async (selected: SelectedDestinations, maxDays?: number | null) => {
  const records = await listTripTemplates({ enabledOnly: true });
  const known = new Set(loadSeedTemplates().map((template) => template.id));
  // A catalogue row whose seed file is gone cannot be created, so it is never offered.
  return templatesForDestinations(records.filter((record) => known.has(record.id)), selected, maxDays);
};

// ------------------------------------------------------------------------ preview

export type TemplatePreviewItem = { kind: 'stay' | 'activity' | 'transfer'; time: string; title: string; detail: string; needsBooking: boolean; description?: string; image?: PublicTemplateImage | null };
export type TemplatePreviewDay = { day: number; base: string; items: TemplatePreviewItem[] };

const clock = (value: string): string => (/^\d{1,2}:\d{2}$/.test(value) ? value.padStart(5, '0') : '');
const durationText = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h${String(m).padStart(2, '0')}m` : `${m}m`;
};
export const baseForDay = (template: SeedTemplate, offset: number): string => template.stays.find((stay) => offset >= stay.start && offset < stay.start + stay.nights)?.base
  ?? template.stays[template.stays.length - 1]?.base ?? '';

/** The plan day by day, for the preview a traveler reads before choosing it. Day numbers start at 1. */
export const buildTemplatePreview = (template: SeedTemplate): TemplatePreviewDay[] => {
  const days: TemplatePreviewDay[] = Array.from({ length: template.days }, (_, offset) => ({ day: offset + 1, base: baseForDay(template, offset), items: [] }));
  const put = (offset: number, item: TemplatePreviewItem) => { (days[Math.min(offset, days.length - 1)]).items.push(item); };
  for (const stay of template.stays) {
    put(stay.start, { kind: 'stay', time: '', title: `Check in: ${stay.hotel}`, detail: `${stay.nights} night${stay.nights === 1 ? '' : 's'}${stay.area ? ` · ${stay.area}` : ''}`, needsBooking: false });
  }
  for (const activity of template.activities) {
    const place = getTemplatePlace(activity.place);
    put(activity.day, { kind: 'activity', time: clock(activity.time), title: activity.name, detail: [activity.duration, activity.where].filter(Boolean).join(' · '), needsBooking: Boolean(activity.book), description: place?.description || undefined, image: toPublicImage(place?.image) });
  }
  for (const leg of template.legs) {
    put(leg.day, { kind: 'transfer', time: clock(leg.time), title: `${leg.from} to ${leg.to}`, detail: [leg.carrier, durationText(leg.minutes)].filter(Boolean).join(' · '), needsBooking: Boolean(leg.book) });
  }
  for (const day of days) day.items.sort((a, b) => (a.kind === 'stay' ? 0 : 1) - (b.kind === 'stay' ? 0 : 1) || (a.time || '99:99').localeCompare(b.time || '99:99'));
  return days;
};

// ------------------------------------------------------------------------ creation

const addDays = (isoDate: string, days: number): string => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export const isIsoDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
};

export const templateEndDate = (template: Pick<SeedTemplate, 'days'>, startDate: string): string => addDays(startDate, template.days - 1);

const bookAheadNote = (reason: string): string => `Book ahead: ${reason.replace(/^Yes\s*-\s*/i, '')}.`;

/**
 * Fills an empty, just-created trip from a template. Everything arrives as Proposed, or Needs Booking
 * where the plan says to book ahead, and lodging is a placeholder the traveler is nudged to replace.
 */
export const populateTripFromTemplate = async (params: { userId: string; tripId: string; groupId: string; template: SeedTemplate; startDate: string; estimated?: boolean }): Promise<{ lodgings: number; activities: number; transfers: number; notes: number }> => {
  const { userId, tripId, groupId, template, startDate, estimated } = params;
  const suggested: Array<{ type: 'activity' | 'lodging' | 'transfer'; id: string }> = [];
  const trip: any = await getTripById(tripId);
  const memberRows: any[] = await listGroupMembers(groupId, userId).catch(() => []);
  const members = memberRows.map((member: any) => ({
    id: String(member.id),
    name: member.guestName || `${member.firstName ?? ''} ${member.lastName ?? ''}`.trim() || member.email || 'Passenger',
  }));
  const travelerIds = members.map((member) => member.id);
  const dateOf = (offset: number) => addDays(startDate, offset);

  for (const stay of template.stays) {
    const features = [stay.breakfast ? 'Breakfast' : '', stay.dinner ? 'Dinner' : '', CHOOSE_HOTEL_FEATURE].filter(Boolean);
    const lodging: any = await insertLodging({
      userId, tripId, status: 'Proposed', name: stay.hotel, checkInDate: dateOf(stay.start), checkOutDate: dateOf(stay.start + stay.nights),
      rooms: 1, refundBy: null, totalCost: 0, costPerNight: 0, address: [stay.base, template.countries[0]].filter(Boolean).join(', '), notes: stay.area ? `Suggested location: ${stay.area}` : null, features,
      paid_by: [], traveler_ids: travelerIds, imageUrl: null,
    } as any);
    suggested.push({ type: 'lodging', id: String(lodging.id) });
  }
  for (const activity of template.activities) {
    const created: any = await insertActivity({
      userId, tripId, status: activity.book ? NEEDS_BOOKING : 'Proposed', activityType: (activity.type || 'Other') as any, date: dateOf(activity.day), name: activity.name,
      startLocation: activity.where, startTime: clock(activity.time), duration: activity.duration, cost: 0, freeCancelBy: null, bookedOn: '', reference: '',
      notes: [getTemplatePlace(activity.place)?.description, activity.notes, activity.book ? bookAheadNote(activity.book) : ''].filter(Boolean).join('\n'), paidBy: [], travelerIds,
    } as any);
    suggested.push({ type: 'activity', id: String(created.id) });
  }
  const passengerName = members.map((member) => member.name).join(', ') || 'Passenger';
  for (const leg of template.legs) {
    const departureDate = dateOf(leg.day);
    const departureTime = clock(leg.time);
    let arrivalDate = departureDate;
    let arrivalTime = '00:00';
    if (departureTime) {
      const arrival = new Date(`${departureDate}T${departureTime}:00Z`);
      arrival.setUTCMinutes(arrival.getUTCMinutes() + leg.minutes);
      arrivalDate = arrival.toISOString().slice(0, 10);
      arrivalTime = arrival.toISOString().slice(11, 16);
    }
    const flight: any = await insertFlight({
      userId, tripId, status: leg.book ? NEEDS_BOOKING : 'Proposed', transferType: leg.transferType as any, passengerName, passengerIds: travelerIds,
      departureDate, departureLocation: leg.from, departureTime: departureTime || '00:00', arrivalLocation: leg.to, arrivalDate, arrivalTime,
      cost: 0, carrier: leg.carrier, flightNumber: '', bookingReference: '', paidBy: [],
    } as any);
    suggested.push({ type: 'transfer', id: String(flight.id) });
  }
  // Against a placeholder start these dates are guesses: they move when real dates are set, unless saved first.
  if (estimated) await addTripEstimatedItems(tripId, suggested);

  // A transfer row has nowhere to keep tips, travel time or booking advice, so they become a note on that day.
  const itinerary = await createItineraryRecord(userId, tripId, trip?.destination?.trim() || template.cities.join(', ') || template.title, template.days, null);
  const perDay = new Map<number, number>();
  let notes = 0;
  for (const leg of template.legs) {
    const time = clock(leg.time);
    if (!(leg.notes || leg.book || !time)) continue;
    const parts = [`${leg.from} to ${leg.to}${leg.carrier ? ` by ${leg.carrier}` : ''}. Travel time about ${durationText(leg.minutes)}.`];
    if (leg.notes) parts.push(leg.notes);
    if (leg.book) parts.push(bookAheadNote(leg.book));
    if (!time) parts.push('Times depend on your flight; confirm after booking.');
    const position = (perDay.get(leg.day) ?? 0) + 1;
    perDay.set(leg.day, position);
    await addItineraryDetail(userId, itinerary.id, {
      day: leg.day + 1, time: time || null, activity: `Getting there: ${leg.from} to ${leg.to}`, cost: null, kind: 'note', noteBody: parts.join(' '), position, checklistItems: [],
    } as any);
    notes += 1;
  }
  return { lodgings: template.stays.length, activities: template.activities.length, transfers: template.legs.length, notes };
};

/**
 * A trip with a length but no dates cannot hold dated bookings, so the plan goes in as day-plan items
 * (Day 1, Day 2, ...): stays and transfers as notes, activities as day activities. Setting dates later
 * leaves them in place on the same days.
 */
export const populateUndatedTripFromTemplate = async (params: { userId: string; tripId: string; template: SeedTemplate; tripDays: number }): Promise<{ lodgings: number; activities: number; transfers: number; notes: number }> => {
  const { userId, tripId, template, tripDays } = params;
  const trip: any = await getTripById(tripId);
  const itinerary = await createItineraryRecord(userId, tripId, trip?.destination?.trim() || template.cities.join(', ') || template.title, Math.max(tripDays, template.days), null);
  const positions = new Map<number, number>();
  const next = (day: number) => { const position = (positions.get(day) ?? 0) + 1; positions.set(day, position); return position; };
  let notes = 0;
  const add = async (offset: number, input: { time: string; title: string; kind: 'note' | 'activity'; body: string }) => {
    await addItineraryDetail(userId, itinerary.id, {
      day: offset + 1, time: clock(input.time) || null, activity: input.title, cost: null, kind: input.kind, noteBody: input.body || null, position: next(offset + 1), checklistItems: [],
    } as any);
  };
  for (const stay of template.stays) {
    await add(stay.start, { time: '', kind: 'note', title: `Stay: ${stay.hotel}`, body: [`${stay.nights} night${stay.nights === 1 ? '' : 's'}.`, stay.area ? `Suggested location: ${stay.area}.` : '', 'Choose your hotel.'].filter(Boolean).join(' ') });
    notes += 1;
  }
  for (const activity of template.activities) {
    await add(activity.day, { time: activity.time, kind: 'activity', title: activity.name, body: [getTemplatePlace(activity.place)?.description ?? '', activity.duration ? `Duration: ${activity.duration}.` : '', activity.where ? `Address: ${activity.where}` : '', activity.notes, activity.book ? bookAheadNote(activity.book) : ''].filter(Boolean).join('\n') });
  }
  for (const leg of template.legs) {
    const parts = [`${leg.from} to ${leg.to}${leg.carrier ? ` by ${leg.carrier}` : ''}. Travel time about ${durationText(leg.minutes)}.`];
    if (leg.notes) parts.push(leg.notes);
    if (leg.book) parts.push(bookAheadNote(leg.book));
    await add(leg.day, { time: leg.time, kind: 'note', title: `Getting there: ${leg.from} to ${leg.to}`, body: parts.join(' ') });
    notes += 1;
  }
  return { lodgings: 0, activities: template.activities.length, transfers: 0, notes };
};

/** The card picture: the first picture of the template's hero destination, if the catalogue has one. */
export const templateHeroImage = (template: Pick<SeedTemplate, 'hero'>): PublicTemplateImage | null =>
  toPublicImage(getTemplateDestination(template.hero)?.images[0]);

/** The country and city descriptions and pictures that go with a template's preview. */
export const templateDestinations = (template: Pick<SeedTemplate, 'destinationKeys'>) =>
  template.destinationKeys.flatMap((key) => {
    const destination = getTemplateDestination(key);
    return destination ? [{ key, name: destination.name, description: destination.description, images: destination.images.map((image) => toPublicImage(image)!) }] : [];
  });
