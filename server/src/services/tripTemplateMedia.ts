import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { getBackendUrl } from '../env';
import { logError } from '../logger';
import { resolveRuntimeDataPath } from '../utils/runtimeDataPath';
import { INTEREST_KEYS, type MobilityCode, type PaceCode } from './itineraryPreferenceContract';

// The pictures and descriptions that template stops and destinations share. A stop that appears in
// six templates is described and pictured once here, and each template refers to it by place key.
// Files: server/data/trip-templates/media/<pack>.json, written by tools/trip-templates/fetch_media.py.
// A picture is a thumbnail URL plus its credit (the file's own public-domain or CC0 declaration on
// Wikimedia Commons); no image bytes ship with the app.

export const templateImageSchema = z.object({
  url: z.string().url(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  title: z.string(),
  pageUrl: z.string().url(),
  license: z.string(),
  author: z.string().default('Unknown'),
  /** Who chose the picture: a person reviewing the candidates ('curated') or the AI review pass ('ai'). Internal. */
  selection: z.enum(['curated', 'ai']).optional(),
});

// Characteristics for internal use (matching templates and stops to a traveler's preferences). They use the vocabulary of
// the AI itinerary generator (itineraryPreferenceContract.ts) and are never shown to travelers: no traveler-facing payload
// or trip data includes them. A test guards that.
export const TEMPLATE_PACES = ['R', 'B', 'F'] as const satisfies readonly PaceCode[];
export const TEMPLATE_MOBILITIES = ['L', 'M', 'H'] as const satisfies readonly MobilityCode[];
export const TEMPLATE_INTERESTS = INTEREST_KEYS as unknown as [string, ...string[]];
export const templatePaceSchema = z.enum(TEMPLATE_PACES);
export const templateMobilitySchema = z.enum(TEMPLATE_MOBILITIES);
export const templateInterestsSchema = z.array(z.enum(TEMPLATE_INTERESTS));

/** The longest paragraph a place may carry; the one-sentence description has its own, shorter limit. */
export const MAX_PLACE_DETAILS = 1200;

export const templatePlaceSchema = z.object({
  name: z.string(),
  /** One sentence, shown where a stop is offered: suggestions, the "Add activity" menu and the template preview. */
  description: z.string().default(''),
  /** A paragraph, written into the activity's notes once it is added to a trip (and so shown in the trip export). Optional. */
  details: z.string().default(''),
  /** What kind of traveler the stop suits, from the generator's interest vocabulary. Internal. */
  interests: templateInterestsSchema.default([]),
  /** The mobility a traveler needs for the stop, on the generator's Low / Medium / High scale. Internal. */
  mobility: templateMobilitySchema.optional(),
  image: templateImageSchema.nullable().default(null),
});
export const templateDestinationSchema = z.object({ name: z.string(), description: z.string().default(''), images: z.array(templateImageSchema).default([]) });

const mediaFileSchema = z.object({
  schemaVersion: z.literal(1),
  places: z.record(z.string(), templatePlaceSchema).default({}),
  destinations: z.record(z.string(), templateDestinationSchema).default({}),
});

export type TemplateImage = z.infer<typeof templateImageSchema>;
export type TemplatePlace = z.infer<typeof templatePlaceSchema>;
export type TemplateDestination = { name: string; description: string; images: TemplateImage[] };

/** What the app shows with a picture: where it is, and who made it under what license. */
export type PublicTemplateImage = { url: string; width?: number; height?: number; credit: string; pageUrl: string };

/** The text for an activity once it is in a trip: the paragraph when the stop has one, else its sentence. */
export const placeNotesText = (place: Pick<TemplatePlace, 'description' | 'details'> | null | undefined): string =>
  place?.details?.trim() || place?.description?.trim() || '';

// The only pictures a template may carry: public domain or CC0 files hosted by Wikimedia. Imports are checked against
// this, and so is every picture before it is copied to our own storage.
export const COMMONS_HOSTS = new Set(['upload.wikimedia.org', 'thumb.wikimedia.org']);
export const OPEN_LICENSE = /public domain|\bpd\b|cc0|cc[- ]?zero/i;

/** Why a picture cannot be used, or null when it is a public-domain or CC0 Wikimedia upload. */
export const templateImageProblem = (image: { url: string; license: string } | null | undefined): string | null => {
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

// Pictures copied to our own storage (see templateImageMirrorService.ts), by key. A picture whose copy exists is served
// from our domain; any other keeps pointing at Wikimedia.
export const TEMPLATE_IMAGE_PATH = '/api/template-images';
const MIRROR_KEY = /^[a-f0-9]{40}\.(jpg|png|gif|webp)$/;
export const isMirrorKey = (key: string): boolean => MIRROR_KEY.test(key);

/** Where our copy of a picture lives: a hash of its Wikimedia address plus its file type. */
export const templateImageKey = (url: string): string => {
  let extension = 'jpg';
  try {
    const found = new URL(url).pathname.toLowerCase().match(/\.(jpe?g|png|gif|webp)$/)?.[1];
    if (found) extension = found === 'jpeg' ? 'jpg' : found;
  } catch { /* keeps jpg */ }
  return `${createHash('sha1').update(url).digest('hex')}.${extension}`;
};

let mirroredKeys = new Set<string>();
export const setMirroredTemplateImages = (keys: Iterable<string>): void => { mirroredKeys = new Set(keys); };
export const addMirroredTemplateImage = (key: string): void => { mirroredKeys.add(key); };

const servedUrl = (url: string): string => {
  const base = getBackendUrl();
  const key = templateImageKey(url);
  return base && mirroredKeys.has(key) ? `${base.replace(/\/+$/, '')}${TEMPLATE_IMAGE_PATH}/${key}` : url;
};

export const toPublicImage = (image: TemplateImage | null | undefined): PublicTemplateImage | null =>
  image ? { url: servedUrl(image.url), width: image.width, height: image.height, credit: `${image.author}, ${image.license}`, pageUrl: image.pageUrl } : null;

let cache: { places: Map<string, TemplatePlace>; destinations: Map<string, TemplateDestination> } | null = null;

export const clearTripTemplateMediaCacheForTests = (): void => { cache = null; importedPlaces = new Map(); importedDestinations = new Map(); };

const loadMedia = () => {
  if (cache) return cache;
  const dir = path.join(resolveRuntimeDataPath('trip-templates', process.env.TRIP_TEMPLATES_DIR), 'media');
  const places = new Map<string, TemplatePlace>();
  const destinations = new Map<string, TemplateDestination>();
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.endsWith('.json')).sort() : [];
  for (const name of files) {
    try {
      const parsed = mediaFileSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')));
      Object.entries(parsed.places).forEach(([key, value]) => places.set(key, value));
      Object.entries(parsed.destinations).forEach(([key, value]) => destinations.set(key, value));
    } catch (err) {
      // A bad media file costs the pictures, never the templates.
      logError(`[trip-templates] ignoring invalid media file ${name}`, err);
    }
  }
  cache = { places, destinations };
  return cache;
};

// Entries an admin imported (see tripTemplateBundle.ts). They win over the catalogue files, key by key.
let importedPlaces = new Map<string, TemplatePlace>();
let importedDestinations = new Map<string, TemplateDestination>();

export const setImportedTemplateMedia = (places: Map<string, TemplatePlace>, destinations: Map<string, TemplateDestination>): void => {
  importedPlaces = places;
  importedDestinations = destinations;
};

export const getTemplatePlace = (key: string | undefined | null): TemplatePlace | null => (key ? importedPlaces.get(key) ?? loadMedia().places.get(key) ?? null : null);
export const getTemplateDestination = (key: string | undefined | null): TemplateDestination | null => (key ? importedDestinations.get(key) ?? loadMedia().destinations.get(key) ?? null : null);

/** Every picture the templates carry, from the catalogue files and from admin imports. */
export const allTemplateImages = (): TemplateImage[] => {
  const places = new Map([...loadMedia().places, ...importedPlaces]);
  const destinations = new Map([...loadMedia().destinations, ...importedDestinations]);
  const images = [...places.values()].map((place) => place.image).filter((image): image is TemplateImage => Boolean(image));
  destinations.forEach((destination) => images.push(...destination.images));
  return images;
};
