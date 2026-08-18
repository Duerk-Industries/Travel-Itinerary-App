import { Router } from 'express';
import { authenticate } from '../auth';
import { getApiCacheSetting } from '../config/apiLimits';
import { reserveApiUsageOrThrow, ApiLimitExceededError } from '../apis/usageLimiter';
import { recordProviderRequestCost } from '../apis/providerBudgeting';
import { isFeatureEnabled } from '../services/entitlementService';
import { getEnvValue } from '../env';
import { createTtlCache } from '../utils/ttlCache';
import { logError } from '../logger';
import type { Response } from 'express';

const STATIC_MAP_CALLER = 'STATIC_MAP_PREVIEW';
const TRIP_DAY_MAP_CALLER = 'TRIP_DAY_MAP';
const TRIP_DAY_MAP_FEATURE_FLAG = 'trip_day_map';
const GOOGLE_STATIC_MAPS_URL = 'https://maps.googleapis.com/maps/api/staticmap';
const DEFAULT_CACHE_TTL_MINUTES = 24 * 60;
const DEFAULT_MAX_TRIP_DAY_POINTS = 12;
const MAX_ADDRESS_LENGTH = 200;

type CachedMap = { body: Buffer; contentType: string };

const getCacheTtlMs = (): number => {
  const configured = getApiCacheSetting('googleStaticMaps', 'cacheTtlMinutes');
  const minutes = Number(configured ?? DEFAULT_CACHE_TTL_MINUTES);
  return (Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_CACHE_TTL_MINUTES) * 60 * 1000;
};

const getMaxTripDayPoints = (): number => {
  const configured = getApiCacheSetting('googleStaticMaps', 'maxPointsPerTripDayMap');
  const parsed = Number(configured);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_MAX_TRIP_DAY_POINTS;
};

const mapCache = createTtlCache<CachedMap>({
  defaultTtlMs: getCacheTtlMs(),
  metricName: 'google_static_maps',
  maxSizeBytes: 32 * 1024 * 1024,
  sizeOf: (value) => value.body.byteLength,
});

export const clearStaticMapCacheForTests = (): void => mapCache.clear();

// ---------------------------------------------------------------------------
// Trip-day map: multiple labeled pins (flight/lodging/activity/car rental)
// on one static image. No connecting route line in v1 — Google's `path`
// parameter needs real lat/lng, and most of these entities only ever store a
// free-text address today (see docs/implementation_plans/
// implementation-plan-trip-day-map.md for why we deliberately didn't add a
// geocoding step to get one). Markers alone still accept plain address
// strings, which Google resolves internally at no extra API cost.
// ---------------------------------------------------------------------------

export type TripMapPointKind = 'flight' | 'lodging' | 'activity' | 'car_rental';

export type TripMapPointInput = {
  kind?: unknown;
  label?: unknown;
  address?: unknown;
  lat?: unknown;
  lng?: unknown;
};

export type TripMapPoint = {
  kind: TripMapPointKind;
  label: string;
  location: string; // either "lat,lng" or a free-text address, ready to drop into a Google `markers=` param
};

const MARKER_COLOR_BY_KIND: Record<TripMapPointKind, string> = {
  flight: 'blue',
  lodging: 'orange',
  activity: 'green',
  car_rental: 'purple',
};

const VALID_KINDS = new Set<TripMapPointKind>(['flight', 'lodging', 'activity', 'car_rental']);

const AUTO_LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const isFiniteLat = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= -90 && value <= 90;
const isFiniteLng = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= -180 && value <= 180;

/**
 * Validates and normalizes the client-supplied point list, silently dropping
 * malformed entries and truncating to the configured cap rather than
 * rejecting the whole request — one bad item (or an unusually long day)
 * shouldn't blank out the whole map.
 */
export const normalizeTripMapPoints = (raw: unknown, maxPoints: number): TripMapPoint[] => {
  if (!Array.isArray(raw)) return [];
  const out: TripMapPoint[] = [];
  let autoLabelIdx = 0;
  for (const entry of raw) {
    if (out.length >= maxPoints) break;
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as TripMapPointInput;

    const kindRaw = typeof item.kind === 'string' ? item.kind.trim() : '';
    const kind: TripMapPointKind = VALID_KINDS.has(kindRaw as TripMapPointKind)
      ? (kindRaw as TripMapPointKind)
      : 'activity';

    let location: string | null = null;
    if (isFiniteLat(item.lat) && isFiniteLng(item.lng)) {
      location = `${item.lat},${item.lng}`;
    } else if (typeof item.address === 'string' && item.address.trim()) {
      location = item.address.trim().slice(0, MAX_ADDRESS_LENGTH);
    }
    if (!location) continue;

    const labelSource = typeof item.label === 'string' ? item.label.trim().toUpperCase() : '';
    const labelChar = /^[A-Z0-9]$/.test(labelSource) ? labelSource : AUTO_LABELS[autoLabelIdx % AUTO_LABELS.length];
    autoLabelIdx += 1;

    out.push({ kind, label: labelChar, location });
  }
  return out;
};

const sendMapErrorResponse = (res: Response, err: unknown, logLabel: string): void => {
  if (err instanceof ApiLimitExceededError) {
    res.status(429).json({ error: err.message });
    return;
  }
  const statusCode = Number((err as any)?.statusCode);
  if (statusCode === 503) {
    res.status(503).json({ error: (err as Error).message });
    return;
  }
  logError(`[static-maps] ${logLabel} failed`, err);
  res.status(502).json({ error: 'Unable to load map' });
};

const getStaticMapsApiKey = (): string | null =>
  getEnvValue('GOOGLE_STATIC_MAPS_API_KEY') || getEnvValue('GOOGLE_MAPS_API_KEY') || null;

const router = Router();
router.use(authenticate);

router.get('/static', async (req, res) => {
  const address = String(req.query.address ?? '').trim();
  if (!address || address.length > 500) {
    res.status(400).json({ error: 'address is required and must be at most 500 characters' });
    return;
  }

  const cacheKey = `single:${address.toLowerCase().replace(/\s+/g, ' ')}`;
  try {
    const cached = await mapCache.getOrFetch(
      cacheKey,
      async () => {
        const apiKey = getStaticMapsApiKey();
        if (!apiKey) {
          const error = new Error('Google Static Maps is not configured');
          (error as any).statusCode = 503;
          throw error;
        }

        await reserveApiUsageOrThrow({ provider: 'GOOGLE_STATIC_MAPS', caller: STATIC_MAP_CALLER });
        await recordProviderRequestCost({ provider: 'GOOGLE_STATIC_MAPS' });

        const url = new URL(GOOGLE_STATIC_MAPS_URL);
        url.searchParams.set('center', address);
        url.searchParams.set('zoom', '14');
        url.searchParams.set('size', '600x320');
        url.searchParams.set('scale', '2');
        url.searchParams.set('maptype', 'roadmap');
        url.searchParams.set('markers', `color:red|${address}`);
        url.searchParams.set('key', apiKey);

        const response = await fetch(url.toString(), { headers: { Accept: 'image/*' } });
        if (!response.ok) {
          throw new Error(`Google Static Maps returned HTTP ${response.status}`);
        }
        return {
          body: Buffer.from(await response.arrayBuffer()),
          contentType: response.headers.get('content-type') || 'image/png',
        };
      },
      getCacheTtlMs()
    );
    res.setHeader('Cache-Control', `private, max-age=${Math.floor(getCacheTtlMs() / 1000)}`);
    res.type(cached.contentType).send(cached.body);
  } catch (err) {
    sendMapErrorResponse(res, err, 'single-address proxy request');
  }
});

router.get('/trip-day', async (req, res) => {
  if (!(await isFeatureEnabled(TRIP_DAY_MAP_FEATURE_FLAG))) {
    res.status(403).json({ error: 'Trip day map is currently disabled', code: 'FEATURE_DISABLED' });
    return;
  }

  let rawPoints: unknown;
  try {
    rawPoints = JSON.parse(String(req.query.points ?? '[]'));
  } catch {
    res.status(400).json({ error: 'points must be a JSON-encoded array' });
    return;
  }

  const points = normalizeTripMapPoints(rawPoints, getMaxTripDayPoints());
  if (!points.length) {
    res.status(400).json({ error: 'No valid map points provided' });
    return;
  }

  // Content-addressed cache key: identical itinerary state (same points, same
  // order) always hits cache regardless of which user/trip asked for it, and
  // any edit to the day naturally produces a new key with no manual
  // invalidation needed.
  const cacheKey = `tripday:${JSON.stringify(points)}`;

  try {
    const cached = await mapCache.getOrFetch(
      cacheKey,
      async () => {
        const apiKey = getStaticMapsApiKey();
        if (!apiKey) {
          const error = new Error('Google Static Maps is not configured');
          (error as any).statusCode = 503;
          throw error;
        }

        await reserveApiUsageOrThrow({ provider: 'GOOGLE_STATIC_MAPS', caller: TRIP_DAY_MAP_CALLER });
        await recordProviderRequestCost({ provider: 'GOOGLE_STATIC_MAPS' });

        const url = new URL(GOOGLE_STATIC_MAPS_URL);
        url.searchParams.set('size', '640x400');
        url.searchParams.set('scale', '2');
        url.searchParams.set('maptype', 'roadmap');
        // No explicit center/zoom: Google auto-fits the viewport to the
        // supplied markers when both are omitted.
        for (const point of points) {
          const color = MARKER_COLOR_BY_KIND[point.kind];
          url.searchParams.append('markers', `color:${color}|label:${point.label}|${point.location}`);
        }
        url.searchParams.set('key', apiKey);

        const response = await fetch(url.toString(), { headers: { Accept: 'image/*' } });
        if (!response.ok) {
          throw new Error(`Google Static Maps returned HTTP ${response.status}`);
        }
        return {
          body: Buffer.from(await response.arrayBuffer()),
          contentType: response.headers.get('content-type') || 'image/png',
        };
      },
      getCacheTtlMs()
    );
    res.setHeader('Cache-Control', `private, max-age=${Math.floor(getCacheTtlMs() / 1000)}`);
    res.type(cached.contentType).send(cached.body);
  } catch (err) {
    sendMapErrorResponse(res, err, 'trip-day proxy request');
  }
});

export default router;
