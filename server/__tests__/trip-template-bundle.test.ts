/// <reference types="jest" />
/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { app } from '../src/app';
import { closePool, initDb, listTripTemplateImports, listTripTemplates } from '../src/db';
import {
  BUNDLE_FORMAT,
  TEMPLATE_ACTIVITY_TYPES,
  TEMPLATE_TRANSFER_TYPES,
  buildTemplateBundle,
  bundleJsonSchema,
  prepareBundle,
} from '../src/services/tripTemplateBundle';
import { clearTripTemplateCacheForTests, loadSeedTemplates, syncTripTemplatesFromSeed } from '../src/services/tripTemplateService';
import { clearTripTemplateMediaCacheForTests } from '../src/services/tripTemplateMedia';
import { makeAdminUser, registerAndLoginWebUser } from './helpers';

const authoringDir = path.resolve(__dirname, '../data/trip-template-authoring');
const readExample = () => JSON.parse(fs.readFileSync(path.join(authoringDir, 'example-bundle.json'), 'utf8'));
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

describe('authoring materials', () => {
  it('ship a complete example that the importer accepts as a new template', () => {
    const { report } = prepareBundle(readExample());
    expect(report.fatal).toBeUndefined();
    expect(report.templates).toHaveLength(1);
    expect(report.templates[0]).toMatchObject({ id: 'example-portugal-lisbon-4d', status: 'new', errors: [] });
    // The example is what an LLM copies, so it should not teach anything the checker warns about.
    expect(report.templates[0].warnings).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('give the LLM the same vocabulary the importer enforces', () => {
    const instructions = fs.readFileSync(path.join(authoringDir, 'INSTRUCTIONS.md'), 'utf8');
    for (const value of [...TEMPLATE_ACTIVITY_TYPES, ...TEMPLATE_TRANSFER_TYPES, BUNDLE_FORMAT]) expect(instructions).toContain(value);
    const types = fs.readFileSync(path.resolve(__dirname, '../src/types.ts'), 'utf8');
    const union = types.match(/export type ActivityType =([^;]+);/)![1];
    expect([...union.matchAll(/'([^']+)'/g)].map((match) => match[1]).sort()).toEqual([...TEMPLATE_ACTIVITY_TYPES].sort());
  });

  it('describe the format as JSON Schema', () => {
    const schema: any = bundleJsonSchema();
    expect(schema.type).toBe('object');
    expect(Object.keys(schema.properties)).toEqual(expect.arrayContaining(['format', 'version', 'templates', 'media']));
  });
});

describe('checking a bundle', () => {
  const withTemplate = (change: (template: any) => void) => {
    const bundle = readExample();
    change(bundle.templates[0]);
    return prepareBundle(bundle).report;
  };
  const errorsOf = (change: (template: any) => void) => withTemplate(change).templates[0].errors.join(' | ');

  it('refuses a file that is not a bundle, with what to fix', () => {
    expect(prepareBundle('nope').report.fatal?.[0]).toMatch(/JSON object/);
    expect(prepareBundle({ format: 'other', version: 1, templates: [] }).report.fatal?.[0]).toMatch(/format/);
    expect(prepareBundle({ format: BUNDLE_FORMAT, version: 2, templates: [] }).report.fatal?.[0]).toMatch(/version/);
    expect(prepareBundle({ format: BUNDLE_FORMAT, version: 1, templates: 'x' }).report.fatal?.[0]).toMatch(/array/);
    expect(prepareBundle({ format: BUNDLE_FORMAT, version: 1, templates: [] }).report.ok).toBe(false);
  });

  it('names the field and the problem for each mistake an LLM is likely to make', () => {
    expect(errorsOf((t) => { t.stays[0].nights = 2; })).toMatch(/stays: nights add up to 2 but a 4-day trip has 3 nights/);
    expect(errorsOf((t) => { t.stays.push({ base: 'Sintra', hotel: 'Hotel in Sintra', start: 5, nights: 1 }); t.days = 5; })).toMatch(/stays\.1\.start: is 5 but the previous stay ends on day 3/);
    expect(errorsOf((t) => { t.activities[0].day = 9; })).toMatch(/activities\.0\.day: 9 is after the last day \(3\)/);
    expect(errorsOf((t) => { t.activities[0].type = 'Sightseeing'; })).toMatch(/activities\.0\.type: "Sightseeing" is not one of/);
    expect(errorsOf((t) => { t.activities[0].time = '5pm'; })).toMatch(/activities\.0\.time: "5pm" must be 24-hour HH:MM/);
    expect(errorsOf((t) => { t.activities[0].place = 'Belem Tower'; })).toMatch(/activities\.0\.place: .* must look like "portugal\/belem-tower"/);
    expect(errorsOf((t) => { t.legs[0].transferType = 'Flight'; })).toMatch(/legs\.0\.transferType: "Flight" must be one of Public Transit, Private Transfer, Other/);
    expect(errorsOf((t) => { t.id = 'Lisbon Trip!'; })).toMatch(/id "Lisbon Trip!" must be lowercase/);
    expect(errorsOf((t) => { t.days = 'seven'; })).toMatch(/days/);
    expect(errorsOf((t) => { delete t.title; })).toMatch(/title/);
  });

  it('only warns about softer problems, and still accepts the template', () => {
    const report = withTemplate((t) => {
      t.activities[0].book = 'maybe';
      t.hero = '';
      t.highlights = ['one'];
      t.activities[1].place = 'portugal/not-described-anywhere';
    });
    expect(report.ok).toBe(true);
    const warnings = report.templates[0].warnings.join(' | ');
    expect(warnings).toMatch(/activities\.0\.book: "maybe" should be empty or start with "Yes - "/);
    expect(warnings).toMatch(/hero: empty/);
    expect(warnings).toMatch(/highlights: has 1/);
    expect(warnings).toMatch(/no description or picture entry for "portugal\/not-described-anywhere"/);
  });

  it('rejects a duplicate id within one bundle', () => {
    const bundle = readExample();
    bundle.templates.push(clone(bundle.templates[0]));
    const { report } = prepareBundle(bundle);
    expect(report.ok).toBe(false);
    expect(report.templates[1].errors.join(' ')).toMatch(/appears more than once/);
  });

  it('accepts only public-domain or CC0 Wikimedia pictures, and short descriptions', () => {
    const image = { url: 'https://upload.wikimedia.org/a.jpg', width: 800, height: 600, title: 'File:A.jpg', pageUrl: 'https://commons.wikimedia.org/wiki/File:A.jpg', license: 'CC0', author: 'Someone' };
    const tryImage = (patch: Record<string, unknown>, description = 'Fine.') => {
      const bundle = readExample();
      bundle.media.places['portugal/belem-tower'] = { name: 'Belem Tower', description, image: { ...image, ...patch } };
      return prepareBundle(bundle).report;
    };
    expect(tryImage({}).ok).toBe(true);
    expect(tryImage({ license: 'CC BY-SA 4.0' }).media.places.rejected[0].error).toMatch(/not public domain or CC0/);
    expect(tryImage({ url: 'https://example.com/a.jpg' }).media.places.rejected[0].error).toMatch(/wikimedia/);
    expect(tryImage({ url: 'http://upload.wikimedia.org/a.jpg' }).media.places.rejected[0].error).toMatch(/https/);
    expect(tryImage({}, 'x'.repeat(601)).media.places.rejected[0].error).toMatch(/600 characters/);
    const bad = readExample();
    bad.media.places['Not A Key'] = { name: 'x', description: 'x', image: null };
    expect(prepareBundle(bad).report.media.places.rejected[0].key).toBe('Not A Key');
  });
});

describe('what the app exports', () => {
  beforeEach(() => { clearTripTemplateCacheForTests(); clearTripTemplateMediaCacheForTests(); });

  it('imports straight back as unchanged, so a download is a safe starting point for edits', () => {
    const exported = buildTemplateBundle();
    expect(exported.format).toBe(BUNDLE_FORMAT);
    expect(exported.templates.length).toBe(loadSeedTemplates().length);
    expect(exported.templates.every((template) => !('contentHash' in template))).toBe(true);
    const { report } = prepareBundle(JSON.parse(JSON.stringify(exported)));
    expect(report.templates.filter((template) => template.errors.length)).toEqual([]);
    expect(report.templates.every((template) => template.status === 'unchanged')).toBe(true);
    expect(report.ok).toBe(true);
  });

  it('can be limited to some templates, carrying only the descriptions they use', () => {
    const first = loadSeedTemplates()[0];
    const exported = buildTemplateBundle([first.id]);
    expect(exported.templates.map((template) => template.id)).toEqual([first.id]);
    const wanted = new Set(first.activities.map((activity) => activity.place).filter(Boolean));
    expect(Object.keys(exported.media.places).every((key) => wanted.has(key))).toBe(true);
  });
});

describe('importing through the admin API', () => {
  let admin = '';
  let user = '';
  const asAdmin = () => ({ Authorization: `Bearer ${admin}` });
  const post = (bundle: unknown, dryRun: boolean) => request(app).post('/api/admin/trip-templates/import').set(asAdmin()).send({ bundle, dryRun });
  const offered = async (country: string) =>
    (await request(app).get(`/api/trip-templates?countries=${country}`).set({ Authorization: `Bearer ${user}` }).expect(200)).body.templates as any[];

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDb();
    await syncTripTemplatesFromSeed();
    const stamp = Date.now();
    admin = (await makeAdminUser({ firstName: 'Tmpl', lastName: 'Admin', email: `tmpl-admin+${stamp}@example.com`, password: 'TemplateAdmin1!' })).token;
    user = (await registerAndLoginWebUser({ firstName: 'Tmpl', lastName: 'User', email: `tmpl-user+${stamp}@example.com`, password: 'TemplateUser1!' })).token;
  });
  afterAll(async () => {
    await request(app).delete('/api/admin/trip-templates/imported/example-portugal-lisbon-4d').set(asAdmin());
    await closePool();
  });

  it('is for admins only', async () => {
    await request(app).get('/api/admin/trip-templates').expect(401);
    await request(app).get('/api/admin/trip-templates').set({ Authorization: `Bearer ${user}` }).expect(403);
    await request(app).post('/api/admin/trip-templates/import').set({ Authorization: `Bearer ${user}` }).send({ bundle: readExample(), dryRun: false }).expect(403);
    await request(app).get('/api/admin/trip-templates/export').set({ Authorization: `Bearer ${user}` }).expect(403);
  });

  it('serves the instructions, an example and the schema to download', async () => {
    const instructions = await request(app).get('/api/admin/trip-templates/authoring/instructions').set(asAdmin()).expect(200);
    expect(instructions.headers['content-disposition']).toMatch(/attachment/);
    expect(instructions.text).toContain('sample itineraries');
    const example = await request(app).get('/api/admin/trip-templates/authoring/example').set(asAdmin()).expect(200);
    expect(JSON.parse(example.text).format).toBe(BUNDLE_FORMAT);
    const schema = await request(app).get('/api/admin/trip-templates/authoring/schema').set(asAdmin()).expect(200);
    expect(JSON.parse(schema.text).type).toBe('object');
  });

  it('downloads the live templates as a bundle', async () => {
    const res = await request(app).get('/api/admin/trip-templates/export').set(asAdmin()).expect(200);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="wanderbunnies-templates-\d{4}-\d{2}-\d{2}\.json"/);
    const bundle = JSON.parse(res.text);
    expect(bundle.format).toBe(BUNDLE_FORMAT);
    expect(bundle.templates.length).toBeGreaterThanOrEqual(8);
    await request(app).get('/api/admin/trip-templates/export?ids=nope').set(asAdmin()).expect(404);
    const one = await request(app).get('/api/admin/trip-templates/export?ids=japan-t01').set(asAdmin()).expect(200);
    expect(JSON.parse(one.text).templates.map((t: any) => t.id)).toEqual(['japan-t01']);
  });

  it('previews without saving, then imports a new template that travelers are offered and can use', async () => {
    expect(await offered('Portugal')).toEqual([]);

    const preview = await post(readExample(), true).expect(200);
    expect(preview.body).toMatchObject({ ok: true, applied: false });
    expect(preview.body.templates[0]).toMatchObject({ id: 'example-portugal-lisbon-4d', status: 'new' });
    expect(await offered('Portugal')).toEqual([]);
    expect(await listTripTemplateImports()).toEqual([]);

    const applied = await post(readExample(), false).expect(200);
    expect(applied.body).toMatchObject({ ok: true, applied: true });
    expect(applied.body.media.places.added).toBe(9);

    const portugal = await offered('Portugal');
    expect(portugal.map((t) => t.id)).toEqual(['example-portugal-lisbon-4d']);
    expect((await listTripTemplates()).some((row) => row.id === 'example-portugal-lisbon-4d' && row.enabled)).toBe(true);
    const detail = await request(app).get('/api/trip-templates/example-portugal-lisbon-4d').set({ Authorization: `Bearer ${user}` }).expect(200);
    expect(detail.body.preview).toHaveLength(4);
    const withText = detail.body.preview.flatMap((day: any) => day.items).find((item: any) => item.title === 'Belém Tower');
    expect(withText.description).toMatch(/fortified tower/);

    const listed = (await request(app).get('/api/admin/trip-templates').set(asAdmin()).expect(200)).body.templates as any[];
    expect(listed.find((t) => t.id === 'example-portugal-lisbon-4d')).toMatchObject({ source: 'imported', days: 4 });
    expect(listed.find((t) => t.id === 'japan-t01')).toMatchObject({ source: 'bundled' });
  });

  it('treats an unchanged file as unchanged, and a corrected one as an update', async () => {
    const again = await post(readExample(), true).expect(200);
    expect(again.body.templates[0].status).toBe('unchanged');

    const edited = readExample();
    edited.templates[0].summary = 'A corrected summary.';
    edited.media.places['portugal/belem-tower'].description = 'A corrected description of the tower.';
    const preview = await post(edited, true).expect(200);
    expect(preview.body.templates[0].status).toBe('updated');
    expect(preview.body.media.places).toMatchObject({ updated: 1, unchanged: 8, added: 0 });
    await post(edited, false).expect(200);
    const portugal = await offered('Portugal');
    expect(portugal[0].summary).toBe('A corrected summary.');
    const detail = await request(app).get('/api/trip-templates/example-portugal-lisbon-4d').set({ Authorization: `Bearer ${user}` }).expect(200);
    expect(JSON.stringify(detail.body.preview)).toContain('A corrected description of the tower.');
  });

  it('can replace a bundled template, and removing the import brings the bundled one back', async () => {
    const original = (await request(app).get('/api/trip-templates/japan-t01').set({ Authorization: `Bearer ${user}` }).expect(200)).body.title;
    const exported = buildTemplateBundle(['japan-t01']);
    exported.templates[0].title = 'Japan, revised by an admin';
    const preview = await post(exported, true).expect(200);
    expect(preview.body.templates[0]).toMatchObject({ status: 'updated', source: 'bundled' });
    await post(exported, false).expect(200);
    expect((await request(app).get('/api/trip-templates/japan-t01').set({ Authorization: `Bearer ${user}` }).expect(200)).body.title).toBe('Japan, revised by an admin');
    expect((await request(app).get('/api/admin/trip-templates').set(asAdmin()).expect(200)).body.templates.find((t: any) => t.id === 'japan-t01').source).toBe('imported-override');

    await request(app).delete('/api/admin/trip-templates/imported/japan-t01').set(asAdmin()).expect(204);
    expect((await request(app).get('/api/trip-templates/japan-t01').set({ Authorization: `Bearer ${user}` }).expect(200)).body.title).toBe(original);
    await request(app).delete('/api/admin/trip-templates/imported/japan-t01').set(asAdmin()).expect(404);
  });

  it('saves nothing when any part of the bundle is wrong, and says what to fix', async () => {
    const bundle = readExample();
    const second = clone(bundle.templates[0]);
    second.id = 'portugal-broken-5d';
    second.activities[0].day = 40;
    bundle.templates.push(second);
    bundle.templates[0].id = 'portugal-fine-4d';
    const res = await post(bundle, false).expect(200);
    expect(res.body).toMatchObject({ ok: false, applied: false });
    expect(res.body.templates.map((t: any) => [t.id, t.status])).toEqual([['portugal-fine-4d', 'new'], ['portugal-broken-5d', 'invalid']]);
    expect(res.body.templates[1].errors[0]).toMatch(/activities\.0\.day: 40 is after the last day/);
    expect((await offered('Portugal')).map((t) => t.id)).not.toContain('portugal-fine-4d');
    expect((await listTripTemplateImports()).some((row) => row.key === 'portugal-fine-4d')).toBe(false);
  });

  it('answers a malformed upload with 400 and accepts a bundle larger than the usual request limit', async () => {
    await request(app).post('/api/admin/trip-templates/import').set(asAdmin()).send({}).expect(400);
    const notBundle = await post({ hello: 'world' }, true).expect(400);
    expect(notBundle.body.fatal[0]).toMatch(/format/);

    const big = readExample();
    big.templates[0].id = 'portugal-big-4d';
    big.templates[0].activities[0].notes = 'n'.repeat(300_000);
    expect(JSON.stringify(big).length).toBeGreaterThan(200_000);
    const res = await post(big, true).expect(200);
    expect(res.body.templates[0]).toMatchObject({ id: 'portugal-big-4d', status: 'new' });
  });

  it('records an audit entry when a bundle is applied or an import is removed', async () => {
    const log = await request(app).get('/api/admin/audit-log?action=TRIP_TEMPLATES_IMPORTED').set(asAdmin()).expect(200);
    expect(log.body.entries.length).toBeGreaterThanOrEqual(1);
    expect(log.body.entries.every((entry: any) => entry.action === 'TRIP_TEMPLATES_IMPORTED')).toBe(true);
    expect(JSON.stringify(log.body.entries.map((entry: any) => entry.afterState))).toContain('example-portugal-lisbon-4d');
    const removed = await request(app).get('/api/admin/audit-log?action=TRIP_TEMPLATE_IMPORT_REMOVED').set(asAdmin()).expect(200);
    expect(removed.body.entries.length).toBeGreaterThanOrEqual(1);
  });
});
