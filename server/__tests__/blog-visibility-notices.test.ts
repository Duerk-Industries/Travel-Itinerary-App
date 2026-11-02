import request from 'supertest';
import { randomUUID } from 'crypto';
import { app } from '../src/app';
import * as db from '../src/db';
import { runBlogVisibilityJob } from '../src/services/blogBackgroundWorker';
import { ensureBlogPublicNotice } from '../src/services/blogVisibilityNoticeService';
import { addTripMember, setDateOfBirth } from './providerRows';
import { registerAndLoginWebUser, seedTiersForTest } from './helpers';
import { clearFeatureFlagCacheForTesting } from '../src/services/entitlementService';

// R5: notices before and when the blog goes public. The trip starts 2027-05-02 in New York (UTC-4 in May).
const DAY_BEFORE = new Date('2027-05-01T16:00:00Z');
const MIDNIGHT = new Date('2027-05-02T04:00:00Z');

type User = { token: string; userId: string };

describe('R5 blog visibility notices', () => {
  let owner: User, other: User, tripId: string;
  const auth = (user: User) => ({ Authorization: `Bearer ${user.token}` });
  const notices = async (user: User) => {
    const body = (await request(app).get('/api/notifications?limit=50').set(auth(user)).expect(200)).body;
    return (body.notifications as any[]).filter(n => n.category === 'blog_visibility' && n.tripId === tripId);
  };
  const account = async (firstName: string, dateOfBirth: string | null = '1990-01-01'): Promise<User> => {
    const created = await registerAndLoginWebUser({ firstName, lastName: 'R5', email: `r5-${randomUUID()}@example.com`, password: 'secret123' });
    await setDateOfBirth(created.userId, dateOfBirth);
    return created;
  };

  beforeAll(async () => { await db.initDb(); await seedTiersForTest(); });
  beforeEach(async () => {
    for (const flag of ['trip_blog', 'trip_blog_public_sharing', 'notifications_in_app']) await db.setFeatureFlag(flag, true, null);
    clearFeatureFlagCacheForTesting();
    owner = await account('Alex');
    other = await account('Blair');
    tripId = (await request(app).post('/api/trips/wizard').set(auth(owner)).send({ name: `R5 ${randomUUID()}`, startDate: '2027-05-02', endDate: '2027-05-05', participants: [] }).expect(201)).body.trip.id;
    await db.setTripTimezone(tripId, 'America/New_York');
    await addTripMember(tripId, other.userId);
  });

  it('tells every account traveler the day before, and again once it is public, each only once', async () => {
    await runBlogVisibilityJob(DAY_BEFORE);
    await runBlogVisibilityJob(new Date(DAY_BEFORE.getTime() + 3_600_000)); // the next hourly run
    for (const user of [owner, other]) {
      const sent = await notices(user);
      expect(sent).toHaveLength(1);
      expect(sent[0].title).toMatch(/goes public tomorrow/);
      expect(sent[0].body).toMatch(/preview it as the public will see it, or make it private/);
    }

    await runBlogVisibilityJob(MIDNIGHT);
    await runBlogVisibilityJob(new Date(MIDNIGHT.getTime() + 3_600_000));
    for (const user of [owner, other]) {
      const titles = (await notices(user)).map(n => n.title);
      expect(titles).toHaveLength(2);
      expect(titles.some(t => /is now public/.test(t))).toBe(true);
    }
  });

  it('sends nothing earlier than the day before', async () => {
    await runBlogVisibilityJob(new Date('2027-04-29T16:00:00Z'));
    expect(await notices(owner)).toHaveLength(0);
  });

  it('sends nothing while an account traveler is under 16', async () => {
    await setDateOfBirth(other.userId, '2015-01-01');
    await runBlogVisibilityJob(DAY_BEFORE);
    await runBlogVisibilityJob(MIDNIGHT);
    expect(await notices(owner)).toHaveLength(0);
    expect(await notices(other)).toHaveLength(0);
  });

  it('sends nothing while a traveler has opted out', async () => {
    await request(app).patch(`/api/trips/${tripId}/blog/publication/privacy`).set(auth(other)).send({ optOut: true }).expect(200);
    await runBlogVisibilityJob(DAY_BEFORE);
    await runBlogVisibilityJob(MIDNIGHT);
    expect(await notices(owner)).toHaveLength(0);
  });

  it('shows someone who joins a public-blog trip the notice once, on their first visit', async () => {
    await runBlogVisibilityJob(MIDNIGHT);
    // The route reads the real clock, so move it to just after the trip's local midnight. The new traveler signs up
    // inside that window so their session token is valid there.
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] });
    try {
      jest.setSystemTime(new Date(MIDNIGHT.getTime() + 3_600_000));
      const late = await account('Casey');
      await addTripMember(tripId, late.userId);
      expect(await notices(late)).toHaveLength(0);
      const first = await request(app).post(`/api/trips/${tripId}/blog/publication/notice`).set(auth(late)).expect(200);
      expect(first.body.sent).toBe(true);
      await request(app).post(`/api/trips/${tripId}/blog/publication/notice`).set(auth(late)).expect(200);
      expect(await notices(late)).toHaveLength(1);
    } finally { jest.useRealTimers(); }
    // A traveler who already had the transition notice does not get a second one.
    expect(await ensureBlogPublicNotice(tripId, owner.userId, new Date(MIDNIGHT.getTime() + 3_600_000))).toBe(true);
    expect(await notices(owner)).toHaveLength(1);
  });

  it('shows nothing on a visit while the blog is private, and refuses people outside the trip', async () => {
    const early = await request(app).post(`/api/trips/${tripId}/blog/publication/notice`).set(auth(other)).expect(200);
    expect(early.body.sent).toBe(false);
    expect(await notices(other)).toHaveLength(0);
    const stranger = await account('Drew');
    await request(app).post(`/api/trips/${tripId}/blog/publication/notice`).set(auth(stranger)).expect(403);
  });
});
