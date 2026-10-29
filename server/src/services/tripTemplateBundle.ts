import { z } from 'zod';
import { deleteTripTemplateImport, listTripTemplates, upsertTripTemplateImport } from '../db';
import { logInfo } from '../logger';
import {
  MAX_PLACE_DETAILS,
  TEMPLATE_INTERESTS,
  getTemplateDestination,
  getTemplatePlace,
  templateDestinationSchema,
  templatePlaceSchema,
  type TemplateDestination,
  type TemplatePlace,
} from './tripTemplateMedia';
import {
  hashTemplatePlan,
  loadSeedTemplates,
  refreshImportedTemplates,
  syncTripTemplatesFromSeed,
  templatePlanSchema,
  templateSource,
  type TemplatePlan,
  type TemplateSource,
} from './tripTemplateService';

// A bundle is the unit of exchange for itinerary templates: an LLM (or a person) writes one outside the
// app following server/data/trip-template-authoring/INSTRUCTIONS.md, an admin imports it, and the app
// exports the live templates in the same shape to edit and re-import. Each template inside is exactly a
// seed file (server/data/trip-templates/*.json), so a bundle can also be unpacked into the repo.

export const BUNDLE_FORMAT = 'wanderbunnies.trip-templates';
export const BUNDLE_VERSION = 1;
const MAX_TEMPLATES_PER_BUNDLE = 50;

/** Kept in step with the ActivityType union in types.ts (a test checks they match). */
export const TEMPLATE_ACTIVITY_TYPES = [
  'Class', 'Concert/Show', 'Day Trip', 'Event', 'Food & Drink', 'Fun & Games', 'Hike', 'Nightlife', 'Other', 'Open Access',
  'Outdoor Activity', 'Reservation', 'Shopping', 'Sights & Landmarks', 'Spa/Wellness', 'Ticketed Attraction', 'Tour',
] as const;
/** Ground transfers only: flights are booked by the traveler, not suggested by a template. */
export const TEMPLATE_TRANSFER_TYPES = ['Public Transit', 'Private Transfer', 'Other'] as const;

const mediaSchema = z.object({
  places: z.record(z.string(), templatePlaceSchema).default({}),
  destinations: z.record(z.string(), templateDestinationSchema).default({}),
});

export const bundleSchema = z.object({
  format: z.literal(BUNDLE_FORMAT),
  version: z.literal(BUNDLE_VERSION),
  /** When the bundle was made, and by whom or what (for the admin's own records). */
  exportedAt: z.string().optional(),
  generator: z.string().max(200).optional(),
  templates: z.array(templatePlanSchema).max(MAX_TEMPLATES_PER_BUNDLE).default([]),
  media: mediaSchema.default({ places: {}, destinations: {} }),
});
export type TemplateBundle = z.infer<typeof bundleSchema>;

/** The bundle format as JSON Schema, for tools and LLMs that can use one. */
export const bundleJsonSchema = (): unknown => z.toJSONSchema(bundleSchema);

// ------------------------------------------------------------------------ checks beyond the shape

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DESTINATION_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)?$/;
const CLOCK = /^([01]?\d|2[0-3]):[0-5]\d$/;
const COMMONS_HOSTS = new Set(['upload.wikimedia.org', 'thumb.wikimedia.org']);
const OPEN_LICENSE = /public domain|\bpd\b|cc0|cc[- ]?zero/i;

export type TemplateIssues = { errors: string[]; warnings: string[] };

const formatZodIssues = (error: z.ZodError): string[] =>
  error.issues.map((issue) => `${issue.path.length ? issue.path.join('.') : '(template)'}: ${issue.message}`);

/** Whether a place or destination key has an entry, in this bundle or already in the app. */
type MediaLookup = { place: (key: string) => boolean; destination: (key: string) => boolean; placeEntry?: (key: string) => TemplatePlace | null };

export const checkTemplate = (plan: TemplatePlan, media: MediaLookup): TemplateIssues => {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!SLUG.test(plan.id)) errors.push(`id "${plan.id}" must be lowercase letters, digits and hyphens, like "portugal-lisbon-porto-7d".`);

  // The stays tile the trip: day 0 is arrival, the last night is the one before the final day.
  let expectedStart = 0;
  plan.stays.forEach((stay, index) => {
    if (stay.start !== expectedStart) errors.push(`stays.${index}.start: is ${stay.start} but the previous stay ends on day ${expectedStart}; stays must follow each other with no gaps or overlaps.`);
    expectedStart = stay.start + stay.nights;
  });
  if (!plan.stays.length) errors.push('stays: at least one stay is required.');
  else if (expectedStart !== plan.days - 1) errors.push(`stays: nights add up to ${expectedStart} but a ${plan.days}-day trip has ${plan.days - 1} nights (the last day is the departure day).`);

  plan.activities.forEach((activity, index) => {
    const at = `activities.${index}`;
    if (activity.day > plan.days - 1) errors.push(`${at}.day: ${activity.day} is after the last day (${plan.days - 1}). Days are numbered from 0 for the arrival day.`);
    if (!(TEMPLATE_ACTIVITY_TYPES as readonly string[]).includes(activity.type)) errors.push(`${at}.type: "${activity.type}" is not one of ${TEMPLATE_ACTIVITY_TYPES.join(', ')}.`);
    if (activity.time && !CLOCK.test(activity.time)) errors.push(`${at}.time: "${activity.time}" must be 24-hour HH:MM or empty.`);
    if (activity.book && !/^yes\b/i.test(activity.book)) warnings.push(`${at}.book: "${activity.book}" should be empty or start with "Yes - " followed by the reason to book ahead.`);
    if (activity.place) {
      if (!KEY.test(activity.place)) errors.push(`${at}.place: "${activity.place}" must look like "portugal/belem-tower" (country, a slash, the place).`);
      else if (!media.place(activity.place)) warnings.push(`${at}.place: no description or picture entry for "${activity.place}"; add it under media.places.`);
    } else warnings.push(`${at}.place: empty, so "${activity.name}" will have no shared description or picture.`);
  });
  // The internal tags and the paragraph are optional, so a gap is one summary line rather than a line per stop.
  if (!plan.regions?.length) warnings.push('regions: not set; list the states, provinces or nations the trip is mostly in (California, Scotland), so travelers who pick one are offered this template.');
  if (!plan.pace) warnings.push('pace: not set; it is an optional internal tag, R (relaxed), B (balanced) or F (fast).');
  if (!plan.interests?.length) warnings.push(`interests: not set; it is an optional internal tag, any of ${TEMPLATE_INTERESTS.join(', ')}.`);
  if (media.placeEntry) {
    const entries = [...new Set(plan.activities.map((activity) => activity.place).filter(Boolean))].flatMap((key) => {
      const entry = media.placeEntry!(key);
      return entry ? [{ key, entry }] : [];
    });
    const withoutDetails = entries.filter(({ entry }) => !entry.details.trim()).length;
    const withoutInterests = entries.filter(({ entry }) => !entry.interests.length).length;
    if (withoutDetails) warnings.push(`media.places: ${withoutDetails} of ${entries.length} places have no "details" paragraph yet, so travelers get the one-sentence description in their notes.`);
    if (withoutInterests) warnings.push(`media.places: ${withoutInterests} of ${entries.length} places have no "interests" yet.`);
  }
  const perDay = new Map<number, number>();
  plan.activities.forEach((activity) => perDay.set(activity.day, (perDay.get(activity.day) ?? 0) + 1));
  perDay.forEach((count, day) => { if (count > 6) warnings.push(`Day ${day} has ${count} activities; more than 6 is rarely realistic.`); });

  plan.legs.forEach((leg, index) => {
    const at = `legs.${index}`;
    if (leg.day > plan.days - 1) errors.push(`${at}.day: ${leg.day} is after the last day (${plan.days - 1}).`);
    if (!(TEMPLATE_TRANSFER_TYPES as readonly string[]).includes(leg.transferType)) errors.push(`${at}.transferType: "${leg.transferType}" must be one of ${TEMPLATE_TRANSFER_TYPES.join(', ')}.`);
    if (leg.time && !CLOCK.test(leg.time)) errors.push(`${at}.time: "${leg.time}" must be 24-hour HH:MM or empty.`);
    if (leg.minutes > 24 * 60) errors.push(`${at}.minutes: ${leg.minutes} is more than a day; use the door-to-door minutes for this one transfer.`);
    if (leg.book && !/^yes\b/i.test(leg.book)) warnings.push(`${at}.book: "${leg.book}" should be empty or start with "Yes - " followed by the reason to book ahead.`);
  });

  plan.destinationKeys.forEach((key) => {
    if (!DESTINATION_KEY.test(key)) errors.push(`destinationKeys: "${key}" must look like "portugal" or "portugal/lisbon".`);
    else if (!media.destination(key)) warnings.push(`destinationKeys: no description or pictures for "${key}"; add it under media.destinations.`);
  });
  if (plan.hero && !plan.destinationKeys.includes(plan.hero)) warnings.push(`hero: "${plan.hero}" is not in destinationKeys, so the card will have no picture from it.`);
  if (!plan.hero) warnings.push('hero: empty, so the card falls back to an image search on imageQuery.');
  const bases = new Set(plan.stays.map((stay) => stay.base));
  bases.forEach((base) => { if (!plan.cities.includes(base)) warnings.push(`cities: does not list "${base}", where the traveler stays.`); });
  if (plan.highlights.length < 3 || plan.highlights.length > 6) warnings.push(`highlights: has ${plan.highlights.length}; 3 to 6 reads best on the card.`);
  if (!plan.summary.trim()) warnings.push('summary: empty.');
  if (!plan.imageQuery.trim()) warnings.push('imageQuery: empty, so there is no fallback picture search.');
  return { errors, warnings };
};

/** A shared place or destination entry is accepted only with a public-domain or CC0 picture hosted by Wikimedia. */
const checkImage = (image: { url: string; license: string } | null | undefined): string | null => {
  if (!image) return null;
  let host = '';
  try {
    const parsed = new URL(image.url);
    host = parsed.protocol === 'https:' ? parsed.hostname : '';
  } catch { /* falls through to the error */ }
  if (!COMMONS_HOSTS.has(host)) return `picture ${image.url} must be an https upload.wikimedia.org or thumb.wikimedia.org address.`;
  if (!OPEN_LICENSE.test(image.license)) return `picture license "${image.license}" is not public domain or CC0, the only licenses accepted.`;
  return null;
};

// ------------------------------------------------------------------------ reading a bundle

export type TemplateImportStatus = 'new' | 'updated' | 'unchanged' | 'invalid';
export type MediaCounts = { added: number; updated: number; unchanged: number; rejected: Array<{ key: string; error: string }> };
export type ImportReport = {
  /** True when the bundle can be applied: it parsed and every template and media entry is acceptable. */
  ok: boolean;
  /** Set when the bundle could not be read at all, with what to fix. */
  fatal?: string[];
  applied: boolean;
  templates: Array<{ id: string; title: string; status: TemplateImportStatus; source?: TemplateSource; errors: string[]; warnings: string[] }>;
  media: { places: MediaCounts; destinations: MediaCounts };
};

type PreparedBundle = {
  report: ImportReport;
  templates: Array<{ plan: TemplatePlan; status: TemplateImportStatus }>;
  places: Array<{ key: string; entry: TemplatePlace; status: 'added' | 'updated' }>;
  destinations: Array<{ key: string; entry: TemplateDestination; status: 'added' | 'updated' }>;
};

const emptyCounts = (): MediaCounts => ({ added: 0, updated: 0, unchanged: 0, rejected: [] });
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const withoutHash = ({ contentHash: _hash, ...plan }: TemplatePlan & { contentHash?: string }): TemplatePlan => plan as TemplatePlan;

/** Reads and checks a bundle without changing anything. */
export const prepareBundle = (input: unknown): PreparedBundle => {
  const fail = (...messages: string[]): PreparedBundle => ({
    report: { ok: false, fatal: messages, applied: false, templates: [], media: { places: emptyCounts(), destinations: emptyCounts() } },
    templates: [], places: [], destinations: [],
  });
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('The file must be a JSON object with "format", "version" and "templates".');
  const envelope = input as Record<string, unknown>;
  if (envelope.format !== BUNDLE_FORMAT) return fail(`"format" must be "${BUNDLE_FORMAT}".`);
  if (envelope.version !== BUNDLE_VERSION) return fail(`"version" must be ${BUNDLE_VERSION}.`);
  if (!Array.isArray(envelope.templates ?? [])) return fail('"templates" must be an array.');
  const rawTemplates = (envelope.templates ?? []) as unknown[];
  if (rawTemplates.length > MAX_TEMPLATES_PER_BUNDLE) return fail(`A bundle may hold at most ${MAX_TEMPLATES_PER_BUNDLE} templates; split it.`);
  const rawMedia = (envelope.media ?? {}) as Record<string, unknown>;

  const places: PreparedBundle['places'] = [];
  const destinations: PreparedBundle['destinations'] = [];
  const counts = { places: emptyCounts(), destinations: emptyCounts() };
  const acceptedPlaces = new Map<string, TemplatePlace>();
  const acceptedDestinations = new Map<string, TemplateDestination>();

  const readMedia = <T extends { name: string; description: string; details?: string }>(
    kind: 'places' | 'destinations', schema: z.ZodType<T>, keyPattern: RegExp, images: (entry: T) => Array<{ url: string; license: string } | null>,
    accepted: Map<string, T>, current: (key: string) => T | null, out: Array<{ key: string; entry: T; status: 'added' | 'updated' }>,
  ) => {
    const entries = rawMedia[kind];
    if (entries === undefined) return;
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) { counts[kind].rejected.push({ key: kind, error: `media.${kind} must be an object keyed by ${kind === 'places' ? 'place' : 'destination'} key.` }); return; }
    for (const [key, value] of Object.entries(entries as Record<string, unknown>)) {
      if (!keyPattern.test(key)) { counts[kind].rejected.push({ key, error: `key must look like ${kind === 'places' ? '"portugal/belem-tower"' : '"portugal" or "portugal/lisbon"'}.` }); continue; }
      const parsed = schema.safeParse(value);
      if (!parsed.success) { counts[kind].rejected.push({ key, error: formatZodIssues(parsed.error).join('; ') }); continue; }
      const imageError = images(parsed.data).map(checkImage).find(Boolean);
      if (imageError) { counts[kind].rejected.push({ key, error: imageError }); continue; }
      if (parsed.data.description.length > 600) { counts[kind].rejected.push({ key, error: 'description is longer than 600 characters; keep it to one sentence.' }); continue; }
      if ((parsed.data.details ?? '').length > MAX_PLACE_DETAILS) { counts[kind].rejected.push({ key, error: `details is longer than ${MAX_PLACE_DETAILS} characters; keep it to one short paragraph.` }); continue; }
      if (parsed.data.details?.trim() && !parsed.data.description.trim()) { counts[kind].rejected.push({ key, error: 'details needs the one-sentence description as well; travelers see that sentence before the stop is added.' }); continue; }
      accepted.set(key, parsed.data);
      const existing = current(key);
      if (existing && same(existing, parsed.data)) counts[kind].unchanged += 1;
      else { counts[kind][existing ? 'updated' : 'added'] += 1; out.push({ key, entry: parsed.data, status: existing ? 'updated' : 'added' }); }
    }
  };
  readMedia('places', templatePlaceSchema, KEY, (entry) => [entry.image], acceptedPlaces, getTemplatePlace, places);
  readMedia('destinations', templateDestinationSchema, DESTINATION_KEY, (entry) => entry.images, acceptedDestinations, getTemplateDestination, destinations);

  const lookup: MediaLookup = {
    place: (key) => acceptedPlaces.has(key) || Boolean(getTemplatePlace(key)),
    placeEntry: (key) => acceptedPlaces.get(key) ?? getTemplatePlace(key),
    destination: (key) => acceptedDestinations.has(key) || Boolean(getTemplateDestination(key)),
  };
  const current = new Map(loadSeedTemplates().map((template) => [template.id, withoutHash(template)] as const));
  const seen = new Set<string>();
  const templates: PreparedBundle['templates'] = [];
  const reportTemplates: ImportReport['templates'] = [];
  rawTemplates.forEach((raw, index) => {
    const parsed = templatePlanSchema.safeParse(raw);
    if (!parsed.success) {
      const id = typeof (raw as any)?.id === 'string' ? (raw as any).id : `(template ${index + 1})`;
      reportTemplates.push({ id, title: String((raw as any)?.title ?? ''), status: 'invalid', errors: formatZodIssues(parsed.error), warnings: [] });
      return;
    }
    const plan = parsed.data;
    const { errors, warnings } = checkTemplate(plan, lookup);
    if (seen.has(plan.id)) errors.push(`id "${plan.id}" appears more than once in this bundle.`);
    seen.add(plan.id);
    const existing = current.get(plan.id);
    const status: TemplateImportStatus = errors.length ? 'invalid' : !existing ? 'new' : same(existing, plan) ? 'unchanged' : 'updated';
    reportTemplates.push({ id: plan.id, title: plan.title, status, source: existing ? templateSource(plan.id) : undefined, errors, warnings });
    if (!errors.length) templates.push({ plan, status });
  });

  const rejected = counts.places.rejected.length + counts.destinations.rejected.length;
  const ok = !reportTemplates.some((template) => template.status === 'invalid') && rejected === 0 && (rawTemplates.length > 0 || places.length > 0 || destinations.length > 0 || counts.places.unchanged + counts.destinations.unchanged > 0);
  return { report: { ok, applied: false, templates: reportTemplates, media: counts }, templates, places, destinations };
};

/**
 * Validates a bundle and, unless `dryRun`, saves it. Nothing is saved unless the whole bundle is acceptable, so a
 * half-correct file never leaves the app half-updated; the report says what to fix.
 */
export const importBundle = async (input: unknown, options: { dryRun: boolean; importedBy: string | null }): Promise<ImportReport> => {
  await refreshImportedTemplates(true);
  const prepared = prepareBundle(input);
  if (!prepared.report.ok || options.dryRun) return prepared.report;

  for (const { plan, status } of prepared.templates) {
    if (status === 'unchanged') continue;
    await upsertTripTemplateImport({ kind: 'template', key: plan.id, payload: plan, contentHash: hashTemplatePlan(plan), importedBy: options.importedBy });
  }
  for (const { key, entry } of prepared.places) await upsertTripTemplateImport({ kind: 'place', key, payload: entry, contentHash: '', importedBy: options.importedBy });
  for (const { key, entry } of prepared.destinations) await upsertTripTemplateImport({ kind: 'destination', key, payload: entry, contentHash: '', importedBy: options.importedBy });
  await refreshImportedTemplates(true);
  await syncTripTemplatesFromSeed();
  logInfo(`[trip-templates] imported ${prepared.templates.filter((t) => t.status !== 'unchanged').length} template(s), ${prepared.places.length} place(s), ${prepared.destinations.length} destination(s)`);
  return { ...prepared.report, applied: true };
};

/** Drops an imported template, so a bundled one with the same id shows again, or it disappears if it was new. */
export const removeImportedTemplate = async (id: string): Promise<boolean> => {
  const removed = await deleteTripTemplateImport('template', id);
  if (removed) {
    await refreshImportedTemplates(true);
    await syncTripTemplatesFromSeed();
  }
  return removed;
};

// ------------------------------------------------------------------------ writing a bundle

/** The live templates (bundled and imported) with the shared entries they use, in bundle form. */
export const buildTemplateBundle = (ids?: string[]): TemplateBundle => {
  const wanted = ids?.length ? new Set(ids) : null;
  const templates = loadSeedTemplates().filter((template) => !wanted || wanted.has(template.id)).map(withoutHash);
  const places: Record<string, TemplatePlace> = {};
  const destinations: Record<string, TemplateDestination> = {};
  for (const template of templates) {
    for (const activity of template.activities) {
      const place = getTemplatePlace(activity.place);
      if (activity.place && place) places[activity.place] = place;
    }
    for (const key of new Set([...template.destinationKeys, template.hero].filter(Boolean))) {
      const destination = getTemplateDestination(key);
      if (destination) destinations[key] = destination;
    }
  }
  return {
    format: BUNDLE_FORMAT, version: BUNDLE_VERSION, exportedAt: new Date().toISOString(), generator: 'WanderBunnies export',
    templates, media: { places, destinations },
  };
};

export type AdminTemplateRow = {
  id: string; title: string; days: number; route: string; countries: string[]; source: TemplateSource; enabled: boolean;
  activityCount: number; contentHash: string;
};

export const listTemplatesForAdmin = async (): Promise<AdminTemplateRow[]> => {
  await refreshImportedTemplates();
  const enabled = new Map((await listTripTemplates()).map((row) => [row.id, row.enabled] as const));
  return loadSeedTemplates().map((template) => ({
    id: template.id, title: template.title, days: template.days, route: template.route, countries: template.countries,
    source: templateSource(template.id), enabled: enabled.get(template.id) ?? true, activityCount: template.activities.length, contentHash: template.contentHash,
  }));
};
