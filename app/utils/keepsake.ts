import { keepsakeCss, keepsakeThemes as KEEPSAKE_THEMES } from '../theme/theme';

import type { KeepsakeMapCapture } from './keepsakeMapCapture';
// Printable trip keepsake: one themed HTML document used both for the browser print view (web)
// and for the PDF the phone app creates with expo-print. Pure functions, so they're testable.

export type KeepsakeThemeKey = 'classic' | 'linen' | 'coastal' | 'sunset' | 'midnight';

export type KeepsakeTheme = {
  key: KeepsakeThemeKey;
  name: string;
  description: string;
  page: string; // page background
  card: string; // day card background
  text: string;
  muted: string;
  accent: string;
  rule: string; // borders / dividers
};

export { keepsakeThemes as KEEPSAKE_THEMES } from '../theme/theme';


export const DEFAULT_KEEPSAKE_THEME: KeepsakeThemeKey = 'linen';

export const getKeepsakeTheme = (key?: string | null): KeepsakeTheme =>
  KEEPSAKE_THEMES.find((theme) => theme.key === key) ?? KEEPSAKE_THEMES.find((theme) => theme.key === DEFAULT_KEEPSAKE_THEME)!;

const decodeEntities = (value: string): string =>
  value.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

const escapeHtml = (value: unknown): string =>
  String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char] || char));

/** Plain text from a rich-text note body, one entry per paragraph (keeps the writer's breaks). */
export const paragraphsFromRichText = (html: unknown): string[] =>
  decodeEntities(
    String(html ?? '')
      .replace(/<\s*br\s*\/?>/gi, '\n')
      .replace(/<\/\s*(p|div|li|h[1-6])\s*>/gi, '\n')
      .replace(/<[^>]*>/g, ' ')
  )
    .split(/\n+/)
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean);

const parseLocalDate = (localDate: string): Date | null => {
  const [y, m, d] = String(localDate ?? '').slice(0, 10).split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d) : null;
};

/** "Saturday, August 15" — local date, no timezone shift. */
export const formatKeepsakeDay = (localDate: string): string => {
  const date = parseLocalDate(localDate);
  return date ? date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : localDate;
};

/** "Aug 15 – Aug 22, 2026", or a single date. */
export const formatKeepsakeRange = (dates: string[]): string => {
  const parsed = dates.map(parseLocalDate).filter((d): d is Date => Boolean(d)).sort((a, b) => a.getTime() - b.getTime());
  if (!parsed.length) return '';
  const first = parsed[0];
  const last = parsed[parsed.length - 1];
  const short = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (first.getTime() === last.getTime()) return `${short(first)}, ${first.getFullYear()}`;
  const sameYear = first.getFullYear() === last.getFullYear();
  return sameYear
    ? `${short(first)} – ${short(last)}, ${last.getFullYear()}`
    : `${short(first)}, ${first.getFullYear()} – ${short(last)}, ${last.getFullYear()}`;
};

type KeepsakePhoto = { url: string; alt: string; caption: string };

const photosForDay = (day: any): KeepsakePhoto[] =>
  (day?.items || [])
    .flatMap((item: any) => (item.kindKey === 'core.gallery' ? (item.assets || []) : item.kindKey?.startsWith('media.') ? [item] : []))
    .filter((item: any) => item.mediaKind === 'photo' && (item.primaryUrl || item.thumbnailUrl))
    .map((item: any) => ({
      url: String(item.primaryUrl || item.thumbnailUrl),
      alt: String(item.altText || item.caption || 'Trip photo'),
      caption: String(item.caption || ''),
    }));

const notesForDay = (day: any): string[] =>
  (day?.items || []).filter((item: any) => item.kindKey === 'core.text').flatMap((item: any) => paragraphsFromRichText(item.body));

/** The themed keepsake document. Days with nothing on them are left out. */
export const buildKeepsakeHtml = (blog: any, themeKey?: string | null, maps: Record<string, KeepsakeMapCapture> = {}): string => {
  const theme = getKeepsakeTheme(themeKey);
  const title = String(blog?.title || 'Trip keepsake');
  const days: any[] = Array.isArray(blog?.days) ? blog.days : [];
  const contentDays = days.filter((day) => maps[day.localDate] || day.headline || day.summary || notesForDay(day).length || photosForDay(day).length);
  const range = formatKeepsakeRange(days.map((day) => day.localDate));

  const sections = contentDays.map((day) => {
    const photos = photosForDay(day);
    const figures = photos.map((photo) => `<figure><img src="${escapeHtml(photo.url)}" alt="${escapeHtml(photo.alt)}">${photo.caption ? `<figcaption>${escapeHtml(photo.caption)}</figcaption>` : ''}</figure>`).join('');
    const map = maps[day.localDate]?.approximate ? maps[day.localDate] : undefined;
    const safeImage = map?.image && /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(map.image) && map.image.length <= 1_000_000 ? map.image : null;
    const mapHtml = map ? `<figure class="day-map">${safeImage ? `<img src="${safeImage}" alt="Approximate areas visited">` : '<p>Map image unavailable — areas are listed below.</p>'}<figcaption>Approximate areas; lodging locations omitted. © OpenFreeMap © OpenMapTiles © OpenStreetMap contributors</figcaption><ol>${map.labels.slice(0, 12).map(label => `<li>${escapeHtml(label)}</li>`).join('')}</ol></figure>` : '';
    return `<section class="day">
  <p class="day-date">${escapeHtml(formatKeepsakeDay(day.localDate))}</p>
  ${day.headline ? `<h2>${escapeHtml(day.headline)}</h2>` : ''}
  ${day.summary ? `<p class="summary">${escapeHtml(day.summary)}</p>` : ''}
  ${notesForDay(day).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('')}
  ${mapHtml}
  ${figures ? `<div class="photos${photos.length === 1 ? ' single' : ''}">${figures}</div>` : ''}
</section>`;
  }).join('\n');

  const intro = paragraphsFromRichText(blog?.introduction).map((p) => `<p class="intro">${escapeHtml(p)}</p>`).join('');

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,600;1,9..144,400&display=swap" rel="stylesheet">
<style>${keepsakeCss(theme)}</style></head>
<body><div class="wrap">
<header>
  <p class="eyebrow">Trip keepsake</p>
  <h1>${escapeHtml(title)}</h1>
  ${blog?.subtitle ? `<p class="subtitle">${escapeHtml(blog.subtitle)}</p>` : ''}
  ${range ? `<p class="range">${escapeHtml(range)}</p>` : ''}
</header>
${intro}
${sections || '<p class="summary">Nothing has been written for this trip yet.</p>'}
<footer>Made with WanderBunnies</footer>
</div></body></html>`;
};
