import { projectBlogDayMapPoints, MAX_BLOG_MAP_POINTS } from '../src/services/blogMapProjection';

const photo = (lat: number, lng: number, time: number) => ({ lat, lng, time });
const base = { sharedMapEnabled: true, privateAnchors: [] as Array<{ lat: number; lng: number }> };
const trail = [photo(48.85837, 2.29448, 1), photo(48.86061, 2.33764, 2), photo(48.87463, 2.29502, 3)];

describe('blog day map projection', () => {
  it('gives travelers their own points, ordered, with no timestamps', () => {
    const out = projectBlogDayMapPoints({ ...base, membership: 'traveler', sources: [trail[2], trail[0], trail[1]] })!;
    expect(out.precision).toBe('exact');
    expect(out.points[0]).toEqual({ lat: 48.85837, lng: 2.29448 });
    expect(JSON.stringify(out)).not.toContain('time');
  });

  it('gives followers nothing unless the trip opted in', () => {
    expect(projectBlogDayMapPoints({ ...base, membership: 'follower', sharedMapEnabled: false, sources: trail })).toBeNull();
  });

  it('coarsens followers to ~1 km cells so no exact value survives', () => {
    const out = projectBlogDayMapPoints({ ...base, membership: 'follower', sources: trail })!;
    expect(out.precision).toBe('approximate');
    expect(out.points).toEqual([{ lat: 48.86, lng: 2.29 }, { lat: 48.86, lng: 2.34 }, { lat: 48.87, lng: 2.3 }]);
    for (const p of out.points) for (const raw of trail) {
      expect(p.lat).not.toBe(raw.lat);
      expect(p.lng).not.toBe(raw.lng);
    }
  });

  it('drops points near a lodging, and a day left with one area shows no map', () => {
    const out = projectBlogDayMapPoints({ ...base, membership: 'follower', sources: trail, privateAnchors: [{ lat: 48.8584, lng: 2.2945 }] })!;
    expect(out.points).toHaveLength(2);
    const onlyNearHome = [photo(48.8584, 2.2945, 1), photo(48.859, 2.295, 2), photo(48.8601, 2.3001, 3)];
    expect(projectBlogDayMapPoints({ ...base, membership: 'follower', sources: onlyNearHome, privateAnchors: [{ lat: 48.8584, lng: 2.2945 }] })).toBeNull();
  });

  it('merges stops in one cell, so a lone area is not published as a route', () => {
    const sameCell = [photo(48.8601, 2.2901, 1), photo(48.8612, 2.2915, 2)];
    expect(projectBlogDayMapPoints({ ...base, membership: 'follower', sources: sameCell })).toBeNull();
  });

  it('ignores invalid and (0,0) coordinates and caps the number of points', () => {
    const many = Array.from({ length: 40 }, (_, i) => photo(10 + i * 0.5, 20, i + 1));
    const out = projectBlogDayMapPoints({ ...base, membership: 'follower', sources: [photo(0, 0, 0), photo(NaN, 1, 1), photo(91, 0, 2), ...many] })!;
    expect(out.points).toHaveLength(MAX_BLOG_MAP_POINTS);
    expect(out.points.every(p => p.lat !== 0)).toBe(true);
  });
});
