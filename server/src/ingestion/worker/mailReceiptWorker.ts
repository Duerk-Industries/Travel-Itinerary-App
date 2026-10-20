import { getUserById } from '../../db';
import { randomUUID } from 'crypto';
import type { Request } from 'express';
import { getEnvFlag, getEnvValue } from '../../env';
import { isFeatureEnabled } from '../../services/entitlementService';
import { INGESTION_FEATURE_FLAGS } from '../config';
import { buildMailgunWebhookPayloads } from '../intake/mailgun';
import { buildImportJobIdempotencyKey } from '../shared/hashing';
import { getImportJobByIdempotencyKey, requeueImportJob } from '../shared/repository';
import { runIngestionPipeline } from '../orchestrator';
import { cleanupMailReceipts, listMailReceipts, readRawMail, updateMailReceipt } from '../shared/mailAdmission';
import { getVirusScanner } from '../virusScanProviders';
import { deleteTempBytes } from '../shared/tempStorage';
import { logError } from '../../logger';

export const assertMailAdmissionReady = (): void => {
  if (getEnvValue('NODE_ENV') === 'test') return;
  if (!getEnvFlag('INGESTION_MAIL_RECEIPT_SCHEDULER_READY') || !getEnvValue('INGESTION_ENCRYPTION_SECRET')) {
    throw new Error('Mail receipt scheduler and encryption must be configured before admission');
  }
  if (getVirusScanner().name !== 'clamav_http' || !getEnvValue('INGESTION_VIRUS_SCAN_URL') || !getEnvValue('INGESTION_VIRUS_SCAN_AUTH_TOKEN')) {
    throw new Error('Forwarded mail requires an authenticated clamav_http scanner');
  }
};

/** Synchronous scheduler invocation: response waits for bounded work. A crash
 * leaves the encrypted receipt recoverable after the lease expires. */
export const drainMailReceipts = async (): Promise<{ processed: number }> => {
  await cleanupMailReceipts();
  if (!(await isFeatureEnabled(INGESTION_FEATURE_FLAGS.forwardedMailbox))) return { processed: 0 };
  assertMailAdmissionReady();
  const now = Date.now(); let processed = 0;
  const ready = (await listMailReceipts()).filter(r => r.state === 'PENDING' && r.nextAttemptAt <= now && r.leaseUntil <= now && r.expiresAt > now).slice(0, 5);
  for (const candidate of ready) {
    const lease = randomUUID();
    const receipt = await updateMailReceipt(candidate.id, current =>
      current.state === 'PENDING' && current.leaseUntil <= Date.now() && current.expiresAt > Date.now()
        ? { ...current, lease, leaseUntil: Date.now() + 15 * 60 * 1000, attempts: current.attempts + 1 } : null);
    if (!receipt) continue;
    let payloads: Awaited<ReturnType<typeof buildMailgunWebhookPayloads>> = [];
    try {
      if (!(await getUserById(receipt.userId))) throw new Error('Owner no longer exists');
      const raw = readRawMail(receipt);
      const files = raw.files.map(file => ({ ...file, buffer: Buffer.from(file.bytes, 'base64'), size: Buffer.from(file.bytes, 'base64').length }));
      const request = { body: raw.body, files } as unknown as Request;
      payloads = await buildMailgunWebhookPayloads(request, receipt.userId, '', receipt.authentication);
      for (const payload of payloads) {
        payload.metadata.receiverReceiptId = receipt.id;
        const existing = await getImportJobByIdempotencyKey(payload.userId, buildImportJobIdempotencyKey(payload));
        if (existing?.state === 'FAILED' || existing?.state === 'DEAD_LETTERED') await requeueImportJob(existing.id);
        const job = await runIngestionPipeline(payload, receipt.allowLargeLlm, receipt.allowSmallLlm);
        if (job.state === 'FAILED' || job.state === 'DEAD_LETTERED') throw new Error('Import requires review');
      }
      await updateMailReceipt(receipt.id, current => current.lease === lease
        ? { ...current, state: 'COMPLETE', encrypted: null, lease: null, leaseUntil: 0 } : null);
      processed += 1;
    } catch {
      logError(`[ingestion][mailgun] processing deferred receipt=${receipt.id}`);
      await updateMailReceipt(receipt.id, current => current.lease === lease ? {
        ...current, state: current.attempts >= 5 ? 'HELD' : 'PENDING', lease: null, leaseUntil: 0,
        nextAttemptAt: Date.now() + Math.min(30 * 60_000, 30_000 * 2 ** current.attempts),
      } : null);
    } finally {
      for (const payload of payloads) await deleteTempBytes(payload.contentBytesRef);
    }
  }
  return { processed };
};
