import request from 'supertest';
import { randomUUID } from 'crypto';
import { app } from '../src/app';
import { initDb, setFeatureFlag } from '../src/db';
import { followTripAs, insertPublicAlias, insertPublicEpoch, setStoredVisibility } from './providerRows';
import { cleanupTestUsersByEmail, confirmWebUser, loginWebUser, registerWebUser } from './helpers';
import { clearFeatureFlagCacheForTesting } from '../src/services/entitlementService';

// The public page offers a comment box to signed-in followers and a Hide button to travelers. This
// endpoint is how it learns who is looking -- and it must tell everyone else nothing.
describe('public blog viewer context', () => {
  const user = (tag: string) => ({ firstName: 'Viewer', lastName: tag, email: `blog-public-viewer-${tag.toLowerCase()}@example.com`, password: 'Password123!' });
  const owner = user('Owner');
  const follower = user('Follower');
  const stranger = user('Stranger');
  const dayDate = '2026-12-02';
  const slugs = { username: 'public-viewer-owner', trip: 'public-viewer-trip' };
  const viewerUrl = `/public/blog/${slugs.username}/${slugs.trip}/viewer`;

  const tokens: Record<string, string> = {};
  let tripId = '';

  const signUp = async (u: ReturnType<typeof user>) => {
    await registerWebUser(u);
    await confirmWebUser(u.email);
    const login = await loginWebUser(u);
    return { token: login.body.token as string, id: login.body.user.id as string };
  };

  beforeAll(async () => {
    await initDb();
    for (const flag of ['trip_blog', 'trip_blog_social_layer', 'trip_blog_comments', 'trip_blog_public_engagement']) await setFeatureFlag(flag, true, null);
    clearFeatureFlagCacheForTesting();
    const o = await signUp(owner);
    const f = await signUp(follower);
    const s = await signUp(stranger);
    tokens.owner = o.token; tokens.follower = f.token; tokens.stranger = s.token;
    const trip = await request(app).post('/api/trips/wizard').set('Authorization', `Bearer ${o.token}`)
      .send({ name: 'Public Viewer Trip', startDate: dayDate, endDate: dayDate, participants: [] }).expect(201);
    tripId = trip.body.trip?.id ?? trip.body.id;
    await request(app).get(`/api/trips/${tripId}/blog`).set('Authorization', `Bearer ${o.token}`).expect(200);
    await followTripAs(tripId, f.id);
    await request(app).post(`/api/trips/${tripId}/blog/items`).set('Authorization', `Bearer ${o.token}`)
      .send({ kindKey: 'core.text', dayDate, body: 'A public note', audience: 'public' }).expect(201);
    await setStoredVisibility(tripId, 'public');
    await insertPublicEpoch(tripId, o.id);
    await insertPublicAlias(tripId, o.id, slugs.username, slugs.trip);
  });

  afterAll(async () => { await cleanupTestUsersByEmail([owner.email, follower.email, stranger.email]); });

  it('tells anonymous visitors, and bad tokens, only that they are not signed in', async () => {
    for (const authorization of [undefined, 'Bearer not-a-token']) {
      const req = request(app).get(viewerUrl);
      const res = await (authorization ? req.set('Authorization', authorization) : req).expect(200);
      expect(res.body).toEqual({ signedIn: false, role: null });
      expect(res.headers['cache-control']).toContain('no-store');
    }
  });

  it('gives a signed-in stranger no trip id and no day ids', async () => {
    const res = await request(app).get(viewerUrl).set('Authorization', `Bearer ${tokens.stranger}`).expect(200);
    expect(res.body).toEqual({ signedIn: true, role: null });
  });

  it('lets a follower comment but not moderate, and a traveler do both', async () => {
    const asFollower = await request(app).get(viewerUrl).set('Authorization', `Bearer ${tokens.follower}`).expect(200);
    expect(asFollower.body).toMatchObject({ signedIn: true, role: 'follower', tripId, canComment: true, canModerate: false });
    expect(asFollower.body.days).toEqual([{ localDate: dayDate, id: expect.any(String) }]);
    const asTraveler = await request(app).get(viewerUrl).set('Authorization', `Bearer ${tokens.owner}`).expect(200);
    expect(asTraveler.body).toMatchObject({ role: 'traveler', canComment: true, canModerate: true });
  });

  it('404s for a blog that is not public', async () => {
    await request(app).get('/public/blog/nobody/nothing/viewer').set('Authorization', `Bearer ${tokens.follower}`).expect(404);
  });

  it('end to end: a follower comments from the public page, it shows publicly, a traveler hides it', async () => {
    const viewer = (await request(app).get(viewerUrl).set('Authorization', `Bearer ${tokens.follower}`).expect(200)).body;
    const dayId = viewer.days[0].id;
    const posted = await request(app).post(`/api/trips/${viewer.tripId}/blog/day/${dayId}/comments`).set('Authorization', `Bearer ${tokens.follower}`)
      .set('Idempotency-Key', randomUUID()).send({ body: 'Looks amazing, enjoy!' }).expect(201);
    const publicList = async () => (await request(app).get(`/public/blog/${slugs.username}/${slugs.trip}/engagement`).query({ dayDate }).expect(200)).body.comments as any[];

    expect(await publicList()).toEqual([expect.objectContaining({ id: posted.body.id, body: 'Looks amazing, enjoy!', authorRole: 'follower' })]);
    expect(Object.keys((await publicList())[0])).not.toContain('authorUserId');

    await request(app).post(`/api/trips/${tripId}/blog/comments/${posted.body.id}/hide`).set('Authorization', `Bearer ${tokens.follower}`).expect(403);
    await request(app).post(`/api/trips/${tripId}/blog/comments/${posted.body.id}/hide`).set('Authorization', `Bearer ${tokens.owner}`).expect(200);
    expect(await publicList()).toEqual([]);
  });
});
