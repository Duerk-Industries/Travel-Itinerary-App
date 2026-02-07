import { Router } from 'express';
import { authenticate } from '../auth';
import { getPlaceDetails } from '../googlePlaces';
import { getLocationsByIds, searchLocations } from '../db';

const router = Router();
router.use(authenticate);

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

router.post('/batch', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((id: unknown) => String(id ?? '').trim()).filter(Boolean) : [];
  if (!ids.length) {
    res.json([]);
    return;
  }
  const results = await getLocationsByIds(userId, ids);
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
