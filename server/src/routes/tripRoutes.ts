import { Router } from 'express';
import bodyParser from 'body-parser';
import { authenticate } from '../auth';
import { createFellowTraveler, createTrip, createTripWithGroupAndMembers, deleteTrip, listTrips, searchTripContacts, updateTripDetails, updateTripGroup } from '../db';

// Trips API: create/list/delete trips for the authenticated user.
const router = Router();
router.use(bodyParser.json());
router.use(authenticate);

router.get('/', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const trips = await listTrips(userId);
  res.json(trips);
});

router.get('/participants/search', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const q = String(req.query.q ?? '').trim();
  if (!q) {
    res.json([]);
    return;
  }
  const results = await searchTripContacts(userId, q);
  res.json(results);
});

router.post('/', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const { name, groupId, description, destination, startDate, endDate, startMonth, startYear, durationDays } = req.body ?? {};
  if (!name || !groupId) {
    res.status(400).json({ error: 'name and groupId are required' });
    return;
  }
  try {
    const trip = await createTrip(userId, groupId, name.trim(), {
      description: typeof description === 'string' ? description.trim() || null : null,
      destination: typeof destination === 'string' ? destination.trim() || null : null,
      startDate: typeof startDate === 'string' ? startDate : null,
      endDate: typeof endDate === 'string' ? endDate : null,
      startMonth: Number.isFinite(Number(startMonth)) ? Number(startMonth) : null,
      startYear: Number.isFinite(Number(startYear)) ? Number(startYear) : null,
      durationDays: Number.isFinite(Number(durationDays)) ? Number(durationDays) : null,
    });
    res.status(201).json(trip);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.post('/wizard', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const { name, description, destination, startDate, endDate, startMonth, startYear, durationDays, participants } = req.body ?? {};
  if (!name || !String(name).trim()) {
    res.status(400).json({ error: 'Trip name is required' });
    return;
  }
  const memberInputs = Array.isArray(participants) ? participants : [];
  for (const p of memberInputs) {
    if (!p?.firstName || !p?.lastName) {
      res.status(400).json({ error: 'Each participant needs a first and last name' });
      return;
    }
  }
  const emails = memberInputs
    .map((p) => String(p.email ?? '').trim().toLowerCase())
    .filter(Boolean);
  const unique = new Set(emails);
  if (unique.size !== emails.length) {
    res.status(400).json({ error: 'Participant emails must be unique' });
    return;
  }

  const members = memberInputs.map((p) => {
    const email = String(p.email ?? '').trim().toLowerCase();
    const guestName = `${String(p.firstName ?? '').trim()} ${String(p.lastName ?? '').trim()}`.trim();
    return email ? { email } : { guestName };
  });

  try {
    const result = await createTripWithGroupAndMembers({
      ownerId: userId,
      tripName: String(name).trim(),
      description: typeof description === 'string' ? description.trim() || null : null,
      destination: typeof destination === 'string' ? destination.trim() || null : null,
      startDate: typeof startDate === 'string' ? startDate : null,
      endDate: typeof endDate === 'string' ? endDate : null,
      startMonth: Number.isFinite(Number(startMonth)) ? Number(startMonth) : null,
      startYear: Number.isFinite(Number(startYear)) ? Number(startYear) : null,
      durationDays: Number.isFinite(Number(durationDays)) ? Number(durationDays) : null,
      members,
    });

    for (const p of memberInputs) {
      const email = String(p.email ?? '').trim();
      if (!email) {
        const firstName = String(p.firstName ?? '').trim();
        const lastName = String(p.lastName ?? '').trim();
        if (firstName && lastName) {
          await createFellowTraveler(userId, firstName, lastName);
        }
      }
    }

    res.status(201).json({ trip: result.trip, groupId: result.groupId, invites: result.invites });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.delete('/:id', async (req, res) => {
  const userId = (req as any).user.userId as string;
  try {
    await deleteTrip(userId, req.params.id);
    res.status(204).send();
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.patch('/:id/group', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const { groupId } = req.body ?? {};
  if (!groupId) {
    res.status(400).json({ error: 'groupId is required' });
    return;
  }
  try {
    const updated = await updateTripGroup(userId, req.params.id, groupId);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.patch('/:id', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const { description, destination, startDate, endDate, startMonth, startYear, durationDays, dateMode } = req.body ?? {};
  if (description == null && destination == null && startDate == null && endDate == null && startMonth == null && startYear == null && durationDays == null) {
    res.status(400).json({ error: 'At least one field is required' });
    return;
  }
  try {
    const updated = await updateTripDetails(userId, req.params.id, {
      description: typeof description === 'string' ? description : null,
      destination: typeof destination === 'string' ? destination : null,
      startDate: typeof startDate === 'string' ? startDate : null,
      endDate: typeof endDate === 'string' ? endDate : null,
      startMonth: Number.isFinite(Number(startMonth)) ? Number(startMonth) : null,
      startYear: Number.isFinite(Number(startYear)) ? Number(startYear) : null,
      durationDays: Number.isFinite(Number(durationDays)) ? Number(durationDays) : null,
      dateMode: dateMode === 'month' || dateMode === 'range' ? dateMode : undefined,
    });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

export default router;
