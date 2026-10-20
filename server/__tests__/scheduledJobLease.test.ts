import { randomUUID } from 'crypto';

// Runs on pg-mem by default and on the Firestore emulator with JEST_DB_PROVIDER=firebase.
describe('scheduled job lease', () => {
  beforeAll(async () => { await (require('../src/db') as typeof import('../src/db')).initDb(); });
  const lease = () => require('../src/services/scheduledJobLease') as typeof import('../src/services/scheduledJobLease');

  it('lets exactly one of several racing instances claim a window', async () => {
    const job = `job-${randomUUID()}`;
    const window = new Date('2027-01-01T10:00:00.000Z');
    const results = await Promise.all(['a', 'b', 'c', 'd'].map(owner => lease().claimJobLease(job, window, owner)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await lease().claimJobLease(job, window, 'late')).toBe(false);
  });

  it('keeps windows and jobs independent, and completing is safe to call', async () => {
    const job = `job-${randomUUID()}`;
    const first = new Date('2027-01-01T10:00:00.000Z');
    const next = new Date('2027-01-01T11:00:00.000Z');
    expect(await lease().claimJobLease(job, first, 'a')).toBe(true);
    expect(await lease().claimJobLease(job, next, 'a')).toBe(true);
    expect(await lease().claimJobLease(`other-${job}`, first, 'a')).toBe(true);
    await expect(lease().completeJobLease(job, first)).resolves.toBeUndefined();
  });
});
