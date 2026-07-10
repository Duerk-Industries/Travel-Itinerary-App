/// <reference types="jest" />
/// <reference types="node" />

import fs from 'fs/promises';
import path from 'path';
import zlib from 'zlib';
import { promisify } from 'util';
import { listLocalAiCaptures } from '../../src/ai/analytics/captureBrowser';

const gzip = promisify(zlib.gzip);

// Matches LOCAL_CAPTURE_ROOT in captureBrowser.ts (path is not injectable).
const CAPTURE_ROOT = path.resolve(__dirname, '../../logs/ai-capture');
const TEST_DIR = path.join(CAPTURE_ROOT, 'test-capture-browser');

const writeCapture = async (fileName: string, record: Record<string, unknown>) => {
  const gz = await gzip(Buffer.from(JSON.stringify(record), 'utf8'));
  await fs.mkdir(TEST_DIR, { recursive: true });
  await fs.writeFile(path.join(TEST_DIR, fileName), gz);
};

describe('captureBrowser anonymousUserId filtering', () => {
  afterAll(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
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
