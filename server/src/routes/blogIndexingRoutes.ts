import { Router } from 'express';
import { authenticate } from '../auth';
import { isFeatureEnabled } from '../services/entitlementService';
import { ensureUserInTrip, getCurrentDbProvider } from '../db';
import { queryBlog } from '../db.postgres';
import { setBlogIndexingFirebase } from '../blog/firebasePublicationRepository';

const router = Router();
router.put('/:tripId/blog/indexing', authenticate, async (req: any, res) => {
  if (!(await isFeatureEnabled('trip_blog_public_indexing'))) return res.status(404).json({ error: 'Public indexing is not enabled' });
  if (!(await ensureUserInTrip(req.params.tripId, String(req.user.userId)))) return res.status(403).json({ error: 'Not authorized' });
  if (getCurrentDbProvider() === 'firebase') await setBlogIndexingFirebase(req.params.tripId, String(req.user.userId), req.body?.enabled === true);
  else await queryBlog('UPDATE trip_blogs SET indexing_enabled = $2, updated_at = NOW() WHERE trip_id = $1', [req.params.tripId, req.body?.enabled === true]);
  res.status(204).end();
});
export default router;
