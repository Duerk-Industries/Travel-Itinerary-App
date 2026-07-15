import { Router, type Request, type Response, type NextFunction } from 'express';
import { authenticate, type TokenPayload } from '../auth';
import { getApiCacheSetting } from '../config/apiLimits';
import { createGetYourGuideDescriptor, resolveGetYourGuideRedirect } from '../services/getYourGuideAffiliateService';
import { HttpRateLimitExceededError, reserveRequestRateLimits } from '../services/httpRateLimitService';
import { incrementMetric } from '../metrics';
import { recordGetYourGuideClick } from '../services/getYourGuideObservability';

const router = Router();
const MAX_DESCRIPTOR_BODY_BYTES = 64 * 1024;

const setting = (name: string, fallback: number): number => {
  const configured = getApiCacheSetting('getYourGuide', name);
  return Number.isFinite(configured) && configured! > 0 ? Math.floor(configured!) : fallback;
};

const clientIdentity = (req: Request): string => `ip:${String(req.ip || req.socket.remoteAddress || 'unknown')}`;

const rateLimit = async (req: Request, name: string, identity: string, limit: number, windowMs: number): Promise<void> => {
  await reserveRequestRateLimits({ name, identities: [identity], limit, windowMs });
};

const rateLimitError = (err: unknown, res: Response): boolean => {
  if (!(err instanceof HttpRateLimitExceededError)) return false;
  res.setHeader('Retry-After', String(err.retryAfterSeconds));
  res.status(429).json({ error: 'RATE_LIMITED' });
  return true;
};

const unavailable = (res: Response): void => {
  // Keep provider outages/configuration failures intentionally generic so the
  // app can hide the CTA without exposing partner credentials or placeholders.
  res.status(404).json({ error: 'AFFILIATE_LINK_UNAVAILABLE' });
};

router.post('/getyourguide/descriptor', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  if (Number(req.headers['content-length'] ?? 0) > MAX_DESCRIPTOR_BODY_BYTES) {
    res.status(413).json({ error: 'REQUEST_TOO_LARGE' });
    return;
  }
  const userId = String((req as Request & { user?: TokenPayload }).user?.userId ?? '').trim();
  if (!userId) {
    unavailable(res);
    return;
  }
  try {
    await rateLimit(req, 'getyourguide_descriptor', `user:${userId}`, setting('redirectPerDayPerAccount', 300), 24 * 60 * 60 * 1000);
    const descriptor = await createGetYourGuideDescriptor(req.body);
    if (!descriptor) {
      unavailable(res);
      return;
    }
    res.json(descriptor);
  } catch (err) {
    if (rateLimitError(err, res)) return;
    next(err);
  }
});

router.get('/getyourguide', async (req: Request, res: Response, next: NextFunction) => {
  const token = typeof req.query.token === 'string' ? req.query.token : '';
  if (!token || token.length > 4096) {
    unavailable(res);
    return;
  }
  try {
    const identity = clientIdentity(req);
    await rateLimit(req, 'getyourguide_redirect_ip', identity, setting('redirectPerMinutePerIp', 60), 60 * 1000);
    await rateLimit(req, 'getyourguide_redirect_daily_ip', identity, setting('redirectPerDayPerAccount', 300), 24 * 60 * 60 * 1000);
    const redirectUrl = await resolveGetYourGuideRedirect(token);
    if (!redirectUrl) {
      unavailable(res);
      return;
    }
    if (req.header('X-Analytics-Consent')?.toLowerCase() === 'granted') {
      incrementMetric('getyourguide_affiliate_click', { kind: 'activity' });
      recordGetYourGuideClick();
    }
    res.redirect(302, redirectUrl);
  } catch (err) {
    if (rateLimitError(err, res)) return;
    next(err);
  }
});

export default router;
