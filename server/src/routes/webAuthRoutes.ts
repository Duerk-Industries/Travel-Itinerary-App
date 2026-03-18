import { Router } from 'express';
import bodyParser from 'body-parser';
import {
  claimInvitesForUser,
  consumeUserEmailVerificationToken,
  consumeEmailVerificationToken,
  createEmailVerification,
  createWebUser,
  deleteUserRecord,
  ensureDefaultGroupForUser,
  findUserByIdentifier,
  getPendingEmailVerification,
  getUserRole,
  ensureCurrentUserTier,
  markEmailVerificationUsed,
  markAccountEmailVerified,
  markUserEmailVerificationUsed,
  markUserEmailVerified,
  recordWebUserLogin,
  verifyWebUserCredentials,
} from '../db';
import { createToken } from '../auth';
import { logError, logInfo } from '../logger';
import { sendVerificationEmailBestEffort } from '../mailer';
import { getAuthFlag } from '../config/authFlags';
import { ensureAdminBootstrap, getSeededTierForEmail } from '../services/entitlementService';

// Web auth routes for email/password login/registration.
const router = Router();
router.use(bodyParser.json());

const isInvalid = (value?: unknown, min = 2): boolean => {
  return typeof value !== 'string' || value.trim().length < min;
};

router.get('/register', (req, res) => {
  // This route is sometimes hit by browsers on startup; it's not a real action.
  res.status(200).send('GET /register is not an action.');
});

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
    await ensureCurrentUserTier(user.id, getSeededTierForEmail(user.email));
    if (user.emailVerified) {
      await ensureDefaultGroupForUser(user.id, user.email);
      await claimInvitesForUser(user.email, user.id);
      const { firstLogin } = await recordWebUserLogin(user.id);
      await ensureAdminBootstrap(user.id, user.email);
      const role = await getUserRole(user.id);
      const token = createToken({ userId: user.id, email: user.email, provider: 'email', role });
      res.status(201).json({ message: 'Account created', token, user, firstLogin });
      return;
    }
    const verification = await createEmailVerification(user.id);
    await sendVerificationEmailBestEffort(user.email, verification.token);
    res.status(201).json({ message: 'Verification required. Check your email to confirm your account.', verificationRequired: true });
  } catch (err: any) {
    if (err?.code === 'USER_EXISTS') {
      res.status(409).json({ error: 'User already exists' });
      return;
    }
    const message = (err as Error)?.message ?? '';
    const unavailable =
      (err as any)?.code === 'UNAVAILABLE' ||
      (err as any)?.code === 14 ||
      /UNAVAILABLE/i.test(message) ||
      /ECONNREFUSED/i.test(message);
    if (unavailable) {
      logError('Registration datastore unavailable', err);
      res.status(503).json({ error: 'Registration temporarily unavailable. Please try again.' });
      return;
    }
    logError('Failed to create user', err);
    if (process.env.NODE_ENV === 'test') {
      res.status(500).json({ error: 'Failed to create user', details: (err as Error)?.message });
      return;
    }
    res.status(500).json({ error: 'Failed to create user' });
  }
});

router.post('/resend-confirmation', async (req, res) => {
  const identifier = String(req.body?.identifier ?? req.body?.email ?? '').trim().toLowerCase();
  if (!identifier) {
    res.status(400).json({ error: 'identifier is required' });
    return;
  }
  try {
    const user = await findUserByIdentifier(identifier);
    if (user && user.emailVerified) {
      res.json({ message: 'This account is already confirmed.' });
      return;
    }
    if (user) {
      const verification = await createEmailVerification(user.id);
      await sendVerificationEmailBestEffort(user.email, verification.token);
    }
    res.json({ message: 'If an account exists for this email, a confirmation link has been sent.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to resend confirmation email.' });
  }
});

router.post('/login', async (req, res) => {
  const { identifier, email, password } = req.body ?? {};
  const loginIdentifier = String(identifier ?? email ?? '').trim().toLowerCase();
  const usernameEnabled = getAuthFlag('usernameLoginEnabled');

  // TEMPORARY: auth logging (remove later)
  logInfo(`[web-auth] login attempt for ${loginIdentifier || 'unknown'}`);
  if (isInvalid(loginIdentifier, 2) || isInvalid(password, 6)) {
    // TEMPORARY: auth logging (remove later)
    logInfo('[web-auth] login rejected: invalid payload');
    res.status(400).json({ error: 'identifier and password (min 6 chars) are required' });
    return;
  }
  if (!usernameEnabled && !loginIdentifier.includes('@')) {
    res.status(401).json({ error: 'Invalid email/username or password' });
    return;
  }

  try {
    const user = await verifyWebUserCredentials(loginIdentifier, password.trim());
    if (!user) {
      // TEMPORARY: auth logging (remove later)
      logInfo('[web-auth] login failed: invalid credentials');
      res.status(401).json({ error: 'Invalid email/username or password' });
      return;
    }
    if (!user.emailVerified) {
      const pending = await getPendingEmailVerification(user.id);
      if (pending && new Date(pending.expiresAt).getTime() < Date.now()) {
        await deleteUserRecord(user.id);
        res.status(410).json({ error: 'Confirmation link expired. Account deleted; please register again.' });
        return;
      }
      res.status(403).json({ error: 'Please confirm your email address before logging in.' });
      return;
    }
    await ensureDefaultGroupForUser(user.id, user.email);
    await ensureCurrentUserTier(user.id, getSeededTierForEmail(user.email));
    await claimInvitesForUser(user.email, user.id);
    const { firstLogin } = await recordWebUserLogin(user.id);
    await ensureAdminBootstrap(user.id, user.email);
    const role = await getUserRole(user.id);
    const token = createToken({ userId: user.id, email: user.email, provider: 'email', role });
    // TEMPORARY: auth logging (remove later)
    logInfo(`[web-auth] login success for ${user.email}`);
    res.json({ message: 'Login successful', token, user, firstLogin });
  } catch (err) {
    const message = (err as Error)?.message ?? '';
    const unavailable =
      (err as any)?.code === 'UNAVAILABLE' ||
      (err as any)?.code === 14 ||
      /UNAVAILABLE/i.test(message) ||
      /ECONNREFUSED/i.test(message);
    if (unavailable) {
      logError('Login datastore unavailable', err);
      res.status(503).json({ error: 'Login temporarily unavailable. Please try again.' });
      return;
    }
    // TEMPORARY: auth logging (remove later)
    logError('Login failed with unexpected error', err);
    logError('Failed to login', err);
    res.status(500).json({ error: 'Failed to login' });
  }
});

router.get('/confirm', async (req, res) => {
  const token = String(req.query.token ?? '').trim();
  if (!token) {
    res.status(400).json({ error: 'token is required' });
    return;
  }
  try {
    const verification = await consumeEmailVerificationToken(token);
    if (!verification) {
      res.status(400).json({ error: 'Invalid or expired confirmation link.' });
      return;
    }
    const expiresAt = new Date(verification.expiresAt).getTime();
    if (expiresAt < Date.now()) {
      await markEmailVerificationUsed(verification.id);
      await deleteUserRecord(verification.userId);
      res.status(410).json({ error: 'Confirmation link expired. Account deleted; please register again.' });
      return;
    }
    await markUserEmailVerified(verification.userId);
    await markEmailVerificationUsed(verification.id);
    await ensureDefaultGroupForUser(verification.userId, verification.email);
    await ensureCurrentUserTier(verification.userId, getSeededTierForEmail(verification.email));
    await claimInvitesForUser(verification.email, verification.userId);
    await ensureAdminBootstrap(verification.userId, verification.email);
    res.json({ message: 'Email confirmed. You can now log in.' });
  } catch (err) {
    logError('Failed to confirm email', err);
    res.status(500).json({ error: 'Failed to confirm email' });
  }
});

router.get('/confirm-email', async (req, res) => {
  const token = String(req.query.token ?? '').trim();
  if (!token) {
    res.status(400).json({ error: 'token is required' });
    return;
  }
  if (!getAuthFlag('multiEmailEnabled')) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  try {
    const verification = await consumeUserEmailVerificationToken(token);
    if (!verification) {
      res.status(400).json({ error: 'Invalid or expired confirmation link.' });
      return;
    }
    const expiresAt = new Date(verification.expiresAt).getTime();
    if (expiresAt < Date.now()) {
      await markUserEmailVerificationUsed(verification.id);
      res.status(410).json({ error: 'Confirmation link expired.' });
      return;
    }
    await markAccountEmailVerified(verification.userId, verification.email);
    await markUserEmailVerificationUsed(verification.id);
    res.json({ message: 'Email confirmed.' });
  } catch (err) {
    logError('Failed to confirm secondary email', err);
    res.status(500).json({ error: 'Failed to confirm email' });
  }
});

router.get('/features', (_req, res) => {
  res.json({
    usernameLoginEnabled: getAuthFlag('usernameLoginEnabled'),
    multiEmailEnabled: getAuthFlag('multiEmailEnabled'),
    appleOAuthEnabled: getAuthFlag('appleOAuthEnabled'),
    uiProviderButtonsEnabled: getAuthFlag('uiProviderButtonsEnabled'),
  });
});

export default router;
