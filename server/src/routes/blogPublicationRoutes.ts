import { Router } from 'express';
import { authenticate } from '../auth';
import { ensureUserInTrip, loadBlogVisibilityContext } from '../db';
import { isFeatureEnabled } from '../services/entitlementService';
import { blogMediaRepository } from '../blog/repository';
import { BlogVisibilityError, changeBlogPrivacy, evaluateBlogVisibility, releaseBlogEarly, synchronizeBlogVisibility } from '../services/blogVisibilityService';
import { ensureBlogPublicNotice } from '../services/blogVisibilityNoticeService';
import { loadPublicBlogDocument } from './publicBlogRoutes';
import { ApiLimitExceededError, reserveApiUsageOrThrow } from '../apis/usageLimiter';

const router = Router();
const errorResponse = (res: import('express').Response, error: unknown) => {
  const known = error instanceof BlogVisibilityError;
  res.status(known ? error.status : error instanceof ApiLimitExceededError ? 429 : 400).json({ error: (error as Error).message, ...(known ? { code: error.code } : {}) });
};

// Kept for callers of the old worker helper; opening the private blog no longer calls it.
export const autoPublishBlogIfEligible = async (tripId: string, actorUserId: string, _options: { force?: boolean } = {}): Promise<boolean> => {
  if (!(await ensureUserInTrip(tripId, actorUserId))) return false;
  return synchronizeBlogVisibility(tripId);
};
export const revokePublicBlog = async (tripId: string, userId: string): Promise<boolean> => {
  await changeBlogPrivacy(tripId, userId, { optOut: true });
  return true;
};

router.use('/:tripId/blog/publication', authenticate, async (req: any, res, next) => {
  try {
    res.setHeader('Cache-Control', 'private, no-store');
    if (!(await isFeatureEnabled('trip_blog_public_sharing'))) return void res.status(404).json({ error: 'Public sharing is not enabled' });
    if (!(await ensureUserInTrip(req.params.tripId, String(req.user.userId)))) return void res.status(403).json({ error: 'Not authorized' });
    next();
  } catch (error) { errorResponse(res, error); }
});

router.get('/:tripId/blog/publication/readiness', async (req: any, res) => {
  try {
    const tripId = String(req.params.tripId), userId = String(req.user.userId);
    const [result, context] = await Promise.all([evaluateBlogVisibility(tripId), loadBlogVisibilityContext(tripId)]);
    const self = context?.members.find(m => m.userId === userId);
    let issues: Array<{ assetId: string; dayDate: string }> = [];
    if (await isFeatureEnabled('trip_blog_alt_text')) {
      // Optional accessibility advice never prevents publication, even when its lookup fails.
      try {
        await reserveApiUsageOrThrow({ provider: 'TRIP_BLOG_SOCIAL_API', caller: 'BLOG_PUBLICATION_READINESS_READ', requireConfiguredLimit: true });
        await reserveApiUsageOrThrow({ provider: 'TRIP_BLOG_SOCIAL_STORAGE', caller: 'DATABASE_READ_UNIT', requireConfiguredLimit: true });
        issues = await blogMediaRepository().listPublicationAccessibilityIssues(userId, tripId);
      } catch { /* optional reminder; never a publication gate */ }
    }
    res.json({ ...result, state: result.isPublic ? 'public' : 'private', optedOut: result.optedOutTravelers.length > 0,
      selfOptedOut: self?.optOut === true, selfPrivateDefault: self?.publicByDefault === false, selfOptedIn: self?.optIn === true,
      selfMissingBirthDate: !self?.dateOfBirth, goLiveDate: result.startDate,
      privateDefaultCount: context?.members.filter(m => !m.publicByDefault && !m.optIn).length ?? 0,
      altTextIssues: issues.slice(0, 50), altTextIssueCount: issues.length,
      reminders: issues.length ? ['PHOTO_ALT_TEXT_MISSING'] : [], ready: !result.reasons.some(r => !['TRIP_NOT_STARTED', 'START_DATE_NOT_SET'].includes(r)) });
  } catch (error) { errorResponse(res, error); }
});

router.get('/:tripId/blog/publication/status', async (req: any, res) => {
  try { const result = await evaluateBlogVisibility(req.params.tripId); res.json({ ...result, epoch: null, state: result.isPublic ? 'public' : 'private', userDecision: null, pendingCount: 0 }); }
  catch (error) { errorResponse(res, error); }
});

// Opening the blog calls this. A traveler who joined after the blog went public gets the "now public" notice once.
router.post('/:tripId/blog/publication/notice', async (req: any, res) => {
  try { res.json({ sent: await ensureBlogPublicNotice(req.params.tripId, String(req.user.userId)) }); }
  catch (error) { errorResponse(res, error); }
});

router.patch('/:tripId/blog/publication/privacy', async (req: any, res) => {
  try {
    const body = req.body ?? {};
    if (Object.keys(body).some(k => !['optOut', 'optIn'].includes(k)) || !Object.keys(body).length || Object.values(body).some(v => typeof v !== 'boolean')) {
      return void res.status(400).json({ error: 'Send optOut and/or optIn booleans for your own account only.' });
    }
    res.json(await changeBlogPrivacy(req.params.tripId, String(req.user.userId), body));
  } catch (error) { errorResponse(res, error); }
});

// The former request endpoint now performs early release without creating a consent request.
router.post('/:tripId/blog/publication/request', async (req: any, res) => {
  try { const result = await releaseBlogEarly(req.params.tripId, String(req.user.userId)); res.status(201).json({ ...result, state: 'public', pendingCount: 0 }); }
  catch (error) { errorResponse(res, error); }
});
router.post('/:tripId/blog/publication/:epoch/consent', (_req, res) => { res.status(410).json({ error: 'Publication consent requests have been retired. Use your trip privacy settings.' }); });
router.post('/:tripId/blog/publication/revoke', async (req: any, res) => {
  try { await changeBlogPrivacy(req.params.tripId, String(req.user.userId), { optOut: true }); res.status(204).end(); }
  catch (error) { errorResponse(res, error); }
});

router.get('/:tripId/blog/preview', authenticate, async (req: any, res) => {
  try {
    if (!(await isFeatureEnabled('trip_blog'))) return void res.status(404).json({ error: 'Trip blog is not enabled' });
    if (!(await ensureUserInTrip(req.params.tripId, String(req.user.userId)))) return void res.status(403).json({ error: 'Not authorized' });
    await reserveApiUsageOrThrow({ provider: 'TRIP_BLOG_SOCIAL_API', caller: 'BLOG_DOCUMENT_READ', requireConfiguredLimit: true });
    await reserveApiUsageOrThrow({ provider: 'TRIP_BLOG_SOCIAL_STORAGE', caller: 'DATABASE_READ_UNIT', units: 8, requireConfiguredLimit: true });
    const document = await loadPublicBlogDocument(String(req.params.tripId));
    if (!document) return void res.status(404).json({ error: 'Trip blog not found' });
    res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('X-Robots-Tag', 'noindex'); res.json(document);
  } catch (error) { errorResponse(res, error); }
});
export default router;
