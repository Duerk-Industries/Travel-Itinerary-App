/// <reference types="jest" />
/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { app } from '../src/app';
import { closePool, initDb } from '../src/db';
import { TEMPLATE_INTERESTS, clearTripTemplateMediaCacheForTests, placeNotesText } from '../src/services/tripTemplateMedia';
import { buildTemplateBundle, importBundle, prepareBundle, removeImportedTemplate } from '../src/services/tripTemplateBundle';
import { clearTripTemplateCacheForTests, syncTripTemplatesFromSeed } from '../src/services/tripTemplateService';
import { registerAndLoginWebUser } from './helpers';

// The pace, interests and mobility tags, and the paragraph version of a stop's description. The tags are for the app's own
// use: they must be in what an admin downloads, and in nothing a traveler can read.

const example = () => JSON.parse(fs.readFileSync(path.resolve(__dirname, '../data/trip-template-authoring/example-bundle.json'), 'utf8'));
const ID = 'example-portugal-lisbon-4d';
const TOWER = 'portugal/belem-tower';

describe('checking the tags and the paragraph', () => {
  const check = (change: (bundle: any) => void) => {
    const bundle = example();
    change(bundle);
    return prepareBundle(bundle).report;
  };

  it('ships an example that uses every new field and still has no warnings', () => {
    const bundle = example();
    expect(bundle.templates[0].pace).toBe('R');
    expect(bundle.media.places[TOWER]).toMatchObject({ mobility: 'M', interests: expect.any(Array), details: expect.any(String) });
    expect(bundle.media.places[TOWER].details.length).toBeGreaterThan(bundle.media.places[TOWER].description.length);
    expect(Object.values<any>(bundle.media.places).every((place) => place.details && place.interests.length && place.mobility)).toBe(true);
    expect(prepareBundle(bundle).report.templates[0].warnings).toEqual([]);
  });

  it('uses the interest vocabulary of the AI itinerary generator', () => {
    expect([...TEMPLATE_INTERESTS].sort()).toEqual(
      ['adventure', 'authentic_local', 'culture', 'food', 'iconic_landmarks', 'nightlife', 'outdoors', 'photography', 'relax'],
    );
  });

  it('rejects a value outside the vocabulary, naming the field', () => {
    expect(check((b) => { b.templates[0].pace = 'packed'; }).templates[0].errors.join(' ')).toMatch(/pace/);
    expect(check((b) => { b.templates[0].interests = ['culture', 'history']; }).templates[0].errors.join(' ')).toMatch(/interests\.1/);
    const badInterest = check((b) => { b.media.places[TOWER].interests = ['family']; });
    expect(badInterest.ok).toBe(false);
    expect(badInterest.media.places.rejected[0]).toMatchObject({ key: TOWER });
    expect(badInterest.media.places.rejected[0].error).toMatch(/interests\.0/);
    expect(check((b) => { b.media.places[TOWER].mobility = 'X'; }).media.places.rejected[0].error).toMatch(/mobility/);
  });

  it('caps the paragraph, and requires the sentence it expands on', () => {
    expect(check((b) => { b.media.places[TOWER].details = 'x'.repeat(1201); }).media.places.rejected[0].error).toMatch(/1200 characters/);
    expect(check((b) => { b.media.places[TOWER].details = 'x'.repeat(1200); }).ok).toBe(true);
    expect(check((b) => { b.media.places[TOWER].description = ''; }).media.places.rejected[0].error).toMatch(/one-sentence description/);
  });

  it('treats every new field as optional, saying so in one line each rather than one per stop', () => {
    const report = check((b) => {
      delete b.templates[0].pace;
      delete b.templates[0].interests;
      for (const place of Object.values<any>(b.media.places)) { delete place.details; delete place.interests; delete place.mobility; }
    });
    expect(report.ok).toBe(true);
    expect(report.templates[0].errors).toEqual([]);
    const warnings = report.templates[0].warnings;
    expect(warnings).toHaveLength(4);
    expect(warnings.join(' | ')).toMatch(/pace: not set/);
    expect(warnings.join(' | ')).toMatch(/interests: not set/);
    expect(warnings.join(' | ')).toMatch(/9 of 9 places have no "details" paragraph/);
    expect(warnings.join(' | ')).toMatch(/9 of 9 places have no "interests"/);
  });

  it('falls back to the sentence when a stop has no paragraph', () => {
    expect(placeNotesText({ description: 'Short.', details: 'A longer paragraph.' })).toBe('A longer paragraph.');
    expect(placeNotesText({ description: 'Short.', details: '  ' })).toBe('Short.');
    expect(placeNotesText({ description: '', details: '' })).toBe('');
    expect(placeNotesText(null)).toBe('');
  });
});

describe('what travelers see', () => {
  const uniq = Date.now();
  const user = { email: `characteristics+${uniq}@example.com`, firstName: 'Cara', lastName: 'Teristic', password: 'testtest' };
  let token = '';
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const place = () => example().media.places[TOWER] as { description: string; details: string };
  const createTrip = async (startDate: string) =>
    (await request(app).post(`/api/trip-templates/${ID}/trip`).set(auth()).send({ startDate, countries: ['Portugal'] }).expect(201)).body.trip.id as string;
  const activitiesOf = async (tripId: string) => (await request(app).get(`/api/activities?tripId=${tripId}`).set(auth()).expect(200)).body as any[];
  // The internal tags and the research sources: kept for the admin and the app, never shown to a traveler.
  const tags = /"(pace|interests|mobility|sources)"|Lonely Planet|Visit Portugal/;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    await syncTripTemplatesFromSeed();
    token = (await registerAndLoginWebUser(user)).token;
    const report = await importBundle(example(), { dryRun: false, importedBy: null });
    expect(report).toMatchObject({ ok: true, applied: true });
  });
  afterAll(async () => {
    await removeImportedTemplate(ID);
    await closePool();
  });

  it('shows the sentence while the template is previewed, and sends no tags', async () => {
    const list = await request(app).get('/api/trip-templates?countries=Portugal').set(auth()).expect(200);
    expect(list.body.templates.map((t: any) => t.id)).toContain(ID);
    const detail = await request(app).get(`/api/trip-templates/${ID}`).set(auth()).expect(200);
    const tower = detail.body.preview.flatMap((day: any) => day.items).find((item: any) => item.title === 'Belém Tower');
    expect(tower.description).toBe(place().description);
    for (const body of [list.body, detail.body]) {
      expect(JSON.stringify(body)).not.toMatch(tags);
      expect(JSON.stringify(body)).not.toContain(place().details);
    }
  });

  it('puts the paragraph in the notes of the activities a template creates, so the trip export carries it', async () => {
    const tripId = await createTrip('2027-06-07');
    try {
      const activities = await activitiesOf(tripId);
      const tower = activities.find((a) => a.name === 'Belém Tower');
      expect(String(tower.notes).split('\n')[0]).toBe(place().details);
      expect(tower.notes).toContain('A short riverside walk from the monastery');
      expect(JSON.stringify(activities)).not.toMatch(tags);
      expect(JSON.stringify(activities)).not.toContain('"culture"');
    } finally {
      await request(app).delete(`/api/trips/${tripId}`).set(auth()).expect(204);
    }
  });

  it('offers the sentence as a suggestion, hands over the paragraph for the new activity, and sends no tags', async () => {
    const tripId = await createTrip('2027-06-14');
    try {
      const tower = (await activitiesOf(tripId)).find((a) => a.name === 'Belém Tower');
      await request(app).delete(`/api/activities/${tower.id}`).set(auth()).expect(204);
      const res = await request(app).get(`/api/trip-templates/trips/${tripId}/activity-suggestions`).set(auth()).expect(200);
      const suggestion = res.body.suggestions.find((s: any) => s.name === 'Belém Tower');
      expect(suggestion.description).toBe(place().description);
      expect(suggestion.details).toBe(place().details);
      expect(JSON.stringify(res.body)).not.toMatch(tags);
    } finally {
      await request(app).delete(`/api/trips/${tripId}`).set(auth()).expect(204);
    }
  });

  it('uses the sentence everywhere when the stop has no paragraph', async () => {
    const bundle = example();
    bundle.media.places[TOWER].details = '';
    await importBundle(bundle, { dryRun: false, importedBy: null });
    const tripId = await createTrip('2027-06-21');
    try {
      const activities = await activitiesOf(tripId);
      const tower = activities.find((a) => a.name === 'Belém Tower');
      expect(String(tower.notes).split('\n')[0]).toBe(place().description);
      await request(app).delete(`/api/activities/${tower.id}`).set(auth()).expect(204);
      const res = await request(app).get(`/api/trip-templates/trips/${tripId}/activity-suggestions`).set(auth()).expect(200);
      expect(res.body.suggestions.find((s: any) => s.name === 'Belém Tower').details).toBe(place().description);
    } finally {
      await request(app).delete(`/api/trips/${tripId}`).set(auth()).expect(204);
      await importBundle(example(), { dryRun: false, importedBy: null });
    }
  });
});

describe('what an admin downloads', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    await syncTripTemplatesFromSeed();
    await importBundle(example(), { dryRun: false, importedBy: null });
  });
  afterAll(async () => {
    await removeImportedTemplate(ID);
    clearTripTemplateCacheForTests();
    clearTripTemplateMediaCacheForTests();
    await closePool();
  });

  it('keeps the tags and the paragraph, and imports straight back as unchanged', () => {
    const exported = buildTemplateBundle([ID]);
    expect(exported.templates[0]).toMatchObject({ pace: 'R', interests: ['culture', 'food', 'iconic_landmarks', 'photography'] });
    expect(exported.media.places[TOWER]).toMatchObject({ mobility: 'M', interests: ['culture', 'iconic_landmarks', 'photography'], details: example().media.places[TOWER].details });
    const { report } = prepareBundle(JSON.parse(JSON.stringify(exported)));
    expect(report.templates[0]).toMatchObject({ id: ID, status: 'unchanged', errors: [] });
    expect(report.media.places).toMatchObject({ added: 0, updated: 0, unchanged: 9 });
  });
});
