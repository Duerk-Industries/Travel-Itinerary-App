import { Router } from 'express';
import bodyParser from 'body-parser';
import { authenticate, createToken } from '../auth';
import {
  deleteWebUserAndCleanup,
  acceptFamilyRelationship,
  createFamilyRelationship,
  listFamilyRelationships,
  rejectFamilyRelationship,
  removeFamilyRelationship,
  getWebUserProfile,
  updateWebUserPassword,
  updateFamilyProfile,
  updateWebUserProfile,
} from '../db';

// Account management (profile, password, deletion) for authenticated web users.
const router = Router();
router.use(bodyParser.json());
router.use(authenticate);

router.get('/', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const profile = await getWebUserProfile(userId);
  if (!profile) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json(profile);
});

router.patch('/profile', async (req, res) => {
  const user = (req as any).user as { userId: string; email: string };
  const { firstName, lastName, email } = req.body ?? {};
  if (!firstName && !lastName && !email) {
    res.status(400).json({ error: 'At least one field is required' });
    return;
  }
  try {
    const updated = await updateWebUserProfile(user.userId, {
      firstName: typeof firstName === 'string' ? firstName.trim() : undefined,
      lastName: typeof lastName === 'string' ? lastName.trim() : undefined,
      email: typeof email === 'string' ? email.trim().toLowerCase() : undefined,
    });
    const token = createToken({ userId: updated.id, email: updated.email, provider: 'email' });
    res.json({ user: updated, token });
  } catch (err: any) {
    if (err?.code === 'EMAIL_TAKEN') {
      res.status(409).json({ error: 'Email already in use' });
      return;
    }
    res.status(400).json({ error: (err as Error).message });
  }
});

router.patch('/password', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const { currentPassword, newPassword, newPasswordConfirm } = req.body ?? {};
  if (!currentPassword || !newPassword || !newPasswordConfirm) {
    res.status(400).json({ error: 'currentPassword, newPassword, and newPasswordConfirm are required' });
    return;
  }
  if (String(newPassword).length < 6) {
    res.status(400).json({ error: 'New password must be at least 6 characters' });
    return;
  }
  if (newPassword !== newPasswordConfirm) {
    res.status(400).json({ error: 'Passwords do not match' });
    return;
  }
  try {
    await updateWebUserPassword(userId, currentPassword, newPassword);
    res.json({ message: 'Password updated' });
  } catch (err: any) {
    if (err?.code === 'INVALID_PASSWORD') {
      res.status(401).json({ error: 'Current password is incorrect' });
      return;
    }
    res.status(400).json({ error: (err as Error).message });
  }
});

router.get('/family', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const relationships = await listFamilyRelationships(userId);
  res.json(relationships);
});

router.post('/family', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const { givenName, middleName, familyName, email, relationship } = req.body ?? {};
  try {
    await createFamilyRelationship(userId, { givenName, middleName, familyName, email, relationship });
    const relationships = await listFamilyRelationships(userId);
    res.status(201).json(relationships);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/family/:id/accept', async (req, res) => {
  const userId = (req as any).user.userId as string;
  try {
    await acceptFamilyRelationship(userId, req.params.id);
    const relationships = await listFamilyRelationships(userId);
    res.json(relationships);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/family/:id/reject', async (req, res) => {
  const userId = (req as any).user.userId as string;
  try {
    await rejectFamilyRelationship(userId, req.params.id);
    const relationships = await listFamilyRelationships(userId);
    res.json(relationships);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.patch('/family/:id/profile', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const { givenName, middleName, familyName, email, relationship } = req.body ?? {};
  try {
    await updateFamilyProfile(userId, req.params.id, { givenName, middleName, familyName, email, relationship });
    const relationships = await listFamilyRelationships(userId);
    res.json(relationships);
  } catch (err: any) {
    if (err?.code === 'EMAIL_TAKEN') {
      res.status(409).json({ error: 'Email already in use' });
      return;
    }
    res.status(400).json({ error: err.message });
  }
});

router.delete('/family/:id', async (req, res) => {
  const userId = (req as any).user.userId as string;
  try {
    await removeFamilyRelationship(userId, req.params.id);
    const relationships = await listFamilyRelationships(userId);
    res.json(relationships);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/', async (req, res) => {
  const userId = (req as any).user.userId as string;
  try {
    await deleteWebUserAndCleanup(userId);
    res.status(204).send();
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

export default router;
