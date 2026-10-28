import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { logError } from '../logger';
import { resolveRuntimeDataPath } from '../utils/runtimeDataPath';

// The pictures and descriptions that template stops and destinations share. A stop that appears in
// six templates is described and pictured once here, and each template refers to it by place key.
// Files: server/data/trip-templates/media/<pack>.json, written by tools/trip-templates/fetch_media.py.
// A picture is a thumbnail URL plus its credit (the file's own public-domain or CC0 declaration on
// Wikimedia Commons); no image bytes ship with the app.

const imageSchema = z.object({
  url: z.string().url(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  title: z.string(),
  pageUrl: z.string().url(),
  license: z.string(),
  author: z.string().default('Unknown'),
});

const mediaFileSchema = z.object({
  schemaVersion: z.literal(1),
  places: z.record(z.string(), z.object({ name: z.string(), description: z.string().default(''), image: imageSchema.nullable().default(null) })).default({}),
  destinations: z.record(z.string(), z.object({ name: z.string(), description: z.string().default(''), images: z.array(imageSchema).default([]) })).default({}),
});

export type TemplateImage = z.infer<typeof imageSchema>;
export type TemplatePlace = { name: string; description: string; image: TemplateImage | null };
export type TemplateDestination = { name: string; description: string; images: TemplateImage[] };

/** What the app shows with a picture: where it is, and who made it under what license. */
export type PublicTemplateImage = { url: string; width: number; height: number; credit: string; pageUrl: string };

export const toPublicImage = (image: TemplateImage | null | undefined): PublicTemplateImage | null =>
  image ? { url: image.url, width: image.width, height: image.height, credit: `${image.author}, ${image.license}`, pageUrl: image.pageUrl } : null;

let cache: { places: Map<string, TemplatePlace>; destinations: Map<string, TemplateDestination> } | null = null;

export const clearTripTemplateMediaCacheForTests = (): void => { cache = null; };

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

export const getTemplatePlace = (key: string | undefined | null): TemplatePlace | null => (key ? loadMedia().places.get(key) ?? null : null);
export const getTemplateDestination = (key: string | undefined | null): TemplateDestination | null => (key ? loadMedia().destinations.get(key) ?? null : null);
