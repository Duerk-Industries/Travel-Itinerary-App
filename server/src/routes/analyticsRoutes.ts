import { Router, type Request } from 'express';
import { authenticate, type TokenPayload } from '../auth';
import { ANALYTICS_LIMITS } from '../analytics/registry';
import { AnalyticsAdmissionError, ingestClientEvents } from '../analytics/ingestService';
import { logError } from '../logger';
import { HttpRateLimitExceededError, reserveAnalyticsIngestRateLimit } from '../services/httpRateLimitService';

/**
 * POST /api/analytics/events — optional product analytics ingest (analytics plan,
 * Phase 2). Authenticated only. Responds 403 with a code the client uses to stop
 * collecting (no retry loop on refusal), and per-event rejection reasons otherwise.
 */
const router = Router();
router.use(authenticate);

const hasPrivacySignal = (req: Request): boolean => req.get('Sec-GPC') === '1' || req.get('DNT') === '1';

router.post('/events', async (req, res) => {
  const user = (req as Request & { user?: TokenPayload }).user!;
  // The app-wide JSON parser allows 100 KB; analytics batches are capped lower.
  if (Buffer.byteLength(JSON.stringify(req.body ?? {})) > ANALYTICS_LIMITS.maxPayloadBytes) {
    res.status(413).json({ error: 'Batch too large', code: 'ANALYTICS_PAYLOAD_TOO_LARGE' });
    return;
  }
  try {
    await reserveAnalyticsIngestRateLimit(user.userId);
    const result = await ingestClientEvents({
      userId: user.userId,
      role: user.role,
      body: req.body,
      privacySignalActive: hasPrivacySignal(req),
    });
    res.json(result);
  } catch (err) {
    if (err instanceof AnalyticsAdmissionError) {
      res.status(err.code === 'ANALYTICS_INVALID_BATCH' ? 400 : 403).json({ error: err.message, code: err.code });
      return;
    }
    if (err instanceof HttpRateLimitExceededError) {
      res.set('Retry-After', String(err.retryAfterSeconds)).status(429).json({ error: err.message, code: 'ANALYTICS_RATE_LIMITED' });
      return;
    }
    logError('[analytics] ingest failed', err);
    res.status(500).json({ error: 'Failed to record analytics events' });
  }
});

export default router;
