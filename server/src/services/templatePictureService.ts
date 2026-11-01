import { getActivityImageCache, saveActivityImageCache, upsertTripTemplateImport } from '../db';
import { downloadCandidateThumbnail, searchCommonsPictures, type CommonsCandidate } from '../apis/commonsApi';
import { reviewPictures } from '../apis/pictureReviewApi';
import { ApiLimitExceededError } from '../apis/usageLimiter';
import { getEnvFlag, getEnvValue } from '../env';
import { logError, logInfo } from '../logger';
import { getTemplateDestination, getTemplatePlace, templateImageProblem, type TemplateImage } from './tripTemplateMedia';
import { refreshImportedTemplates } from './tripTemplateService';
import { syncTemplateImageMirror } from './templateImageMirrorService';

// Finds a public-domain or CC0 Wikimedia Commons picture for the stops and cities of an imported template bundle that
// have none. Candidates come from a Commons search; a vision model then looks at them and approves at most one, and
// only a high-confidence approval is kept. A missing picture is better than a wrong one, so when nothing is approved
// the stop stays without. Pictures chosen this way are tagged `selection: "ai"`. This mirrors
// tools/trip-templates/fetch_bundle_media.py, which does the same for the bundle files in the repository.

const REVIEW_CANDIDATES = 4;
const RECHECK_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

const GENERIC_WORDS = new Set([
  'with', 'from', 'near', 'around', 'tour', 'tours', 'walk', 'walking', 'visit', 'guided', 'trip', 'day', 'days', 'tasting', 'dinner', 'lunch',
  'breakfast', 'evening', 'morning', 'night', 'sunset', 'sunrise', 'views', 'view', 'best', 'local', 'town', 'city', 'national', 'and', 'the',
  'for', 'into', 'over', 'your', 'free', 'time', 'old', 'new', 'great', 'small',
]);
const BAD_TITLE_EXTRA = /\b(hospital|parliament|deputy|minister|portrait|logo|sign|bus station|interior|bottles?|menu|poster|screenshot|stork|cats?|dogs?|circuit|sidewalk|pavement|bread|cake|bakery|crane)\b/i;

const fold = (value: string): string => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export const distinctiveWords = (name: string, country: string): string[] => {
  const skip = new Set([...fold(country).split(' '), ...GENERIC_WORDS]);
  return [...new Set(fold(name).split(' '))].filter((word) => word.length >= 4 && !skip.has(word));
};

/** The share of the stop's distinctive words found in the picture's title, 0 unless at least half are. */
const matchScore = (candidate: CommonsCandidate, words: string[]): number => {
  if (!words.length || BAD_TITLE_EXTRA.test(candidate.title)) return 0;
  const title = ` ${fold(candidate.title)} `;
  const hits = words.filter((word) => title.includes(` ${word} `)).length;
  return hits >= Math.max(1, Math.ceil(words.length / 2)) ? hits / words.length : 0;
};

/** The title matches first, then other candidates in Commons order, so the reviewer has options even for a stop that names no single landmark. */
export const reviewPool = (candidates: CommonsCandidate[], words: string[]): CommonsCandidate[] => {
  const pool = candidates
    .map((candidate, index) => ({ candidate, index, score: matchScore(candidate, words) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.candidate)
    .slice(0, REVIEW_CANDIDATES);
  for (const candidate of candidates) {
    if (pool.length >= REVIEW_CANDIDATES) break;
    if (!pool.includes(candidate) && !BAD_TITLE_EXTRA.test(candidate.title)) pool.push(candidate);
  }
  return pool;
};

export type PictureStop = { name: string; description: string; country: string; isCountry: boolean };

/** A picture a reviewer approved with high confidence for this stop, or null. */
export const findTemplatePicture = async (stop: PictureStop): Promise<TemplateImage | null> => {
  const candidates = await searchCommonsPictures(stop.isCountry || !stop.country ? stop.name : `${stop.name} ${stop.country}`);
  const pool = reviewPool(candidates, distinctiveWords(stop.name, stop.isCountry ? '' : stop.country));
  const pictures: Array<{ candidate: CommonsCandidate; data: string; mediaType: string }> = [];
  for (const candidate of pool) {
    const thumbnail = await downloadCandidateThumbnail(candidate);
    if (thumbnail) pictures.push({ candidate, ...thumbnail });
  }
  if (!pictures.length) return null;
  const review = await reviewPictures(
    { name: stop.name, description: stop.description, country: stop.isCountry ? '' : stop.country },
    pictures.map(({ candidate, data, mediaType }) => ({ title: candidate.title, data, mediaType }))
  );
  if (!review.pick || review.confidence !== 'high') return null;
  const chosen = pictures[review.pick - 1].candidate;
  const image: TemplateImage = {
    url: chosen.url, width: chosen.width, height: chosen.height, title: chosen.title, pageUrl: chosen.pageUrl,
    license: chosen.license, author: chosen.author, selection: 'ai',
  };
  // Whatever the search returned, only a public-domain or CC0 Wikimedia file is ever kept.
  return templateImageProblem(image) ? null : image;
};

export type PictureTarget = { kind: 'place' | 'destination'; key: string };

const countryOf = (key: string): string => key.split('/')[0].replace(/-/g, ' ');
const checkedKey = (target: PictureTarget): string => `template-picture:${target.kind}:${target.key}`;

const lookupEnabled = (): boolean =>
  getEnvFlag('TEMPLATE_PICTURE_LOOKUP', { defaultValue: true }) &&
  Boolean(getEnvValue('ANTHROPIC_API_KEY')) &&
  (process.env.NODE_ENV !== 'test' || getEnvFlag('TEMPLATE_PICTURE_LOOKUP_IN_TESTS'));

/**
 * Looks for a picture for each target that still has none, and saves what the reviewer approves. A stop already
 * searched in the last 30 days is not searched again, so re-importing the same bundle costs nothing. Returns how many
 * pictures were added.
 */
export const fillMissingTemplatePictures = async (targets: PictureTarget[], importedBy: string | null): Promise<number> => {
  let added = 0;
  for (const target of targets) {
    try {
      const entry = target.kind === 'place' ? getTemplatePlace(target.key) : getTemplateDestination(target.key);
      if (!entry) continue;
      const hasPicture = target.kind === 'place' ? Boolean((entry as { image?: unknown }).image) : ((entry as { images: unknown[] }).images.length > 0);
      if (hasPicture) continue;
      const previous = (await getActivityImageCache([checkedKey(target)]))[checkedKey(target)];
      if (previous && Date.now() - previous.checkedAt.getTime() < RECHECK_AFTER_MS) continue;

      const image = await findTemplatePicture({ name: entry.name, description: entry.description, country: countryOf(target.key), isCountry: target.kind === 'destination' && !target.key.includes('/') });
      await saveActivityImageCache(checkedKey(target), image ? { url: image.url, credit: image.author, pageUrl: image.pageUrl } : null);
      if (!image) continue;

      // Read the entry again: an admin may have imported a newer version while the search ran.
      await refreshImportedTemplates(true);
      const latest = target.kind === 'place' ? getTemplatePlace(target.key) : getTemplateDestination(target.key);
      if (!latest) continue;
      if (target.kind === 'place') {
        if ((latest as { image?: unknown }).image) continue;
        await upsertTripTemplateImport({ kind: 'place', key: target.key, payload: { ...latest, image }, contentHash: '', importedBy });
      } else {
        if ((latest as { images: unknown[] }).images.length) continue;
        await upsertTripTemplateImport({ kind: 'destination', key: target.key, payload: { ...latest, images: [image] }, contentHash: '', importedBy });
      }
      added += 1;
    } catch (err) {
      logError(`[template-pictures] could not find a picture for ${target.kind} ${target.key}`, err);
      // The daily limit is reached: later stops would fail the same way, and tomorrow's import tries again.
      if (err instanceof ApiLimitExceededError) break;
    }
  }
  if (added > 0) {
    await refreshImportedTemplates(true);
    logInfo(`[template-pictures] added ${added} picture(s) to imported templates`);
    if (process.env.NODE_ENV !== 'test') void syncTemplateImageMirror().catch((err) => logError('[template-pictures] copying pictures failed', err));
  }
  return added;
};

let queue: Promise<unknown> = Promise.resolve();

/** Looks for pictures after an import, one import at a time, without making the import wait. */
export const queueTemplatePictureLookup = (targets: PictureTarget[], importedBy: string | null): Promise<number> => {
  if (!targets.length || !lookupEnabled()) return Promise.resolve(0);
  const run = queue.then(() => fillMissingTemplatePictures(targets, importedBy));
  queue = run.catch(() => undefined);
  return run.catch((err) => { logError('[template-pictures] lookup failed', err); return 0; });
};
