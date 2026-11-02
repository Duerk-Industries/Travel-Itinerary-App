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

describe('trip blog publication privacy', () => {
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

  it('releases immediately for two adults, retires consent, and respects each traveler’s opt-out', async () => {
    await registerWithDob(a1, '1988-05-01'); await confirmWebUser(a1.email);
    await registerWithDob(a2, '1992-03-01'); await confirmWebUser(a2.email);
    const first = await loginWebUser(a1), second = await loginWebUser(a2);
    const auth1 = { Authorization: `Bearer ${first.body.token}` }, auth2 = { Authorization: `Bearer ${second.body.token}` };
    const tripId = await createTripWithMembers(first.body.token, 'Two Adult Trip', [second.body.user.id]);
    await seedBlogText(tripId, first.body.token);
    const result = await request(app).post(`/api/trips/${tripId}/blog/publication/request`).set(auth1).expect(201);
    expect(result.body).toMatchObject({ state: 'public', pendingCount: 0 });
    await request(app).post(`/api/trips/${tripId}/blog/publication/1/consent`).set(auth2).send({ decision: 'approved' }).expect(410);
    const alias = (await canonicalAlias(tripId))!;
    await request(app).get(`/public/blog/${alias.usernameSlug}/${alias.tripSlug}`).expect(200);
    await request(app).post(`/api/trips/${tripId}/blog/publication/revoke`).set(auth2).expect(204);
    await request(app).get(`/public/blog/${alias.usernameSlug}/${alias.tripSlug}`).expect(404);
    await request(app).patch(`/api/trips/${tripId}/blog/publication/privacy`).set(auth1).send({ optOut: false }).expect(200);
    await request(app).get(`/public/blog/${alias.usernameSlug}/${alias.tripSlug}`).expect(404);
    await request(app).patch(`/api/trips/${tripId}/blog/publication/privacy`).set(auth2).send({ optOut: false }).expect(200);
    await request(app).get(`/public/blog/${alias.usernameSlug}/${alias.tripSlug}`).expect(200);
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
    expect(res.body.code).toBe('BLOG_NOT_ELIGIBLE');
  });
});
