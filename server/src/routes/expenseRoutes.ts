import { Router } from 'express';
import bodyParser from 'body-parser';
import { authenticate } from '../auth';
import { deleteExpense, ensureUserInTrip, insertExpense, listExpenses, listGroupMembers } from '../db';

const router = Router();
router.use(bodyParser.json());
router.use(authenticate);

const allowedCategories = new Set([
  'Breakfast',
  'Lunch',
  'Dinner',
  'Other Food',
  'Rides',
  'Souvenirs',
  'Other',
  'Flights',
  'Lodging',
  'Tours',
]);

router.get('/', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const tripId = req.query.tripId as string | undefined;
  if (!tripId) {
    res.status(400).json({ error: 'tripId is required' });
    return;
  }
  const expenses = await listExpenses(userId, tripId);
  res.json(expenses);
});

router.post('/', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const {
    tripId,
    expenseDate,
    category,
    amount,
    currency,
    payerIds,
    forIds,
    notes,
  } = req.body ?? {};

  if (!tripId || !expenseDate || !category) {
    res.status(400).json({ error: 'tripId, expenseDate, and category are required' });
    return;
  }
  const normalizedCategory = String(category).trim();
  if (!allowedCategories.has(normalizedCategory)) {
    res.status(400).json({ error: 'Invalid category' });
    return;
  }
  const membership = await ensureUserInTrip(tripId, userId);
  if (!membership) {
    res.status(403).json({ error: 'You must be in the group for this trip' });
    return;
  }
  const members = await listGroupMembers(membership.groupId, userId);
  const memberIdSet = new Set(members.map((m) => String(m.id)));
  const normalizedPayers = Array.isArray(payerIds) ? payerIds.map((id: any) => String(id)).filter(Boolean) : [];
  const normalizedFor = Array.isArray(forIds) ? forIds.map((id: any) => String(id)).filter(Boolean) : [];

  if (!normalizedPayers.length || !normalizedFor.length) {
    res.status(400).json({ error: 'At least one payer and one traveler are required' });
    return;
  }
  if (normalizedPayers.some((id) => !memberIdSet.has(id))) {
    res.status(400).json({ error: 'Payers must be trip members' });
    return;
  }
  if (normalizedFor.some((id) => !memberIdSet.has(id))) {
    res.status(400).json({ error: 'Travelers must be trip members' });
    return;
  }

  const created = await insertExpense({
    userId,
    tripId,
    groupId: membership.groupId,
    expenseDate: String(expenseDate),
    category: normalizedCategory,
    amount: Number(amount) || 0,
    currency: typeof currency === 'string' && currency.trim() ? currency.trim().toUpperCase() : undefined,
    payerIds: normalizedPayers,
    forIds: normalizedFor,
    notes: typeof notes === 'string' ? notes.trim() || null : null,
  });
  res.status(201).json(created);
});

router.delete('/:id', async (req, res) => {
  const userId = (req as any).user.userId as string;
  try {
    await deleteExpense(req.params.id, userId);
    res.status(204).send();
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

export default router;
