import { Router } from 'express';
import { authenticate } from '../auth';
import { getPlaceDetails } from '../googlePlaces';

const router = Router();
router.use(authenticate);

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
