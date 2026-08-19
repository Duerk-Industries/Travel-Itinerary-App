/// <reference types="jest" />
/// <reference types="node" />

import fs from 'fs/promises';
import fsSync from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { promisify } from 'util';
import { listLocalAiCaptures } from '../../src/ai/analytics/captureBrowser';

const gzip = promisify(zlib.gzip);

describe('captureBrowser anonymousUserId filtering', () => {
  let captureRoot = '';
  let previousCaptureRoot: string | undefined;

  const writeCapture = async (fileName: string, record: Record<string, unknown>) => {
    const gz = await gzip(Buffer.from(JSON.stringify(record), 'utf8'));
    await fs.writeFile(path.join(captureRoot, fileName), gz);
  };

  beforeEach(() => {
    // Isolated per-test directory rather than the real (gitignored) logs/ai-capture — a
    // long-running local dev environment accumulates thousands of real capture files there,
    // and scanning/gunzipping all of them made this test's result depend on however much
    // unrelated capture data happened to already be on disk. See AI_CAPTURE_LOCAL_ROOT in
    // captureBrowser.ts.
    captureRoot = fsSync.mkdtempSync(path.join(os.tmpdir(), 'ai-capture-browser-'));
    previousCaptureRoot = process.env.AI_CAPTURE_LOCAL_ROOT;
    process.env.AI_CAPTURE_LOCAL_ROOT = captureRoot;
  });

  afterEach(async () => {
    if (previousCaptureRoot === undefined) delete process.env.AI_CAPTURE_LOCAL_ROOT;
    else process.env.AI_CAPTURE_LOCAL_ROOT = previousCaptureRoot;
    await fs.rm(captureRoot, { recursive: true, force: true });
  });

  it('filters captures by anonymousUserId and returns it on each item', async () => {
    await writeCapture('match.json.gz', {
      captureSchemaVersion: 1,
      captureId: 'capture-anon-match',
      featureKey: 'test-feature',
      capturedAt: '2026-07-04T00:00:00.000Z',
      anonymousUserId: 'anon-target',
      outcome: 'success',
      payload: {},
    });
    await writeCapture('nomatch.json.gz', {
      captureSchemaVersion: 1,
      captureId: 'capture-anon-nomatch',
      featureKey: 'test-feature',
      capturedAt: '2026-07-04T00:00:00.000Z',
      anonymousUserId: 'anon-other',
      outcome: 'success',
      payload: {},
    });

    const results = await listLocalAiCaptures({ anonymousUserId: 'anon-target' });

    expect(results.map((r) => r.captureId)).toContain('capture-anon-match');
    expect(results.map((r) => r.captureId)).not.toContain('capture-anon-nomatch');
    expect(results.find((r) => r.captureId === 'capture-anon-match')?.anonymousUserId).toBe('anon-target');
  });
});
