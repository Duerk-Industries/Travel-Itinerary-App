import { Router } from 'express';
import { authenticate } from '../auth';
import { blogMediaRepository } from '../blog/repository';

const router = Router();
router.use(authenticate);
router.get('/blog-storage', async (req: any, res) => {
  try { res.json(await blogMediaRepository().getStorageSummary(String(req.user.userId))); }
  catch (err) { res.status(500).json({ error: (err as Error).message }); }
});
router.get('/blog-storage/grace-media', async (req: any, res) => {
  try { res.json({ media: await blogMediaRepository().listGraceMedia(String(req.user.userId)) }); }
  catch (err) { res.status(500).json({ error: (err as Error).message }); }
});
export default router;
