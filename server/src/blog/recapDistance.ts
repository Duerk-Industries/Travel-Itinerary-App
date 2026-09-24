export type RecapRoutePoint = { lat: number | null; lng: number | null };

const radians = (degrees: number): number => degrees * Math.PI / 180;

export const distanceKmBetween = (from: RecapRoutePoint | null, to: RecapRoutePoint | null): number => {
  if (!from || !to || !Number.isFinite(from.lat) || !Number.isFinite(from.lng) || !Number.isFinite(to.lat) || !Number.isFinite(to.lng)) return 0;
  const earthRadiusKm = 6371;
  const latDelta = radians(Number(to.lat) - Number(from.lat));
  const lngDelta = radians(Number(to.lng) - Number(from.lng));
  const a = Math.sin(latDelta / 2) ** 2
    + Math.cos(radians(Number(from.lat))) * Math.cos(radians(Number(to.lat))) * Math.sin(lngDelta / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

export const routeDistanceKm = (points: Array<RecapRoutePoint | null>): number =>
  points.slice(1).reduce((sum, point, index) => sum + distanceKmBetween(points[index], point), 0);
