import { Router } from 'express';
import { authenticate } from '../auth';
import { assertCanUseFeature } from '../services/entitlementService';
import { insertExpense, ensureUserInTrip, listExpenses } from '../db';
import { getDb } from '../db.firebase';
import { logError } from '../logger';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const router = Router();

// Mirrors NeutralCategory from packages/plaid-transactions/src/lib/categoryMapping.ts —
// keep in sync if that taxonomy changes (same convention as coveredBy.ts's
// client/server mirror; see CLAUDE.md). Duplicated on purpose rather than
// imported: packages/plaid-transactions is a sibling workspace package, and
// server/Dockerfile's build context is the server/ directory alone — it has
// no path back to a sibling package, and this route is the only place server
// code ever touched that package's source, so a real cross-workspace
// dependency (file: reference + widening the Docker build context to the
// repo root) would be a lot of moving parts for one 9-value union type.
type NeutralCategory =
  | 'Food & Drink'
  | 'Travel'
  | 'Shopping'
  | 'Entertainment'
  | 'Health'
  | 'Services'
  | 'Transfer'
  | 'Income'
  | 'Other';
router.use(authenticate);

// These would normally be imported from the module if we were deploying them here,
// but they are deployed as separate Firebase Functions.
// For v1, the server can proxy them or the client can call them directly.
// We'll provide proxy endpoints here for convenience.

router.post('/link-token', async (req: any, res) => {
  try {
    await assertCanUseFeature(req.user.userId, 'expense_import_plaid_link', req.user.role);
    // In a real app, this would call the deployed Firebase Function 'plaidCreateLinkToken'
    // For this integrated demo, we'll return a 501 or a mock if not fully deployed.
    res.status(501).json({ error: 'Please call the plaidCreateLinkToken Firebase Function directly from the mobile app.' });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

router.post('/exchange-token', async (req: any, res) => {
  try {
    await assertCanUseFeature(req.user.userId, 'expense_import_plaid_link', req.user.role);
    res.status(501).json({ error: 'Please call the plaidExchangePublicToken Firebase Function directly from the mobile app.' });
  } catch (err: any) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

const mapNeutralToExpenseCategory = (neutral: NeutralCategory): string => {
  switch (neutral) {
    case 'Food & Drink': return 'Dinner'; // Default to Dinner for now
    case 'Travel': return 'Rides'; // Default to Rides
    case 'Transfer': return 'Other';
    case 'Income': return 'Other';
    default: return 'Other';
  }
};

/**
 * Lists Plaid transaction candidates for the authenticated user.
 */
router.get('/candidates', async (req: any, res) => {
  try {
    await assertCanUseFeature(req.user.userId, 'expense_import_plaid', req.user.role);

    // Fetch directly from Firestore using the module's schema
    const db = getDb() as any; // Cast to Firestore if using firebase provider
    if (typeof db.collectionGroup !== 'function') {
      return res.status(501).json({ error: 'Expense import requires Firebase DB provider' });
    }

    const transactionsSnap = await db.collection(`users/${req.user.userId}/plaidTransactions`)
      .where('removed', '==', false)
      .where('consumerLink', '==', null)
      .orderBy('date', 'desc')
      .limit(50)
      .get();

    const candidates = transactionsSnap.docs.map((doc: any) => ({
      id: doc.id,
      ...doc.data(),
    }));

    res.json({ candidates });
  } catch (err: any) {
    logError('[plaid-integration] Failed to list candidates', err);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

/**
 * Assigns a Plaid transaction to a trip, creating an Expense.
 */
router.post('/assign', async (req: any, res) => {
  try {
    const { transactionId, tripId, category, payerIds, forIds, notes } = req.body;

    if (!transactionId || !tripId || !category || !payerIds || !forIds) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    await assertCanUseFeature(req.user.userId, 'expense_import_plaid', req.user.role);
    const membership = await ensureUserInTrip(tripId, req.user.userId);
    if (!membership) {
      return res.status(403).json({ error: 'You must be in the group for this trip' });
    }

    const db = getDb() as any;
    const transactionRef = db.doc(`users/${req.user.userId}/plaidTransactions/${transactionId}`);
    const transactionSnap = await transactionRef.get();

    if (!transactionSnap.exists) {
      return res.status(404).json({ error: 'Transaction candidate not found' });
    }

    const tData = transactionSnap.data();
    if (tData.consumerLink) {
      return res.status(409).json({ error: 'Transaction already assigned' });
    }

    // 1. Create Expense
    const expense = await insertExpense({
      tripId,
      groupId: membership.groupId,
      userId: req.user.userId,
      expenseDate: tData.date,
      category,
      amount: tData.amount,
      currency: tData.isoCurrencyCode,
      vendor: tData.merchantName,
      notes: notes || tData.personalFinanceCategory || null,
      payerIds,
      forIds,
      sourceType: 'plaid_transaction',
      sourceId: transactionId,
    });

    // 2. Link transaction doc
    await transactionRef.update({
      consumerLink: {
        consumerType: 'WanderBunnies:Expense',
        consumerRecordId: expense.id,
        linkedAt: FieldValue.serverTimestamp(),
      },
      updatedAt: FieldValue.serverTimestamp(),
    });

    res.status(201).json(expense);
  } catch (err: any) {
    logError('[plaid-integration] Failed to assign transaction', err);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

export default router;
