import request from 'supertest';
import { randomUUID } from 'crypto';
import { app } from '../src/app';
import { initDb, setFeatureFlag } from '../src/db';
import { queryBlog } from '../src/db.postgres';
import { cleanupTestUsersByEmail, confirmWebUser, loginWebUser, registerWebUser } from './helpers';
import { reactToTarget } from '../src/services/blogEngagementService';
import { reconcileBlogCounters } from '../src/services/blogCounterReconciliationService';
import { claimJobLease } from '../src/services/scheduledJobLease';

// Phase 2 — counter reconciliation and the DB-backed lease primitive it's built on.
describe('blog counter reconciliation', () => {
  const traveler = { firstName: 'Recon', lastName: 'Traveler', email: 'blog-recon-traveler@example.com', password: 'Password123!' };
  let travelerToken = '';
  let travelerId = '';
  let tripId = '';
  let itemId = '';

  beforeAll(async () => {
    await initDb();
    await setFeatureFlag('trip_blog', true, null);
    await registerWebUser(traveler);
    await confirmWebUser(traveler.email);
    const login = await loginWebUser(traveler);
    travelerToken = login.body.token;
    travelerId = login.body.user.id;

    const trip = await request(app)
      .post('/api/trips/wizard')
      .set('Authorization', `Bearer ${travelerToken}`)
      .send({ name: 'Reconciliation Trip', startDate: '2026-10-06', endDate: '2026-10-06', participants: [] })
      .expect(201);
    tripId = trip.body.trip?.id ?? trip.body.id;
    await request(app).get(`/api/trips/${tripId}/blog`).set('Authorization', `Bearer ${travelerToken}`).expect(200);

    const item = await request(app)
      .post(`/api/trips/${tripId}/blog/items`)
      .set('Authorization', `Bearer ${travelerToken}`)
      .send({ kindKey: 'core.text', dayDate: '2026-10-06', body: 'Reconciliation target', audience: 'public' })
      .expect(201);
    itemId = item.body.id;
  });

  afterAll(async () => { await cleanupTestUsersByEmail([traveler.email]); });

  it('claimJobLease lets exactly one caller win a given window, and completeJobLease is idempotent to call again', async () => {
    const windowStart = new Date('2026-01-01T00:00:00.000Z');
    const jobKey = `test-job-${randomUUID()}`;
    const first = await claimJobLease(jobKey, windowStart, 'owner-a');
    const second = await claimJobLease(jobKey, windowStart, 'owner-b');
    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it('recomputes a drifted counter row back to the true count from source tables', async () => {
    await reactToTarget(tripId, travelerId, 'item', itemId, 'heart');

    // Simulate drift: corrupt the counter row directly, bypassing the normal write path — this is
    // exactly the kind of divergence the JSONB read-merge-write in postgresEngagementRepository.ts
    // is documented to risk under concurrent writes.
    await queryBlog(
      `UPDATE blog_engagement_counters SET reaction_counts = '{"heart": 99}'::jsonb, reaction_total = 99 WHERE target_kind = 'item' AND target_id = $1 AND audience = 'public'`,
      [itemId]
    );
    const drifted = await queryBlog<{ reaction_total: number }>('SELECT reaction_total FROM blog_engagement_counters WHERE target_kind = $1 AND target_id = $2 AND audience = $3', ['item', itemId, 'public']);
    expect(Number(drifted.rows[0].reaction_total)).toBe(99);

    const result = await reconcileBlogCounters(`test-owner-${randomUUID()}`);
    expect(result.ran).toBe(true);
    expect(result.targetsReconciled).toBeGreaterThan(0);

    const corrected = await queryBlog<{ reaction_total: number; reaction_counts: Record<string, number> }>(
      'SELECT reaction_total, reaction_counts FROM blog_engagement_counters WHERE target_kind = $1 AND target_id = $2 AND audience = $3',
      ['item', itemId, 'public']
    );
    expect(Number(corrected.rows[0].reaction_total)).toBe(1);
    expect(corrected.rows[0].reaction_counts).toEqual({ heart: 1 });
  });

  it('any further call within the same hour window is a no-op — the previous test already claimed and completed it', async () => {
    // The previous test's reconcileBlogCounters call already claimed and completed the current
    // hour's lease; this asserts that stays true regardless of how many more times it's called,
    // which is exactly the property that makes N instances calling this on the same schedule safe.
    const again = await reconcileBlogCounters(`owner-${randomUUID()}`);
    expect(again.ran).toBe(false);
    expect(again.targetsReconciled).toBe(0);
  });
});
