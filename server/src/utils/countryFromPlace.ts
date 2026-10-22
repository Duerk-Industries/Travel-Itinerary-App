/**
 * Turns free text such as "Japan" or "Kyoto, Japan" into a lowercase ISO 3166-1 alpha-2 country code, when its last
 * parts name a country. Used to keep a geocoder from placing a stop in the wrong country. A bare city or a region
 * that is not a country gives undefined, which simply means "no country restriction".
 */
const ALIASES: Record<string, string> = {
  usa: 'us', 'u.s.a.': 'us', 'u.s.': 'us', america: 'us', 'united states of america': 'us',
  uk: 'gb', 'u.k.': 'gb', 'great britain': 'gb', britain: 'gb', england: 'gb', scotland: 'gb', wales: 'gb', 'northern ireland': 'gb',
  korea: 'kr', 'republic of korea': 'kr', 'czech republic': 'cz', czechia: 'cz', russia: 'ru', holland: 'nl',
  'the netherlands': 'nl', uae: 'ae', 'viet nam': 'vn', turkey: 'tr', türkiye: 'tr', 'ivory coast': 'ci', burma: 'mm',
};

// Codes the ISO standard reserves without making them countries; ICU gives some of them a real country's name
// (FX is "France"), which would otherwise overwrite the real entry.
const RESERVED = new Set(['AC', 'CP', 'DG', 'EA', 'EU', 'FX', 'IC', 'TA', 'UN', 'ZZ']);
// Names shared by a country and a well-known region elsewhere. Guessing wrongly would restrict a trip to the wrong
// country, so these give no restriction at all.
const AMBIGUOUS = new Set(['georgia']);

let byName: Map<string, string> | null = null;

const countryNames = (): Map<string, string> => {
  if (byName) return byName;
  byName = new Map();
  try {
    const display = new Intl.DisplayNames(['en'], { type: 'region' });
    for (let first = 65; first <= 90; first += 1) {
      for (let second = 65; second <= 90; second += 1) {
        const code = String.fromCharCode(first, second);
        const name = display.of(code);
        // Unassigned codes come back unchanged; only real regions have a name.
        if (!name || name === code || RESERVED.has(code)) continue;
        const key = name.toLowerCase();
        if (!AMBIGUOUS.has(key) && !byName.has(key)) byName.set(key, code.toLowerCase());
      }
    }
  } catch { /* A runtime without region names just gets no country restriction. */ }
  return byName;
};

export const countryCodeFromPlace = (text: string | null | undefined): string | undefined => {
  const parts = String(text ?? '').split(',').map((part) => part.trim().toLowerCase()).filter(Boolean);
  const names = countryNames();
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const found = ALIASES[parts[index]] ?? names.get(parts[index]);
    if (found) return found;
  }
  return undefined;
};
