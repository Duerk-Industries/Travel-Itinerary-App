/// <reference types="jest" />
import { buildGetYourGuideTourRedirect, clearGetYourGuideTourCacheForTests, selectToursForActivities, tourFileSchema, tourScore } from '../src/services/getYourGuideTourService';
import * as db from '../src/db';

jest.mock('../src/db');

const tour = (id: string, activities: string[], rating = 4.5, reviewCount = 100, extra: Partial<db.GetYourGuideTourRecord> = {}): db.GetYourGuideTourRecord => ({
  id, url: `https://www.getyourguide.com/rio-de-janeiro-l9/a-tour-${id}/`, title: id, rating, reviewCount,
  city: 'Rio de Janeiro', country: 'Brazil', activities, checkedAt: '2026-10-31', ...extra,
});
const stop = (id: string, name: string, date = '2027-05-10', status = 'Proposed') => ({ id, name, date, status, startLocation: 'Rio de Janeiro' });
const chosen = (links: Record<string, { tourId: string }>, id: string) => links[id]?.tourId;

describe('selectToursForActivities', () => {
  it('needs the exact activity name, ignoring only case and accents', () => {
    const tours = [tour('t1', ['Balé Folclórico da Bahia performance'])];
    expect(chosen(selectToursForActivities([stop('a', 'bale folclorico da bahia performance')], '', tours), 'a')).toBe('t1');
    expect(selectToursForActivities([stop('a', 'Balé Folclórico')], '', tours)).toEqual({});
  });

  it("needs the activity or the trip to be in the tour's city or country", () => {
    const tours = [tour('t1', ['Old Town walk'])];
    expect(selectToursForActivities([{ ...stop('a', 'Old Town walk'), startLocation: 'Prague' }], 'Prague', tours)).toEqual({});
    expect(chosen(selectToursForActivities([{ ...stop('a', 'Old Town walk'), startLocation: '' }], 'Trip to Rio de Janeiro', tours), 'a')).toBe('t1');
    expect(chosen(selectToursForActivities([{ ...stop('a', 'Old Town walk'), startLocation: '' }], 'Brazil', tours), 'a')).toBe('t1');
    expect(selectToursForActivities([{ ...stop('a', 'Old Town walk'), startLocation: 'Brazilian Embassy' }], '', tours)).toEqual({});
  });

  it('picks the highest rating times log of the number of ratings', () => {
    const tours = [tour('few', ['Sugarloaf'], 4.9, 50), tour('many', ['Sugarloaf'], 4.5, 5000)];
    expect(tourScore(tours[1])).toBeGreaterThan(tourScore(tours[0]));
    expect(chosen(selectToursForActivities([stop('a', 'Sugarloaf')], '', tours), 'a')).toBe('many');
  });

  it('prefers a tour covering other stops that day, even over a better score', () => {
    const tours = [tour('solo', ['Christ'], 5, 90000), tour('combo', ['Christ', 'Sugarloaf'], 4.2, 60)];
    const links = selectToursForActivities([stop('a', 'Christ'), stop('b', 'Sugarloaf')], '', tours);
    expect(chosen(links, 'a')).toBe('combo');
    expect(chosen(links, 'b')).toBe('combo');
  });

  it('prefers a same-day combined tour over one covering a stop on another day', () => {
    const tours = [tour('other-day', ['Christ', 'Maracana'], 5, 90000), tour('same-day', ['Christ', 'Sugarloaf'], 4.2, 60)];
    const links = selectToursForActivities([stop('a', 'Christ'), stop('b', 'Sugarloaf'), stop('c', 'Maracana', '2027-05-11')], '', tours);
    expect(chosen(links, 'a')).toBe('same-day');
  });

  it('allows a combined tour across different days', () => {
    const tours = [tour('solo', ['Christ'], 5, 90000), tour('combo', ['Christ', 'Sugarloaf'], 4.2, 60)];
    expect(chosen(selectToursForActivities([stop('a', 'Christ'), stop('b', 'Sugarloaf', '2027-05-11')], '', tours), 'a')).toBe('combo');
  });

  it('links Proposed and Needs Booking activities, not booked ones', () => {
    const tours = [tour('t1', ['Christ'])];
    const links = selectToursForActivities([stop('a', 'Christ'), stop('b', 'Christ', '2027-05-10', 'Needs Booking'), stop('c', 'Christ', '2027-05-10', 'Booked'), stop('d', 'Christ', '2027-05-10', 'Completed')], '', tours);
    expect(Object.keys(links).sort()).toEqual(['a', 'b']);
  });
});

describe('buildGetYourGuideTourRedirect', () => {
  beforeEach(() => { jest.clearAllMocks(); clearGetYourGuideTourCacheForTests(); });

  it('adds the partner id to the stored tour page', async () => {
    (db.listGetYourGuideTours as jest.Mock).mockResolvedValue([tour('t1', ['Christ'])]);
    expect(await buildGetYourGuideTourRedirect('t1', 'PARTNER')).toBe('https://www.getyourguide.com/rio-de-janeiro-l9/a-tour-t1/?partner_id=PARTNER');
  });

  it.each([
    ['another site', 'https://evil.example/rio-l9/a-tour-t1/'],
    ['a non-tour page', 'https://www.getyourguide.com/about/'],
    ['plain http', 'http://www.getyourguide.com/rio-l9/a-tour-t1/'],
  ])('refuses %s', async (_label, url) => {
    (db.listGetYourGuideTours as jest.Mock).mockResolvedValue([tour('t1', ['Christ'], 4.5, 100, { url })]);
    expect(await buildGetYourGuideTourRedirect('t1', 'PARTNER')).toBeNull();
  });

  it('knows nothing about an unknown tour', async () => {
    (db.listGetYourGuideTours as jest.Mock).mockResolvedValue([]);
    expect(await buildGetYourGuideTourRedirect('t9', 'PARTNER')).toBeNull();
  });
});

describe('the tour file', () => {
  it('rejects a tour with no review count or activities', () => {
    expect(tourFileSchema.safeParse({ tours: [{ id: 't1', url: 'https://www.getyourguide.com/a-l1/b-t1/', title: 'x', rating: 4, reviewCount: 0, country: 'Brazil', activities: ['a'], checkedAt: '2026-10-31' }] }).success).toBe(false);
    expect(tourFileSchema.safeParse({ tours: [{ id: 't1', url: 'https://www.getyourguide.com/a-l1/b-t1/', title: 'x', rating: 4, reviewCount: 9, country: 'Brazil', activities: [], checkedAt: '2026-10-31' }] }).success).toBe(false);
  });
});
