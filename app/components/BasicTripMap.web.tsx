import React, { useEffect, useRef, useState } from 'react';
import type { PlanningMapPoint } from '../../server/src/types';
import { useAppTheme } from '../theme/ThemeContext';
import { linkTextColor } from '../theme/theme';
import { fitView, placeInView, tilesForView } from '../utils/tileMap';

const COLORS = { flight: '#4285F4', lodging: '#FB8C00', activity: '#34A853', car_rental: '#9C27B0' };
const HEIGHT = 400;
const FONT_STACK = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/**
 * Shown when the interactive map cannot start (no WebGL, a blocked GPU, a locked-down browser). It needs nothing but
 * images: ordinary OpenStreetMap tiles laid out in HTML with the day's stops placed on top. The OpenStreetMap
 * "embed" page is not a substitute, because it now draws with WebGL too and fails the same way.
 *
 * Tiles come from OpenStreetMap's public tile server, which is meant for light use. This view is a fallback for a
 * handful of tiles per day, never the main map, and it carries the required credit.
 */
export default function BasicTripMap({ points, selectedId, onSelect }: { points: PlanningMapPoint[]; selectedId: string | null; onSelect?: (id: string) => void }) {
  const theme = useAppTheme();
  const { colors } = theme;
  const box = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const measure = () => { const next = Math.round(element.getBoundingClientRect().width); if (next > 0) setWidth(next); };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const located = points.filter((point) => typeof point.lat === 'number' && typeof point.lng === 'number');
  if (!located.length) return null;
  const selected = located.find((point) => point.id === selectedId) ?? located[0];
  const view = fitView(located.map((point) => ({ lat: point.lat!, lng: point.lng! })), width, HEIGHT);
  const tiles = tilesForView(view);
  const link = `https://www.openstreetmap.org/?mlat=${selected.lat}&mlon=${selected.lng}#map=16/${selected.lat}/${selected.lng}`;
  return <div style={{ flex: 2, minWidth: 0, fontFamily: FONT_STACK, fontSize: 14, color: colors.text }}>
    <div ref={box} role="group" aria-label="Basic map of day stops" style={{ position: 'relative', width: '100%', height: HEIGHT, overflow: 'hidden', borderRadius: 12, background: colors.surfaceMuted }}>
      {tiles.map((tile) => <img key={tile.key} alt="" draggable={false} src={tile.url} referrerPolicy="strict-origin-when-cross-origin"
        style={{ position: 'absolute', left: tile.left, top: tile.top, width: 256, height: 256, userSelect: 'none' }} />)}
      {located.map((point, index) => {
        const spot = placeInView({ lat: point.lat!, lng: point.lng! }, view);
        const isSelected = point.id === selected.id;
        return <button key={point.id} type="button" aria-label={`${index + 1}. ${point.title}`} aria-pressed={isSelected} onClick={() => onSelect?.(point.id)}
          style={{ position: 'absolute', left: spot.x, top: spot.y, transform: 'translate(-50%, -50%)', zIndex: isSelected ? 2 : 1, width: isSelected ? 44 : 34, height: isSelected ? 44 : 34, borderRadius: '50%', cursor: 'pointer', fontWeight: 'bold', color: 'white', background: COLORS[point.kind], border: `${isSelected ? 3 : 2}px solid white`, boxShadow: '0 1px 4px rgba(0,0,0,.5)', padding: 0 }}>
          {point.label || String(index + 1)}
        </button>;
      })}
      <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer"
        style={{ position: 'absolute', right: 0, bottom: 0, zIndex: 3, padding: '2px 6px', fontSize: 11, background: 'rgba(255,255,255,.8)', color: '#1f2937' }}>© OpenStreetMap contributors</a>
    </div>
    <p style={{ margin: '8px 0 0' }}>
      Basic map: no 3D graphics needed. Select a stop to highlight it.{' '}
      <a href={link} target="_blank" rel="noopener noreferrer" style={{ color: linkTextColor(theme) }}>Open {selected.title} in OpenStreetMap</a>
    </p>
  </div>;
}
