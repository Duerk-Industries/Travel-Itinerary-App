import { Router } from 'express';
import { authenticate } from '../auth';
import { getLocationsByIds, searchLocations } from '../db';
import { autocompletePlaces } from '../services/placeService';
import { getLocationOptionsByIds, searchCityOptions, searchCountryStateOptions } from '../services/locationServices';

interface LocationResult {
  id: string;
  place_id: string;
  name: string;
  address?: string;
  lat?: number;
  lng?: number;
  types?: string[];
  image_url?: string | null;
}

const isTransientNetworkError = (err: unknown): boolean => {
  const code = String((err as any)?.code ?? '').toUpperCase();
  return code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ECONNABORTED' || code === 'EAI_AGAIN';
};

const fallbackLocationNameFromId = (id: string): string => {
  const [kind, raw] = String(id).split(':', 2);
  const normalizedKind =
    kind === 'country' ? 'Country' : kind === 'state' ? 'State' : kind === 'city' ? 'City' : 'Location';
  return raw ? `${normalizedKind} ${raw}` : normalizedKind;
};

const router = Router();
router.use(authenticate);

router.get('/autocomplete', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (!q) {
    res.json([]);
    return;
  }
  const results = await autocompletePlaces(q);
  res.json(results);
});

router.get('/search', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const q = String(req.query.q ?? '').trim();
  if (!q) {
    res.json([]);
    return;
  }
  const rawTypes = String(req.query.types ?? '').trim();
  const types = rawTypes
    ? rawTypes
        .split(',')
        .map((item) => item.trim())
        .filter((item): item is 'country_region' | 'city' => item === 'country_region' || item === 'city')
    : undefined;
  const limit = Number(req.query.limit);
  const results = await searchLocations(userId, q, types, Number.isFinite(limit) ? limit : 15);
  res.json(results);
});

router.get('/location-options', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (!q) {
    res.json([]);
    return;
  }
  const kind = String(req.query.kind ?? 'country_state').trim();
  const limit = Number(req.query.limit);
  try {
    if (kind === 'city') {
      const countryIds = String(req.query.countryIds ?? '').split(',').map((item) => item.trim()).filter(Boolean);
      const stateIds = String(req.query.stateIds ?? '').split(',').map((item) => item.trim()).filter(Boolean);
      const results = await searchCityOptions(q, {
        countryIds,
        stateIds,
        limit: Number.isFinite(limit) ? limit : 10,
      });
      res.json(results);
      return;
    }
    const results = await searchCountryStateOptions(q, Number.isFinite(limit) ? limit : 10);
    res.json(results);
  } catch (err) {
    console.error('Failed to load location options from JSON storage', err);
    res.status(500).json({ error: 'Failed to load location options' });
  }
});

router.post('/batch', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids.map((id: unknown) => String(id ?? '').trim()).filter(Boolean) : [];
  if (!ids.length) {
    res.json([]);
    return;
  }
  
  const results = (await getLocationsByIds(userId, ids)) as unknown as LocationResult[];
  const foundIds = new Set(results.map((r) => r.place_id || r.id));
  const missingIds = ids.filter((id) => !foundIds.has(id));

  if (missingIds.length > 0) {
    const localIds = missingIds.filter((id) => id.startsWith('country:') || id.startsWith('state:') || id.startsWith('city:'));
    if (localIds.length) {
      try {
        const localOptions = await getLocationOptionsByIds(localIds);
        for (const option of localOptions) {
          results.push({
            id: option.id,
            place_id: option.id,
            name: option.name,
          });
        }
      } catch (err) {
        if (isTransientNetworkError(err)) {
          console.warn('Failed to resolve local location ids (transient network issue)');
        } else {
          console.error('Failed to resolve local location ids', err);
        }
        // Fallback to id-based labels so batch response remains usable.
        for (const id of localIds) {
          results.push({
            id,
            place_id: id,
            name: fallbackLocationNameFromId(id),
          });
        }
      }
    }
  }

  res.json(results);
});

router.get('/:placeId', async (req, res) => {
  const placeId = String(req.params.placeId || '').trim();
  if (!placeId) {
    res.status(400).json({ error: 'placeId is required' });
    return;
  }

  res.status(404).json({ error: 'Place details endpoint is temporarily unavailable' });
});

export default router;
