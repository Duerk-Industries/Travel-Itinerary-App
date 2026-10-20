import request from 'supertest';
import { randomUUID } from 'crypto';
import { app } from '../src/app';
import { initDb, setFeatureFlag, getCurrentDbProvider } from '../src/db';
import { cleanupTestUsersByEmail, confirmWebUser, loginWebUser, registerWebUser } from './helpers';
import { clearDayFactsCacheForTests } from '../src/services/blogDayFactsService';

// Gap-closing plan section 1.3: followers only get coarse, opt-in, lodging-suppressed map points;
// travelers get their own. Photo geotags are seeded directly (upload-time gating is covered elsewhere).
// Runs on pg-mem by default and on the Firestore emulator with JEST_DB_PROVIDER=firebase.
const isFirebase = () => getCurrentDbProvider() === 'firebase';
const sql = (text: string, params: unknown[] = []) => (require('../src/db.postgres') as typeof import('../src/db.postgres')).queryBlog<any>(text, params);
const firestore = () => (require('../src/db.firebase') as typeof import('../src/db.firebase')).getDb();
describe('blog day facts mapPoints', () => {
  const traveler = { firstName: 'Map', lastName: 'Traveler', email: `blog-map-points-traveler-${randomUUID().slice(0, 8)}@example.com`, password: 'Password123!' };
  const follower = { firstName: 'Map', lastName: 'Follower', email: `blog-map-points-follower-${randomUUID().slice(0, 8)}@example.com`, password: 'Password123!' };
  const dayDate = '2027-04-05';
  let travelerToken = '';
  let followerToken = '';
  let tripId = '';
  let userId = '';

  const seedPhoto = async (dayId: string, lat: number, lng: number, minute: number, inTrip: () => string = () => tripId) => {
    const tripOf = inTrip();
    const itemId = randomUUID();
    const assetId = randomUUID();
    const capturedAt = `${dayDate}T10:${String(minute).padStart(2, '0')}:00Z`;
    if (isFirebase()) {
      await firestore().collection('blog_items').doc(itemId).set({ tripId: tripOf, blogDayId: dayId, localDate: dayDate, kindKey: 'media.photo', audience: 'followers', deletedAt: null });
      await firestore().collection('blog_media_assets').doc(assetId).set({ tripId: tripOf, blogItemId: itemId, state: 'ready', mediaKind: 'photo', capturedAt, capturedLat: lat, capturedLng: lng });
      return;
    }
    await sql(
      `INSERT INTO blog_items (id, trip_id, blog_day_id, kind_key, audience, sort_key, author_user_id, last_editor_user_id)
       VALUES ($1,$2,$3,'media.photo','followers',$4,$5,$5)`,
      [itemId, tripOf, dayId, String(minute).padStart(3, '0'), userId]
    );
    await sql(
      `INSERT INTO blog_media_assets (id, trip_id, uploader_user_id, storage_account_user_id, media_kind_key, state, object_key, physical_bytes, billable_bytes, captured_at, captured_lat, captured_lng)
       VALUES ($1,$2,$3,$3,'photo','ready',$4,1,1,$5,$6,$7)`,
      [assetId, tripOf, userId, `trip-blog/${assetId}`, capturedAt, lat, lng]
    );
    await sql('INSERT INTO blog_item_assets (item_id, asset_id, position) VALUES ($1,$2,0)', [itemId, assetId]);
  };
  const setLodgingCoordinates = async (lat: number, lng: number) => {
    if (isFirebase()) {
      const snap = await firestore().collection('lodgings').where('trip_id', '==', tripId).get();
      await Promise.all(snap.docs.map((d: any) => d.ref.update({ lat, lng })));
    } else await sql('UPDATE lodgings SET lat=$2, lng=$3 WHERE trip_id=$1', [tripId, lat, lng]);
  };
  const facts = async (token: string) =>
    (await request(app).get(`/api/trips/${tripId}/blog/days/${dayDate}/facts`).set('Authorization', `Bearer ${token}`).expect(200)).body;

  beforeAll(async () => {
    await initDb();
    for (const flag of ['trip_blog', 'trip_blog_social_layer', 'trip_blog_day_facts']) await setFeatureFlag(flag, true, null);
    await registerWebUser(traveler);
    await confirmWebUser(traveler.email);
    const t = await loginWebUser(traveler);
    travelerToken = t.body.token;
    userId = t.body.user.id;
    await registerWebUser(follower);
    await confirmWebUser(follower.email);
    const f = await loginWebUser(follower);
    followerToken = f.body.token;
    const trip = await request(app)
      .post('/api/trips/wizard')
      .set('Authorization', `Bearer ${travelerToken}`)
      .send({ name: 'Map Points Trip', startDate: dayDate, endDate: dayDate, participants: [] })
      .expect(201);
    tripId = trip.body.trip?.id ?? trip.body.id;
    await request(app).get(`/api/trips/${tripId}/blog`).set('Authorization', `Bearer ${travelerToken}`).expect(200);
    let dayId: string;
    if (isFirebase()) {
      await firestore().collection('trip_followers').doc(randomUUID()).set({ tripId, followerUserId: f.body.user.id });
      const day = await firestore().collection('blog_days').where('tripId', '==', tripId).where('localDate', '==', dayDate).limit(1).get();
      dayId = day.docs[0].id;
    } else {
      await sql('INSERT INTO trip_followers (id, trip_id, follower_user_id) VALUES ($1,$2,$3)', [randomUUID(), tripId, f.body.user.id]);
      dayId = (await sql('SELECT id FROM blog_days WHERE trip_id=$1 AND local_date=$2::date', [tripId, dayDate])).rows[0].id;
    }
    await seedPhoto(dayId, 48.85837, 2.29448, 1);
    await seedPhoto(dayId, 48.86061, 2.33764, 2);
    await seedPhoto(dayId, 48.87463, 2.29502, 3);
  });
  afterAll(async () => { await cleanupTestUsersByEmail([traveler.email, follower.email]); });
  beforeEach(() => { clearDayFactsCacheForTests(); });

  it('shows the traveler their own exact points and gives a follower nothing by default', async () => {
    const mine = await facts(travelerToken);
    expect(mine.mapPoints.precision).toBe('exact');
    expect(mine.mapPoints.points).toHaveLength(3);
    const theirs = await facts(followerToken);
    expect(theirs.mapPoints).toBeUndefined();
    expect(JSON.stringify(theirs)).not.toContain('48.858');
    expect(theirs.facts.find((x: any) => x.key === 'dayMap')).toBeUndefined();
  });

  it('gives a follower coarse points once opted in, hides them near a lodging, and withdraws at once', async () => {
    await request(app).patch(`/api/trips/${tripId}/blog`).set('Authorization', `Bearer ${travelerToken}`).send({ sharedMapEnabled: true }).expect(200);
    const shared = await facts(followerToken);
    expect(shared.mapPoints.precision).toBe('approximate');
    expect(shared.mapPoints.points).toEqual([{ lat: 48.86, lng: 2.29 }, { lat: 48.86, lng: 2.34 }, { lat: 48.87, lng: 2.3 }]);
    expect(JSON.stringify(shared)).not.toMatch(/48\.858|2\.2944|48\.8606|2\.3376|48\.8746/);

    await request(app)
      .post('/api/lodgings')
      .set('Authorization', `Bearer ${travelerToken}`)
      .send({ tripId, name: 'Home Base', checkInDate: dayDate, checkOutDate: dayDate, rooms: 1, totalCost: 100, costPerNight: 100, address: '1 Rue Test', paidBy: [] })
      .expect(201);
    await setLodgingCoordinates(48.8584, 2.2945);
    clearDayFactsCacheForTests();
    const nearHome = await facts(followerToken);
    expect(nearHome.mapPoints.points).toHaveLength(2);
    expect(JSON.stringify(nearHome)).not.toContain('Home Base');

    // No cache clear: withdrawing consent must apply on the very next request.
    await request(app).patch(`/api/trips/${tripId}/blog`).set('Authorization', `Bearer ${travelerToken}`).send({ sharedMapEnabled: false }).expect(200);
    expect((await facts(followerToken)).mapPoints).toBeUndefined();
  });

  it('previews exactly what followers would see, for travelers only', async () => {
    const preview = await request(app).get(`/api/trips/${tripId}/blog/map-sharing-preview`).set('Authorization', `Bearer ${travelerToken}`).expect(200);
    expect(preview.headers['cache-control']).toContain('no-store');
    expect(preview.body.days).toEqual([{ dayDate, points: expect.any(Array) }]);
    expect(preview.body.days[0].points.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(preview.body)).not.toMatch(/48\.858|2\.2944|48\.8606|2\.3376|48\.8746/);
    await request(app).get(`/api/trips/${tripId}/blog/map-sharing-preview`).set('Authorization', `Bearer ${followerToken}`).expect(403);
  });

  it("never mixes in another trip's photos taken on the same date", async () => {
    const other = await request(app).post('/api/trips/wizard').set('Authorization', `Bearer ${travelerToken}`)
      .send({ name: 'Same Day Elsewhere', startDate: dayDate, endDate: dayDate, participants: [] }).expect(201);
    const otherTripId = other.body.trip?.id ?? other.body.id;
    await request(app).get(`/api/trips/${otherTripId}/blog`).set('Authorization', `Bearer ${travelerToken}`).expect(200);
    const otherDayId = isFirebase()
      ? (await firestore().collection('blog_days').where('tripId', '==', otherTripId).where('localDate', '==', dayDate).limit(1).get()).docs[0].id
      : (await sql('SELECT id FROM blog_days WHERE trip_id=$1 AND local_date=$2::date', [otherTripId, dayDate])).rows[0].id;
    await seedPhoto(otherDayId, 35.6586, 139.7454, 10, () => otherTripId);
    await seedPhoto(otherDayId, 35.7101, 139.8107, 11, () => otherTripId);
    await seedPhoto(otherDayId, 35.6762, 139.6503, 12, () => otherTripId);
    await request(app).patch(`/api/trips/${tripId}/blog`).set('Authorization', `Bearer ${travelerToken}`).send({ sharedMapEnabled: true }).expect(200);
    const mine = await facts(travelerToken);
    expect(mine.mapPoints.points).toHaveLength(3);
    // Followers may see fewer areas (lodging suppression), never more, and never the other trip's.
    const theirs = await facts(followerToken);
    expect(theirs.mapPoints.points.length).toBeGreaterThanOrEqual(2);
    expect(theirs.mapPoints.points.length).toBeLessThanOrEqual(3);
    for (const body of [mine, theirs]) expect(JSON.stringify(body)).not.toMatch(/35\.6|35\.7|139\./);
    const preview = (await request(app).get(`/api/trips/${tripId}/blog/map-sharing-preview`).set('Authorization', `Bearer ${travelerToken}`).expect(200)).body;
    expect(JSON.stringify(preview)).not.toMatch(/35\.6|35\.7|139\./);
  });
});
