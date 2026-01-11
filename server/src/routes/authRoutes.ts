import { Router } from 'express';
import bodyParser from 'body-parser';
import { handleLogin, createToken } from '../auth';
import { claimInvitesForUser, createWebUser, ensureDefaultGroupForUser } from '../db';
import { logError } from '../logger';

// Auth routes for device-based auth tokens (non-web).
const router = Router();
router.use(bodyParser.json());

const isInvalid = (value?: unknown, min = 2): boolean => {
  return typeof value !== 'string' || value.trim().length < min;
};

router.post('/register', async (req, res) => {
  const { firstName, lastName, email, password, passwordConfirm } = req.body ?? {};
  const confirmValue = typeof passwordConfirm === 'string' ? passwordConfirm : password;

  if (isInvalid(firstName) || isInvalid(lastName) || isInvalid(email, 5) || isInvalid(password, 6)) {
    res.status(400).json({ error: 'firstName, lastName, email (min 5 chars), and password (min 6 chars) are required' });
    return;
  }

  if (password !== confirmValue) {
    res.status(400).json({ error: 'Passwords do not match' });
    return;
  }

  try {
    const user = await createWebUser(firstName.trim(), lastName.trim(), email.trim().toLowerCase(), password.trim());
    await ensureDefaultGroupForUser(user.id, user.email);
    await claimInvitesForUser(user.email, user.id);
    const token = createToken({ userId: user.id, email: user.email, provider: 'email' });
    res.status(201).json({ message: 'User created', token, user });
  } catch (err: any) {
    if (err?.code === 'USER_EXISTS') {
      res.status(409).json({ error: 'User already exists' });
      return;
    }
    logError('Failed to create user', err);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

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
