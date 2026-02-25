import { Router } from 'express';
import bodyParser from 'body-parser';
import { authenticate } from '../auth';
import { getTripById, getWebUserProfile, listTraitsForGroupTrip } from '../db';
import { logError, logInfo } from '../logger';
import { getEnvValue } from '../env';
import { getItineraryImage } from '../image-service';
import { generateItineraryViaPromptPlan } from '../services/itineraryPromptPlanService';
import { enqueueAsyncItineraryJob, getAsyncItineraryJob } from '../services/itineraryAsyncService';
import { ApiLimitExceededError } from '../apis/usageLimiter';

const PLACEHOLDER_IMAGE =
  'https://images.unsplash.com/photo-1502920917128-1aa500764b0e?auto=format&fit=crop&w=1200&q=80';

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

router.post('/', async (req, res) => {
  const requestStartedAt = Date.now();
  const apiKey = getEnvValue('OPENAI_API_KEY');
  if (!apiKey) {
    res.status(500).json({ error: 'OpenAI API key not configured on server' });
    return;
  }
  if (/^sk-?x+/i.test(apiKey)) {
    res.status(500).json({ error: 'OpenAI API key appears to be a placeholder. Update OPENAI_API_KEY on the server.' });
    return;
  }

  const { country, locations, days, budgetMin, budgetMax, departureAirport, tripId, tripStyle, tt, ut } = req.body ?? {};
  const userId = (req as any).user.userId as string;
  const selectedLocations = Array.isArray(locations)
    ? locations.map((value) => String(value ?? '').trim()).filter(Boolean)
    : [];
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

  let preferredAirportFallback = '';
  if (!String(departureAirport ?? '').trim()) {
    const profile = await getWebUserProfile(userId).catch(() => null);
    preferredAirportFallback = String((profile as any)?.preferredAirport ?? '').trim();
  }
  const effectiveDepartureAirport = String(departureAirport ?? '').trim() || preferredAirportFallback;
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

  try {
    const result = await generateItineraryViaPromptPlan({
      apiKey,
      userId,
      destinations: selectedLocations.length ? selectedLocations : [destinationSummary],
      days: daysNum,
      budgetMin: min,
      budgetMax: max,
      departureAirport: effectiveDepartureAirport || undefined,
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
    });
    const normalizedPlan = String(result.planMarkdown ?? '')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .trim();
    if (!normalizedPlan) {
      res.status(500).json({ error: 'No itinerary returned' });
      return;
    }

    logInfo(
      `[itinerary] generated trip=${tripId} details=${result.details.length} transfers=${result.generatedItems.transfers.length} lodgings=${result.generatedItems.lodgings.length} activities=${result.generatedItems.activities.length} carRentals=${result.generatedItems.carRentals.length} elapsedMs=${Date.now() - requestStartedAt}`
    );

    res.json({
      plan: normalizedPlan,
      details: result.details,
      generatedItems: result.generatedItems,
      promptProfile: result.profile,
      promptPlan: {
        normalized: result.normalized,
        route: result.route,
        itinerary: result.itinerary,
      },
    });
  } catch (err: any) {
    if (err instanceof ApiLimitExceededError) {
      res.status(429).json({ error: err.message });
      return;
    }
    const detail = err.response?.data || err.message || String(err);
    logError(`[itinerary] OpenAI API error`, detail);
    logInfo(`[itinerary] request failed trip=${tripId} elapsedMs=${Date.now() - requestStartedAt}`);
    res.status(500).json({ error: 'Failed to generate itinerary', detail });
  }
});

router.post('/async', async (req, res) => {
  const apiKey = getEnvValue('OPENAI_API_KEY');
  if (!apiKey) {
    res.status(500).json({ error: 'OpenAI API key not configured on server' });
    return;
  }
  if (/^sk-?x+/i.test(apiKey)) {
    res.status(500).json({ error: 'OpenAI API key appears to be a placeholder. Update OPENAI_API_KEY on the server.' });
    return;
  }

  const { country, locations, days, budgetMin, budgetMax, departureAirport, tripId, tripStyle, tt, ut, itineraryId } = req.body ?? {};
  const userId = (req as any).user.userId as string;
  const selectedLocations = Array.isArray(locations)
    ? locations.map((value) => String(value ?? '').trim()).filter(Boolean)
    : [];
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

  let preferredAirportFallback = '';
  if (!String(departureAirport ?? '').trim()) {
    const profile = await getWebUserProfile(userId).catch(() => null);
    preferredAirportFallback = String((profile as any)?.preferredAirport ?? '').trim();
  }
  const effectiveDepartureAirport = String(departureAirport ?? '').trim() || preferredAirportFallback;
  const job = enqueueAsyncItineraryJob({
    apiKey,
    userId,
    tripId,
    itineraryId: typeof itineraryId === 'string' ? itineraryId : undefined,
    destinationSummary,
    locations: selectedLocations,
    days: daysNum,
    budgetMin: min,
    budgetMax: max,
    departureAirport: effectiveDepartureAirport || undefined,
    tripStyle: tripStyle ? String(tripStyle).trim() : undefined,
    tt,
    ut,
    groupTraits,
    tripStartDate,
    tripEndDate,
    tripStartMonth,
    tripStartYear,
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
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  });
});

export default router;
