import request from 'supertest';

// Wrap the real storage client so the test can see which objects get signed and how, without touching GCS.
const mockReadUrl = jest.fn(async (key: string) => `https://signed.example/${key}`);
jest.mock('../src/services/blogStorageClient', () => ({
  ...jest.requireActual('../src/services/blogStorageClient'),
  createBlogReadUrl: (key: string, options?: unknown) => mockReadUrl(key, options as never),
}));
const mockWeather = jest.fn(async () => ({ weather: [], apiCalls: 0 }));
jest.mock('../src/apis/openMeteoWeatherApi', () => ({
  ...jest.requireActual('../src/apis/openMeteoWeatherApi'),
  fetchOverviewWeather: (...args: unknown[]) => (mockWeather as (...a: unknown[]) => unknown)(...args),
}));

import { app } from '../src/app';
import { initDb, setFeatureFlag } from '../src/db';
import { cleanupTestUsersByEmail, confirmWebUser, futureDateString, futureDateStringPlusDays, loginWebUser, registerWebUser } from './helpers';

// The trip blog load (GET /api/trips/:id/blog) used to sign URLs for every photo in the trip, ask storage whether each
// object existed, and wait on an external weather call. These tests pin the cheaper behavior and run on whichever
// database provider the suite uses (pg-mem by default; Firestore with JEST_DB_PROVIDER=firebase + an emulator).
describe('GET /api/trips/:id/blog load path', () => {
  const owner = { firstName: 'Load', lastName: 'Path', email: 'blog-load-path@example.com', password: 'Password123!' };
  const DAY_1 = futureDateString();
  const DAY_2 = futureDateStringPlusDays(1);
  const DAY_5 = futureDateStringPlusDays(4);
  const DAY_6 = futureDateStringPlusDays(5);
  let token = '';
  let tripId = '';
  let photoDay1 = { id: '', itemId: '' };
  let photoDay6 = { id: '', itemId: '' };
  let removedPhoto = { id: '', itemId: '' };

  const auth = () => ({ Authorization: `Bearer ${token}` });
  const uploadPhoto = async (dayDate: string, key: string) => {
    const init = await request(app).post(`/api/trips/${tripId}/blog/media/upload-init`).set(auth()).set('Idempotency-Key', key)
      .send({ dayDate, mediaKind: 'photo', mimeType: 'image/jpeg', byteSize: 1024 }).expect(201);
    await request(app).post(`/api/trips/${tripId}/blog/media/${init.body.asset.id}/complete`).set(auth()).send({ physicalBytes: 1024 }).expect(200);
    return { id: String(init.body.asset.id), itemId: String(init.body.asset.blogItemId ?? init.body.asset.itemId ?? '') };
  };
  const loadBlog = async (query = '') => (await request(app).get(`/api/trips/${tripId}/blog${query}`).set(auth()).expect(200)).body;
  const photosOn = (blog: any, dayDate: string) =>
    (blog.days.find((day: any) => day.localDate === dayDate)?.items ?? []).flatMap((item: any) => (item.assets ? item.assets : [item])).filter((entry: any) => entry.assetId || entry.mediaKind);
  const signedKeys = () => mockReadUrl.mock.calls.map(([key]) => String(key));

  beforeAll(async () => {
    await initDb();
    await setFeatureFlag('trip_blog', true, null);
    await setFeatureFlag('trip_blog_photo_uploads', true, null);
    await registerWebUser(owner);
    await confirmWebUser(owner.email);
    const login = await loginWebUser(owner);
    token = login.body.token;
    const trip = await request(app).post('/api/trips/wizard').set(auth()).send({ name: 'Load Path Trip', startDate: DAY_1, endDate: DAY_6, participants: [] }).expect(201);
    tripId = trip.body.trip?.id ?? trip.body.id;
    await request(app).get(`/api/trips/${tripId}/blog`).set(auth()).expect(200);
    photoDay1 = await uploadPhoto(DAY_1, 'load-path-day1');
    removedPhoto = await uploadPhoto(DAY_2, 'load-path-removed');
    photoDay6 = await uploadPhoto(DAY_6, 'load-path-day6');
  });
  afterAll(async () => { await cleanupTestUsersByEmail([owner.email]); });
  beforeEach(() => { mockReadUrl.mockClear(); mockWeather.mockClear(); });

  it('signs URLs only for photos on the days in the requested page', async () => {
    const blog = await loadBlog('?limit=2');
    expect(blog.days.map((day: any) => day.localDate)).toEqual([DAY_1, DAY_2]);
    expect(photosOn(blog, DAY_1)).toHaveLength(1);
    expect(photosOn(blog, DAY_1)[0].primaryUrl).toContain(photoDay1.id);

    const keys = signedKeys();
    expect(keys.some((key) => key.includes(photoDay1.id))).toBe(true);
    expect(keys.some((key) => key.includes(photoDay6.id))).toBe(false);
  });

  it('returns a later day\'s photos when that page is requested by cursor', async () => {
    const blog = await loadBlog(`?limit=2&cursor=${DAY_5}`);
    expect(blog.days.map((day: any) => day.localDate)).toEqual([DAY_6]);
    expect(photosOn(blog, DAY_6)).toHaveLength(1);
    const keys = signedKeys();
    expect(keys.some((key) => key.includes(photoDay6.id))).toBe(true);
    expect(keys.some((key) => key.includes(photoDay1.id))).toBe(false);
  });

  it('skips the storage existence check for ready photos', async () => {
    await loadBlog('?limit=2');
    const calls = mockReadUrl.mock.calls.filter(([key]) => String(key).includes(photoDay1.id));
    expect(calls.length).toBeGreaterThan(0);
    for (const [, options] of calls) expect(options).toEqual({ verifyExists: false });
  });

  it('does not wait on an external weather lookup, and days carry no weather', async () => {
    const blog = await loadBlog();
    expect(mockWeather).not.toHaveBeenCalled();
    for (const day of blog.days) expect(day.weather).toBeUndefined();
  });

  it('leaves out a photo whose blog item was removed', async () => {
    const before = await loadBlog('?limit=2');
    expect(photosOn(before, DAY_2).map((photo: any) => photo.assetId ?? photo.id)).toContain(removedPhoto.id);

    const itemId = photosOn(before, DAY_2).find((photo: any) => (photo.assetId ?? photo.id) === removedPhoto.id).id;
    await request(app).delete(`/api/trips/${tripId}/blog/items/${itemId}`).set(auth()).expect(204);

    const after = await loadBlog('?limit=2');
    expect(photosOn(after, DAY_2)).toHaveLength(0);
    expect(photosOn(after, DAY_1)).toHaveLength(1);
  });

  it('returns the same trip when asked for every day at once', async () => {
    const blog = await loadBlog('?limit=10');
    expect(blog.days).toHaveLength(6);
    expect(photosOn(blog, DAY_1)).toHaveLength(1);
    expect(photosOn(blog, DAY_6)).toHaveLength(1);
  });
});
