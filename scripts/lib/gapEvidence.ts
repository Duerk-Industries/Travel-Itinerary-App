import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

// These are release acceptance checks, not substitutes for executing the runbooks.
export const REQUIRED_CHECKS = {
  deployment: ['runtime-flags-provider-policy', 'scanner-clean-eicar-outage', 'receiver-gmail-forwarding',
    'scheduler-multi-instance-recovery', 'firestore-indexes-contention-cost',
    'deployed-shell-hash-update-offline', 'signed-in-offline-revocation', 'rollback-supported-clients',
    'chromium-offline-recovery', 'firefox-offline-recovery', 'safari-offline-recovery', 'planning-bundle-map-code'],
  device: ['ios-encryption-migration-key-loss', 'android-encryption-migration-key-loss',
    'ios-suspend-kill-relaunch-replay', 'android-suspend-kill-relaunch-replay',
    'ios-map-memory-print-share', 'android-map-memory-print-share',
    'ios-push-receipt', 'android-push-receipt'],
  accessibility: ['web-keyboard-reorder-recovery', 'web-screen-reader', 'ios-voiceover',
    'android-talkback', 'text-scaling', 'novice-core-tasks-recovery'],
} as const;

export const PERFORMANCE_BUDGETS = {
  nearbyWarm: 300, mailReceipt: 2_000, plainTextImport: 60_000,
  cachedTripOpenIos: 2_000, cachedTripOpenAndroid: 2_000,
} as const;
const text = z.string().trim().min(1);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.iso.datetime();
const artifact = z.object({ path: text, sha256: hash }).strict();
const check = z.object({
  id: text, status: z.enum(['pending', 'passed', 'failed']), observedAt: timestamp.nullable(),
  reviewer: text.nullable(), command: text.nullable(), context: z.record(z.string(), text),
  artifacts: z.array(artifact), notes: z.string(),
}).strict();
const measurement = z.object({
  id: z.enum(['nearbyWarm', 'mailReceipt', 'plainTextImport', 'cachedTripOpenIos', 'cachedTripOpenAndroid']),
  observedAt: timestamp, reviewer: text, command: text,
  context: z.object({ hardware: text, payloadMix: text, concurrency: z.number().int().positive(),
    region: text, state: z.enum(['warm', 'cold']), buildId: text,
    execution: z.enum(['deployed-service', 'physical-device']), platform: text }).strict(),
  samplesMs: z.array(z.number().finite().nonnegative()).min(20), artifacts: z.array(artifact).min(1),
  maxCards: z.number().int().nonnegative().optional(), browseLlmCalls: z.number().int().nonnegative().optional(),
}).strict();
export const packetSchema = z.object({
  schemaVersion: z.literal(1), gitSha: z.string().regex(/^[a-f0-9]{40}$/), environment: text,
  createdAt: timestamp,
  checks: z.object({ deployment: z.array(check), device: z.array(check), accessibility: z.array(check) }).strict(),
  performance: z.array(measurement),
  imports: z.object({
    observedAt: timestamp.nullable(), reviewer: text.nullable(), command: text.nullable(),
    corpusRevision: text.nullable(), parserVersion: text.nullable(), matcherVersion: text.nullable(),
    samplingPlan: text.nullable(), artifacts: z.array(artifact),
    items: z.array(z.object({
      fixtureId: text, supported: z.boolean(), source: z.enum(['direct', 'verified-forward', 'uncertain-forward']),
      itemType: z.enum(['flight', 'lodging', 'activity', 'car_rental']),
      decision: z.enum(['auto', 'suggested', 'held']), expectedTrip: text.nullable(), assignedTrip: text.nullable(),
      fieldsCorrect: z.boolean(), auditedBy: text, undone: z.boolean(),
      complaint: z.boolean(), unnoticedError: z.boolean(),
    }).strict()),
  }).strict(),
}).strict();
export type EvidencePacket = z.infer<typeof packetSchema>;
export type EvidenceCheck = z.infer<typeof check>;

export function createPacket(gitSha: string, environment: string, now = new Date()): EvidencePacket {
  const pending = (id: string): EvidenceCheck => ({ id, status: 'pending', observedAt: null,
    reviewer: null, command: null, context: {}, artifacts: [], notes: '' });
  return packetSchema.parse({ schemaVersion: 1, gitSha, environment, createdAt: now.toISOString(),
    checks: Object.fromEntries(Object.entries(REQUIRED_CHECKS).map(([area, ids]) => [area, ids.map(pending)])),
    performance: [], imports: { observedAt: null, reviewer: null, command: null, corpusRevision: null,
      parserVersion: null, matcherVersion: null, samplingPlan: null, artifacts: [], items: [] } });
}

export function percentile95(samples: number[]): number {
  if (!samples.length || samples.some(n => !Number.isFinite(n) || n < 0)) throw new Error('Invalid latency samples');
  return [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * 0.95) - 1];
}

// Artifacts must be local, within the packet directory (including after resolving symlinks).
export function verifyArtifact(root: string, entry: z.infer<typeof artifact>): void {
  const base = realpathSync(root);
  const resolved = realpathSync(path.resolve(base, entry.path));
  const relative = path.relative(base, resolved);
  if (path.isAbsolute(entry.path) || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Artifact must stay inside the evidence directory');
  }
  if (createHash('sha256').update(readFileSync(resolved)).digest('hex') !== entry.sha256) {
    throw new Error('Artifact SHA-256 mismatch');
  }
}

export function evaluatePacket(input: unknown, options: {
  gitSha: string; environment: string; root: string; now?: Date;
}) {
  const parsed = packetSchema.safeParse(input);
  if (!parsed.success) return { passed: false, failures: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`), metrics: {} };
  const packet = parsed.data;
  const failures: string[] = [];
  const metrics: Record<string, number> = {};
  const need = (ok: unknown, message: string) => { if (!ok) failures.push(message); };
  const now = (options.now ?? new Date()).getTime();
  const fresh = (value: string | null, label: string) => {
    const age = value ? now - Date.parse(value) : NaN;
    need(Number.isFinite(age) && age >= 0 && age <= 14 * 86_400_000, `${label}: missing, future or older than 14 days`);
  };
  const artifacts = (entries: z.infer<typeof artifact>[], label: string) => {
    need(entries.length > 0, `${label}: artifact required`);
    for (const entry of entries) {
      try { verifyArtifact(options.root, entry); }
      catch (err) { failures.push(`${label}: ${entry.path}: ${err instanceof Error ? err.message : String(err)}`); }
    }
  };
  need(packet.gitSha === options.gitSha, 'Release commit mismatch');
  need(packet.environment === options.environment, 'Release environment mismatch');
  fresh(packet.createdAt, 'Packet');
  for (const area of Object.keys(REQUIRED_CHECKS) as Array<keyof typeof REQUIRED_CHECKS>) {
    const entries = packet.checks[area];
    need(new Set(entries.map(e => e.id)).size === entries.length, `${area}: duplicate check IDs`);
    for (const id of REQUIRED_CHECKS[area]) need(entries.some(e => e.id === id), `${area}: missing ${id}`);
    for (const entry of entries) {
      const label = `${area}/${entry.id}`;
      need(entry.status === 'passed', `${label}: ${entry.status}`);
      fresh(entry.observedAt, label);
      need(entry.reviewer && entry.command && entry.notes.trim(), `${label}: reviewer, command and actual outcome required`);
      for (const key of ['buildId', ...(area === 'deployment' ? ['url', 'region'] : ['hardware', 'os']),
        ...(area === 'accessibility' ? ['assistiveTechnology'] : [])]) {
        need(entry.context[key], `${label}: context.${key} required`);
      }
      if (area === 'device') need(entry.context.execution === 'physical-device', `${label}: physical-device execution required`);
      if (entry.id === 'novice-core-tasks-recovery') {
        const completed = Number(entry.context.completed);
        const participants = Number(entry.context.participants);
        need(Number.isInteger(participants) && participants >= 5 && Number.isInteger(completed)
          && completed <= participants && completed / participants >= 0.8, `${label}: at least 4/5 uncoached completion required`);
        need(entry.context.unnoticedLossOrSharing === '0', `${label}: unnoticed loss/sharing blocks release`);
      }
      artifacts(entry.artifacts, label);
    }
  }
  need(new Set(packet.performance.map(e => e.id)).size === packet.performance.length, 'performance: duplicate measurement IDs');
  for (const [id, budget] of Object.entries(PERFORMANCE_BUDGETS)) {
    const entry = packet.performance.find(e => e.id === id);
    if (!entry) { failures.push(`performance: missing ${id}`); continue; }
    fresh(entry.observedAt, id);
    artifacts(entry.artifacts, id);
    metrics[`${id}P95Ms`] = percentile95(entry.samplesMs);
    need(metrics[`${id}P95Ms`] < budget, `${id}: p95 must be < ${budget} ms`);
    if (id === 'nearbyWarm') {
      need(entry.context.state === 'warm', 'nearbyWarm: warm measurements required');
      need(entry.maxCards !== undefined && entry.maxCards <= 20 && entry.browseLlmCalls === 0,
        'nearbyWarm: <= 20 cards and zero browse LLM calls required');
    }
    const native = id.startsWith('cachedTripOpen');
    need(entry.context.execution === (native ? 'physical-device' : 'deployed-service'),
      `${id}: ${native ? 'physical-device' : 'deployed-service'} measurement required`);
    if (native) need(entry.context.platform === (id === 'cachedTripOpenIos' ? 'ios' : 'android'), `${id}: matching named iOS/Android phone required`);
  }
  const audit = packet.imports;
  fresh(audit.observedAt, 'imports');
  need(audit.reviewer && audit.command && audit.corpusRevision && audit.parserVersion && audit.matcherVersion && audit.samplingPlan,
    'imports: reviewer, command, corpus/parser/matcher versions and representative sampling plan required');
  artifacts(audit.artifacts, 'imports');
  need(new Set(audit.items.map(e => e.fixtureId)).size === audit.items.length, 'imports: duplicate fixture IDs');
  const assigned = audit.items.filter(e => e.decision === 'auto');
  const supported = assigned.filter(e => e.supported);
  metrics.auditedSupportedAssignments = supported.length;
  metrics.importPrecision = supported.length ? supported.filter(e => e.fieldsCorrect && e.expectedTrip !== null && e.assignedTrip === e.expectedTrip).length / supported.length : 0;
  metrics.undoRate = assigned.length ? assigned.filter(e => e.undone).length / assigned.length : 0;
  metrics.complaints = audit.items.filter(e => e.complaint).length;
  metrics.unnoticedErrors = audit.items.filter(e => e.unnoticedError).length;
  need(supported.length >= 200, 'imports: at least 200 audited supported automatic assignments required');
  need(metrics.importPrecision >= 0.99, 'imports: precision below 99%');
  need(metrics.undoRate <= 0.02, 'imports: undo above 2%; pause expansion');
  need(assigned.every(e => e.supported && e.source !== 'uncertain-forward'), 'imports: unsupported/uncertain-forward automatic assignment');
  need(assigned.every(e => e.expectedTrip !== null && e.expectedTrip === e.assignedTrip), 'imports: wrong-trip assignment; pause automation');
  need(metrics.complaints === 0 && metrics.unnoticedErrors === 0, 'imports: complaints/unnoticed errors require investigation');
  return { passed: failures.length === 0, failures, metrics };
}
