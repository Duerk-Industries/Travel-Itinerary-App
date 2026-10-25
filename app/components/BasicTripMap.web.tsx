import { layoutMetrics, mapFontFamily as FONT_STACK, themeStyle, linkTextColor } from '../theme/theme';


import { useAppTheme as useStyleTheme, useAppTheme } from '../theme/ThemeContext';
import React, { useEffect, useRef, useState } from 'react';
import type { PlanningMapPoint } from '../../server/src/types';


import { fitView, placeInView, tilesForView } from '../utils/tileMap';

const COLORS = (_theme: import('../theme/theme').AppTheme) => themeStyle('components_BasicTripMap_web_8', {  }, _theme);
const HEIGHT = layoutMetrics.BasicTripMap_web_HEIGHT;

/**
 * Shown when the interactive map cannot start (no WebGL, a blocked GPU, a locked-down browser). It needs nothing but
 * images: ordinary OpenStreetMap tiles laid out in HTML with the day's stops placed on top. The OpenStreetMap
 * "embed" page is not a substitute, because it now draws with WebGL too and fails the same way.
 *
 * Tiles come from OpenStreetMap's public tile server, which is meant for light use. This view is a fallback for a
 * handful of tiles per day, never the main map, and it carries the required credit.
 */
export default function BasicTripMap({ points, selectedId, onSelect }: { points: PlanningMapPoint[]; selectedId: string | null; onSelect?: (id: string) => void }) {
  const _styleTheme = useStyleTheme();
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
  return <div style={themeStyle('components_BasicTripMap_web_1', { FONT_STACK: FONT_STACK, colors: colors }, _styleTheme)}>
    <div ref={box} role="group" aria-label="Basic map of day stops" style={themeStyle('components_BasicTripMap_web_2', { HEIGHT: HEIGHT, colors: colors }, _styleTheme)}>
      {tiles.map((tile) => <img key={tile.key} alt="" draggable={false} src={tile.url} referrerPolicy="strict-origin-when-cross-origin"
        style={themeStyle('components_BasicTripMap_web_3', { tile: tile }, _styleTheme)} />)}
      {located.map((point, index) => {
        const spot = placeInView({ lat: point.lat!, lng: point.lng! }, view);
        const isSelected = point.id === selected.id;
        return <button key={point.id} type="button" aria-label={`${index + 1}. ${point.title}`} aria-pressed={isSelected} onClick={() => onSelect?.(point.id)}
          style={themeStyle('components_BasicTripMap_web_4', { spot: spot, isSelected: isSelected, COLORS: COLORS(_styleTheme), point: point }, _styleTheme)}>
          {point.label || String(index + 1)}
        </button>;
      })}
      <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer"
        style={themeStyle('components_BasicTripMap_web_5', {  }, _styleTheme)}>© OpenStreetMap contributors</a>
    </div>
    <p style={themeStyle('components_BasicTripMap_web_6', {  }, _styleTheme)}>
      Basic map: no 3D graphics needed. Select a stop to highlight it.{' '}
      <a href={link} target="_blank" rel="noopener noreferrer" style={themeStyle('components_BasicTripMap_web_7', { linkTextColor: linkTextColor, theme: theme }, _styleTheme)}>Open {selected.title} in OpenStreetMap</a>
    </p>
  </div>;
}
