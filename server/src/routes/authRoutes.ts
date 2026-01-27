import { Router } from 'express';
import bodyParser from 'body-parser';
import { handleLogin, createToken } from '../auth';
import { claimInvitesForUser, createWebUser, ensureDefaultGroupForUser } from '../db';
import { logError, logInfo } from '../logger';

// Auth routes for device-based auth tokens (non-web).
const router = Router();
router.use(bodyParser.json());

const isInvalid = (value?: unknown, min = 2): boolean => {
  return typeof value !== 'string' || value.trim().length < min;
};

router.post('/register', async (req, res) => {
  const { firstName, lastName, email, password, passwordConfirm } = req.body ?? {};
  const confirmValue = typeof passwordConfirm === 'string' ? passwordConfirm : password;

  // DEBUG: auth logging (remove later)
  logInfo(`[auth] register attempt for ${String(email ?? '').trim().toLowerCase() || 'unknown'}`);
  if (isInvalid(firstName) || isInvalid(lastName) || isInvalid(email, 5) || isInvalid(password, 6)) {
    // DEBUG: auth logging (remove later)
    logInfo('[auth] register rejected: invalid payload');
    res.status(400).json({ error: 'firstName, lastName, email (min 5 chars), and password (min 6 chars) are required' });
    return;
  }

  if (password !== confirmValue) {
    // DEBUG: auth logging (remove later)
    logInfo('[auth] register rejected: password mismatch');
    res.status(400).json({ error: 'Passwords do not match' });
    return;
  }

  try {
    const user = await createWebUser(firstName.trim(), lastName.trim(), email.trim().toLowerCase(), password.trim());
    await ensureDefaultGroupForUser(user.id, user.email);
    await claimInvitesForUser(user.email, user.id);
    const token = createToken({ userId: user.id, email: user.email, provider: 'email' });
    // DEBUG: auth logging (remove later)
    logInfo(`[auth] register success for ${user.email}`);
    res.status(201).json({ message: 'User created', token, user });
  } catch (err: any) {
    if (err?.code === 'USER_EXISTS') {
      // DEBUG: auth logging (remove later)
      logInfo('[auth] register failed: user exists');
      res.status(409).json({ error: 'User already exists' });
      return;
    }
    // DEBUG: auth logging (remove later)
    logError('Register failed with unexpected error', err);
    logError('Failed to create user', err);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

router.post('/email', async (req, res) => {
  const { email } = req.body;
  if (!email) {
    // DEBUG: auth logging (remove later)
    logInfo('[auth] email login rejected: missing email');
    res.status(400).json({ error: 'email is required' });
    return;
  }
  // DEBUG: auth logging (remove later)
  logInfo(`[auth] email login for ${String(email).trim().toLowerCase()}`);
  const result = await handleLogin(email, 'email');
  res.json(result);
});

router.post('/oauth', async (req, res) => {
  const { email, provider } = req.body;
  if (!email || !provider || !['google', 'apple'].includes(provider)) {
    // DEBUG: auth logging (remove later)
    logInfo('[auth] oauth rejected: invalid payload');
    res.status(400).json({ error: 'email and provider (google|apple) are required' });
    return;
  }
  // DEBUG: auth logging (remove later)
  logInfo(`[auth] oauth login for ${String(email).trim().toLowerCase()} via ${provider}`);
  const result = await handleLogin(email, provider as 'google' | 'apple');
  res.json(result);
});

export default router;
