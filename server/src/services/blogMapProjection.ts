// Audience-safe map points for a blog day (docs gap-closing plan §1.3).
//
// Photo geotags are precise EXIF. Seeing a photo is not consent to publish where it was taken, so
// anyone who is not a traveler on the trip gets coordinates only when the trip has explicitly
// turned on shared maps, and then only coarse ones, projected here on the server. The response
// never carries timestamps, media ids or the exact values, so nothing precise can be recovered
// from it. Travelers already see the exact media, so they get the points as stored.

export type BlogMapSource = { lat: number; lng: number; time: number };
export type BlogMapPoint = { lat: number; lng: number };
export type BlogDayMapPoints = { precision: 'exact' | 'approximate'; points: BlogMapPoint[] };

// 0.01 degrees of latitude is about 1.1 km. Rounding is not anonymisation on its own (a single
// isolated cell still names a neighbourhood), so it is combined with the suppression below.
export const APPROX_GRID_DEGREES = 0.01;
// Points this close to a lodging are dropped for non-travelers: the lodging is the most likely
// home or private address. 1.5 km also covers the grid cell that contains it.
export const PRIVATE_ANCHOR_RADIUS_KM = 1.5;
export const MAX_BLOG_MAP_POINTS = 12;
export const MIN_PUBLIC_DISTINCT_CELLS = 2;

const EARTH_RADIUS_KM = 6371;
const toRad = (deg: number): number => (deg * Math.PI) / 180;
const distanceKm = (a: BlogMapPoint, b: BlogMapPoint): number => {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
};

const valid = (p: BlogMapPoint): boolean =>
  Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180
  // (0,0) is what a missing GPS fix commonly decodes to, never a real photo location.
  && !(p.lat === 0 && p.lng === 0);

const snap = (value: number): number => {
  const cell = Math.round(value / APPROX_GRID_DEGREES) * APPROX_GRID_DEGREES;
  return Number(cell.toFixed(2));
};

export const projectBlogDayMapPoints = (input: {
  sources: BlogMapSource[];
  membership: 'traveler' | 'follower';
  sharedMapEnabled: boolean;
  privateAnchors: BlogMapPoint[];
}): BlogDayMapPoints | null => {
  const ordered = input.sources.filter(valid).sort((a, b) => a.time - b.time);
  if (input.membership === 'traveler') {
    const points = ordered.slice(0, MAX_BLOG_MAP_POINTS).map(p => ({ lat: Number(p.lat.toFixed(5)), lng: Number(p.lng.toFixed(5)) }));
    return points.length >= 2 ? { precision: 'exact', points } : null;
  }
  if (!input.sharedMapEnabled) return null;
  const anchors = input.privateAnchors.filter(valid);
  const seen = new Set<string>();
  const points: BlogMapPoint[] = [];
  for (const source of ordered) {
    if (anchors.some(anchor => distanceKm(anchor, source) <= PRIVATE_ANCHOR_RADIUS_KM)) continue;
    const cell = { lat: snap(source.lat), lng: snap(source.lng) };
    const key = `${cell.lat},${cell.lng}`;
    if (seen.has(key)) continue;
    seen.add(key);
    points.push(cell);
    if (points.length >= MAX_BLOG_MAP_POINTS) break;
  }
  return points.length >= MIN_PUBLIC_DISTINCT_CELLS ? { precision: 'approximate', points } : null;
};
