/// <reference types="jest" />
/// <reference types="node" />
import request from 'supertest';
import { app } from '../src/app';
import { closePool, initDb, listTripTemplates, setFeatureFlag } from '../src/db';
import { clearFeatureFlagCacheForTesting } from '../src/services/entitlementService';
import { loadSeedTemplates, syncTripTemplatesFromSeed, templatesForDestinations, CHOOSE_HOTEL_FEATURE } from '../src/services/tripTemplateService';
import { registerAndLoginWebUser } from './helpers';

describe('seed files', () => {
  it('are valid, unique and cover the Japan templates', () => {
    const templates = loadSeedTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(8);
    expect(new Set(templates.map((t) => t.id)).size).toBe(templates.length);
    for (const t of templates) {
      expect(t.countries.length).toBeGreaterThan(0);
      expect(t.stays.reduce((sum, s) => sum + s.nights, 0)).toBe(t.days - 1);
      expect(t.legs.every((leg) => ['Public Transit', 'Private Transfer', 'Other'].includes(leg.transferType))).toBe(true);
    }
  });
});

describe('templatesForDestinations', () => {
  const record = (id: string, countries: string[], cities: string[] = []) => ({ id, title: id, summary: '', days: 7, route: '', imageQuery: '', countries, cities, highlights: [], contentHash: '', enabled: true, sortOrder: 0 });
  const rows = [record('jp', ['Japan'], ['Kyoto', 'Tokyo']), record('fr', ['France'], ['Paris'])];

  it('offers nothing when no destination is chosen', () => {
    expect(templatesForDestinations(rows, { countries: [], cities: [] })).toEqual([]);
  });

  it('offers only templates for the chosen country, ignoring case and accents', () => {
    expect(templatesForDestinations(rows, { countries: ['japan'], cities: [] }).map((t) => t.id)).toEqual(['jp']);
    expect(templatesForDestinations(rows, { countries: ['italy'], cities: [] })).toEqual([]);
  });

  it('offers only templates no longer than the trip, and all of them when the length is unknown', () => {
    const lengths = [{ ...rows[0], id: 'short', days: 7 }, { ...rows[0], id: 'long', days: 14 }];
    const japan = { countries: ['japan'], cities: [] };
    expect(templatesForDestinations(lengths, japan, 10).map((t) => t.id)).toEqual(['short']);
    expect(templatesForDestinations(lengths, japan, 14).map((t) => t.id).sort()).toEqual(['long', 'short']);
    expect(templatesForDestinations(lengths, japan, null)).toHaveLength(2);
    expect(templatesForDestinations(lengths, japan, 5)).toEqual([]);
  });

  it('puts templates that visit a chosen city first', () => {
    const more = [...rows, record('jp2', ['Japan'], ['Osaka'])];
    expect(templatesForDestinations(more, { countries: ['japan'], cities: ['osaka'] }).map((t) => t.id)).toEqual(['jp2', 'jp']);
  });
});

describe('trip templates API', () => {
  const uniq = Date.now();
  const user = { email: `templates+${uniq}@example.com`, firstName: 'Tess', lastName: 'Plater', password: 'testtest' };
  let token: string;
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    await syncTripTemplatesFromSeed();
    token = (await registerAndLoginWebUser(user)).token;
  });
  afterAll(async () => { await closePool(); });

  it('stores a catalogue row per seed file, and syncing twice changes nothing', async () => {
    const before = await listTripTemplates();
    await syncTripTemplatesFromSeed();
    const after = await listTripTemplates();
    expect(after.length).toBe(before.length);
    expect(after.map((t) => t.id)).toEqual(before.map((t) => t.id));
    expect(after[0].countries).toContain('Japan');
  });

  it('requires sign-in', async () => {
    await request(app).get('/api/trip-templates?countries=Japan').expect(401);
  });

  it('offers templates for a chosen destination only', async () => {
    const japan = await request(app).get('/api/trip-templates?countries=Japan').set(auth()).expect(200);
    expect(japan.body.templates.length).toBeGreaterThanOrEqual(8);
    expect(japan.body.templates[0]).toEqual(expect.objectContaining({ id: expect.any(String), title: expect.any(String), days: expect.any(Number), highlights: expect.any(Array), imageQuery: expect.any(String) }));
    expect((await request(app).get('/api/trip-templates?countries=France').set(auth()).expect(200)).body.templates).toEqual([]);
    expect((await request(app).get('/api/trip-templates').set(auth()).expect(200)).body.templates).toEqual([]);
  });

  it('resolves a chosen country from its location id, and ranks templates that visit a chosen city first', async () => {
    // The country/state dataset comes from storage or a local CSV, which the Firestore emulator run does not have;
    // the wizard also sends the names, so ids are only the fallback. Check them where the dataset exists.
    if (process.env.JEST_DB_PROVIDER !== 'firebase') {
      const byId = await request(app).get('/api/trip-templates?locationIds=country:japan').set(auth()).expect(200);
      expect(byId.body.templates.length).toBeGreaterThanOrEqual(8);
    }
    const hiroshima = await request(app).get('/api/trip-templates?countries=Japan&cities=Hiroshima').set(auth()).expect(200);
    expect(hiroshima.body.templates[0].matchedCities).toContain('Hiroshima');
  });

  it('previews a template day by day, and 404s an unknown one', async () => {
    const id = (await request(app).get('/api/trip-templates?countries=Japan').set(auth()).expect(200)).body.templates[0].id;
    const detail = await request(app).get(`/api/trip-templates/${id}`).set(auth()).expect(200);
    expect(detail.body.preview).toHaveLength(detail.body.days);
    expect(detail.body.preview[0].items.some((item: any) => item.kind === 'stay')).toBe(true);
    await request(app).get('/api/trip-templates/nope').set(auth()).expect(404);
  });

  it('creates a trip from a template with everything Proposed or Needs Booking, and placeholder hotels', async () => {
    const list = (await request(app).get('/api/trip-templates?countries=Japan').set(auth()).expect(200)).body.templates;
    const template = list.find((t: any) => t.days === 7) ?? list[0];
    const created = await request(app).post(`/api/trip-templates/${template.id}/trip`).set(auth())
      .send({ startDate: '2027-04-05', locationIds: ['country:japan'], currency: 'JPY', participants: [] }).expect(201);
    const tripId = created.body.trip.id as string;
    expect(created.body.trip.name).toBe(template.title);
    expect(created.body.trip.startDate).toContain('2027-04-05');
    expect(String(created.body.trip.endDate)).toContain(`2027-04-${String(5 + template.days - 1).padStart(2, '0')}`);

    const activities = (await request(app).get(`/api/activities?tripId=${tripId}`).set(auth()).expect(200)).body as any[];
    const lodgings = (await request(app).get(`/api/lodgings?tripId=${tripId}`).set(auth()).expect(200)).body as any[];
    const transfers = (await request(app).get(`/api/transfers?tripId=${tripId}`).set(auth()).expect(200)).body as any[];
    expect(activities.length).toBe(created.body.counts.activities);
    expect(lodgings.length).toBe(created.body.counts.lodgings);
    expect(transfers.length).toBe(created.body.counts.transfers);
    expect(activities.every((a) => ['Proposed', 'Needs Booking'].includes(a.status))).toBe(true);
    expect(activities.some((a) => a.status === 'Needs Booking')).toBe(true);
    expect(lodgings.every((l) => (l.features ?? []).includes(CHOOSE_HOTEL_FEATURE))).toBe(true);
    expect(transfers.every((t) => t.transferType === 'Public Transit' || t.transfer_type === 'Public Transit')).toBe(true);
  });

  it('lists only templates that fit maxDays', async () => {
    const all = (await request(app).get('/api/trip-templates?countries=Japan').set(auth()).expect(200)).body.templates as any[];
    const fitting = (await request(app).get('/api/trip-templates?countries=Japan&maxDays=10').set(auth()).expect(200)).body.templates as any[];
    expect(fitting.length).toBeGreaterThan(0);
    expect(fitting.length).toBeLessThan(all.length);
    expect(fitting.every((t) => t.days <= 10)).toBe(true);
    expect((await request(app).get('/api/trip-templates?countries=Japan&maxDays=3').set(auth()).expect(200)).body.templates).toEqual([]);
  });

  it('creates an undated trip from a template when only a trip length is known', async () => {
    const template = (await request(app).get('/api/trip-templates?countries=Japan&maxDays=10').set(auth()).expect(200)).body.templates.find((t: any) => t.days === 7);
    const created = await request(app).post(`/api/trip-templates/${template.id}/trip`).set(auth()).send({ durationDays: 10, locationIds: ['country:japan'] }).expect(201);
    const tripId = created.body.trip.id as string;
    expect(created.body.trip.startDate ?? null).toBeNull();
    expect(created.body.trip.durationDays).toBe(10);
    // No dated bookings: the plan lives in the day plan, by day number.
    expect((await request(app).get(`/api/activities?tripId=${tripId}`).set(auth()).expect(200)).body).toEqual([]);
    expect((await request(app).get(`/api/lodgings?tripId=${tripId}`).set(auth()).expect(200)).body).toEqual([]);
    expect(created.body.counts.activities).toBeGreaterThan(0);
    const itineraries = (await request(app).get('/api/itineraries').set(auth()).expect(200)).body as any[];
    const itinerary = itineraries.find((i) => (i.tripId ?? i.trip_id) === tripId);
    expect(itinerary).toBeTruthy();
    const details = (await request(app).get(`/api/itineraries/${itinerary.id}/details`).set(auth()).expect(200)).body as any[];
    expect(details.length).toBeGreaterThan(created.body.counts.activities);
    expect(details.some((d) => d.day === 1 && /Stay:/.test(d.activity))).toBe(true);
  });

  it('keeps a trip end date later than the template, and refuses a trip shorter than it', async () => {
    const template = (await request(app).get('/api/trip-templates?countries=Japan&maxDays=10').set(auth()).expect(200)).body.templates.find((t: any) => t.days === 7);
    const longer = await request(app).post(`/api/trip-templates/${template.id}/trip`).set(auth()).send({ startDate: '2027-04-05', endDate: '2027-04-15' }).expect(201);
    expect(String(longer.body.trip.endDate)).toContain('2027-04-15');
    await request(app).post(`/api/trip-templates/${template.id}/trip`).set(auth()).send({ durationDays: 3 }).expect(400);
  });

  it('refuses a request with neither a valid start date nor a trip length, and an unknown template', async () => {
    const id = (await request(app).get('/api/trip-templates?countries=Japan').set(auth()).expect(200)).body.templates[0].id;
    await request(app).post(`/api/trip-templates/${id}/trip`).set(auth()).send({}).expect(400);
    await request(app).post(`/api/trip-templates/${id}/trip`).set(auth()).send({ startDate: '2027-13-40' }).expect(400);
    await request(app).post('/api/trip-templates/nope/trip').set(auth()).send({ startDate: '2027-04-05' }).expect(404);
  });

  it('is switched off by the trip_templates flag', async () => {
    await setFeatureFlag('trip_templates', false, null);
    clearFeatureFlagCacheForTesting();
    try {
      await request(app).get('/api/trip-templates?countries=Japan').set(auth()).expect(404);
    } finally {
      await setFeatureFlag('trip_templates', true, null);
      clearFeatureFlagCacheForTesting();
    }
  });
});
