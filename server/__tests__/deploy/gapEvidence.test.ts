import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPacket, evaluatePacket, PERFORMANCE_BUDGETS, percentile95, verifyArtifact } from '../../../scripts/lib/gapEvidence';
import type { EvidencePacket } from '../../../scripts/lib/gapEvidence';

describe('Gap-closing release evidence', () => {
  const now = new Date('2026-10-20T12:00:00Z');
  const gitSha = 'a'.repeat(40);
  let root: string;
  let packet: EvidencePacket;
  const run = () => evaluatePacket(packet, { gitSha, environment: 'staging', root, now });
  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'gap-evidence-'));
    writeFileSync(path.join(root, 'trace.txt'), 'Synthetic unit-test artifact, never release evidence.');
    const artifacts = [{ path: 'trace.txt', sha256: createHash('sha256')
      .update('Synthetic unit-test artifact, never release evidence.').digest('hex') }];
    packet = createPacket(gitSha, 'staging', now);
    for (const entries of Object.values(packet.checks)) for (const entry of entries) {
      Object.assign(entry, { status: 'passed', observedAt: now.toISOString(), reviewer: 'Test reviewer',
        command: 'test command', notes: 'Synthetic test outcome', artifacts,
        context: { buildId: 'test-build', hardware: 'test phone', os: 'test OS', region: 'test-region',
          url: 'https://invalid.test', execution: 'physical-device', assistiveTechnology: 'test reader',
          completed: '4', participants: '5', unnoticedLossOrSharing: '0' } });
    }
    packet.performance = (Object.keys(PERFORMANCE_BUDGETS) as Array<keyof typeof PERFORMANCE_BUDGETS>).map(id => ({
      id, observedAt: now.toISOString(), reviewer: 'Test reviewer', command: 'test benchmark', artifacts,
      context: { hardware: 'test phone', payloadMix: 'small trip', concurrency: 1, region: 'test-region',
        state: 'warm', buildId: 'test-build', execution: id.startsWith('cachedTripOpen') ? 'physical-device' : 'deployed-service',
        platform: id === 'cachedTripOpenAndroid' ? 'android' : 'ios' },
      samplesMs: Array(20).fill(100), maxCards: 20, browseLlmCalls: 0,
    }));
    packet.imports = { observedAt: now.toISOString(), reviewer: 'Test reviewer', command: 'test audit',
      corpusRevision: 'test-corpus', parserVersion: 'test-parser', matcherVersion: 'test-matcher',
      samplingPlan: 'Synthetic unit-test corpus', artifacts,
      items: Array.from({ length: 200 }, (_, i) => ({ fixtureId: `fixture-${i}`, supported: true,
        source: 'direct', itemType: 'flight', decision: 'auto', expectedTrip: 'trip-a', assignedTrip: 'trip-a',
        fieldsCorrect: true, auditedBy: 'Test reviewer', undone: false, complaint: false, unnoticedError: false })),
    };
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('reports all five areas and passes only a complete packet', () => {
    expect(run()).toMatchObject({ passed: true, metrics: { importPrecision: 1, auditedSupportedAssignments: 200, nearbyWarmP95Ms: 100 } });
    packet = createPacket(gitSha, 'staging', now);
    const result = run();
    expect(result.passed).toBe(false);
    for (const area of ['deployment/', 'device/', 'accessibility/', 'performance:', 'imports:']) {
      expect(result.failures.some(f => f.startsWith(area))).toBe(true);
    }
  });
  it('rejects missing, duplicated, pending and failed acceptance checks', () => {
    packet.checks.device.pop();
    packet.checks.deployment.push(packet.checks.deployment[0]);
    packet.checks.accessibility[0].status = 'pending';
    packet.checks.accessibility[1].status = 'failed';
    expect(run().failures.join('\n')).toMatch(/missing android-push-receipt/);
    expect(run().failures.join('\n')).toMatch(/duplicate check IDs/);
    expect(run().failures.join('\n')).toMatch(/pending/);
    expect(run().failures.join('\n')).toMatch(/failed/);
  });
  it('rejects changed release, environment, stale and future observations', () => {
    packet.gitSha = 'b'.repeat(40);
    packet.environment = 'production';
    packet.checks.device[0].observedAt = '2026-10-01T00:00:00Z';
    packet.performance[0].observedAt = '2026-10-21T00:00:00Z';
    expect(run().failures).toEqual(expect.arrayContaining(['Release commit mismatch', 'Release environment mismatch']));
    expect(run().failures.filter(f => f.includes('older than 14 days'))).toHaveLength(2);
  });
  it('fails closed for invalid schemas, missing identity and incomplete physical device evidence', () => {
    expect(evaluatePacket({}, { gitSha, environment: 'staging', root, now }).passed).toBe(false);
    packet.checks.device[0].context.execution = 'mock';
    packet.checks.device[1].context.os = '';
    expect(run().passed).toBe(false);
  });
  it('verifies artifacts and rejects missing files, tampering and traversal', () => {
    mkdirSync(path.join(root, 'nested'));
    expect(() => verifyArtifact(path.join(root, 'nested'), { path: '../trace.txt', sha256: '0'.repeat(64) }))
      .toThrow('Artifact must stay inside');
    packet.checks.device[0].artifacts = [{ path: '../outside.txt', sha256: '0'.repeat(64) }];
    packet.checks.device[1].artifacts = [{ path: 'missing.txt', sha256: '0'.repeat(64) }];
    writeFileSync(path.join(root, 'trace.txt'), 'changed');
    expect(run().passed).toBe(false);
    expect(run().failures.join('\n')).toMatch(/SHA-256 mismatch/);
  });
  it('uses nearest-rank p95, enforces strict budgets and refuses short samples', () => {
    expect(percentile95([...Array(19).fill(100), 10000])).toBe(100);
    packet.performance[0].samplesMs = Array(20).fill(300);
    expect(run().failures).toContain('nearbyWarm: p95 must be < 300 ms');
    packet.performance[0].samplesMs = [1];
    expect(run().passed).toBe(false);
  });
  it('requires real deployed measurements and native phone timing', () => {
    packet.performance[0].context.execution = 'physical-device';
    packet.performance[3].context.platform = 'desktop';
    expect(run().failures.join('\n')).toMatch(/deployed-service measurement required/);
    expect(run().failures.join('\n')).toMatch(/named iOS\/Android phone/);
  });
  it('enforces usability completion and unnoticed loss/sharing gates', () => {
    const entry = packet.checks.accessibility.find(e => e.id === 'novice-core-tasks-recovery')!;
    entry.context.completed = '3';
    entry.context.unnoticedLossOrSharing = '1';
    expect(run().failures.join('\n')).toMatch(/4\/5/);
    expect(run().failures.join('\n')).toMatch(/unnoticed loss\/sharing/);
  });
  it('does not inflate precision with suggestions or unsupported fixtures', () => {
    packet.imports.items[0].decision = 'suggested';
    expect(run().metrics.auditedSupportedAssignments).toBe(199);
    expect(run().passed).toBe(false);
    packet.imports.items[0].decision = 'auto';
    packet.imports.items[0].supported = false;
    expect(run().metrics.auditedSupportedAssignments).toBe(199);
    expect(run().failures.join('\n')).toMatch(/unsupported\/uncertain-forward/);
  });
  it('checks the 99% precision boundary and independently blocks wrong-trip assignments', () => {
    packet.imports.items[0].fieldsCorrect = false;
    packet.imports.items[1].fieldsCorrect = false;
    expect(run().passed).toBe(true);
    packet.imports.items[2].fieldsCorrect = false;
    expect(run().failures).toContain('imports: precision below 99%');
    packet.imports.items[2].fieldsCorrect = true;
    packet.imports.items[0].assignedTrip = 'wrong-trip';
    expect(run().failures).toContain('imports: wrong-trip assignment; pause automation');
  });
  it('blocks uncertain forwarding, duplicate fixtures, excessive undo and unresolved complaints', () => {
    packet.imports.items[0].source = 'uncertain-forward';
    packet.imports.items[1].fixtureId = packet.imports.items[0].fixtureId;
    packet.imports.items.slice(0, 5).forEach(e => { e.undone = true; });
    packet.imports.items[0].complaint = true;
    packet.imports.items[0].unnoticedError = true;
    const result = run();
    expect(result.metrics.undoRate).toBe(0.025);
    expect(result.metrics.complaints).toBe(1);
    expect(result.failures.join('\n')).toMatch(/duplicate fixture/);
    expect(result.failures.join('\n')).toMatch(/pause expansion/);
    expect(result.failures.join('\n')).toMatch(/unsupported\/uncertain-forward/);
    expect(result.failures.join('\n')).toMatch(/require investigation/);
  });
});
