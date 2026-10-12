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

export const KEEPSAKE_THEMES: KeepsakeTheme[] = [
  { key: 'classic', name: 'Classic', description: 'Crisp white with navy headings', page: '#FFFFFF', card: '#FFFFFF', text: '#1F2937', muted: '#6B7280', accent: '#152944', rule: '#E5E7EB' },
  { key: 'linen', name: 'Linen', description: 'Warm paper tones, like a travel journal', page: '#F6F1E7', card: '#FFFDF8', text: '#3B3024', muted: '#8A7A66', accent: '#9C6B3C', rule: '#E6DCC8' },
  { key: 'coastal', name: 'Coastal', description: 'Soft sea-glass blues', page: '#EAF4F6', card: '#FFFFFF', text: '#1E3A47', muted: '#5B7A86', accent: '#2E96A6', rule: '#CFE3E8' },
  { key: 'sunset', name: 'Sunset', description: 'Peach and terracotta warmth', page: '#FFF1E6', card: '#FFFFFF', text: '#4A2A1A', muted: '#9A6B55', accent: '#E0662F', rule: '#F6D9C6' },
  { key: 'midnight', name: 'Midnight', description: 'Deep navy, best on screen (uses more ink)', page: '#132238', card: '#1B3050', text: '#EEF2F7', muted: '#A9B8C9', accent: '#F5B041', rule: '#2B4468' },
];

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
export const buildKeepsakeHtml = (blog: any, themeKey?: string | null): string => {
  const theme = getKeepsakeTheme(themeKey);
  const title = String(blog?.title || 'Trip keepsake');
  const days: any[] = Array.isArray(blog?.days) ? blog.days : [];
  const contentDays = days.filter((day) => day.headline || day.summary || notesForDay(day).length || photosForDay(day).length);
  const range = formatKeepsakeRange(days.map((day) => day.localDate));

  const sections = contentDays.map((day) => {
    const photos = photosForDay(day);
    const figures = photos.map((photo) => `<figure><img src="${escapeHtml(photo.url)}" alt="${escapeHtml(photo.alt)}">${photo.caption ? `<figcaption>${escapeHtml(photo.caption)}</figcaption>` : ''}</figure>`).join('');
    return `<section class="day">
  <p class="day-date">${escapeHtml(formatKeepsakeDay(day.localDate))}</p>
  ${day.headline ? `<h2>${escapeHtml(day.headline)}</h2>` : ''}
  ${day.summary ? `<p class="summary">${escapeHtml(day.summary)}</p>` : ''}
  ${notesForDay(day).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('')}
  ${figures ? `<div class="photos${photos.length === 1 ? ' single' : ''}">${figures}</div>` : ''}
</section>`;
  }).join('\n');

  const intro = paragraphsFromRichText(blog?.introduction).map((p) => `<p class="intro">${escapeHtml(p)}</p>`).join('');

  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,500;0,9..144,600;1,9..144,400&display=swap" rel="stylesheet">
<style>
  :root { --page:${theme.page}; --card:${theme.card}; --text:${theme.text}; --muted:${theme.muted}; --accent:${theme.accent}; --rule:${theme.rule}; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { background: var(--page); }
  body { margin: 0; color: var(--text); font: 16px/1.65 Georgia, 'Times New Roman', serif; }
  .wrap { max-width: 760px; margin: 0 auto; padding: 56px 28px 64px; }
  header { text-align: center; padding-bottom: 28px; margin-bottom: 32px; border-bottom: 1px solid var(--rule); }
  .eyebrow { font: 600 12px/1 system-ui, -apple-system, sans-serif; letter-spacing: .18em; text-transform: uppercase; color: var(--accent); margin: 0 0 14px; }
  h1 { font-family: 'Fraunces', Georgia, serif; font-weight: 600; font-size: 44px; line-height: 1.1; margin: 0 0 10px; }
  .subtitle { font-family: 'Fraunces', Georgia, serif; font-style: italic; font-size: 19px; color: var(--muted); margin: 0 0 8px; }
  .range { font: 500 14px/1.4 system-ui, -apple-system, sans-serif; color: var(--muted); margin: 0; }
  .intro { font-size: 17px; margin: 0 0 14px; }
  .day { background: var(--card); border: 1px solid var(--rule); border-top: 4px solid var(--accent); border-radius: 14px; padding: 26px 28px 24px; margin: 0 0 26px; break-inside: avoid-page; }
  .day-date { font: 600 12px/1 system-ui, -apple-system, sans-serif; letter-spacing: .12em; text-transform: uppercase; color: var(--accent); margin: 0 0 10px; }
  h2 { font-family: 'Fraunces', Georgia, serif; font-weight: 500; font-size: 27px; line-height: 1.2; margin: 0 0 8px; }
  .summary { font-style: italic; color: var(--muted); margin: 0 0 14px; }
  .day p { margin: 0 0 12px; }
  .photos { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 16px; }
  .photos.single { grid-template-columns: 1fr; }
  figure { margin: 0; break-inside: avoid; }
  img { display: block; width: 100%; max-height: 520px; object-fit: cover; border-radius: 10px; }
  .photos:not(.single) img { aspect-ratio: 4 / 3; height: auto; }
  figcaption { font: 13px/1.4 system-ui, -apple-system, sans-serif; color: var(--muted); margin-top: 6px; }
  footer { text-align: center; font: 12px/1.4 system-ui, -apple-system, sans-serif; color: var(--muted); margin-top: 36px; }
  @page { margin: 14mm; }
  @media print { .wrap { padding: 0; } }
</style></head>
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
