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
    // The day-by-day location is read from the lodging, so each placeholder carries its city.
    expect(lodgings.every((l) => /^[A-Z][A-Za-z -]+, Japan$/.test(l.address))).toBe(true);
    expect(transfers.every((t) => t.transferType === 'Public Transit' || t.transfer_type === 'Public Transit')).toBe(true);
  });

  it('moves suggested items when a placeholder start becomes real dates, but not ones the traveler saved', async () => {
    const template = (await request(app).get('/api/trip-templates?countries=Japan&maxDays=10').set(auth()).expect(200)).body.templates.find((t: any) => t.days === 7);
    const created = await request(app).post(`/api/trip-templates/${template.id}/trip`).set(auth())
      .send({ startDate: '2027-04-01', endDate: '2027-04-07', startMonth: 4, startYear: 2027, locationIds: ['country:japan'] }).expect(201);
    const tripId = created.body.trip.id as string;
    const read = async (kind: string) => (await request(app).get(`/api/${kind}?tripId=${tripId}`).set(auth()).expect(200)).body as any[];
    const before = { activities: await read('activities'), lodgings: await read('lodgings'), transfers: await read('transfers') };
    const day = (value: string) => String(value).slice(0, 10);

    // The traveler confirms one activity by saving it with a date of their own.
    const confirmed = before.activities[0];
    await request(app).put(`/api/activities/${confirmed.id}`).set(auth()).send({ date: day(confirmed.date) }).expect(200);

    await request(app).patch(`/api/trips/${tripId}`).set(auth())
      .send({ dateMode: 'range', startDate: '2027-04-11', endDate: '2027-04-17' }).expect(200);

    const after = { activities: await read('activities'), lodgings: await read('lodgings'), transfers: await read('transfers') };
    const byId = (rows: any[]) => new Map(rows.map((row) => [row.id, row]));
    const activitiesAfter = byId(after.activities);
    for (const old of before.activities) {
      const expected = old.id === confirmed.id ? day(old.date) : new Date(Date.parse(`${day(old.date)}T00:00:00Z`) + 10 * 86400000).toISOString().slice(0, 10);
      expect(day(activitiesAfter.get(old.id).date)).toBe(expected);
    }
    const lodgingsAfter = byId(after.lodgings);
    for (const old of before.lodgings) {
      expect(day(lodgingsAfter.get(old.id).checkInDate)).toBe(new Date(Date.parse(`${day(old.checkInDate)}T00:00:00Z`) + 10 * 86400000).toISOString().slice(0, 10));
    }
    const transfersAfter = byId(after.transfers);
    for (const old of before.transfers) {
      expect(day(transfersAfter.get(old.id).departureDate)).toBe(new Date(Date.parse(`${day(old.departureDate)}T00:00:00Z`) + 10 * 86400000).toISOString().slice(0, 10));
    }

    // The dates are real now, so a further change to the trip's dates leaves the items alone.
    await request(app).patch(`/api/trips/${tripId}`).set(auth()).send({ dateMode: 'range', startDate: '2027-04-21', endDate: '2027-04-27' }).expect(200);
    expect(day((await read('lodgings')).find((l) => l.id === before.lodgings[0].id).checkInDate)).toBe(day(lodgingsAfter.get(before.lodgings[0].id).checkInDate));
    // Free-tier trips are limited, so leave room for the tests that follow.
    await request(app).delete(`/api/trips/${tripId}`).set(auth()).expect(204);
  });

  it('suggests template activities for the cities the lodgings put the traveler in, until they are added', async () => {
    const template = (await request(app).get('/api/trip-templates?countries=Japan&maxDays=10').set(auth()).expect(200)).body.templates.find((t: any) => t.days === 7);
    const created = await request(app).post(`/api/trip-templates/${template.id}/trip`).set(auth())
      .send({ startDate: '2027-05-03', locationIds: ['country:japan'] }).expect(201);
    const tripId = created.body.trip.id as string;
    const suggestions = async () => (await request(app).get(`/api/trip-templates/trips/${tripId}/activity-suggestions`).set(auth()).expect(200)).body.suggestions as any[];
    try {
      const lodgings = (await request(app).get(`/api/lodgings?tripId=${tripId}`).set(auth()).expect(200)).body as any[];
      const have = ((await request(app).get(`/api/activities?tripId=${tripId}`).set(auth()).expect(200)).body as any[]).map((a) => String(a.name).toLowerCase());
      const offered = await suggestions();
      expect(offered.length).toBeGreaterThan(0);
      for (const s of offered) {
        expect(have).not.toContain(s.name.toLowerCase());
        expect(s.dates.length).toBeGreaterThan(0);
        expect(lodgings.some((l) => String(l.address).includes(s.city))).toBe(true);
      }

      // Adding one, dated or optional, takes it off the list.
      const pick = offered[0];
      await request(app).post('/api/activities').set(auth())
        .send({ tripId, name: pick.name, activityType: 'Tour', date: '', status: 'Proposed', startLocation: '', startTime: '', duration: '', cost: 0 }).expect(201);
      expect((await suggestions()).map((s) => s.key)).not.toContain(pick.key);
    } finally {
      await request(app).delete(`/api/trips/${tripId}`).set(auth()).expect(204);
    }
  });

  it('narrows suggestions to one day from the lodging for that day, and pictures optional activities', async () => {
    const template = (await request(app).get('/api/trip-templates?countries=Japan&maxDays=10').set(auth()).expect(200)).body.templates.find((t: any) => t.days === 7);
    const created = await request(app).post(`/api/trip-templates/${template.id}/trip`).set(auth())
      .send({ startDate: '2027-05-03', locationIds: ['country:japan'] }).expect(201);
    const tripId = created.body.trip.id as string;
    const base = `/api/trip-templates/trips/${tripId}/activity-suggestions`;
    try {
      const everything = (await request(app).get(base).set(auth()).expect(200)).body.suggestions as any[];
      const day = everything[0].dates[0] as string;
      const forDay = (await request(app).get(`${base}?date=${day}`).set(auth()).expect(200)).body.suggestions as any[];
      expect(forDay.length).toBeGreaterThan(0);
      for (const s of forDay) expect(s.dates).toContain(day);
      expect(forDay.map((s) => s.startTime)).toEqual([...forDay.map((s) => s.startTime)].sort());
      // A date that no lodging covers has nothing to suggest, and a malformed one is ignored.
      expect((await request(app).get(`${base}?date=2031-01-01`).set(auth()).expect(200)).body.suggestions).toEqual([]);
      expect((await request(app).get(`${base}?date=not-a-date`).set(auth()).expect(200)).body.suggestions.length).toBe(everything.length);

      // An optional (undated) activity that matches a template activity gets its picture and sentence.
      const pick = everything.find((s) => s.description && s.image) ?? everything[0];
      const optional = await request(app).post('/api/activities').set(auth())
        .send({ tripId, name: pick.name, activityType: 'Tour', date: '', status: 'Proposed', startLocation: '', startTime: '', duration: '', cost: 0 }).expect(201);
      const media = (await request(app).get(base).set(auth()).expect(200)).body.activityMedia;
      expect(media[optional.body.id].description).toBe(pick.description);
      expect(media[optional.body.id].image?.url).toBe(pick.image?.url);
    } finally {
      await request(app).delete(`/api/trips/${tripId}`).set(auth()).expect(204);
    }
  });

  it('remembers a dismissed suggestion for that traveler only, until they bring it back', async () => {
    const template = (await request(app).get('/api/trip-templates?countries=Japan&maxDays=10').set(auth()).expect(200)).body.templates.find((t: any) => t.days === 7);
    const tripId = (await request(app).post(`/api/trip-templates/${template.id}/trip`).set(auth())
      .send({ startDate: '2027-07-05', locationIds: ['country:japan'] }).expect(201)).body.trip.id as string;
    const base = `/api/trip-templates/trips/${tripId}/activity-suggestions`;
    try {
      const first = (await request(app).get(base).set(auth()).expect(200)).body;
      const [one, two] = first.suggestions;
      expect(first.dismissedCount).toBe(0);
      await request(app).post(`${base}/dismissals`).set(auth()).send({ key: one.key }).expect(204);
      await request(app).post(`${base}/dismissals`).set(auth()).send({ key: one.key }).expect(204);
      await request(app).post(`${base}/dismissals`).set(auth()).send({}).expect(400);
      const after = (await request(app).get(base).set(auth()).expect(200)).body;
      expect(after.suggestions.map((s: any) => s.key)).not.toContain(one.key);
      expect(after.suggestions.map((s: any) => s.key)).toContain(two.key);
      expect(after.dismissedCount).toBe(1);

      await request(app).delete(`${base}/dismissals`).set(auth()).expect(204);
      const restored = (await request(app).get(base).set(auth()).expect(200)).body;
      expect(restored.suggestions.map((s: any) => s.key)).toContain(one.key);
      expect(restored.dismissedCount).toBe(0);

      const other = (await registerAndLoginWebUser({ email: `templates-dismiss+${uniq}@example.com`, firstName: 'Dee', lastName: 'Other', password: 'testtest' })).token;
      await request(app).post(`${base}/dismissals`).set({ Authorization: `Bearer ${other}` }).send({ key: one.key }).expect(403);
    } finally {
      await request(app).delete(`/api/trips/${tripId}`).set(auth()).expect(204);
    }
  });

  it('suggests nothing for a trip with no lodging, and refuses a trip the user is not in', async () => {
    const created = await request(app).post('/api/trips/wizard').set(auth()).send({ name: 'Bare trip', startDate: '2027-06-01', endDate: '2027-06-05', participants: [] }).expect(201);
    const tripId = created.body.trip.id as string;
    expect(tripId).toBeTruthy();
    try {
      expect((await request(app).get(`/api/trip-templates/trips/${tripId}/activity-suggestions`).set(auth()).expect(200)).body).toEqual({ suggestions: [], dismissedCount: 0, activityMedia: {} });
      const other = (await registerAndLoginWebUser({ email: `templates-other+${uniq}@example.com`, firstName: 'Olly', lastName: 'Else', password: 'testtest' })).token;
      await request(app).get(`/api/trip-templates/trips/${tripId}/activity-suggestions`).set({ Authorization: `Bearer ${other}` }).expect(403);
    } finally {
      await request(app).delete(`/api/trips/${tripId}`).set(auth()).expect(204);
    }
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
