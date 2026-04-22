import { Router } from 'express';
import bodyParser from 'body-parser';
import { authenticate } from '../auth';
import {
  deleteTripPayment,
  ensureUserInTrip,
  insertTripPayment,
  listGroupMembers,
  listTripPayments,
} from '../db';
import { assertCanUseFeature } from '../services/entitlementService';
import { EntitlementError } from '../errors';
import { TokenPayload } from '../auth';

const router = Router();
router.use(bodyParser.json());
router.use(authenticate);

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const todayIsoDate = (): string => {
  const d = new Date();
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

router.get('/', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const role = ((req as any).user as TokenPayload).role;
  const tripId = req.query.tripId as string | undefined;
  if (!tripId) {
    res.status(400).json({ error: 'tripId is required' });
    return;
  }
  try {
    await assertCanUseFeature(userId, 'cost_tracking', role);
    const payments = await listTripPayments(userId, tripId);
    res.json(payments);
  } catch (err) {
    if (err instanceof EntitlementError) {
      res.status(402).json({ error: err.message, code: err.code });
      return;
    }
    res.status(500).json({ error: 'Failed to load payments' });
  }
});

router.post('/', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const role = ((req as any).user as TokenPayload).role;
  const { tripId, payerId, receiverId, paymentDate, amount, amountCents, currency, notes } = req.body ?? {};

  if (!tripId || !payerId || !receiverId || !paymentDate) {
    res.status(400).json({ error: 'tripId, payerId, receiverId, and paymentDate are required' });
    return;
  }
  if (typeof paymentDate !== 'string' || !ISO_DATE_RE.test(paymentDate)) {
    res.status(400).json({ error: 'paymentDate must be in YYYY-MM-DD format' });
    return;
  }
  if (String(payerId) === String(receiverId)) {
    res.status(400).json({ error: 'Payer and receiver must be different travelers' });
    return;
  }
  if (paymentDate > todayIsoDate()) {
    res.status(400).json({ error: 'Future-dated payments are not allowed' });
    return;
  }

  let normalizedCents: number;
  if (amountCents != null) {
    normalizedCents = Math.round(Number(amountCents));
  } else if (amount != null) {
    normalizedCents = Math.round(Number(amount) * 100);
  } else {
    res.status(400).json({ error: 'amount or amountCents is required' });
    return;
  }
  if (!Number.isFinite(normalizedCents) || normalizedCents <= 0) {
    res.status(400).json({ error: 'Amount must be greater than zero' });
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
  const members = await listGroupMembers(membership.groupId, userId);
  const memberIdSet = new Set(members.map((m) => String(m.id)));
  if (!memberIdSet.has(String(payerId)) || !memberIdSet.has(String(receiverId))) {
    res.status(400).json({ error: 'Payer and receiver must be trip members' });
    return;
  }

  const normalizedCurrency =
    typeof currency === 'string' && currency.trim() ? currency.trim().toUpperCase() : undefined;
  const normalizedNotes = typeof notes === 'string' ? notes.trim() || null : null;

  const created = await insertTripPayment({
    tripId: String(tripId),
    groupId: membership.groupId,
    recordedBy: userId,
    payerId: String(payerId),
    receiverId: String(receiverId),
    paymentDate: String(paymentDate),
    amountCents: normalizedCents,
    currency: normalizedCurrency,
    notes: normalizedNotes,
  });
  res.status(201).json(created);
});

router.delete('/:id', async (req, res) => {
  const userId = (req as any).user.userId as string;
  const role = ((req as any).user as TokenPayload).role;
  try {
    await assertCanUseFeature(userId, 'cost_tracking', role);
    await deleteTripPayment(req.params.id, userId);
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
