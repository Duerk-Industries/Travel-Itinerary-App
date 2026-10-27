import { Router } from 'express';
import bodyParser from 'body-parser';
import multer from 'multer';
import { authenticate } from '../auth';
import { randomUUID } from 'crypto';
import { deleteExpense, deleteExpenseReceipt, ensureUserInTrip, getExpenseReceipt, getExpenseTripForUser, getTripById, insertExpense, insertExpenseIdempotent, listExpenseIdsWithReceipt, listExpenses, listGroupMembers, setExpenseReceipt, updateExpense } from '../db';
import { createReceiptReadUrl, deleteReceiptObject, putReceiptObject, receiptObjectKey } from '../services/expenseReceiptStorage';
import { assertCanUseFeature } from '../services/entitlementService';
import { EntitlementError } from '../errors';
import { TokenPayload } from '../auth';
import { readDto } from '../utils/dtoParse';
import { createExpenseDto, listExpensesQueryDto, updateExpenseDto } from './expenseDtos';
import { parseReceiptImage } from '../services/receiptExpenseParser';
import { logError } from '../logger';

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

// The declared type is client-supplied, so the first bytes must agree with it before anything is stored.
const looksLikeImage = (bytes: Buffer, mimeType: string): boolean => {
  if (mimeType === 'image/png') return bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mimeType === 'image/webp') return bytes.length > 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
};

// Offline clients send a random per-operation id so a retry after a timeout returns the original
// expense instead of creating a second one. The id is scoped to the authenticated user.
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

const sortedIds = (ids: unknown[]): string[] => ids.map(String).sort();
const money = (value: unknown): number => Math.round((Number(value) || 0) * 100) / 100;

// Fields that identify "the same request". Computed fields (exchange rate) are excluded so a retry
// that re-resolved a rate is still recognised, while a reused key on a different expense is not.
const expenseRequestSignature = (e: any): string =>
  JSON.stringify([
    String(e.tripId ?? ''),
    String(e.expenseDate ?? '').slice(0, 10),
    String(e.category ?? ''),
    money(e.amount),
    String(e.currency ?? '').toUpperCase(),
    sortedIds(Array.isArray(e.payerIds) ? e.payerIds : []),
    sortedIds(Array.isArray(e.forIds) ? e.forIds : []),
    JSON.stringify(Object.entries(e.forShares ?? {}).sort(([a], [b]) => a.localeCompare(b))),
    e.vendor ?? null,
    e.notes ?? null,
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

  const newExpense = {
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
    forShares: dto.forShares,
    vendor: dto.vendor,
    notes: dto.notes,
  };

  const rawKey = req.header('Idempotency-Key');
  if (rawKey === undefined) {
    const created = await insertExpense(newExpense);
    res.status(201).json(created);
    return;
  }
  const idempotencyKey = String(rawKey).trim();
  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    res.status(400).json({ error: 'Idempotency-Key must be 8-64 letters, digits, dashes or underscores', code: 'INVALID_IDEMPOTENCY_KEY' });
    return;
  }
  // Membership, entitlement and traveler checks above run on every attempt, including replays, so a
  // member removed while offline cannot replay a queued expense into the trip.
  const { expense: stored, replayed } = await insertExpenseIdempotent(newExpense, `${userId}:${idempotencyKey}`);
  if (
    replayed &&
    expenseRequestSignature(stored) !== expenseRequestSignature({ ...newExpense, currency: newExpense.currency ?? stored.currency })
  ) {
    res.status(409).json({ error: 'This Idempotency-Key was already used for a different expense', code: 'IDEMPOTENCY_KEY_REUSED' });
    return;
  }
  if (replayed) res.setHeader('Idempotent-Replayed', 'true');
  res.status(201).json(stored);
});

router.put('/:id', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const role = ((req as any).user as TokenPayload).role;
  const dto = readDto(updateExpenseDto, req.body, res);
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
  const memberIdSet = new Set(members.map((member) => String(member.id)));
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
  let updated;
  try {
    updated = await updateExpense(req.params.id, userId, dto);
  } catch (err) {
    logError('Failed to update expense', err);
    res.status(500).json({ error: 'Unable to update expense' });
    return;
  }
  if (!updated) {
    res.status(404).json({ error: 'Expense not found or cannot be edited' });
    return;
  }
  res.json(updated);
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
    await assertCanUseFeature(userId, 'receipt_scanning', role);
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
      tripStartDate: trip?.startDate ? String(trip.startDate).slice(0, 10) : null,
      tripEndDate: trip?.endDate ? String(trip.endDate).slice(0, 10) : null,
    });
    res.json(parsed);
  } catch {
    res.status(422).json({ error: 'Unable to parse receipt image' });
  }
});

// --- Stored receipt image (one per expense) -----------------------------------------------------
// Distinct from /receipt/parse above, which reads a photo to pre-fill the form and keeps nothing.
// Every route needs cost tracking and membership in the expense's trip.
const receiptAccess = async (req: any, res: any): Promise<{ userId: string; tripId: string } | null> => {
  const userId = req.user.userId as string;
  try {
    await assertCanUseFeature(userId, 'cost_tracking', (req.user as TokenPayload).role);
  } catch (err) {
    if (err instanceof EntitlementError) {
      res.status(402).json({ error: err.message, code: err.code });
      return null;
    }
    throw err;
  }
  const expense = await getExpenseTripForUser(req.params.id, userId);
  if (!expense) {
    res.status(404).json({ error: 'Expense not found' });
    return null;
  }
  return { userId, tripId: expense.tripId };
};

router.get('/receipts', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const tripId = String(req.query.tripId ?? '').trim();
  if (!tripId) {
    res.status(400).json({ error: 'tripId is required' });
    return;
  }
  try {
    await assertCanUseFeature(userId, 'cost_tracking', ((req as any).user as TokenPayload).role);
    res.json({ expenseIds: await listExpenseIdsWithReceipt(userId, tripId) });
  } catch (err) {
    if (err instanceof EntitlementError) {
      res.status(402).json({ error: err.message, code: err.code });
      return;
    }
    res.status(500).json({ error: 'Failed to load receipts' });
  }
});

router.get('/:id/receipt', async (req, res) => {
  const access = await receiptAccess(req, res);
  if (!access) return;
  const receipt = await getExpenseReceipt(req.params.id, access.userId);
  if (!receipt) {
    res.status(404).json({ error: 'No receipt stored for this expense' });
    return;
  }
  try {
    const url = await createReceiptReadUrl(receipt.objectKey);
    if (!url) {
      res.status(404).json({ error: 'Receipt image is unavailable' });
      return;
    }
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({ url, contentType: receipt.contentType });
  } catch (err) {
    logError('Failed to sign receipt URL', err);
    res.status(503).json({ error: 'Receipt image is unavailable' });
  }
});

router.put('/:id/receipt', receiptUpload.single('image'), async (req, res) => {
  const access = await receiptAccess(req, res);
  if (!access) return;
  const file = req.file;
  if (!file) {
    res.status(400).json({ error: 'Receipt image is required' });
    return;
  }
  if (!allowedReceiptMimeTypes.has(file.mimetype) || !looksLikeImage(file.buffer, file.mimetype)) {
    res.status(400).json({ error: 'Unsupported receipt image type' });
    return;
  }
  try {
    const previous = await getExpenseReceipt(req.params.id, access.userId);
    const objectKey = receiptObjectKey(access.tripId, req.params.id, file.mimetype, randomUUID());
    await putReceiptObject(objectKey, file.buffer, file.mimetype);
    await setExpenseReceipt({ expenseId: req.params.id, tripId: access.tripId, objectKey, contentType: file.mimetype, uploadedBy: access.userId });
    if (previous && previous.objectKey !== objectKey) await deleteReceiptObject(previous.objectKey).catch((err) => logError('Failed to remove replaced receipt image', err));
    res.json({ hasReceipt: true });
  } catch (err) {
    logError('Failed to store receipt image', err);
    res.status(503).json({ error: 'Unable to store the receipt image' });
  }
});

router.delete('/:id/receipt', async (req, res) => {
  const access = await receiptAccess(req, res);
  if (!access) return;
  try {
    const receipt = await getExpenseReceipt(req.params.id, access.userId);
    if (receipt) {
      await deleteExpenseReceipt(req.params.id);
      await deleteReceiptObject(receipt.objectKey).catch((err) => logError('Failed to remove receipt image', err));
    }
    res.status(204).send();
  } catch (err) {
    logError('Failed to delete receipt image', err);
    res.status(500).json({ error: 'Unable to remove the receipt image' });
  }
});

router.delete('/:id', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const role = ((req as any).user as TokenPayload).role;
  try {
    await assertCanUseFeature(userId, 'cost_tracking', role);
    const receipt = await getExpenseReceipt(req.params.id, userId).catch(() => null);
    await deleteExpense(req.params.id, userId);
    if (receipt) {
      await deleteExpenseReceipt(req.params.id).catch(() => undefined);
      await deleteReceiptObject(receipt.objectKey).catch((err) => logError('Failed to remove receipt image', err));
    }
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
