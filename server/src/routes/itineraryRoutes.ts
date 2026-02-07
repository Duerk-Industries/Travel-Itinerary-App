import { Router } from 'express';
import bodyParser from 'body-parser';
import { authenticate } from '../auth';
import axios from 'axios';
import { listTraitsForGroupTrip } from '../db';
import { logError } from '../logger';
import { getEnvValue } from '../env';
import { getDb } from '../db.firebase';
import { getStorage } from 'firebase-admin/storage';
import { getApp } from 'firebase-admin/app';
import { getPlacePhotoUrlByPlaceId } from '../googlePlaces';

type ImageCacheEntry = {
  sourceUrl: string;
  storagePath: string;
  storageBucket?: string;
  fetchedAt: number;
  expiresAt: number;
  provider: 'unsplash' | 'google_places';
};
const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const SIGNED_URL_TTL_MS = 15 * 60 * 1000;
const UNSPLASH_AUTH_BACKOFF_MS = 10 * 60 * 1000;
const PLACEHOLDER_IMAGE =
  'https://images.unsplash.com/photo-1502920917128-1aa500764b0e?auto=format&fit=crop&w=1200&q=80';
let unsplashAuthBlockedUntil = 0;
const getHttpErrorStatus = (err: unknown): number | undefined => {
  const status = (err as { response?: { status?: unknown } })?.response?.status;
  const numericStatus = typeof status === 'number' ? status : Number(status);
  return Number.isFinite(numericStatus) ? numericStatus : undefined;
};

const fetchUnsplashImage = async (query: string, retries = 2): Promise<string | null> => {
  // Prefer correctly-spelled var, but fall back to historical typo for backward compatibility.
  const key = getEnvValue('UNSPLASH_ACCESS_KEY') ?? getEnvValue('UNSPLASH_ACCESS_KEY');
  if (!key) return null;
  if (Date.now() < unsplashAuthBlockedUntil) return null;

  const doFetch = async (fetchQuery: string) => {
    const url = `https://api.unsplash.com/photos/random?orientation=landscape&content_filter=high&query=${encodeURIComponent(
      fetchQuery
    )}`;
    const res = await axios.get(url, { headers: { Authorization: `Client-ID ${key}` } });
    const data = res.data as any;
    return data?.urls?.regular || data?.urls?.full || null;
  };

  for (let i = 0; i < retries; i++) {
    try {
      const imageUrl = await doFetch(query);
      if (imageUrl) return imageUrl;
    } catch (err) {
      const status = getHttpErrorStatus(err);
      if (status === 401 || status === 403) {
        unsplashAuthBlockedUntil = Date.now() + UNSPLASH_AUTH_BACKOFF_MS;
        logError('[itinerary] Unsplash auth rejected request; disabling Unsplash fetches temporarily', {
          status,
          retryAt: new Date(unsplashAuthBlockedUntil).toISOString(),
        });
        return null;
      }
      logError(`[itinerary] Unsplash fetch for query "${query}" failed (attempt ${i + 1})`, err);
      if (i < retries - 1) {
        await new Promise((res) => setTimeout(res, 500 * (i + 1))); // Exponential backoff
      }
    }
  }

  // Fallback to a generic query
  try {
    const fallbackUrl = await doFetch('travel');
    if (fallbackUrl) return fallbackUrl;
  } catch (err) {
    const status = getHttpErrorStatus(err);
    if (status === 401 || status === 403) {
      unsplashAuthBlockedUntil = Date.now() + UNSPLASH_AUTH_BACKOFF_MS;
      logError('[itinerary] Unsplash auth rejected fallback request; disabling Unsplash fetches temporarily', {
        status,
        retryAt: new Date(unsplashAuthBlockedUntil).toISOString(),
      });
      return null;
    }
    logError('[itinerary] Unsplash fallback fetch failed', err);
  }

  return null;
};

const parseFirebaseConfig = (): { projectId?: string; storageBucket?: string } => {
  const raw = process.env.FIREBASE_CONFIG;
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as { projectId?: string; storageBucket?: string };
    return {
      projectId: parsed.projectId,
      storageBucket: parsed.storageBucket,
    };
  } catch {
    return {};
  }
};

const storageBucketCandidates = (preferredBucket?: string): string[] => {
  const firebaseConfig = parseFirebaseConfig();
  let appBucket: string | undefined;
  try {
    const option = getApp().options.storageBucket;
    appBucket = typeof option === 'string' ? option : undefined;
  } catch {
    appBucket = undefined;
  }
  const projectId =
    getEnvValue('GCLOUD_PROJECT_ID') ||
    getEnvValue('GOOGLE_CLOUD_PROJECT') ||
    firebaseConfig.projectId;

  const candidates = [
    preferredBucket,
    getEnvValue('LOCATION_BUCKET'),
    getEnvValue('FIREBASE_STORAGE_BUCKET'),
    firebaseConfig.storageBucket,
    appBucket,
    projectId ? `${projectId}.firebasestorage.app` : undefined,
    projectId ? `${projectId}.appspot.com` : undefined,
  ];
  return Array.from(
    new Set(
      candidates
        .map((value) => (value ?? '').trim())
        .filter((value) => value.length > 0)
    )
  );
};

const isBucketMissingError = (err: unknown): boolean => {
  const maybeError = err as { code?: number | string; message?: string };
  const code = Number(maybeError?.code);
  const message = String(maybeError?.message || '').toLowerCase();
  return (
    code === 404 ||
    message.includes('specified bucket does not exist') ||
    message.includes('bucket does not exist')
  );
};

const encodeToken = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'image';

const ensureStorageImage = async (
  provider: 'unsplash' | 'google_places',
  key: string,
  sourceUrl: string
): Promise<{ storagePath: string; storageBucket: string } | null> => {
  try {
    const response = await axios.get(sourceUrl, {
      responseType: 'arraybuffer',
      timeout: 15000,
      maxRedirects: 5,
    });
    const contentType = String(response.headers['content-type'] || 'image/jpeg');
    const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
    const folder = provider === 'google_places' ? 'images/google-places' : 'images/unsplash';
    const objectName = `${folder}/${encodeToken(key)}-${Date.now()}.${ext}`;
    const bucketCandidates = storageBucketCandidates();
    if (!bucketCandidates.length) throw new Error('No storage bucket configured');
    let lastErr: unknown = null;
    for (const bucketName of bucketCandidates) {
      try {
        const bucket = getStorage().bucket(bucketName);
        const file = bucket.file(objectName);
        await file.save(Buffer.from(response.data), {
          contentType,
          resumable: false,
          metadata: { cacheControl: 'public, max-age=86400' },
        });
        return { storagePath: objectName, storageBucket: bucketName };
      } catch (err) {
        lastErr = err;
        if (isBucketMissingError(err)) {
          continue;
        }
        break;
      }
    }
    logError('[itinerary] failed to persist image to storage', lastErr);
    return null;
  } catch (err) {
    logError('[itinerary] failed to persist image to storage', err);
    return null;
  }
};

const signStorageImage = async (storagePath: string, preferredBucket?: string): Promise<string | null> => {
  const bucketCandidates = storageBucketCandidates(preferredBucket);
  if (!bucketCandidates.length) return null;
  for (const bucketName of bucketCandidates) {
    try {
      const bucket = getStorage().bucket(bucketName);
      const file = bucket.file(storagePath);
      const [exists] = await file.exists();
      if (!exists) continue;
      const [signedUrl] = await file.getSignedUrl({
        action: 'read',
        expires: Date.now() + SIGNED_URL_TTL_MS,
      });
      return signedUrl;
    } catch (err) {
      if (isBucketMissingError(err)) {
        continue;
      }
      logError('[itinerary] failed to sign storage image url', err);
    }
  }
  return null;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

// Itineraries API: manage itineraries, details, and sharing helpers.
const router = Router();
router.use(bodyParser.json());
router.use(authenticate);

router.get('/images', async (req, res) => {
  const location = String(req.query.location || '').trim().toLowerCase();
  if (!location) {
    res.status(400).json({ error: 'location is required' });
    return;
  }
  const placeId = String(req.query.placeId || '').trim();
  const dayKey = String(req.query.day || 'any').trim().toLowerCase();
  const cacheId = `${placeId || location}|${dayKey}`;
  try {
    const db = getDb();
    const docRef = db.collection('imageCache').doc(cacheId);
    const doc = await docRef.get();
    const now = Date.now();
    if (doc.exists) {
      const data = doc.data() as ImageCacheEntry;
      if (data?.storagePath && data?.expiresAt && now < data.expiresAt) {
        const signed = await signStorageImage(data.storagePath, data.storageBucket);
        if (signed) {
          res.json({ url: signed, cached: true });
          return;
        }
      }
    }

    const googleSource = placeId ? await getPlacePhotoUrlByPlaceId(placeId) : null;
    const provider: 'google_places' | 'unsplash' = googleSource ? 'google_places' : 'unsplash';
    const sourceUrl = googleSource || (await fetchUnsplashImage(location));
    if (!sourceUrl) {
      res.json({ url: PLACEHOLDER_IMAGE, cached: false });
      return;
    }
    const persistedImage = await ensureStorageImage(provider, placeId || location, sourceUrl);
    if (!persistedImage) {
      res.json({ url: PLACEHOLDER_IMAGE, cached: false });
      return;
    }
    const expiresAt = now + ONE_YEAR_MS;
    await docRef.set(
      {
        sourceUrl,
        storagePath: persistedImage.storagePath,
        storageBucket: persistedImage.storageBucket,
        fetchedAt: now,
        expiresAt,
        provider,
      },
      { merge: true }
    );
    const signed = await signStorageImage(persistedImage.storagePath, persistedImage.storageBucket);
    res.json({ url: signed || PLACEHOLDER_IMAGE, cached: false });
  } catch (err) {
    logError('[itinerary] image cache error', err);
    res.json({ url: PLACEHOLDER_IMAGE, cached: false, error: 'fallback' });
  }
});

router.post('/', async (req, res) => {
  const apiKey = getEnvValue('OPENAI_API_KEY');
  if (!apiKey) {
    res.status(500).json({ error: 'OpenAI API key not configured on server' });
    return;
  }
  if (/^sk-?x+/i.test(apiKey)) {
    res.status(500).json({ error: 'OpenAI API key appears to be a placeholder. Update OPENAI_API_KEY on the server.' });
    return;
  }

  const { country, locations, days, budgetMin, budgetMax, traits, departureAirport, tripId, tripStyle } = req.body ?? {};
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

  const origin = departureAirport && String(departureAirport).trim();
  const styleLine = tripStyle && String(tripStyle).trim()
    ? `Traveler's requested vibe/style: ${String(tripStyle).trim()}`
    : '';

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

  const traitLines =
    Array.isArray(traits) && traits.length
      ? traits
          .map(
            (t: any) =>
              `- ${String(t.name ?? '').trim()} (level ${Number(t.level) || 1})${
                t.notes ? ` — ${String(t.notes).trim()}` : ''
              }`
          )
          .join('\n')
      : 'None provided';

  const prompt = [
    `You are a concise travel planner. Create a day-by-day itinerary.`,
    `Primary destination context: ${destinationSummary}`,
    selectedLocations.length ? `Selected trip locations: ${selectedLocations.join(', ')}` : '',
    `Trip length: ${daysNum} day(s)`,
    `Budget range: $${min} - $${max}`,
    origin ? `Departure airport: ${origin}` : '',
    styleLine,
    `Traveler traits/preferences (requesting user):`,
    traitLines,
    `Group members and their traits (consider everyone when planning shared activities):`,
    groupTraits.length
      ? groupTraits
          .map((g) => `- ${g.name}: ${g.traits.length ? g.traits.join(', ') : 'No traits provided'}`)
          .join('\n')
      : '- No group traits available',
    ``,
    `Rules:`,
    `- Return a short markdown-style itinerary with headings per day.`,
    `- Optimize sequence/logistics across all selected locations when more than one is provided.`,
    `- Include 2-3 activities per day, tailored to budget and traits.`,
    `- EVERY activity line MUST include a cost with a leading $ (estimate if needed). Do not omit costs.`,
    `- If a departure airport is provided, estimate a reasonable round-trip flight cost from that airport to the destination, state it explicitly, and treat it as a budget line item (round trip).`,
    `- Show a quick budget summary noting flight cost and remaining on-the-ground budget for activities/food/lodging.`,
    `- Mention rough budget cues (e.g., "budget lunch", "free museum day").`,
    `- Keep total response under 250 words.`,
  ].join('\n');

  try {
    const aiRes = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You write concise, actionable travel itineraries.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 500,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const data = aiRes.data as ChatCompletionResponse;
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      res.status(500).json({ error: 'No itinerary returned' });
      return;
    }

    res.json({ plan: content });
  } catch (err: any) {
    const detail = err.response?.data || err.message || String(err);
    logError(`[itinerary] OpenAI API error`, detail);
    res.status(500).json({ error: 'Failed to generate itinerary', detail });
  }
});

export default router;
