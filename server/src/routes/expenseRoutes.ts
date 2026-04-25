import { Router } from 'express';
import bodyParser from 'body-parser';
import { authenticate } from '../auth';
import { deleteExpense, ensureUserInTrip, insertExpense, listExpenses, listGroupMembers } from '../db';
import { assertCanUseFeature } from '../services/entitlementService';
import { EntitlementError } from '../errors';
import { TokenPayload } from '../auth';
import { readDto } from '../utils/dtoParse';
import { createExpenseDto, listExpensesQueryDto } from './expenseDtos';

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
  'Activities',
  'Car Rentals',
]);

router.get('/', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const role = ((req as any).user as TokenPayload).role;
  const dto = readDto(listExpensesQueryDto, req.query, res);
  if (!dto) return;
  try {
    await assertCanUseFeature(userId, 'cost_tracking', role);
    const expenses = await listExpenses(userId, dto.tripId);
    res.json(expenses);
  } catch (err) {
    if (err instanceof EntitlementError) {
      res.status(402).json({ error: err.message, code: err.code });
      return;
    }
    res.status(500).json({ error: 'Failed to load expenses' });
  }
});

router.post('/', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const role = ((req as any).user as TokenPayload).role;
  const dto = readDto(createExpenseDto, req.body, res);
  if (!dto) return;
  try {
    await assertCanUseFeature(userId, 'cost_tracking', role);
  } catch (err) {
    if (err instanceof EntitlementError) {
      res.status(402).json({ error: err.message, code: err.code });
      return;
    }
    throw err;
  }
  if (!allowedCategories.has(dto.category)) {
    res.status(400).json({ error: 'Invalid category' });
    return;
  }
  const membership = await ensureUserInTrip(dto.tripId, userId);
  if (!membership) {
    res.status(403).json({ error: 'You must be in the group for this trip' });
    return;
  }
  const members = await listGroupMembers(membership.groupId, userId);
  const memberIdSet = new Set(members.map((m) => String(m.id)));

  if (!dto.payerIds.length || !dto.forIds.length) {
    res.status(400).json({ error: 'At least one payer and one traveler are required' });
    return;
  }
  if (dto.payerIds.some((id) => !memberIdSet.has(id))) {
    res.status(400).json({ error: 'Payers must be trip members' });
    return;
  }
  if (dto.forIds.some((id) => !memberIdSet.has(id))) {
    res.status(400).json({ error: 'Travelers must be trip members' });
    return;
  }

  const created = await insertExpense({
    userId,
    tripId: dto.tripId,
    groupId: membership.groupId,
    expenseDate: dto.expenseDate,
    category: dto.category,
    amount: dto.amount,
    currency: dto.currency,
    amountInTripCurrency: dto.amountInTripCurrency,
    exchangeRateToTripCurrency: dto.exchangeRateToTripCurrency,
    exchangeRateDate: dto.exchangeRateDate,
    payerIds: dto.payerIds,
    forIds: dto.forIds,
    notes: dto.notes,
  });
  res.status(201).json(created);
});

router.delete('/:id', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const role = ((req as any).user as TokenPayload).role;
  try {
    await assertCanUseFeature(userId, 'cost_tracking', role);
    await deleteExpense(req.params.id, userId);
    res.status(204).send();
  } catch (err) {
    if (err instanceof EntitlementError) {
      res.status(402).json({ error: err.message, code: err.code });
      return;
    }
    res.status(400).json({ error: (err as Error).message });
  }
});

export default router;
