import { randomUUID } from 'crypto';
import { initDb } from '../src/db';
import { docs, isFirebase, sql } from './providerRows';
import { putNotificationWork, claimNotificationWork, finishNotificationWork } from '../src/services/notificationWorkRepository';
import { cancellationInstant } from '../src/services/planningNotificationScheduler';
import { selectPlanningDayPoints } from '../src/utils/planningMapPoints';
import fs from 'fs';
import path from 'path';

beforeAll(async () => { await initDb(); });
it('recovers expired leases and fences stale workers without duplicating completed work', async () => {
  const id = `lease-test-${randomUUID()}`;
  await putNotificationWork({ id, kind: 'deadline', dueAt: 10, data: { marker: 'original' } });
  const first = (await claimNotificationWork(100)).find(job => job.id === id)!;
  expect(first).toBeDefined();
  expect((await claimNotificationWork(101)).some(job => job.id === id)).toBe(false);
  const recovered = (await claimNotificationWork(121000)).find(job => job.id === id)!;
  expect(recovered.leaseToken).not.toBe(first.leaseToken);
  expect(await finishNotificationWork(first)).toBe(false);
  expect(await finishNotificationWork(recovered)).toBe(true);
  await putNotificationWork({ id, kind: 'deadline', dueAt: 0, data: { marker: 'must not reset' } });
  expect((await claimNotificationWork(200000)).some(job => job.id === id)).toBe(false);
  const stored = isFirebase()
    ? (await docs('notification_work')).find(row => row._id === id)?.data
    : (await sql('SELECT data FROM notification_work WHERE id=$1', [id])).rows[0].data;
  expect(stored.marker).toBe('original');
});
it('uses an explicit fixed UTC policy for date-only deadlines and preserves zoned instants across DST', () => {
  expect(cancellationInstant('2026-11-01')).toBe(Date.parse('2026-11-01T00:00:00Z'));
  expect(cancellationInstant('2026-11-01T01:30:00-04:00')).toBe(Date.parse('2026-11-01T05:30:00Z'));
  expect(cancellationInstant('2026-11-01T01:30:00')).toBeNull();
});
it('retains missing coordinates in the shared list and excludes cancelled stops', () => {
  const points = selectPlanningDayPoints({ date: '2027-05-02', flights: [], lodgings: [], carRentals: [], activities: [
    { id: 'missing', name: 'Manual stop', date: '2027-05-02', status: 'Proposed' },
    { id: 'cancelled', name: 'Cancelled', date: '2027-05-02', status: 'Cancelled', lat: 48, lng: 2 },
  ] });
  expect(points).toHaveLength(1); expect(points[0]).toMatchObject({ id: 'missing', label: 'A' });
  expect(points[0].lat).toBeUndefined();
});
it('keeps the server build mirror identical to the domain source', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../packages/domain/src/planningMapPoints.ts'), 'utf8').replace("from '../../../server/src/types'", "from '../types'");
  const mirror = fs.readFileSync(path.resolve(__dirname, '../src/utils/planningMapPoints.ts'), 'utf8');
  expect(mirror.slice(mirror.indexOf('\n') + 1)).toBe(source);
});
