import { themeStyle, getAppTheme as getStyleTheme } from '../theme/theme';
import { keepsakeMapFallback, keepsakeMapPoints } from './keepsakeMapData';
import { configureMapLibre } from './maplibreConfig.web';
import type { BlogDayMapPoints } from '../../server/src/services/blogMapProjection';
import type { KeepsakeMapCapture } from './keepsakeMapCapture';
export async function captureKeepsakeMap(input: BlogDayMapPoints): Promise<KeepsakeMapCapture> {
  const points = keepsakeMapPoints(input);
  const result = keepsakeMapFallback(input);
  if (input.precision !== 'approximate' || !points.length || typeof document === 'undefined') return result;
  const host = document.createElement('div');
  Object.assign(host.style, themeStyle('utils_keepsakeMapCapture_web_1', {  }, getStyleTheme('auto', null)));
  document.body.appendChild(host);
  let map: import('maplibre-gl').Map | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Timeout includes library/font loading, tile loading, and the final canvas read.
    const image = await Promise.race([
      (async () => {
        const lib = await import('maplibre-gl');
        configureMapLibre(lib);
        if (!host.isConnected) return undefined;
        map = new lib.Map({ container: host, style: 'https://tiles.openfreemap.org/styles/liberty', center: [points[0].lng, points[0].lat], zoom: 11,
          interactive: false, attributionControl: false, pixelRatio: 1, canvasContextAttributes: { preserveDrawingBuffer: true } });
        const instance = map;
        return new Promise<string | undefined>(resolve => {
          instance.once('load', () => {
            instance.addSource('areas', { type: 'geojson', data: { type: 'FeatureCollection', features: points.map((p, n) => ({ type: 'Feature', properties: { label: String(n + 1) }, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } })) } });
            instance.addLayer({ id: 'areas', type: 'circle', source: 'areas', paint: { 'circle-radius': 12, 'circle-color': themeStyle('utils_keepsakeMapCapture_web_3', {  }, getStyleTheme('auto', null)), 'circle-stroke-color': themeStyle('utils_keepsakeMapCapture_web_4', {  }, getStyleTheme('auto', null)), 'circle-stroke-width': 2 } });
            instance.addLayer({ id: 'labels', type: 'symbol', source: 'areas', layout: { 'text-field': ['get', 'label'], 'text-size': 12, 'text-font': ['Noto Sans Regular'] }, paint: { 'text-color': themeStyle('utils_keepsakeMapCapture_web_5', {  }, getStyleTheme('auto', null)) } });
            if (points.length > 1) instance.fitBounds(points.reduce((bounds, p) => bounds.extend([p.lng, p.lat]), new lib.LngLatBounds()), themeStyle('utils_keepsakeMapCapture_web_2', {  }, getStyleTheme('auto', null)));
            instance.once('idle', () => {
              try { const data = instance.getCanvas().toDataURL('image/jpeg', 0.8); resolve(data.length <= 1_000_000 ? data : undefined); } catch { resolve(undefined); }
            });
          });
          instance.once('error', () => resolve(undefined));
        });
      })(),
      new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), 4_000); }),
    ]);
    return { ...result, ...(image ? { image } : {}) };
  } catch { return result; }
  finally { if (timer) clearTimeout(timer); map?.remove(); host.remove(); }
}
