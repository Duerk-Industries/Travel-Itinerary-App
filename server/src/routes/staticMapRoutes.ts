import { ensureUserCanReadTrip, getLodgingById } from '../db';
import { getPlanningDayPoints } from '../services/planningPointsService';
import { reserveMapRenderRateLimit, HttpRateLimitExceededError } from '../services/httpRateLimitService';
import { Router } from 'express';
import { authenticate } from '../auth';
import { getApiCacheSetting } from '../config/apiLimits';
import { reserveApiUsageOrThrow, ApiLimitExceededError } from '../apis/usageLimiter';
import { recordProviderRequestCost } from '../apis/providerBudgeting';
import { isFeatureEnabled } from '../services/entitlementService';
import { getEnvValue } from '../env';
import { logError } from '../logger';
import type { Response } from 'express';

const STATIC_MAP_CALLER = 'STATIC_MAP_PREVIEW';
const TRIP_DAY_MAP_CALLER = 'TRIP_DAY_MAP';
const TRIP_DAY_MAP_FEATURE_FLAG = 'trip_day_map';
const GOOGLE_STATIC_MAPS_URL = 'https://maps.googleapis.com/maps/api/staticmap';
const DEFAULT_MAX_TRIP_DAY_POINTS = 12;
const MAX_ADDRESS_LENGTH = 200;

const getMaxTripDayPoints = (): number => {
  const configured = getApiCacheSetting('googleStaticMaps', 'maxPointsPerTripDayMap');
  const parsed = Number(configured);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(DEFAULT_MAX_TRIP_DAY_POINTS, Math.floor(parsed)) : DEFAULT_MAX_TRIP_DAY_POINTS;
};

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

const getStaticMapsApiKey = (): string | null =>
  getEnvValue('GOOGLE_STATIC_MAPS_API_KEY') || getEnvValue('GOOGLE_MAPS_API_KEY') || null;

const router = Router();
router.use(authenticate);

const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-f0-9-]{36}$/i.test(id);
const proxyImage = async (res: Response, userId: string, ip: string | undefined, caller: string, points: TripMapPoint[]): Promise<void> => {
  const key = getStaticMapsApiKey();
  if (!key) { res.status(503).json({ error: 'Map unavailable.' }); return; }
  await reserveMapRenderRateLimit(userId, ip);
  await reserveApiUsageOrThrow({ provider: 'GOOGLE_STATIC_MAPS', caller });
  await recordProviderRequestCost({ provider: 'GOOGLE_STATIC_MAPS' });
  const url = new URL(GOOGLE_STATIC_MAPS_URL);
  url.searchParams.set('size', '640x400'); url.searchParams.set('scale', '2'); url.searchParams.set('key', key);
  for (const point of points) url.searchParams.append('markers', `color:${MARKER_COLOR_BY_KIND[point.kind]}|label:${point.label}|${point.location}`);
  const coordinates = points.map(point => point.location).filter(location => /^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/.test(location));
  if (coordinates.length > 1) url.searchParams.set('path', `color:0x475569ff|weight:3|${coordinates.join('|')}`);
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url.toString(), { signal: controller.signal, headers: { Accept: 'image/png' } });
    const contentType = response.headers.get('content-type')?.split(';')[0];
    if (!response.ok || !['image/png', 'image/jpeg'].includes(contentType || '') || Number(response.headers.get('content-length') || 0) > 2 * 1024 * 1024 || !response.body) throw new Error('Invalid map response');
    const chunks: Uint8Array[] = []; let size = 0; const reader = response.body.getReader();
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new Error('Map response too large'); }
      chunks.push(part.value);
    }
    res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('Vary', 'Authorization');
    res.type(contentType!).send(Buffer.concat(chunks));
  } finally { clearTimeout(timer); }
};
const mapError = (res: Response, error: unknown): void => {
  if (error instanceof ApiLimitExceededError || error instanceof HttpRateLimitExceededError) {
    res.status(429).json({ error: 'Map allowance reached. Your itinerary is still available.' }); return;
  }
  logError('[static-maps] provider request failed');
  res.status(502).json({ error: 'Map unavailable. Your itinerary is still available.' });
};
router.get('/static', async (req, res) => {
  if (!validId(req.query.lodgingId)) { res.status(400).json({ error: 'lodgingId is required.' }); return; }
  try {
    const userId = (req as any).user.userId as string;
    const lodging = await getLodgingById(req.query.lodgingId);
    if (!lodging || !(await ensureUserCanReadTrip(lodging.tripId ?? lodging.trip_id, userId))) { res.status(403).json({ error: 'Lodging unavailable.' }); return; }
    const points = normalizeTripMapPoints([{ kind: 'lodging', address: lodging.address, lat: lodging.lat, lng: lodging.lng }], 1);
    if (!points.length) { res.status(404).json({ error: 'No location for this lodging.' }); return; }
    await proxyImage(res, userId, req.ip, STATIC_MAP_CALLER, points);
  } catch (error) { mapError(res, error); }
});
router.get('/trip-day', async (req, res) => {
  if (!validId(req.query.tripId) || typeof req.query.dayDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(req.query.dayDate)) { res.status(400).json({ error: 'tripId and dayDate are required.' }); return; }
  try {
    if (!(await isFeatureEnabled(TRIP_DAY_MAP_FEATURE_FLAG))) { res.status(403).json({ error: 'Map disabled.', code: 'FEATURE_DISABLED' }); return; }
    const userId = (req as any).user.userId as string;
    if (!(await ensureUserCanReadTrip(req.query.tripId, userId))) { res.status(403).json({ error: 'Trip unavailable.' }); return; }
    const raw = await getPlanningDayPoints(userId, req.query.tripId, req.query.dayDate);
    const points = normalizeTripMapPoints(raw, getMaxTripDayPoints());
    if (!points.length) { res.status(404).json({ error: 'No locations for this day.' }); return; }
    await proxyImage(res, userId, req.ip, TRIP_DAY_MAP_CALLER, points);
  } catch (error) { mapError(res, error); }
});
export default router;
