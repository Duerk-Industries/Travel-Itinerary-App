import type { BlogDayMapPoints } from '../../server/src/services/blogMapProjection';
export type KeepsakeMapCapture = { image?: string; labels: string[]; approximate: boolean };
// Old native builds retain a useful printable list; the native module overrides this entry.
export async function captureKeepsakeMap(map: BlogDayMapPoints): Promise<KeepsakeMapCapture> {
  return { labels: map.points.slice(0, 12).map((p, n) => `Approximate area ${n + 1} (${p.lat.toFixed(2)}, ${p.lng.toFixed(2)})`), approximate: true };
}
