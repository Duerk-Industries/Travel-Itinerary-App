import { Router } from 'express';
import { authenticate } from '../auth';
import { getApiCacheSetting } from '../config/apiLimits';
import { reserveApiUsageOrThrow, ApiLimitExceededError } from '../apis/usageLimiter';
import { recordProviderRequestCost } from '../apis/providerBudgeting';
import { getEnvValue } from '../env';
import { createTtlCache } from '../utils/ttlCache';
import { logError } from '../logger';

const STATIC_MAP_CALLER = 'STATIC_MAP_PREVIEW';
const GOOGLE_STATIC_MAPS_URL = 'https://maps.googleapis.com/maps/api/staticmap';
const DEFAULT_CACHE_TTL_MINUTES = 24 * 60;

type CachedMap = { body: Buffer; contentType: string };

const getCacheTtlMs = (): number => {
  const configured = getApiCacheSetting('googleStaticMaps', 'cacheTtlMinutes');
  const minutes = Number(configured ?? DEFAULT_CACHE_TTL_MINUTES);
  return (Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_CACHE_TTL_MINUTES) * 60 * 1000;
};

const mapCache = createTtlCache<CachedMap>({
  defaultTtlMs: getCacheTtlMs(),
  metricName: 'google_static_maps',
});

export const clearStaticMapCacheForTests = (): void => mapCache.clear();

const router = Router();
router.use(authenticate);

router.get('/static', async (req, res) => {
  const address = String(req.query.address ?? '').trim();
  if (!address || address.length > 500) {
    res.status(400).json({ error: 'address is required and must be at most 500 characters' });
    return;
  }

  const cacheKey = address.toLowerCase().replace(/\s+/g, ' ');
  try {
    const cached = await mapCache.getOrFetch(
      cacheKey,
      async () => {
        const apiKey = getEnvValue('GOOGLE_STATIC_MAPS_API_KEY') || getEnvValue('GOOGLE_MAPS_API_KEY');
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
    if (err instanceof ApiLimitExceededError) {
      res.status(429).json({ error: err.message });
      return;
    }
    const statusCode = Number((err as any)?.statusCode);
    if (statusCode === 503) {
      res.status(503).json({ error: (err as Error).message });
      return;
    }
    logError('[static-maps] proxy request failed', err);
    res.status(502).json({ error: 'Unable to load map preview' });
  }
});

export default router;
