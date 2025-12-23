import { Router } from 'express';
import bodyParser from 'body-parser';
import { authenticate } from '../auth';
import {
  createTrait,
  deleteTrait,
  listTraits,
  updateTrait,
  getUserDemographics,
  saveUserDemographics,
} from '../db';

const router = Router();
router.use(bodyParser.json());
router.use(authenticate);

router.get('/', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const traits = await listTraits(userId);
  res.json(traits);
});

router.post('/', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const { name, level, notes } = req.body ?? {};
  if (!name || !String(name).trim()) {
    res.status(400).json({ error: 'name is required' });
    return;
  }
  try {
    const trait = await createTrait(userId, String(name), level != null ? Number(level) : undefined, notes);
    res.status(201).json(trait);
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? 'Unable to create trait' });
  }
});

router.patch('/:id', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const { name, level, notes } = req.body ?? {};
  if (name !== undefined && !String(name).trim()) {
    res.status(400).json({ error: 'name cannot be empty' });
    return;
  }
  try {
    const updated = await updateTrait(userId, req.params.id, {
      name,
      level: level != null ? Number(level) : undefined,
      notes: notes === undefined ? undefined : notes,
    });
    res.json(updated);
  } catch (err: any) {
    const msg = err?.message ?? 'Unable to update trait';
    const status = msg === 'Trait not found' ? 404 : 400;
    res.status(status).json({ error: msg });
  }
});

router.delete('/:id', async (req, res) => {
  const userId = (req as any).user.userId as string;
  try {
    await deleteTrait(userId, req.params.id);
    res.status(204).send();
  } catch (err: any) {
    const msg = err?.message ?? 'Unable to delete trait';
    const status = msg === 'Trait not found' ? 404 : 400;
    res.status(status).json({ error: msg });
  }
});

router.get('/profile/demographics', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const data = await getUserDemographics(userId);
  res.json(data);
});

router.post('/profile/demographics', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const { age, gender } = req.body ?? {};
  const parsedAge = age != null ? Number(age) : null;
  const safeAge = parsedAge !== null && Number.isFinite(parsedAge) && parsedAge > 0 ? parsedAge : null;
  const safeGender =
    gender === 'female' || gender === 'male' || gender === 'nonbinary' || gender === 'prefer-not'
      ? gender
      : null;
  await saveUserDemographics(userId, safeAge, safeGender);
  res.status(204).send();
});

export default router;
