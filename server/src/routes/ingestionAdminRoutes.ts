import { Router } from 'express';
import { getIngestionObservabilitySnapshot } from '../ingestion/shared/repository';
import { isFeatureEnabled } from '../services/entitlementService';
import { INGESTION_FEATURE_FLAGS } from '../ingestion/config';

const router = Router();

router.get('/metrics', async (_req, res) => {
  if (!(await isFeatureEnabled(INGESTION_FEATURE_FLAGS.adminObservability))) {
    res.status(403).json({ error: 'Ingestion observability is currently disabled.' });
    return;
  }
  const snapshot = await getIngestionObservabilitySnapshot();
  res.json(snapshot);
});

export default router;
