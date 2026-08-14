import { Router } from 'express';
import bodyParser from 'body-parser';
import { authenticate } from '../auth';
import { getTripById, getWebUserProfile, listTraitsForGroupTrip } from '../db';
import { logError, logInfo } from '../logger';
import { getEnvValue } from '../env';
import { getItineraryImage } from '../image-service';
import { generateItineraryViaPromptPlan, type MustSeeAttractionInput } from '../services/itineraryPromptPlanService';
import { scheduleGetYourGuideDescriptorEnrichment } from '../services/getYourGuideItineraryEnrichmentService';
import { enqueueAsyncItineraryJob, getAsyncItineraryJob } from '../services/itineraryAsyncService';
import { ApiLimitExceededError } from '../apis/usageLimiter';
import { fetchOverviewWeather } from '../apis/openMeteoWeatherApi';
import {
  assertCanUseFeature,
  reserveGenerationUsage,
  finalizeGenerationUsage,
  failGenerationUsage,
  recordUsage,
} from '../services/entitlementService';
import { EntitlementError } from '../errors';
import { TokenPayload } from '../auth';
import { reserveItineraryGenerationRateLimit } from '../services/httpRateLimitService';
import {
  getActiveAiProvider,
  getConfiguredProviderApiKey,
  getProviderApiKeyEnvVar,
} from '../services/aiProviderConfigService';
import type { RoadTripHints } from '../services/itineraryRoadTripService';

// Accepts either a plain attraction name or `{ name, destinationName }` so the
// generator can place must-see attractions on the correct destination's day.
const parseMustSeeAttractions = (raw: unknown): MustSeeAttractionInput[] => {
  if (!Array.isArray(raw)) return [];
  const out: MustSeeAttractionInput[] = [];
  for (const value of raw) {
    if (value && typeof value === 'object') {
      const name = String((value as any).name ?? '').trim();
      if (!name) continue;
      const destinationName = String((value as any).destinationName ?? '').trim();
      out.push(destinationName ? { name, destinationName } : { name });
      continue;
    }
    const name = String(value ?? '').trim();
    if (name) out.push(name);
  }
  return out;
};

// Exported for direct unit testing — this is pure request-body validation with no I/O, and its
// bounds/allowlists are exactly the kind of logic that should be tested without standing up the
// full authenticated generation route.
export const parseRoadTripHints = (raw: unknown): RoadTripHints | undefined => {
  if (!raw || typeof raw !== 'object') return undefined;
  const value = raw as Record<string, unknown>;
  const corridors = Array.isArray(value.corridors)
    ? value.corridors.slice(0, 32).flatMap((candidate) => {
        if (!candidate || typeof candidate !== 'object') return [];
        const item = candidate as Record<string, unknown>;
        const fromLocationId = String(item.fromLocationId ?? '').trim().slice(0, 160);
        const toLocationId = String(item.toLocationId ?? '').trim().slice(0, 160);
        const minutes = Number(item.minutes);
        if (!fromLocationId || !toLocationId || !Number.isFinite(minutes) || minutes <= 0 || minutes > 1440) return [];
        const mode = ['drive', 'rail', 'bus', 'flight', 'other'].includes(String(item.mode)) ? item.mode as any : undefined;
        const confidence = ['verified', 'estimated', 'low'].includes(String(item.confidence)) ? item.confidence as any : undefined;
        return [{ fromLocationId, toLocationId, minutes: Math.round(minutes), ...(mode ? { mode } : {}), ...(confidence ? { confidence } : {}) }];
      })
    : undefined;
  const deadlines = Array.isArray(value.deadlines)
    ? value.deadlines.slice(0, 31).flatMap((candidate) => {
        if (!candidate || typeof candidate !== 'object') return [];
        const item = candidate as Record<string, unknown>;
        const date = String(item.date ?? '').trim();
        const at = String(item.at ?? '').trim();
        const reasonCode = String(item.reasonCode ?? '').trim().slice(0, 80);
        const slack = Number(item.requiredSlackMinutes);
        // Range-checked, not just shape-checked — "25:99" previously matched \d{2}:\d{2} and slid
        // through to itineraryRoadTripService's own minutesFromTime, which rejects it and silently
        // substitutes an 18:00 default. Reject it here instead, at the actual input boundary.
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(at) || !reasonCode) return [];
        return [{ date, at, reasonCode, ...(Number.isFinite(slack) ? { requiredSlackMinutes: Math.max(0, Math.min(1440, Math.round(slack))) } : {}) }];
      })
    : undefined;
  const variants = Array.isArray(value.variants)
    ? value.variants.slice(0, 124).flatMap((candidate) => {
        if (!candidate || typeof candidate !== 'object') return [];
        const item = candidate as Record<string, unknown>;
        const variantId = String(item.variantId ?? '').trim().slice(0, 100);
        const date = String(item.date ?? '').trim();
        const labelReasonCode = String(item.labelReasonCode ?? '').trim().slice(0, 80);
        if (!variantId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !labelReasonCode) return [];
        const list = (key: string, max: number): string[] => Array.isArray(item[key]) ? item[key].map((entry) => String(entry ?? '').trim()).filter(Boolean).slice(0, max) : [];
        const estimatedMinutes = Number(item.estimatedMinutes);
        const conditions = list('conditions', 8).filter((entry): entry is any => ['dry', 'poor_weather', 'opening_hours', 'reservation_confirmed'].includes(entry));
        return [{ variantId, date, labelReasonCode, blockIds: list('blockIds', 40), activityNames: list('activityNames', 40), legIds: list('legIds', 16), ...(Number.isFinite(estimatedMinutes) ? { estimatedMinutes: Math.max(0, Math.min(1440, Math.round(estimatedMinutes))) } : {}), conditions, exclusiveGroup: String(item.exclusiveGroup ?? `day_${date}`).trim().slice(0, 100), tradeoffReasonCodes: list('tradeoffReasonCodes', 8) }];
      })
    : undefined;
  // Keyed by the same normalized location id the overlay derives for each BaseStay (lodging
  // address/name when lodgings exist, otherwise the destination) — the identical key-matching
  // contract corridors already require above, not a new one. A caller that doesn't know that id
  // ahead of time gets the existing flat/no-coordinate estimate instead of a mismatched one.
  const locationCoordinatesEntries = value.locationCoordinates && typeof value.locationCoordinates === 'object' && !Array.isArray(value.locationCoordinates)
    ? Object.entries(value.locationCoordinates as Record<string, unknown>)
        .slice(0, 16)
        .flatMap(([key, candidate]) => {
          const locationId = String(key ?? '').trim().slice(0, 160);
          if (!locationId || !candidate || typeof candidate !== 'object') return [];
          const item = candidate as Record<string, unknown>;
          const lat = Number(item.lat);
          const lng = Number(item.lng);
          if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return [];
          return [[locationId, { lat, lng }] as const];
        })
    : [];
  const locationCoordinates = locationCoordinatesEntries.length ? Object.fromEntries(locationCoordinatesEntries) : undefined;
  if (!corridors?.length && !deadlines?.length && !variants?.length && !locationCoordinates) return undefined;
  return {
    ...(corridors?.length ? { corridors } : {}),
    ...(deadlines?.length ? { deadlines } : {}),
    ...(variants?.length ? { variants } : {}),
    ...(locationCoordinates ? { locationCoordinates } : {}),
  };
};

// Returns a UTC monthly window key, e.g. "2026-03"
const getMonthWindowKey = (): string => {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
};

// Inline SVG so the fallback never depends on an external host that might
// 404 (the previous Unsplash URL was deleted upstream and broke every
// itinerary that landed on the fallback).
const PLACEHOLDER_IMAGE =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1200 800'><rect width='1200' height='800' fill='%23e5e7eb'/><text x='50%25' y='50%25' font-family='system-ui,sans-serif' font-size='40' fill='%239ca3af' text-anchor='middle' dominant-baseline='middle'>Image unavailable</text></svg>";

const resolveIdempotencyKey = (req: any, userId: string, tripId: string): string => {
  const fromHeader = String(req.headers['idempotency-key'] ?? '').trim();
  const fromBody = String(req.body?.idempotencyKey ?? '').trim();
  const supplied = fromHeader || fromBody;
  if (supplied) return `${userId}:${supplied.slice(0, 200)}`;
  return `${userId}:${tripId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
};

const toFirestoreSafeValue = <T>(value: T): T => {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is Exclude<typeof item, undefined> => item !== undefined)
      .map((item) => toFirestoreSafeValue(item)) as T;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, toFirestoreSafeValue(item)])
    ) as T;
  }
  return value;
};

const resolveItineraryProviderRuntime = async (): Promise<
  | { provider: string; model: string; apiKey?: string }
  | { error: string }
> => {
  const active = await getActiveAiProvider('itinerary_generation');
  const provider = String(active.provider || '').trim().toLowerCase() || 'openai';
  const model = String(active.model || '').trim() || 'gpt-4o-mini';
  const apiKeyEnvVar = getProviderApiKeyEnvVar(provider);
  const apiKey = getConfiguredProviderApiKey(provider);

  if (!apiKey) {
    return {
      error: `${provider} is selected for itinerary generation, but ${apiKeyEnvVar} is not configured on the server.`,
    };
  }
  if (provider === 'openai' && /^sk-?x+/i.test(apiKey)) {
    return {
      error: 'OpenAI API key appears to be a placeholder. Update OPENAI_API_KEY on the server.',
    };
  }

  return { provider, model, apiKey };
};

// Itineraries API: manage itineraries, details, and sharing helpers.
const router = Router();
router.use(bodyParser.json());
router.use(authenticate);

router.get('/images', async (req, res) => {
  const location = String(req.query.location || '').trim();
  if (!location) {
    res.status(400).json({ error: 'location is required' });
    return;
  }

  try {
    const placeId = req.query.placeId ? String(req.query.placeId).trim() : undefined;
    const day = req.query.day ? String(req.query.day).trim() : undefined;
    const contextText = req.query.context ? String(req.query.context).trim() : undefined;
    const result = await getItineraryImage({ locationName: location, placeId, day, contextText });
    if (!result.url) {
      res.json({ url: PLACEHOLDER_IMAGE, cached: false, provider: 'placeholder', fallbackUsed: true });
      return;
    }
    res.json({
      url: result.url,
      cached: result.cached,
      provider: result.provider,
      fallbackUsed: result.fallbackUsed,
    });
  } catch (err) {
    logError('[itinerary] image fetch error', err);
    res.json({ url: PLACEHOLDER_IMAGE, cached: false, provider: 'placeholder', fallbackUsed: true });
  }
});

router.post('/weather/overview', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const role = ((req as any).user as TokenPayload).role;
  const tripId = typeof req.body?.tripId === 'string' ? req.body.tripId.trim() : '';
  const days = Array.isArray(req.body?.days) ? req.body.days.slice(0, 31) : [];
  const requests = days
    .map((entry: any) => ({
      date: String(entry?.date ?? '').trim(),
      location: String(entry?.location ?? '').trim(),
    }))
    .filter((entry: { date: string; location: string }) => entry.date && entry.location);

  if (!requests.length) {
    res.json({ weather: [] });
    return;
  }

  try {
    await assertCanUseFeature(userId, 'overview_weather', role);
    const result = await fetchOverviewWeather(requests);
    const windowKey = getMonthWindowKey();
    await recordUsage(userId, 'overview_weather_requests', 1, {
      windowKey,
      tripId: tripId || null,
      daysRequested: requests.length,
      daysReturned: result.weather.length,
    });
    if (result.apiCalls > 0) {
      await recordUsage(userId, 'api_calls_open_meteo', result.apiCalls, {
        windowKey,
        tripId: tripId || null,
        route: 'overview_weather',
      });
    }
    res.json({ weather: result.weather });
  } catch (err) {
    if (err instanceof EntitlementError) {
      res.status(402).json({ error: err.message, code: err.code });
      return;
    }
    if (err instanceof ApiLimitExceededError) {
      res.status(429).json({ error: err.message });
      return;
    }
    logError('[itinerary] overview weather error', err);
    res.status(500).json({ error: 'Failed to load overview weather' });
  }
});

router.post('/', async (req, res) => {
  const requestStartedAt = Date.now();
  const providerRuntime = await resolveItineraryProviderRuntime();
  if ('error' in providerRuntime) {
    res.status(500).json({ error: providerRuntime.error });
    return;
  }

  const { country, locations, mustSeeAttractions, days, budgetMin, budgetMax, departureAirport, homeAirport, homeRegion, returnAirport, tripId, tripStyle, tt, ut } = req.body ?? {};
  const userId = (req as any).user.userId as string;
  const role = ((req as any).user as TokenPayload).role;
  const selectedLocations = Array.isArray(locations)
    ? locations.map((value) => String(value ?? '').trim()).filter(Boolean)
    : [];
  const selectedMustSeeAttractions = parseMustSeeAttractions(mustSeeAttractions);
  const destinationSummary = selectedLocations.length
    ? selectedLocations.join(', ')
    : String(country ?? '').trim();
  if (!destinationSummary) {
    res.status(400).json({ error: 'locations or country is required' });
    return;
  }
  const daysNum = Number(days);
  if (!Number.isFinite(daysNum) || daysNum <= 0) {
    res.status(400).json({ error: 'days must be a positive number' });
    return;
  }
  const min = Number(budgetMin);
  const max = Number(budgetMax);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < min) {
    res.status(400).json({ error: 'budget range is invalid' });
    return;
  }

  if (!tripId || typeof tripId !== 'string') {
    res.status(400).json({ error: 'tripId is required to tailor by group traits' });
    return;
  }

  const profile = await getWebUserProfile(userId).catch(() => null);
  const preferredAirportFallback = String((profile as any)?.preferredAirport ?? '').trim();
  const effectiveDepartureAirport = String(departureAirport ?? '').trim() || preferredAirportFallback;
  const effectiveHomeAirport = String(homeAirport ?? preferredAirportFallback ?? effectiveDepartureAirport).trim();
  const effectiveReturnAirport = String(returnAirport ?? effectiveHomeAirport ?? effectiveDepartureAirport).trim();
  logInfo(
    `[itinerary] request start user=${userId} trip=${tripId} destinations="${destinationSummary}" days=${daysNum} budget=${min}-${max} departure="${String(
      effectiveDepartureAirport
    ).trim()}"`
  );

  let groupTraits: Array<{ userId: string; name: string; traits: string[] }> = [];
  try {
    groupTraits = await listTraitsForGroupTrip(userId, tripId);
    logInfo(`[itinerary] traits loaded trip=${tripId} members=${groupTraits.length}`);
  } catch (err: any) {
    const message = err?.message || '';
    if (/not authorized/i.test(message)) {
      res.status(403).json({
        error: 'Not authorized to generate an itinerary for this trip. Ensure you are signed in and belong to the trip group.',
        detail: message,
      });
      return;
    }
    if (/trip not found/i.test(message)) {
      res.status(404).json({
        error: 'Trip not found for itinerary generation. Select an active trip and try again.',
        detail: message,
      });
      return;
    }
    res.status(400).json({ error: message || 'Unable to fetch group traits' });
    return;
  }

  let tripStartDate: string | null | undefined;
  let tripEndDate: string | null | undefined;
  let tripStartMonth: number | null | undefined;
  let tripStartYear: number | null | undefined;
  try {
    const trip = await getTripById(tripId);
    if (trip) {
      tripStartDate = trip.startDate ?? null;
      tripEndDate = trip.endDate ?? null;
      tripStartMonth = trip.startMonth ?? null;
      tripStartYear = trip.startYear ?? null;
      logInfo(
        `[itinerary] trip context trip=${tripId} startDate=${tripStartDate ?? ''} endDate=${tripEndDate ?? ''} startMonth=${tripStartMonth ?? ''} startYear=${tripStartYear ?? ''}`
      );
    }
  } catch {
    // Best-effort enrichment; itinerary generation can proceed without trip date metadata.
    logInfo(`[itinerary] trip context unavailable trip=${tripId}; proceeding without stored trip dates`);
  }

  const idempotencyKey = resolveIdempotencyKey(req, userId, tripId);
  try {
    await assertCanUseFeature(userId, 'ai_itinerary_generation', role);
    await reserveItineraryGenerationRateLimit(userId, req.ip ?? null);
    const reservation = await reserveGenerationUsage({
      userId,
      tripId,
      role,
      windowKey: getMonthWindowKey(),
      idempotencyKey,
    });
    if (reservation.status === 'completed') {
      res.json(reservation.responseBody ?? {});
      return;
    }
    if (reservation.status === 'pending') {
      res.status(202).json({ status: 'pending', message: 'An itinerary generation request with this key is already in progress.' });
      return;
    }

    const result = await generateItineraryViaPromptPlan({
      apiKey: providerRuntime.apiKey,
      userId,
      usageWindowKey: getMonthWindowKey(),
      destinations: selectedLocations.length ? selectedLocations : [destinationSummary],
      mustSeeAttractions: selectedMustSeeAttractions,
      days: daysNum,
      budgetMin: min,
      budgetMax: max,
      departureAirport: effectiveDepartureAirport || undefined,
      homeAirport: effectiveHomeAirport || undefined,
      homeRegion: typeof homeRegion === 'string' ? homeRegion.trim() || undefined : undefined,
      returnAirport: effectiveReturnAirport || undefined,
      tripStyle: tripStyle ? String(tripStyle).trim() : undefined,
      promptTraits: {
        tt: tt && typeof tt === 'object' ? tt : undefined,
        ut: ut && typeof ut === 'object' ? ut : undefined,
      },
      groupTraits,
      tripStartDate,
      tripEndDate,
      tripStartMonth,
      tripStartYear,
      tripIdSeed: tripId,
      roadTripHints: parseRoadTripHints(req.body?.roadTrip),
    });
    const normalizedPlan = String(result.planMarkdown ?? '')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .trim();
    if (!normalizedPlan) {
      await failGenerationUsage(idempotencyKey, 'No itinerary returned');
      res.status(500).json({ error: 'No itinerary returned' });
      return;
    }

    logInfo(
      `[itinerary] generated trip=${tripId} details=${result.details.length} transfers=${result.generatedItems.transfers.length} lodgings=${result.generatedItems.lodgings.length} activities=${result.generatedItems.activities.length} carRentals=${result.generatedItems.carRentals.length} tokens=${result.tokenUsage.totalTokens} elapsedMs=${Date.now() - requestStartedAt}`
    );

    const responseBody = toFirestoreSafeValue({
      plan: normalizedPlan,
      details: result.details,
      generatedItems: result.generatedItems,
      promptProfile: result.profile,
      promptPlan: {
        normalized: result.normalized,
        route: result.route,
        itinerary: result.itinerary,
      },
      ...(result.roadTrip ? { roadTrip: result.roadTrip } : {}),
    });
    // Affiliate work is explicitly post-response/background work. It cannot
    // change ordering, cache payloads, or add latency to itinerary generation.
    scheduleGetYourGuideDescriptorEnrichment(result.getYourGuideCandidates ?? []);
    await finalizeGenerationUsage({
      userId,
      windowKey: getMonthWindowKey(),
      idempotencyKey,
      responseBody,
    });
    res.json(responseBody);
  } catch (err: any) {
    if (err instanceof EntitlementError) {
      logInfo(`[itinerary] entitlement denied code=${err.code}`);
      res.status(402).json({ error: err.message, code: err.code });
      return;
    }
    if (err instanceof ApiLimitExceededError || err?.name === 'HttpRateLimitExceededError') {
      if (err?.retryAfterSeconds) res.setHeader('Retry-After', String(err.retryAfterSeconds));
      res.status(429).json({ error: err.message });
      return;
    }
    const detail = err.response?.data || err.message || String(err);
    await failGenerationUsage(idempotencyKey, typeof detail === 'string' ? detail : JSON.stringify(detail));
    logError('[itinerary] provider API error', detail);
    logInfo(`[itinerary] request failed trip=${tripId} elapsedMs=${Date.now() - requestStartedAt}`);
    res.status(500).json({ error: 'Failed to generate itinerary', detail });
  }
});

router.post('/async', async (req, res) => {
  const providerRuntime = await resolveItineraryProviderRuntime();
  if ('error' in providerRuntime) {
    res.status(500).json({ error: providerRuntime.error });
    return;
  }

  const { country, locations, mustSeeAttractions, days, budgetMin, budgetMax, departureAirport, homeAirport, homeRegion, returnAirport, tripId, tripStyle, tt, ut, itineraryId } = req.body ?? {};
  const userId = (req as any).user.userId as string;
  const role = ((req as any).user as TokenPayload).role;
  const selectedLocations = Array.isArray(locations)
    ? locations.map((value) => String(value ?? '').trim()).filter(Boolean)
    : [];
  const selectedMustSeeAttractions = parseMustSeeAttractions(mustSeeAttractions);
  const destinationSummary = selectedLocations.length
    ? selectedLocations.join(', ')
    : String(country ?? '').trim();
  if (!destinationSummary) {
    res.status(400).json({ error: 'locations or country is required' });
    return;
  }
  const daysNum = Number(days);
  if (!Number.isFinite(daysNum) || daysNum <= 0) {
    res.status(400).json({ error: 'days must be a positive number' });
    return;
  }
  const min = Number(budgetMin);
  const max = Number(budgetMax);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < min) {
    res.status(400).json({ error: 'budget range is invalid' });
    return;
  }
  if (!tripId || typeof tripId !== 'string') {
    res.status(400).json({ error: 'tripId is required to tailor by group traits' });
    return;
  }

  let groupTraits: Array<{ userId: string; name: string; traits: string[] }> = [];
  try {
    groupTraits = await listTraitsForGroupTrip(userId, tripId);
  } catch (err: any) {
    const message = err?.message || '';
    if (/not authorized/i.test(message)) {
      res.status(403).json({
        error: 'Not authorized to generate an itinerary for this trip. Ensure you are signed in and belong to the trip group.',
        detail: message,
      });
      return;
    }
    if (/trip not found/i.test(message)) {
      res.status(404).json({
        error: 'Trip not found for itinerary generation. Select an active trip and try again.',
        detail: message,
      });
      return;
    }
    res.status(400).json({ error: message || 'Unable to fetch group traits' });
    return;
  }

  let tripStartDate: string | null | undefined;
  let tripEndDate: string | null | undefined;
  let tripStartMonth: number | null | undefined;
  let tripStartYear: number | null | undefined;
  try {
    const trip = await getTripById(tripId);
    if (trip) {
      tripStartDate = trip.startDate ?? null;
      tripEndDate = trip.endDate ?? null;
      tripStartMonth = trip.startMonth ?? null;
      tripStartYear = trip.startYear ?? null;
    }
  } catch {
    // best effort
  }

  // Entitlement checks — run before enqueuing so the user gets immediate feedback.
  const idempotencyKey = resolveIdempotencyKey(req, userId, tripId);
  try {
    await assertCanUseFeature(userId, 'ai_itinerary_generation', role);
    await reserveItineraryGenerationRateLimit(userId, req.ip ?? null);
    const reservation = await reserveGenerationUsage({
      userId,
      tripId,
      role,
      windowKey: getMonthWindowKey(),
      idempotencyKey,
    });
    if (reservation.status === 'completed') {
      res.status(200).json(reservation.responseBody ?? {});
      return;
    }
    if (reservation.status === 'pending') {
      res.status(202).json({ status: 'pending', message: 'An itinerary generation request with this key is already in progress.' });
      return;
    }
  } catch (err) {
    if (err instanceof EntitlementError) {
      res.status(402).json({ error: err.message, code: err.code });
      return;
    }
    if (err instanceof ApiLimitExceededError || (err as any)?.name === 'HttpRateLimitExceededError') {
      if ((err as any)?.retryAfterSeconds) res.setHeader('Retry-After', String((err as any).retryAfterSeconds));
      res.status(429).json({ error: (err as Error).message });
      return;
    }
    throw err;
  }

  const profile = await getWebUserProfile(userId).catch(() => null);
  const preferredAirportFallback = String((profile as any)?.preferredAirport ?? '').trim();
  const effectiveDepartureAirport = String(departureAirport ?? '').trim() || preferredAirportFallback;
  const effectiveHomeAirport = String(homeAirport ?? preferredAirportFallback ?? effectiveDepartureAirport).trim();
  const effectiveReturnAirport = String(returnAirport ?? effectiveHomeAirport ?? effectiveDepartureAirport).trim();
  const job = enqueueAsyncItineraryJob({
    apiKey: providerRuntime.apiKey,
    userId,
    tripId,
    itineraryId: typeof itineraryId === 'string' ? itineraryId : undefined,
    destinationSummary,
    locations: selectedLocations,
    mustSeeAttractions: selectedMustSeeAttractions,
    days: daysNum,
    budgetMin: min,
    budgetMax: max,
    departureAirport: effectiveDepartureAirport || undefined,
    homeAirport: effectiveHomeAirport || undefined,
    homeRegion: typeof homeRegion === 'string' ? homeRegion.trim() || undefined : undefined,
    returnAirport: effectiveReturnAirport || undefined,
    tripStyle: tripStyle ? String(tripStyle).trim() : undefined,
    tt,
    ut,
    roadTripHints: parseRoadTripHints(req.body?.roadTrip),
    groupTraits,
    tripStartDate,
    tripEndDate,
    tripStartMonth,
    tripStartYear,
    idempotencyKey,
    usageWindowKey: getMonthWindowKey(),
  });
  res.status(202).json({
    jobId: job.id,
    tripId,
    itineraryId: typeof itineraryId === 'string' ? itineraryId : null,
    status: job.status,
  });
});

router.get('/async/:jobId', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const job = getAsyncItineraryJob(req.params.jobId);
  if (!job || job.userId !== userId) {
    res.status(404).json({ error: 'Async itinerary job not found' });
    return;
  }
  res.json({
    jobId: job.id,
    tripId: job.tripId,
    itineraryId: job.result?.itineraryId ?? job.itineraryId ?? null,
    status: job.status,
    error: job.error ?? null,
    result: job.result ?? null,
    stage: job.stage ?? null,
    stageLabel: job.stageLabel ?? null,
    stageDetail: job.stageDetail ?? null,
    etaSeconds: job.etaSeconds ?? null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  });
});

export default router;
