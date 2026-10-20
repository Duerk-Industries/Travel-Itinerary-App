import { haversineKm } from './dayRouteOptimizer';

type Stop = { lat?: number | null; lng?: number | null };
const located = (point: Stop): point is { lat: number; lng: number } =>
  typeof point.lat === 'number' && typeof point.lng === 'number' && Number.isFinite(point.lat)
  && Number.isFinite(point.lng) && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180;

/** Free straight-line estimates between adjacent stops; never bridge a missing stop. */
export const travelEstimate = (from: Stop | undefined, to: Stop): string | null => {
  if (!from || !located(from) || !located(to)) return null;
  const distance = haversineKm(from, to);
  if (distance < 0.05) return 'Same area';
  return `~${Math.max(1, Math.ceil(distance / 5 * 60))} min walk · ~${Math.max(1, Math.ceil(distance / 30 * 60))} min drive`;
};
