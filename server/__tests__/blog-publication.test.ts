import request from 'supertest';
import { randomUUID } from 'crypto';
import { app } from '../src/app';
import { initDb, setFeatureFlag } from '../src/db';
import { addTripMember, canonicalAlias, epochState, storedBlog } from './providerRows';
import { confirmWebUser, loginWebUser, cleanupTestUsersByEmail, futureDateString } from './helpers';

const TRIP_DAY = futureDateString();

const registerWithDob = async (user: { firstName: string; lastName: string; email: string; password: string }, dateOfBirth: string | null) => {
  return request(app)
    .post('/api/web-auth/register')
    .send({ ...user, passwordConfirm: user.password, dateOfBirth })
    .expect(201);
};

describe('trip blog publication consent', () => {
  const solo = { firstName: 'Solo', lastName: 'Traveler', email: 'blog-pub-solo@example.com', password: 'Password123!' };
  const a1 = { firstName: 'Requester', lastName: 'Adult', email: 'blog-pub-a1@example.com', password: 'Password123!' };
  const a2 = { firstName: 'CoTraveler', lastName: 'Adult', email: 'blog-pub-a2@example.com', password: 'Password123!' };
  const noDob = { firstName: 'NoDob', lastName: 'Traveler', email: 'blog-pub-nodob@example.com', password: 'Password123!' };

  beforeAll(async () => {
    await initDb();
    await setFeatureFlag('trip_blog', true, null);
    await setFeatureFlag('trip_blog_public_sharing', true, null);
  });

  afterAll(async () => {
    await cleanupTestUsersByEmail([solo.email, a1.email, a2.email, noDob.email]);
  });

  const createTripWithMembers = async (ownerToken: string, ownerName: string, otherUserIds: string[] = []) => {
    const trip = await request(app)
      .post('/api/trips/wizard')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: ownerName, startDate: TRIP_DAY, endDate: TRIP_DAY, participants: [] })
      .expect(201);
    const tripId = trip.body.trip?.id ?? trip.body.id;
    for (const userId of otherUserIds) await addTripMember(tripId, userId);
    return tripId;
  };

  const seedBlogText = async (tripId: string, token: string) => {
    await request(app)
      .post(`/api/trips/${tripId}/blog/items`)
      .set('Authorization', `Bearer ${token}`)
      .send({ dayDate: TRIP_DAY, body: 'Day one recap' })
      .expect(201);
  };

  it('auto-approves and syncs trip_blogs visibility when the requester is the only account traveler', async () => {
    await registerWithDob(solo, '1990-01-01');
    await confirmWebUser(solo.email);
    const login = await loginWebUser(solo);
    const token = login.body.token;
    const tripId = await createTripWithMembers(token, 'Solo Publication Trip');
    await seedBlogText(tripId, token);

    const res = await request(app)
      .post(`/api/trips/${tripId}/blog/publication/request`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    expect(res.body.state).toBe('public');
    expect(res.body.pendingCount).toBe(0);

    const blogRow = (await storedBlog(tripId))!;
    expect(blogRow.visibilityState).toBe('public');
  });

  it('requires unanimous consent from every other account-holding traveler, and syncs private->public->private through decline/revoke', async () => {
    await registerWithDob(a1, '1988-05-01');
    await confirmWebUser(a1.email);
    const login1 = await loginWebUser(a1);
    const token1 = login1.body.token;
    const userId1 = login1.body.user.id;

    await registerWithDob(a2, '1992-03-01');
    await confirmWebUser(a2.email);
    const login2 = await loginWebUser(a2);
    const token2 = login2.body.token;
    const userId2 = login2.body.user.id;

    const tripId = await createTripWithMembers(token1, 'Two Adult Trip', [userId2]);
    await seedBlogText(tripId, token1);

    const requestRes = await request(app)
      .post(`/api/trips/${tripId}/blog/publication/request`)
      .set('Authorization', `Bearer ${token1}`)
      .expect(201);
    expect(requestRes.body.state).toBe('pending_consent');
    expect(requestRes.body.pendingCount).toBe(1);

    let blogRow = (await storedBlog(tripId))!;
    expect(blogRow.visibilityState).toBe('pending_consent');

    const epoch = requestRes.body.epoch;

    // Requester cannot unilaterally approve on behalf of the other traveler by re-posting.
    await request(app)
      .post(`/api/trips/${tripId}/blog/publication/${epoch}/consent`)
      .set('Authorization', `Bearer ${token2}`)
      .send({ decision: 'declined' })
      .expect(204);

    blogRow = (await storedBlog(tripId))!;
    expect(blogRow.visibilityState).toBe('private');
    expect(await epochState(tripId, epoch)).toBe('expired');

    // Re-request and this time approve unanimously.
    const secondRequest = await request(app)
      .post(`/api/trips/${tripId}/blog/publication/request`)
      .set('Authorization', `Bearer ${token1}`)
      .expect(201);
    const secondEpoch = secondRequest.body.epoch;
    expect(secondEpoch).toBeGreaterThan(epoch);

    await request(app)
      .post(`/api/trips/${tripId}/blog/publication/${secondEpoch}/consent`)
      .set('Authorization', `Bearer ${token2}`)
      .send({ decision: 'approved' })
      .expect(204);

    blogRow = (await storedBlog(tripId))!;
    expect(blogRow.visibilityState).toBe('public');
    expect(blogRow.visibilityEpoch).toBe(secondEpoch);

    // The public route must now serve this trip.
    const identity = (await canonicalAlias(tripId))!;
    await request(app).get(`/public/blog/${identity.usernameSlug}/${identity.tripSlug}`).expect(200);

    // Revoke — any single consent-eligible traveler can pull it back to private unilaterally.
    await request(app)
      .post(`/api/trips/${tripId}/blog/publication/revoke`)
      .set('Authorization', `Bearer ${token2}`)
      .expect(204);

    blogRow = (await storedBlog(tripId))!;
    expect(blogRow.visibilityState).toBe('private');
    await request(app).get(`/public/blog/${identity.usernameSlug}/${identity.tripSlug}`).expect(404);
  });

  it('blocks a publication request until every account traveler has completed their date-of-birth profile', async () => {
    await registerWithDob(noDob, null);
    await confirmWebUser(noDob.email);
    const login = await loginWebUser(noDob);
    const token = login.body.token;
    const tripId = await createTripWithMembers(token, 'Missing DOB Trip');
    await seedBlogText(tripId, token);

    const res = await request(app)
      .post(`/api/trips/${tripId}/blog/publication/request`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);
    expect(res.body.code).toBe('PROFILE_COMPLETION_REQUIRED');
  });
});
