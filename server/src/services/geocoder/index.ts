import { atomicIncrementApiUsageIfUnderLimit } from '../../db';
import { getEnvValue } from '../../env';
import { geoapifyAdapter } from './geoapifyAdapter';
import { GeocoderError, type GeocoderAdapter, type GeocoderResult } from './types';

export { GeocoderError } from './types';
export type { GeocodeOptions, GeocoderAdapter, GeocoderCredit, GeocoderFailureCode, GeocoderResult } from './types';

const MAX_QUERY_CHARS = 300;
const TIMEOUT_MS = 8_000;
/** Below this match confidence a result is more likely wrong than useful, and a wrong pin is worse than none. */
const MIN_CONFIDENCE = 0.5;
/** A match in a different country than the trip's is trusted only this strongly; otherwise it is retried inside the trip's country. */
const STRONG_CONFIDENCE = 0.8;
const DEFAULT_DAILY_LIMIT = 500;

const registry = new Map<string, GeocoderAdapter>([[geoapifyAdapter.id, geoapifyAdapter]]);

/** Adds (or replaces) a provider. Selecting it is still a configuration choice: set GEOCODER_PROVIDER to its id. */
export const registerGeocoder = (adapter: GeocoderAdapter): void => { registry.set(adapter.id, adapter); };
/** @internal tests only */
export const __resetGeocodersForTests = (): void => { registry.clear(); registry.set(geoapifyAdapter.id, geoapifyAdapter); };

/** The provider chosen by GEOCODER_PROVIDER (default "geoapify"), or null when that id is not registered. */
export const getGeocoder = (): GeocoderAdapter | null => {
  const id = (getEnvValue('GEOCODER_PROVIDER', { defaultValue: geoapifyAdapter.id }) || geoapifyAdapter.id).trim().toLowerCase();
  return registry.get(id) ?? null;
};

export const geocoderConfigured = (): boolean => getGeocoder()?.isConfigured() ?? false;

/**
 * Credit to show on coordinates that came from a geocoder. Coordinates do not record which provider found them,
 * so this is the active provider's credit plus that of every provider listed in GEOCODER_PREVIOUS_PROVIDERS. After
 * switching providers, list the old one there for as long as its results are still stored.
 */
export const storedCoordinateCredit = (): { text: string; provider: string; links: Array<{ label: string; url: string }> } | null => {
  const active = getGeocoder();
  if (!active) return null;
  const previous = (getEnvValue('GEOCODER_PREVIOUS_PROVIDERS', { defaultValue: '' }) || '')
    .split(',').map((id) => id.trim().toLowerCase()).filter((id) => id && id !== active.id)
    .map((id) => registry.get(id)).filter((adapter): adapter is GeocoderAdapter => Boolean(adapter));
  const adapters = [active, ...previous];
  const links = new Map<string, { label: string; url: string }>();
  adapters.forEach((adapter) => adapter.credit.links.forEach((link) => links.set(link.url, link)));
  return { text: adapters.map((adapter) => adapter.credit.text).join(' · '), provider: active.id, links: [...links.values()] };
};

const dailyLimit = (): number => {
  // GEOAPIFY_MAX_DAILY_REQUESTS is the name this setting had before providers became pluggable.
  const raw = getEnvValue('GEOCODER_MAX_DAILY_REQUESTS') ?? getEnvValue('GEOAPIFY_MAX_DAILY_REQUESTS') ?? String(DEFAULT_DAILY_LIMIT);
  const configured = Number(raw);
  return Number.isFinite(configured) ? Math.max(0, Math.floor(configured)) : DEFAULT_DAILY_LIMIT;
};

const validCountry = (value: string | undefined): string | undefined => (value && /^[a-z]{2}$/i.test(value) ? value.toLowerCase() : undefined);

/** One provider request: counted against the daily cap, time-limited, and with every failure reduced to a code. */
const callProvider = async (adapter: GeocoderAdapter, query: string, language: string, countryCode?: string): Promise<GeocoderResult | null> => {
  const limit = dailyLimit();
  const quota = limit > 0 ? await atomicIncrementApiUsageIfUnderLimit({
    provider: `GEOCODER_${adapter.id.toUpperCase()}`, caller: 'ITEM_LOCATE', scope: 'caller', windowKey: new Date().toISOString().slice(0, 10), limit,
  }) : null;
  if (!quota || !quota.allowed) throw new GeocoderError('quota');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const found = await adapter.geocode(query, { language, signal: controller.signal, ...(countryCode ? { countryCode } : {}) });
    if (!found) return null;
    if (!Number.isFinite(found.lat) || !Number.isFinite(found.lng) || Math.abs(found.lat) > 90 || Math.abs(found.lng) > 180) throw new GeocoderError('invalid-response');
    return found;
  } catch (error) {
    if (error instanceof GeocoderError) throw error;
    // Anything else is an adapter bug or a raw network error; its message might carry a URL or key.
    throw new GeocoderError((error as { name?: string })?.name === 'AbortError' ? 'timeout' : 'provider');
  } finally {
    clearTimeout(timer);
  }
};

const confident = (found: GeocoderResult): boolean => found.confidence === null || found.confidence >= MIN_CONFIDENCE;

/**
 * Finds coordinates for one address with the active provider. Owns what every provider must obey: the query bounds,
 * a hard daily cap (each provider request counts), the timeout, the confidence threshold, the coordinate range check,
 * and reducing any failure to a GeocoderError code. Returns null when there is no confident match.
 *
 * `countryCode` is the country the trip is in, when known. It guards against the classic wrong-continent match: a
 * result in another country is kept only when the provider is strongly sure, otherwise the lookup is repeated
 * restricted to the trip's country and that answer must itself be confident.
 */
export const geocodeAddress = async (text: string, options: { language?: string; countryCode?: string; requirePreciseMatch?: boolean; strictCountry?: boolean } = {}): Promise<GeocoderResult | null> => {
  const adapter = getGeocoder();
  if (!adapter || !adapter.isConfigured()) throw new GeocoderError('not-configured');
  const query = text.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!query || query.length > MAX_QUERY_CHARS) throw new GeocoderError('invalid-query');
  const language = (options.language || 'en').slice(0, 8);
  const tripCountry = validCountry(options.countryCode);

  const acceptable = (found: GeocoderResult): boolean => confident(found) && (!options.requirePreciseMatch || (
    (!found.resultType || ['building', 'amenity'].includes(found.resultType))
    && !['match_by_street', 'match_by_postcode', 'match_by_city_or_disrict', 'match_by_city_or_district', 'match_by_country_or_state'].includes(found.matchType ?? '')
  ));
  const first = await callProvider(adapter, query, language, options.strictCountry ? tripCountry : undefined);
  if (!first || !acceptable(first)) return null;
  const elsewhere = Boolean(tripCountry && first.countryCode && first.countryCode !== tripCountry);
  if (options.strictCountry) return elsewhere ? null : first;
  if (!elsewhere || (first.confidence !== null && first.confidence >= STRONG_CONFIDENCE)) return first;

  const inCountry = await callProvider(adapter, query, language, tripCountry);
  return inCountry && acceptable(inCountry) ? inCountry : null;
};
