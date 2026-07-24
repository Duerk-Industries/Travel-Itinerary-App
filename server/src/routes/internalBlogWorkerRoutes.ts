import { Router } from 'express';
import bodyParser from 'body-parser';
import { getEnvValue } from '../env';
import { processMediaUpload } from '../services/blogMediaProcessingService';
import { logError, logInfo } from '../logger';

const router = Router();
router.use(bodyParser.json());

const authenticateWorker = (req: any, res: any, next: any) => {
  const configured = getEnvValue('INGESTION_WORKER_SHARED_SECRET');
  if (!configured) {
    logError('[blog][worker] rejected request because worker secret is not configured');
    res.status(503).json({ error: 'Worker secret not configured.' });
    return;
  }
  const provided = String(req.header('X-Ingestion-Worker-Secret') ?? '');
  if (!provided || provided !== configured) {
    logError('[blog][worker] rejected request due to invalid shared secret');
    res.status(403).json({ error: 'Forbidden.' });
    return;
  }
  next();
};

router.post('/process-media/:userId/:assetId', authenticateWorker, async (req, res) => {
  const { userId, assetId } = req.params;
  try {
    logInfo(`[blog][worker] accepted processing for userId=${userId} assetId=${assetId}`);
    res.status(202).json({ accepted: true });

    // Asynchronous processing
    setImmediate(() => {
      void processMediaUpload(userId, assetId).catch((err) => {
        logError(`[blog][worker] background processing failed for assetId=${assetId}`, err);
      });
    });
  } catch (err) {
    logError('[blog][worker] failed to enqueue processing', err);
    res.status(500).json({ error: 'Failed to enqueue processing' });
  }
});

export default router;
