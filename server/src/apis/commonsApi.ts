import axios from 'axios';
import { getBackendUrl } from '../env';
import { recordProviderRequestCost } from './providerBudgeting';
import { reserveApiUsageOrThrow } from './usageLimiter';

// Wikimedia Commons picture search for template stops. Only files whose own metadata declares public domain or CC0,
// with no usage restrictions, are returned (the same filter as tools/trip-templates/fetch_media.py).

const API = 'https://commons.wikimedia.org/w/api.php';
const CALLER = 'TEMPLATE_PICTURE_SEARCH';
const THUMB_WIDTH = 960;
const REVIEW_THUMB_WIDTH = 500; // a standard Wikimedia thumbnail size
const PER_QUERY = 8;
const MAX_CANDIDATES = PER_QUERY * 2;
const BAD_TITLE = /\b(map|logo|flag|diagram|plan|route|poster|stamp|coat of arms|emblem|icon|chart|schematic|svg|panorama)\b/i;
const GOOD_LICENSE = /^(public domain|cc0.*|pd($|[ -].*)|public domain mark.*)$/i;

export type CommonsCandidate = {
  title: string;
  url: string;
  width: number;
  height: number;
  pageUrl: string;
  license: string;
  author: string;
  description: string;
};

const userAgent = (): string => `WanderBunnies/1.0 (${getBackendUrl() ?? 'trip planner'}; template pictures from Wikimedia Commons)`;

const text = (value: unknown): string =>
  String(value ?? '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();

type CommonsPage = {
  index?: number;
  title: string;
  imageinfo?: Array<{
    mime?: string; width?: number; height?: number; url: string; thumburl?: string; thumbwidth?: number; thumbheight?: number; descriptionurl?: string;
    extmetadata?: Record<string, { value?: string }>;
  }>;
};

const searchOnce = async (query: string): Promise<CommonsCandidate[]> => {
  await reserveApiUsageOrThrow({ provider: 'WIKIMEDIA', caller: CALLER });
  await recordProviderRequestCost({ provider: 'WIKIMEDIA' });
  const response = await axios.get(API, {
    timeout: 20_000,
    headers: { 'User-Agent': userAgent() },
    params: {
      action: 'query', format: 'json', generator: 'search', gsrnamespace: '6', gsrlimit: '40', gsrsearch: `${query} filetype:bitmap`,
      prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: String(THUMB_WIDTH),
      iiextmetadatafilter: 'LicenseShortName|License|Artist|Credit|Restrictions|ImageDescription',
    },
  });
  const pages = (Object.values(response.data?.query?.pages ?? {}) as CommonsPage[]).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const found: CommonsCandidate[] = [];
  for (const page of pages) {
    const info = page.imageinfo?.[0];
    if (!info || !['image/jpeg', 'image/png'].includes(String(info.mime))) continue;
    const meta = info.extmetadata ?? {};
    const licenseName = text(meta.LicenseShortName?.value);
    const licenseKey = text(meta.License?.value);
    if (!(GOOD_LICENSE.test(licenseName) || GOOD_LICENSE.test(licenseKey))) continue;
    if (text(meta.Restrictions?.value)) continue;
    const width = info.width ?? 0;
    const height = info.height ?? 0;
    if (width < 1000 || width / Math.max(height, 1) < 1.2 || width / Math.max(height, 1) > 2.2) continue;
    if (BAD_TITLE.test(page.title)) continue;
    found.push({
      title: page.title,
      url: (info.thumburl || info.url).split('?')[0],
      width: info.thumbwidth || width,
      height: info.thumbheight || height,
      pageUrl: String(info.descriptionurl ?? '').split('?')[0],
      license: licenseName || licenseKey,
      author: text(meta.Artist?.value) || 'Unknown',
      description: text(meta.ImageDescription?.value).slice(0, 200),
    });
    if (found.length >= PER_QUERY) break;
  }
  return found;
};

/**
 * Candidates for a stop: the query as written, a shorter one, and each restricted to the CC0 and self-published
 * public-domain categories, because the strict license filter drops most results for a long query.
 */
export const searchCommonsPictures = async (query: string): Promise<CommonsCandidate[]> => {
  const short = query.split(/\s+/).slice(0, 2).join(' ');
  const variants = [...new Set([query, short, `${short} incategory:"CC-Zero"`, `${query} incategory:"CC-Zero"`, `${short} incategory:"PD-self"`])];
  const seen = new Set<string>();
  const out: CommonsCandidate[] = [];
  for (const variant of variants) {
    for (const candidate of await searchOnce(variant)) {
      if (seen.has(candidate.title)) continue;
      seen.add(candidate.title);
      out.push(candidate);
    }
  }
  return out.slice(0, MAX_CANDIDATES);
};

/** A small copy of a candidate, as base64, for the reviewer; null when it cannot be fetched. */
export const downloadCandidateThumbnail = async (candidate: CommonsCandidate): Promise<{ data: string; mediaType: string } | null> => {
  const url = candidate.url.replace(`/${THUMB_WIDTH}px-`, `/${REVIEW_THUMB_WIDTH}px-`);
  try {
    const response = await axios.get<ArrayBuffer>(url, { responseType: 'arraybuffer', timeout: 20_000, maxContentLength: 4 * 1024 * 1024, headers: { 'User-Agent': userAgent() } });
    const mediaType = String(response.headers['content-type'] ?? 'image/jpeg').split(';')[0].trim().toLowerCase();
    if (!['image/jpeg', 'image/png'].includes(mediaType)) return null;
    return { data: Buffer.from(response.data).toString('base64'), mediaType };
  } catch {
    return null;
  }
};
