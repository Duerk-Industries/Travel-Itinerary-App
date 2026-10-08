/// <reference types="jest" />
/// <reference types="node" />
import zlib from 'node:zlib';
import { closePool, getJobLease, initDb, releaseJobLease, setJobLeaseCursor, tryAcquireJobLease } from '../src/db';

jest.mock('../src/ai/capture/gcsClient', () => ({
  getAiCaptureGcsTarget: jest.fn(() => ({ bucketName: 'captures', objectPrefix: '' })),
  getAiCaptureBucket: jest.fn(),
}));

const capture = (captureId: string, capturedAt: string) => ({
  captureId, capturedAt, featureKey: 'parsing', outcome: 'success', provider: 'openai', model: 'gpt-4o-mini', payload: {},
});

describe('job leases (adapter)', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
  });
  afterAll(async () => closePool());

  it('grants one holder at a time, lets the holder renew, and hands over after release or expiry', async () => {
    const name = `lease-${Date.now()}`;
    const a = await tryAcquireJobLease(name, 'replica-a', 60_000);
    expect(a).toMatchObject({ name, holder: 'replica-a', cursor: null });
    expect(await tryAcquireJobLease(name, 'replica-b', 60_000)).toBeNull();
    expect(await tryAcquireJobLease(name, 'replica-a', 60_000)).toMatchObject({ holder: 'replica-a' });

    expect(await setJobLeaseCursor(name, 'replica-b', '2026-07-05')).toBe(false); // not the holder
    expect(await setJobLeaseCursor(name, 'replica-a', '2026-07-05')).toBe(true);

    await releaseJobLease(name, 'replica-a');
    const b = await tryAcquireJobLease(name, 'replica-b', 60_000);
    expect(b).toMatchObject({ holder: 'replica-b', cursor: '2026-07-05' }); // cursor survives handover
  });

  it('lets a new holder take over an expired lease', async () => {
    const name = `lease-expired-${Date.now()}`;
    await tryAcquireJobLease(name, 'crashed-replica', -1_000); // already expired
    expect(await tryAcquireJobLease(name, 'replica-c', 60_000)).toMatchObject({ holder: 'replica-c' });
    expect(await getJobLease(name)).toMatchObject({ holder: 'replica-c' });
  });
});

describe('readGcsAiCaptureRecordsForDay', () => {
  it('reads one day by glob, handles gzipped and transcoded objects, and skips evaluations and other days', async () => {
    const day = '2026-07-05';
    const file = (name: string, body: Buffer) => ({ name, download: jest.fn(async () => [body]) });
    const files = [
      file(`parsing/${day}/a.json.gz`, zlib.gzipSync(JSON.stringify(capture('a', `${day}T10:00:00.000Z`)))),
      file(`parsing/${day}/b.json.gz`, Buffer.from(JSON.stringify(capture('b', `${day}T11:00:00.000Z`)))), // already decompressed
      file(`parsing/${day}/a.evaluation.json.gz`, zlib.gzipSync(JSON.stringify({ score: 1 }))),
      file(`parsing/${day}/c.json.gz`, zlib.gzipSync(JSON.stringify(capture('c', '2026-07-04T23:59:00.000Z')))), // wrong day
      file(`parsing/${day}/broken.json.gz`, Buffer.from('not json')),
    ];
    const getFiles = jest.fn(async () => [files]);
    const gcs = require('../src/ai/capture/gcsClient') as { getAiCaptureBucket: jest.Mock };
    gcs.getAiCaptureBucket.mockReturnValue({ getFiles });

    const { readGcsAiCaptureRecordsForDay } = require('../src/ai/analytics/captureBrowser') as typeof import('../src/ai/analytics/captureBrowser');
    const records = await readGcsAiCaptureRecordsForDay(day);

    expect(getFiles).toHaveBeenCalledWith({ prefix: undefined, matchGlob: `*/${day}/*.json.gz` });
    expect(records.map((r) => r.captureId).sort()).toEqual(['a', 'b']);
    expect(files[2].download).not.toHaveBeenCalled();
  });
});
