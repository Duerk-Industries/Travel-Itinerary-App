import { Router } from 'express';
import bodyParser from 'body-parser';
import multer from 'multer';
import { authenticate } from '../auth';
import { deleteExpense, ensureUserInTrip, getTripById, insertExpense, listExpenses, listGroupMembers } from '../db';
import { assertCanUseFeature } from '../services/entitlementService';
import { EntitlementError } from '../errors';
import { TokenPayload } from '../auth';
import { readDto } from '../utils/dtoParse';
import { createExpenseDto, listExpensesQueryDto } from './expenseDtos';
import { parseReceiptImage } from '../services/receiptExpenseParser';

const router = Router();
router.use(bodyParser.json());
router.use(authenticate);
const receiptUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

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

const allowedReceiptMimeTypes = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

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
    vendor: dto.vendor,
    notes: dto.notes,
  });
  res.status(201).json(created);
});

router.post('/receipt/parse', receiptUpload.single('image'), async (req, res) => {
  const userId = (req as any).user.userId as string;
  const role = ((req as any).user as TokenPayload).role;
  const tripId = String(req.body?.tripId ?? '').trim();
  if (!tripId) {
    res.status(400).json({ error: 'tripId is required' });
    return;
  }
  try {
    await assertCanUseFeature(userId, 'cost_tracking', role);
  } catch (err) {
    if (err instanceof EntitlementError) {
      res.status(402).json({ error: err.message, code: err.code });
      return;
    }
    throw err;
  }
  const membership = await ensureUserInTrip(tripId, userId);
  if (!membership) {
    res.status(403).json({ error: 'You must be in the group for this trip' });
    return;
  }
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: 'Receipt image is required' });
    return;
  }
  if (!allowedReceiptMimeTypes.has(file.mimetype)) {
    res.status(400).json({ error: 'Unsupported receipt image type' });
    return;
  }
  try {
    const trip = await getTripById(tripId);
    const parsed = await parseReceiptImage(file.buffer, file.mimetype, {
      fallbackCurrency: trip?.currency ?? null,
      destination: trip?.destination ?? null,
    });
    res.json(parsed);
  } catch {
    res.status(422).json({ error: 'Unable to parse receipt image' });
  }
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

router.use((err: any, _req: any, res: any, next: any) => {
  if (err instanceof multer.MulterError) {
    res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Receipt image is too large' : err.message });
    return;
  }
  next(err);
});

export default router;
