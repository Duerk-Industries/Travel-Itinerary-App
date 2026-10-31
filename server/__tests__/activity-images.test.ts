/// <reference types="jest" />
/// <reference types="node" />
import request from 'supertest';
import { app } from '../src/app';
import { closePool, initDb, insertActivity } from '../src/db';
import { fetchUnsplashPhotoForActivity } from '../src/apis/unsplashCallers';
import { registerAndLoginWebUser, seedTiersForTest, setUserTierInDb } from './helpers';
import { activityImageKey, attachActivityImages, resolveActivityImages } from '../src/services/activityImageService';

jest.mock('../src/apis/unsplashCallers', () => ({ ...jest.requireActual('../src/apis/unsplashCallers'), fetchUnsplashPhotoForActivity: jest.fn() }));

const search = fetchUnsplashPhotoForActivity as jest.Mock;
const photo = { url: 'https://images.unsplash.com/photo-1', credit: 'Ada Lovelace, Unsplash', pageUrl: 'https://unsplash.com/photos/1' };

describe('pictures for activities', () => {
  const uniq = `${Date.now()}`;
  const unique = (name: string) => `${name} ${uniq}`;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.UNSPLASH_ACCESS_KEY = 'test-key';
    process.env.ACTIVITY_PHOTO_LOOKUPS_IN_TESTS = '1';
    await initDb();
  });

  beforeEach(() => search.mockReset());

  afterAll(async () => {
    delete process.env.UNSPLASH_ACCESS_KEY;
    delete process.env.ACTIVITY_PHOTO_LOOKUPS_IN_TESTS;
    await closePool();
  });

  it('keys an activity by its name, ignoring case, accents and punctuation', () => {
    expect(activityImageKey('  Musée d\'Orsay! ')).toBe(activityImageKey('musee d orsay'));
    expect(activityImageKey('')).toBe('');
  });

  it('finds a photo once, credits the photographer, and reuses it for every activity of that name', async () => {
    const name = unique('Gondola Ride');
    search.mockResolvedValue(photo);
    const first = await resolveActivityImages([{ name, place: 'Venice' }], { awaitLookups: 5 });
    expect(first.get(activityImageKey(name))).toEqual(photo);
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith('test-key', name, 'Venice');

    const [again] = await attachActivityImages([{ name: name.toUpperCase(), geoCity: 'Venice' }]);
    expect(again.image).toEqual(photo);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('remembers that nothing was found, and does not remember a search the provider limit stopped', async () => {
    const nothing = unique('Quiet Afternoon');
    search.mockResolvedValue(null);
    expect((await resolveActivityImages([{ name: nothing }], { awaitLookups: 5 })).get(activityImageKey(nothing))).toBeNull();
    await resolveActivityImages([{ name: nothing }], { awaitLookups: 5 });
    expect(search).toHaveBeenCalledTimes(1);

    const limited = unique('Rate Limited Walk');
    search.mockReset();
    search.mockResolvedValue(undefined);
    await resolveActivityImages([{ name: limited }], { awaitLookups: 5 });
    await resolveActivityImages([{ name: limited }], { awaitLookups: 5 });
    expect(search).toHaveBeenCalledTimes(2);
  });

  it('answers without waiting when no searches are awaited, and a failing search costs nothing', async () => {
    const name = unique('Background Tour');
    let release: (value: typeof photo) => void = () => undefined;
    search.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const [now] = await attachActivityImages([{ name }]);
    expect(now.image).toBeNull();
    release(photo);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const [later] = await attachActivityImages([{ name }]);
    expect(later.image).toEqual(photo);

    search.mockRejectedValue(new Error('network'));
    const [failed] = await attachActivityImages([{ name: unique('Broken Lookup') }]);
    expect(failed.image).toBeNull();
  });

  it('puts the picture on the activities the API lists, filling it in once the background search has finished', async () => {
    await seedTiersForTest();
    const user = await registerAndLoginWebUser({ email: `act-img+${uniq}@example.com`, firstName: 'Img', lastName: 'Tester', password: 'testtest' });
    await setUserTierInDb(user.userId, 'premium');
    const groups = await request(app).get('/api/groups').set('Authorization', `Bearer ${user.token}`).expect(200);
    const trip = await request(app).post('/api/trips').set('Authorization', `Bearer ${user.token}`).send({ name: `Img trip ${uniq}`, groupId: groups.body[0].id }).expect(201);
    const name = unique('Harbour Cruise');
    await insertActivity({ userId: user.userId, tripId: trip.body.id, status: 'Proposed', activityType: 'Tour', date: '2026-12-01', name, startLocation: '', startTime: '', duration: '', cost: 0, freeCancelBy: null, bookedOn: '', reference: '', notes: '', paidBy: [], travelerIds: [] } as any);
    search.mockResolvedValue(photo);
    const list = () => request(app).get(`/api/activities?tripId=${trip.body.id}`).set('Authorization', `Bearer ${user.token}`).expect(200).then((res) => res.body.find((item: any) => item.name === name));

    expect((await list()).image).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect((await list()).image).toEqual(photo);
  });
});
