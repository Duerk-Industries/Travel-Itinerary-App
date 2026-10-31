/// <reference types="jest" />
import fs from 'node:fs';
import path from 'node:path';
import { selectToursForActivities, tourFileSchema } from '../src/services/getYourGuideTourService';
import { deleteGetYourGuideTour, initDb, listGetYourGuideTours, upsertGetYourGuideTour } from '../src/db';

const dataDir = path.join(__dirname, '..', 'data');
const { tours } = tourFileSchema.parse(JSON.parse(fs.readFileSync(path.join(dataDir, 'getyourguide-tours.json'), 'utf8')));

const templateActivityNames = (): Set<string> => {
  const authoring = path.join(dataDir, 'trip-template-authoring');
  const bundles = fs.readdirSync(authoring).filter((name) => name.endsWith('-bundle.json'))
    .flatMap((name) => JSON.parse(fs.readFileSync(path.join(authoring, name), 'utf8')).templates);
  const seeds = path.join(dataDir, 'trip-templates');
  const seeded = fs.readdirSync(seeds).filter((name) => name.endsWith('.json')).map((name) => JSON.parse(fs.readFileSync(path.join(seeds, name), 'utf8')));
  return new Set([...bundles, ...seeded].flatMap((template) => (template.activities ?? []).map((activity: { name: string }) => activity.name)));
};

describe('getyourguide-tours.json', () => {
  it('names only activities that exist in a template, because matching is exact', () => {
    const names = templateActivityNames();
    expect(tours.flatMap((tour) => tour.activities).filter((name) => !names.has(name))).toEqual([]);
  });

  it('keeps to the quality floor and clean tour addresses', () => {
    for (const tour of tours) {
      expect(tour.rating).toBeGreaterThanOrEqual(4);
      expect(tour.reviewCount).toBeGreaterThanOrEqual(50);
      const url = new URL(tour.url);
      expect(url.search).toBe('');
      expect(url.hostname).toBe('www.getyourguide.com');
      expect(url.pathname).toMatch(new RegExp(`^/[a-z0-9-]+-l\\d+/[a-z0-9-]+-${tour.id}/$`));
    }
    expect(new Set(tours.map((tour) => tour.id)).size).toBe(tours.length);
  });

  it('offers one combined tour for a Rio trip with both stops, and the ticket for only one', () => {
    const stop = (id: string, name: string, date: string) => ({ id, name, date, status: 'Needs Booking', startLocation: 'Corcovado, Rio de Janeiro' });
    const both = selectToursForActivities([stop('a', 'Christ the Redeemer', '2026-11-15'), stop('b', 'Sugarloaf Mountain cable car', '2026-11-16')], 'Rio', tours as any);
    expect(both.a.tourId).toBe('t770155');
    expect(both.b.tourId).toBe('t770155');
    expect(selectToursForActivities([stop('a', 'Christ the Redeemer', '2026-11-15')], 'Rio', tours as any).a.tourId).toBe('t161850');
  });
});

describe('the getyourguide_tours table', () => {
  beforeAll(async () => { await initDb(); });

  it('stores, updates and removes a tour', async () => {
    const tour = { id: 't1', url: 'https://www.getyourguide.com/a-l1/b-t1/', title: 'A tour', rating: 4.96, reviewCount: 373, city: 'Kanazawa', country: 'Japan', activities: ['One', 'Two'], checkedAt: '2026-10-31' };
    await upsertGetYourGuideTour(tour);
    expect(await listGetYourGuideTours()).toContainEqual(tour);
    await upsertGetYourGuideTour({ ...tour, reviewCount: 400 });
    expect((await listGetYourGuideTours()).find((row) => row.id === 't1')?.reviewCount).toBe(400);
    await deleteGetYourGuideTour('t1');
    expect((await listGetYourGuideTours()).some((row) => row.id === 't1')).toBe(false);
  });
});
