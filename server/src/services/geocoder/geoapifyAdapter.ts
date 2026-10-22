import { getEnvValue } from '../../env';
import { GeocoderError, type GeocoderAdapter } from './types';

/**
 * Geoapify (https://www.geoapify.com/) behind the GeocoderAdapter contract.
 *
 * - The key comes only from GEOAPIFY_API_KEY (getEnvValue, so `_FILE` secrets work). Geoapify authenticates with a
 *   query parameter, so the request URL is never logged and no error from here ever carries it.
 * - Its terms allow storing results when the data-source attribution is kept with them, and the free plan needs a
 *   visible "Powered by Geoapify" link; both are declared in `credit`.
 */
const ENDPOINT = 'https://api.geoapify.com/v1/geocode/search';
const MAX_RESPONSE_BYTES = 65_536;

const asCoordinate = (value: unknown, limit: number): number | null => {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && Math.abs(parsed) <= limit ? parsed : null;
};

export const geoapifyAdapter: GeocoderAdapter = {
  id: 'geoapify',
  displayName: 'Geoapify',
  credit: {
    text: 'Locations by Geoapify · © OpenStreetMap contributors',
    links: [{ label: 'Powered by Geoapify', url: 'https://www.geoapify.com/' }],
  },
  isConfigured: () => Boolean(getEnvValue('GEOAPIFY_API_KEY')),
  async geocode(query, { language, signal, countryCode }) {
    const key = getEnvValue('GEOAPIFY_API_KEY');
    if (!key) throw new GeocoderError('not-configured');
    const url = new URL(ENDPOINT);
    url.searchParams.set('text', query);
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '1');
    url.searchParams.set('lang', language);
    if (countryCode && /^[a-z]{2}$/.test(countryCode)) url.searchParams.set('filter', `countrycode:${countryCode}`);
    url.searchParams.set('apiKey', key);

    let response: Response;
    try {
      response = await fetch(url, { signal, redirect: 'error', headers: { Accept: 'application/json' } });
    } catch (error) {
      // A network error can echo the URL (and so the key); only a code leaves this function.
      throw new GeocoderError((error as { name?: string })?.name === 'AbortError' ? 'timeout' : 'provider');
    }
    if (response.status === 429) throw new GeocoderError('rate-limit');
    if (!response.ok) throw new GeocoderError('provider');
    const body = await response.text();
    if (Buffer.byteLength(body, 'utf8') > MAX_RESPONSE_BYTES) throw new GeocoderError('invalid-response');
    let parsed: { results?: unknown };
    try { parsed = JSON.parse(body); } catch { throw new GeocoderError('invalid-response'); }
    if (!parsed || !Array.isArray(parsed.results)) throw new GeocoderError('invalid-response');
    const first = parsed.results[0] as { lat?: unknown; lon?: unknown; city?: unknown; town?: unknown; village?: unknown; country_code?: unknown; result_type?: unknown; rank?: { confidence?: unknown; match_type?: unknown } } | undefined;
    if (!first) return null;
    const lat = asCoordinate(first.lat, 90);
    const lng = asCoordinate(first.lon, 180);
    if (lat === null || lng === null) throw new GeocoderError('invalid-response');
    const confidence = typeof first.rank?.confidence === 'number' && Number.isFinite(first.rank.confidence) ? first.rank.confidence : null;
    const place = first.city ?? first.town ?? first.village;
    const country = typeof first.country_code === 'string' && /^[a-z]{2}$/i.test(first.country_code) ? first.country_code.toLowerCase() : null;
    return { lat, lng, geoCity: typeof place === 'string' && place.trim() ? place.trim().slice(0, 160) : null, confidence, countryCode: country,
      ...(typeof first.result_type === 'string' ? { resultType: first.result_type.toLowerCase() } : {}),
      ...(typeof first.rank?.match_type === 'string' ? { matchType: first.rank.match_type.toLowerCase() } : {}),
    };
  },
};
