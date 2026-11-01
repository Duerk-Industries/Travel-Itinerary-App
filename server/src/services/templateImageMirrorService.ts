import axios from 'axios';
import { Storage } from '@google-cloud/storage';
import type { Readable } from 'node:stream';
import { getBackendUrl, getEnvFlag, getEnvValue } from '../env';
import { logError, logInfo } from '../logger';
import {
  addMirroredTemplateImage,
  allTemplateImages,
  isMirrorKey,
  setMirroredTemplateImages,
  templateImageKey,
  templateImageProblem,
  type TemplateImage,
} from './tripTemplateMedia';

// Template pictures are public domain or CC0 files on Wikimedia Commons. Rather than load each one from Wikimedia on
// every view, a copy is kept in our own storage and served from /api/template-images. Each copy carries its license,
// author and Commons page, and the credit still shows wherever the picture does. A picture is only copied after its
// host and license are checked again; Unsplash photos are never copied (their terms require loading from Unsplash).

const DEFAULT_BUCKET = 'duerk-travel-itinerary-app-location-data';
const PREFIX = 'template-images/';
const MAX_BYTES = 6 * 1024 * 1024;
const MAX_COPIES_PER_SWEEP = 100;
const PAUSE_BETWEEN_COPIES_MS = 500;
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;
const CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

let storage: Storage | null = null;
let disabledReason: string | null = null;

export const resetTemplateImageMirrorForTests = (): void => { storage = null; disabledReason = null; };

const bucket = () => {
  if (disabledReason) return null;
  storage ??= new Storage();
  return storage.bucket(getEnvValue('LOCATION_BUCKET') ?? DEFAULT_BUCKET);
};

const noteStorageProblem = (err: unknown): boolean => {
  if (!String(err instanceof Error ? err.message : err ?? '').includes('Could not load the default credentials')) return false;
  disabledReason = 'Google Cloud default credentials are unavailable in this environment';
  logInfo(`[template-images] copies disabled: ${disabledReason}`);
  return true;
};

const userAgent = (): string => `WanderBunnies/1.0 (${getBackendUrl() ?? 'trip planner'}; template pictures from Wikimedia Commons)`;

/** Copies one picture into storage; false when it was refused or could not be fetched. */
export const mirrorTemplateImage = async (image: TemplateImage): Promise<boolean> => {
  const problem = templateImageProblem(image);
  if (problem) {
    logError(`[template-images] not copying: ${problem}`);
    return false;
  }
  const target = bucket();
  if (!target) return false;
  const key = templateImageKey(image.url);
  try {
    const response = await axios.get<ArrayBuffer>(image.url, {
      responseType: 'arraybuffer', timeout: 20_000, maxContentLength: MAX_BYTES, headers: { 'User-Agent': userAgent() },
    });
    const contentType = String(response.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (!CONTENT_TYPES.has(contentType)) {
      logError(`[template-images] not copying ${image.url}: unsupported type "${contentType}"`);
      return false;
    }
    await target.file(`${PREFIX}${key}`).save(Buffer.from(response.data), {
      resumable: false,
      contentType,
      metadata: {
        cacheControl: 'public, max-age=31536000, immutable',
        metadata: { sourceUrl: image.url, pageUrl: image.pageUrl, license: image.license, author: image.author, title: image.title },
      },
    });
    addMirroredTemplateImage(key);
    return true;
  } catch (err) {
    if (!noteStorageProblem(err)) logError(`[template-images] could not copy ${image.url}`, err);
    return false;
  }
};

const copiedKeys = async (): Promise<Set<string> | null> => {
  const target = bucket();
  if (!target) return null;
  try {
    const [files] = await target.getFiles({ prefix: PREFIX });
    return new Set(files.map((file) => file.name.slice(PREFIX.length)).filter(isMirrorKey));
  } catch (err) {
    if (!noteStorageProblem(err)) logError('[template-images] could not list copied pictures', err);
    return null;
  }
};

/** Brings the copies up to date with the pictures the templates carry; returns how many were newly copied. */
export const syncTemplateImageMirror = async (options: { pauseMs?: number } = {}): Promise<number> => {
  const have = await copiedKeys();
  if (!have) return 0;
  setMirroredTemplateImages(have);
  const wanted = new Map<string, TemplateImage>();
  for (const image of allTemplateImages()) {
    const key = templateImageKey(image.url);
    if (!have.has(key) && !wanted.has(key)) wanted.set(key, image);
  }
  let copied = 0;
  for (const image of [...wanted.values()].slice(0, MAX_COPIES_PER_SWEEP)) {
    if (disabledReason) break;
    if (await mirrorTemplateImage(image)) copied += 1;
    // Wikimedia asks for a gentle pace.
    await new Promise((resolve) => setTimeout(resolve, options.pauseMs ?? PAUSE_BETWEEN_COPIES_MS));
  }
  if (copied > 0) logInfo(`[template-images] copied ${copied} template picture(s) to storage`);
  return copied;
};

/** Our copy of a picture, for serving; null when there is none. */
export const openTemplateImage = async (key: string): Promise<{ stream: Readable; contentType: string; size: number | null } | null> => {
  if (!isMirrorKey(key)) return null;
  const target = bucket();
  if (!target) return null;
  try {
    const file = target.file(`${PREFIX}${key}`);
    const [exists] = await file.exists();
    if (!exists) return null;
    const [metadata] = await file.getMetadata();
    const size = Number(metadata.size);
    return { stream: file.createReadStream(), contentType: String(metadata.contentType ?? 'image/jpeg'), size: Number.isFinite(size) ? size : null };
  } catch (err) {
    if (!noteStorageProblem(err)) logError(`[template-images] could not read ${key}`, err);
    return null;
  }
};

let handle: ReturnType<typeof setInterval> | null = null;

export const startTemplateImageMirror = (): boolean => {
  if (handle || process.env.NODE_ENV === 'test' || !getEnvFlag('TEMPLATE_IMAGE_MIRROR', { defaultValue: true })) return false;
  const run = () => syncTemplateImageMirror().catch((err) => logError('[template-images] sweep failed', err));
  void run();
  handle = setInterval(run, SWEEP_INTERVAL_MS);
  handle.unref();
  return true;
};
