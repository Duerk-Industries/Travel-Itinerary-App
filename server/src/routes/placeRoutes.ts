import { Router } from 'express';
import { authenticate } from '../auth';
import { getPlaceDetails } from '../googlePlaces';
import { getLocationsByIds, searchLocations, upsertLocation } from '../db';
import { autocompletePlaces, getPlaceDetailsFromGoogle } from '../services/placeService';
import { searchCityOptions, searchCountryStateOptions } from '../services/locationServices';
import { getEnvValue } from '../env';

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
    for (const id of missingIds) {
      const details = await getPlaceDetailsFromGoogle(id);
      if (details) {
        const apiKey = getEnvValue('GOOGLE_PLACES_API_KEY');
        const locationData = {
          place_id: details.place_id,
          name: details.name,
          address: details.formatted_address,
          lat: details.geometry?.location?.lat,
          lng: details.geometry?.location?.lng,
          types: details.types,
          image_url: details.photos?.[0]?.photo_reference ? `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photoreference=${details.photos[0].photo_reference}&key=${apiKey}` : null
        };
        try {
          const saved = await upsertLocation(locationData);
          if (saved) results.push(saved as unknown as LocationResult);
        } catch (err) {
          console.error(`Failed to cache location ${id}`, err);
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

  const rawFieldMask = String(req.query.fieldMask || '').trim();
  const fieldMask = rawFieldMask ? rawFieldMask.split(',').map((field) => field.trim()).filter(Boolean) : undefined;
  const details = await getPlaceDetails(placeId, fieldMask);
  if (!details) {
    res.status(404).json({ error: 'Place details not found' });
    return;
  }
  res.json(details);
});

export default router;
