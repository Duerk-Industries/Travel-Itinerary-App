import { Router } from 'express';
import bodyParser from 'body-parser';
import { handleLogin } from '../auth';

// Auth routes for device-based auth tokens (non-web).
const router = Router();
router.use(bodyParser.json());

router.post('/email', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    res.status(400).json({ error: 'email is required' });
    return;
  }
  const result = await handleLogin(email, 'email');
  res.json(result);
});

router.post('/oauth', async (req, res) => {
  const { email, provider } = req.body;
  if (!email || !provider || !['google', 'apple'].includes(provider)) {
    res.status(400).json({ error: 'email and provider (google|apple) are required' });
    return;
  }
  const result = await handleLogin(email, provider as 'google' | 'apple');
  res.json(result);
});

export default router;
