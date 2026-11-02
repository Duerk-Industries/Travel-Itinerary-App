import request from 'supertest';
import { randomUUID } from 'crypto';
import { app } from '../src/app';
import * as db from '../src/db';
import { evaluateBlogVisibility, evaluateBlogVisibilityContext } from '../src/services/blogVisibilityService';
import { runBlogVisibilityJob } from '../src/services/blogBackgroundWorker';
import type { BlogVisibilityContext } from '../src/blog/visibilityTypes';
import { addTripGuests, addTripMember, canonicalAlias, setDateOfBirth } from './providerRows';
import { registerAndLoginWebUser, seedTiersForTest } from './helpers';
import { clearFeatureFlagCacheForTesting } from '../src/services/entitlementService';

const base: BlogVisibilityContext = { tripId: 'trip', startDate: '2027-05-02', timezone: 'America/New_York',
  organizerTimezone: null, destination: null, earlyRelease: false,
  members: [{ userId: 'a', firstName: 'Alex', dateOfBirth: '1990-01-01', publicByDefault: true, optOut: false, optIn: false }] };

describe('R1 pure visibility policy', () => {
  it('changes at destination midnight, including its exact boundary', () => {
    const before = evaluateBlogVisibilityContext(base, new Date('2027-05-02T03:59:59Z'));
    expect(before).toMatchObject({ isPublic: false, goesPublicOn: '2027-05-02', localDate: '2027-05-01', reasons: ['TRIP_NOT_STARTED'] });
    expect(evaluateBlogVisibilityContext(base, new Date('2027-05-02T04:00:00Z')).isPublic).toBe(true);
  });
  it('stays public after a trip has ended', () => {
    expect(evaluateBlogVisibilityContext(base, new Date('2028-05-02T04:00:00Z')).isPublic).toBe(true);
  });
  it('uses the local calendar for the sixteenth birthday', () => {
    const child = { ...base, members: [{ ...base.members[0], dateOfBirth: '2011-05-02' }] };
    expect(evaluateBlogVisibilityContext(child, new Date('2027-05-02T03:59:59Z')).reasons).toContain('ACCOUNT_UNDER_16');
    expect(evaluateBlogVisibilityContext(child, new Date('2027-05-02T04:00:00Z')).isPublic).toBe(true);
  });
  it('blocks unknown ages and returns every unmet condition', () => {
    const result = evaluateBlogVisibilityContext({ ...base, members: [{ ...base.members[0], dateOfBirth: null, optOut: true }] }, new Date('2027-05-01T12:00:00Z'));
    expect(result.reasons).toEqual(['TRIP_NOT_STARTED', 'ACCOUNT_AGE_UNKNOWN', 'TRAVELER_OPT_OUT']);
  });
  it('allows profile-default exceptions for this trip, but explicit opt-out still wins', () => {
    const member = { ...base.members[0], publicByDefault: false };
    const evaluate = (optIn: boolean, optOut = false) => evaluateBlogVisibilityContext({ ...base, members: [{ ...member, optIn, optOut }] }, new Date('2027-05-03T12:00:00Z'));
    expect(evaluate(false).isPublic).toBe(false);
    expect(evaluate(true).isPublic).toBe(true);
    expect(evaluate(true, true).isPublic).toBe(false);
  });
  it('early release bypasses only the date; the master switch always wins', () => {
    const early = { ...base, earlyRelease: true };
    expect(evaluateBlogVisibilityContext(early, new Date('2027-05-01T12:00:00Z')).isPublic).toBe(true);
    expect(evaluateBlogVisibilityContext(early, new Date(), false).isPublic).toBe(false);
    expect(evaluateBlogVisibilityContext({ ...early, members: [{ ...base.members[0], dateOfBirth: null }] }, new Date()).isPublic).toBe(false);
  });
});

describe('R1 public-read and personal privacy contracts', () => {
  let owner: { token: string; userId: string }, other: { token: string; userId: string }, tripId: string;
  const auth = (user = owner) => ({ Authorization: `Bearer ${user.token}` });
  const privacy = (body: unknown, user = owner) => request(app).patch(`/api/trips/${tripId}/blog/publication/privacy`).set(auth(user)).send(body);
  const publicRead = async () => { const alias = await canonicalAlias(tripId); return request(app).get(`/public/blog/${alias!.usernameSlug}/${alias!.tripSlug}`); };
  const createTrip = async () => (await request(app).post('/api/trips/wizard').set(auth()).send({ name: `R1 ${randomUUID()}`, startDate: '2027-05-02', endDate: '2027-05-05', participants: [] }).expect(201)).body.trip.id as string;
  beforeAll(async () => { await db.initDb(); await seedTiersForTest(); });
  beforeEach(async () => {
    for (const flag of ['trip_blog', 'trip_blog_public_sharing']) await db.setFeatureFlag(flag, true, null);
    clearFeatureFlagCacheForTesting();
    const user = async (firstName: string) => {
      const account = await registerAndLoginWebUser({ firstName, lastName: 'R1', email: `r1-${randomUUID()}@example.com`, password: 'secret123' });
      await setDateOfBirth(account.userId, '1990-01-01'); return account;
    };
    owner = await user('Alex'); other = await user('Blair'); tripId = await createTrip();
    await db.setTripTimezone(tripId, 'America/New_York');
    await addTripMember(tripId, other.userId);
  });
  it('goes public from the worker at local midnight without a private blog read', async () => {
    await runBlogVisibilityJob(new Date('2027-05-02T03:59:59Z'));
    expect(await canonicalAlias(tripId)).toBeDefined(); // reserve the URL before publication
    expect((await evaluateBlogVisibility(tripId, new Date('2027-05-02T03:59:59Z'))).isPublic).toBe(false);
    // Public reads flip at midnight even when the hourly worker has not run again.
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] });
    try {
      jest.setSystemTime(new Date('2027-05-02T03:59:59Z'));
      expect((await publicRead()).status).toBe(404);
      jest.setSystemTime(new Date('2027-05-02T04:00:00Z'));
      expect((await publicRead()).status).toBe(200);
    } finally { jest.useRealTimers(); }
    await runBlogVisibilityJob(new Date('2027-05-02T04:00:00Z'));
    expect(await canonicalAlias(tripId)).toBeDefined();
    expect((await evaluateBlogVisibility(tripId, new Date('2028-05-02T04:00:00Z'))).isPublic).toBe(true);
  });
  it('keeps opt-outs personal and rejects attempts to target another traveler', async () => {
    await request(app).post(`/api/trips/${tripId}/blog/publication/request`).set(auth()).expect(201);
    expect((await publicRead()).status).toBe(200);
    await privacy({ optOut: true }).expect(200);
    await privacy({ optOut: false }, other).expect(200);
    expect((await publicRead()).status).toBe(404);
    await privacy({ optOut: false, userId: owner.userId }, other).expect(400);
    await privacy({ optOut: false }).expect(200);
    const response = await publicRead(); expect(response.status).toBe(200); expect(response.headers['cache-control']).toContain('no-store');
    // A membership/DOB change must take effect without waiting for the worker.
    await setDateOfBirth(other.userId, '2012-01-01');
    expect((await publicRead()).status).toBe(404);
    await request(app).post(`/api/trips/${tripId}/blog/publication/request`).set(auth()).expect(409);
    await setDateOfBirth(other.userId, null); expect((await publicRead()).status).toBe(404);
    await db.deleteTrip(other.userId, tripId); // leaving a shared trip keeps the group membership
    expect((await publicRead()).status).toBe(200);
  });
  it('isolates profile-private opt-ins across existing and later trips, ignoring non-account guests', async () => {
    await addTripGuests(tripId, 2);
    await request(app).patch('/api/account/blog-defaults').set(auth()).send({ publicByDefault: false }).expect(200);
    const first = await privacy({ optIn: true }).expect(200);
    expect(first.body.reasons).not.toContain('TRAVELER_OPT_OUT');
    const another = await createTrip();
    expect((await evaluateBlogVisibility(another, new Date('2027-05-03T12:00:00Z'))).isPublic).toBe(false);
    expect((await evaluateBlogVisibility(tripId, new Date('2027-05-03T12:00:00Z'))).isPublic).toBe(true);
    await privacy({ optOut: true }).expect(200);
    expect((await evaluateBlogVisibility(tripId, new Date('2027-05-03T12:00:00Z'))).isPublic).toBe(false);
  });
});
