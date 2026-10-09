import request from 'supertest';
import { randomUUID } from 'crypto';
import { app } from '../src/app';
import { initDb, setFeatureFlag } from '../src/db';
import { queryBlog } from '../src/db.postgres';
import { confirmWebUser, loginWebUser, cleanupTestUsersByEmail, futureDateString } from './helpers';

const TRIP_DAY = futureDateString();

const mkUser = (tag: string) => ({ firstName: tag, lastName: 'Auto', email: `blog-auto-${tag.toLowerCase()}@example.com`, password: 'Password123!' });
const adult = mkUser('Adult');
const other = mkUser('Other');
const minorish = mkUser('Young');
const noDob = mkUser('NoDob');
const optedOut = mkUser('Private');
const adult2 = mkUser('Guesty');

const signUp = async (user: ReturnType<typeof mkUser>, dateOfBirth: string | null) => {
  await request(app)
    .post('/api/web-auth/register')
    .send({ ...user, passwordConfirm: user.password, dateOfBirth })
    .expect(201);
  await confirmWebUser(user.email);
  const login = await loginWebUser(user);
  return { token: login.body.token as string, id: login.body.user.id as string };
};

describe('trip blog is public by default (opt-out)', () => {
  beforeAll(async () => {
    await initDb();
    await setFeatureFlag('trip_blog', true, null);
    await setFeatureFlag('trip_blog_public_sharing', true, null);
  });

  afterAll(async () => {
    await cleanupTestUsersByEmail([adult, other, minorish, noDob, optedOut, adult2].map((user) => user.email));
  });

  const createTrip = async (token: string, name: string, memberIds: string[] = [], guests = 0) => {
    const trip = await request(app)
      .post('/api/trips/wizard')
      .set('Authorization', `Bearer ${token}`)
      .send({ name, startDate: TRIP_DAY, endDate: TRIP_DAY, participants: [] })
      .expect(201);
    const tripId = trip.body.trip?.id ?? trip.body.id;
    const group = await queryBlog<{ group_id: string; created_by?: string }>('SELECT group_id FROM trips WHERE id = $1', [tripId]);
    const groupId = group.rows[0].group_id;
    for (const userId of memberIds) {
      await queryBlog('INSERT INTO group_members (id, group_id, user_id, added_by) VALUES ($1, $2, $3, $3)', [randomUUID(), groupId, userId]);
    }
    if (guests > 0) {
      const owner = await queryBlog<{ user_id: string }>('SELECT user_id FROM group_members WHERE group_id = $1 LIMIT 1', [groupId]);
      for (let i = 0; i < guests; i += 1) {
        await queryBlog('INSERT INTO group_members (id, group_id, guest_name, added_by) VALUES ($1, $2, $3, $4)', [randomUUID(), groupId, `Guest ${i}`, owner.rows[0].user_id]);
      }
    }
    return tripId as string;
  };

  const openBlog = (tripId: string, token: string) =>
    request(app).get(`/api/trips/${tripId}/blog`).set('Authorization', `Bearer ${token}`).expect(200);

  const visibility = async (tripId: string) =>
    (await queryBlog<{ visibility_state: string }>('SELECT visibility_state FROM trip_blogs WHERE trip_id = $1', [tripId])).rows[0]?.visibility_state ?? 'none';

  it('publishes when every traveler is 16+ and nobody has opted out; opt-out/clear toggles it', async () => {
    const solo = await signUp(adult, '1990-01-01');
    const tripId = await createTrip(solo.token, 'Auto Public Trip');
    const res = await openBlog(tripId, solo.token);
    expect(res.body.visibilityState).toBe('public');
    expect(await visibility(tripId)).toBe('public');

    // A traveler makes the blog private: off the public web, still readable by travelers.
    const priv = await request(app).patch(`/api/trips/${tripId}/blog`).set('Authorization', `Bearer ${solo.token}`).send({ publicOptOut: true }).expect(200);
    expect(priv.body.visibilityState).toBe('private');
    expect(priv.body.publicOptOut).toBe(true);
    await openBlog(tripId, solo.token);
    expect(await visibility(tripId)).toBe('private'); // opening the blog never re-publishes it

    // Clearing the toggle publishes again because the travelers still qualify.
    const back = await request(app).patch(`/api/trips/${tripId}/blog`).set('Authorization', `Bearer ${solo.token}`).send({ publicOptOut: false }).expect(200);
    expect(back.body.visibilityState).toBe('public');
    expect(await visibility(tripId)).toBe('public');
  });

  it('does not publish when an account traveler is under 16', async () => {
    const owner = await signUp(other, '1985-06-01');
    const young = await signUp(minorish, '1990-01-01');
    await queryBlog('UPDATE users SET date_of_birth = $2::date WHERE id = $1', [young.id, new Date(Date.now() - 12 * 365 * 86_400_000).toISOString().slice(0, 10)]);
    const withMinor = await createTrip(owner.token, 'Minor Trip', [young.id]);
    await openBlog(withMinor, owner.token);
    expect(await visibility(withMinor)).not.toBe('public');
  });

  it('ignores guests without an account when deciding', async () => {
    const owner = await signUp(adult2, '1991-01-01');
    const tripId = await createTrip(owner.token, 'Guest Ignored Trip', [], 2);
    await openBlog(tripId, owner.token);
    expect(await visibility(tripId)).toBe('public');
  });

  it('does not publish when a traveler has no date of birth', async () => {
    const owner = await signUp(noDob, '1990-01-01');
    await queryBlog('UPDATE users SET date_of_birth = NULL WHERE id = $1', [owner.id]);
    const tripId = await createTrip(owner.token, 'No DOB Trip');
    await openBlog(tripId, owner.token);
    expect(await visibility(tripId)).not.toBe('public');
  });

  it('respects a traveler profile default of private, and exposes the profile toggle', async () => {
    const owner = await signUp(optedOut, '1980-02-02');
    expect((await request(app).get('/api/account/blog-defaults').set('Authorization', `Bearer ${owner.token}`).expect(200)).body.publicByDefault).toBe(true);
    await request(app).patch('/api/account/blog-defaults').set('Authorization', `Bearer ${owner.token}`).send({ publicByDefault: 'nope' }).expect(400);
    await request(app).patch('/api/account/blog-defaults').set('Authorization', `Bearer ${owner.token}`).send({ publicByDefault: false }).expect(200);
    expect((await request(app).get('/api/account/blog-defaults').set('Authorization', `Bearer ${owner.token}`).expect(200)).body.publicByDefault).toBe(false);

    const tripId = await createTrip(owner.token, 'Profile Private Trip');
    await openBlog(tripId, owner.token);
    expect(await visibility(tripId)).not.toBe('public');

    await request(app).patch('/api/account/blog-defaults').set('Authorization', `Bearer ${owner.token}`).send({ publicByDefault: true }).expect(200);
    const otherTrip = await createTrip(owner.token, 'Profile Public Trip');
    await openBlog(otherTrip, owner.token);
    expect(await visibility(otherTrip)).toBe('public');
  });
});
