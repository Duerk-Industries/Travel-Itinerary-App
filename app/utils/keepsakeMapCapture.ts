import type { BlogDayMapPoints } from '../../server/src/services/blogMapProjection';
export type KeepsakeMapCapture = { image?: string; labels: string[]; approximate: boolean };
// Fallback for old binaries and native exports without an enabled capture host.
export async function captureKeepsakeMap(map: BlogDayMapPoints): Promise<KeepsakeMapCapture> {
  const { keepsakeMapFallback } = await import('./keepsakeMapData');
  return keepsakeMapFallback(map);
}
