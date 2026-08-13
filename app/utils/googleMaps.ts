export const getMapsApiKey = (): string => {
  return (
    (typeof process !== 'undefined' && (process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY)) ||
    ''
  );
};

/**
 * Build the server-proxied map URL used by authenticated app screens.  The
 * optional legacy apiKey form remains available for callers outside the app,
 * but normal UI traffic now goes through the server so quota and cost are
 * enforced by the shared provider limiter.
 */
export const buildStaticMapUrl = (address: string, backendUrl?: string, apiKey?: string): string => {
  if (!address) return '';
  const isBackendUrl = Boolean(backendUrl && /^https?:\/\//i.test(backendUrl));
  if (isBackendUrl) {
    return `${backendUrl!.replace(/\/+$/, '')}/api/maps/static?address=${encodeURIComponent(address)}`;
  }
  const key = apiKey ?? (backendUrl && !isBackendUrl ? backendUrl : getMapsApiKey());
  if (!key) return '';
  const encoded = encodeURIComponent(address);
  const base = `https://maps.googleapis.com/maps/api/staticmap?center=${encoded}&zoom=14&size=600x320&scale=2&maptype=roadmap&markers=color:red|${encoded}`;
  return `${base}&key=${key}`;
};

/**
 * Mirrors the server's TripMapPointInput shape
 * (server/src/routes/staticMapRoutes.ts). Keep these in sync by hand — there
 * is no shared types package wired up between app/ and server/ for this yet.
 * Only `kind` + `address` are populated today; `lat`/`lng` exist for a
 * future entity that stores real coordinates (e.g. flights via the airport
 * dataset) without needing another endpoint contract change.
 */
export type TripMapPointKind = 'flight' | 'lodging' | 'activity' | 'car_rental';

export type TripMapPoint = {
  kind: TripMapPointKind;
  label?: string;
  address?: string;
  lat?: number;
  lng?: number;
};

const MAX_TRIP_DAY_MAP_URL_POINTS = 12;

/**
 * Build the trip-day map URL: multiple labeled pins (flight/lodging/
 * activity/car rental) for one day, proxied and rate-limited server-side.
 * Returns '' if there's nothing to plot or no backend URL — callers should
 * treat an empty string as "don't render an <Image>", not as an error.
 *
 * The server independently validates and caps points again (never trust the
 * client's cap alone), but trimming here keeps the query string small and
 * keeps the "what will render" logic visible in one place on this side too.
 */
export const buildTripDayMapUrl = (points: TripMapPoint[], backendUrl?: string): string => {
  if (!Array.isArray(points) || !points.length) return '';
  const isBackendUrl = Boolean(backendUrl && /^https?:\/\//i.test(backendUrl));
  if (!isBackendUrl) return '';

  const trimmed = points.slice(0, MAX_TRIP_DAY_MAP_URL_POINTS).filter((point) => {
    const hasCoords = typeof point.lat === 'number' && typeof point.lng === 'number';
    const hasAddress = typeof point.address === 'string' && point.address.trim().length > 0;
    return hasCoords || hasAddress;
  });
  if (!trimmed.length) return '';

  const payload = JSON.stringify(trimmed);
  return `${backendUrl!.replace(/\/+$/, '')}/api/maps/trip-day?points=${encodeURIComponent(payload)}`;
};
