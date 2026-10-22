import type { BlogDayMapPoints } from '../../server/src/services/blogMapProjection';
import type { KeepsakeMapCapture } from './keepsakeMapCapture';
export const keepsakeMapPoints = (map: BlogDayMapPoints) => map?.precision === 'approximate' && Array.isArray(map.points)
  ? map.points.filter(point => typeof point?.lat === 'number' && typeof point?.lng === 'number' && Number.isFinite(point.lat) && Number.isFinite(point.lng) && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180)
    .slice(0,12).map(point => ({lat:Math.round(point.lat*100)/100,lng:Math.round(point.lng*100)/100})) : [];
export const keepsakeMapFallback = (map: BlogDayMapPoints): KeepsakeMapCapture => ({approximate:true,labels:keepsakeMapPoints(map).map((point,n) => `Approximate area ${n+1} (${point.lat.toFixed(2)}, ${point.lng.toFixed(2)})`)});
export const keepsakeImage = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const image = value.startsWith('data:') ? value : `data:image/png;base64,${value}`;
  return image.length <= 1_000_000 && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(image) ? image : undefined;
};
