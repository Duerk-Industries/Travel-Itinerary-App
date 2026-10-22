import type { PlanningMapPoint } from '../../server/src/types';
export const isLocatedMapPoint = (point: PlanningMapPoint): boolean => typeof point.lat === 'number' && typeof point.lng === 'number'
  && Number.isFinite(point.lat) && Number.isFinite(point.lng) && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180
  && ['catalog', 'airport', 'manual', 'geocoder'].includes(point.coordinateSource || '');
export const mapBounds = (points: PlanningMapPoint[]): { ne: [number, number]; sw: [number, number] } => ({
  ne: [Math.max(...points.map(p => p.lng!)), Math.max(...points.map(p => p.lat!))],
  sw: [Math.min(...points.map(p => p.lng!)), Math.min(...points.map(p => p.lat!))],
});
