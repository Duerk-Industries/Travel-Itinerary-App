import { Router } from 'express';
import bodyParser from 'body-parser';
import { getEnvValue } from '../env';
import { logError, logInfo } from '../logger';
import {
  createTrip,
  deleteTrip,
  ensureDefaultGroupForUser,
  findUserByEmail,
  listGroupsForUser,
  writeAuditLog,
} from '../db';
import type { AuditAction } from '../types';

const router = Router();
router.use(bodyParser.json({ limit: '256kb' }));

const authenticateDeployWorker = (req: any, res: any, next: any) => {
  const configured = getEnvValue('DEPLOY_WORKER_SHARED_SECRET');
  if (!configured) {
    logError('[deploy][internal] rejected request because deploy worker secret is not configured');
    res.status(503).json({ error: 'Deploy worker secret not configured.' });
    return;
  }
  const provided = String(req.header('X-Deploy-Worker-Secret') ?? '');
  if (!provided || provided !== configured) {
    logError('[deploy][internal] rejected request due to invalid shared secret');
    res.status(403).json({ error: 'Forbidden.' });
    return;
  }
  next();
};

const resolveCanaryAccount = async (): Promise<{ id: string; email: string } | null> => {
  const canaryEmail = getEnvValue('CANARY_ACCOUNT_EMAIL');
  if (!canaryEmail) return null;
  const user = await findUserByEmail(canaryEmail);
  if (!user || user.is_internal_canary !== true) return null;
  return { id: user.id, email: user.email };
};

router.post('/canary-smoke-write', authenticateDeployWorker, async (req, res) => {
  try {
    const canary = await resolveCanaryAccount();
    if (!canary) {
      res.status(503).json({ error: 'Canary account is not configured or not bootstrapped.' });
      return;
    }
    await ensureDefaultGroupForUser(canary.id, canary.email);
    const groups = await listGroupsForUser(canary.id);
    const groupId = groups[0]?.id;
    if (!groupId) {
      res.status(500).json({ error: 'Canary account has no default group.' });
      return;
    }
    const label = String(req.body?.cutoverLabel ?? new Date().toISOString());
    const trip = await createTrip(canary.id, groupId, `Deployment smoke test ${label}`, {
      description: 'Created by cutover-test-to-prod.sh; deleted by the post-cutover canary cleanup step.',
    });
    logInfo(`[deploy][internal] canary smoke write created trip=${trip.id}`);
    res.status(201).json({ tripId: trip.id });
  } catch (err) {
    logError('[deploy][internal] canary smoke write failed', err);
    res.status(500).json({ error: 'Canary smoke write failed.' });
  }
});

router.post('/canary-smoke-cleanup', authenticateDeployWorker, async (req, res) => {
  try {
    const canary = await resolveCanaryAccount();
    if (!canary) {
      res.status(503).json({ error: 'Canary account is not configured or not bootstrapped.' });
      return;
    }
    const tripIds: string[] = Array.isArray(req.body?.tripIds) ? req.body.tripIds.filter((id: unknown) => typeof id === 'string') : [];
    let deleted = 0;
    let failed = 0;
    for (const tripId of tripIds) {
      try {
        await deleteTrip(canary.id, tripId);
        deleted += 1;
      } catch (err) {
        failed += 1;
        logError(`[deploy][internal] canary cleanup failed to delete trip=${tripId}`, err);
      }
    }
    logInfo(`[deploy][internal] canary smoke cleanup deleted=${deleted} failed=${failed}`);
    res.status(200).json({ deleted, failed });
  } catch (err) {
    logError('[deploy][internal] canary smoke cleanup failed', err);
    res.status(500).json({ error: 'Canary smoke cleanup failed.' });
  }
});

router.post('/audit-log', authenticateDeployWorker, async (req, res) => {
  try {
    const action = String(req.body?.action ?? '') as AuditAction;
    const allowed: AuditAction[] = ['DEPLOY_CUTOVER', 'DEPLOY_DIRECT_PROD', 'DEPLOY_ROLLBACK', 'DEPLOY_TEARDOWN'];
    if (!allowed.includes(action)) {
      res.status(400).json({ error: `action must be one of: ${allowed.join(', ')}` });
      return;
    }
    const entry = await writeAuditLog({
      actorUserId: null,
      targetUserId: null,
      action,
      afterState: {
        actor: req.body?.actor ?? null,
        reason: req.body?.reason ?? null,
        releaseManifest: req.body?.releaseManifest ?? null,
        details: req.body?.details ?? null,
      },
      reason: typeof req.body?.reason === 'string' ? req.body.reason : null,
    });
    res.status(201).json({ id: entry.id });
  } catch (err) {
    logError('[deploy][internal] audit log write failed', err);
    res.status(500).json({ error: 'Audit log write failed.' });
  }
});

export default router;
