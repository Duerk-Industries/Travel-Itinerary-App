import { Router } from 'express';
import bodyParser from 'body-parser';
import { claimInvitesForUser, createWebUser, ensureDefaultGroupForUser, verifyWebUserCredentials } from '../db';
import { createToken } from '../auth';

const router = Router();
router.use(bodyParser.json());

const isInvalid = (value?: unknown, min = 2): boolean => {
  return typeof value !== 'string' || value.trim().length < min;
};

router.post('/register', async (req, res) => {
  const { firstName, lastName, email, password } = req.body ?? {};

  if (isInvalid(firstName) || isInvalid(lastName) || isInvalid(email, 5) || isInvalid(password, 6)) {
    res.status(400).json({ error: 'firstName, lastName, email (min 5 chars), and password (min 6 chars) are required' });
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
    console.error('Failed to create user', err);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body ?? {};

  if (isInvalid(email, 5) || isInvalid(password, 6)) {
    res.status(400).json({ error: 'email and password (min 6 chars) are required' });
    return;
  }

  try {
    const user = await verifyWebUserCredentials(email.trim().toLowerCase(), password.trim());
    if (!user) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }
    await ensureDefaultGroupForUser(user.id, user.email);
    await claimInvitesForUser(user.email, user.id);
    const token = createToken({ userId: user.id, email: user.email, provider: 'email' });
    res.json({ message: 'Login successful', token, user });
  } catch (err) {
    console.error('Failed to login', err);
    res.status(500).json({ error: 'Failed to login' });
  }
});

export default router;
